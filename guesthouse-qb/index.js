// index.js - QuickBooks backend (tax inclusive, taxCode by Name/Agency, helper endpoints)
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());

// -------------------- CONFIG --------------------
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

const TOKEN_PATH = path.join(__dirname, "tokens.json");
const CUSTOMER_MAP_PATH = path.join(__dirname, "customers.json");

const DEFAULT_ITEM_NAME = process.env.ITEM_NAME || "Accommodation";
const ALLOW_ITEM_CREATE =
  (process.env.ALLOW_ITEM_CREATE || "true").toLowerCase() === "true";

// Tax configuration (env, optional — frontend can also send taxAgency/taxCode)
const RAW_TAX_CODE = (process.env.QB_TAX_CODE || "").trim();
const RAW_TAX_AGENCY = (process.env.QB_TAX_AGENCY || "").trim();

// Optional env to toggle inclusive/exclusive globally. Defaults to inclusive.
const TAX_CALC = (process.env.TAX_CALC || "inclusive").toLowerCase(); // "inclusive" | "exclusive"

// -------------------- CORS --------------------
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ||
  "https://r-system-33a06.web.app"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS: Origin not allowed: " + origin));
    },
    credentials: true,
  })
);

app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    res.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
  }
  res.sendStatus(200);
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  next();
});

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

async function qboQuery(tokens, q) {
  const url = `${API_BASE}${tokens.realmId}/query?query=${encodeURIComponent(q)}`;
  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
  });
  return resp.data;
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
          "Basic " + Buffer.from(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`).toString("base64"),
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
      try { fs.unlinkSync(TOKEN_PATH); } catch {}
      log("tokens.json deleted due to invalid_grant");
    }
    throw new Error("Token refresh failed.");
  }
}

// -------------------- ITEM HELPERS --------------------
async function findItemByName(tokens, name) {
  const data = await qboQuery(tokens, `select * from Item where Name='${name.replace(/'/g, "\\'")}'`);
  return data.QueryResponse.Item?.[0] || null;
}

async function findAnyIncomeAccount(tokens) {
  const data = await qboQuery(tokens, "select * from Account where AccountType='Income' maxresults 50");
  return (data.QueryResponse.Account || [])[0] || null;
}

async function ensureItemRef(tokens) {
  if (process.env.ITEM_REF_ID) {
    return { value: String(process.env.ITEM_REF_ID), name: DEFAULT_ITEM_NAME };
  }
  let item = await findItemByName(tokens, DEFAULT_ITEM_NAME);
  if (item) return { value: item.Id, name: item.Name };

  if (!ALLOW_ITEM_CREATE) {
    throw new Error(`Item '${DEFAULT_ITEM_NAME}' not found and ALLOW_ITEM_CREATE=false`);
  }

  const incomeAccount = await findAnyIncomeAccount(tokens);
  if (!incomeAccount) throw new Error("No Income account found to attach new Item.");

  const resp = await axios.post(
    `${API_BASE}${tokens.realmId}/item`,
    {
      Name: DEFAULT_ITEM_NAME,
      Type: "Service",
      IncomeAccountRef: { value: incomeAccount.Id, name: incomeAccount.Name },
      TrackQtyOnHand: false,
    },
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  item = resp.data.Item;
  return { value: item.Id, name: item.Name };
}

// -------------------- TAX CODE RESOLUTION --------------------
const taxCache = { byNameOrId: new Map(), byAgency: new Map(), vatFallback: null };

function cleanAgencyName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/@.*$/g, "")      // drop any trailing "@10%" etc
    .replace(/[^a-z0-9]+/g, " ") // strip punctuation to spaces
    .trim();
}

async function resolveTaxCodeByCode(tokens, codeOrName) {
  const key = (codeOrName || "").trim();
  if (!key) return null;
  if (taxCache.byNameOrId.has(key)) return taxCache.byNameOrId.get(key);

  if (/^[0-9a-fA-F-]+$/.test(key)) {
    const ref = { value: key };
    taxCache.byNameOrId.set(key, ref);
    return ref;
  }

  const safeName = key.replace(/'/g, "\\'");
  const data = await qboQuery(tokens, `select * from TaxCode where Name='${safeName}'`);
  const tc = data.QueryResponse.TaxCode?.[0];
  if (!tc) throw new Error(`TaxCode '${key}' not found.`);
  const ref = { value: tc.Id };
  taxCache.byNameOrId.set(key, ref);
  return ref;
}

async function resolveTaxCodeByAgency(tokens, agencyName) {
  const raw = (agencyName || RAW_TAX_AGENCY || "").trim();
  if (!raw) return null;
  if (taxCache.byAgency.has(raw)) return taxCache.byAgency.get(raw);

  const wanted = cleanAgencyName(raw);

  const codesData = await qboQuery(tokens, "select * from TaxCode where Active = true maxresults 500");
  const codes = codesData.QueryResponse.TaxCode || [];

  const rateIds = new Set();
  for (const code of codes) {
    (code.TaxRateList?.TaxRateDetail || []).forEach(d => {
      const id = d?.TaxRateRef?.value;
      if (id) rateIds.add(id);
    });
  }

  const rateIdToAgency = new Map();
  for (const rid of rateIds) {
    const rateData = await qboQuery(tokens, `select * from TaxRate where Id = '${rid}'`);
    const rate = rateData.QueryResponse.TaxRate?.[0];
    const agency = rate?.AgencyRef?.name || rate?.AgencyRef?.Name || null;
    if (agency) rateIdToAgency.set(rid, cleanAgencyName(agency));
  }

  for (const code of codes) {
    const details = code.TaxRateList?.TaxRateDetail || [];
    const match = details.some(d => {
      const rid = d?.TaxRateRef?.value;
      const agency = rid ? rateIdToAgency.get(rid) : null;
      return agency && (agency.includes(wanted) || wanted.includes(agency));
    });
    if (match) {
      const ref = { value: code.Id };
      taxCache.byAgency.set(raw, ref);
      return ref;
    }
  }

  throw new Error(`No TaxCode found for Tax Agency '${raw}'.`);
}

async function resolveAnyVATCode(tokens) {
  if (taxCache.vatFallback) return taxCache.vatFallback;
  const data = await qboQuery(tokens, "select Id, Name, Active from TaxCode where Active = true maxresults 500");
  const list = data.QueryResponse.TaxCode || [];
  const hit = list.find(tc => /vat/i.test(tc.Name || ""));
  if (!hit) throw new Error("No VAT TaxCode found in company.");
  taxCache.vatFallback = { value: hit.Id };
  return taxCache.vatFallback;
}

// Decide TaxCodeRef based on request or env, with VAT fallback
async function resolveTaxCodeRef(tokens, { taxCode, taxAgency } = {}) {
  if (taxCode) return await resolveTaxCodeByCode(tokens, taxCode);
  if (taxAgency) return await resolveTaxCodeByAgency(tokens, taxAgency);
  if (RAW_TAX_CODE) return await resolveTaxCodeByCode(tokens, RAW_TAX_CODE);
  if (RAW_TAX_AGENCY) return await resolveTaxCodeByAgency(tokens, RAW_TAX_AGENCY);
  return await resolveAnyVATCode(tokens);
}

// -------------------- CUSTOMER --------------------
async function findCustomerByName(displayName, tokens) {
  const data = await qboQuery(
    tokens,
    `select * from Customer where DisplayName='${displayName.replace(/'/g, "\\'")}'`
  );
  return data.QueryResponse.Customer?.[0] || null;
}

// -------------------- HELPER ENDPOINTS --------------------
app.get("/tax-codes", async (_req, res) => {
  try {
    const tokens = await getAccessToken();
    const data = await qboQuery(tokens, "select Id, Name, Active from TaxCode maxresults 500");
    res.json(data.QueryResponse.TaxCode || []);
  } catch (err) {
    log("TaxCodes error:", err.response?.data || err);
    res.status(500).json({ error: "Failed to list TaxCodes", details: err.response?.data || String(err) });
  }
});

app.get("/tax-rates", async (_req, res) => {
  try {
    const tokens = await getAccessToken();
    const data = await qboQuery(tokens, "select * from TaxRate maxresults 500");
  const rates = (data.QueryResponse.TaxRate || []).map(r => ({
      Id: r.Id,
      Name: r.Name,
      Active: r.Active,
      AgencyRef: r.AgencyRef || null,
      RateValue: r.RateValue,
    }));
    res.json(rates);
  } catch (err) {
    log("TaxRates error:", err.response?.data || err);
    res.status(500).json({ error: "Failed to list TaxRates", details: err.response?.data || String(err) });
  }
});

// -------------------- ROUTES --------------------
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    env: ENV,
    allowedOrigins: ALLOWED_ORIGINS,
    itemName: DEFAULT_ITEM_NAME,
    allowItemCreate: ALLOW_ITEM_CREATE,
    taxCodeProvided: RAW_TAX_CODE || null,
    taxAgencyProvided: RAW_TAX_AGENCY || null,
    taxCalcMode: TAX_CALC,
  });
});

app.get("/auth", (_req, res) => {
  try {
    const url = buildAuthUrl();
    res.send(`
      <h2>QuickBooks Authorization (${ENV})</h2>
      <a href="${url}" target="_blank" rel="noopener">Authorize QuickBooks</a>
      <p>Redirect URI: ${process.env.REDIRECT_URI}</p>
    `);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

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
    log("QuickBooks Authorized.");
    res.send("✅ QuickBooks authorized successfully. You may close this tab.");
  } catch (err) {
    res.status(500).send(`❌ Error: ${JSON.stringify(err.response?.data || err)}`);
  }
});

app.get("/check-token", (_req, res) => {
  const loggedIn = fs.existsSync(TOKEN_PATH);
  try {
    res.json({ loggedIn, authUrl: loggedIn ? null : buildAuthUrl() });
  } catch (e) {
    res.status(500).json({ loggedIn: false, error: e.message });
  }
});

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
      // Optional overrides from frontend
      taxCode,
      taxAgency,
      taxCalc, // "inclusive" or "exclusive" if you ever want to override per request
    } = req.body;

    if (!name || !email || !amount || !date) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const tokens = await getAccessToken();
    const itemRef = await ensureItemRef(tokens);
    const taxCodeRef = await resolveTaxCodeRef(tokens, { taxCode, taxAgency });

    // Customer lookup / create (cached by name+email)
    let map = fs.existsSync(CUSTOMER_MAP_PATH)
      ? JSON.parse(fs.readFileSync(CUSTOMER_MAP_PATH, "utf8"))
      : {};
    const key = `${name}_${email}`.toLowerCase();
    let customerId = map[key];

    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (!customerId) {
      const found = await findCustomerByName(name, tokens);
      if (found) {
        customerId = found.Id;
      } else {
        const custResp = await axios.post(
          `${API_BASE}${tokens.realmId}/customer`,
          {
            DisplayName: name,
            PrimaryEmailAddr: { Address: email },
            PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
            BillAddr: { Line1: address || "N/A" },
            ResaleNum: customerNumber || "",
          },
          { headers }
        );
        customerId = custResp.data.Customer.Id;
      }
      map[key] = customerId;
      fs.writeFileSync(CUSTOMER_MAP_PATH, JSON.stringify(map, null, 2));
    }

    // Tax calculation mode: inclusive by default or per request/env
    const calcMode =
      (taxCalc || TAX_CALC) === "exclusive" ? "TaxExcluded" : "TaxInclusive";

    const baseReceipt = {
      CustomerRef: { value: customerId },
      TxnDate: date, // yyyy-mm-dd
      PrivateNote: notes || "",

      // GLOBAL TAX MODE: inclusive or exclusive
      GlobalTaxCalculation: calcMode,

      // Header-level tax code (lets QBO compute totals consistently)
      TxnTaxDetail: {
        TxnTaxCodeRef: { value: taxCodeRef.value },
      },

      Line: [
        {
          Amount: amount, // amount you pass should already include VAT when inclusive
          DetailType: "SalesItemLineDetail",
          Description: `Room: ${room || "-"} | Check-in: ${checkin || "-"} | Check-out: ${checkout || "-"}`,
          SalesItemLineDetail: {
            ItemRef: itemRef,
            TaxCodeRef: taxCodeRef,
          },
        },
      ],
    };

    let payload = { ...baseReceipt };
    if (receiptNumber) payload.DocNumber = String(receiptNumber);

    const salesUrl = `${API_BASE}${tokens.realmId}/salesreceipt`;
    async function createSalesReceipt(body) {
      return axios.post(salesUrl, body, { headers });
    }

    let response;
    try {
      response = await createSalesReceipt(payload);
    } catch (err) {
      const detail = err.response?.data;
      const msg = JSON.stringify(detail || err);
      if (payload.DocNumber && /DocNumber|Duplicate|duplicate/i.test(msg)) {
        try {
          const retryPayload = { ...baseReceipt }; // omit DocNumber
          response = await createSalesReceipt(retryPayload);
        } catch (retryErr) {
          log("Retry without DocNumber failed:", retryErr.response?.data || retryErr);
          throw retryErr;
        }
      } else {
        throw err;
      }
    }

    res.json({ success: true, receiptId: response.data.SalesReceipt.Id });
  } catch (err) {
    log("QuickBooks Error:", err.response?.data || err);
    res.status(500).json({
      error: "Failed to push payment",
      details: err.response?.data || String(err),
    });
  }
});

// -------------------- START --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🚀 Server running on port ${PORT}`);
  try {
    log("Authorize URL:", buildAuthUrl());
  } catch {}
});
