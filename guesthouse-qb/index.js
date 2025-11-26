const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

//--------------------------------------------------------
//  CREATE APP
//--------------------------------------------------------
const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

//--------------------------------------------------------
//  QUICKBOOKS CONSTANTS
//--------------------------------------------------------
const authBase = "https://appcenter.intuit.com/connect/oauth2";
const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const apiBase = "https://quickbooks.api.intuit.com/v3/company/";

const scopes = [
  "com.intuit.quickbooks.accounting",
  "openid",
  "profile",
  "email",
  "phone",
  "address",
].join(" ");

const tokenPath = path.join(__dirname, "tokens.json");
const customerMapPath = path.join(__dirname, "customers.json");

//--------------------------------------------------------
//  TOKEN REFRESHER
//--------------------------------------------------------
async function getAccessToken() {
  if (!fs.existsSync(tokenPath)) {
    throw new Error("Not authenticated with QuickBooks");
  }

  const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));

  if (Date.now() < tokens.expires_at) {
    return tokens;
  }

  const response = await axios.post(
    tokenUrl,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
    {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const updated = {
    ...tokens,
    access_token: response.data.access_token,
    expires_at: Date.now() + response.data.expires_in * 1000,
  };

  fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2));
  return updated;
}

//--------------------------------------------------------
//  ROUTES (MUST COME BEFORE STATIC SERVE)
//--------------------------------------------------------

// QUICKBOOKS AUTH
app.get("/auth", (req, res) => {
  const state = Math.random().toString(36).substring(7);

  const authUrl =
    `${authBase}?client_id=${process.env.CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${state}`;

  res.send(`
    <h2>QuickBooks Authorization</h2>
    <a href="${authUrl}" target="_blank">Authorize QuickBooks</a>
    <p>Redirect URI: ${process.env.REDIRECT_URI}</p>
  `);
});

// CALLBACK
app.get("/callback", async (req, res) => {
  const { code, realmId } = req.query;

  if (!code || !realmId) {
    return res.status(400).send("Missing code or realmId");
  }

  try {
    const response = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.REDIRECT_URI,
      }),
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
            ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const data = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_at: Date.now() + response.data.expires_in * 1000,
      realmId,
    };

    fs.writeFileSync(tokenPath, JSON.stringify(data, null, 2));

    res.send("✅ QuickBooks Authorized. You can now push payments.");
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).send("❌ QuickBooks callback failed.");
  }
});

// CHECK TOKEN
app.get("/check-token", (req, res) => {
  const loggedIn = fs.existsSync(tokenPath);

  let authUrl = null;
  if (!loggedIn) {
    const state = Math.random().toString(36).substring(7);
    authUrl =
      `${authBase}?client_id=${process.env.CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&state=${state}`;
  }

  res.json({ loggedIn, authUrl });
});

// PAYMENT TO QUICKBOOKS
app.post("/payment-to-quickbooks", async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      customerNumber,
      amount,
      receiptNumber,
      date,
      room,
      checkin,
      checkout,
      notes,
      specialOffer,
    } = req.body;

    const tokens = await getAccessToken();

    const config = {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    let map = {};
    if (fs.existsSync(customerMapPath)) {
      map = JSON.parse(fs.readFileSync(customerMapPath, "utf8"));
    }

    const key = `${name}_${email}`;
    let customerId;

    if (map[key]) {
      customerId = map[key];
    } else {
      const response = await axios.post(
        `${apiBase}${tokens.realmId}/customer`,
        {
          DisplayName: name,
          PrimaryEmailAddr: { Address: email },
          PrimaryPhone: { FreeFormNumber: phone },
          BillAddr: { Line1: address || "N/A" },
          ResaleNum: customerNumber || "",
        },
        config
      );

      customerId = response.data.Customer.Id;
      map[key] = customerId;
      fs.writeFileSync(customerMapPath, JSON.stringify(map, null, 2));
    }

    const receipt = await axios.post(
      `${apiBase}${tokens.realmId}/salesreceipt`,
      {
        CustomerRef: { value: customerId },
        TxnDate: date,
        DocNumber: receiptNumber,
        PrivateNote: notes || "",
        Line: [
          {
            Amount: amount,
            DetailType: "SalesItemLineDetail",
            Description: `Room: ${room} | Check-in: ${checkin} | Check-out: ${checkout}`,
            SalesItemLineDetail: {
              ItemRef: { value: "6", name: "Accommodation" },
            },
          },
        ],
      },
      config
    );

    res.json({
      success: true,
      receiptId: receipt.data.SalesReceipt.Id,
    });
  } catch (err) {
    console.error("QuickBooks Error:", err.response?.data || err);
    res.status(500).json({
      error: "Failed to push payment",
      details: err.response?.data || String(err),
    });
  }
});

//--------------------------------------------------------
//  START SERVER
//--------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`🔑 Login: http://localhost:${PORT}/auth`);
});

