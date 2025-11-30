// index.js - QuickBooks backend (TaxCode by Name or Agency, helper endpoints)
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
const RAW_TAX_CODE = (process.env.QB_TAX_CODE || "").trim(); // TaxCode Name or Id (preferred)
const RAW_TAX_AGENCY = (process.env.QB_TAX_AGENCY || "").trim(); // Fallback: resolve code via agency name

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
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: "application/json",
    },
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
      try {
        fs.unlinkSync(TOKEN_PATH);
        log("tokens.json deleted due to invalid_grant");
      } catch {}
    }
    throw new Error("Token refresh failed.");
  }
}

// -------------------- ITEM HELPERS --------------------
async function findItemByName(tokens, name) {
  const data = await qboQuery(
    tokens,
    `select * from Item where Name='${name.replace(/'/g, "\\'")}'`
  );
  return data.QueryResponse.Item?.[0] || null;
}

async function findAnyIncomeAccount(tokens) {
  const data = await qboQuery(
    tokens,
    "select * from Account where AccountType='Income' maxresults 50"
  );
  return (data.QueryResponse.Account || [])[0] || null;
}

async function ensureItemRef(tokens) {
  if (process.env.ITEM_REF_ID) {
    return { value: String(process.env.ITEM_REF_ID), name: DEFAULT_ITEM_NAME };
  }

  let item = await findItemByName(tokens, DEFAULT_ITEM_NAME);
  if (item) return { value: item.Id, name: item.Name };

  if (!ALLOW_ITEM_CREATE) {
    throw new Error(
      `Item '${DEFAULT_ITEM_NAME}' not found and ALLOW_ITEM_CREATE=false`
    );
  }

  const incomeAccount = await findAnyIncomeAccount(tokens);
  if (!incomeAccount) {
    throw new Error("No Income account found to attach new Item.");
  }

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
// Simple in-memory cache to reduce repeated lookups during runtime
const taxCache = {
  byNameOrId: new Map(), // key: RAW_TAX_CODE value -> { value: TaxCodeId }
  byAgency: new Map(), // key: RAW_TAX_AGENCY value -> { value: TaxCodeId }
};

async function resolveTaxCodeByCode(tokens) {
  if (!RAW_TAX_CODE) return null;
  if (taxCache.byNameOrId.has(RAW_TAX_CODE)) return taxCache.byNameOrId.get(RAW_TAX_CODE);

  // If looks like id (numbers or uuid), accept as-is
  if (/^[0-9a-fA-F-]+$/.test(RAW_TAX_CODE)) {
    const ref = { value: RAW_TAX_CODE };
    taxCache.byNameOrId.set(RAW_TAX_CODE, ref);
    return ref;
  }

  // Else treat as Name
  const safeName = RAW_TAX_CODE.replace(/'/g, "\\'");
  const data = await qboQuery(tokens, `select * from TaxCode where Name='${safeName}'`);
  const tc = data.QueryResponse.TaxCode?.[0];
  if (!tc) {
    throw new Error(`TaxCode '${RAW_TAX_CODE}' not found. Set QB_TAX_CODE to an existing Id or exact Name.`);
  }
  const ref = { value: tc.Id };
  taxCache.byNameOrId.set(RAW_TAX_CODE, ref);
  return ref;
}

async function resolveTaxCodeByAgency(tokens) {
  if (!RAW_TAX_AGENCY) return null;
  if (taxCache.byAgency.has(RAW_TAX_AGENCY)) return taxCache.byAgency.get(RAW_TAX_AGENCY);

  // 1) Get active TaxCodes (limit to a reasonable number)
  const codesData = await qboQuery(tokens, "select * from TaxCode where Active = true maxresults 500");
  const codes = codesData.QueryResponse.TaxCode || [];

  // Collect all TaxRateRef Ids referenced by these codes
  const rateIds = new Set();
  for (const code of codes) {
    const details = code.TaxRateList?.TaxRateDetail || [];
    details.forEach(d => {
      const id = d?.TaxRateRef?.value;
      if (id) rateIds.add(id);
    });
  }
  if (rateIds.size === 0) throw new Error(`No TaxRates referenced by active TaxCodes.`);

  // 2) Build a map rateId -> agencyName
  const rateIdToAgency = new Map();
  for (const rateId of rateIds) {
    const rateData = await qboQuery(tokens, `select * from TaxRate where Id = '${rateId}'`);
    const rate = rateData.QueryResponse.TaxRate?.[0];
    // AgencyRef may be nested; protect with optional chaining
    const agencyName = rate?.AgencyRef?.name || rate?.AgencyRef?.Name || null;
    if (agencyName) {
      rateIdToAgency.set(rateId, agencyName);
    }
  }

  // 3) Find a TaxCode that uses a rate with the desired agency name
  const wanted = RAW_TAX_AGENCY.toLowerCase();
  for (const code of codes) {
    const details = code.TaxRateList?.TaxRateDetail || [];
    const match = details.some(d => {
      const rid = d?.TaxRateRef?.value;
      const agency = rid ? rateIdToAgency.get(rid) : null;
      return agency && agency.toLowerCase() === wanted;
    });
    if (match) {
      const ref = { value: code.Id };
      taxCache.byAgency.set(RAW_TAX_AGENCY, ref);
      return ref;
    }
  }

  throw new Error(`No TaxCode found for Tax Agency '${RAW_TAX_AGENCY}'. Set QB_TAX_CODE to a known TaxCode Name/Id or verify the agency name.`);
}

async function resolveTaxCodeRef(tokens) {
  // Prefer explicit TaxCode (Name or Id)
  if (RAW_TAX_CODE) {
    return await resolveTaxCodeByCode(tokens);
  }
  // Else resolve by agency name if provided
  if (RAW_TAX_AGENCY) {
    return await resolveTaxCodeByAgency(tokens);
  }
  // Nothing provided => fail with message
  throw new Error("No tax configured. Set QB_TAX_CODE to TaxCode Name/Id or QB_TAX_AGENCY to an Agency Name.");
}

// -------------------- CUSTOMER --------------------
async function findCustomerByName(displayName, tokens) {
  const data = await qboQuery(
    tokens,
    `select * from Customer where DisplayName='${displayName.replace(/'/g, "\\'")}'`
  );
  return data.QueryResponse.Customer?.[0] || null;
}

// -------------------- HELPER ENDPOINTS (discovery) --------------------
// List TaxCodes (Id, Name)
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

// List TaxRates with their AgencyRef names
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
    res
      .status(500)
      .send(`❌ Error: ${JSON.stringify(err.response?.data || err)}`);
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
    } = req.body;

    if (!name || !email || !amount || !date) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const tokens = await getAccessToken();
    const itemRef = await ensureItemRef(tokens);
    const taxCodeRef = await resolveTaxCodeRef(tokens);

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

    const baseReceipt = {
      CustomerRef: { value: customerId },
      TxnDate: date, // yyyy-mm-dd
      PrivateNote: notes || "",
      Line: [
        {
          Amount: amount,
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
