// index.js - QuickBooks backend (production-ready)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

// -------------------- ENV + CONSTANTS --------------------
const ENV = (process.env.ENVIRONMENT || "sandbox").toLowerCase(); // sandbox or production

const AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const API_BASE_PROD = "https://quickbooks.api.intuit.com/v3/company/";
const API_BASE_SANDBOX = "https://sandbox-quickbooks.api.intuit.com/v3/company/";
const API_BASE = ENV === "production" ? API_BASE_PROD : API_BASE_SANDBOX;

const SCOPES = [
  "com.intuit.quickbooks.accounting",
  "openid",
  "profile",
  "email",
  "phone",
  "address",
].join(" ");

const TOKEN_PATH = path.join(__dirname, "tokens.json");
const CUSTOMER_MAP_PATH = path.join(__dirname, "customers.json");

// serve UI if public folder exists
if (fs.existsSync(path.join(__dirname, "public"))) {
  app.use(express.static(path.join(__dirname, "public")));
}

// -------------------- LOGGING --------------------
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// -------------------- AUTH URL BUILDER --------------------
function buildAuthUrl() {
  const state = Math.random().toString(36).substring(2);
  return `${AUTH_BASE}?client_id=${process.env.CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
    `&response_type=code&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${state}`;
}

// -------------------- TOKEN HANDLING --------------------
async function getAccessToken() {
  if (!fs.existsSync(TOKEN_PATH)) throw new Error("Not authenticated with QuickBooks.");

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

  if (Date.now() < tokens.expires_at - 5000) return tokens;

  // refresh
  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });

    const resp = await axios.post(TOKEN_URL, params.toString(), {
      headers: {
        Authorization: "Basic " + Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const updated = {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
      realmId: tokens.realmId,
    };

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
    log("Tokens refreshed.");

    return updated;
  } catch (err) {
    log("Token refresh failed:", err.response?.data || err);
    if (JSON.stringify(err).includes("invalid_grant")) fs.unlinkSync(TOKEN_PATH);
    throw new Error("Token refresh failed.");
  }
}

// -------------------- SEARCH CUSTOMER IN QUICKBOOKS (IMPORTANT) --------------------
async function findCustomerByName(name, tokens) {
  const query = `select * from Customer where DisplayName = '${name.replace(/'/g, "\\'")}'`;
  const url = `${API_BASE}${tokens.realmId}/query?query=${encodeURIComponent(query)}`;

  const resp = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: "application/json"
    }
  });

  if (resp.data.QueryResponse.Customer?.length > 0) {
    return resp.data.QueryResponse.Customer[0].Id;
  }

  return null;
}

// -------------------- ROUTES --------------------

// health check
app.get("/health", (req, res) => {
  res.json({ ok: true, env: ENV });
});

// auth
app.get("/auth", (req, res) => {
  const url = buildAuthUrl();
  res.send(`<h2>QuickBooks Authorization (${ENV})</h2>
    <a href="${url}" target="_blank">Authorize QuickBooks</a>
    <p>Redirect URI: ${process.env.REDIRECT_URI}</p>
  `);
});

// callback
app.get("/callback", async (req, res) => {
  const { code, realmId } = req.query;
  if (!code || !realmId) return res.status(400).send("Missing code or realmId");

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.REDIRECT_URI
    });

    const resp = await axios.post(TOKEN_URL, params.toString(), {
      headers: {
        Authorization: "Basic " + Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const data = {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
      realmId,
    };

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2));

    res.send("✅ QuickBooks Authorized successfully.");
  } catch (err) {
    res.status(500).send(`❌ Error: ${JSON.stringify(err.response?.data || err)}`);
  }
});

// check token for frontend
app.get("/check-token", (req, res) => {
  const loggedIn = fs.existsSync(TOKEN_PATH);
  res.json({ loggedIn, authUrl: loggedIn ? null : buildAuthUrl() });
});

// -------------------- PAYMENT TO QUICKBOOKS --------------------
app.post("/payment-to-quickbooks", async (req, res) => {
  try {
    const {
      name, email, phone, address, customerNumber,
      amount, receiptNumber, date, room, checkin, checkout, notes
    } = req.body;

    if (!name || !email || !amount || !date || !receiptNumber) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const tokens = await getAccessToken();

    const config = {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    };

    // Load map
    let map = fs.existsSync(CUSTOMER_MAP_PATH)
      ? JSON.parse(fs.readFileSync(CUSTOMER_MAP_PATH, "utf8"))
      : {};

    const key = `${name}_${email}`.toLowerCase();
    let customerId = map[key];

    // *** NEW: search QuickBooks first ***
    if (!customerId) {
      const existingId = await findCustomerByName(name, tokens);

      if (existingId) {
        customerId = existingId;
      } else {
        // create customer
        const custResp = await axios.post(
          `${API_BASE}${tokens.realmId}/customer`,
          {
            DisplayName: name,
            PrimaryEmailAddr: { Address: email },
            PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
            BillAddr: { Line1: address || "N/A" },
            ResaleNum: customerNumber || ""
          },
          config
        );

        customerId = custResp.data.Customer.Id;
      }

      map[key] = customerId;
      fs.writeFileSync(CUSTOMER_MAP_PATH, JSON.stringify(map, null, 2));
    }

    // Create the sales receipt
    const resp = await axios.post(
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
              ItemRef: { value: "6", name: "Accommodation" } // must exist in QB
            }
          }
        ]
      },
      config
    );

    res.json({ success: true, receiptId: resp.data.SalesReceipt.Id });

  } catch (err) {
    res.status(500).json({
      error: "Failed to push payment",
      details: err.response?.data || String(err)
    });
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🚀 Server running at http://localhost:${PORT}`);
  log(`🌍 Environment: ${ENV}`);
  log(`🔑 Auth: ${buildAuthUrl()}`);
});
