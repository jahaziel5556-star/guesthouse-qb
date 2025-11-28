// index.js - QuickBooks backend (FULLY PRODUCTION READY)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", credentials: true }));

// -------------------- ENV SETTINGS --------------------
const ENV = (process.env.ENVIRONMENT || "production").toLowerCase();

const AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const API_BASE =
  ENV === "production"
    ? "https://quickbooks.api.intuit.com/v3/company/"
    : "https://sandbox-quickbooks.api.intuit.com/v3/company/";

const SCOPES = [
  "com.intuit.quickbooks.accounting",
  "openid",
  "profile",
  "email",
  "phone",
  "address",
].join(" ");

// local files
const TOKEN_PATH = path.join(__dirname, "tokens.json");
const CUSTOMER_MAP_PATH = path.join(__dirname, "customers.json");

// -------------------- LOGGING --------------------
function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// -------------------- UTILS --------------------
function buildAuthUrl() {
  if (!process.env.CLIENT_ID || !process.env.REDIRECT_URI) {
    throw new Error("Missing CLIENT_ID or REDIRECT_URI");
  }

  const state = Math.random().toString(36).substring(2);

  return (
    `${AUTH_BASE}?client_id=${process.env.CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
    `&response_type=code&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${state}`
  );
}

// -------------------- TOKENS --------------------
async function getAccessToken() {
  if (!fs.existsSync(TOKEN_PATH))
    throw new Error("Not authenticated with QuickBooks.");

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

  if (Date.now() < tokens.expires_at - 5000) return tokens;

  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });

    const resp = await axios.post(TOKEN_URL, params.toString(), {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const updated = {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
      realmId: tokens.realmId,
    };

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
    log("Token refreshed.");
    return updated;
  } catch (err) {
    log("Token refresh failed:", err.response?.data || err);
    if (JSON.stringify(err).includes("invalid_grant")) {
      fs.unlinkSync(TOKEN_PATH);
      log("tokens.json deleted due to invalid_grant");
    }
    throw new Error("Token refresh failed.");
  }
}

// -------------------- FIND CUSTOMER --------------------
async function findCustomerByName(name, tokens) {
  const query = `select * from Customer where DisplayName='${name.replace(
    /'/g,
    "\\'"
  )}'`;

  const url = `${API_BASE}${tokens.realmId}/query?query=${encodeURIComponent(
    query
  )}`;

  const resp = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: "application/json",
    },
  });

  return resp.data.QueryResponse.Customer?.[0]?.Id || null;
}

// -------------------- ROUTES --------------------
app.get("/health", (req, res) => {
  res.json({ ok: true, env: ENV });
});

// AUTH START
app.get("/auth", (req, res) => {
  try {
    const url = buildAuthUrl();
    res.send(`
      <h2>QuickBooks Authorization (${ENV})</h2>
      <a href="${url}" target="_blank">Authorize QuickBooks</a>
      <p>Redirect URI: ${process.env.REDIRECT_URI}</p>
    `);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// CALLBACK
app.get("/callback", async (req, res) => {
  const { code, realmId } = req.query;
  if (!code || !realmId)
    return res.status(400).send("Missing ?code or ?realmId");

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.REDIRECT_URI,
    });

    const resp = await axios.post(TOKEN_URL, params.toString(), {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
      realmId,
    };

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2));
    log("QuickBooks Authorized. tokens.json saved.");

    res.send("✅ QuickBooks authorized successfully. You may close this tab.");
  } catch (err) {
    res
      .status(500)
      .send(`❌ Error: ${JSON.stringify(err.response?.data || err)}`);
  }
});

// CHECK TOKEN (used by frontend)
app.get("/check-token", (req, res) => {
  const loggedIn = fs.existsSync(TOKEN_PATH);
  res.json({ loggedIn, authUrl: loggedIn ? null : buildAuthUrl() });
});

// -------------------- PAYMENT PUSH --------------------
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
    } = req.body;

    if (!name || !email || !amount || !date || !receiptNumber)
      return res.status(400).json({ error: "Missing fields" });

    const tokens = await getAccessToken();

    const config = {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    let map = fs.existsSync(CUSTOMER_MAP_PATH)
      ? JSON.parse(fs.readFileSync(CUSTOMER_MAP_PATH))
      : {};

    const key = `${name}_${email}`.toLowerCase();
    let customerId = map[key];

    if (!customerId) {
      customerId = await findCustomerByName(name, tokens);

      if (!customerId) {
        const cust = await axios.post(
          `${API_BASE}${tokens.realmId}/customer`,
          {
            DisplayName: name,
            PrimaryEmailAddr: { Address: email },
            PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
            BillAddr: { Line1: address || "N/A" },
            ResaleNum: customerNumber || "",
          },
          config
        );

        customerId = cust.data.Customer.Id;
      }

      map[key] = customerId;
      fs.writeFileSync(CUSTOMER_MAP_PATH, JSON.stringify(map, null, 2));
    }

    const receipt = await axios.post(
      `${API_BASE}${tokens.realmId}/salesreceipt`,
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
              ItemRef: { value: "6", name: "Accommodation" }, // MUST exist in QB
            },
          },
        ],
      },
      config
    );

    res.json({ success: true, receiptId: receipt.data.SalesReceipt.Id });
  } catch (err) {
    log("QuickBooks Error:", err.response?.data || err);
    res.status(500).json({
      error: "Failed to push payment",
      details: err.response?.data || String(err),
    });
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🚀 Server running on port ${PORT}`);
  try {
    log("Authorize URL:", buildAuthUrl());
  } catch {}
});
