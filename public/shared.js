// @ts-nocheck
/**
 * shared.js - Common Firebase init, auth, and utilities for all pages.
 * Imported as an ES module by availability.js and reports.js.
 * main1.js is self-contained and does NOT import this file.
 */

import { initializeApp }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Firebase ─────────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCFc_jLIEOQ9iwFeDnjQJTjHYSNQVKwfWo",
  authDomain:        "r-system-33a06.firebaseapp.com",
  projectId:         "r-system-33a06",
  storageBucket:     "r-system-33a06.firebasestorage.app",
  messagingSenderId: "317536373984",
  appId:             "1:317536373984:web:01c4aa68bf0da885e45485"
};

const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── Auth guard ───────────────────────────────────────────────────────────────
/**
 * Verifies that a user is signed in.
 * If not, redirects to login.html.
 * Returns a Promise that resolves to the Firebase user object on success.
 */
function requireAuth() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.location.href = 'login.html';
      reject(new Error('Auth timeout'));
    }, 5000);

    const unsub = onAuthStateChanged(auth, user => {
      clearTimeout(timer);
      unsub();
      if (!user) {
        window.location.href = 'login.html';
        reject(new Error('Not authenticated'));
      } else {
        resolve(user);
      }
    });
  });
}

// ─── Theme ────────────────────────────────────────────────────────────────────
/** Apply saved theme from localStorage on page load. */
function applyTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', saved);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = saved === 'dark' ? 'light_mode' : 'dark_mode';
}

/** Toggle between light and dark, persisted to localStorage. */
function toggleTheme() {
  const current = document.body.getAttribute('data-theme') || 'light';
  const next    = current === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = next === 'dark' ? 'light_mode' : 'dark_mode';
}

// ─── Date utilities ───────────────────────────────────────────────────────────
/** Format a YYYY-MM-DD string or Date as DD/MM/YYYY. */
function formatDateDMY(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  if (isNaN(d.getTime())) return String(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Return YYYY-MM-DD for today in local time. */
function getTodayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

/** Calculate nights between two YYYY-MM-DD strings. Minimum 1. */
function calculateSpecialNights(arrival, departure) {
  const a = new Date(arrival);
  const b = new Date(departure);
  return Math.max(1, Math.ceil((b - a) / 86400000));
}

/** Build an array of YYYY-MM-DD strings from start to end inclusive. */
function getDateRange(start, end) {
  const dates = [];
  const cur   = new Date(start + 'T00:00:00');
  const fin   = new Date(end   + 'T00:00:00');
  while (cur <= fin) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ─── HTML escape ──────────────────────────────────────────────────────────────
const HTML_ESCAPE_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#39;", '`':'&#96;', '=':'&#61;', '/':'&#47;' };
function escapeHTML(str) {
  if (typeof str !== 'string') return str ?? '';
  return str.replace(/[&<>"'`=/]/g, c => HTML_ESCAPE_MAP[c]);
}

// ─── Status utilities ─────────────────────────────────────────────────────────
const StatusUtils = {
  formatCheckStatus(reservation) {
    const today = getTodayISO();
    if (reservation.checkedOut) {
      const t = reservation.checkedOutAt
        ? new Date(reservation.checkedOutAt).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
        : '';
      return { text: 'Checked Out' + (t ? ' ' + t : ''), color: '#6b7280' };
    }
    if (reservation.checkedIn) {
      const t = reservation.checkedInAt
        ? new Date(reservation.checkedInAt).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
        : '';
      return { text: 'Checked In' + (t ? ' ' + t : ''), color: '#10b981' };
    }
    if (reservation.arrivalDate && reservation.arrivalDate <= today) {
      return { text: 'Pending Check-In', color: '#f59e0b' };
    }
    return { text: 'Pending', color: '#94a3b8' };
  }
};

// ─── Data loaders ─────────────────────────────────────────────────────────────
/** Load all reservations from Firestore. */
async function loadReservations() {
  const snap = await getDocs(collection(db, 'reservations'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Load all customers from Firestore. */
async function loadCustomers() {
  const snap = await getDocs(collection(db, 'customers'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Load all non-voided payments from Firestore. */
async function loadValidPayments() {
  const snap = await getDocs(collection(db, 'payments'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => !p.voided && p.qbSyncStatus !== 'voided' && p.status !== 'voided');
}

// ─── Spinner helpers ──────────────────────────────────────────────────────────
function showSpinner(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}
function hideSpinner(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ─── Toast notification ───────────────────────────────────────────────────────
function showToast(message, type = 'info', durationMs = 3500) {
  const existing = document.getElementById('shared-toast');
  if (existing) existing.remove();

  const colors = { info: '#3b82f6', success: '#10b981', warning: '#f59e0b', error: '#ef4444' };
  const toast  = document.createElement('div');
  toast.id     = 'shared-toast';
  toast.setAttribute('role', 'status');
  toast.style.cssText = [
    'position:fixed', 'bottom:24px', 'right:24px', 'z-index:9999',
    'padding:12px 20px', 'border-radius:8px', 'font-size:14px',
    'font-family:Inter,system-ui,sans-serif', 'color:#fff',
    `background:${colors[type] || colors.info}`,
    'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
    'max-width:360px', 'word-break:break-word'
  ].join(';');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}

// ─── CSV export ───────────────────────────────────────────────────────────────
/**
 * Export a plain HTML table element to a downloadable CSV file.
 * @param {HTMLTableElement} tableEl
 * @param {string} filename
 */
function exportTableToCSV(tableEl, filename) {
  if (!tableEl) return;
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  const csv  = rows.map(row => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    return cells.map(cell => {
      let text = cell.innerText.replace(/\s+/g, ' ').trim();
      // Wrap in quotes if it contains commas, quotes, or newlines
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    }).join(',');
  }).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export {
  db,
  auth,
  collection,
  getDocs,
  requireAuth,
  applyTheme,
  toggleTheme,
  formatDateDMY,
  getTodayISO,
  calculateSpecialNights,
  getDateRange,
  escapeHTML,
  StatusUtils,
  loadReservations,
  loadCustomers,
  loadValidPayments,
  showSpinner,
  hideSpinner,
  showToast,
  exportTableToCSV
};
