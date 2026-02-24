/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLIMBARO GUEST HOUSE - QUICKBOOKS INTEGRATION BACKEND
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * @description Express.js backend server for QuickBooks payment integration.
 *              Handles OAuth authentication, sales receipts, and customer sync.
 * 
 * @version 2.0.0
 * @author Jahaziel
 * 
 * TABLE OF CONTENTS:
 * ──────────────────────────────────────────────────────────────────────────────
 * 1.  IMPORTS & INITIALIZATION
 * 2.  SECURITY MIDDLEWARE
 * 3.  INPUT SANITIZATION
 * 4.  CONFIGURATION
 * 5.  CORS SETUP
 * 6.  TOKEN MANAGEMENT
 * 7.  QUICKBOOKS API UTILITIES
 * 8.  TAX CODE RESOLUTION
 * 9.  CUSTOMER MANAGEMENT
 * 10. API ROUTES
 * 11. SERVER STARTUP
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: IMPORTS & INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

/** Simple console logger with timestamp */
const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/** Rate limiting - in-memory implementation */
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 300;      // max requests per window (increased for testing)

/**
 * Rate limiting middleware
 * Limits requests per IP address to prevent abuse
 */
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return next();
  }
  
  const record = rateLimitMap.get(ip);
  if (now - record.startTime > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return next();
  }
  
  record.count++;
  if (record.count > RATE_LIMIT_MAX) {
    // Include CORS headers for allowed origins only (so frontend can read error)
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  
  next();
}

// Cleanup old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now - record.startTime > RATE_LIMIT_WINDOW * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 300000);

/**
 * Security headers middleware
 * Sets various HTTP headers to enhance security
 */
function securityHeaders(req, res, next) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Enable XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content Security Policy
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
  // Strict Transport Security (HTTPS only)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Permissions Policy - restrict sensitive browser features
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()');
  // Prevent caching of sensitive responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: INPUT SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sanitize a string by removing potential HTML tags and limiting length
 * @param {string} str - Input string
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
function sanitizeString(str, maxLength = 500) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize and validate email address
 * @param {string} email - Email address to sanitize
 * @returns {string} Sanitized email or empty string if invalid
 */
function sanitizeEmail(email) {
  if (!email) return '';
  const cleaned = String(email).toLowerCase().trim().slice(0, 254);
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  return emailRegex.test(cleaned) ? cleaned : '';
}

/**
 * Sanitize phone number - allow only digits, spaces, +, -, ()
 * @param {string} phone - Phone number to sanitize
 * @returns {string} Sanitized phone number
 */
function sanitizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^\d\s+\-()]/g, '').trim().slice(0, 20);
}

/**
 * Sanitize and validate monetary amount
 * @param {*} amount - Amount to sanitize
 * @returns {number|null} Sanitized amount or null if invalid
 */
function sanitizeAmount(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num < 0 || num > 10000000) return null;
  return Math.round(num * 100) / 100;
}

/**
 * Sanitize and validate date string (YYYY-MM-DD format)
 * @param {string} dateStr - Date string to sanitize
 * @returns {string} Valid date string or empty string
 */
function sanitizeDate(dateStr) {
  if (!dateStr) return '';
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return dateStr;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 (CONTINUED): IP BLOCKING & SUSPICIOUS ACTIVITY TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

/** Set of blocked IP addresses */
const blockedIPs = new Set();

/** Map tracking suspicious activity by IP */
const suspiciousActivity = new Map();

/** Maximum suspicious score before IP is blocked */
const MAX_SUSPICIOUS_SCORE = 10;

/**
 * Track suspicious activity for an IP address
 * Blocks IP if score exceeds threshold
 * @param {string} ip - IP address
 * @param {number} score - Score to add (default: 1)
 * @returns {boolean} True if IP was blocked
 */
function trackSuspiciousActivity(ip, score = 1) {
  const current = suspiciousActivity.get(ip) || { score: 0, firstSeen: Date.now() };
  
  // Reset after 1 hour
  if (Date.now() - current.firstSeen > 3600000) {
    current.score = score;
    current.firstSeen = Date.now();
  } else {
    current.score += score;
  }
  
  suspiciousActivity.set(ip, current);
  
  if (current.score >= MAX_SUSPICIOUS_SCORE) {
    blockedIPs.add(ip);
    log(`[SECURITY] IP blocked due to suspicious activity: ${ip}`);
    return true;
  }
  return false;
}

/**
 * Middleware to block requests from banned IPs
 */
function ipBlockingMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  if (blockedIPs.has(ip)) {
    log(`[SECURITY] Blocked request from banned IP: ${ip}`);
    // Include CORS headers for allowed origins only (so frontend can read error)
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    return res.status(403).json({ error: 'Access denied' });
  }
  
  next();
}

/**
 * Middleware to validate incoming requests for attack patterns
 * Checks URL and request body for common attack signatures
 */
function validateRequestMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  // Check for suspicious headers
  const userAgent = req.headers['user-agent'] || '';
  if (!userAgent || userAgent.length < 10) {
    trackSuspiciousActivity(ip, 2);
  }
  
  // Check for common attack patterns in URL
  const url = req.originalUrl || req.url || '';
  const attackPatterns = [
    /\.\.\//, // Path traversal
    /<script/i, // XSS attempt
    /\bunion\b.*\bselect\b/i, // SQL injection
    /\bexec\b.*\bxp_/i, // SQL injection
    /\b(cmd|powershell|bash)\b/i, // Command injection
    /%00/, // Null byte injection
    /\.(php|asp|aspx|jsp|cgi)$/i // Probing for vulnerabilities
  ];
  
  for (const pattern of attackPatterns) {
    if (pattern.test(url)) {
      trackSuspiciousActivity(ip, 5);
      log(`[SECURITY] Attack pattern detected in URL from ${ip}: ${url.slice(0, 100)}`);
      return res.status(400).json({ error: 'Invalid request' });
    }
  }
  
  // Check request body for suspicious patterns if JSON
  if (req.body && typeof req.body === 'object') {
    const bodyStr = JSON.stringify(req.body);
    for (const pattern of attackPatterns) {
      if (pattern.test(bodyStr)) {
        trackSuspiciousActivity(ip, 5);
        log(`[SECURITY] Attack pattern detected in body from ${ip}`);
        return res.status(400).json({ error: 'Invalid request' });
      }
    }
  }
  
  next();
}

/**
 * Audit logging middleware
 * Logs request details and tracks failed requests for security monitoring
 */
function auditLogMiddleware(req, res, next) {
  const startTime = Date.now();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: ip,
      userAgent: (req.headers['user-agent'] || '').slice(0, 100)
    };
    
    // Log errors and suspicious responses
    if (res.statusCode >= 400) {
      log(`[AUDIT] ${logEntry.method} ${logEntry.path} - ${logEntry.status} (${logEntry.duration}) from ${ip}`);
      
      // Track failed requests
      if (res.statusCode === 401 || res.statusCode === 403) {
        trackSuspiciousActivity(ip, 2);
      }
    }
  });
  
  next();
}

// Apply security middleware stack
app.use(ipBlockingMiddleware);
app.use(rateLimit);
app.use(securityHeaders);
app.use(auditLogMiddleware);

// Body parser with size limit to prevent DoS attacks
app.use(express.json({ limit: '100kb' }));

// Apply request validation after body parsing
app.use(validateRequestMiddleware);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Environment (production/sandbox) */
const ENV = (process.env.ENVIRONMENT || "production").toLowerCase();

/** OAuth authorization base URL */
const AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";

/** OAuth token exchange URL */
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

/** QuickBooks API base URL (varies by environment) */
const API_BASE =
  ENV === "production"
    ? "https://quickbooks.api.intuit.com/v3/company/"
    : "https://sandbox-quickbooks.api.intuit.com/v3/company/";

/** OAuth scopes requested */
const SCOPES = [
  "com.intuit.quickbooks.accounting",
  "openid",
  "profile",
  "email",
  "phone",
  "address",
].join(" ");

/** Path to store OAuth tokens */
const TOKEN_PATH = path.join(__dirname, "tokens.json");

/** Path to store customer ID mappings */
const CUSTOMER_MAP_PATH = path.join(__dirname, "customers.json");

/** Cache for QuickBooks data to reduce API calls */
const qbCache = {
  itemRef: null,           // Cached item reference
  itemRefExpiry: 0,        // Cache expiry timestamp
  taxCodeRefs: new Map(),  // Cached tax code references by key
  taxCodeExpiry: 0,        // Cache expiry timestamp
  CACHE_TTL: 3600000       // 1 hour cache TTL
};

/** Default item name for sales receipts */
const DEFAULT_ITEM_NAME = process.env.ITEM_NAME || "Guest House Accommodation - Single Bed";

/** 
 * Item Reference ID for Sales - Guest House Accommodation
 * This ensures sales go to the correct income account in reports
 */
const ITEM_REF_ID = process.env.ITEM_REF_ID || "6";

/** 
 * Deposit Account ID for 003-Undeposited Funds Clearing
 * This is where sales receipt funds are deposited
 */
const DEPOSIT_ACCOUNT_ID = process.env.DEPOSIT_ACCOUNT_ID || "28";

/** Whether to auto-create items if not found */
const ALLOW_ITEM_CREATE =
  (process.env.ALLOW_ITEM_CREATE || "true").toLowerCase() === "true";

/** Tax code from environment (ID or name) */
const RAW_TAX_CODE = (process.env.QB_TAX_CODE || "").trim();

/** Tax agency from environment */
const RAW_TAX_AGENCY = (process.env.QB_TAX_AGENCY || "").trim();

/** 
 * Fallback VAT percent when QuickBooks returns 0% for your TaxCode
 * Used when TaxRateList is empty or rate is 0
 */
const FALLBACK_TAX_PERCENT = parseFloat(process.env.FALLBACK_TAX_PERCENT || "10");

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: CORS SETUP
// ═══════════════════════════════════════════════════════════════════════════════

/** Allowed CORS origins from environment or default */
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ||
  "https://r-system-33a06.web.app"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Configure CORS middleware
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

// Handle CORS preflight requests
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

// Add CORS headers to all responses
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: TOKEN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build OAuth authorization URL
 * @returns {string} Authorization URL
 * @throws {Error} If CLIENT_ID or REDIRECT_URI not configured
 */
/** Pending OAuth state tokens for CSRF validation */
const pendingOAuthStates = new Map();

function buildAuthUrl() {
  if (!process.env.CLIENT_ID || !process.env.REDIRECT_URI) {
    throw new Error("Missing CLIENT_ID or REDIRECT_URI");
  }
  const state = require('crypto').randomBytes(16).toString('hex');
  pendingOAuthStates.set(state, Date.now());
  // Clean up old states older than 10 minutes
  for (const [s, t] of pendingOAuthStates.entries()) {
    if (Date.now() - t > 600000) pendingOAuthStates.delete(s);
  }
  return (
    `${AUTH_BASE}?client_id=${process.env.CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
    `&response_type=code&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${state}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: QUICKBOOKS API UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execute a QuickBooks query
 * @param {Object} tokens - OAuth tokens with realmId
 * @param {string} q - Query string
 * @returns {Promise<Object>} Query response data
 */
async function qboQuery(tokens, q) {
  const url = `${API_BASE}${tokens.realmId}/query?query=${encodeURIComponent(q)}`;
  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
  });
  return resp.data;
}

/**
 * Get valid access token, refreshing if necessary
 * @returns {Promise<Object>} Valid tokens object
 * @throws {Error} If not authenticated or refresh fails
 */
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

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2), { mode: 0o600 });
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

/**
 * Find an item by name in QuickBooks
 * @param {Object} tokens - OAuth tokens
 * @param {string} name - Item name to search for
 * @returns {Promise<Object|null>} Item object or null if not found
 */
async function findItemByName(tokens, name) {
  const data = await qboQuery(tokens, `select * from Item where Name='${name.replace(/'/g, "\\'")}'`);
  return data.QueryResponse.Item?.[0] || null;
}

/**
 * Find any income account (used for creating new items)
 * @param {Object} tokens - OAuth tokens
 * @returns {Promise<Object|null>} First income account or null
 */
async function findAnyIncomeAccount(tokens) {
  const data = await qboQuery(tokens, "select * from Account where AccountType='Income' maxresults 50");
  return (data.QueryResponse.Account || [])[0] || null;
}

/**
 * Ensure an item reference exists (find or create)
 * Uses caching to reduce QuickBooks API calls
 * @param {Object} tokens - OAuth tokens
 * @returns {Promise<Object>} Item reference {value, name}
 * @throws {Error} If item not found and creation not allowed
 */
async function ensureItemRef(tokens) {
  // Always use the configured ITEM_REF_ID (default: 6 for Sales - Guest House Accommodation)
  // This ensures sales receipts are categorized correctly in P&L reports
  log(`Using Item ID: ${ITEM_REF_ID} for sales receipts`);
  return { value: String(ITEM_REF_ID), name: DEFAULT_ITEM_NAME };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: TAX CODE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch a TaxCode by its ID
 * @param {Object} tokens - OAuth tokens
 * @param {string} id - TaxCode ID
 * @returns {Promise<Object|null>} TaxCode object or null
 */
async function fetchTaxCodeById(tokens, id) {
  const data = await qboQuery(tokens, `select * from TaxCode where Id='${String(id)}'`);
  return data.QueryResponse.TaxCode?.[0] || null;
}

/**
 * Resolve a TaxCode reference by code, agency, or environment config
 * Searches by ID, name, or tax agency association
 * Uses caching to reduce QuickBooks API calls
 * @param {Object} tokens - OAuth tokens
 * @param {Object} options - {taxCode, taxAgency} optional overrides
 * @returns {Promise<Object>} TaxCode reference with _full property
 * @throws {Error} If no matching TaxCode found
 */
async function resolveTaxCodeRef(tokens, { taxCode, taxAgency } = {}) {
  // Build cache key from parameters
  const cacheKey = `${taxCode || ''}_${taxAgency || ''}_${RAW_TAX_CODE}_${RAW_TAX_AGENCY}`;
  
  // Return cached tax code if still valid
  if (qbCache.taxCodeRefs.has(cacheKey) && Date.now() < qbCache.taxCodeExpiry) {
    log("Using cached taxCodeRef");
    return qbCache.taxCodeRefs.get(cacheKey);
  }
  
  let ref = null;

  const resolveByAgency = async (agencyRaw) => {
    const raw = agencyRaw.trim();
    const wanted = raw.toLowerCase().replace(/@.*$/g, "").replace(/[^a-z0-9]+/g, " ").trim();
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
      const agency = (rate?.AgencyRef?.name || rate?.AgencyRef?.Name || "")
        .toLowerCase().replace(/@.*$/g, "").replace(/[^a-z0-9]+/g, " ").trim();
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
      const safeName = taxCode.replace(/'/g, "\\'");
      const data = await qboQuery(tokens, `select * from TaxCode where Name='${safeName}'`);
      const tc = data.QueryResponse.TaxCode?.[0];
      if (!tc) throw new Error(`TaxCode '${taxCode}' not found.`);
      ref = { value: tc.Id, _full: tc };
    }
  } else if (taxAgency) {
    ref = await resolveByAgency(taxAgency);
  } else if (RAW_TAX_CODE) {
    if (/^[0-9a-fA-F-]+$/.test(RAW_TAX_CODE)) {
      const tc = await fetchTaxCodeById(tokens, RAW_TAX_CODE);
      if (!tc) throw new Error(`TaxCode Id '${RAW_TAX_CODE}' not found.`);
      ref = { value: tc.Id, _full: tc };
    } else {
      const safeName = RAW_TAX_CODE.replace(/'/g, "\\'");
      const data = await qboQuery(tokens, `select * from TaxCode where Name='${safeName}'`);
      const tc = data.QueryResponse.TaxCode?.[0];
      if (!tc) throw new Error(`TaxCode '${RAW_TAX_CODE}' not found.`);
      ref = { value: tc.Id, _full: tc };
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

  // Cache the resolved tax code
  qbCache.taxCodeRefs.set(cacheKey, ref);
  qbCache.taxCodeExpiry = Date.now() + qbCache.CACHE_TTL;
  
  return ref;
}

/**
 * Extract combined tax rate from a TaxCode's TaxRateList
 * @param {Object} taxCodeFull - Full TaxCode object with TaxRateList
 * @returns {number} Combined tax rate percentage
 */
function extractCombinedRate(taxCodeFull) {
  if (!taxCodeFull?.TaxRateList?.TaxRateDetail) return 0;
  return taxCodeFull.TaxRateList.TaxRateDetail.reduce((sum, d) => {
    const rate = parseFloat(d.RateValue ?? 0);
    return sum + (isNaN(rate) ? 0 : rate);
  }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: CUSTOMER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find a customer by display name in QuickBooks
 * @param {string} displayName - Customer display name
 * @param {Object} tokens - OAuth tokens
 * @returns {Promise<Object|null>} Customer object or null
 */
async function findCustomerByName(displayName, tokens) {
  const data = await qboQuery(tokens, `select * from Customer where DisplayName='${displayName.replace(/'/g, "\\'")}'`);
  return data.QueryResponse.Customer?.[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Health check endpoint
 * Returns server status and configuration info
 */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    env: ENV,
    timestamp: new Date().toISOString()
  });
});

/**
 * Debug endpoint to list all QuickBooks accounts
 * Use this to find the correct Account ID for DepositToAccountRef
 * Protected: requires ?key= query parameter matching DEBUG_KEY env var
 */
app.get("/debug/accounts", async (req, res) => {
  const debugKey = process.env.DEBUG_KEY;
  if (!debugKey || req.query.key !== debugKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const tokens = await getAccessToken();
    const data = await qboQuery(tokens, "SELECT * FROM Account WHERE AccountType IN ('Bank', 'Other Current Asset') MAXRESULTS 100");
    const accounts = data.QueryResponse.Account || [];
    res.json({
      message: "Find your '003-Undeposited Funds Clearing' account and note its Id",
      accounts: accounts.map(a => ({
        id: a.Id,
        name: a.Name,
        fullyQualifiedName: a.FullyQualifiedName,
        accountType: a.AccountType,
        accountSubType: a.AccountSubType
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Debug endpoint to list all QuickBooks items
 * Use this to verify the Item ID for Sales - Guest House Accommodation
 * Protected: requires ?key= query parameter matching DEBUG_KEY env var
 */
app.get("/debug/items", async (req, res) => {
  const debugKey = process.env.DEBUG_KEY;
  if (!debugKey || req.query.key !== debugKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const tokens = await getAccessToken();
    const data = await qboQuery(tokens, "SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 100");
    const items = data.QueryResponse.Item || [];
    res.json({
      message: "Verify Item ID 6 is 'Sales - Guest House Accommodation'",
      currentItemRefId: ITEM_REF_ID,
      items: items.map(i => ({
        id: i.Id,
        name: i.Name,
        type: i.Type,
        incomeAccountRef: i.IncomeAccountRef
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * OAuth authorization page
 * Displays link to authorize with QuickBooks
 */
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

/**
 * OAuth callback handler
 * Exchanges authorization code for tokens and stores them
 */
app.get("/callback", async (req, res) => {
  const { code, realmId, state } = req.query;
  if (!code || !realmId)
    return res.status(400).send("Missing ?code or ?realmId");
  
  // CSRF validation: verify state parameter
  if (!state || !pendingOAuthStates.has(state)) {
    log('[SECURITY] OAuth callback with invalid state parameter');
    return res.status(403).send('Invalid or expired state parameter. Please try authorizing again.');
  }
  pendingOAuthStates.delete(state);
  
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

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
    log("QuickBooks Authorized.");
    res.send("✅ QuickBooks authorized successfully. You may close this tab.");
  } catch (err) {
    log('[ERROR] OAuth callback failed:', err.response?.data || err.message);
    res.status(500).send("❌ Authorization failed. Please try again.");
  }
});

/**
 * Check token status
 * Returns whether user is authenticated with QuickBooks
 */
app.get("/check-token", (_req, res) => {
  const loggedIn = fs.existsSync(TOKEN_PATH);
  try {
    res.json({ loggedIn, authUrl: loggedIn ? null : buildAuthUrl() });
  } catch (e) {
    res.status(500).json({ loggedIn: false, error: e.message });
  }
});

/**
 * Main payment processing endpoint
 * Creates a sales receipt in QuickBooks with tax-inclusive calculations
 * 
 * Required fields: name, amount, date
 * Optional fields: email, phone, address, customerNumber, receiptNumber,
 *                  room, checkin, checkout, notes, method, taxCode, taxAgency
 */
app.post("/payment-to-quickbooks", async (req, res) => {
  try {
    // Extract and sanitize all inputs
    const rawBody = req.body || {};
    
    const name = sanitizeString(rawBody.name, 200);
    const email = sanitizeEmail(rawBody.email);
    const phone = sanitizePhone(rawBody.phone);
    const address = sanitizeString(rawBody.address, 500);
    const customerNumber = sanitizeString(rawBody.customerNumber, 50);
    const amount = sanitizeAmount(rawBody.amount);
    const receiptNumber = sanitizeString(rawBody.receiptNumber, 50);
    const date = sanitizeDate(rawBody.date);
    const room = sanitizeString(rawBody.room, 20);
    const checkin = sanitizeDate(rawBody.checkin);
    const checkout = sanitizeDate(rawBody.checkout);
    const notes = sanitizeString(rawBody.notes, 1000);
    const method = sanitizeString(rawBody.method, 50);
    const taxCode = sanitizeString(rawBody.taxCode, 50);
    const taxAgency = sanitizeString(rawBody.taxAgency, 100);

    // Log receipt number for debugging
    log(`QuickBooks payment request - Name: ${name}, Amount: ${amount}, Receipt#: ${receiptNumber || 'NOT PROVIDED'}`);

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (amount === null || amount <= 0) {
      return res.status(400).json({ error: "Valid amount is required" });
    }
    if (!date) {
      return res.status(400).json({ error: "Valid date is required" });
    }

    const grossAmount = amount;

    const tokens = await getAccessToken();
    const itemRef = await ensureItemRef(tokens);
    const taxCodeRef = await resolveTaxCodeRef(tokens, { taxCode, taxAgency });
    const taxCodeFull = taxCodeRef._full;

    // If QBO returns 0% combined rate for your TaxCode, fall back to a configured percent
    const combinedRateRaw = extractCombinedRate(taxCodeFull); // could be 0 if code has no TaxRateList
    const combinedRate = combinedRateRaw > 0 ? combinedRateRaw : FALLBACK_TAX_PERCENT;

    // Compute net & tax from gross inclusive
    const rawNet = grossAmount / (1 + combinedRate / 100);
    const netAmount = +rawNet.toFixed(2);
    const taxAmount = +(grossAmount - netAmount).toFixed(2);

    log("Inclusive calc:", {
      grossAmount,
      combinedRateRaw,
      combinedRate,
      netAmount,
      taxAmount,
      taxCodeId: taxCodeRef.value,
      taxCodeName: taxCodeFull?.Name || null,
    });

    // Customer lookup/create
    let map = fs.existsSync(CUSTOMER_MAP_PATH)
      ? JSON.parse(fs.readFileSync(CUSTOMER_MAP_PATH, "utf8"))
      : {};
    const key = `${name}_${email || "noemail"}`.toLowerCase();
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
            PrimaryEmailAddr: email ? { Address: email } : undefined,
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
      `Payment: ${method ? method.charAt(0).toUpperCase() + method.slice(1) : "N/A"}`,
      `Includes VAT @ ${combinedRate.toFixed(2)}% on EC$${netAmount.toFixed(2)} = EC$${taxAmount.toFixed(2)}`
    ].join(" | ");

    // STRICT INCLUSIVE FIX:
    // - Store net in Amount (so future edits don't re-add tax to gross)
    // - Provide TaxInclusiveAmt with gross
    // - GlobalTaxCalculation: TaxInclusive
    // - Provide TotalTax so QBO doesn't add on top
    // - DepositToAccountRef: Deposit to 003-Undeposited Funds Clearing
    const baseReceipt = {
      CustomerRef: { value: customerId },
      TxnDate: date,
      PrivateNote: notes || "",
      GlobalTaxCalculation: "TaxInclusive",
      DepositToAccountRef: { value: DEPOSIT_ACCOUNT_ID },  // 003-Undeposited Funds Clearing
      TxnTaxDetail: {
        TxnTaxCodeRef: { value: taxCodeRef.value },
        TotalTax: taxAmount,
      },
      Line: [
        {
          Amount: netAmount, // NET
          DetailType: "SalesItemLineDetail",
          Description: desc,
          SalesItemLineDetail: {
            ItemRef: itemRef,
            TaxCodeRef: { value: taxCodeRef.value },
            TaxInclusiveAmt: grossAmount, // GROSS
          },
        },
      ],
    };

    let payload = { ...baseReceipt };
    // Always include DocNumber - use receiptNumber or generate a unique one
    const docNumber = receiptNumber || `AUTO-${Date.now()}`;
    payload.DocNumber = String(docNumber);

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
        // Log the duplicate but don't modify the receipt number
        log(`Duplicate DocNumber detected for: ${payload.DocNumber} - this may already exist in QuickBooks`);
        // Return success with a note that it may already exist
        return res.json({
          success: true,
          receiptId: 'existing',
          docNumber: payload.DocNumber,
          grossEntered: grossAmount.toFixed(2),
          netCalculated: netAmount.toFixed(2),
          taxCalculated: taxAmount.toFixed(2),
          taxRatePercent: combinedRate.toFixed(4),
          mode: "TaxInclusive",
          note: "Receipt may already exist in QuickBooks"
        });
      } else {
        throw err;
      }
    }

    const receiptId = createResp.data.SalesReceipt.Id;
    const finalDocNumber = createResp.data.SalesReceipt.DocNumber || 'N/A';

    // Note: Removed fetch after create to reduce QuickBooks API calls
    // The create response already contains the receipt data we need
    
    log(`QuickBooks receipt created - ID: ${receiptId}, DocNumber: ${finalDocNumber}`);

    res.json({
      success: true,
      receiptId,
      docNumber: finalDocNumber,
      grossEntered: grossAmount.toFixed(2),
      netCalculated: netAmount.toFixed(2),
      taxCalculated: taxAmount.toFixed(2),
      taxRatePercent: combinedRate.toFixed(4),
      mode: "TaxInclusive"
    });
  } catch (err) {
    // Log full error with deep inspection to see nested objects
    const errorData = err.response?.data;
    log("QuickBooks Error (full):", JSON.stringify(errorData, null, 2));
    
    // Log specific Fault details if present
    if (errorData?.Fault?.Error) {
      errorData.Fault.Error.forEach((e, i) => {
        log(`QuickBooks Fault Error ${i + 1}:`, JSON.stringify(e, null, 2));
      });
    }
    
    // Determine appropriate user-facing error message
    let userMessage = "Failed to process payment. Please try again.";
    const errStr = JSON.stringify(errorData || err.message || '');
    
    if (errStr.includes('invalid_grant') || errStr.includes('Token')) {
      userMessage = "Authentication expired. Please re-authorize QuickBooks.";
    } else if (errStr.includes('Duplicate') || errStr.includes('DocNumber')) {
      userMessage = "Receipt number already exists. A new one will be generated.";
    } else if (errStr.includes('Customer')) {
      userMessage = "Error with customer record. Please check customer details.";
    } else if (errStr.includes('Invalid Reference Id') || errStr.includes('ItemRef') || errStr.includes('DepositToAccountRef')) {
      userMessage = "Invalid item or account reference. Check ITEM_REF_ID and DEPOSIT_ACCOUNT_ID configuration.";
    }
    
    res.status(500).json({
      error: userMessage,
      debug: errorData?.Fault?.Error?.[0]?.Detail || null
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: SERVER STARTUP
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  log(`🚀 Server running on port ${PORT} in ${ENV} mode`);
  try {
    log("Authorize URL:", buildAuthUrl());
  } catch {}
});



