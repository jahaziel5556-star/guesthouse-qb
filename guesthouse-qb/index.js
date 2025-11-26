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
app.use(cors({ origin: true, credentials: true })); // adjust origin in production if needed

// -------------------- env + constants --------------------
const ENV = (process.env.ENVIRONMENT || "sandbox").toLowerCase(); // "sandbox" or "production"
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

// serve static UI if folder exists (public/)
if (fs.existsSync(path.join(__dirname, "public"))) {
  app.use(express.static(path.join(__dirname, "public")));
} else {
  // fallback to serve root index.html if present
  if (fs.existsSync(path.join(__dirname, "index.html"))) {
    app.use(express.static(__dirname));
  }
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function buildAuthUrl() {
  if (!process.env.CLIENT_ID || !process.env.REDIRECT_URI) {
    throw new Error("Missing CLIENT_ID or REDIRECT_URI in environment.");
  }
  const state = Math.random().toString(36).substring(2, 12);
  return `${AUTH_BASE}?client_id=${encodeURIComponent(process.env.CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
    `&response_type=code&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${encodeURIComponent(state)}`;
}

// -------------------- token management --------------------
async function getAccessToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error("Not authenticated with QuickBooks (tokens.json not found).");
  }

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

  // if token still valid (small safety margin)
  if (Date.now() < (tokens.expires_at || 0) - 5000) {
    return tokens;
  }

  // refresh token flow
  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });

    const response = await axios.post(TOKEN_URL, params.toString(), {
      headers: {
        Authorization: "Basic " + Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 15000
    });

    const resData = response.data;
    const updated = {
      ...tokens,
      access_token: resData.access_token,
      refresh_token: resData.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + (resData.expires_in || 3600) * 1000,
      realmId: tokens.realmId || resData.realmId
    };

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
    log("Refreshed token, expires_at:", new Date(updated.expires_at).toISOString());
    return updated;
  } catch (err) {
    const details = err.response?.data || err.message || String(err);
    log("Token refresh failed:", details);
    // If the refresh token is invalid, delete tokens.json so operator can re-authorize
    if (JSON.stringify(details).includes("invalid_grant") || JSON.stringify(details).includes("invalid_grant")) {
      try { fs.unlinkSync(TOKEN_PATH); log("Deleted tokens.json (invalid_grant). Re-authorize via /auth"); } catch(e){}
    }
    throw new Error(`Token refresh failed: ${JSON.stringify(details)}`);
  }
}

// -------------------- routes --------------------

// health check
app.get("/health", (req, res) => res.json({ ok: true, env: ENV }));

// auth link (admin uses this to start authorization)
app.get("/auth", (req, res) => {
  try {
    const url = buildAuthUrl();
    res.send(`<h2>QuickBooks Authorization (${ENV})</h2>
      <p><a href="${url}" target="_blank">Click here to authorize QuickBooks</a></p>
      <p>Redirect URI: <code>${process.env.REDIRECT_URI}</code></p>
      <p><small>Make sure you log in as the company admin (sandbox admin for sandbox).</small></p>`);
  } catch (err) {
    res.status(500).send(String(err.message || err));
  }
});

// OAuth callback that QuickBooks will call
app.get("/callback", async (req, res) => {
  const { code, realmId } = req.query;
  if (!code || !realmId) {
    log("Callback missing code or realmId", req.query);
    return res.status(400).send("Missing code or realmId");
  }

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.REDIRECT_URI
    });

    const response = await axios.post(TOKEN_URL, params.toString(), {
      headers: {
        Authorization: "Basic " + Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 15000
    });

    const data = response.data;
    const tokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      realmId
    };

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
    log("Saved tokens.json for realmId:", realmId);
    res.send("✅ QuickBooks Authorized. You can close this window and return to the app.");
  } catch (err) {
    const details = err.response?.data || err.message || String(err);
    log("Callback token exchange failed:", details);
    res.status(500).send(`❌ QuickBooks token exchange failed: ${JSON.stringify(details)}`);
  }
});

// frontend polls this to check login
app.get("/check-token", (req, res) => {
  const loggedIn = fs.existsSync(TOKEN_PATH);
  const authUrl = loggedIn ? null : buildAuthUrl();
  res.json({ loggedIn, authUrl });
});

// push payment to QuickBooks
app.post("/payment-to-quickbooks", async (req, res) => {
  try {
    const {
      name, email, phone, address, customerNumber,
      amount, receiptNumber, date, room, checkin, checkout, notes, specialOffer
    } = req.body || {};

    // minimal validation
    if (!name || !email || !amount || !receiptNumber || !date) {
      return res.status(400).json({ error: "Missing required fields (name, email, amount, receiptNumber, date)" });
    }

    const tokens = await getAccessToken(); // may throw
    const config = {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      timeout: 20000
    };

    // load or create customer map
    let customerMap = {};
    if (fs.existsSync(CUSTOMER_MAP_PATH)) {
      try {
        customerMap = JSON.parse(fs.readFileSync(CUSTOMER_MAP_PATH, "utf8"));
      } catch (e) {
        log("Warning: customers.json parse failed; overwriting.");
        customerMap = {};
      }
    }

    const key = `${name}_${email}`.replace(/\s+/g, "_").toLowerCase();
    let customerId = customerMap[key];

    if (!customerId) {
      const custBody = {
        DisplayName: name,
        PrimaryEmailAddr: email ? { Address: email } : undefined,
        PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
        BillAddr: { Line1: address || "N/A" },
        ResaleNum: customerNumber || ""
      };

      const custResp = await axios.post(`${API_BASE}${tokens.realmId}/customer`, custBody, config);
      customerId = custResp.data?.Customer?.Id;
      if (!customerId) throw new Error("Failed to create customer in QuickBooks (no Id returned).");
      customerMap[key] = customerId;
      fs.writeFileSync(CUSTOMER_MAP_PATH, JSON.stringify(customerMap, null, 2));
      log("Created QuickBooks customer:", customerId);
    }

    // create sales receipt (ensure ItemRef value exists in company)
    const salesBody = {
      CustomerRef: { value: customerId },
      TxnDate: date,
      DocNumber: `${receiptNumber}`,
      PrivateNote: notes || "",
      Line: [
        {
          Amount: amount,
          DetailType: "SalesItemLineDetail",
          Description: `Room: ${room} | Check-in: ${checkin} | Check-out: ${checkout}`,
          SalesItemLineDetail: {
            ItemRef: { value: "6", name: "Accommodation" } // ensure this item exists in QB company
          }
        }
      ]
    };

    const salesResp = await axios.post(`${API_BASE}${tokens.realmId}/salesreceipt`, salesBody, config);
    const receiptId = salesResp.data?.SalesReceipt?.Id;
    if (!receiptId) throw new Error("SalesReceipt created but no Id returned.");

    res.json({ success: true, receiptId });
  } catch (err) {
    const details = err.response?.data || err.message || String(err);
    log("QuickBooks Error:", details);
    let hint = null;
    if (JSON.stringify(details).includes("invalid_grant") || JSON.stringify(details).includes("Incorrect") || JSON.stringify(details).includes("client")) {
      hint = "Token/auth error — ensure CLIENT_ID/CLIENT_SECRET and REDIRECT_URI match QuickBooks app settings and tokens.json is for the correct environment. If you changed these, delete tokens.json and re-authorize at /auth.";
    }
    res.status(500).json({ error: "Failed to push payment", details, hint });
  }
});

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🚀 Server running at http://localhost:${PORT}  (ENV=${ENV})`);
  try {
    log(`🔑 Authorize QuickBooks here: ${buildAuthUrl()}`);
  } catch (e) {
    log("Auth URL not available until CLIENT_ID/REDIRECT_URI are set in env.");
  }
});
