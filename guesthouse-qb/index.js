// index.js - QuickBooks backend (tax-inclusive with robust TaxLine: includes TaxRateRef, NetAmountTaxable, and prevents double-add)
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

// Tax configuration
const RAW_TAX_CODE = (process.env.QB_TAX_CODE || "").trim();            // preferred code (name or id)
const RAW_TAX_AGENCY = (process.env.QB_TAX_AGENCY || "").trim();        // fallback by agency match
const PREV_QB_TAX_CODE = (process.env.PREV_QB_TAX_CODE || "").trim();   // previous working tax code (name or id)
const FALLBACK_TAX_PERCENT = parseFloat(process.env.FALLBACK_TAX_PERCENT || "10"); // fallback percent when rate = 0

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

// -------------------- UTILITIES --------------------
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

// -------------------- TOKEN MANAGEMENT --------------------
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
async function fetchTaxCodeById(tokens, id) {
  const data = await qboQuery(tokens, `select * from TaxCode where Id='${String(id)}'`);
  return data.QueryResponse.TaxCode?.[0] || null;
}

async function getCombinedRateFromTaxCode(tokens, taxCodeObj) {
  const details = taxCodeObj?.TaxRateList?.TaxRateDetail || [];
  if (!details.length) return 0;
  let total = 0;
  for (const d of details) {
    const rid = d?.TaxRateRef?.value;
    if (!rid) continue;
    const rateData = await qboQuery(tokens, `select * from TaxRate where Id='${rid}'`);
    const rate = rateData.QueryResponse.TaxRate?.[0];
    const val = parseFloat(rate?.RateValue ?? 0);
    if (!isNaN(val)) total += val;
  }
  return total;
}

function cleanAgencyName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/@.*$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function resolveTaxCodeRef(tokens, { taxCode, taxAgency } = {}) {
  let ref = null;

  const resolveByName = async (name) => {
    const safe = name.replace(/'/g, "\\'");
    const data = await qboQuery(tokens, `select * from TaxCode where Name='${safe}'`);
    const tc = data.QueryResponse.TaxCode?.[0];
    if (!tc) throw new Error(`TaxCode '${name}' not found.`);
    return { value: tc.Id, _full: tc };
  };

  const resolveByAgency = async (agencyRaw) => {
    const wanted = cleanAgencyName(agencyRaw);
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
      const rateData = await qboQuery(tokens, `select * from TaxRate where Id='${rid}'`);
      const rate = rateData.QueryResponse.TaxRate?.[0];
      const agency = cleanAgencyName(rate?.AgencyRef?.name || rate?.AgencyRef?.Name || "");
      if (agency) rateIdToAgency.set(rid, agency);
    }

    for (const code of codes) {
      const details = code.TaxRateList?.TaxRateDetail || [];
      const match = details.some(d => {
        const rid = d?.TaxRateRef?.value;
        const agency = rid ? rateIdToAgency.get(rid) : null;
        return agency && (agency.includes(wanted) || wanted.includes(agency));
      });
      if (match) {
        const tcFull = await fetchTaxCodeById(tokens, code.Id);
        return { value: code.Id, _full: tcFull || code };
      }
    }
    throw new Error(`No TaxCode found for Tax Agency '${agencyRaw}'`);
  };

  if (taxCode) {
    if (/^[0-9a-fA-F-]+$/.test(taxCode)) {
      const tc = await fetchTaxCodeById(tokens, taxCode);
      if (!tc) throw new Error(`TaxCode Id '${taxCode}' not found.`);
      ref = { value: tc.Id, _full: tc };
    } else {
      ref = await resolveByName(taxCode);
    }
  } else if (taxAgency) {
    ref = await resolveByAgency(taxAgency);
  } else if (RAW_TAX_CODE) {
    if (/^[0-9a-fA-F-]+$/.test(RAW_TAX_CODE)) {
      const tc = await fetchTaxCodeById(tokens, RAW_TAX_CODE);
      if (!tc) throw new Error(`TaxCode Id '${RAW_TAX_CODE}' not found.`);
      ref = { value: tc.Id, _full: tc };
    } else {
      ref = await resolveByName(RAW_TAX_CODE);
    }
  } else if (RAW_TAX_AGENCY) {
    ref = await resolveByAgency(RAW_TAX_AGENCY);
  } else {
    const data = await qboQuery(tokens, "select * from TaxCode where Active = true maxresults 500");
    const list = data.QueryResponse.TaxCode || [];
    const hit = list.find(tc => /vat/i.test(tc.Name || ""));
    if (!hit) throw new Error("No VAT TaxCode found in company.");
    const tcFull = await fetchTaxCodeById(tokens, hit.Id);
    ref = { value: hit.Id, _full: tcFull || hit };
  }

  return ref;
}

// Fallback wrapper to ensure we have a usable rate
async function resolveTaxContext(tokens, { taxCode, taxAgency, previousTaxCode }) {
  // 1) Primary
  let primary = await resolveTaxCodeRef(tokens, { taxCode, taxAgency });
  let rate = await getCombinedRateFromTaxCode(tokens, primary._full);

  // 2) If 0% and previous tax code provided (req or env), try that
  if ((!rate || rate <= 0) && (previousTaxCode || PREV_QB_TAX_CODE)) {
    const prevRef = await resolveTaxCodeRef(tokens, { taxCode: previousTaxCode || PREV_QB_TAX_CODE });
    const prevRate = await getCombinedRateFromTaxCode(tokens, prevRef._full);
    if (prevRate && prevRate > 0) {
      return { taxCodeRef: prevRef, ratePercent: prevRate, source: "previousTaxCode" };
    }
  }

  // 3) If still 0%, use fallback percent
  if (!rate || rate <= 0) {
    return { taxCodeRef: primary, ratePercent: FALLBACK_TAX_PERCENT, source: "fallbackPercent" };
  }

  return { taxCodeRef: primary, ratePercent: rate, source: "resolved" };
}

// Pick any TaxRateRef.value from the TaxCode (_full) for TaxLineDetail.TaxRateRef
function pickAnyTaxRateId(taxCodeFull) {
  const details = taxCodeFull?.TaxRateList?.TaxRateDetail || [];
  const rid = details.find(d => d?.TaxRateRef?.value)?.TaxRateRef?.value;
  return rid || null;
}

// -------------------- CUSTOMER --------------------
async function findCustomerByName(displayName, tokens) {
  const data = await qboQuery(
    tokens,
    `select * from Customer where DisplayName='${displayName.replace(/'/g, "\\'")}'`
  );
  return data.QueryResponse.Customer?.[0] || null;
}

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
    previousTaxCode: PREV_QB_TAX_CODE || null,
    fallbackTaxPercent: FALLBACK_TAX_PERCENT,
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
      amount, // gross (tax-inclusive)
      receiptNumber,
      date,
      room,
      checkin,
      checkout,
      notes,
      taxCode,
      taxAgency,
      previousTaxCode, // optional override in request
    } = req.body;

    if (!name || !email || !amount || !date) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const grossAmount = parseFloat(amount);
    if (isNaN(grossAmount) || grossAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const tokens = await getAccessToken();
    const itemRef = await ensureItemRef(tokens);

    // Resolve tax code and rate with fallbacks
    const taxCtx = await resolveTaxContext(tokens, { taxCode, taxAgency, previousTaxCode });
    const taxCodeRef = taxCtx.taxCodeRef;
    const combinedRate = taxCtx.ratePercent;

    // Compute inclusive net/tax
    const rawNet = grossAmount / (1 + combinedRate / 100);
    const netAmount = +rawNet.toFixed(2);
    const taxAmount = +(grossAmount - netAmount).toFixed(2);

    const taxRateId = pickAnyTaxRateId(taxCodeRef._full);

    log("Inclusive calc:", {
      grossAmount,
      combinedRate,
      netAmount,
      taxAmount,
      taxCodeId: taxCodeRef.value,
      taxCodeName: taxCodeRef._full?.Name || null,
      taxRateId,
      source: taxCtx.source,
    });

    // Resolve/create customer
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

    const desc = [
      `Room: ${room || "-"}`,
      `Check-in: ${checkin || "-"}`,
      `Check-out: ${checkout || "-"}`,
      `Includes VAT @ ${combinedRate.toFixed(2)}% on EC$${netAmount.toFixed(2)} = EC$${taxAmount.toFixed(2)}`
    ].join(" | ");

    // Strict inclusive payload: net line amount, explicit tax line with required fields
    const baseReceipt = {
      CustomerRef: { value: customerId },
      TxnDate: date,
      PrivateNote: notes || "",
      GlobalTaxCalculation: "TaxInclusive",
      TxnTaxDetail: {
        TxnTaxCodeRef: { value: taxCodeRef.value },
        TotalTax: taxAmount,
        TaxLine: [
          {
            Amount: taxAmount,
            DetailType: "TaxLineDetail",
            TaxLineDetail: {
              PercentBased: true,
              TaxPercent: combinedRate,      // e.g., 10
              NetAmountTaxable: netAmount,   // e.g., 136.36
              TaxRateRef: taxRateId ? { value: taxRateId } : undefined,
            },
          },
        ],
      },
      Line: [
        {
          Amount: netAmount, // NET amount
          DetailType: "SalesItemLineDetail",
          Description: desc,
          SalesItemLineDetail: {
            ItemRef: itemRef,
            TaxCodeRef: { value: taxCodeRef.value },
            TaxInclusiveAmt: grossAmount, // GROSS (helps UI)
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

    let createResp;
    try {
      createResp = await createSalesReceipt(payload);
    } catch (err) {
      const detail = err.response?.data;
      const msg = JSON.stringify(detail || err);
      if (payload.DocNumber && /DocNumber|Duplicate|duplicate/i.test(msg)) {
        try {
          const retryPayload = { ...baseReceipt }; // without DocNumber
          createResp = await createSalesReceipt(retryPayload);
        } catch (retryErr) {
          log("Retry without DocNumber failed:", retryErr.response?.data || retryErr);
          throw retryErr;
        }
      } else {
        log("Create SalesReceipt failed:", detail || err);
        throw err;
      }
    }

    const receiptId = createResp.data.SalesReceipt.Id;

    // Fetch stored receipt to confirm
    let fetched = null;
    try {
      const fetchUrl = `${API_BASE}${tokens.realmId}/salesreceipt/${receiptId}`;
      const fetchResp = await axios.get(fetchUrl, { headers });
      fetched = fetchResp.data?.SalesReceipt || null;
      log("Fetched stored receipt:", JSON.stringify(fetched || {}, null, 2));
    } catch (e) {
      log("Fetch after create failed (non-fatal):", e.response?.data || e);
    }

    res.json({
      success: true,
      receiptId,
      grossEntered: grossAmount.toFixed(2),
      netCalculated: netAmount.toFixed(2),
      taxCalculated: taxAmount.toFixed(2),
      taxRatePercent: combinedRate.toFixed(4),
      mode: "TaxInclusive",
      source: taxCtx.source,
      storedReceipt: fetched,
    });
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
