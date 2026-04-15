// @ts-nocheck

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                 GLIMBARO GUEST HOUSE - RESERVATION SYSTEM                     ║
 * ║                          Main Application (v2.1.0)                            ║
 * ╠═══════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                               ║
 * ║  DESCRIPTION:                                                                 ║
 * ║  Complete frontend application for managing guesthouse operations including   ║
 * ║  reservations, payments, customer management, and QuickBooks integration.     ║
 * ║                                                                               ║
 * ║  ARCHITECTURE OVERVIEW:                                                       ║
 * ║  ┌─────────────────────────────────────────────────────────────────────────┐ ║
 * ║  │  APP_CONFIG          - Centralized configuration & constants            │ ║
 * ║  │  ModalManager        - Unified modal open/close/toggle operations       │ ║
 * ║  │  ButtonManager       - Button state management (loading/disabled)       │ ║
 * ║  │  DateUtils           - Date formatting & manipulation utilities         │ ║
 * ║  │  SecurityUtils       - Input validation, sanitization, rate limiting    │ ║
 * ║  │  AuditLogger         - Action tracking for accountability               │ ║
 * ║  │  RealtimeSync        - Firebase listeners for live updates              │ ║
 * ║  │  PaymentManager      - Payment processing & QuickBooks sync             │ ║
 * ║  │  ReservationManager  - Reservation CRUD operations                      │ ║
 * ║  │  DashboardManager    - Room status display & statistics                 │ ║
 * ║  │  BatchCloseManager   - Shift reports & session history                  │ ║
 * ║  └─────────────────────────────────────────────────────────────────────────┘ ║
 * ║                                                                               ║
 * ║  TABLE OF CONTENTS:                                                           ║
 * ║  ─────────────────────────────────────────────────────────────────────────── ║
 * ║  Line ~100   : APP_CONFIG - Application-wide constants                       ║
 * ║  Line ~200   : CORE UTILITIES - Modal, Button, Date managers                 ║
 * ║  Line ~400   : FIREBASE SETUP - Authentication & database connection         ║
 * ║  Line ~600   : SECURITY - Session management, validation, audit logging      ║
 * ║  Line ~900   : QUICKBOOKS - API integration & sync queue                     ║
 * ║  Line ~1200  : REAL-TIME SYNC - Firebase listeners                           ║
 * ║  Line ~1500  : CUSTOMER MANAGEMENT - CRUD operations                         ║
 * ║  Line ~2000  : RESERVATION MANAGEMENT - Booking operations                   ║
 * ║  Line ~3500  : PAYMENT PROCESSING - Recording & receipts                     ║
 * ║  Line ~5000  : REPORTS - Batch close, audit logs, exports                    ║
 * ║  Line ~7000  : DASHBOARD - Room grid, stats, charts                          ║
 * ║  Line ~9000  : EVENT HANDLERS - UI interaction bindings                      ║
 * ║                                                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

// Firebase SDK imports - these let us talk to Google's Firebase service
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initializeApp as initializeFirebaseApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  runTransaction,
  enableIndexedDbPersistence,
  onSnapshot,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ╔═══════════════════════════════════════════════════════════════════════════════╗
   ║                    SECTION 1: APP CONFIGURATION                               ║
   ╚═══════════════════════════════════════════════════════════════════════════════╝ */

/**
 * APP_CONFIG - Centralized application constants
 * ─────────────────────────────────────────────────────────────────────────────────
 * All application-wide settings in one place for easy maintenance.
 * Changing values here affects the entire application.
 */
const APP_CONFIG = {
  // ─── Application Info ───────────────────────────────────────────────────────
  VERSION: '2.1.0',
  APP_NAME: 'Glimbaro Guest House',
  
  // ─── Room Configuration ─────────────────────────────────────────────────────
  ROOMS: {
    // Ground floor rooms (100 series)
    FLOOR_1: ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111'],
    // First floor rooms (200 series)
    FLOOR_2: ['201', '202', '203', '204', '205', '206', '207', '208', '209', '210'],
    // Room types: double rooms listed here, everything else is single
    DOUBLE: ['103', '107', '111', '205', '210'],
    // Helper methods
    get ALL() { return [...this.FLOOR_1, ...this.FLOOR_2]; },
    getType(room) { return this.DOUBLE.includes(room) ? 'double' : 'single'; },
    getByType(type) { return this.ALL.filter(r => this.getType(r) === type); }
  },
  
  // ─── Timing Configuration ───────────────────────────────────────────────────
  TIMING: {
    CHECK_IN_HOUR: 15,          // 3:00 PM
    CHECK_OUT_HOUR: 13,         // 1:00 PM
    SESSION_TIMEOUT_MS: 30 * 60 * 1000,  // 30 minutes
    TOKEN_REFRESH_MS: 30 * 60 * 1000,    // 30 minutes
    QB_CHECK_INTERVAL_MS: 30 * 60 * 1000, // 30 minutes
    DASHBOARD_UPDATE_DELAY: 300,  // 300ms debounce
    MIN_UPDATE_INTERVAL: 500      // Max 2 updates/second
  },
  
  // ─── Security Configuration ─────────────────────────────────────────────────
  SECURITY: {
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 minutes
    MAX_INPUT_LENGTH: 10000,
    AUDIT_LOG_RETENTION_DAYS: 90,
    SENSITIVE_FIELDS: ['password', 'token', 'secret', 'apiKey']
  },
  
  // ─── API Endpoints ──────────────────────────────────────────────────────────
  API: {
    BASE_URL: 'https://guesthouse-curl.onrender.com',
    ENDPOINTS: {
      CHECK_TOKEN: '/check-token',
      PAYMENT_TO_QB: '/payment-to-quickbooks',
      SEND_SMS: '/send-sms'
    }
  },
  
  // ─── Firebase Configuration ─────────────────────────────────────────────────
  FIREBASE: {
    apiKey: "AIzaSyCFc_jLIEOQ9iwFeDnjQJTjHYSNQVKwfWo",
    authDomain: "r-system-33a06.firebaseapp.com",
    projectId: "r-system-33a06",
    storageBucket: "r-system-33a06.firebasestorage.app",
    messagingSenderId: "317536373984",
    appId: "1:317536373984:web:01c4aa68bf0da885e45485"
  },
  
  // ─── Collections ────────────────────────────────────────────────────────────
  COLLECTIONS: {
    RESERVATIONS: 'reservations',
    PAYMENTS: 'payments',
    CUSTOMERS: 'customers',
    EMPLOYEES: 'employees',
    AUDIT_LOGS: 'audit_logs',
    BATCH_CLOSE_SESSIONS: 'batch_close_sessions',
    COUNTERS: 'counters',
    SETTINGS: 'settings'
  }
};

// Expose globally for debugging and external access
window.APP_CONFIG = APP_CONFIG;

/**
 * Debug Logger - Conditional logging based on DEBUG_MODE
 * ─────────────────────────────────────────────────────────────────────────────────
 * Set window.DEBUG_MODE = true in console to enable verbose logging
 */
const Logger = {
  debug: (...args) => { if (window.DEBUG_MODE) console.log(...args); },
  info: (...args) => { if (window.DEBUG_MODE) console.log('ℹ️', ...args); },
  success: (...args) => { if (window.DEBUG_MODE) console.log('✅', ...args); },
  warn: (...args) => console.warn(...args), // Warnings always show
  error: (...args) => console.error(...args) // Errors always show
};
window.Logger = Logger;

/* ╔═══════════════════════════════════════════════════════════════════════════════╗
   ║                    SECTION 2: UTILITY MANAGERS                                ║
   ╚═══════════════════════════════════════════════════════════════════════════════╝ */

/**
 * ModalManager - Unified modal open/close operations
 * ─────────────────────────────────────────────────────────────────────────────────
 * Provides consistent modal handling across the entire application.
 * 
 * USAGE:
 *   ModalManager.open('addReservationModal');
 *   ModalManager.close('addReservationModal');
 *   ModalManager.toggle('addReservationModal');
 *   ModalManager.closeAll();
 */
const ModalManager = {
  /**
   * Open a modal by ID
   * @param {string} modalId - The ID of the modal element
   * @param {Object} options - Optional settings { onOpen: callback, closePrevious: boolean }
   */
  open(modalId, options = {}) {
    if (options.closePrevious) {
      this.closeAll();
    }
    
    const modal = document.getElementById(modalId);
    if (!modal) {
      console.warn(`ModalManager: Modal '${modalId}' not found`);
      return false;
    }
    
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    
    // Focus first focusable element for accessibility
    const focusable = modal.querySelector('input, select, textarea, button:not(.close)');
    if (focusable) setTimeout(() => focusable.focus(), 100);
    
    if (options.onOpen) options.onOpen(modal);
    
    // Debug logging only in development
    if (window.DEBUG_MODE) console.log(`📦 Modal opened: ${modalId}`);
    return true;
  },
  
  /**
   * Close a modal by ID
   * @param {string} modalId - The ID of the modal element
   * @param {Object} options - Optional settings { onClose: callback }
   */
  close(modalId, options = {}) {
    const modal = document.getElementById(modalId);
    if (!modal) return false;
    
    // Blur focused element inside the modal before hiding (prevents aria-hidden warning)
    if (modal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    
    // Remove body class if no modals open
    if (!document.querySelector('.modal[style*="display: block"]')) {
      document.body.classList.remove('modal-open');
    }
    
    if (options.onClose) options.onClose(modal);
    
    if (window.DEBUG_MODE) console.log(`📦 Modal closed: ${modalId}`);
    return true;
  },
  
  /**
   * Toggle a modal open/close
   * @param {string} modalId - The ID of the modal element
   */
  toggle(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return false;
    
    return modal.style.display === 'block' ? this.close(modalId) : this.open(modalId);
  },
  
  /**
   * Close all open modals
   */
  closeAll() {
    document.querySelectorAll('.modal').forEach(modal => {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    });
    document.body.classList.remove('modal-open');
    if (window.DEBUG_MODE) console.log('📦 All modals closed');
  },
  
  /**
   * Check if a modal is currently open
   * @param {string} modalId - The ID of the modal element
   */
  isOpen(modalId) {
    const modal = document.getElementById(modalId);
    return modal && modal.style.display === 'block';
  }
};

// Expose globally
window.ModalManager = ModalManager;

// ═══════════════════════════════════════════════════════════════════════════════
// FORM SUBMIT PREVENTION - Prevent native form submission for modal forms
// ═══════════════════════════════════════════════════════════════════════════════
// The modal forms use novalidate + JS validation, so we prevent default submission.
document.querySelectorAll('.modal form[novalidate]').forEach(form => {
  form.addEventListener('submit', (e) => e.preventDefault());
});

// Clear input-error highlights when user starts typing
document.addEventListener('input', (e) => {
  if (e.target.classList.contains('input-error')) {
    e.target.classList.remove('input-error');
  }
});

/**
 * ButtonManager - Button state management with loading indicators
 * ─────────────────────────────────────────────────────────────────────────────────
 * Prevents button spam by disabling buttons during async operations.
 * 
 * USAGE:
 *   const restore = ButtonManager.setLoading('submitBtn', 'Processing...');
 *   await doAsyncWork();
 *   restore(); // Restores original state
 */
const ButtonManager = {
  // Store original button states
  _originalStates: new Map(),
  
  /**
   * Set a button to loading state
   * @param {string|HTMLElement} buttonOrId - Button element or ID
   * @param {string} loadingText - Text to show while loading (default: 'Processing...')
   * @returns {Function} Restore function to return button to original state
   */
  setLoading(buttonOrId, loadingText = 'Processing...') {
    const btn = typeof buttonOrId === 'string' 
      ? document.getElementById(buttonOrId) 
      : buttonOrId;
    
    if (!btn) return () => {};
    
    // Already loading? Return no-op
    if (btn.disabled && btn.dataset.loading === 'true') {
      return () => {};
    }
    
    // Store original state
    const id = btn.id || `btn_${Date.now()}`;
    this._originalStates.set(id, {
      text: btn.textContent,
      disabled: btn.disabled,
      className: btn.className
    });
    
    // Set loading state
    btn.disabled = true;
    btn.dataset.loading = 'true';
    btn.textContent = loadingText;
    btn.classList.add('btn-loading');
    
    // Return restore function
    return () => this.restore(btn, id);
  },
  
  /**
   * Restore button to original state
   * @param {HTMLElement} btn - The button element
   * @param {string} id - The stored state ID
   */
  restore(btn, id) {
    const original = this._originalStates.get(id);
    if (!original || !btn) return;
    
    btn.disabled = original.disabled;
    btn.textContent = original.text;
    btn.className = original.className;
    delete btn.dataset.loading;
    
    this._originalStates.delete(id);
  },
  
  /**
   * Disable a button (without loading state)
   * @param {string|HTMLElement} buttonOrId - Button element or ID
   */
  disable(buttonOrId) {
    const btn = typeof buttonOrId === 'string' 
      ? document.getElementById(buttonOrId) 
      : buttonOrId;
    if (btn) btn.disabled = true;
  },
  
  /**
   * Enable a button
   * @param {string|HTMLElement} buttonOrId - Button element or ID
   */
  enable(buttonOrId) {
    const btn = typeof buttonOrId === 'string' 
      ? document.getElementById(buttonOrId) 
      : buttonOrId;
    if (btn) btn.disabled = false;
  }
};

// Expose globally
window.ButtonManager = ButtonManager;

/**
 * StatusUtils - Unified status formatting
 * ─────────────────────────────────────────────────────────────────────────────────
 * Consistent status display across the entire application.
 */
const StatusUtils = {
  /**
   * Format payment status for display
   * @param {string} status - Internal status (fully_paid, partially_paid, not_paid, etc.)
   * @returns {object} { text: string, color: string, class: string }
   */
  formatPaymentStatus(status) {
    const statusMap = {
      'fully_paid': { text: 'Fully Paid', color: '#10b981', class: 'status-paid' },
      'paid': { text: 'Fully Paid', color: '#10b981', class: 'status-paid' },
      'partially_paid': { text: 'Partial', color: '#f59e0b', class: 'status-partial' },
      'not_paid': { text: 'Unpaid', color: '#ef4444', class: 'status-unpaid' },
      'unpaid': { text: 'Unpaid', color: '#ef4444', class: 'status-unpaid' },
      'reserved': { text: 'Reserved', color: '#8b5cf6', class: 'status-reserved' }
    };
    return statusMap[status] || { text: status || 'Unknown', color: '#6b7280', class: 'status-unknown' };
  },

  /**
   * Format check-in/out status for display
   * @param {object} reservation - Reservation object with checkedIn/checkedOut flags
   * @returns {object} { text: string, color: string }
   */
  formatCheckStatus(reservation) {
    if (reservation.checkedOut) {
      return { text: 'Checked Out', color: '#6b7280' };
    } else if (reservation.checkedIn || reservation.actualCheckInTime) {
      return { text: 'Checked In', color: '#10b981' };
    } else {
      return { text: 'Pending', color: '#f59e0b' };
    }
  },

  /**
   * Determine reservation status based on dates (future = reserved, current = active, past = completed)
   * @param {object} reservation - Reservation with arrivalDate and departureDate
   * @param {string} todayStr - Today's date in YYYY-MM-DD format
   * @returns {string} 'reserved' | 'active' | 'completed'
   */
  getReservationTimeStatus(reservation, todayStr) {
    if (!todayStr) {
      const now = new Date();
      todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
    if (reservation.arrivalDate > todayStr) {
      return 'reserved'; // Future reservation
    } else if (reservation.departureDate < todayStr) {
      return 'completed'; // Past reservation
    }
    return 'active'; // Current reservation
  },

  /**
   * Get display text for reservation time status
   * @param {object} reservation 
   * @param {string} todayStr 
   * @returns {object} { text: string, color: string, badge: string }
   */
  getReservationStatusDisplay(reservation, todayStr) {
    const timeStatus = this.getReservationTimeStatus(reservation, todayStr);
    if (timeStatus === 'reserved') {
      return { text: 'RESERVED', color: '#8b5cf6', badge: 'background:#ede9fe;color:#7c3aed;' };
    } else if (timeStatus === 'completed') {
      return { text: 'Completed', color: '#6b7280', badge: 'background:#f3f4f6;color:#4b5563;' };
    }
    // Active - use check-in status
    const checkStatus = this.formatCheckStatus(reservation);
    return { text: checkStatus.text, color: checkStatus.color, badge: '' };
  }
};

// Expose globally
window.StatusUtils = StatusUtils;

/**
 * DateUtils - Unified date formatting and manipulation
 * ─────────────────────────────────────────────────────────────────────────────────
 * All date operations in one place for consistency.
 */
const DateUtils = {
  /**
   * Get today's date as YYYY-MM-DD string
   * @returns {string} Date in YYYY-MM-DD format
   */
  getTodayISO() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  },
  
  /**
   * Format date as DD/MM/YYYY (display format)
   * @param {Date|string} date - Date to format
   * @returns {string} Formatted date string
   */
  formatDMY(date) {
    if (!date) return 'N/A';
    
    // Handle YYYY-MM-DD string format directly to avoid timezone issues
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [year, month, day] = date.split('-');
      return `${day}/${month}/${year}`;
    }
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  },
  
  /**
   * Format date with time as DD/MM/YYYY, HH:MM:SS AM/PM
   * @param {Date|string} date - Date to format
   * @returns {string} Formatted datetime string
   */
  formatDateTime(date) {
    if (!date) return 'N/A';
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    
    return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds} ${ampm}`;
  },
  
  /**
   * Format date with day name (e.g., "Mon 03/02/2026")
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @returns {string} Formatted string with day name
   */
  formatWithDay(dateStr) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date(dateStr + 'T00:00:00');
    return `${days[d.getDay()]} ${this.formatDMY(dateStr)}`;
  },
  
  /**
   * Calculate nights between two dates
   * @param {string} arrival - Arrival date (YYYY-MM-DD)
   * @param {string} departure - Departure date (YYYY-MM-DD)
   * @returns {number} Number of nights
   */
  calculateNights(arrival, departure) {
    const start = new Date(arrival);
    const end = new Date(departure);
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  },
  
  /**
   * Parse any timestamp format to ISO string
   * @param {*} timestamp - Firestore Timestamp, Date, or string
   * @returns {string|null} ISO string or null
   */
  normalizeTimestamp(timestamp) {
    if (!timestamp) return null;
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().toISOString();
    if (timestamp instanceof Date) return timestamp.toISOString();
    if (typeof timestamp === 'string') return timestamp;
    return null;
  }
};

// Expose globally
window.DateUtils = DateUtils;

/**
 * Sort comparator for payments: ascending by timestamp, then by receipt number as tiebreaker.
 * Handles Firestore Timestamp objects, ISO strings, Date objects, and null/undefined.
 */
function comparePaymentsByTime(a, b) {
  const tsA = DateUtils.normalizeTimestamp(a.timestamp);
  const tsB = DateUtils.normalizeTimestamp(b.timestamp);
  // Primary sort: by normalized timestamp (ISO string, lexicographically sortable)
  if (tsA && tsB && tsA !== tsB) return tsA < tsB ? -1 : 1;
  // Tiebreaker: by receipt number (ascending)
  const rA = a.receiptNumber || '';
  const rB = b.receiptNumber || '';
  if (rA !== rB) return rA < rB ? -1 : 1;
  return 0;
}

/**
 * Calculate the net total of balance adjustments (discounts, charges).
 */
function calcAdjustmentTotal(adjustments) {
  if (!adjustments || !adjustments.length) return 0;
  return adjustments.reduce((sum, adj) => {
    if (adj.type === 'daily_charge') return sum; // legacy — ignore
    return sum + (adj.type === 'discount' ? -adj.amount : adj.amount);
  }, 0);
}

/**
 * Calculate total credits from reservation.balanceCredits array.
 * Top-level so computeLivePaymentStatus can access it.
 */
function calcCreditTotal(credits) {
  if (!credits || !credits.length) return 0;
  return credits.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
}

/**
 * computeLivePaymentStatus — single source of truth for payment status.
 *
 * Always derives the status from the live payments cache instead of reading
 * the `paymentStatus` field that may be stale (e.g. after a rate-changing
 * extension that didn't update the field correctly).
 *
 * @param {Object} reservation
 * @returns {'fully_paid'|'partially_paid'|'unpaid'}
 */
function computeLivePaymentStatus(reservation) {
  if (!reservation) return 'unpaid';
  try {
    const start = new Date(reservation.arrivalDate);
    const end   = new Date(reservation.departureDate);
    const nights = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    const rate     = parseFloat(reservation.rate) || 0;
    const totalDue = rate * nights + calcAdjustmentTotal(reservation.balanceAdjustments);
    const actualPaid = (window._allPaymentsCache || [])
      .filter(p => p.reservationId === reservation.id && !p.voided)
      .reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const creditTotal = calcCreditTotal(reservation.balanceCredits);
    const totalPaid = actualPaid + creditTotal;
    if (totalDue <= 0) return totalPaid > 0 ? 'fully_paid' : 'unpaid';
    if (totalPaid >= totalDue) return 'fully_paid';
    if (totalPaid > 0) return 'partially_paid';
    return 'unpaid';
  } catch (err) {
    console.warn('computeLivePaymentStatus error for reservation', reservation.id, err);
    return reservation.paymentStatus || 'unpaid';
  }
}

/* ╔═══════════════════════════════════════════════════════════════════════════════╗
   ║                    SECTION 3: MAIN APPLICATION INIT                           ║
   ╚═══════════════════════════════════════════════════════════════════════════════╝ */

// Main application startup - everything runs inside this function
async function initializeApp() {
  // Prevent loading twice if page refreshes weird
  if (window.__MAIN1_LOADED__) return;
  window.__MAIN1_LOADED__ = true;

  // Force HTTPS for security (except on localhost for development)
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    location.href = 'https:' + location.href.substring(location.protocol.length);
    return;
  }

  // Use centralized config
  const API_BASE = APP_CONFIG.API.BASE_URL;
  const ALWAYS_SEND_CREDENTIALS = false;

  /* ═══════════════════════════════════════════════════════════════════════════
     FIREBASE CONFIGURATION
     Using centralized APP_CONFIG for consistency
     ═══════════════════════════════════════════════════════════════════════════ */
  const FIREBASE_CONFIG = APP_CONFIG.FIREBASE;

  // Initialize Firebase services
  const app = initializeFirebaseApp(FIREBASE_CONFIG);
  const db = getFirestore(app);  // Database connection
  const auth = getAuth(app);     // Authentication service

  // Enable offline mode - app works even without internet
  try {
    await enableIndexedDbPersistence(db);
  } catch (err) {
    if (err.code === 'failed-precondition') {
      console.warn("Offline persistence unavailable: multiple tabs open");
    } else if (err.code === 'unimplemented') {
      console.warn("Offline persistence unavailable: browser doesn't support it");
    }
  }

  // Helper: Get today's date as YYYY-MM-DD string (uses DateUtils)
  const getTodayLocal = () => DateUtils.getTodayISO();

  // Make Firebase available globally for debugging
  window._firebaseDb = db;
  window._firebaseAuth = auth;

  let currentEmployee = null;

  async function verifyAuthentication() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.warn("Auth check timeout - redirecting to login");
        window.location.href = 'login.html';
        reject(new Error('Auth timeout'));
      }, 3000);

      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        clearTimeout(timeout);
        unsubscribe(); // Only need one check, not continuous monitoring

        if (!user) {
          console.log("No authenticated user - redirecting to login");
          window.location.href = 'login.html';
          reject(new Error('Not authenticated'));
          return;
        }

        // Reject anonymous users (legacy feature we removed)
        // Only email/password authenticated employees allowed
        if (user.isAnonymous) {
          console.log("Anonymous user detected - redirecting to login");
          await auth.signOut();
          window.location.href = 'login.html';
          reject(new Error('Anonymous user not allowed'));
          return;
        }

        try {
          // Verify employee record exists and is active
          const employeeDoc = await getDoc(doc(db, 'employees', user.uid));
          
          if (!employeeDoc.exists()) {
            console.error("User not found in employees database");
            await auth.signOut();
            window.location.href = 'login.html';
            reject(new Error('Not an employee'));
            return;
          }

          const employeeData = employeeDoc.data();
          
          if (!employeeData.active) {
            console.error("Employee account is deactivated");
            await auth.signOut();
            alert('Your account has been deactivated. Please contact your manager.');
            window.location.href = 'login.html';
            reject(new Error('Account deactivated'));
            return;
          }

          // Store current employee data
          currentEmployee = {
            uid: user.uid,
            email: user.email,
            name: employeeData.name,
            role: employeeData.role,
            ...employeeData
          };

          // Expose for other parts of the app
          window._currentEmployee = currentEmployee;

          // Show the app content - remove loading overlay
          document.body.classList.add('authenticated');

          console.log('✅ User authenticated successfully');
          resolve(currentEmployee);

        } catch (err) {
          console.error("Error verifying employee:", err);
          await auth.signOut();
          window.location.href = 'login.html';
          reject(err);
        }
      });
    });
  }

  function setupTokenRefresh() {
    const REFRESH_INTERVAL = 30 * 60 * 1000;
    setInterval(async () => {
      const user = auth.currentUser;
      if (user) {
        try {
          await user.getIdToken(true); // Force refresh
          console.log("🔄 Auth token refreshed");
        } catch (err) {
          console.error("Failed to refresh token:", err);
          // If refresh fails, redirect to login
          window.location.href = 'login.html';
        }
      }
    }, REFRESH_INTERVAL);
  }

  /**
   * Logout handler
   */
  async function logout() {
    try {
      // Audit log
      if (currentEmployee) {
        await auditLog(AUDIT_ACTIONS.LOGOUT, {
          email: currentEmployee.email,
          name: currentEmployee.name
        });
      }

      await auth.signOut();
      sessionStorage.clear();
      window.location.href = 'login.html';
    } catch (err) {
      console.error("Logout error:", err);
      window.location.href = 'login.html';
    }
  }

  // Expose logout function
  window.logout = logout;

  try {
    await verifyAuthentication();
    setupTokenRefresh();
  } catch (authErr) {
    console.error("Authentication failed:", authErr);
    return;
  }

  // Legacy support
  function waitForSignedInUser() {
    return Promise.resolve(auth.currentUser);
  }
  window.waitForSignedInUser = waitForSignedInUser;

  function normalizeTimestamp(timestamp) {
    // Delegate to centralized DateUtils
    return DateUtils.normalizeTimestamp(timestamp);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DATE FORMATTING HELPERS
     ═══════════════════════════════════════════════════════════════════════════
     These wrapper functions use the centralized DateUtils.
     They are kept for backward compatibility with existing code.
     For new code, prefer using DateUtils directly:
       DateUtils.formatDMY(date)
       DateUtils.formatDateTime(date)
     ═══════════════════════════════════════════════════════════════════════════ */

  // Convert any date to DD/MM/YYYY format (without time)
  function formatDateDMY(date) {
    return DateUtils.formatDMY(date);
  }

  // Convert any date to DD/MM/YYYY HH:MM:SS format (with time)
  function formatDateTimeDMY(date) {
    return DateUtils.formatDateTime(date);
  }

  // Expose globally for use in templates and other modules
  window.formatDateDMY = formatDateDMY;
  window.formatDateTimeDMY = formatDateTimeDMY;

  /* ═══════════════════════════════════════════════════════════════════════════
     HTTP UTILITIES
     ═══════════════════════════════════════════════════════════════════════════
     Wrapper for fetch() that handles JSON parsing and CORS.
     Auto-prefixes relative URLs with API_BASE.
     Only sends credentials for same-origin requests.
     ═══════════════════════════════════════════════════════════════════════════ */
  async function fetchJson(url, options = {}) {
    let fullUrl = url;
    if (url.startsWith("/")) fullUrl = `${API_BASE}${url}`;

    const headers = {
      ...(options.headers || {}),
      Accept: "application/json",
    };

    const isSameOrigin = fullUrl.startsWith(window.location.origin);

    const fetchOptions = {
      ...options,
      headers,
      // Only include credentials if same origin OR explicitly enabled
      credentials:
        isSameOrigin || ALWAYS_SEND_CREDENTIALS
          ? (options.credentials || "include")
          : "omit",
    };

    let res;
    try {
      res = await fetch(fullUrl, fetchOptions);
    } catch (networkErr) {
      console.error("Network error fetching:", fullUrl, networkErr);
      throw new Error("Network fetch failed");
    }

    const text = await res.text();
    const contentType = (res.headers.get("content-type") || "").toLowerCase();

    if (!res.ok) {
      console.error(`${fullUrl} returned HTTP ${res.status}:`, text.slice(0, 200));
      throw new Error(`HTTP ${res.status} from ${fullUrl}`);
    }

    if (!contentType.includes("application/json")) {
      console.warn(`${fullUrl} returned non-JSON (content-type: ${contentType || "unknown"}):`, text.slice(0, 200));
      throw new Error("Non-JSON response");
    }

    try {
      return JSON.parse(text);
    } catch (err) {
      console.error("Failed to parse JSON from", fullUrl, "body:", text.slice(0, 300));
      throw err;
    }
  }

  function getCurrentEmployeeInfo() {
    return {
      uid: currentEmployee?.uid || window._currentEmployee?.uid || null,
      name: currentEmployee?.name || window._currentEmployee?.name || 'Unknown'
    };
  }

  window.getCurrentEmployeeInfo = getCurrentEmployeeInfo;

  const SECURITY_CONFIG = {
    sessionTimeoutMs: 30 * 60 * 1000,
    maxLoginAttempts: 5,
    lockoutDurationMs: 15 * 60 * 1000,
    auditLogRetentionDays: 90,
    sensitiveFields: ['password', 'token', 'secret', 'apiKey'],
    maxInputLength: 10000,
  };

  let lastActivityTime = Date.now();
  let sessionWarningShown = false;
  let sessionTimeoutId = null;

  function resetSessionTimeout() {
    clearTimeout(sessionTimeoutId);
    lastActivityTime = Date.now();
    sessionWarningShown = false;
    
    sessionTimeoutId = setTimeout(async () => {
      alert('Your session has expired due to inactivity. Please log in again.');
      try {
        await auth.signOut();
      } catch (err) {
        console.error('Error signing out:', err);
      }
      window.location.href = 'login.html';
    }, SECURITY_CONFIG.sessionTimeoutMs);
  }

  const throttledSessionReset = (() => {
    let lastCall = 0;
    return () => {
      const now = Date.now();
      if (now - lastCall >= 5000) {
        lastCall = now;
        resetSessionTimeout();
      }
    };
  })();

  ['click', 'keypress', 'mousemove', 'touchstart', 'scroll'].forEach(event => {
    document.addEventListener(event, throttledSessionReset, { passive: true });
  });

  const HTML_ESCAPE_MAP = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    "'": '&#x27;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;'
  };

  function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>"'`=/]/g, char => HTML_ESCAPE_MAP[char]);
  }

  function sanitizeHTML(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/<[^>]*>/g, '')           // Strip tags
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/data:(?!image\/(png|jpeg|gif|webp))/gi, '')
      .trim();
  }

  function sanitizeObject(obj) {
    if (obj == null) return obj;
    if (typeof obj === 'string') return sanitizeHTML(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeObject);
    if (typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, sanitizeObject(v)])
      );
    }
    return obj;
  }

  function validateInputLength(input, maxLength = SECURITY_CONFIG.maxInputLength) {
    return typeof input !== 'string' || input.length <= maxLength;
  }

  function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 254;
  }

  function validateNumeric(value, min = -Infinity, max = Infinity) {
    const num = parseFloat(value);
    return !isNaN(num) && isFinite(num) && num >= min && num <= max;
  }

  const AUDIT_ACTIONS = {
    LOGIN: 'AUTH_LOGIN',
    LOGOUT: 'AUTH_LOGOUT',
    SESSION_TIMEOUT: 'AUTH_SESSION_TIMEOUT',
    RESERVATION_CREATE: 'RESERVATION_CREATE',
    RESERVATION_UPDATE: 'RESERVATION_UPDATE',
    RESERVATION_DELETE: 'RESERVATION_DELETE',
    RESERVATION_EXTEND: 'RESERVATION_EXTEND',
    PAYMENT_CREATE: 'PAYMENT_CREATE',
    PAYMENT_UPDATE: 'PAYMENT_UPDATE',
    PAYMENT_VOID: 'PAYMENT_VOID',
    PAYMENT_UNVOID: 'PAYMENT_UNVOID',
    LATE_FEE: 'LATE_FEE',
    BALANCE_ADJUSTMENT: 'BALANCE_ADJUSTMENT',
    BALANCE_ADJUSTMENT_REMOVE: 'BALANCE_ADJUSTMENT_REMOVE',
    CUSTOMER_CREATE: 'CUSTOMER_CREATE',
    CUSTOMER_UPDATE: 'CUSTOMER_UPDATE',
    CUSTOMER_DELETE: 'CUSTOMER_DELETE',
    QB_SYNC_SUCCESS: 'QB_SYNC_SUCCESS',
    QB_SYNC_FAILED: 'QB_SYNC_FAILED',
    BATCH_CLOSE: 'BATCH_CLOSE',
    REPORT_GENERATED: 'REPORT_GENERATED',
    SETTINGS_CHANGED: 'SETTINGS_CHANGED',
    ERROR: 'SYSTEM_ERROR'
  };

  async function auditLog(action, details = {}, entityType = null, entityId = null) {
    try {
      const employee = currentEmployee || window._currentEmployee;
      const safeDetails = { ...details };
      SECURITY_CONFIG.sensitiveFields.forEach(f => { if (safeDetails[f]) safeDetails[f] = '[REDACTED]'; });

      const logEntry = {
        timestamp: new Date().toISOString(),
        action,
        entityType,
        entityId,
        details: safeDetails,
        userAgent: navigator.userAgent,
        sessionId: getSessionId(),
        userId: employee?.uid || auth.currentUser?.uid || 'system',
        employeeName: employee?.name || auth.currentUser?.displayName || 'System',
        employeeEmail: employee?.email || auth.currentUser?.email || 'system@guesthouse.local',
        employeeRole: employee?.role || 'unknown',
        clientIP: null,
        appVersion: '2.0.0'
      };

      const docRef = await addDoc(collection(db, 'audit_logs'), logEntry);
      console.log(`📋 Audit: ${action} by ${logEntry.employeeName}`, entityId ? `(${entityType}:${entityId})` : '');
      return docRef.id;
    } catch (err) {
      console.error('Failed to write audit log:', err);
      return null;
    }
  }

  function getSessionId() {
    let sessionId = sessionStorage.getItem('guesthouse_session_id');
    if (!sessionId) {
      sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('guesthouse_session_id', sessionId);
    }
    return sessionId;
  }

  function updateActivityTime() {
    lastActivityTime = Date.now();
    sessionWarningShown = false;
  }

  let sessionExpired = false;

  function checkSessionTimeout() {
    if (sessionExpired) return;
    
    const inactiveTime = Date.now() - lastActivityTime;
    const timeoutThreshold = SECURITY_CONFIG.sessionTimeoutMs;
    const warningThreshold = timeoutThreshold - (5 * 60 * 1000);

    if (inactiveTime >= timeoutThreshold) {
      sessionExpired = true;
      auditLog(AUDIT_ACTIONS.SESSION_TIMEOUT, { 
        inactiveMinutes: Math.round(inactiveTime / 60000) 
      });
      handleSessionExpired();
    } else if (inactiveTime >= warningThreshold && !sessionWarningShown) {
      sessionWarningShown = true;
      const remainingMins = Math.ceil((timeoutThreshold - inactiveTime) / 60000);
      showSessionWarning(remainingMins);
    }
  }

  function handleSessionExpired() {
    sessionStorage.clear();
    alert('Your session has expired due to inactivity. Please refresh the page.');
  }

  function showSessionWarning(remainingMins) {
    const continueSession = confirm(
      `⚠️ Session Timeout Warning\n\n` +
      `Your session will expire in ${remainingMins} minute(s) due to inactivity.\n\n` +
      `Click OK to continue your session.`
    );
    if (continueSession) {
      updateActivityTime();
    }
  }

  ['click', 'keypress', 'scroll', 'mousemove'].forEach(event => {
    document.addEventListener(event, updateActivityTime, { passive: true });
  });

  setInterval(checkSessionTimeout, 60 * 1000);

  function handleError(error, context, showUser = true) {
    console.error(`Error in ${context}:`, error);
    auditLog(AUDIT_ACTIONS.ERROR, {
      message: error.message,
      context,
      stack: error.stack?.substring(0, 500)
    });
    if (showUser) alert('An error occurred. Please try again.');
  }

  const rateLimitTracker = {};

  function checkRateLimit(actionKey, maxAttempts = 10, windowMs = 60000) {
    const now = Date.now();
    const tracker = rateLimitTracker[actionKey] ??= { attempts: [], lockedUntil: null };

    if (tracker.lockedUntil && now < tracker.lockedUntil) return false;
    
    tracker.attempts = tracker.attempts.filter(t => now - t < windowMs);
    
    if (tracker.attempts.length >= maxAttempts) {
      tracker.lockedUntil = now + SECURITY_CONFIG.lockoutDurationMs;
      auditLog(AUDIT_ACTIONS.ERROR, { reason: 'Rate limit exceeded', actionKey });
      return false;
    }

    tracker.attempts.push(now);
    return true;
  }

  window.securityUtils = {
    escapeHTML,
    sanitizeHTML,
    sanitizeObject,
    validateEmail,
    validateNumeric,
    validateInputLength,
    auditLog,
    AUDIT_ACTIONS,
    handleError,
    checkRateLimit
  };

  async function sendSMS(phone, message) {
    return await fetchJson('/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message })
    });
  }

  function buildSMSReceipt(data) {
    return `Glimbaro GH
#${data.receiptNumber}
Room ${data.room}
${data.checkIn} to ${data.checkOut}
Paid: $${data.amountPaid}
Bal: $${data.balance}
Thanks!`;
  }

  function formatDateWithDay(dateStr) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date(dateStr + 'T00:00:00');
    return `${days[d.getDay()]} ${formatDateDMY(dateStr)}`;
  }

  function buildSMSConfirmation(data) {
    return `Glimbaro Guest House
Reservation Confirmation
Receipt Number: ${data.receiptNumber}
${data.customerName}
Room ${data.room}
Check-In: ${formatDateWithDay(data.checkIn)} 3PM
Check-Out: ${formatDateWithDay(data.checkOut)} 1PM
Date Paid: ${data.datePaid}
Paid: $${data.amountPaid}
Bal: $${data.balance}
*Check-in 3PM, Check-out 1PM*
Thanks!`;
  }

  let lastAuthPrompt = 0;
  const AUTH_PROMPT_COOLDOWN = 10000;

  async function checkQuickBooksLogin() {
    try {
      const data = await fetchJson("/check-token", { method: "GET" });
      
      if (!data.loggedIn && data.authUrl) {
        console.warn("⚠️ QuickBooks not authorized. Auth URL available.");
        
        // Only auto-prompt if cooldown has passed
        const now = Date.now();
        if (now - lastAuthPrompt > AUTH_PROMPT_COOLDOWN) {
          lastAuthPrompt = now;
          promptQuickBooksAuth(data.authUrl);
        }
      } else if (data.loggedIn) {
        console.log("✅ QuickBooks session active");
        hideAuthBanner();
      }
    } catch (err) {
      console.warn("QuickBooks login check failed:", err.message);
    }
  }

  // Show persistent banner prompting user to authorize
  function promptQuickBooksAuth(authUrl) {
    let banner = document.getElementById("qbAuthBanner");
    
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "qbAuthBanner";
      banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        background: #ef4444;
        color: white;
        padding: 16px 20px;
        text-align: center;
        z-index: 99999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        font-family: Arial, sans-serif;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20px;
        animation: slideDown 0.3s ease-out;
      `;
      
      banner.innerHTML = `
        <span>⚠️ QuickBooks authorization required for payment sync</span>
        <button id="qbAuthBtn" style="
          background: white;
          color: #ff6b6b;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          font-weight: bold;
          cursor: pointer;
          font-size: 15px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
          transition: transform 0.2s;
        ">
          🔐 Authorize QuickBooks
        </button>
        <button id="qbAuthDismiss" style="
          background: transparent;
          color: white;
          border: 1px solid white;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: background 0.2s;
        ">
          Dismiss
        </button>
      `;
      
      document.body.prepend(banner);
      
      // Add hover effects
      const authBtn = document.getElementById("qbAuthBtn");
      authBtn.addEventListener("mouseenter", () => authBtn.style.transform = "scale(1.05)");
      authBtn.addEventListener("mouseleave", () => authBtn.style.transform = "scale(1)");
      
      const dismissBtn = document.getElementById("qbAuthDismiss");
      dismissBtn.addEventListener("mouseenter", () => dismissBtn.style.background = "rgba(255,255,255,0.1)");
      dismissBtn.addEventListener("mouseleave", () => dismissBtn.style.background = "transparent");
      
      // Authorize button click
      authBtn.onclick = () => {
        window.open(authUrl, "_blank", "width=800,height=700,scrollbars=yes");
        
        // Start checking every 5 seconds to see if auth completes
        const checkInterval = setInterval(async () => {
          try {
            const status = await fetchJson("/check-token", { method: "GET" });
            if (status.loggedIn) {
              clearInterval(checkInterval);
              hideAuthBanner();
              
              // Show success message
              showSuccessMessage("✅ QuickBooks authorized successfully!");
              
              // Retry any queued payments
              await retryQuickBooksQueue();
            }
          } catch (err) {
            console.warn("Auth check poll failed:", err);
          }
        }, 5000);
        
        // Stop checking after 3 minutes
        setTimeout(() => clearInterval(checkInterval), 3 * 60 * 1000);
      };
      
      // Dismiss button
      dismissBtn.onclick = () => {
        banner.remove();
        lastAuthPrompt = Date.now(); // Reset cooldown
      };
    }
  }

  // Hide auth banner
  function hideAuthBanner() {
    const banner = document.getElementById("qbAuthBanner");
    if (banner) {
      banner.style.animation = "slideUp 0.3s ease-out";
      setTimeout(() => banner.remove(), 300);
    }
  }

  // Show success message
  function showSuccessMessage(message) {
    const toast = document.createElement("div");
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 100000;
      font-family: Arial, sans-serif;
      font-size: 16px;
      animation: slideInRight 0.3s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = "fadeOut 0.3s ease-out";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Manual QuickBooks auth button handler
  document.getElementById("manualQBAuthBtn")?.addEventListener("click", async () => {
    try {
      const data = await fetchJson("/check-token", { method: "GET" });
      
      if (!data.loggedIn && data.authUrl) {
        // Show banner manually
        promptQuickBooksAuth(data.authUrl);
      } else if (data.loggedIn) {
        showSuccessMessage("✅ QuickBooks is already authorized!");
      } else {
        alert("Unable to retrieve QuickBooks authorization URL.");
      }
    } catch (err) {
      console.error("Manual QB auth check failed:", err);
      alert("Failed to check QuickBooks status. Check console for details.");
    }
  });

  // Add CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideDown {
      from {
        transform: translateY(-100%);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    
    @keyframes slideUp {
      from {
        transform: translateY(0);
        opacity: 1;
      }
      to {
        transform: translateY(-100%);
        opacity: 0;
      }
    }
    
    @keyframes slideInRight {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  // QB auth check only runs when user explicitly clicks manual QB auth button.
  // No auto-prompt — printing and other actions must never be blocked by QB status.
  // setInterval(checkQuickBooksLogin, 1800000);
  // checkQuickBooksLogin();
// Wrap onSnapshot with error handler
function safeOnSnapshot(ref, onNext) {
  try {
    return onSnapshot(ref, onNext, (err) => {
      console.error('Realtime listener error:', err);
      // Add your error handling logic here if needed
    });
  } catch (err) {
    console.error('Failed to initialize realtime listener:', err);
  }
}



let uploadedIdFile = null;
let cropperInstance = null;
let latestCroppedImageDataUrl = null;
let paymentPopupReservationId = null;
let editingCustomerId = null;

window.addEventListener('online', () => {
  Logger.info("Back online — syncing data…");
  // Update offline indicator
  const offlineIndicator = document.getElementById('offlineIndicator');
  if (offlineIndicator) {
    offlineIndicator.style.display = 'none';
  }
  // Show a toast notification
  showToast('Back online! Changes will sync.', 'success');
  // Retry any queued QB syncs (with duplicate checking)
  retryQuickBooksQueue();
});

window.addEventListener('offline', () => {
  console.log("🔴 Offline — changes will sync later");
  // Show offline indicator
  let offlineIndicator = document.getElementById('offlineIndicator');
  if (!offlineIndicator) {
    // Create offline indicator if it doesn't exist
    offlineIndicator = document.createElement('div');
    offlineIndicator.id = 'offlineIndicator';
    offlineIndicator.innerHTML = `
      <span class="material-icons" style="font-size: 18px; vertical-align: middle; margin-right: 5px;">cloud_off</span>
      Working Offline - Changes will sync when connected
    `;
    offlineIndicator.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #f97316;
      color: white;
      text-align: center;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
    document.body.appendChild(offlineIndicator);
  } else {
    offlineIndicator.style.display = 'block';
  }
});

// Check initial online/offline status
if (!navigator.onLine) {
  // Trigger the offline handler if we're already offline
  window.dispatchEvent(new Event('offline'));
}

// Simple toast notification helper
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const bgColors = {
    success: '#10b981',
    error: '#ef4444',
    info: '#3b82f6',
    warning: '#f97316'
  };
  toast.innerHTML = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${bgColors[type] || bgColors.info};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10001;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease-out;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PERFORMANCE UTILITIES
   ═══════════════════════════════════════════════════════════════════════════
   These functions help optimize the app's performance, especially on
   lower-powered devices (phones, tablets, older computers).
   
   KEY CONCEPTS:
   - Debouncing: Wait for user to stop typing/clicking before doing work
   - Throttling: Only run a function at most once per time period
   - Idle callbacks: Do non-urgent work when the browser isn't busy
   - RAF (requestAnimationFrame): Sync updates with screen refresh rate
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Run a callback during browser idle time (when not busy rendering)
 * Falls back to setTimeout for browsers without requestIdleCallback
 * 
 * USE FOR: Non-urgent background tasks like analytics, prefetching
 * @param {Function} callback - Function to run when browser is idle
 */
function runWhenIdle(callback) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(callback, { timeout: 2000 });
  } else {
    setTimeout(callback, 100);
  }
}

/**
 * Create a debounced version of a function
 * The function only runs after the specified delay with no new calls
 * 
 * USE FOR: Search boxes, resize handlers, form validation
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait (default 250ms)
 * @returns {Function} Debounced function
 */
function debounce(func, wait = 250) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a throttled version of a function
 * The function runs at most once per time period, no matter how many calls
 * 
 * USE FOR: Scroll handlers, mousemove events, button spam prevention
 * @param {Function} func - Function to throttle
 * @param {number} limit - Minimum milliseconds between calls (default 100ms)
 * @returns {Function} Throttled function
 */
function throttle(func, limit = 100) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Export utilities globally for use throughout the app
window.runWhenIdle = runWhenIdle;
window.debounce = debounce;
window.throttle = throttle;

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD UPDATE MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════════
   The dashboard shows room status and stats. It needs to update when:
   - A reservation is created/edited/deleted
   - A payment is recorded
   - A room status changes
   
   PROBLEM: If we update on every tiny change, the app becomes laggy.
   SOLUTION: Debounce updates - wait 300ms after last change, then update once.
   
   This dramatically improves performance on mobile devices!
   ═══════════════════════════════════════════════════════════════════════════ */

let dashboardUpdateTimeout = null;
let dashboardUpdateScheduled = false;
let lastDashboardUpdate = 0;
const MIN_UPDATE_INTERVAL = 500; // Don't update more than twice per second

/**
 * Smart dashboard update with debouncing
 * - Waits 300ms after the last change before updating
 * - Uses requestAnimationFrame for smooth rendering
 * - Prevents multiple simultaneous updates
 */
function debouncedDashboardUpdate() {
  // Skip updates while auto-checkout is running (prevents spam)
  if (window._suppressDashboardUpdates) return;

  // Clear any pending update
  if (dashboardUpdateTimeout) clearTimeout(dashboardUpdateTimeout);
  
  // If already updating, don't queue another
  if (dashboardUpdateScheduled) return;
  
  // Rate limiting: don't update more than twice per second
  const now = Date.now();
  const timeSinceLastUpdate = now - lastDashboardUpdate;
  const delay = Math.max(300, MIN_UPDATE_INTERVAL - timeSinceLastUpdate);
  
  dashboardUpdateTimeout = setTimeout(() => {
    dashboardUpdateScheduled = true;
    
    // Use requestAnimationFrame for smooth rendering
    // This syncs our update with the screen's refresh rate
    requestAnimationFrame(() => {
      if (typeof fillDashboard === 'function') {
        fillDashboard().finally(() => {
          dashboardUpdateScheduled = false;
          lastDashboardUpdate = Date.now();
          Logger.debug('🔄 Dashboard refreshed (real-time update)');
        });
      } else {
        dashboardUpdateScheduled = false;
      }
    });
  }, delay);
}

/* ═══════════════════════════════════════════════════════════════════════════
   REAL-TIME DATA LISTENERS (Firebase onSnapshot)
   ═══════════════════════════════════════════════════════════════════════════
   These listeners keep the app in sync with the database.
   When ANY user makes a change, EVERYONE sees it instantly.
   
   HOW IT WORKS:
   1. Firebase keeps a connection open to the database
   2. When data changes, Firebase pushes the update to all connected clients
   3. We update our local cache (window._reservationsCache, etc.)
   4. We debounce dashboard updates to prevent lag
   
   PERFORMANCE NOTES:
   - Each listener maintains a websocket connection (minimal overhead)
   - We cache data in memory to avoid re-fetching
   - Dashboard updates are debounced to prevent UI thrashing
   ═══════════════════════════════════════════════════════════════════════════ */

// Store unsubscribe functions so we can clean up listeners if needed
const _listenerUnsubscribes = [];

waitForSignedInUser().then(() => {
  try {
    /* ─────────────────────────────────────────────────────────────────────────
       RESERVATIONS LISTENER
       Updates when any reservation is created, modified, or deleted
       ───────────────────────────────────────────────────────────────────────── */
    const unsubReservations = onSnapshot(
      collection(db, "reservations"),
      (snapshot) => {
        // Build new cache from snapshot
        // Using map() creates a new array (memory efficient)
        window._reservationsCache = snapshot.docs.map((doc) => ({ 
          id: doc.id, 
          ...doc.data() 
        }));
        Logger.debug("📅 Live reservations update:", window._reservationsCache.length, "reservations");
        
        // Trigger debounced dashboard refresh
        debouncedDashboardUpdate();
      },
      (error) => {
        console.error("Reservations listener error:", error);
        if (error?.code === "permission-denied") {
          console.warn("⚠️ Permission denied for reservations - user may need to re-authenticate");
        }
      }
    );
    _listenerUnsubscribes.push(unsubReservations);

    /* ─────────────────────────────────────────────────────────────────────────
       PAYMENTS LISTENER
       Updates when any payment is recorded, voided, or modified
       ───────────────────────────────────────────────────────────────────────── */
    const unsubPayments = onSnapshot(
      collection(db, "payments"),
      (snapshot) => {
        window._allPaymentsCache = snapshot.docs.map((doc) => ({ 
          id: doc.id, 
          ...doc.data() 
        }));
        Logger.debug("💰 Live payments update:", window._allPaymentsCache.length, "payments");
        debouncedDashboardUpdate();
      },
      (error) => {
        console.error("Payments listener error:", error);
        if (error?.code === "permission-denied") {
          console.warn("⚠️ Permission denied for payments");
        }
      }
    );
    _listenerUnsubscribes.push(unsubPayments);

    /* ─────────────────────────────────────────────────────────────────────────
       CUSTOMERS LISTENER
       Updates when customer info changes (name, phone, ID image, etc.)
       NOTE: We don't trigger dashboard update for customer changes
             since the dashboard only shows room status, not customer details
       ───────────────────────────────────────────────────────────────────────── */
    const unsubCustomers = onSnapshot(
      collection(db, "customers"),
      (snapshot) => {
        customers = snapshot.docs.map((doc) => ({ 
          id: doc.id, 
          ...doc.data() 
        }));
        Logger.debug("👤 Live customers update:", customers.length, "customers");
        // Intentionally NOT calling debouncedDashboardUpdate() here
        // Customer changes don't affect room status display
      },
      (error) => {
        console.error("Customers listener error:", error);
        if (error?.code === "permission-denied") {
          console.warn("⚠️ Permission denied for customers");
        }
      }
    );
    _listenerUnsubscribes.push(unsubCustomers);

    /* ─────────────────────────────────────────────────────────────────────────
       MAINTENANCE SETTINGS LISTENER
       Tracks which rooms are under maintenance (shown as gray on dashboard)
       ───────────────────────────────────────────────────────────────────────── */
    const unsubMaintenance = onSnapshot(
      doc(db, "settings", "maintenance"),
      (docSnap) => {
        if (docSnap.exists()) {
          maintenanceRooms = docSnap.data().rooms || [];
          maintenanceReasons = docSnap.data().reasons || {};
        } else {
          maintenanceRooms = [];
          maintenanceReasons = {};
        }
        Logger.debug("🔧 Live maintenance update:", maintenanceRooms.length, "rooms");
        debouncedDashboardUpdate();
      },
      (error) => {
        console.error("Maintenance listener error:", error);
      }
    );
    _listenerUnsubscribes.push(unsubMaintenance);

    Logger.success("Real-time listeners initialized (4 active connections)");
  } catch (err) {
    console.error("Failed to initialize realtime listeners:", err);
  }
});

async function getNextReceiptNumber() {
  const receiptCounterRef = doc(db, "counters", "receipt_counter");
  let nextReceipt = "";
  
  await runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(receiptCounterRef);
    let current = counterDoc.exists() ? counterDoc.data().current : 0;
    const next = current + 1;
    nextReceipt = String(next).padStart(5, "0");
    transaction.update(receiptCounterRef, { current: next });
  });
  
  return nextReceipt;
}

const QB_QUEUE_KEY = "qbSyncQueue";

function getQuickBooksQueue() {
  return JSON.parse(localStorage.getItem(QB_QUEUE_KEY) || "[]");
}

function saveQuickBooksQueue(queue) {
  // Deduplicate by receipt number before saving
  const seen = new Set();
  const deduped = queue.filter(item => {
    if (!item || !item.receiptNumber) return true;
    if (seen.has(item.receiptNumber)) return false;
    seen.add(item.receiptNumber);
    return true;
  });
  localStorage.setItem(QB_QUEUE_KEY, JSON.stringify(deduped));
}

let _qbQueueRetryInProgress = false;

async function retryQuickBooksQueue() {
  if (_qbQueueRetryInProgress) return;
  _qbQueueRetryInProgress = true;

  try {
    const queue = getQuickBooksQueue();
    if (queue.length === 0) return;

    Logger.debug(`Retrying ${queue.length} QuickBooks sync(s) from local queue...`);
    let stillPending = [];

    for (let item of queue) {
      if (!item || !item.name || !item.amount) {
        Logger.warn("Skipping invalid QuickBooks queue item:", item);
        continue;
      }
      
      // Check Firestore to see if already synced or voided
      if (item.paymentId) {
        try {
          const paymentDoc = await getDoc(doc(db, 'payments', item.paymentId));
          if (paymentDoc.exists()) {
            const data = paymentDoc.data();
            if (data.qbSyncStatus === 'synced') {
              Logger.debug(`Receipt #${item.receiptNumber} already synced - removing from queue`);
              continue;
            }
            if (data.voided || data.qbSyncStatus === 'voided') {
              Logger.debug(`Receipt #${item.receiptNumber} is voided - removing from queue`);
              continue;
            }
          }
        } catch (e) {
          Logger.warn('Could not check sync status:', e);
        }
      }
      
      try {
        const result = await sendToQuickBooks(item);
        Logger.debug("Synced to QuickBooks:", item.receiptNumber);
        // Mark as synced in Firestore
        if (item.paymentId) {
          try {
            await updateDoc(doc(db, 'payments', item.paymentId), {
              qbSyncStatus: 'synced',
              qbSyncedAt: new Date().toISOString(),
              qbSyncError: null,
              ...(result?.duplicate ? { qbSyncNote: 'Already existed in QuickBooks' } : {})
            });
          } catch (e) { Logger.warn('Could not update sync status:', e); }
        }
      } catch (err) {
        Logger.warn("QuickBooks retry failed:", err.message);
        stillPending.push(item);
      }
    }

    saveQuickBooksQueue(stillPending);
  } finally {
    _qbQueueRetryInProgress = false;
  }
}

async function sendToQuickBooks(paymentData) {
  return await fetchJson('/payment-to-quickbooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentData),
    credentials: 'include'
  });
}

function buildQuickBooksPaymentData(payment, reservation, customer, employee = null) {
  const nights = reservation ? calculateSpecialNights(
    reservation.arrivalDate, 
    reservation.departureDate
  ) : 1;
  
  let paymentDate = new Date().toISOString().split("T")[0];
  if (payment.timestamp) {
    try {
      paymentDate = payment.timestamp.toDate 
        ? payment.timestamp.toDate().toISOString().split("T")[0] 
        : new Date(payment.timestamp).toISOString().split("T")[0];
    } catch (e) { }
  }
  
  return {
    name: customer?.name || 'Walk-in Guest',
    email: customer?.email || '',
    phone: customer?.telephone || '',
    address: customer?.address || '',
    customerNumber: customer?.customerNumber || '',
    amount: parseFloat(payment.amount || 0),
    receiptNumber: payment.receiptNumber || '',
    method: payment.method || 'cash',
    date: paymentDate,
    room: reservation?.roomNumber || '',
    checkin: reservation?.arrivalDate || '',
    checkout: reservation?.departureDate || '',
    nights: nights,
    rate: parseFloat(reservation?.rate || 0),
    notes: reservation?.notes || '',
    recordedBy: employee?.name || payment.recordedByName || window._currentEmployee?.name || 'Staff',
    paymentId: payment.id || '',
    reservationId: reservation?.id || '',
    customerId: customer?.id || ''
  };
}

// Global lock to prevent concurrent QB sync operations across bulk functions
let _qbSyncInProgress = false;

async function pushToQuickBooks(paymentData, paymentId = null, skipDuplicateCheck = false) {
  if (!paymentData || !paymentData.name || !paymentData.amount) {
    console.error("Cannot push to QuickBooks: missing required fields (name, amount)", paymentData);
    return { success: false, error: 'Missing required fields' };
  }
  
  // Check if already synced (prevents duplicate sends)
  if (paymentId && !skipDuplicateCheck) {
    try {
      const paymentDoc = await getDoc(doc(db, "payments", paymentId));
      if (paymentDoc.exists()) {
        const existingPayment = paymentDoc.data();
        if (existingPayment.qbSyncStatus === 'synced') {
          console.log(`📝 Receipt #${existingPayment.receiptNumber || paymentId} already synced to QuickBooks - skipping`);
          return { success: true, alreadySynced: true, message: 'Already synced to QuickBooks' };
        }
        if (existingPayment.voided || existingPayment.qbSyncStatus === 'voided') {
          console.log(`🚫 Receipt #${existingPayment.receiptNumber || paymentId} is voided - will not send to QuickBooks`);
          return { success: false, voided: true, message: 'Payment is voided — not sent to QuickBooks' };
        }
      }
    } catch (e) {
      console.warn("Could not check QB sync status:", e);
    }
  }
  
  if (!navigator.onLine) {
    console.warn("Offline - adding QuickBooks job to queue");
    const queue = getQuickBooksQueue();
    queue.push({ ...paymentData, paymentId });
    saveQuickBooksQueue(queue);
    
    if (paymentId) {
      try {
        await updateDoc(doc(db, "payments", paymentId), {
          qbSyncStatus: 'queued',
          qbQueuedAt: new Date().toISOString()
        });
      } catch (e) { console.warn("Could not update QB status:", e); }
    }
    return { success: false, queued: true };
  }

  try {
    const result = await sendToQuickBooks(paymentData);
    console.log("Payment successfully sent to QuickBooks.", result?.duplicate ? '(was already in QB)' : '');
    
    if (paymentId) {
      try {
        await updateDoc(doc(db, "payments", paymentId), {
          qbSyncStatus: 'synced',
          qbSyncedAt: new Date().toISOString(),
          qbError: null,
          ...(result?.duplicate ? { qbSyncNote: 'Already existed in QuickBooks' } : {})
        });
      } catch (e) { console.warn("Could not update QB status:", e); }
    }
    return { success: true, result, alreadyInQB: !!result?.duplicate };
    
  } catch (err) {
    console.warn("QuickBooks sync failed - queued for retry:", err);
    const queue = getQuickBooksQueue();
    queue.push({ ...paymentData, paymentId });
    saveQuickBooksQueue(queue);
    
    if (paymentId) {
      try {
        await updateDoc(doc(db, "payments", paymentId), {
          qbSyncStatus: 'failed',
          qbError: err.message || 'Unknown error',
          qbLastAttempt: new Date().toISOString()
        });
      } catch (e) { console.warn("Could not update QB status:", e); }
    }
    return { success: false, error: err.message };
  }
}

async function manualPushToQuickBooks(paymentId) {
  try {
    // Get payment from Firestore
    const paymentSnap = await getDoc(doc(db, "payments", paymentId));
    if (!paymentSnap.exists()) {
      throw new Error('Payment not found');
    }
    const payment = { id: paymentId, ...paymentSnap.data() };
    
    // Get reservation
    let reservation = null;
    if (payment.reservationId) {
      const reservationSnap = await getDoc(doc(db, "reservations", payment.reservationId));
      reservation = reservationSnap.exists() ? { id: reservationSnap.id, ...reservationSnap.data() } : null;
    }
    
    // Get customer
    const customer = customers.find(c => c.id === payment.customerId) || null;
    
    // Build complete payment data
    const qbData = buildQuickBooksPaymentData(payment, reservation, customer);
    
    // Attempt to push
    const result = await pushToQuickBooks(qbData, paymentId);
    
    return result;
  } catch (err) {
    console.error("Manual QB push failed:", err);
    return { success: false, error: err.message };
  }
}

// Attach retry to online event
// Retry QB queue when coming back online
window.addEventListener('online', retryQuickBooksQueue);

/**
 * Retry failed QuickBooks syncs from Firestore
 * This allows any computer to retry syncs that failed on other computers
 */
let _qbFirestoreRetryInProgress = false;

async function retryFailedQBSyncsFromFirestore() {
  // Prevent concurrent retries
  if (_qbFirestoreRetryInProgress || _qbSyncInProgress) return;
  _qbFirestoreRetryInProgress = true;

  try {
    const paymentsSnapshot = await getDocs(collection(db, "payments"));
    const failedPayments = paymentsSnapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.qbSyncStatus === 'failed' || p.qbSyncStatus === 'pending');
    
    if (failedPayments.length === 0) {
      Logger.debug("No pending QuickBooks syncs to retry");
      return;
    }
    
    Logger.info(`Found ${failedPayments.length} pending QuickBooks sync(s)...`);
    
    for (const payment of failedPayments) {
      // Skip voided payments — should never be sent to QB
      if (payment.voided || payment.qbSyncStatus === 'voided') {
        Logger.debug(`Receipt #${payment.receiptNumber} is voided - skipping retry`);
        continue;
      }
      
      // Skip if already synced (double-check to prevent race conditions)
      if (payment.qbSyncStatus === 'synced') {
        Logger.debug(`Receipt #${payment.receiptNumber} already synced - skipping`);
        continue;
      }
      
      // Skip if too many attempts (max 5)
      if ((payment.qbSyncAttempts || 0) >= 5) {
        Logger.warn(`Payment ${payment.receiptNumber} has too many failed attempts (${payment.qbSyncAttempts}), skipping`);
        continue;
      }
      
      // Re-fetch to ensure we have latest status (prevents duplicates)
      try {
        const freshDoc = await getDoc(doc(db, 'payments', payment.id));
        if (freshDoc.exists() && freshDoc.data().qbSyncStatus === 'synced') {
          Logger.debug(`Receipt #${payment.receiptNumber} was synced by another process - skipping`);
          continue;
        }
      } catch (e) {
        Logger.warn('Could not re-check payment status:', e);
      }
      
      // Use stored qbPaymentData if available, otherwise construct from payment
      // Ensure date is always the original payment creation date, not today
      let paymentDateStr = new Date().toISOString().split('T')[0];
      if (payment.timestamp) {
        try {
          if (typeof payment.timestamp.toDate === 'function') {
            paymentDateStr = payment.timestamp.toDate().toISOString().split('T')[0];
          } else if (typeof payment.timestamp === 'string') {
            paymentDateStr = payment.timestamp.split('T')[0];
          } else {
            paymentDateStr = new Date(payment.timestamp).toISOString().split('T')[0];
          }
        } catch (e) { /* keep default */ }
      }

      const paymentData = payment.qbPaymentData || {
        name: payment.customerName || 'Unknown',
        amount: payment.amount,
        receiptNumber: payment.receiptNumber,
        date: paymentDateStr,
        method: payment.method
      };
      
      try {
        const result = await sendToQuickBooks(paymentData);
        Logger.success(`Payment ${payment.receiptNumber} synced to QuickBooks${result?.duplicate ? ' (already existed)' : ''}`);
        
        // Update status to synced
        await updateDoc(doc(db, 'payments', payment.id), {
          qbSyncStatus: 'synced',
          qbSyncedAt: new Date().toISOString(),
          qbSyncError: null,
          qbPaymentData: null,
          ...(result?.duplicate ? { qbSyncNote: 'Already existed in QuickBooks' } : {})
        });
      } catch (err) {
        const errMsg = err.message || '';
        
        // If QB says receipt already exists, mark as synced (it went through before)
        if (/already exists|Duplicate|DocNumber/i.test(errMsg)) {
          Logger.info(`Payment ${payment.receiptNumber} already exists in QuickBooks - marking as synced`);
          await updateDoc(doc(db, 'payments', payment.id), {
            qbSyncStatus: 'synced',
            qbSyncedAt: new Date().toISOString(),
            qbSyncError: null,
            qbPaymentData: null,
            qbSyncNote: 'Already existed in QuickBooks'
          });
        } else {
          Logger.warn(`Payment ${payment.receiptNumber} QB sync retry failed:`, errMsg);
        
          // Increment attempt count
          await updateDoc(doc(db, 'payments', payment.id), {
            qbSyncAttempts: (payment.qbSyncAttempts || 0) + 1,
            qbSyncError: errMsg || 'Unknown error',
            qbLastAttempt: new Date().toISOString()
          });
        }
      }
    }
  } catch (err) {
    console.error("Error retrying QB syncs from Firestore:", err);
  } finally {
    _qbFirestoreRetryInProgress = false;
  }
}

// Retry failed QB syncs when coming back online
window.addEventListener('online', retryFailedQBSyncsFromFirestore);

// Retry failed syncs 10 seconds after page load (gives time for QB auth check)
setTimeout(retryFailedQBSyncsFromFirestore, 10000);

/**
 * Bulk resync all receipts after a given receipt number to QuickBooks
 * This is for admin use when receipts weren't sent due to server issues
 * @param {number} lastSentReceiptNumber - Last successfully sent receipt number (e.g., 17)
 */
async function bulkResyncToQuickBooks(lastSentReceiptNumber = 0) {
  const isAdmin = currentEmployee?.role === 'admin';
  if (!isAdmin) {
    alert("Only admins can perform bulk resync.");
    return;
  }

  if (_qbSyncInProgress) {
    alert("A QuickBooks sync is already in progress. Please wait for it to finish.");
    return;
  }
  _qbSyncInProgress = true;

  try {
    const paymentsSnapshot = await getDocs(collection(db, "payments"));
    const allPayments = paymentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const unsentPayments = allPayments.filter(p => {
      if (p.voided) return false;
      if (p.qbSyncStatus === 'synced') return false;
      if (!p.qbSyncStatus) return false;
      const receiptNum = parseInt(p.receiptNumber?.replace(/\D/g, '') || '0', 10);
      return receiptNum > lastSentReceiptNumber;
    });

    if (unsentPayments.length === 0) {
      alert(`No unsent receipts found after #${lastSentReceiptNumber}`);
      return;
    }

    unsentPayments.sort((a, b) => {
      const numA = parseInt(a.receiptNumber?.replace(/\D/g, '') || '0', 10);
      const numB = parseInt(b.receiptNumber?.replace(/\D/g, '') || '0', 10);
      return numA - numB;
    });

    const receiptList = unsentPayments.map(p => p.receiptNumber).join(', ');
    const confirmMsg = `Found ${unsentPayments.length} unsent receipt(s) after #${lastSentReceiptNumber}:\n${receiptList}\n\nProceed with bulk resync to QuickBooks?`;
    
    if (!confirm(confirmMsg)) {
      _qbSyncInProgress = false;
      return;
    }

    // Pre-load reservation data
    const reservationIds = [...new Set(unsentPayments.map(p => p.reservationId).filter(Boolean))];
    const reservationCache = {};
    for (let i = 0; i < reservationIds.length; i += 10) {
      const batch = reservationIds.slice(i, i + 10);
      const results = await Promise.all(batch.map(id => getDoc(doc(db, "reservations", id))));
      results.forEach(snap => {
        if (snap.exists()) reservationCache[snap.id] = { id: snap.id, ...snap.data() };
      });
    }

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    const results = [];

    const processSingle = async (payment) => {
      try {
        const freshDoc = await getDoc(doc(db, "payments", payment.id));
        if (freshDoc.exists()) {
          const freshData = freshDoc.data();
          if (freshData.qbSyncStatus === 'synced') {
            skippedCount++;
            results.push(`⏭️ ${payment.receiptNumber} (already synced)`);
            return;
          }
          if (freshData.voided || freshData.qbSyncStatus === 'voided') {
            skippedCount++;
            results.push(`⏭️ ${payment.receiptNumber} (voided)`);
            return;
          }
        }
      } catch (e) {
        console.warn(`Could not re-check payment ${payment.receiptNumber}:`, e);
      }

      try {
        const reservation = reservationCache[payment.reservationId] || null;
        const customer = customers.find(c => c.id === payment.customerId) || null;
        const qbData = buildQuickBooksPaymentData(payment, reservation, customer);
        const result = await sendToQuickBooks(qbData);

        await updateDoc(doc(db, "payments", payment.id), {
          qbSyncStatus: 'synced',
          qbSyncedAt: new Date().toISOString(),
          qbSyncError: null,
          ...(result?.duplicate ? { qbSyncNote: 'Already existed in QuickBooks' } : {})
        });
        successCount++;
        results.push(`✅ ${payment.receiptNumber}${result?.duplicate ? ' (already in QB)' : ''}`);
      } catch (err) {
        const errMsg = err.message || '';
        if (/already exists|Duplicate|DocNumber/i.test(errMsg)) {
          await updateDoc(doc(db, "payments", payment.id), {
            qbSyncStatus: 'synced',
            qbSyncedAt: new Date().toISOString(),
            qbSyncError: null,
            qbSyncNote: 'Already existed in QuickBooks'
          });
          successCount++;
          results.push(`✅ ${payment.receiptNumber} (already in QB)`);
        } else {
          failCount++;
          results.push(`❌ ${payment.receiptNumber}: ${errMsg}`);
          console.error(`❌ Failed to sync receipt ${payment.receiptNumber}:`, err);
          await updateDoc(doc(db, "payments", payment.id), {
            qbSyncStatus: 'failed',
            qbSyncError: errMsg || 'Unknown error',
            qbLastAttempt: new Date().toISOString()
          });
        }
      }
    };

    // Process in parallel batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < unsentPayments.length; i += BATCH_SIZE) {
      const batch = unsentPayments.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processSingle));
    }

    const summary = `Bulk Resync Complete!\n\n✅ Success: ${successCount}\n❌ Failed: ${failCount}\n⏭️ Skipped: ${skippedCount}\n\nDetails:\n${results.join('\n')}`;
    alert(summary);

    if (typeof loadPaymentsForReservation === 'function' && window.currentReservation) {
      loadPaymentsForReservation(window.currentReservation);
    }

  } catch (err) {
    console.error("Bulk resync error:", err);
    alert(`Bulk resync failed: ${err.message}`);
  } finally {
    _qbSyncInProgress = false;
  }
}

// Make available globally
window.bulkResyncToQuickBooks = bulkResyncToQuickBooks;

/**
 * Send all UNSENT receipts to QuickBooks
 * Uses parallel batching (5 concurrent) for speed while respecting QB rate limits
 */
async function sendUnsentToQuickBooks(startFromReceipt = 0) {
  // Prevent concurrent sync operations
  if (_qbSyncInProgress) {
    alert("A QuickBooks sync is already in progress. Please wait for it to finish.");
    return { success: false, error: 'Sync already in progress' };
  }
  _qbSyncInProgress = true;

  // Progress UI helper
  const progressEl = document.getElementById('qbSyncProgress');
  const updateProgress = (current, total, lastReceipt) => {
    if (progressEl) {
      progressEl.textContent = `Syncing ${current}/${total}... (Receipt #${lastReceipt || '?'})`;
    }
  };

  try {
    // Get all payments from Firestore
    const paymentsSnapshot = await getDocs(collection(db, "payments"));
    const allPayments = paymentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Filter to only unsent payments
    const unsentPayments = allPayments.filter(p => {
      if (p.voided) return false;
      if (p.qbSyncStatus === 'synced') return false;
      if (!p.qbSyncStatus) return false;
      if (startFromReceipt > 0) {
        const receiptNum = parseInt(p.receiptNumber?.replace(/\D/g, '') || '0', 10);
        if (receiptNum < startFromReceipt) return false;
      }
      return true;
    });

    if (unsentPayments.length === 0) {
      showToast('All receipts have been sent to QuickBooks', 'success');
      return { success: true, sent: 0, message: 'All receipts already synced' };
    }

    // Sort by receipt number
    unsentPayments.sort((a, b) => {
      const numA = parseInt(a.receiptNumber?.replace(/\D/g, '') || '0', 10);
      const numB = parseInt(b.receiptNumber?.replace(/\D/g, '') || '0', 10);
      return numA - numB;
    });

    const receiptList = unsentPayments.slice(0, 10).map(p => p.receiptNumber).join(', ');
    const moreText = unsentPayments.length > 10 ? `...and ${unsentPayments.length - 10} more` : '';
    const confirmMsg = `Found ${unsentPayments.length} unsent receipt(s):\n${receiptList}${moreText}\n\nSend to QuickBooks?`;
    
    if (!confirm(confirmMsg)) {
      _qbSyncInProgress = false;
      return { success: false, cancelled: true };
    }

    // Pre-load all reservation data in one pass (avoid N+1 queries)
    const reservationIds = [...new Set(unsentPayments.map(p => p.reservationId).filter(Boolean))];
    const reservationCache = {};
    // Batch Firestore reads in groups of 10 (Firestore 'in' query limit)
    for (let i = 0; i < reservationIds.length; i += 10) {
      const batch = reservationIds.slice(i, i + 10);
      const promises = batch.map(id => getDoc(doc(db, "reservations", id)));
      const results = await Promise.all(promises);
      results.forEach(snap => {
        if (snap.exists()) reservationCache[snap.id] = { id: snap.id, ...snap.data() };
      });
    }

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    let processed = 0;

    // Process a single payment
    const processSingle = async (payment) => {
      // Re-fetch to check for concurrent changes
      const freshPayment = await getDoc(doc(db, "payments", payment.id));
      if (freshPayment.exists()) {
        const freshData = freshPayment.data();
        if (freshData.qbSyncStatus === 'synced' || freshData.voided || freshData.qbSyncStatus === 'voided') {
          skippedCount++;
          processed++;
          updateProgress(processed, unsentPayments.length, payment.receiptNumber);
          return;
        }
      }

      try {
        const reservation = reservationCache[payment.reservationId] || null;
        const customer = customers.find(c => c.id === payment.customerId) || null;
        const qbData = buildQuickBooksPaymentData(payment, reservation, customer);

        const result = await sendToQuickBooks(qbData);

        await updateDoc(doc(db, "payments", payment.id), {
          qbSyncStatus: 'synced',
          qbSyncedAt: new Date().toISOString(),
          qbSyncError: null,
          ...(result?.duplicate ? { qbSyncNote: 'Already existed in QuickBooks' } : {})
        });

        successCount++;
      } catch (err) {
        const errMsg = err.message || '';
        if (/already exists|Duplicate|DocNumber/i.test(errMsg)) {
          await updateDoc(doc(db, "payments", payment.id), {
            qbSyncStatus: 'synced',
            qbSyncedAt: new Date().toISOString(),
            qbSyncError: null,
            qbSyncNote: 'Already existed in QuickBooks'
          });
          successCount++;
        } else {
          failCount++;
          console.error(`❌ Failed to sync receipt ${payment.receiptNumber}:`, err);
          await updateDoc(doc(db, "payments", payment.id), {
            qbSyncStatus: 'failed',
            qbSyncError: errMsg || 'Unknown error',
            qbLastAttempt: new Date().toISOString()
          });
        }
      }
      processed++;
      updateProgress(processed, unsentPayments.length, payment.receiptNumber);
    };

    // Process in parallel batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < unsentPayments.length; i += BATCH_SIZE) {
      const batch = unsentPayments.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(processSingle));
    }

    const message = `QuickBooks Sync Complete!\n\n✅ Sent: ${successCount}\n❌ Failed: ${failCount}\n⏭️ Skipped: ${skippedCount}`;
    alert(message);
    showToast(`${successCount} receipts sent to QuickBooks`, 'success');

    return { success: true, sent: successCount, failed: failCount, skipped: skippedCount };

  } catch (err) {
    console.error("Send unsent to QB error:", err);
    alert(`Failed to send receipts: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    _qbSyncInProgress = false;
    if (progressEl) progressEl.textContent = '';
  }
}

// Make available globally
window.sendUnsentToQuickBooks = sendUnsentToQuickBooks;

// Helper to safely get elements and bind listeners
function getEl(id) {
  return document.getElementById(id) || null;
}
function onClick(id, handler) {
  const el = getEl(id);
  if (el) el.onclick = handler;
}

// Close handler for Manage Payment modal
onClick("closeManagePaymentBtn", () => {
  ModalManager.close('managePaymentModal');
  // Re-open the reservation popup if we came from there
  if (window._lastReservationForPopup) {
    showEditDeletePopup(window._lastReservationForPopup);
    window._lastReservationForPopup = null;
  }
});
// Add handler for Cancel button in Manage Payment Modal
const cancelPaymentBtn = document.getElementById("cancelPaymentBtn");
if (cancelPaymentBtn) {
  cancelPaymentBtn.onclick = () => {
    ModalManager.close('managePaymentModal');
    // Re-open the reservation popup if we came from there
    if (window._lastReservationForPopup) {
      showEditDeletePopup(window._lastReservationForPopup);
      window._lastReservationForPopup = null;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard refresh helper - called after any reservation or payment change
// Defined at initializeApp scope so all handlers can access it
// ─────────────────────────────────────────────────────────────────────────────
async function afterReservationOrPaymentChange() {
  try {
    await fillDashboard();
  } catch (err) {
    console.error("Dashboard refresh failed (data was saved successfully):", err);
  }
}

// 🧾 Manage Payment Modal Logic (global)
async function openManagePaymentModal(reservation) {
  // Fetch fresh reservation data from Firestore to get latest adjustments
  const freshResDoc = await getDoc(doc(db, "reservations", reservation.id));
  if (freshResDoc.exists()) {
    reservation = { id: freshResDoc.id, ...freshResDoc.data() };
  }
  
  ModalManager.open('managePaymentModal');

  // Preview next receipt number (do not generate or reserve)
  const receiptInput = document.getElementById("paymentReceiptInput");
  receiptInput.readOnly = true;
  try {
    const previewReceipt = await getNextPreviewReceiptNumber();
    receiptInput.value = previewReceipt;
  } catch (e) {
    receiptInput.value = "";
  }

  const customer = customers.find(c => c.id === reservation.customerId) || {};
  const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);

  // Fetch all payments for this reservation from cache (live-updated by onSnapshot)
  const allPayments = (window._allPaymentsCache || [])
    .filter(p => p.reservationId === reservation.id)
    .sort(comparePaymentsByTime);
  
  // Active payments exclude voided ones (for calculations)
  const activePayments = allPayments.filter(p => !p.voided);

  // Use the rate entered at reservation (reservationRate)
  const rate = parseFloat(reservation.rate || 0);
  const baseTotal = rate * nights;
  
  // Calculate adjustments (discounts and additional charges stored on reservation)
  const adjustments = reservation.balanceAdjustments || [];
  const totalAdjustment = calcAdjustmentTotal(adjustments);
  
  // Calculate credits (stored on reservation, count toward paid without using receipts)
  const balanceCredits = reservation.balanceCredits || [];
  const totalCredits = calcCreditTotal(balanceCredits);
  
  const total = baseTotal + totalAdjustment;
  const actualPaid = activePayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  const totalPaid = actualPaid + totalCredits;
  const balance = (total - totalPaid);

  // ── AUTO-HEAL paymentStatus ─────────────────────────────────────────────
  // The stored paymentStatus may be stale (e.g. rate was changed during an
  // extension before a previous bug-fix, leaving the field out of sync).
  // Recalculate the correct status here and silently fix it if it differs.
  {
    const correctStatus = totalPaid >= total
      ? 'fully_paid'
      : totalPaid > 0
        ? 'partially_paid'
        : 'unpaid';
    if (reservation.paymentStatus !== correctStatus) {
      console.log(`🔧 Auto-correcting paymentStatus for reservation ${reservation.id}: "${reservation.paymentStatus}" → "${correctStatus}"`);
      updateDoc(doc(db, "reservations", reservation.id), { paymentStatus: correctStatus })
        .catch(err => console.warn("Could not auto-correct paymentStatus:", err));
      reservation.paymentStatus = correctStatus;
    }
  }

  // Helper: recalculate balance from fresh cache (avoids stale closure values)
  const getFreshBalance = () => {
    const freshPayments = (window._allPaymentsCache || [])
      .filter(p => p.reservationId === reservation.id && !p.voided);
    const freshActualPaid = freshPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const freshTotalPaid = freshActualPaid + totalCredits;
    return { totalCost: total, totalPaid: freshTotalPaid, balance: Math.max(0, total - freshTotalPaid) };
  };

  // Fill summary
  document.getElementById("totalPaid").textContent = totalPaid.toFixed(2);
  document.getElementById("balanceRemaining").textContent = Math.max(0, balance).toFixed(2);
  if (document.getElementById("totalDue")) {
    document.getElementById("totalDue").textContent = total.toFixed(2);
  }

  // Show nights count
  const nightsDisplayEl = document.getElementById("nightsDisplay");
  if (nightsDisplayEl) {
    nightsDisplayEl.textContent = `(${nights} night${nights !== 1 ? 's' : ''} × $${rate.toFixed(2)}/night)`;
  }

  // Show overdue tag if departure passed and balance > 0
  const overdueTagEl = document.getElementById("overdueTag");
  if (overdueTagEl) {
    const todayStr = getTodayLocal();
    const isOverdue = reservation.departureDate < todayStr && balance > 0;
    overdueTagEl.style.display = isOverdue ? "inline" : "none";
    if (isOverdue) {
      const daysOverdue = Math.ceil((new Date(todayStr) - new Date(reservation.departureDate)) / (1000 * 60 * 60 * 24));
      overdueTagEl.textContent = `OVERDUE ${daysOverdue} DAY${daysOverdue !== 1 ? 'S' : ''}`;
    }
  }

  // Show credits subtotal (from reservation.balanceCredits, NOT from payments)
  const creditsTotal = balanceCredits.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
  const creditsSubtotalEl = document.getElementById("creditsSubtotal");
  const creditsAmountEl = document.getElementById("creditsAmount");
  if (creditsSubtotalEl && creditsAmountEl) {
    if (creditsTotal > 0) {
      creditsSubtotalEl.style.display = "inline";
      creditsAmountEl.textContent = creditsTotal.toFixed(2);
    } else {
      creditsSubtotalEl.style.display = "none";
    }
  }
  
  // Show adjustment total if any
  const adjustmentDisplay = document.getElementById("adjustmentDisplay");
  const balanceAdjustmentEl = document.getElementById("balanceAdjustment");
  if (adjustmentDisplay && balanceAdjustmentEl) {
    if (adjustments.length > 0) {
      adjustmentDisplay.style.display = "block";
      const adjustmentText = totalAdjustment >= 0 ? `+${totalAdjustment.toFixed(2)}` : totalAdjustment.toFixed(2);
      balanceAdjustmentEl.textContent = adjustmentText;
      balanceAdjustmentEl.style.color = totalAdjustment >= 0 ? 'var(--accent-danger)' : 'var(--accent-success)';
    } else {
      adjustmentDisplay.style.display = "none";
    }
  }

  // Fill payment history with Edit and Void buttons
  const historyList = document.getElementById("paymentHistoryList");
  historyList.innerHTML = "";
  const isAdmin = currentEmployee?.role === 'admin';
  
  // Show admin balance adjustment section for admins
  const adminAdjustSection = document.getElementById("adminBalanceAdjustSection");
  if (adminAdjustSection) {
    adminAdjustSection.style.display = isAdmin ? "block" : "none";
    
    if (isAdmin) {
      // Show adjustment history
      const adjustmentHistoryEl = document.getElementById("adjustmentHistory");
      if (adjustmentHistoryEl && adjustments.length > 0) {
        adjustmentHistoryEl.innerHTML = "<strong>Adjustment History:</strong><br>" + adjustments.map((adj, idx) => {
          const sign = adj.type === 'discount' ? '-' : '+';
          const color = adj.type === 'discount' ? '#10b981' : '#ef4444';
          const dateStr = adj.timestamp ? formatDateTimeDMY(adj.timestamp) : 'N/A';
          return `<div style="padding:4px 0;border-bottom:1px solid var(--border-light);">
            <span style="color:${color};font-weight:600;">${sign}$${adj.amount.toFixed(2)}</span> - ${adj.reason}
            <span style="color:var(--text-muted);font-size:0.8em;"> (${adj.appliedBy || 'Admin'} on ${dateStr})</span>
            <button class="remove-adjustment-btn" data-index="${idx}" style="background:#ef4444;color:#fff;border:none;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:0.75em;margin-left:8px;">✕</button>
          </div>`;
        }).join('');
      } else if (adjustmentHistoryEl) {
        adjustmentHistoryEl.innerHTML = "<em style='color:var(--text-muted);'>No adjustments applied.</em>";
      }
      
      // Setup adjustment form handler
      setupAdminBalanceAdjustment(reservation, baseTotal, totalPaid);
    }
  }

  // Show admin credit section for admins
  const adminCreditSection = document.getElementById("adminCreditSection");
  if (adminCreditSection) {
    adminCreditSection.style.display = isAdmin ? "block" : "none";
    if (isAdmin) {
      // Show credit history with remove buttons
      const creditHistoryEl = document.getElementById("creditHistory");
      if (creditHistoryEl && balanceCredits.length > 0) {
        creditHistoryEl.innerHTML = "<strong>Credit History:</strong><br>" + balanceCredits.map((cr, idx) => {
          const dateStr = cr.timestamp ? formatDateTimeDMY(cr.timestamp) : 'N/A';
          return `<div style="padding:4px 0;border-bottom:1px solid var(--border-light);">
            <span style="color:var(--accent-primary);font-weight:600;">$${parseFloat(cr.amount).toFixed(2)}</span> - ${escapeHTML(cr.reason)}
            ${cr.showOnForm ? '<span style="font-size:0.7em;color:var(--accent-success);margin-left:4px;">[on form]</span>' : ''}
            <span style="color:var(--text-muted);font-size:0.8em;"> (${cr.appliedBy || 'Admin'} on ${dateStr})</span>
            <button class="remove-credit-btn" data-index="${idx}" style="background:#ef4444;color:#fff;border:none;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:0.75em;margin-left:8px;">✕</button>
          </div>`;
        }).join('');

        // Handle remove credit buttons
        creditHistoryEl.querySelectorAll('.remove-credit-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const index = parseInt(btn.dataset.index);
            if (!confirm(`Remove this credit of $${parseFloat(balanceCredits[index].amount).toFixed(2)}?`)) return;
            try {
              const reservationRef = doc(db, "reservations", reservation.id);
              const updatedCredits = [...balanceCredits];
              updatedCredits.splice(index, 1);
              await updateDoc(reservationRef, { balanceCredits: updatedCredits });

              // Recalculate paymentStatus
              const rmNights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
              const rmBaseTotal = (parseFloat(reservation.rate) || 0) * rmNights;
              const rmTotal = rmBaseTotal + calcAdjustmentTotal(reservation.balanceAdjustments || []);
              const rmActualPaid = (window._allPaymentsCache || [])
                .filter(p => p.reservationId === reservation.id && !p.voided)
                .reduce((s, p) => s + parseFloat(p.amount || 0), 0);
              const rmCreditTotal = calcCreditTotal(updatedCredits);
              const rmTotalPaid = rmActualPaid + rmCreditTotal;
              const rmStatus = rmTotalPaid >= rmTotal ? 'fully_paid' : rmTotalPaid > 0 ? 'partially_paid' : 'unpaid';
              await updateDoc(reservationRef, { paymentStatus: rmStatus });

              if (window._reservationsCache) {
                const ci = window._reservationsCache.findIndex(r => r.id === reservation.id);
                if (ci !== -1) window._reservationsCache[ci] = { ...window._reservationsCache[ci], balanceCredits: updatedCredits };
              }

              await openManagePaymentModal({ ...reservation, balanceCredits: updatedCredits });
              await afterReservationOrPaymentChange();
            } catch (err) {
              console.error("Error removing credit:", err);
              alert("Failed to remove credit.");
            }
          });
        });
      } else if (creditHistoryEl) {
        creditHistoryEl.innerHTML = "<em style='color:var(--text-muted);'>No credits applied.</em>";
      }

      setupAdminCredit(reservation);
    }
  }
  
  allPayments.forEach(p => {
    const div = document.createElement("div");
    div.className = "payment-entry";
    const methodDisplay = p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : "N/A";
    const isVoided = p.voided === true;
    
    // QB sync status indicator
    let qbStatus = '';
    if (p.qbSyncStatus === 'synced') {
      qbStatus = '<span style="color:#22c55e;font-size:0.75em;margin-left:8px;" title="Synced to QuickBooks">QB</span>';
    } else if (p.qbSyncStatus === 'failed') {
      qbStatus = '<span style="color:#ef4444;font-size:0.75em;margin-left:8px;" title="Failed to sync to QuickBooks">QB</span>';
    } else if (p.qbSyncStatus === 'queued') {
      qbStatus = '<span style="color:#f59e0b;font-size:0.75em;margin-left:8px;" title="Queued for QuickBooks sync">QB</span>';
    }
    
    if (isVoided) {
      // Show voided receipt with strikethrough - admin can unvoid
      const unvoidButton = isAdmin ? `<button class="unvoid-payment-btn" data-id="${p.id}" data-receipt="${p.receiptNumber}" style="background:#10b981;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8em;margin-top:6px;">↩️ Unvoid</button>` : '';
      div.innerHTML = `
        <div style="text-decoration:line-through;color:#888;"><strong>Receipt:</strong> ${escapeHTML(p.receiptNumber)} <span style="color:#ef4444;font-weight:bold;">[VOIDED]</span></div>
        <div style="text-decoration:line-through;color:#888;"><strong>Amount:</strong> $${parseFloat(p.amount).toFixed(2)}</div>
        <div style="text-decoration:line-through;color:#888;"><strong>Method:</strong> ${escapeHTML(methodDisplay)}</div>
        <div style="font-size:0.75em;color:#888;margin-top:4px;">Voided: ${p.voidedAt ? formatDateTimeDMY(p.voidedAt) : 'N/A'}${p.voidReason ? ' - ' + escapeHTML(p.voidReason) : ''}</div>
        ${unvoidButton}
      `;
    } else {
      // Active receipt with Edit, Void (admin only), Print buttons, and QB status/push for admin
      const qbButton = isAdmin ? `<button class="qb-push-btn" data-id="${p.id}" style="background:#7c3aed;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8em;" title="Push to QuickBooks">QB</button>` : '';
      const voidButton = isAdmin ? `<button class="void-payment-btn" data-id="${p.id}" data-receipt="${p.receiptNumber}" style="background:#f59e0b;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8em;">Void</button>` : '';
      
      div.innerHTML = `
        <div><strong>Receipt:</strong> ${escapeHTML(p.receiptNumber)}${qbStatus}</div>
        <div><strong>Amount:</strong> $${parseFloat(p.amount).toFixed(2)}</div>
        <div><strong>Method:</strong> ${escapeHTML(methodDisplay)}</div>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center;">
          <button class="print-receipt-btn" data-id="${p.id}" data-receipt="${p.receiptNumber}" data-amount="${p.amount}" data-method="${methodDisplay}" data-date="${p.timestamp ? formatDateDMY(p.timestamp.toDate ? p.timestamp.toDate() : p.timestamp) : 'N/A'}" style="background:#4caf50;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8em;">Print</button>
          <button class="edit-payment-btn" data-id="${p.id}" style="background:#2196f3;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8em;">Edit</button>
          ${voidButton}
          ${qbButton ? `<span style="margin-left:auto;">${qbButton}</span>` : ''}
        </div>
      `;
    }
    historyList.appendChild(div);
  });

  /* --- Edit Customer Info Button Handler ---
document.getElementById("editCustomerBtn")?.addEventListener("click", () => {
  if (!selectedCustomerId) {
    alert("Please select a customer first.");
    return;
  }
  const customer = customers.find(c => c.id === selectedCustomerId);
  if (!customer) {
    alert("Customer not found.");
    return;
  }
  // Fill fields and make editable
  const nameInput = document.getElementById("editCustomerName");
  const phoneInput = document.getElementById("editCustomerPhone");
  const addressInput = document.getElementById("editCustomerAddress");
  const emailInput = document.getElementById("editCustomerEmail");
  nameInput.value = customer.name || "";
  nameInput.readOnly = false;
  phoneInput.value = customer.telephone || "";
  phoneInput.readOnly = false;
  addressInput.value = customer.address || "";
  addressInput.readOnly = false;
  emailInput.value = customer.email || "";
  emailInput.readOnly = false;
  document.getElementById("editCustomerModal").style.display = "block";

  // Save button (new: saveCustomerEditBtn)
  const saveBtn = document.getElementById("saveCustomerEditBtn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const name = nameInput.value.trim();
      const telephone = phoneInput.value.trim();
      const address = addressInput.value.trim();
      const email = emailInput.value.trim();
      if (!name || !telephone || !address) {
        alert("Name, phone, and address are required.");
        return;
      }
      try {
        await updateDoc(doc(db, "customers", selectedCustomerId), {
          name,
          telephone,
          address,
          email
        });
        // Update local cache
        const idx = customers.findIndex(c => c.id === selectedCustomerId);
        if (idx !== -1) {
          customers[idx] = { ...customers[idx], name, telephone, address, email };
        }
        alert("Customer information updated.");
        document.getElementById("editCustomerModal").style.display = "none";
      } catch (err) {
        alert("Failed to update customer.");
        console.error(err);
      }
    };
  }
  // Cancel button (new: cancelCustomerEditBtn)
  const cancelBtn = document.getElementById("cancelCustomerEditBtn");
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      document.getElementById("editCustomerModal").style.display = "none";
    };
  }
});*/

// summaryBtn setup (runs each time modal opens to rebind)
const summaryBtn = document.getElementById("openSummaryModalBtn");
if (summaryBtn) {
  summaryBtn.onclick = () => openSummaryModal();
}

  document.querySelectorAll(".edit-payment-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const paymentId = btn.getAttribute("data-id");
      const paymentRef = doc(db, "payments", paymentId);
      const paymentSnap = await getDoc(paymentRef);
      if (!paymentSnap.exists()) {
        alert("Payment not found.");
        return;
      }
      const paymentData = paymentSnap.data();
      const currentMethod = paymentData.method || "";

      // Build popup
      const editPopup = document.createElement("div");
      editPopup.style.position = "fixed";
      editPopup.style.left = "50%";
      editPopup.style.top = "50%";
      editPopup.style.transform = "translate(-50%, -50%)";
      editPopup.style.background = "#ffffff";
      editPopup.style.padding = "24px";
      editPopup.style.zIndex = "10000";
      editPopup.style.borderRadius = "10px";
      editPopup.style.boxShadow = "0 4px 20px rgba(0,0,0,0.25)";
      editPopup.style.zIndex = "3000";
      editPopup.style.width = "320px";
      editPopup.style.color = "#333";

      editPopup.innerHTML = `
        <h3 style="margin-top:0;margin-bottom:16px;color:#222;">Edit Payment</h3>
        <label style="display:block;margin-bottom:4px;color:#333;font-weight:500;">Amount:</label>
        <input id="editPaymentAmount" type="number" step="0.01" value="${paymentData.amount}" style="width:100%;padding:8px;margin-bottom:12px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#333;font-size:1em;">
        <label style="display:block;margin-bottom:4px;color:#333;font-weight:500;">Payment Method:</label>
        <select id="editPaymentMethod" style="width:100%;padding:8px;margin-bottom:12px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#333;font-size:1em;">
          <option value="">-- Select Method --</option>
          <option value="cash" ${currentMethod === "cash" ? "selected" : ""}>Cash</option>
          <option value="card" ${currentMethod === "card" ? "selected" : ""}>Card</option>
          <option value="cheque" ${currentMethod === "cheque" ? "selected" : ""}>Cheque</option>
          <option value="mobile" ${currentMethod === "mobile" ? "selected" : ""}>Mobile</option>
        </select>
        <label style="display:block;margin-bottom:4px;color:#333;font-weight:500;">Note:</label>
        <textarea id="editPaymentNote" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#333;font-size:1em;min-height:60px;">${paymentData.note || ""}</textarea>
        <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px;">
          <button id="cancelEditPayment" style="padding:8px 16px;border:none;background:#e0e0e0;color:#333;border-radius:6px;cursor:pointer;font-size:1em;">Cancel</button>
          <button id="saveEditPayment" style="padding:8px 16px;border:none;background:#4caf50;color:#fff;border-radius:6px;cursor:pointer;font-size:1em;">Save</button>
        </div>
      `;
      document.body.appendChild(editPopup);

      document.getElementById("cancelEditPayment").onclick = () => editPopup.remove();

      document.getElementById("saveEditPayment").onclick = async () => {
        const saveEditBtn = document.getElementById("saveEditPayment");
        if (saveEditBtn.disabled) return;
        saveEditBtn.disabled = true;
        saveEditBtn.textContent = "Saving...";
        const newAmount = parseFloat(document.getElementById("editPaymentAmount").value);
        const newMethod = document.getElementById("editPaymentMethod").value;
        const newNote = document.getElementById("editPaymentNote").value.trim();
        if (isNaN(newAmount) || newAmount <= 0) {
          alert("Please enter a valid amount.");
          saveEditBtn.disabled = false;
          saveEditBtn.textContent = "Save";
          return;
        }
        try {
        await updateDoc(paymentRef, {
          amount: newAmount,
          method: newMethod,
          note: newNote
        });

        // Recalculate payment status after editing payment amount
        const amountChanged = parseFloat(paymentData.amount) !== newAmount;
        if (amountChanged) {
          // Reset QB sync status so the updated amount gets re-sent to QuickBooks
          try {
            await updateDoc(paymentRef, {
              qbSyncStatus: 'pending',
              qbSyncError: null,
              qbSyncNote: `Amount edited from $${parseFloat(paymentData.amount).toFixed(2)} to $${newAmount.toFixed(2)} — re-queued for QB sync`
            });
          } catch (qbErr) {
            console.warn("Could not reset QB sync status:", qbErr);
          }

          try {
            // Calculate new total paid
            const paymentsSnapshot = await getDocs(collection(db, "payments"));
            const allResPayments = paymentsSnapshot.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(p => p.reservationId === reservation.id && !p.voided);
            const totalPaid = allResPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
            
            // Calculate total due
            const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
            const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
            const adjustments = reservation.balanceAdjustments || [];
            const totalAdjustment = calcAdjustmentTotal(adjustments);
            const totalDue = baseTotal + totalAdjustment;
            
            // Determine new payment status
            let newStatus = "not_paid";
            if (totalPaid >= totalDue) {
              newStatus = "fully_paid";
            } else if (totalPaid > 0) {
              newStatus = "partially_paid";
            }
            
            // Update reservation
            await updateDoc(doc(db, "reservations", reservation.id), {
              paymentStatus: newStatus
            });
            
            // Update local reservation and cache
            reservation.paymentStatus = newStatus;
            if (window._reservationsCache) {
              const cacheIndex = window._reservationsCache.findIndex(r => r.id === reservation.id);
              if (cacheIndex !== -1) {
                window._reservationsCache[cacheIndex] = { ...window._reservationsCache[cacheIndex], paymentStatus: newStatus };
                console.log('✅ Updated reservation payment status in cache after payment edit:', reservation.id);
              }
            }
          } catch (err) {
            console.warn("Could not recalculate payment status:", err);
          }
        }

        // Audit log for payment update
        await auditLog(AUDIT_ACTIONS.PAYMENT_UPDATE, {
          receiptNumber: paymentData.receiptNumber,
          previousAmount: paymentData.amount,
          newAmount: newAmount,
          previousMethod: paymentData.method,
          newMethod: newMethod,
          note: newNote
        }, 'payment', paymentId);

        alert("Payment updated successfully.");
        editPopup.remove();
        openManagePaymentModal(reservation); // Refresh modal
        } catch (err) {
          console.error("Failed to update payment:", err);
          alert("Failed to update payment. Please try again.");
          saveEditBtn.disabled = false;
          saveEditBtn.textContent = "Save";
        }
      };
    });
  });

  // Attach void button events (preserves receipt number for audit trail)
  document.querySelectorAll(".void-payment-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const paymentId = btn.getAttribute("data-id");
      const receiptNumber = btn.getAttribute("data-receipt");
      
      // Ask for void reason
      const voidReason = prompt(`Void receipt #${receiptNumber}?\n\nEnter reason for voiding (optional):`);
      if (voidReason === null) return; // User cancelled

      try {
        // Mark payment as voided (don't delete - preserves audit trail)
        const paymentRef = doc(db, "payments", paymentId);
        await updateDoc(paymentRef, {
          voided: true,
          voidedAt: new Date().toISOString(),
          voidReason: voidReason || "No reason provided",
          qbSyncStatus: 'voided',
          qbSyncNote: `Voided — will not be sent to QuickBooks`
        });

        // Recalculate payment status (exclude voided payments)
        const remainingActivePayments = activePayments.filter(p => p.id !== paymentId);
        const totalPaidAfterVoid = remainingActivePayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
        const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
        // Include balance adjustments
        const adjustments = reservation.balanceAdjustments || [];
        const totalAdjustment = calcAdjustmentTotal(adjustments);
        const totalDue = baseTotal + totalAdjustment;
        let newStatus = "not_paid";
        if (totalPaidAfterVoid >= totalDue) {
          newStatus = "fully_paid";
        } else if (totalPaidAfterVoid > 0) {
          newStatus = "partially_paid";
        }

        const reservationRef = doc(db, "reservations", reservation.id);
        await updateDoc(reservationRef, {
          paymentStatus: newStatus
        });

        // Update local reservation object
        reservation.paymentStatus = newStatus;
        
        // CRITICAL: Update the global cache to keep batch close/reports consistent
        if (window._reservationsCache) {
          const cacheIndex = window._reservationsCache.findIndex(r => r.id === reservation.id);
          if (cacheIndex !== -1) {
            window._reservationsCache[cacheIndex] = { ...window._reservationsCache[cacheIndex], paymentStatus: newStatus };
            console.log('✅ Updated reservation payment status in cache after void:', reservation.id);
          }
        }

        // Log to audit trail
        await auditLog(AUDIT_ACTIONS.PAYMENT_VOID, {
          receiptNumber: receiptNumber,
          amount: activePayments.find(p => p.id === paymentId)?.amount,
          reason: voidReason || "No reason provided",
          reservationId: reservation.id,
          customerName: customer?.name
        }, 'payment', paymentId);

        alert(`Receipt #${receiptNumber} has been voided.\n\nThe receipt number is preserved for audit purposes.`);
        openManagePaymentModal(reservation); // Refresh modal
        await afterReservationOrPaymentChange(); // Update dashboard
      } catch (err) {
        console.error("Error voiding payment:", err);
        alert("Failed to void payment. Please try again.");
      }
    });
  });

  // Attach unvoid button events (admin only - restore voided payments)
  document.querySelectorAll(".unvoid-payment-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const paymentId = btn.getAttribute("data-id");
      const receiptNumber = btn.getAttribute("data-receipt");
      
      // Confirm unvoid action
      if (!confirm(`Restore receipt #${receiptNumber}?\n\nThis will make the payment active again and recalculate the reservation balance.`)) {
        return;
      }

      try {
        // Get the payment to restore
        const paymentDoc = await getDoc(doc(db, "payments", paymentId));
        if (!paymentDoc.exists()) {
          alert("Payment not found.");
          return;
        }
        const payment = paymentDoc.data();

        // Remove voided status
        const paymentRef = doc(db, "payments", paymentId);
        await updateDoc(paymentRef, {
          voided: false,
          unvoidedAt: new Date().toISOString(),
          unvoidedBy: currentEmployee?.uid || 'unknown',
          unvoidedByName: currentEmployee?.displayName || currentEmployee?.name || 'Unknown',
          qbSyncStatus: 'pending',
          qbSyncNote: 'Unvoided — re-queued for QB sync'
        });

        // Recalculate payment status (now include this payment again)
        const allPaymentsSnapshot = await getDocs(collection(db, "payments"));
        const allPaymentsForRes = allPaymentsSnapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(p => p.reservationId === reservation.id && !p.voided);
        
        const totalPaidAfterUnvoid = allPaymentsForRes.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
        const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
        // Include balance adjustments
        const adjustments = reservation.balanceAdjustments || [];
        const totalAdjustment = calcAdjustmentTotal(adjustments);
        const totalDue = baseTotal + totalAdjustment;
        
        let newStatus = "not_paid";
        if (totalPaidAfterUnvoid >= totalDue) {
          newStatus = "fully_paid";
        } else if (totalPaidAfterUnvoid > 0) {
          newStatus = "partially_paid";
        }

        const reservationRef = doc(db, "reservations", reservation.id);
        await updateDoc(reservationRef, {
          paymentStatus: newStatus
        });

        // Update local reservation object
        reservation.paymentStatus = newStatus;
        
        // Update global cache
        if (window._reservationsCache) {
          const cacheIndex = window._reservationsCache.findIndex(r => r.id === reservation.id);
          if (cacheIndex !== -1) {
            window._reservationsCache[cacheIndex] = { ...window._reservationsCache[cacheIndex], paymentStatus: newStatus };
            console.log('✅ Updated reservation payment status in cache after unvoid:', reservation.id);
          }
        }

        // Log to audit trail
        await auditLog(AUDIT_ACTIONS.PAYMENT_UNVOID, {
          receiptNumber: receiptNumber,
          amount: payment.amount,
          reservationId: reservation.id,
          customerName: customer?.name,
          previousVoidReason: payment.voidReason
        }, 'payment', paymentId);

        alert(`Receipt #${receiptNumber} has been restored.`);
        openManagePaymentModal(reservation); // Refresh modal
        await afterReservationOrPaymentChange(); // Update dashboard
      } catch (err) {
        console.error("Error unvoiding payment:", err);
        alert("Failed to restore payment. Please try again.");
      }
    });
  });

  // Attach print receipt button events
  document.querySelectorAll(".print-receipt-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const receiptNumber = btn.getAttribute("data-receipt");
      const amount = parseFloat(btn.getAttribute("data-amount")).toFixed(2);
      const method = btn.getAttribute("data-method");
      const date = btn.getAttribute("data-date");
      
      const freshBal = getFreshBalance();
      printSingleReceipt({
        receiptNumber,
        amount,
        method,
        date,
        customerName: customer?.name || 'Guest',
        room: reservation?.roomNumber || 'N/A',
        arrivalDate: reservation?.arrivalDate || 'N/A',
        departureDate: reservation?.departureDate || 'N/A',
        totalCost: freshBal.totalCost.toFixed(2),
        totalPaid: freshBal.totalPaid.toFixed(2),
        balance: freshBal.balance.toFixed(2)
      });
    });
  });

  // Attach QB push button events (admin only)
  document.querySelectorAll(".qb-push-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const paymentId = btn.getAttribute("data-id");
      
      // Disable button and show loading state
      btn.disabled = true;
      const originalText = btn.innerHTML;
      btn.innerHTML = '...';
      
      try {
        const result = await manualPushToQuickBooks(paymentId);
        
        if (result.success) {
          alert("Payment successfully pushed to QuickBooks!");
        } else if (result.queued) {
          alert("Offline - payment queued for sync when back online.");
        } else {
          alert("Failed to push to QuickBooks: " + (result.error || 'Unknown error'));
        }
        
        // Refresh modal to show updated status
        openManagePaymentModal(reservation);
      } catch (err) {
        console.error("QB push error:", err);
        alert("Error pushing to QuickBooks: " + err.message);
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    });
  });

  // 🔹 Email receipt button
  const sendBtn = document.getElementById("send-receipt-email-btn");
  const clonedBtn = sendBtn.cloneNode(true);
  sendBtn.parentNode.replaceChild(clonedBtn, sendBtn);
  clonedBtn.addEventListener("click", async () => {
    const selectModal = document.getElementById("selectReceiptModal");
    const dropdown = document.getElementById("receiptSelectDropdown");
    const closeBtn = document.getElementById("closeSelectReceiptModalBtn");
    const cancelBtn = document.getElementById("cancelReceiptSelectBtn");
    const sendSelectedBtn = document.getElementById("sendSelectedReceiptBtn");

    dropdown.innerHTML = '<option value="">-- Select Receipt --</option>';
    activePayments.forEach(p => {
      dropdown.innerHTML += `<option value="${p.receiptNumber}">${p.receiptNumber} - $${parseFloat(p.amount).toFixed(2)}</option>`;
    });

    ModalManager.open('selectReceiptModal');
    closeBtn.onclick = cancelBtn.onclick = () => ModalManager.close('selectReceiptModal');

    sendSelectedBtn.onclick = async () => {
      const selectedReceipt = dropdown.value;
      if (!selectedReceipt) {
        alert("Please select a receipt to send.");
        return;
      }
      const payment = activePayments.find(p => p.receiptNumber === selectedReceipt);
      if (!payment) {
        alert("Selected receipt not found.");
        return;
      }

      const freshBal = getFreshBalance();
      const templateParams = {
        customer_name: customer.name || '',
        customer_email: customer.email || '',
        customer_phone: customer.telephone || '',
        customer_address: customer.address || '',
        checkin: formatDateDMY(reservation.arrivalDate),
        checkout: formatDateDMY(reservation.departureDate),
        room: reservation.roomNumber || '',
        amount_paid: parseFloat(payment.amount).toFixed(2),
        balance: freshBal.balance.toFixed(2),
        total_amount: freshBal.totalCost.toFixed(2),
        receipt_number: payment.receiptNumber,
        special_offer: 'None',
        notes: reservation.note && reservation.note.trim() !== '' 
          ? `Notes: ${reservation.note}` 
          : 'None'
      };

      try {
        const smsMessage = buildSMSReceipt({
          receiptNumber: payment.receiptNumber,
          room: reservation.roomNumber,
          checkIn: formatDateDMY(reservation.arrivalDate),
          checkOut: formatDateDMY(reservation.departureDate),
          amountPaid: parseFloat(payment.amount).toFixed(2),
          balance: freshBal.balance.toFixed(2)
        });
        await sendSMS(customer.telephone, smsMessage);
        alert("Receipt SMS sent successfully.");
      } catch (err) {
        console.error("SMS error:", err);
        alert("Failed to send receipt SMS.");
      } finally {
        ModalManager.close('selectReceiptModal');
      }
    };
  });

  // 🔹 Print receipt button (updated to match popup style)
  const printBtn = document.getElementById("print-receipt-btn");
  const clonedPrintBtn = printBtn.cloneNode(true);
  printBtn.parentNode.replaceChild(clonedPrintBtn, printBtn);
  clonedPrintBtn.addEventListener("click", () => {
    const printModal = document.getElementById("printReceiptModal");
    const receiptList = document.getElementById("printReceiptList");
    const closeBtn = document.getElementById("closePrintReceiptModalBtn");
    const cancelBtn = document.getElementById("cancelPrintReceiptBtn");
    const confirmBtn = document.getElementById("confirmPrintReceiptBtn");

    receiptList.innerHTML = "";
    activePayments.forEach(p => {
      receiptList.innerHTML += `
        <label style="display:block;">
          <input type="checkbox" name="selectedPrintReceipts" value="${p.receiptNumber}">
          Receipt #${p.receiptNumber} - $${parseFloat(p.amount).toFixed(2)} - ${formatDateDMY(p.timestamp)}
        </label>
      `;
    });

    ModalManager.open('printReceiptModal');
    closeBtn.onclick = cancelBtn.onclick = () => ModalManager.close('printReceiptModal');

    confirmBtn.onclick = () => {
      // SPAM PREVENTION: Disable button while processing
      if (confirmBtn.disabled) return;
      confirmBtn.disabled = true;
      const originalText = confirmBtn.textContent;
      confirmBtn.textContent = "Printing...";
      
      const selectedReceipts = Array.from(document.querySelectorAll('input[name="selectedPrintReceipts"]:checked'))
        .map(input => input.value);
      if (selectedReceipts.length === 0) {
        alert("Please select at least one receipt to print.");
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;
        return;
      }
      const selectedPayments = activePayments.filter(p => selectedReceipts.includes(p.receiptNumber));
      const totalPaidSelected = selectedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
      const freshBal = getFreshBalance();
      const balanceRemaining = freshBal.balance;
      
      // Generate compact receipt rows for table layout
      let receiptsRows = selectedPayments.map(p => {
        const normalizedTs = normalizeTimestamp(p.timestamp);
        const paymentDate = normalizedTs ? formatDateDMY(normalizedTs) : 'N/A';
        const paymentTime = normalizedTs ? new Date(normalizedTs).toLocaleTimeString() : 'N/A';
        const paymentMethod = p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : 'N/A';
        
        return `
          <tr>
            <td>${p.receiptNumber}</td>
            <td>${paymentDate}</td>
            <td>${paymentTime}</td>
            <td style="font-weight:600;color:#10b981;">$${parseFloat(p.amount).toFixed(2)}</td>
            <td>${paymentMethod}</td>
          </tr>
        `;
      }).join('');
      
      const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Receipt - ${escapeHTML(customer.name || 'Guest')}</title>
          <style>
            @page { size: letter portrait; margin: 0.3in; }
            body { font-family: Arial, sans-serif; padding: 8px 12px; color: #222; font-size: 11px; margin: 0; }
            h2 { text-align: center; margin: 0 0 6px 0; font-size: 14px; }
            h3 { margin: 0 0 4px 0; font-size: 11px; }
            .info-row { display: flex; gap: 24px; margin-bottom: 6px; }
            .info-block { flex: 1; background: #f5f5f5; padding: 6px 8px; border-radius: 4px; }
            .info-block table { width: 100%; border-collapse: collapse; }
            .info-block td { padding: 1px 4px; vertical-align: top; }
            .info-block td:first-child { font-weight: 600; white-space: nowrap; width: 70px; }
            .receipts-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
            .receipts-table th { background: #e5e7eb; padding: 3px 6px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid #ccc; }
            .receipts-table td { padding: 3px 6px; border-bottom: 1px solid #eee; }
            .receipts-table tr:nth-child(even) { background: #f9fafb; }
            .footer { text-align: center; margin-top: 8px; color: #666; font-size: 9px; }
          </style>
        </head>
        <body>
          <h2>Receipt Details</h2>
          
          <div class="info-row">
            <div class="info-block">
              <h3>Customer</h3>
              <table>
                <tr><td>Name:</td><td>${escapeHTML(customer.name || 'Unknown')}</td></tr>
                <tr><td>Phone:</td><td>${escapeHTML(customer.telephone || 'N/A')}</td></tr>
                <tr><td>Email:</td><td>${escapeHTML(customer.email || 'N/A')}</td></tr>
                <tr><td>Address:</td><td>${escapeHTML(customer.address || 'N/A')}</td></tr>
              </table>
            </div>
            <div class="info-block">
              <h3>Reservation</h3>
              <table>
                <tr><td>Room:</td><td>${reservation.roomNumber}</td></tr>
                <tr><td>Check-In:</td><td>${formatDateDMY(reservation.arrivalDate)}</td></tr>
                <tr><td>Check-Out:</td><td>${formatDateDMY(reservation.departureDate)}</td></tr>
                <tr><td>Total Cost:</td><td>$${freshBal.totalCost.toFixed(2)}</td></tr>
                <tr><td>Total Paid:</td><td style="color:#10b981;">$${freshBal.totalPaid.toFixed(2)}</td></tr>
                <tr><td>Balance:</td><td style="color:${balanceRemaining > 0 ? '#ef4444' : '#10b981'};">$${balanceRemaining.toFixed(2)}</td></tr>
              </table>
            </div>
          </div>
          
          <h3>Selected Receipts (${selectedPayments.length})</h3>
          <table class="receipts-table">
            <thead>
              <tr><th>#</th><th>Date</th><th>Time</th><th>Amount</th><th>Method</th></tr>
            </thead>
            <tbody>
              ${receiptsRows}
            </tbody>
            <tfoot>
              <tr style="font-weight:700;border-top:2px solid #333;">
                <td colspan="3" style="text-align:right;padding:4px 6px;">Selected Total:</td>
                <td style="color:#10b981;padding:4px 6px;">$${totalPaidSelected.toFixed(2)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          
          <p class="footer">Printed: ${formatDateTimeDMY(new Date())}</p>
        </body>
        </html>
      `;
      
      const printWindow = window.open('', '_blank');
      printWindow.document.write(printHTML);
      printWindow.document.close();
      printWindow.print();
      ModalManager.close('printReceiptModal');
      
      // Re-enable button after printing
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalText;
    };
  });

  // ===========================================================================
  // SAVE NEW PAYMENT
  // ===========================================================================
  // When user clicks "Save Payment" in the manage payments modal:
  // 1. Generate a unique receipt number
  // 2. Save the payment to the database
  // 3. Update the reservation's payment status
  // 4. Try to sync to QuickBooks (if connected)
  
  document.getElementById("savePaymentBtn").onclick = async function() {
    const btn = this;
    
    // Prevent double-click spam (user might click multiple times)
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Saving...";
    
    // Validate the payment amount
    const addAmount = parseFloat(document.getElementById("paymentAmountInput").value);
    const paymentMethod = document.getElementById("paymentMethodInput")?.value || "";
    if (isNaN(addAmount) || addAmount <= 0) {
      alert("Enter a valid amount.");
      btn.disabled = false;
      btn.textContent = "Save Payment";
      return;
    }
    if (!paymentMethod) {
      alert("Please select a payment method.");
      btn.disabled = false;
      btn.textContent = "Save Payment";
      return;
    }
    
    // Generate receipt number and save payment in one transaction
    // This ensures the receipt number is unique even if multiple people save at once
    const receiptCounterRef = doc(db, "counters", "receipt_counter");
    try {
      let receipt = "";
      let paymentDocId = "";
      await runTransaction(db, async (transaction) => {
        // Get and increment receipt counter
        const counterDoc = await transaction.get(receiptCounterRef);
        let current = counterDoc.exists() ? counterDoc.data().current : 0;
        const next = current + 1;
        receipt = String(next).padStart(5, "0");  // e.g., "00042"
        transaction.update(receiptCounterRef, { current: next });
        
        // Create the payment record
        const paymentRef = doc(collection(db, "payments"));
        paymentDocId = paymentRef.id;
        const recorder = getCurrentEmployeeInfo();
        
        transaction.set(paymentRef, {
          customerId: reservation.customerId,
          reservationId: reservation.id,
          amount: addAmount,
          method: paymentMethod,
          receiptNumber: receipt,
          timestamp: new Date().toISOString(),
          recordedBy: recorder.uid,
          recordedByName: recorder.name,
          qbSyncStatus: 'pending',
          qbSyncAttempts: 0
        });
        
        // Calculate new payment status for the reservation
        const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
        const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
        const adjustments = reservation.balanceAdjustments || [];
        const totalAdjustment = calcAdjustmentTotal(adjustments);
        const total = baseTotal + totalAdjustment;
        
        // Calculate total paid from cache (new payment not in cache yet, so add manually)
        const cachedPayments = (window._allPaymentsCache || [])
          .filter(p => p.reservationId === reservation.id && !p.voided);
        const totalPaid = cachedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) + addAmount;
        
        // Update reservation status: fully_paid if all paid, otherwise partially_paid
        const newStatus = totalPaid >= total ? "fully_paid" : "partially_paid";
        const reservationRef = doc(db, "reservations", reservation.id);
        const updatedPaymentIds = [...(reservation.paymentIds || []), paymentRef.id];
        transaction.update(reservationRef, {
          paymentIds: updatedPaymentIds,
          paymentStatus: newStatus
        });
      });
      
      // Push to QuickBooks (moved to separate try/catch below so QB errors
      // don't show "Failed to add payment" when the payment was already saved)
      const payment = {
        id: paymentDocId,
        receiptNumber: receipt,
        amount: addAmount,
        method: paymentMethod,
        timestamp: new Date().toISOString(),
        recordedByName: currentEmployee?.name || window._currentEmployee?.name || 'Staff',
        customerId: reservation.customerId,
        reservationId: reservation.id
      };
      const qbData = buildQuickBooksPaymentData(payment, reservation, customer, currentEmployee);

      // Audit log
      await auditLog(AUDIT_ACTIONS.PAYMENT_CREATE, {
        receiptNumber: receipt,
        amount: addAmount,
        method: paymentMethod,
        customerName: customer?.name,
        roomNumber: reservation.roomNumber,
        reservationId: reservation.id
      }, 'payment', receipt);
      
      // Clear form
      document.getElementById("paymentAmountInput").value = "";
      document.getElementById("paymentReceiptInput").value = "";
      document.getElementById("paymentMethodInput").value = "";
      
      // Show success and close modal, return to edit popup
      alert(`Payment saved! Receipt #${receipt}`);
      document.getElementById("managePaymentModal").style.display = "none";
      
      // Refresh dashboard after successful payment
      await afterReservationOrPaymentChange();

      // Re-open the reservation edit popup with fresh data
      const freshResDoc = await getDoc(doc(db, "reservations", reservation.id));
      if (freshResDoc.exists()) {
        const freshRes = { id: freshResDoc.id, ...freshResDoc.data() };
        
        // CRITICAL: Update the global cache to keep batch close/reports consistent
        if (window._reservationsCache) {
          const cacheIndex = window._reservationsCache.findIndex(r => r.id === reservation.id);
          if (cacheIndex !== -1) {
            window._reservationsCache[cacheIndex] = freshRes;
            console.log('✅ Updated reservation in cache after payment:', reservation.id);
          }
        }
        
        showEditDeletePopup(freshRes);
      }

      // QB sync in separate try/catch - errors here shouldn't affect the user
      try {
        await pushToQuickBooks(qbData, paymentDocId);
      } catch (qbErr) {
        console.warn("QuickBooks sync failed (payment was saved successfully):", qbErr);
      }
      
    } catch (err) {
      console.error("Error saving payment:", err);
      alert("Failed to add payment.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Payment";
    }
  };
}

/**
 * Setup admin balance adjustment functionality
 * Allows admins to add discounts or additional charges to a reservation
 * @param {Object} reservation - The reservation object
 * @param {number} baseTotal - Original total before adjustments
 * @param {number} totalPaid - Total amount already paid
 */
function setupAdminBalanceAdjustment(reservation, baseTotal, totalPaid) {
  const applyBtn = document.getElementById("applyAdjustmentBtn");
  const adjustmentTypeEl = document.getElementById("adjustmentType");
  const adjustmentAmountEl = document.getElementById("adjustmentAmount");
  const adjustmentReasonEl = document.getElementById("adjustmentReason");
  
  if (!applyBtn) return;
  
  // Clone to remove old event listeners
  const newApplyBtn = applyBtn.cloneNode(true);
  applyBtn.parentNode.replaceChild(newApplyBtn, applyBtn);
  
  newApplyBtn.addEventListener("click", async () => {
    const type = adjustmentTypeEl.value;
    const amount = parseFloat(adjustmentAmountEl.value);
    const reason = adjustmentReasonEl.value.trim();
    
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid adjustment amount.");
      return;
    }
    
    if (!reason) {
      alert("Please provide a reason for the adjustment.");
      return;
    }
    
    const adjustmentLabel = type === 'discount' ? 'discount' : 'additional charge';
    const confirmMsg = `Apply ${adjustmentLabel} of $${amount.toFixed(2)} to this reservation?\n\nReason: ${reason}`;
    
    if (!confirm(confirmMsg)) return;
    
    try {
      const reservationRef = doc(db, "reservations", reservation.id);
      const currentAdjustments = reservation.balanceAdjustments || [];
      
      const newAdjustment = {
        type: type,
        amount: amount,
        reason: reason,
        appliedBy: currentEmployee?.name || 'Admin',
        appliedByUid: currentEmployee?.uid || null,
        timestamp: new Date().toISOString()
      };
      
      const updatedAdjustments = [...currentAdjustments, newAdjustment];
      
      await updateDoc(reservationRef, {
        balanceAdjustments: updatedAdjustments
      });

      // Recalculate paymentStatus after adjustment changes the total due
      {
        const adjNights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
        const adjBaseTotal = (parseFloat(reservation.rate) || 0) * adjNights;
        const adjTotal = adjBaseTotal + calcAdjustmentTotal(updatedAdjustments);
        const adjPaid = (window._allPaymentsCache || [])
          .filter(p => p.reservationId === reservation.id && !p.voided)
          .reduce((s, p) => s + parseFloat(p.amount || 0), 0);
        const adjStatus = adjPaid >= adjTotal ? 'fully_paid' : adjPaid > 0 ? 'partially_paid' : 'unpaid';
        await updateDoc(reservationRef, { paymentStatus: adjStatus });
      }
      
      // Audit log for adjustment
      await auditLog(AUDIT_ACTIONS.BALANCE_ADJUSTMENT || 'BALANCE_ADJUSTMENT', {
        reservationId: reservation.id,
        roomNumber: reservation.roomNumber,
        type: type,
        amount: amount,
        reason: reason,
        previousAdjustments: currentAdjustments.length,
        newTotal: updatedAdjustments.length
      }, 'reservation', reservation.id);
      
      alert(`${type === 'discount' ? 'Discount' : 'Additional charge'} of $${amount.toFixed(2)} applied successfully.`);
      
      // Clear form
      adjustmentAmountEl.value = "";
      adjustmentReasonEl.value = "";
      
      // Refresh modal with updated data
      const updatedRes = { ...reservation, balanceAdjustments: updatedAdjustments };
      
      // CRITICAL: Update the global cache to keep batch close/reports consistent
      if (window._reservationsCache) {
        const cacheIndex = window._reservationsCache.findIndex(r => r.id === reservation.id);
        if (cacheIndex !== -1) {
          window._reservationsCache[cacheIndex] = { ...window._reservationsCache[cacheIndex], balanceAdjustments: updatedAdjustments };
          console.log('✅ Updated reservation adjustments in cache:', reservation.id);
        }
      }
      
      await openManagePaymentModal(updatedRes);
      await afterReservationOrPaymentChange();
      
    } catch (err) {
      console.error("Error applying adjustment:", err);
      alert("Failed to apply adjustment. Please try again.");
    }
  });
  
  // Setup remove adjustment handlers
  document.querySelectorAll(".remove-adjustment-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const index = parseInt(btn.getAttribute("data-index"));
      const adjustment = reservation.balanceAdjustments[index];
      
      if (!adjustment) return;
      
      const confirmMsg = `Remove ${adjustment.type} of $${adjustment.amount.toFixed(2)}?\n\nReason was: ${adjustment.reason}`;
      if (!confirm(confirmMsg)) return;
      
      try {
        const reservationRef = doc(db, "reservations", reservation.id);
        const updatedAdjustments = [...reservation.balanceAdjustments];
        updatedAdjustments.splice(index, 1);
        
        await updateDoc(reservationRef, {
          balanceAdjustments: updatedAdjustments
        });

        // Recalculate paymentStatus after adjustment removal changes the total due
        {
          const adjNights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
          const adjBaseTotal = (parseFloat(reservation.rate) || 0) * adjNights;
          const adjTotal = adjBaseTotal + calcAdjustmentTotal(updatedAdjustments);
          const adjPaid = (window._allPaymentsCache || [])
            .filter(p => p.reservationId === reservation.id && !p.voided)
            .reduce((s, p) => s + parseFloat(p.amount || 0), 0);
          const adjStatus = adjPaid >= adjTotal ? 'fully_paid' : adjPaid > 0 ? 'partially_paid' : 'unpaid';
          await updateDoc(reservationRef, { paymentStatus: adjStatus });
        }
        
        // Audit log for removal
        await auditLog(AUDIT_ACTIONS.BALANCE_ADJUSTMENT_REMOVE || 'BALANCE_ADJUSTMENT_REMOVE', {
          reservationId: reservation.id,
          roomNumber: reservation.roomNumber,
          removedType: adjustment.type,
          removedAmount: adjustment.amount,
          removedReason: adjustment.reason
        }, 'reservation', reservation.id);
        
        alert("Adjustment removed successfully.");
        
        // Refresh modal
        const updatedRes = { ...reservation, balanceAdjustments: updatedAdjustments };
        
        // CRITICAL: Update the global cache to keep batch close/reports consistent
        if (window._reservationsCache) {
          const cacheIndex = window._reservationsCache.findIndex(r => r.id === reservation.id);
          if (cacheIndex !== -1) {
            window._reservationsCache[cacheIndex] = { ...window._reservationsCache[cacheIndex], balanceAdjustments: updatedAdjustments };
            console.log('✅ Updated reservation adjustments in cache after removal:', reservation.id);
          }
        }
        
        await openManagePaymentModal(updatedRes);
        await afterReservationOrPaymentChange();
        
      } catch (err) {
        console.error("Error removing adjustment:", err);
        alert("Failed to remove adjustment. Please try again.");
      }
    });
  });
}


/**
 * setupAdminCredit — Allows admins to apply credits/deductions that count
 * toward Total Paid (unlike adjustments which modify Total Cost).
 * Stores credits on reservation.balanceCredits (no receipts generated).
 */
function setupAdminCredit(reservation) {
  const applyBtn = document.getElementById("applyCreditBtn");
  const creditAmountEl = document.getElementById("creditAmount");
  const creditReasonEl = document.getElementById("creditReason");
  const showOnFormEl = document.getElementById("creditShowOnForm");

  if (!applyBtn || !creditAmountEl || !creditReasonEl) {
    console.warn("setupAdminCredit: Missing DOM elements");
    return;
  }

  // Clone to remove old listeners
  const newBtn = applyBtn.cloneNode(true);
  applyBtn.parentNode.replaceChild(newBtn, applyBtn);

  newBtn.addEventListener("click", async () => {
    const amount = parseFloat(creditAmountEl.value);
    const reason = creditReasonEl.value.trim();
    const showOnForm = showOnFormEl ? showOnFormEl.checked : true;

    if (!amount || amount <= 0) {
      alert("Please enter a valid credit amount.");
      return;
    }
    if (!reason) {
      alert("Please enter a reason for the credit.");
      return;
    }

    if (!confirm(`Apply credit of $${amount.toFixed(2)} to this reservation?\n\nReason: ${reason}\nShow on form: ${showOnForm ? 'Yes' : 'No'}\n\nThis will count toward Total Paid without using a receipt number.`)) {
      return;
    }

    try {
      const creditEmployee = getCurrentEmployeeInfo();
      const reservationRef = doc(db, "reservations", reservation.id);
      const currentCredits = reservation.balanceCredits || [];

      const newCredit = {
        amount: amount,
        reason: reason,
        showOnForm: showOnForm,
        appliedBy: creditEmployee.name,
        appliedByUid: creditEmployee.uid,
        timestamp: new Date().toISOString()
      };

      const updatedCredits = [...currentCredits, newCredit];

      // Store credits on the reservation document (not in payments collection)
      await updateDoc(reservationRef, { balanceCredits: updatedCredits });

      // Recalculate paymentStatus (credits add to effective "paid" amount)
      const crNights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
      const crRate = parseFloat(reservation.rate || 0);
      const crBaseTotal = crRate * crNights;
      const crAdj = calcAdjustmentTotal(reservation.balanceAdjustments);
      const crTotalDue = crBaseTotal + crAdj;
      const crCached = (window._allPaymentsCache || []).filter(p => p.reservationId === reservation.id && !p.voided);
      const crActualPaid = crCached.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
      const crCreditTotal = updatedCredits.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
      const crTotalPaid = crActualPaid + crCreditTotal;
      const crStatus = crTotalPaid >= crTotalDue ? 'fully_paid' : crTotalPaid > 0 ? 'partially_paid' : 'unpaid';
      await updateDoc(reservationRef, { paymentStatus: crStatus });

      // Audit log
      const creditCustomer = customers.find(c => c.id === reservation.customerId) || {};
      await auditLog(AUDIT_ACTIONS.BALANCE_ADJUSTMENT || 'BALANCE_CREDIT', {
        type: 'credit',
        amount: amount,
        reason: reason,
        showOnForm: showOnForm,
        customerName: creditCustomer.name,
        roomNumber: reservation.roomNumber,
        reservationId: reservation.id
      }, 'reservation', reservation.id);

      alert(`Credit of $${amount.toFixed(2)} applied successfully!`);

      // Clear form
      creditAmountEl.value = "";
      creditReasonEl.value = "";

      // Refresh modal with updated data
      const updatedRes = { ...reservation, balanceCredits: updatedCredits };

      // Update global cache
      if (window._reservationsCache) {
        const cacheIndex = window._reservationsCache.findIndex(r => r.id === reservation.id);
        if (cacheIndex !== -1) {
          window._reservationsCache[cacheIndex] = { ...window._reservationsCache[cacheIndex], balanceCredits: updatedCredits };
        }
      }

      await openManagePaymentModal(updatedRes);
      await afterReservationOrPaymentChange();

    } catch (err) {
      console.error("Error applying credit:", err);
      alert("Failed to apply credit. Please try again.");
    }
  });
}

// calcCreditTotal is defined at top-level (before initializeApp) so it's
// accessible everywhere including computeLivePaymentStatus.


// Helper: Generate Unique Receipt Number
function generateReceiptNumber() {
  return "R" + Date.now();
}

// Global variables for payment/receipt
let previewReceiptNumber = null;
let latestReservationId = null;
let latestCustomerId = null;

// 🔧 Maintenance Rooms (stored in Firestore settings/maintenance)
let maintenanceRooms = [];
let maintenanceReasons = {}; // { roomNumber: "reason string" }

async function loadMaintenanceRooms() {
  try {
    const docRef = doc(db, "settings", "maintenance");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      maintenanceRooms = docSnap.data().rooms || [];
      maintenanceReasons = docSnap.data().reasons || {};
    } else {
      maintenanceRooms = [];
      maintenanceReasons = {};
    }
  } catch (e) {
    console.warn("Could not load maintenance rooms:", e);
    maintenanceRooms = [];
    maintenanceReasons = {};
  }
}

async function saveMaintenanceRooms() {
  try {
    const docRef = doc(db, "settings", "maintenance");
    const data = { rooms: maintenanceRooms, reasons: maintenanceReasons };
    await updateDoc(docRef, data).catch(async () => {
      // If doc doesn't exist, create it
      const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      await setDoc(docRef, data);
    });
  } catch (e) {
    console.error("Could not save maintenance rooms:", e);
  }
}

function toggleMaintenanceRoom(roomNumber, reason) {
  if (maintenanceRooms.includes(roomNumber)) {
    maintenanceRooms = maintenanceRooms.filter(r => r !== roomNumber);
    delete maintenanceReasons[roomNumber];
  } else {
    maintenanceRooms.push(roomNumber);
    if (reason) maintenanceReasons[roomNumber] = reason;
  }
  saveMaintenanceRooms();
}

// Open room info/maintenance modal for a room
function openMaintenanceModal(roomNumber) {
  const modal = document.getElementById('maintenanceModal');
  const roomNumSpan = document.getElementById('maintenanceRoomNumber');
  const statusText = document.getElementById('maintenanceStatusText');
  const toggleBtn = document.getElementById('toggleMaintenanceBtn');
  const cancelBtn = document.getElementById('cancelMaintenanceBtn');
  const closeBtn = document.getElementById('closeMaintenanceModalBtn');
  const guestInfoSection = document.getElementById('roomGuestInfo');
  const guestNameEl = document.getElementById('roomGuestName');
  const guestCheckinEl = document.getElementById('roomGuestCheckin');
  const guestCheckoutEl = document.getElementById('roomGuestCheckout');
  const guestPaymentEl = document.getElementById('roomGuestPayment');
  const viewResBtn = document.getElementById('roomViewReservationBtn');
  const checkoutBtn = document.getElementById('roomCheckoutBtn');
  
  if (!modal) return;
  
  roomNumSpan.textContent = roomNumber;
  const isUnderMaintenance = maintenanceRooms.includes(roomNumber);
  
  // Find current guest in this room
  const now = new Date();
  const todayStr = getTodayLocal();
  
  // Get cached reservations from window or reload
  const allReservations = window._reservationsCache || [];
  const currentReservation = allReservations.find(r => 
    r.roomNumber === roomNumber && 
    r.arrivalDate <= todayStr && 
    todayStr < r.departureDate // Guest is still staying (departure is checkout day)
  );
  
  // Also check for checkout today
  const checkoutTodayReservation = !currentReservation ? allReservations.find(r =>
    r.roomNumber === roomNumber &&
    r.departureDate === todayStr &&
    now.getHours() < 13 // Before 1 PM checkout time
  ) : null;
  
  const activeReservation = currentReservation || checkoutTodayReservation;
  
  // Show/hide guest info section
  if (activeReservation && guestInfoSection) {
    const customer = customers.find(c => c.id === activeReservation.customerId) || {};
    
    guestInfoSection.style.display = 'block';
    guestNameEl.textContent = customer.name || 'Unknown Guest';
    guestCheckinEl.textContent = activeReservation.arrivalDate || 'N/A';
    guestCheckoutEl.textContent = activeReservation.departureDate || 'N/A';
    
    // Payment status with color
    const paymentStatus = activeReservation.paymentStatus || 'not_paid';
    let paymentColor = 'var(--accent-danger)';
    let paymentText = 'Unpaid';
    if (paymentStatus === 'fully_paid' || paymentStatus === 'paid') {
      paymentColor = 'var(--accent-success)';
      paymentText = 'Fully Paid';
    } else if (paymentStatus === 'partially_paid') {
      paymentColor = 'var(--accent-warning)';
      paymentText = 'Partially Paid';
    }
    guestPaymentEl.innerHTML = `<span style="color:${paymentColor};font-weight:600;">${paymentText}</span>`;
    
    // View reservation button handler
    viewResBtn.onclick = () => {
      modal.style.display = 'none';
      if (typeof showEditDeletePopup === 'function') {
        showEditDeletePopup(activeReservation);
      }
    };
    
    // Checkout button handler
    checkoutBtn.onclick = async () => {
      if (!confirm(`Checkout ${escapeHTML(customer.name || 'guest')} from Room ${roomNumber}?`)) return;
      
      try {
        // Update reservation to mark as checked out
        await updateDoc(doc(db, "reservations", activeReservation.id), {
          checkedOut: true,
          actualCheckOutTime: new Date().toISOString(),
          departureDate: todayStr // Update departure to today if early checkout
        });
        
        // Audit log
        await auditLog(AUDIT_ACTIONS.CHECKOUT || 'CHECKOUT', {
          roomNumber: roomNumber,
          customerName: customer.name,
          reservationId: activeReservation.id,
          scheduledDeparture: activeReservation.departureDate,
          actualCheckout: todayStr
        }, 'reservation', activeReservation.id);
        
        alert(`${escapeHTML(customer.name || 'Guest')} checked out from Room ${roomNumber}`);
        ModalManager.close('maintenanceModal');
        try { await fillDashboard(); } catch (e) { console.error('Dashboard refresh failed after checkout:', e); }
      } catch (err) {
        console.error('Checkout error:', err);
        alert('Failed to checkout. Please try again.');
      }
    };
  } else if (guestInfoSection) {
    guestInfoSection.style.display = 'none';
  }
  
  // Maintenance reason UI
  const reasonSection = document.getElementById('maintenanceReasonSection');
  const reasonInput = document.getElementById('maintenanceReasonInput');
  const reasonDisplay = document.getElementById('maintenanceReasonDisplay');
  const reasonText = document.getElementById('maintenanceReasonText');
  const existingReason = maintenanceReasons[roomNumber] || '';

  // Maintenance status
  if (isUnderMaintenance) {
    statusText.textContent = 'This room is currently under maintenance.';
    toggleBtn.textContent = 'Remove from Maintenance';
    toggleBtn.style.background = 'var(--accent-success, #10b981)';
    // Show existing reason, hide input
    if (reasonSection) reasonSection.style.display = 'none';
    if (reasonDisplay && existingReason) {
      reasonDisplay.style.display = 'block';
      reasonText.textContent = existingReason;
    } else if (reasonDisplay) {
      reasonDisplay.style.display = 'none';
    }
  } else {
    statusText.textContent = activeReservation 
      ? 'Room is occupied. You can still set it for maintenance after checkout.'
      : 'Set this room as under maintenance?';
    toggleBtn.textContent = 'Set Under Maintenance';
    toggleBtn.style.background = '#8b5cf6';
    // Show reason input, hide display
    if (reasonSection) reasonSection.style.display = 'block';
    if (reasonInput) reasonInput.value = '';
    if (reasonDisplay) reasonDisplay.style.display = 'none';
  }
  
  ModalManager.open('maintenanceModal');
  
  // Event handlers
  const handleToggle = async () => {
    const reason = reasonInput ? reasonInput.value.trim() : '';
    toggleMaintenanceRoom(roomNumber, reason);
    ModalManager.close('maintenanceModal');
    try { await fillDashboard(); } catch (e) { console.error('Dashboard refresh failed:', e); }
  };
  
  const handleClose = () => {
    ModalManager.close('maintenanceModal');
  };
  
  // Remove old listeners and add new ones
  toggleBtn.onclick = handleToggle;
  cancelBtn.onclick = handleClose;
  closeBtn.onclick = handleClose;
}

// ===========================================================================
// CUSTOMER MANAGEMENT
// ===========================================================================
// customers[] = List of all customers loaded from database
// selectedCustomerId = When user picks a customer from dropdown, we store their ID
//                      If null, it means "create a new customer"

let customers = [];
let selectedCustomerId = null;


// Room numbers in the guesthouse (101-111 on floor 1, 201-210 on floor 2)
const allowedRooms = [...Array(11).keys()].map(i => (101 + i).toString()).concat([...Array(10).keys()].map(i => (201 + i).toString()));

// Basic phone number validation - just checks it looks like a phone number
const phoneRegex = /^[+\d\s\-()]{7,}$/;

// Load all customers from the database
async function loadCustomers() {
  const snapshot = await getDocs(collection(db, "customers"));
  customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
await loadCustomers();
await loadMaintenanceRooms();

// ===========================================================================
// CUSTOMER SEARCH & AUTOCOMPLETE
// ===========================================================================
// As user types a name, show matching customers in a dropdown
// User can click to select an existing customer, or keep typing to add new one

const searchInput = document.getElementById("searchName");
const suggestionsBox = document.getElementById("suggestions");

searchInput.addEventListener("input", () => {
  const term = searchInput.value.toLowerCase();
  suggestionsBox.innerHTML = "";
  
  // Clear selected customer ID when user types - they might want a different customer
  selectedCustomerId = null;

  // Style the dropdown box
  suggestionsBox.style.position = "absolute";
  suggestionsBox.style.background = "var(--bg-card, #fff)";
  suggestionsBox.style.border = "1px solid var(--border-medium, #ccc)";
  suggestionsBox.style.borderRadius = "6px";
  suggestionsBox.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
  suggestionsBox.style.marginTop = "2px";
  suggestionsBox.style.zIndex = "1000";
  suggestionsBox.style.minWidth = searchInput.offsetWidth + "px";
  suggestionsBox.style.maxHeight = "220px";
  suggestionsBox.style.overflowY = "auto";

  // Need at least 1 character to search
  if (term.length < 1) {
    suggestionsBox.style.display = "none";
    return;
  }

  console.log('Searching customers:', customers.length, 'term:', term);
  const matches = customers.filter(c => c.name && c.name.toLowerCase().includes(term));
  console.log('Matches found:', matches.length);
  
  if (matches.length > 0) {
    suggestionsBox.style.display = "block";
    matches.forEach(c => {
      const div = document.createElement("div");
      div.classList.add("suggestion-item");
      div.textContent = `${c.name} (${c.address || 'No address'})`;
      // Style each suggestion item (theme-aware)
      div.style.padding = "10px 16px";
      div.style.cursor = "pointer";
      div.style.borderBottom = "1px solid var(--border-light, #f0f0f0)";
      div.style.background = "var(--bg-secondary, #f9f9f9)";
      div.style.color = "var(--text-primary, #222)";
      div.style.transition = "background 0.2s";
      div.addEventListener("mouseenter", () => {
        div.style.background = "var(--accent-primary, #3b82f6)";
        div.style.color = "#fff";
      });
      div.addEventListener("mouseleave", () => {
        div.style.background = "var(--bg-secondary, #f9f9f9)";
        div.style.color = "var(--text-primary, #222)";
      });
      div.addEventListener("click", () => {
        autofillCustomer(c);
        selectedCustomerId = c.id;
        suggestionsBox.style.display = "none";
      });
      suggestionsBox.appendChild(div);
    });
    // Remove last item's border
    if (suggestionsBox.lastChild) suggestionsBox.lastChild.style.borderBottom = "none";
  } else {
    suggestionsBox.style.display = "none";
  }
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const firstItem = suggestionsBox.querySelector(".suggestion-item");
    if (firstItem) {
      firstItem.click();
      e.preventDefault();
    }
  }
});

// Clear selectedCustomerId when user manually edits ANY customer field
// This prevents saving under wrong customer when user changes details after selecting from dropdown
// IMPORTANT: All fields that identify a customer must clear the selection
['name', 'telephone', 'address', 'customer-email'].forEach(fieldId => {
  document.getElementById(fieldId)?.addEventListener('input', () => {
    // User is typing manually, so they don't want the selected customer anymore
    selectedCustomerId = null;
  });
});

// Autofill customer data from dropdown selection
function autofillCustomer(customer) {
  document.getElementById("name").value = customer.name;
  document.getElementById("address").value = customer.address;
  document.getElementById("telephone").value = customer.telephone;
  document.getElementById("customer-email").value = customer.email || "";

  // 🔹 Show ID preview if available
  const previewBox = document.getElementById("customerIdPreview");
  if (customer.idImageUrl) {
    previewBox.innerHTML = `<img src="${customer.idImageUrl}" 
      alt="Customer ID" style="max-width:150px; border:1px solid #ccc; border-radius:6px;" />`;
  } else {
    previewBox.innerHTML = `<span style="font-size:0.9em; color:#666;">No ID on file</span>`;
  }
}


document.addEventListener("click", (e) => {
  if (!suggestionsBox.contains(e.target) && e.target !== searchInput) {
    suggestionsBox.style.display = "none";
  }
});

// ===========================================================================
// FORM VALIDATION HELPERS
// ===========================================================================
// Simple functions to check if form fields have valid data

function validateName(name) {
  return name && name.trim().length >= 2;  // At least 2 characters
}

function validateAddress(address) {
  return address && address.trim().length >= 3;  // At least 3 characters
}

function validateTelephone(tel) {
  if (!tel || tel.trim().length < 7) return false;
  // Allow digits, spaces, +, -, parentheses. Must have at least 7 digit characters.
  const cleaned = tel.replace(/[^0-9]/g, '');
  return cleaned.length >= 7 && cleaned.length <= 15 && /^[0-9+\-()\s]+$/.test(tel.trim());
}

function validateRoom(room) {
  return room && allowedRooms.includes(room.trim());  // Must be a valid room number
}

function validateDates(arrival, departure) {
  if (!arrival || !departure) return false;
  const arrivalDate = new Date(arrival);
  const departureDate = new Date(departure);
  return !isNaN(arrivalDate) && !isNaN(departureDate) && departureDate > arrivalDate;
}

// ===========================================================================
// ROOM TYPE SELECTOR & VISUAL ROOM PICKER
// ===========================================================================
{
  const roomTypeSingleBtn = document.getElementById('roomTypeSingleBtn');
  const roomTypeDoubleBtn = document.getElementById('roomTypeDoubleBtn');
  const roomPickerContainer = document.getElementById('roomPickerContainer');
  const roomPickerGrid = document.getElementById('roomPickerGrid');
  const roomInput = document.getElementById('room');

  let selectedRoomType = null;

  function getBookedRooms() {
    const arrival = document.getElementById('arrival')?.value;
    const departure = document.getElementById('departure')?.value;
    const reservations = window._reservationsCache || [];
    
    if (arrival && departure) {
      // Date range overlap check
      return reservations
        .filter(r => r.arrivalDate < departure && r.departureDate > arrival)
        .map(r => r.roomNumber);
    }
    
    // No dates yet — show currently occupied rooms (active today)
    const today = new Date().toISOString().split('T')[0];
    return reservations
      .filter(r => r.arrivalDate <= today && r.departureDate > today)
      .map(r => r.roomNumber);
  }

  function populateRoomPicker(type) {
    if (!roomPickerGrid) return;
    roomPickerGrid.innerHTML = '';
    const bookedRooms = getBookedRooms();
    const rooms = APP_CONFIG.ROOMS.getByType(type);

    // Group by floor
    const floor1 = rooms.filter(r => r.startsWith('1'));
    const floor2 = rooms.filter(r => r.startsWith('2'));

    const renderFloor = (label, floorRooms) => {
      if (floorRooms.length === 0) return;
      const floorLabel = document.createElement('div');
      floorLabel.className = 'room-picker-floor-label';
      floorLabel.textContent = label;
      roomPickerGrid.appendChild(floorLabel);

      floorRooms.forEach(roomNum => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'room-pick-btn';
        const isBooked = bookedRooms.includes(roomNum);
        const isMaintenance = maintenanceRooms.includes(roomNum);
        if (isBooked) {
          btn.classList.add('unavailable');
        } else if (isMaintenance) {
          btn.classList.add('maintenance-room');
        } else {
          btn.classList.add('available-room');
        }
        if (roomInput.value === roomNum) btn.classList.add('selected');
        btn.innerHTML = `<span>${roomNum}</span>`;

        if (!isBooked && !isMaintenance) {
          btn.addEventListener('click', () => {
            roomPickerGrid.querySelectorAll('.room-pick-btn.selected').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            roomInput.value = roomNum;
          });
        }
        roomPickerGrid.appendChild(btn);
      });
    };

    renderFloor('Ground Floor', floor1);
    renderFloor('First Floor', floor2);

    roomPickerContainer.style.display = '';
  }

  function selectRoomType(type) {
    selectedRoomType = type;
    roomTypeSingleBtn?.classList.toggle('active', type === 'single');
    roomTypeDoubleBtn?.classList.toggle('active', type === 'double');
    // Clear previous room selection when switching type
    const currentRoom = roomInput?.value;
    if (currentRoom && APP_CONFIG.ROOMS.getType(currentRoom) !== type) {
      roomInput.value = '';
    }
    populateRoomPicker(type);
  }

  roomTypeSingleBtn?.addEventListener('click', () => selectRoomType('single'));
  roomTypeDoubleBtn?.addEventListener('click', () => selectRoomType('double'));

  // Re-render room availability when dates change
  document.getElementById('arrival')?.addEventListener('change', () => {
    if (selectedRoomType) populateRoomPicker(selectedRoomType);
  });
  document.getElementById('departure')?.addEventListener('change', () => {
    if (selectedRoomType) populateRoomPicker(selectedRoomType);
  });

  // When clearing the form, reset room picker
  document.getElementById('clearReservationFormBtn')?.addEventListener('click', () => {
    selectedRoomType = null;
    roomTypeSingleBtn?.classList.remove('active');
    roomTypeDoubleBtn?.classList.remove('active');
    if (roomPickerContainer) roomPickerContainer.style.display = 'none';
    if (roomPickerGrid) roomPickerGrid.innerHTML = '';
    if (roomInput) roomInput.value = '';
  });
}

// ===========================================================================
// SAVE RESERVATION BUTTON HANDLER
// ===========================================================================

document.getElementById("saveReservationBtn")?.addEventListener("click", async (e) => {
  e.preventDefault();

  // ─────────────────────────────────────────────────────────────────────────
  // SPAM PREVENTION: Disable button while processing
  // ─────────────────────────────────────────────────────────────────────────
  const saveBtn = document.getElementById("saveReservationBtn");
  if (saveBtn.disabled) return;
  saveBtn.disabled = true;
  const originalHTML = saveBtn.innerHTML;
  saveBtn.innerHTML = '<span class="material-icons" aria-hidden="true">hourglass_empty</span> Saving...';

  const resetSaveButton = () => {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalHTML;
  };

  const name = document.getElementById("name").value.trim();
  const address = document.getElementById("address").value.trim();
  const telephone = document.getElementById("telephone").value.trim();
  const email = document.getElementById("customer-email").value.trim();
  const arrivalDate = document.getElementById("arrival").value;
  const departureDate = document.getElementById("departure").value;
  const roomNumber = document.getElementById("room").value.trim();
  const rate = parseFloat(document.getElementById("reservationRate").value);
  const note = document.getElementById("reservationNote").value || "";

  // ─────────────────────────────────────────────────────────────────────────
  // ES6 FORM VALIDATION - Validate all fields before saving
  // ─────────────────────────────────────────────────────────────────────────
  const validationErrors = [];
  const markFieldError = (fieldId, hasError) => {
    const el = document.getElementById(fieldId);
    if (el) el.classList.toggle('input-error', hasError);
  };

  // Validate each field and collect errors
  const nameValid = validateName(name);
  markFieldError('name', !nameValid);
  if (!nameValid) validationErrors.push('Guest name is required (min 2 characters)');

  const addressValid = validateAddress(address);
  markFieldError('address', !addressValid);
  if (!addressValid) validationErrors.push('Address is required (min 3 characters)');

  const telValid = validateTelephone(telephone);
  markFieldError('telephone', !telValid);
  if (!telValid) validationErrors.push('Valid telephone number is required (min 7 digits)');

  const datesValid = validateDates(arrivalDate, departureDate);
  markFieldError('arrival', !datesValid);
  markFieldError('departure', !datesValid);
  if (!datesValid) validationErrors.push('Valid arrival and departure dates are required (departure must be after arrival)');

  const roomValid = validateRoom(roomNumber);
  markFieldError('room', !roomValid);
  if (!roomValid) validationErrors.push('Please select a valid room number');

  const rateValid = !isNaN(rate) && rate >= 0;
  markFieldError('reservationRate', !rateValid);
  if (!rateValid) validationErrors.push('Please enter a valid nightly rate');

  if (validationErrors.length > 0) {
    // Show first error as alert, highlight all invalid fields
    alert(validationErrors[0]);
    // Focus first invalid field
    const firstInvalid = document.querySelector('#addReservationForm .input-error');
    if (firstInvalid) firstInvalid.focus();
    resetSaveButton();
    return;
  }

  // Clear any previous error highlights on successful validation
  document.querySelectorAll('#addReservationForm .input-error').forEach(el => el.classList.remove('input-error'));

// ===========================================================================
// CHECK FOR OVERLAPPING RESERVATIONS
// ===========================================================================
// When someone books a room, we need to make sure it's not already booked.
// If there's an UNPAID overlapping reservation, we auto-delete it.
// If there's a PAID reservation, we block the booking.

async function checkOverlapAllowSameDayOrReplaceUnpaid(room, arrival, departure) {
  // Use cache if available for offline compatibility
  let allReservations;
  if (window._reservationsCache && window._reservationsCache.length > 0) {
    allReservations = window._reservationsCache;
  } else {
    const snapshot = await getDocs(collection(db, "reservations"));
    allReservations = snapshot.docs.map(docSnap => ({ 
      id: docSnap.id, 
      ...docSnap.data() 
    }));
  }

  const newArrival = normalizeDate(arrival);
  const newDeparture = normalizeDate(departure);

  // Check each existing reservation for conflicts
  for (const reservation of allReservations) {
    // Different room? No conflict possible
    if (reservation.roomNumber !== room) continue;

    const resArrival = normalizeDate(reservation.arrivalDate);
    const resDeparture = normalizeDate(reservation.departureDate);

    // Check if dates overlap
    // Same-day turnaround is OK: newDep > resArr AND newArr < resDep = CONFLICT
    // (guest A checks out morning, guest B checks in afternoon same day = NO conflict)
    const hasOverlap = newDeparture > resArrival && newArrival < resDeparture;
    
    if (!hasOverlap) continue;

    // There's an overlap - is the existing reservation paid?
    const isPaid = reservation.paymentStatus && 
                   reservation.paymentStatus !== "not_paid" && 
                   reservation.paymentStatus !== "unpaid";
    
    if (isPaid) {
      // Can't override a paid reservation - tell user to pick different dates
      console.log(`⚠️ Blocking: Paid reservation exists for room ${room}`, reservation);
      return true;
    }

    // Unpaid reservation can be replaced - auto-delete it
    await deleteDoc(doc(db, "reservations", reservation.id));
    console.log(`🗑️ Deleted unpaid overlapping reservation: ${reservation.id}`);
  }

  return false; // No blocking overlaps found
}

  // ===========================================================================
  // FORM VALIDATION - Make sure all required info is filled in correctly
  // ===========================================================================
  
  if (!name || !address || !telephone || !arrivalDate || !departureDate || !roomNumber) {
    alert("Please fill in all fields.");
    resetSaveButton();
    return;
  }
  if (!validateName(name)) {
    alert("Name must be at least 3 characters.");
    resetSaveButton();
    return;
  }
  if (!validateAddress(address)) {
    alert("Address must be at least 3 characters.");
    resetSaveButton();
    return;
  }
  if (!validateTelephone(telephone)) {
    alert("Please enter a valid telephone number.");
    resetSaveButton();
    return;
  }
  if (!validateRoom(roomNumber)) {
    alert(`Room number must be one of: ${allowedRooms.join(", ")}`);
    resetSaveButton();
    return;
  }
  if (!validateDates(arrivalDate, departureDate)) {
    alert("Please enter valid arrival and departure dates. Arrival cannot be after departure or be in the past.");
    resetSaveButton();
    return;
  }

 // Check if room is already booked for these dates
const hasBlockingOverlap = await checkOverlapAllowSameDayOrReplaceUnpaid(roomNumber, arrivalDate, departureDate);
if (hasBlockingOverlap) {
  alert("A paid or partially paid reservation already exists for these dates. Please choose different dates.");
  resetSaveButton();
  return;
}

  try {
    let customerId = selectedCustomerId;
    
    // SAFETY CHECK: If we have a selectedCustomerId, verify the name still matches
    // This prevents saving to wrong customer if user modified the name field after selecting
    if (customerId) {
      const selectedCustomer = customers.find(c => c.id === customerId);
      if (!selectedCustomer || selectedCustomer.name.toLowerCase().trim() !== name.toLowerCase().trim()) {
        // Name doesn't match - user probably edited it, so create new customer instead
        console.log('⚠️ Customer name mismatch - creating new customer instead');
        customerId = null;
      }
    }
    
    if (!customerId) {
      // Add new customer and update global list immediately
      const newCustomer = await addDoc(collection(db, "customers"), { name, address, telephone, email });
      customerId = newCustomer.id;
      await loadCustomers();  // Refresh customers immediately so new one is searchable
    }

    // Add reservation with payment fields, including rate
    const creator = getCurrentEmployeeInfo();
    console.log('📝 Creating reservation by:', creator.name);
    
    // Calculate initial nights
    const initialNights = calculateSpecialNights(arrivalDate, departureDate);
    
    const reservationDoc = await addDoc(collection(db, "reservations"), {
      customerId,
      arrivalDate,
      departureDate,
      roomNumber,
      note,
      rate,
      paymentStatus: "unpaid",
      paymentIds: [],
      createdBy: creator.uid,
      createdByName: creator.name,
      createdAt: new Date().toISOString(),
      // History tracking for extensions
      history: [{
        type: 'created',
        date: new Date().toISOString(),
        arrivalDate: arrivalDate,
        departureDate: departureDate,
        nights: initialNights,
        rate: rate,
        by: creator.uid,
        byName: creator.name
      }]
    });

    // Audit log for new reservation
    await auditLog(AUDIT_ACTIONS.RESERVATION_CREATE, {
      customerName: name,
      roomNumber: roomNumber,
      arrivalDate: arrivalDate,
      departureDate: departureDate,
      rate: rate
    }, 'reservation', reservationDoc.id);

    alert("Reservation saved successfully.");
    latestCustomerId = customerId;
    latestReservationId = reservationDoc.id;
    previewReceiptNumber = generateReceiptNumber();
    ModalManager.open('paymentPromptModal');

    // Clear form manually
    document.getElementById("searchName").value = "";
    document.getElementById("name").value = "";
    document.getElementById("address").value = "";
    document.getElementById("telephone").value = "";
    document.getElementById("arrival").value = "";
    document.getElementById("departure").value = "";
    document.getElementById("room").value = "";

    selectedCustomerId = null;
    ModalManager.close('addReservationModal');

  document.getElementById("customerIdPreview").innerHTML =
  `<span style="font-size:0.9em; color:#666;">No ID on file</span>`;

    // Re-enable button after successful save
    resetSaveButton();

    // Refresh dashboard after reservation is saved
    await afterReservationOrPaymentChange();

  } catch (err) {
    console.error("Error saving reservation:", err);
    alert("Failed to save reservation.");
    resetSaveButton();
  }
});

async function getNextPreviewReceiptNumber() {
  const receiptDoc = await getDoc(doc(db, "counters", "receipt_counter"));
  const current = receiptDoc.exists() ? receiptDoc.data().current : 0;
  return String(current + 1).padStart(5, "0");
}

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT PROMPT MODAL - Shown after creating a new reservation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * "Yes, record payment now" button handler.
 * Generates preview receipt number and opens the payment entry form.
 */
document.getElementById("yesPaymentBtn")?.addEventListener("click", async () => {
  const yesBtn = document.getElementById("yesPaymentBtn");
  if (yesBtn.disabled) return;
  yesBtn.disabled = true;
  const origText = yesBtn.textContent;
  yesBtn.textContent = "Loading...";
  try {
    previewReceiptNumber = await getNextPreviewReceiptNumber();
    document.getElementById("previewReceiptNumber").value = previewReceiptNumber;
    ModalManager.close('paymentPromptModal');
    ModalManager.open('addPaymentModal');
  } catch (err) {
    console.error("Error loading receipt number:", err);
    alert("Could not prepare payment form. Please try again.");
  } finally {
    yesBtn.disabled = false;
    yesBtn.textContent = origText;
  }
});

/**
 * "No, skip payment" button handler.
 * Closes the payment prompt and continues to ID/registration flow.
 */
document.getElementById("noPaymentBtn")?.addEventListener("click", () => {
  ModalManager.close('paymentPromptModal');
  const customer = customers.find(c => c.id === latestCustomerId);
  if (customer?.idImageUrl) {
    showRegistrationFormWithSavedId(customer);
  } else {
    ModalManager.open('registrationPromptModal');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT MODAL CLOSE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Close payment modal and continue to registration flow.
 * 
 * After closing, checks if customer already has an ID on file:
 * - If yes: Shows registration form preview with saved ID
 * - If no: Shows ID upload prompt
 */
document.getElementById("closeAddPaymentBtn")?.addEventListener("click", () => {
  ModalManager.close('addPaymentModal');

  const customer = customers.find(c => c.id === latestCustomerId);
  if (customer?.idImageUrl) {
    // 🔹 Already has ID → go straight to registration form preview
    showRegistrationFormWithSavedId(customer);
  } else {
    // 🔹 No ID yet → prompt to upload
    ModalManager.open('registrationPromptModal');
  }
});

document.getElementById("closePaymentPromptBtn")?.addEventListener("click", () => {
  ModalManager.close('paymentPromptModal');
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT CONFIRMATION & SAVE - Core payment recording logic
// ═══════════════════════════════════════════════════════════════════════════
/**
 * PAYMENT RECORDING PROCESS:
 * 
 * 1. VALIDATION: Amount > 0, method selected
 * 2. RECEIPT: Get atomic sequential receipt number
 * 3. EMPLOYEE: Track who recorded the payment
 * 4. FIRESTORE: Create payment document
 * 5. STATUS: Recalculate & update reservation paymentStatus
 * 6. AUDIT: Log the payment action
 * 7. SMS: Prompt to send confirmation to guest
 * 8. QUICKBOOKS: Sync payment data (with offline queue fallback)
 */
document.getElementById("confirmPaymentBtn")?.addEventListener("click", async () => {
  // ─────────────────────────────────────────────────────────────────────────
  // SPAM PREVENTION: Disable button while processing
  // ─────────────────────────────────────────────────────────────────────────
  const confirmBtn = document.getElementById("confirmPaymentBtn");
  if (confirmBtn.disabled) return;
  confirmBtn.disabled = true;
  const originalText = confirmBtn.textContent;
  confirmBtn.textContent = "Processing...";

  const resetButton = () => {
    confirmBtn.disabled = false;
    confirmBtn.textContent = originalText;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Validate payment inputs
  // ─────────────────────────────────────────────────────────────────────────
  const amount = parseFloat(document.getElementById("paymentAmount").value);
  const method = document.getElementById("paymentMethod").value;
  if (isNaN(amount) || amount <= 0) {
    alert("Enter a valid amount.");
    resetButton();
    return;
  }
  if (!method) {
    alert("Please select a payment method.");
    resetButton();
    return;
  }

  try {
    const receipt = await getNextReceiptNumber();

    const resDoc = await getDoc(doc(db, "reservations", latestReservationId));
    const reservation = resDoc.exists() ? { id: resDoc.id, ...resDoc.data() } : null;

    // Save payment with employee tracking
    const recorder = getCurrentEmployeeInfo();
    console.log('📝 Recording payment by:', recorder.name, '(UID:', recorder.uid, ')');

    const paymentRef = await addDoc(collection(db, "payments"), {
      customerId: latestCustomerId,
      reservationId: latestReservationId,
      receiptNumber: receipt,
      amount,
      method,
      timestamp: new Date().toISOString(),
      recordedBy: recorder.uid,
      recordedByName: recorder.name,
      qbSyncStatus: 'pending'
    });

    // Recompute paid/remaining to set paymentStatus
    // Calculate total paid from cache + newly saved payment (not in cache yet)
    const cachedPayments = (window._allPaymentsCache || [])
      .filter(p => p.reservationId === latestReservationId && !p.voided);

    const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
    const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
    // Include balance adjustments (usually empty for new reservations)
    const adjustments = reservation.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    const totalDue = baseTotal + totalAdjustment;
    const totalPaid = cachedPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0) + amount;
    const newStatus = totalPaid >= totalDue ? "fully_paid" : "partially_paid";

    await updateDoc(doc(db, "reservations", latestReservationId), {
      paymentStatus: newStatus,
      paymentIds: [...(reservation.paymentIds || []), paymentRef.id]
    });

    // Audit log for initial payment
    await auditLog(AUDIT_ACTIONS.PAYMENT_CREATE, {
      receiptNumber: receipt,
      amount: amount,
      method: method,
      reservationId: latestReservationId,
      customerId: latestCustomerId,
      roomNumber: reservation.roomNumber
    }, 'payment', receipt);

    alert("Payment successful. Receipt #" + receipt);

    //CALL
    const customer = customers.find(c => c.id === latestCustomerId);
    const balance = Math.max(0, totalDue - totalPaid).toFixed(2);

    // Cleanup after transaction
    document.getElementById("paymentAmount").value = "";
    document.getElementById("previewReceiptNumber").value = "";
    previewReceiptNumber = null;
    ModalManager.close('addPaymentModal');

    // Show check-in confirmation popup — it will open registrationPromptModal itself
    // after the user responds. Do NOT open registrationPromptModal here.
    showSMSConfirmationPopup(reservation, customer, receipt, amount, balance, nights);

    // Refresh dashboard after successful payment
    await afterReservationOrPaymentChange();

    // Sync to QuickBooks after successful payment (separate try/catch so QB errors
    // don't show "Failed to process payment" when the payment was already saved)
    try {
      if (reservation && customer) {
        const recorderInfo = getCurrentEmployeeInfo();
        const payment = {
          id: paymentRef.id,
          receiptNumber: receipt,
          amount: amount,
          method: method,
          timestamp: new Date().toISOString(),
          recordedByName: recorderInfo.name,
          customerId: latestCustomerId,
          reservationId: latestReservationId
        };
        const qbData = buildQuickBooksPaymentData(payment, reservation, customer, currentEmployee);
        await pushToQuickBooks(qbData, paymentRef.id);
      }
    } catch (qbErr) {
      console.warn("QuickBooks sync failed (payment was saved successfully):", qbErr);
    }
    
    // Re-enable button after successful completion
    resetButton();
  } catch (err) {
    console.error("Transaction failed:", err);
    alert("Failed to process payment.");
    resetButton();
  }
});


//workflow modal handlers
{
  const continueBtn = document.getElementById("continueToIdUploadBtn");
  if (continueBtn) continueBtn.onclick = async () => {
  const customer = customers.find(c => c.id === latestCustomerId);

  if (customer?.idImageUrl) {
    // 🔹 Skip upload → go straight to form preview with saved ID
    ModalManager.close('registrationPromptModal');
    await showRegistrationFormWithSavedId(customer);
    return;
  }

  // 🔹 Otherwise: normal upload flow
  uploadedIdFile = null;
  latestCroppedImageDataUrl = null;
  document.getElementById("idUploadInput").value = "";
  ModalManager.close('registrationPromptModal');
  ModalManager.open('idUploadModal');
  };
}

// Cancel button for registration prompt modal
{
  const cancelRegistrationFlowBtn = document.getElementById("cancelRegistrationFlowBtn");
  if (cancelRegistrationFlowBtn) cancelRegistrationFlowBtn.onclick = () => {
    ModalManager.close('registrationPromptModal');
  };
  
  // Also handle the close button
  const closeRegistrationPromptBtn = document.getElementById("closeRegistrationPromptBtn");
  if (closeRegistrationPromptBtn) closeRegistrationPromptBtn.onclick = () => {
    ModalManager.close('registrationPromptModal');
  };
}


{
  const cancelIdUploadBtn = document.getElementById("cancelIdUploadBtn");
  if (cancelIdUploadBtn) cancelIdUploadBtn.onclick = () => {
    ModalManager.close('idUploadModal');
  };
}

//FIle upload and open crop tool
document.getElementById("idUploadInput")?.addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;

  uploadedIdFile = file;
  const reader = new FileReader();
  reader.onload = function (event) {
    document.getElementById("idCropImage").src = event.target.result;
    ModalManager.close('idUploadModal');
    ModalManager.open('idCropModal');

    setTimeout(() => {
      const image = document.getElementById("idCropImage");
      cropperInstance = new Cropper(image, {
        aspectRatio: 3 / 2,
        viewMode: 1,
      });
    }, 100);
  };
  reader.readAsDataURL(file);
});

//cropping and preview form
{
  const cancelCropBtn = document.getElementById("cancelCropBtn");
  if (cancelCropBtn) cancelCropBtn.onclick = () => {
    cropperInstance?.destroy();
    cropperInstance = null;
    window._editCustomerIdCropMode = false; // Reset edit mode flag
    ModalManager.close('idCropModal');
  };
}

{
  const cropAndContinueBtn = document.getElementById("cropAndContinueBtn");
  if (cropAndContinueBtn) cropAndContinueBtn.onclick = async () => {
  if (!cropperInstance) return;

  const canvas = cropperInstance.getCroppedCanvas({
    width: 300,
    height: 200,
  });

  const croppedDataUrl = canvas.toDataURL("image/jpeg");
  cropperInstance.destroy();
  cropperInstance = null;

  ModalManager.close('idCropModal');

  // Check if we're in edit customer ID mode
  if (window._editCustomerIdCropMode) {
    window._editCustomerIdCropMode = false;
    
    // Store cropped image for edit customer modal
    editCustomerNewIdImage = croppedDataUrl;
    
    // Update preview in edit customer modal
    const idPreview = document.getElementById("editCustomerIdPreview");
    if (idPreview) {
      idPreview.innerHTML = `<img src="${croppedDataUrl}" alt="New ID" style="max-width: 200px; max-height: 150px; border-radius: 8px; border: 2px solid #10b981;" />
        <div style="color: #10b981; font-size: 0.85em; margin-top: 4px;">✓ Image cropped (will save when you click Save)</div>`;
    }
    return; // Don't continue with reservation form logic
  }

  // Original reservation flow continues below
  latestCroppedImageDataUrl = croppedDataUrl;

  const resDoc = await getDoc(doc(db, "reservations", latestReservationId));
  const reservation = resDoc.exists() ? { id: resDoc.id, ...resDoc.data() } : null;
  const customer = customers.find(c => c.id === latestCustomerId);

    // 🔹 Save ID to Firestore under the customer document
  if (latestCustomerId && latestCroppedImageDataUrl) {
    try {
      await updateDoc(doc(db, "customers", latestCustomerId), {
        idImageUrl: latestCroppedImageDataUrl
      });
      // update local cache too
      const idx = customers.findIndex(c => c.id === latestCustomerId);
      if (idx !== -1) customers[idx].idImageUrl = latestCroppedImageDataUrl;
      console.log("✅ ID saved to customer record.");
    } catch (err) {
      console.error("❌ Failed to save ID:", err);
    }
  }


  let relatedPayments = [];
  try {
    const paymentsSnapshot = await getDocs(collection(db, "payments"));
    const allPayments = paymentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Filter out voided payments for calculations and display
    relatedPayments = allPayments.filter(p => p.reservationId === reservation.id && !p.voided);
  } catch (err) {
    console.error("Error fetching payments:", err);
    relatedPayments = [];
  }

  // Sort ASCENDING (oldest first) so running balance subtracts in correct order
  const sortedPayments = relatedPayments.sort(comparePaymentsByTime);
  const rate = parseFloat(reservation.rate || 0);
  const arrival = new Date(reservation.arrivalDate);
  const departure = new Date(reservation.departureDate);
  const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
  const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
  // Include balance adjustments
  const adjustments = reservation.balanceAdjustments || [];
  const totalAdjustment = calcAdjustmentTotal(adjustments);
  const totalDue = baseTotal + totalAdjustment;
  const actualPaid = relatedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  const creditTotal = calcCreditTotal(reservation.balanceCredits);
  const totalPaid = actualPaid + creditTotal;
  let balanceRemaining = Math.max(0, totalDue - totalPaid);
  if (balanceRemaining < 0) balanceRemaining = 0;


  const paymentSummary = {
    totalPaid,
    totalDue,
    balanceRemaining,
    receiptNumber: sortedPayments[0]?.receiptNumber || "—",
    receipts: buildReceiptsWithBalance(sortedPayments, reservation)
  };

const idToUse = customer?.idImageUrl || latestCroppedImageDataUrl || null;
const html = buildRegistrationFormHTML(reservation, customer, idToUse, paymentSummary);


  const previewContainer = document.getElementById("formPreviewContent");
  previewContainer.innerHTML = html;

  ModalManager.open('registrationFormPreviewModal');
  };
}

// Overlapping check allowing same-day check-in after checkout
// Uses cache for offline compatibility
async function checkOverlapAllowSameDay(room, arrival, departure) {
  // Use cache if available for faster checks (works offline too)
  let all;
  if (window._reservationsCache && window._reservationsCache.length > 0) {
    all = window._reservationsCache;
  } else {
    const snapshot = await getDocs(collection(db, "reservations"));
    all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  const newArr = normalizeDate(arrival);
  const newDep = normalizeDate(departure);

  // Compare dates allowing check-in on same day as previous guest checks out
  return all.some(res => {
    if (res.roomNumber !== room) return false;

    const resArr = normalizeDate(res.arrivalDate);
    const resDep = normalizeDate(res.departureDate);

    // Same-day turnaround is allowed: newArr == resDep is OK
    // Overlap if: newDep > resArr AND newArr < resDep
    return newDep > resArr && newArr < resDep;
  });
}

// 📅 Get Date Range
function getDateRange(start, end) {
  const dates = [];
  let current = new Date(start);
  const to = new Date(end);
  while (current <= to) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// 📁 Load Reservations (uses cache for performance)
async function loadReservations() {
  // Use cached data from real-time listener if available
  if (window._reservationsCache && window._reservationsCache.length > 0) {
    return window._reservationsCache;
  }
  // Fallback to DB call if cache is empty
  const snapshot = await getDocs(collection(db, "reservations"));
  const reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  window._reservationsCache = reservations;
  return reservations;
}

// Modal Open/Close handlers
document.getElementById("openAddReservationBtn")?.addEventListener("click", () => {
  ModalManager.open('addReservationModal');
});
document.getElementById("closeAddReservationBtn")?.addEventListener("click", () => {
  ModalManager.close('addReservationModal');
});
document.getElementById("showAvailabilityBtn")?.addEventListener("click", () => {
  window.location.href = 'availability.html';
});
document.getElementById("closeAvailabilityBtn")?.addEventListener("click", () => {
  ModalManager.close('availabilityModal');
  // Reset to date entry screen for next open
  const s1 = document.getElementById("availGridScreen1");
  const s2 = document.getElementById("availGridScreen2");
  if (s1) s1.style.display = "flex";
  if (s2) s2.style.display = "none";
});

// Helper to clear and reset the Add Reservation form
function clearAddReservationForm() {
  const ids = ['searchName','name','address','telephone','customer-email','arrival','departure','room','reservationRate','reservationNote','customerIdPreview'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') el.value = '';
    else el.innerHTML = `<span style="font-size:0.9em; color:#666;">No ID on file</span>`;
  });
  selectedCustomerId = null;
  latestCustomerId = null;
  latestReservationId = null;
  previewReceiptNumber = null;
  // hide the modal if open
  ModalManager.close('addReservationModal');
}

{
  const clearReservationFormBtn = document.getElementById("clearReservationFormBtn");
  if (clearReservationFormBtn) clearReservationFormBtn.onclick = () => {
    clearAddReservationForm();
  };
}

// Click-outside-to-close DISABLED for all modals — user must use explicit close/cancel buttons
// window.addEventListener("click", ...) removed to prevent accidental closure



// Render availability grid with customer names + edit/delete (no payment info)
async function renderAvailabilityGrid() {
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;
  if (!start || !end || new Date(start) > new Date(end)) {
    alert("Please select a valid date range.");
    return;
  }

  const rooms = [...Array(11).keys()].map(i => (101 + i).toString()).concat([...Array(10).keys()].map(i => (201 + i).toString()));
  const dates = getDateRange(start, end);
  const reservations = await loadReservations();
  const grid = document.getElementById("availabilityGrid");
  grid.innerHTML = "";

  const table = document.createElement("table");
  table.className = "availability-grid-table avail-grid-compact";
  const header = document.createElement("tr");
  header.innerHTML = `<th>Room</th>` + dates.map(d => {
    const dt = new Date(d + 'T00:00:00');
    const day = dt.getDate();
    const mon = dt.toLocaleString('default', { month: 'short' });
    return `<th>${day} ${mon}</th>`;
  }).join("");
  table.appendChild(header);

  for (const room of rooms) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${room}</td>`;

    for (const date of dates) {
      const cell = document.createElement("td");
      const res = reservations.find(r =>
        r.roomNumber === room &&
        date >= r.arrivalDate &&
        date <= r.departureDate
      );

      if (res) {
        const customer = customers.find(c => c.id === res.customerId);
        const name = customer ? customer.name : "Unknown";
        const button = document.createElement("button");
        button.textContent = name;
        button.className = "guest-btn";
        if (res.paymentStatus === "unpaid") {
          button.classList.add("unpaid");
        } else if (res.paymentStatus === "partially_paid") {
          button.classList.add("partial");
        } else {
          button.classList.add("paid");
        }
        button.title = `${name} — ${res.arrivalDate} to ${res.departureDate}`;
        button.addEventListener("click", () => showEditDeletePopup(res));
        cell.appendChild(button);
      } else {
        cell.classList.add("cell-available");
      }

      row.appendChild(cell);
    }

    table.appendChild(row);
  }

  grid.appendChild(table);
}

// ============================================================================
// SECTION: RESERVATION DETAILS MODAL (Edit/Delete Popup)
// ============================================================================

/**
 * Display the reservation detail/edit modal.
 * 
 * This is the main function for viewing and editing reservation details.
 * Called when user clicks on a reservation in the calendar or table views.
 * 
 * @param {Object} reservation - Reservation document from Firestore
 * @param {string} reservation.id - Firestore document ID
 * @param {string} reservation.customerId - Reference to customer document
 * @param {string} reservation.roomNumber - Room number (e.g., "101")
 * @param {string} reservation.arrivalDate - Check-in date (YYYY-MM-DD)
 * @param {string} reservation.departureDate - Check-out date (YYYY-MM-DD)
 * @param {string} reservation.paymentStatus - not_paid|partially_paid|fully_paid
 * @param {boolean} reservation.checkedIn - Whether guest has checked in
 * @param {boolean} reservation.checkedOut - Whether guest has checked out
 * @param {string} reservation.note - Special instructions/notes
 */
function showEditDeletePopup(reservation) {
  // ─────────────────────────────────────────────────────────────────────────
  // CLEANUP: Remove any existing edit popup to prevent ID conflicts
  // ─────────────────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-popup-type="edit-reservation"]').forEach(el => el.remove());
  
  // ─────────────────────────────────────────────────────────────────────────
  // DATA FRESHNESS: Fetch latest reservation data asynchronously
  // This handles scenarios where another staff member modified the reservation
  // ─────────────────────────────────────────────────────────────────────────
  (async () => {
    try {
      const freshResDoc = await getDoc(doc(db, "reservations", reservation.id));
      if (freshResDoc.exists()) {
        const freshRes = { id: freshResDoc.id, ...freshResDoc.data() };
        // Update the reservation object with fresh data
        Object.assign(reservation, freshRes);
      }
    } catch (e) {
      console.warn("Could not fetch fresh reservation data:", e);
    }
  })();
  
  // ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER LOOKUP: Get customer info for display
  // ─────────────────────────────────────────────────────────────────────────
  const customer = customers.find(c => c.id === reservation.customerId);

  /**
   * Calculate actual nights stayed (not accounting for special offers).
   * Used for display purposes in the nights badge.
   */
  function calculateNights(arrival, departure) {
    const start = new Date(arrival);
    const end = new Date(departure);
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHECK-IN/OUT STATUS: Determine current state for UI rendering
  // ─────────────────────────────────────────────────────────────────────────
  // Support both checkedIn flag and actualCheckInTime from payment confirmation
  const checkedIn = reservation.checkedIn || !!reservation.actualCheckInTime;
  const checkedOut = reservation.checkedOut || false;
  // Get check-in time from either source
  const rawCheckInTime = reservation.actualCheckInTime || reservation.checkedInTime;
  const checkedInTime = rawCheckInTime ? formatDateTimeDMY(rawCheckInTime) : 'Not yet';
  const checkedOutTime = reservation.checkedOutTime ? formatDateTimeDMY(reservation.checkedOutTime) : 'Not yet';
  const nights = calculateNights(reservation.arrivalDate, reservation.departureDate);

  // ─────────────────────────────────────────────────────────────────────────
  // MODAL CREATION: Build the modal HTML structure
  // ─────────────────────────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.setAttribute('data-popup-type', 'edit-reservation');
  overlay.className = 'modal reservation-popup-modal';
  overlay.style.display = 'block';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Edit reservation');

  overlay.innerHTML = `
    <div class="modal-content modal-compact" style="max-width:680px;">
      <button class="close" aria-label="Close dialog" id="closeReservationPopup">&times;</button>
      <h2><span class="material-icons" aria-hidden="true">hotel</span> Room ${reservation.roomNumber} — ${customer?.name || 'Unknown'}</h2>

      <div class="compact-form">
        <!-- Guest Info (read-only) -->
        <fieldset>
          <legend><span class="material-icons" aria-hidden="true">person</span> Guest Information</legend>
          <div class="form-grid">
            <div class="compact-group">
              <label>Phone</label>
              <div class="info-readonly">${customer?.telephone || 'N/A'}</div>
            </div>
            <div class="compact-group">
              <label>Address</label>
              <div class="info-readonly">${customer?.address || 'N/A'}</div>
            </div>
          </div>
        </fieldset>

        <!-- Check-in / Check-out Status -->
        <div class="status-strip">
          <div class="status-pill ${checkedIn ? 'pill-success' : 'pill-pending'}">
            <span class="material-icons" style="font-size:16px;">${checkedIn ? 'check_circle' : 'schedule'}</span>
            In: ${checkedIn ? checkedInTime : 'Pending'}
          </div>
          <div class="status-pill ${checkedOut ? 'pill-success' : (checkedIn ? 'pill-pending' : 'pill-disabled')}">
            <span class="material-icons" style="font-size:16px;">${checkedOut ? 'check_circle' : 'schedule'}</span>
            Out: ${checkedOut ? checkedOutTime : 'Pending'}
          </div>
          <div class="status-strip-actions">
            <button id="checkInBtn" class="btn btn-sm ${checkedIn ? 'btn-disabled' : 'btn-success'}" ${checkedIn ? 'disabled' : ''}>
              ${checkedIn ? '✓ In' : 'Check In'}
            </button>
            ${checkedIn && !checkedOut ? `<button id="undoCheckInBtn" class="btn btn-ghost btn-sm">↩</button>` : ''}
            <button id="checkOutBtn" class="btn btn-sm ${checkedOut ? 'btn-disabled' : 'btn-warning'}" ${checkedOut || !checkedIn ? 'disabled' : ''}>
              ${checkedOut ? '✓ Out' : 'Check Out'}
            </button>
            ${checkedOut ? `<button id="undoCheckOutBtn" class="btn btn-ghost btn-sm">↩</button>` : ''}
          </div>
        </div>

        <!-- Edit Stay Details -->
        <fieldset>
          <legend><span class="material-icons" aria-hidden="true">edit</span> Edit Stay Details</legend>
          <div class="form-grid">
            <div class="compact-group">
              <label for="editRoom">Room</label>
              <input type="text" id="editRoom" value="${reservation.roomNumber}" />
            </div>
            <div class="compact-group">
              <label for="editRate">Rate/Night ($)</label>
              <input type="number" id="editRate" value="${reservation.rate || ''}" min="0" step="0.01" placeholder="e.g. 85.00" />
            </div>
            <div class="compact-group">
              <label for="editArrivalDate">Check-in Date</label>
              <input type="date" id="editArrivalDate" value="${reservation.arrivalDate}" />
            </div>
            <div class="compact-group">
              <label for="editDepartureDate">Check-out Date</label>
              <input type="date" id="editDepartureDate" value="${reservation.departureDate}" />
            </div>
            <div class="compact-group full-width">
              <label for="editNote">Note</label>
              <textarea id="editNote" rows="2">${escapeHTML(reservation.note || '')}</textarea>
            </div>
          </div>
        </fieldset>

        <!-- Action Buttons -->
        <div class="modal-footer compact-footer">
          <button id="viewHistoryBtn" class="btn btn-secondary btn-sm"><span class="material-icons">history</span> History</button>
          <button id="printRegistrationFromEditBtn" class="btn btn-secondary btn-sm"><span class="material-icons">print</span> Print</button>
          <button id="extendReservationBtn" class="btn btn-secondary btn-sm"><span class="material-icons">update</span> Extend</button>
          <button id="lateFeeBtn" class="btn btn-danger btn-sm"><span class="material-icons">schedule</span> Late Fee</button>
          <button id="managePaymentBtn" class="btn btn-warning btn-sm"><span class="material-icons">payments</span> Payment</button>
          <button id="deleteBtn" class="btn btn-danger btn-sm"><span class="material-icons">delete</span> Delete</button>
          <button id="saveEditBtn" class="btn btn-primary btn-sm"><span class="material-icons">save</span> Save</button>
          <button id="cancelPopup" class="btn btn-ghost btn-sm">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close button handler
  overlay.querySelector("#closeReservationPopup").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  // Check-in button handler
  overlay.querySelector("#checkInBtn").onclick = async () => {
    if (reservation.checkedIn || reservation.actualCheckInTime) return;
    const checkInBtn = overlay.querySelector("#checkInBtn");
    if (checkInBtn.disabled) return;
    checkInBtn.disabled = true;
    checkInBtn.textContent = "Processing...";
    try {
      const now = new Date().toISOString();
      const employee = getCurrentEmployeeInfo();
      await updateDoc(doc(db, "reservations", reservation.id), {
        checkedIn: true,
        checkedInTime: now,
        actualCheckInTime: now,
        checkedInBy: employee.uid,
        checkedInByName: employee.name
      });
      alert("Guest checked in!");
      reservation.checkedIn = true;
      reservation.checkedInTime = now;
      reservation.actualCheckInTime = now;
      reservation.checkedInBy = employee.uid;
      reservation.checkedInByName = employee.name;
      overlay.remove();
      showEditDeletePopup(reservation);
      fillDashboard();
    } catch (err) {
      console.error("Check-in failed:", err);
      alert("Failed to check in. Please try again.");
      checkInBtn.disabled = false;
      checkInBtn.innerHTML = '<span class="material-icons">login</span> Check In';
    }
  };

  // Check-out button handler
  overlay.querySelector("#checkOutBtn").onclick = async () => {
    if (reservation.checkedOut || (!reservation.checkedIn && !reservation.actualCheckInTime)) return;
    const checkOutBtn = overlay.querySelector("#checkOutBtn");
    if (checkOutBtn.disabled) return;
    checkOutBtn.disabled = true;
    checkOutBtn.textContent = "Processing...";
    try {
      const now = new Date().toISOString();
      const employee = getCurrentEmployeeInfo();
      await updateDoc(doc(db, "reservations", reservation.id), {
        checkedOut: true,
        checkedOutTime: now,
        checkedOutBy: employee.uid,
        checkedOutByName: employee.name
      });
      alert("Guest checked out!");
      reservation.checkedOut = true;
      reservation.checkedOutTime = now;
      reservation.checkedOutBy = employee.uid;
      reservation.checkedOutByName = employee.name;
      overlay.remove();
      showEditDeletePopup(reservation);
      fillDashboard();
    } catch (err) {
      console.error("Check-out failed:", err);
      alert("Failed to check out. Please try again.");
      checkOutBtn.disabled = false;
      checkOutBtn.innerHTML = '<span class="material-icons">logout</span> Check Out';
    }
  };

  // Undo Check-In button handler
  const undoCheckInBtn = overlay.querySelector("#undoCheckInBtn");
  if (undoCheckInBtn) {
    undoCheckInBtn.onclick = async () => {
      if (!confirm("Are you sure you want to undo the check-in?")) return;
      if (undoCheckInBtn.disabled) return;
      undoCheckInBtn.disabled = true;
      undoCheckInBtn.textContent = "Processing...";
      try {
        await updateDoc(doc(db, "reservations", reservation.id), {
          checkedIn: false,
          checkedInTime: null,
          actualCheckInTime: null,
          checkedInBy: null,
          checkedInByName: null
        });
        alert("Check-in undone!");
        reservation.checkedIn = false;
        reservation.checkedInTime = null;
        reservation.actualCheckInTime = null;
        reservation.checkedInBy = null;
        reservation.checkedInByName = null;
        overlay.remove();
        showEditDeletePopup(reservation);
        fillDashboard();
      } catch (err) {
        console.error("Undo check-in failed:", err);
        alert("Failed to undo check-in. Please try again.");
        undoCheckInBtn.disabled = false;
        undoCheckInBtn.textContent = "Undo Check-In";
      }
    };
  }

  // Undo Check-Out button handler
  const undoCheckOutBtn = overlay.querySelector("#undoCheckOutBtn");
  if (undoCheckOutBtn) {
    undoCheckOutBtn.onclick = async () => {
      if (!confirm("Are you sure you want to undo the check-out?")) return;
      if (undoCheckOutBtn.disabled) return;
      undoCheckOutBtn.disabled = true;
      undoCheckOutBtn.textContent = "Processing...";
      try {
        await updateDoc(doc(db, "reservations", reservation.id), {
          checkedOut: false,
          checkedOutTime: null,
          checkedOutBy: null,
          checkedOutByName: null
        });
        alert("Check-out undone!");
        reservation.checkedOut = false;
        reservation.checkedOutTime = null;
        reservation.checkedOutBy = null;
        reservation.checkedOutByName = null;
        overlay.remove();
        showEditDeletePopup(reservation);
        fillDashboard();
      } catch (err) {
        console.error("Undo check-out failed:", err);
        alert("Failed to undo check-out. Please try again.");
        undoCheckOutBtn.disabled = false;
        undoCheckOutBtn.textContent = "Undo Check-Out";
      }
    };
  }

  // --- Print button handler ---
  overlay.querySelector("#printRegistrationFromEditBtn").onclick = async () => {
    const customer = customers.find(c => c.id === reservation.customerId) || {};
    overlay.remove(); // close edit overlay

    // ✅ If ID exists, skip upload
    if (customer.idImageUrl) {
      await showFormPreview(reservation, customer, customer.idImageUrl);
      return;
    }

    // ❌ If no ID yet, ask to upload
    ModalManager.open('idUploadModal');

    document.getElementById("cropAndContinueBtn").onclick = async () => {
      if (!cropperInstance) return;
      const canvas = cropperInstance.getCroppedCanvas({ width: 300, height: 200 });
      const croppedImageDataURL = canvas.toDataURL("image/jpeg");

      cropperInstance.destroy();
      cropperInstance = null;
      ModalManager.close('idCropModal');

      // Save ID
      await updateDoc(doc(db, "customers", reservation.customerId), {
        idImageUrl: croppedImageDataURL
      });
      const idx = customers.findIndex(c => c.id === reservation.customerId);
      if (idx !== -1) customers[idx].idImageUrl = croppedImageDataURL;

      await showFormPreview(reservation, customer, croppedImageDataURL);
    };
  };

  // Cancel overlay
  overlay.querySelector("#cancelPopup").onclick = () => overlay.remove();

  // Delete
  overlay.querySelector("#deleteBtn").onclick = async () => {
    if (!confirm("Are you sure you want to delete this reservation?")) return;
    const deleteBtn = overlay.querySelector("#deleteBtn");
    if (deleteBtn.disabled) return;
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting...";
    try {
      // Audit log before deletion
      await auditLog(AUDIT_ACTIONS.RESERVATION_DELETE, {
        roomNumber: reservation.roomNumber,
        arrivalDate: reservation.arrivalDate,
        departureDate: reservation.departureDate,
        customerId: reservation.customerId,
        paymentStatus: reservation.paymentStatus
      }, 'reservation', reservation.id);

      await deleteDoc(doc(db, "reservations", reservation.id));
      alert("Deleted.");
      overlay.remove();
      fillDashboard();
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete reservation. Please try again.");
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = '<span class="material-icons">delete</span> Delete';
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SAVE EDITS: Update room, rate, dates, special offer, and note
  // ─────────────────────────────────────────────────────────────────────────
  const saveEditBtn = overlay.querySelector("#saveEditBtn");
  saveEditBtn.onclick = async () => {
    // ─────────────────────────────────────────────────────────────────────────
    // SPAM PREVENTION: Disable button while processing
    // ─────────────────────────────────────────────────────────────────────────
    if (saveEditBtn.disabled) {
      console.warn("Save already in progress");
      return;
    }
    saveEditBtn.disabled = true;
    const originalSaveText = saveEditBtn.innerHTML;
    saveEditBtn.innerHTML = '<span class="material-icons" style="font-size:18px; vertical-align:middle;">hourglass_empty</span> Saving...';
    
    const resetSaveBtn = () => {
      saveEditBtn.disabled = false;
      saveEditBtn.innerHTML = originalSaveText;
    };
    
    const room = overlay.querySelector("#editRoom").value.trim();
    const rateInput = overlay.querySelector("#editRate").value;
    const newRate = rateInput ? parseFloat(rateInput) : null;
    const note = overlay.querySelector("#editNote").value.trim();
    const arrivalDate = overlay.querySelector("#editArrivalDate").value;
    const departureDate = overlay.querySelector("#editDepartureDate").value;

    // Store old values for comparison and history tracking
    const oldRate = parseFloat(reservation.rate) || 0;
    const oldArrivalDate = reservation.arrivalDate;
    const oldDepartureDate = reservation.departureDate;
    const oldRoom = reservation.roomNumber;

    // ─────────────────────────────────────────────────────────────────────────
    // VALIDATION: Ensure required fields are filled correctly
    // ─────────────────────────────────────────────────────────────────────────
    if (!room) {
      alert("Room number is required.");
      resetSaveBtn();
      return;
    }
    if (newRate !== null && (isNaN(newRate) || newRate < 0)) {
      alert("Please enter a valid rate (0 or greater).");
      resetSaveBtn();
      return;
    }
    if (!arrivalDate || !departureDate) {
      alert("Check-in and Check-out dates are required.");
      resetSaveBtn();
      return;
    }
    if (new Date(departureDate) <= new Date(arrivalDate)) {
      alert("Check-out date must be after Check-in date.");
      resetSaveBtn();
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // OVERLAP CHECK: If room or dates changed, check for conflicts
    // ─────────────────────────────────────────────────────────────────────────
    const roomChanged = room !== oldRoom;
    const datesChangedForOverlap = arrivalDate !== oldArrivalDate || departureDate !== oldDepartureDate;
    
    if (roomChanged || datesChangedForOverlap) {
      const hasOverlapConflict = await hasOverlap(reservation.id, room, arrivalDate, departureDate);
      if (hasOverlapConflict) {
        alert(`Cannot save changes. Room ${room} has a conflicting reservation for the selected dates.\n\nPlease choose different dates or a different room.`);
        resetSaveBtn();
        return;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DETECT CHANGES: Track what changed for history and recalculation
    // ─────────────────────────────────────────────────────────────────────────
    const rateChanged = newRate !== null && newRate !== oldRate;
    const datesChanged = arrivalDate !== oldArrivalDate || departureDate !== oldDepartureDate;
    // roomChanged already defined above for overlap check

    // ─────────────────────────────────────────────────────────────────────────
    // BUILD UPDATE DATA: Prepare the document update
    // ─────────────────────────────────────────────────────────────────────────
    const updateData = {
      roomNumber: room,
      note,
      arrivalDate,
      departureDate
    };
    
    // Only update rate if a value was entered
    if (newRate !== null) {
      updateData.rate = newRate;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RECALCULATE PAYMENT STATUS: When rate/dates/offer changes, balance changes
    // This ensures receipts and payment displays stay consistent
    // ─────────────────────────────────────────────────────────────────────────
    if (rateChanged || datesChanged) {
      try {
        // Get all payments for this reservation (excluding voided ones)
        const paymentsSnapshot = await getDocs(collection(db, "payments"));
        const reservationPayments = paymentsSnapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(p => p.reservationId === reservation.id && !p.voided);
        
        // Calculate new total due with updated rate/dates
        const effectiveRate = newRate !== null ? newRate : oldRate;
        const nights = calculateSpecialNights(arrivalDate, departureDate);
        const baseTotal = effectiveRate * nights;
        
        // Include balance adjustments (discounts/fees)
        const adjustments = reservation.balanceAdjustments || [];
        const totalAdjustment = calcAdjustmentTotal(adjustments);
        const newTotalDue = baseTotal + totalAdjustment;
        
        // Sum up what's been paid
        const totalPaid = reservationPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) + calcCreditTotal(reservation.balanceCredits);
        
        // Determine new payment status
        let newPaymentStatus = "not_paid";
        if (totalPaid >= newTotalDue) {
          newPaymentStatus = "fully_paid";
        } else if (totalPaid > 0) {
          newPaymentStatus = "partially_paid";
        }
        
        // Add payment status to update
        updateData.paymentStatus = newPaymentStatus;
        
        // Calculate old total for comparison display
        const oldNights = calculateSpecialNights(oldArrivalDate, oldDepartureDate);
        const oldTotalDue = oldRate * oldNights + totalAdjustment;
        const oldBalance = Math.max(0, oldTotalDue - totalPaid);
        const newBalance = Math.max(0, newTotalDue - totalPaid);
        
        // Show user the impact of changes
        if (rateChanged || datesChanged) {
          console.log(`📊 Rate change impact: Old total $${oldTotalDue.toFixed(2)} → New total $${newTotalDue.toFixed(2)}`);
          console.log(`📊 Balance change: $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)}`);
        }
      } catch (err) {
        console.warn("Could not recalculate payment status:", err);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADD HISTORY ENTRY: Track the modification for audit trail
    // ─────────────────────────────────────────────────────────────────────────
    const employee = getCurrentEmployeeInfo();
    const history = reservation.history || [];
    
    // Build description of what changed
    const changes = [];
    if (roomChanged) changes.push(`Room: ${oldRoom} → ${room}`);
    if (rateChanged) changes.push(`Rate: $${oldRate.toFixed(2)} → $${newRate.toFixed(2)}`);
    if (datesChanged) {
      if (arrivalDate !== oldArrivalDate) changes.push(`Check-in: ${formatDateDMY(oldArrivalDate)} → ${formatDateDMY(arrivalDate)}`);
      if (departureDate !== oldDepartureDate) changes.push(`Check-out: ${formatDateDMY(oldDepartureDate)} → ${formatDateDMY(departureDate)}`);
    }
    
    // Only add history entry if something meaningful changed
    if (changes.length > 0) {
      history.push({
        type: 'modified',
        date: new Date().toISOString(),
        byName: employee.name,
        byUid: employee.uid,
        changes: changes.join(', '),
        // Store specific values for detailed history view
        rate: newRate !== null ? newRate : oldRate,
        arrivalDate: arrivalDate,
        departureDate: departureDate,
        roomNumber: room
      });
      updateData.history = history;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SAVE TO DATABASE: Commit all changes atomically
    // ─────────────────────────────────────────────────────────────────────────
    try {
      await updateDoc(doc(db, "reservations", reservation.id), updateData);

      // Build success message with details if rate/dates changed
      let successMessage = "✅ Reservation updated.";
      if (rateChanged || datesChanged) {
        const effectiveRate = newRate !== null ? newRate : oldRate;
        const nights = calculateSpecialNights(arrivalDate, departureDate);
        const newTotal = effectiveRate * nights;
        successMessage = `✅ Reservation updated.\n\nNew Total: $${newTotal.toFixed(2)} (${nights} night${nights !== 1 ? 's' : ''} × $${effectiveRate.toFixed(2)}/night)`;
      }
      alert(successMessage);
      
      // ─────────────────────────────────────────────────────────────────────────
      // UPDATE LOCAL STATE: Sync local reservation object with saved data
      // ─────────────────────────────────────────────────────────────────────────
      reservation.roomNumber = room;
      if (newRate !== null) reservation.rate = newRate;
      reservation.note = note;
      reservation.arrivalDate = arrivalDate;
      reservation.departureDate = departureDate;
      if (updateData.paymentStatus) reservation.paymentStatus = updateData.paymentStatus;
      if (updateData.history) reservation.history = history;
      
      // ─────────────────────────────────────────────────────────────────────────
      // CRITICAL: Update the global cache to keep batch close/reports consistent
      // ─────────────────────────────────────────────────────────────────────────
      if (window._reservationsCache) {
        const cacheIndex = window._reservationsCache.findIndex(r => r.id === reservation.id);
        if (cacheIndex !== -1) {
          // Update the cached reservation with all new values
          window._reservationsCache[cacheIndex] = { ...window._reservationsCache[cacheIndex], ...reservation };
          console.log('✅ Updated reservation in cache:', reservation.id);
        }
      }
      
      // Refresh UI - no need to reset button since we're removing the overlay
      overlay.remove();
      showEditDeletePopup(reservation);
      fillDashboard();
    } catch (err) {
      console.error("Failed to save reservation:", err);
      alert("Failed to save changes. Please try again.");
      resetSaveBtn();
    }
  };

  // Manage payment - store reference to show popup again after closing payment modal
  overlay.querySelector("#managePaymentBtn").onclick = async () => {
    // Store the reservation reference so we can re-open the popup after payment modal closes
    window._lastReservationForPopup = reservation;
    // Close any open customer modals that might be blocking
    const customerDetailsModal = document.getElementById("customerDetailsModal");
    if (customerDetailsModal) customerDetailsModal.style.display = "none";
    const editCustomerModal = document.getElementById("editCustomerModal");
    if (editCustomerModal) editCustomerModal.style.display = "none";
    const searchCustomerModal = document.getElementById("searchCustomerModal");
    if (searchCustomerModal) searchCustomerModal.style.display = "none";
    overlay.remove();
    await openManagePaymentModal(reservation);
  };

  // View History button handler
  overlay.querySelector("#viewHistoryBtn").onclick = () => {
    overlay.remove();
    showReservationHistory(reservation);
  };

  // Extend
  overlay.querySelector("#extendReservationBtn").onclick = () => {
    // Store the reservation reference so we can re-open the popup after extend modal closes
    window._lastReservationForPopup = reservation;
    overlay.remove();
    openExtendReservationModal(reservation);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // LATE FEE BUTTON HANDLER
  // Records a late checkout fee with receipt number and sends to QuickBooks
  // ─────────────────────────────────────────────────────────────────────────
  overlay.querySelector("#lateFeeBtn").onclick = () => {
    window._lastReservationForPopup = reservation;
    overlay.remove();
    openLateFeeModal(reservation);
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LATE FEE MODAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Opens a modal to record a late checkout fee. The fee is:
 * - Recorded with a unique receipt number
 * - Sent to QuickBooks with "*** LATE FEE ***" prominently in description
 * - Added to the reservation's payment history
 */
async function openLateFeeModal(reservation) {
  // Remove any existing late fee modal
  document.querySelectorAll('[data-popup-type="late-fee-modal"]').forEach(el => el.remove());
  
  const customer = customers.find(c => c.id === reservation.customerId) || {};
  
  // Preview receipt number
  let previewReceipt = '';
  try {
    previewReceipt = await getNextPreviewReceiptNumber();
  } catch (e) {
    console.warn("Could not preview receipt number:", e);
  }
  
  const lateFeeOverlay = document.createElement("div");
  lateFeeOverlay.setAttribute('data-popup-type', 'late-fee-modal');
  lateFeeOverlay.className = 'modal reservation-popup-modal';
  lateFeeOverlay.style.display = 'block';
  lateFeeOverlay.style.zIndex = '3002';
  lateFeeOverlay.setAttribute('role', 'dialog');
  lateFeeOverlay.setAttribute('aria-modal', 'true');
  lateFeeOverlay.setAttribute('aria-label', 'Late fee charge');
  
  lateFeeOverlay.innerHTML = `
    <div class="modal-content modal-scrollable" style="max-width: 500px;">
      <button class="close" aria-label="Close dialog" id="closeLateFeeModal">&times;</button>
      
      <div style="text-align:center; padding:20px; background:#dc2626; color:#fff; border-radius:8px; margin-bottom:20px;">
        <span class="material-icons" style="font-size:48px; margin-bottom:8px;">schedule</span>
        <h2 style="margin:0; font-size:1.8em; font-weight:800;">⚠️ LATE FEE ⚠️</h2>
        <p style="margin:8px 0 0 0; opacity:0.9;">Late Checkout Penalty Charge</p>
      </div>
      
      <div style="background:var(--bg-tertiary); padding:16px; border-radius:8px; margin-bottom:16px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div>
            <label style="font-size:0.85em; color:var(--text-muted);">Guest</label>
            <div style="font-weight:600;">${escapeHTML(customer.name || 'Unknown')}</div>
          </div>
          <div>
            <label style="font-size:0.85em; color:var(--text-muted);">Room</label>
            <div style="font-weight:600;">${reservation.roomNumber}</div>
          </div>
          <div>
            <label style="font-size:0.85em; color:var(--text-muted);">Original Check-out</label>
            <div style="font-weight:600;">${formatDateDMY(reservation.departureDate)}</div>
          </div>
          <div>
            <label style="font-size:0.85em; color:var(--text-muted);">Today</label>
            <div style="font-weight:600; color:#dc2626;">${formatDateDMY(new Date())}</div>
          </div>
        </div>
      </div>
      
      <div class="form-group" style="margin-bottom:16px;">
        <label style="font-weight:600; display:block; margin-bottom:6px;">
          <span class="material-icons" style="vertical-align:middle; font-size:18px;">attach_money</span>
          Late Fee Amount ($)
        </label>
        <input type="number" id="lateFeeAmount" step="0.01" min="0" placeholder="Enter late fee amount" 
               style="width:100%; padding:12px; font-size:1.1em; border:2px solid #dc2626; border-radius:8px; background:var(--bg-secondary); color:var(--text-primary);" />
      </div>
      
      <div class="form-group" style="margin-bottom:16px;">
        <label style="font-weight:600; display:block; margin-bottom:6px;">
          <span class="material-icons" style="vertical-align:middle; font-size:18px;">payment</span>
          Payment Method
        </label>
        <select id="lateFeeMethod" style="width:100%; padding:12px; font-size:1em; border:1px solid var(--border-medium); border-radius:8px; background:var(--bg-secondary); color:var(--text-primary);">
          <option value="">-- Select Method --</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="cheque">Cheque</option>
          <option value="mobile">Mobile Banking</option>
        </select>
      </div>
      
      <div class="form-group" style="margin-bottom:16px;">
        <label style="font-weight:600; display:block; margin-bottom:6px;">
          <span class="material-icons" style="vertical-align:middle; font-size:18px;">receipt</span>
          Receipt Number (Auto)
        </label>
        <input type="text" id="lateFeeReceipt" value="${previewReceipt}" readonly 
               style="width:100%; padding:12px; font-size:1em; border:1px solid var(--border-medium); border-radius:8px; background:var(--bg-tertiary); color:var(--text-muted);" />
      </div>
      
      <div class="form-group" style="margin-bottom:20px;">
        <label style="font-weight:600; display:block; margin-bottom:6px;">
          <span class="material-icons" style="vertical-align:middle; font-size:18px;">notes</span>
          Note (Optional)
        </label>
        <textarea id="lateFeeNote" rows="2" placeholder="Additional notes about the late fee..."
                  style="width:100%; padding:12px; font-size:1em; border:1px solid var(--border-medium); border-radius:8px; background:var(--bg-secondary); color:var(--text-primary); resize:vertical;"></textarea>
      </div>
      
      <div style="background:#fef2f2; border:2px solid #dc2626; border-radius:8px; padding:12px; margin-bottom:20px;">
        <p style="margin:0; font-size:0.9em; color:#991b1b;">
          <strong>⚠️ Important:</strong> This late fee will be recorded as a separate payment and sent to QuickBooks 
          with <strong>"*** LATE FEE ***"</strong> clearly marked in the description.
        </p>
      </div>
      
      <div class="modal-footer" style="display:flex; gap:12px; justify-content:flex-end;">
        <button id="cancelLateFee" class="btn btn-ghost">Cancel</button>
        <button id="confirmLateFee" class="btn btn-danger">
          <span class="material-icons" style="vertical-align:middle;">check</span>
          Confirm Late Fee
        </button>
        <button id="confirmLateFeeAndPrint" class="btn btn-danger">
          <span class="material-icons" style="vertical-align:middle;">print</span>
          Confirm & Print
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(lateFeeOverlay);
  
  // Focus on amount input
  setTimeout(() => document.getElementById("lateFeeAmount")?.focus(), 100);
  
  // Close handlers
  const closeLateFeeModal = () => {
    lateFeeOverlay.remove();
    if (window._lastReservationForPopup) {
      showEditDeletePopup(window._lastReservationForPopup);
      window._lastReservationForPopup = null;
    }
  };
  
  lateFeeOverlay.querySelector("#closeLateFeeModal").onclick = closeLateFeeModal;
  lateFeeOverlay.querySelector("#cancelLateFee").onclick = closeLateFeeModal;
  // Outside click disabled — use X or Cancel buttons
  
  // Save late fee handler
  const saveLateFee = async (shouldPrint = false) => {
    // ─────────────────────────────────────────────────────────────────────────
    // SPAM PREVENTION: Disable buttons during processing
    // ─────────────────────────────────────────────────────────────────────────
    const confirmBtn = lateFeeOverlay.querySelector("#confirmLateFee");
    const confirmPrintBtn = lateFeeOverlay.querySelector("#confirmLateFeeAndPrint");
    
    if (confirmBtn?.disabled || confirmPrintBtn?.disabled) {
      console.warn("Late fee submission already in progress");
      return;
    }
    
    // Disable both buttons to prevent double-submission
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="material-icons" style="vertical-align:middle;">hourglass_empty</span> Processing...';
    }
    if (confirmPrintBtn) {
      confirmPrintBtn.disabled = true;
      confirmPrintBtn.innerHTML = '<span class="material-icons" style="vertical-align:middle;">hourglass_empty</span> Processing...';
    }
    
    const resetButtons = () => {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<span class="material-icons" style="vertical-align:middle;">check</span> Confirm Late Fee';
      }
      if (confirmPrintBtn) {
        confirmPrintBtn.disabled = false;
        confirmPrintBtn.innerHTML = '<span class="material-icons" style="vertical-align:middle;">print</span> Confirm & Print';
      }
    };
    
    const lateFeeAmount = parseFloat(document.getElementById("lateFeeAmount").value);
    const lateFeeMethod = document.getElementById("lateFeeMethod").value;
    const lateFeeNote = document.getElementById("lateFeeNote").value.trim();
    
    // Validation
    if (isNaN(lateFeeAmount) || lateFeeAmount <= 0) {
      alert("Please enter a valid late fee amount.");
      resetButtons();
      return;
    }
    if (!lateFeeMethod) {
      alert("Please select a payment method.");
      resetButtons();
      return;
    }
    
    try {
      // Generate receipt number
      const lateFeeReceiptNumber = await getNextReceiptNumber();
      document.getElementById("lateFeeReceipt").value = lateFeeReceiptNumber;
      
      const employee = getCurrentEmployeeInfo();
      const timestamp = new Date().toISOString();
      
      // Create late fee payment record
      const lateFeePaymentData = {
        customerId: reservation.customerId,
        reservationId: reservation.id,
        receiptNumber: lateFeeReceiptNumber,
        amount: lateFeeAmount,
        method: lateFeeMethod,
        timestamp: timestamp,
        recordedBy: employee.uid,
        recordedByName: employee.name,
        isLateFee: true,
        lateFeeNote: lateFeeNote,
        note: `*** LATE FEE *** - Late checkout penalty. ${lateFeeNote}`.trim(),
        qbSyncStatus: 'pending'
      };
      
      const lateFeePaymentRef = await addDoc(collection(db, "payments"), lateFeePaymentData);
      
      // Build QuickBooks data with LATE FEE prominently in description
      const qbLateFeeData = {
        name: customer.name || 'Guest',
        email: customer.email || '',
        phone: customer.telephone || '',
        address: customer.address || '',
        customerNumber: customer.customerNumber || '',
        amount: lateFeeAmount,
        receiptNumber: lateFeeReceiptNumber,
        method: lateFeeMethod,
        date: timestamp.split("T")[0],
        room: reservation.roomNumber,
        checkin: reservation.arrivalDate,
        checkout: reservation.departureDate,
        nights: 0, // Late fee doesn't count as nights
        rate: 0,
        // *** LATE FEE *** prominently in description for QuickBooks
        notes: `*** LATE FEE *** - Late checkout for Room ${reservation.roomNumber}. Original checkout: ${formatDateDMY(reservation.departureDate)}. ${lateFeeNote}`.trim(),
        description: `*** LATE FEE *** - Room ${reservation.roomNumber} - ${escapeHTML(customer.name || 'Guest')}`,
        recordedBy: employee.name,
        paymentId: lateFeePaymentRef.id,
        reservationId: reservation.id,
        customerId: customer.id || '',
        isLateFee: true
      };
      
      // Push to QuickBooks
      await pushToQuickBooks(qbLateFeeData, lateFeePaymentRef.id);
      
      // Add to reservation history
      const currentHistory = reservation.history || [];
      currentHistory.push({
        type: 'late_fee',
        date: timestamp,
        amount: lateFeeAmount,
        receiptNumber: lateFeeReceiptNumber,
        method: lateFeeMethod,
        note: lateFeeNote,
        byName: employee.name,
        byUid: employee.uid
      });
      
      await updateDoc(doc(db, "reservations", reservation.id), {
        history: currentHistory
      });
      
      // Update paymentStatus after late fee payment
      const lfNights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
      const lfRate = parseFloat(reservation.rate || 0);
      const lfBaseTotal = lfRate * lfNights;
      const lfAdj = calcAdjustmentTotal(reservation.balanceAdjustments);
      const lfTotalDue = lfBaseTotal + lfAdj;
      const lfCached = (window._allPaymentsCache || []).filter(p => p.reservationId === reservation.id && !p.voided);
      const lfTotalPaid = lfCached.reduce((s, p) => s + parseFloat(p.amount || 0), 0) + lateFeeAmount;
      const lfStatus = lfTotalPaid >= lfTotalDue ? 'fully_paid' : 'partially_paid';
      await updateDoc(doc(db, "reservations", reservation.id), { paymentStatus: lfStatus });
      
      // Audit log - specifically for late fees
      await auditLog(AUDIT_ACTIONS.LATE_FEE, {
        receiptNumber: lateFeeReceiptNumber,
        amount: lateFeeAmount,
        method: lateFeeMethod,
        customerName: customer.name,
        roomNumber: reservation.roomNumber,
        reservationId: reservation.id,
        originalCheckout: reservation.departureDate,
        note: `*** LATE FEE *** - ${lateFeeNote || 'Late checkout penalty'}`
      }, 'payment', lateFeeReceiptNumber);
      
      // Update local cache
      if (window._lastReservationForPopup) {
        window._lastReservationForPopup.history = currentHistory;
      }
      
      alert(`Late Fee recorded successfully!\n\nReceipt #${lateFeeReceiptNumber}\nAmount: $${lateFeeAmount.toFixed(2)}\n\nThis has been sent to QuickBooks with "LATE FEE" in the description.`);
      
      // Print if requested
      if (shouldPrint) {
        printLateFeeReceipt({
          receiptNumber: lateFeeReceiptNumber,
          amount: lateFeeAmount,
          method: lateFeeMethod,
          customerName: customer.name || 'Guest',
          room: reservation.roomNumber,
          originalCheckout: formatDateDMY(reservation.departureDate),
          date: formatDateTimeDMY(timestamp),
          note: lateFeeNote
        });
      }
      
      lateFeeOverlay.remove();
      
      // Refresh and return to reservation
      if (window._lastReservationForPopup) {
        showEditDeletePopup(window._lastReservationForPopup);
        window._lastReservationForPopup = null;
      }
      
      try { await fillDashboard(); } catch (e) { console.error('Dashboard refresh failed after late fee:', e); }
      
    } catch (err) {
      console.error("Error recording late fee:", err);
      alert("Failed to record late fee. Please try again.");
      resetButtons();
    }
  };
  
  lateFeeOverlay.querySelector("#confirmLateFee").onclick = () => saveLateFee(false);
  lateFeeOverlay.querySelector("#confirmLateFeeAndPrint").onclick = () => saveLateFee(true);
}

/**
 * Print late fee receipt
 */
function printLateFeeReceipt(data) {
  const printHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Late Fee Receipt - ${data.receiptNumber}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #222; max-width: 400px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 2px solid #dc2626; padding-bottom: 16px; margin-bottom: 16px; }
        .late-fee-badge { background: #dc2626; color: white; padding: 8px 16px; border-radius: 6px; font-size: 1.4em; font-weight: 800; display: inline-block; margin: 8px 0; }
        .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .amount { font-size: 1.5em; font-weight: 700; color: #dc2626; text-align: center; padding: 16px; background: #fef2f2; border-radius: 8px; margin: 16px 0; }
        .footer { text-align: center; margin-top: 20px; font-size: 0.85em; color: #666; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2 style="margin:0;">Glimbaro Guest House</h2>
        <div class="late-fee-badge">⚠️ LATE FEE ⚠️</div>
        <p style="margin:8px 0 0 0; font-size:0.9em;">Late Checkout Penalty</p>
      </div>
      
      <div class="info-row"><strong>Receipt #:</strong><span>${data.receiptNumber}</span></div>
      <div class="info-row"><strong>Date:</strong><span>${data.date}</span></div>
      <div class="info-row"><strong>Guest:</strong><span>${data.customerName}</span></div>
      <div class="info-row"><strong>Room:</strong><span>${data.room}</span></div>
      <div class="info-row"><strong>Original Checkout:</strong><span>${data.originalCheckout}</span></div>
      <div class="info-row"><strong>Payment Method:</strong><span>${data.method.charAt(0).toUpperCase() + data.method.slice(1)}</span></div>
      ${data.note ? `<div class="info-row"><strong>Note:</strong><span>${data.note}</span></div>` : ''}
      
      <div class="amount">
        Late Fee: $${data.amount.toFixed(2)}
      </div>
      
      <div class="footer">
        <p>Thank you for your payment.</p>
        <p style="font-size:0.8em;">This receipt serves as proof of late fee payment.</p>
      </div>
    </body>
    </html>
  `;
  
  const printWindow = window.open('', '_blank');
  printWindow.document.write(printHTML);
  printWindow.document.close();
  printWindow.print();
}

window.showEditDeletePopup = showEditDeletePopup;

function showReservationHistory(reservation) {
  const customer = customers.find(c => c.id === reservation.customerId) || {};
  const history = reservation.history || [];
  
  // Create modal overlay
  const historyOverlay = document.createElement("div");
  historyOverlay.className = 'modal reservation-popup-modal';
  historyOverlay.style.display = 'block';
  historyOverlay.style.zIndex = '3001';
  historyOverlay.setAttribute('role', 'dialog');
  historyOverlay.setAttribute('aria-modal', 'true');
  historyOverlay.setAttribute('aria-label', 'Reservation history');
  
  // Build history timeline HTML
  let timelineHTML = '';
  
  if (history.length === 0) {
    timelineHTML = `
      <div style="text-align:center; padding:40px; color:#999;">
        <span class="material-icons" style="font-size:48px; opacity:0.5;">history</span>
        <p>No history available for this reservation.</p>
        <p style="font-size:0.9em;">This may be an older reservation created before history tracking.</p>
      </div>
    `;
  } else {
    history.forEach((entry, index) => {
      const entryDate = entry.date ? formatDateTimeDMY(entry.date) : 'Unknown date';
      const byName = entry.byName || 'Unknown';
      
      if (entry.type === 'created') {
        const nights = entry.nights || calculateSpecialNights(entry.arrivalDate, entry.departureDate);
        timelineHTML += `
          <div style="position:relative; padding-left:40px; padding-bottom:30px; border-left:3px solid #3b82f6;">
            <div style="position:absolute; left:-12px; top:0; width:20px; height:20px; border-radius:50%; background:#3b82f6; border:3px solid #fff;"></div>
            <div style="background:#3b82f6; color:#fff; padding:15px; border-radius:8px;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-icons">add_circle</span>
                <strong style="font-size:1.1em;">Reservation Created</strong>
              </div>
              <div style="font-size:0.95em; opacity:0.95; margin-bottom:8px;">
                <strong>${formatDateDMY(entry.arrivalDate)}</strong> to <strong>${formatDateDMY(entry.departureDate)}</strong>
                <span style="margin-left:8px; padding:2px 8px; background:rgba(255,255,255,0.2); border-radius:4px;">${nights} night${nights !== 1 ? 's' : ''}</span>
              </div>
              <div style="font-size:0.9em; opacity:0.85;">
                Rate: $${parseFloat(entry.rate || 0).toFixed(2)}/night
              </div>
              <div style="font-size:0.85em; opacity:0.75; margin-top:8px; border-top:1px solid rgba(255,255,255,0.2); padding-top:8px;">
                \ud83d\udc64 ${byName} • \ud83d\udcc5 ${entryDate}
              </div>
            </div>
          </div>
        `;
      } else if (entry.type === 'extended') {
        const extendedNights = entry.totalNights || calculateSpecialNights(reservation.arrivalDate, entry.newDeparture);
        const originalNights = calculateSpecialNights(reservation.arrivalDate, entry.previousDeparture);
        const additionalNights = extendedNights - originalNights;
        
        timelineHTML += `
          <div style="position:relative; padding-left:40px; padding-bottom:30px; border-left:3px solid #10b981;">
            <div style="position:absolute; left:-12px; top:0; width:20px; height:20px; border-radius:50%; background:#10b981; border:3px solid #fff;"></div>
            <div style="background:#10b981; color:#fff; padding:15px; border-radius:8px;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-icons">event_available</span>
                <strong style="font-size:1.1em;">Extended</strong>
              </div>
              <div style="font-size:0.95em; opacity:0.95; margin-bottom:8px;">
                From <strong>${formatDateDMY(entry.previousDeparture)}</strong> \u2192 <strong>${formatDateDMY(entry.newDeparture)}</strong>
                <span style="margin-left:8px; padding:2px 8px; background:rgba(255,255,255,0.2); border-radius:4px;">+${additionalNights} night${additionalNights !== 1 ? 's' : ''}</span>
                <span style="margin-left:4px; padding:2px 8px; background:rgba(255,255,255,0.15); border-radius:4px;">Total: ${extendedNights} nights</span>
              </div>
              <div style="font-size:0.9em; opacity:0.85;">
                Rate: $${parseFloat(entry.rate || 0).toFixed(2)}/night (applies to entire reservation)
                ${entry.paymentAmount ? ` • Payment: $${parseFloat(entry.paymentAmount).toFixed(2)}` : ''}
                ${entry.receiptNumber ? ` • Receipt #${entry.receiptNumber}` : ''}
              </div>
              <div style="font-size:0.85em; opacity:0.75; margin-top:8px; border-top:1px solid rgba(255,255,255,0.2); padding-top:8px;">
                \ud83d\udc64 ${byName} • \ud83d\udcc5 ${entryDate}
              </div>
            </div>
          </div>
        `;
      } else if (entry.type === 'modified') {
        // ─────────────────────────────────────────────────────────────────────────
        // MODIFIED ENTRY: Shows when reservation details (rate, dates, etc.) changed
        // ─────────────────────────────────────────────────────────────────────────
        timelineHTML += `
          <div style="position:relative; padding-left:40px; padding-bottom:30px; border-left:3px solid #f59e0b;">
            <div style="position:absolute; left:-12px; top:0; width:20px; height:20px; border-radius:50%; background:#f59e0b; border:3px solid #fff;"></div>
            <div style="background:#f59e0b; color:#fff; padding:15px; border-radius:8px;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-icons">edit</span>
                <strong style="font-size:1.1em;">Modified</strong>
              </div>
              <div style="font-size:0.95em; opacity:0.95; margin-bottom:8px; background:rgba(0,0,0,0.1); padding:8px; border-radius:6px;">
                ${entry.changes || 'Details updated'}
              </div>
              ${entry.rate ? `<div style="font-size:0.9em; opacity:0.85;">Current Rate: $${parseFloat(entry.rate).toFixed(2)}/night</div>` : ''}
              <div style="font-size:0.85em; opacity:0.75; margin-top:8px; border-top:1px solid rgba(255,255,255,0.2); padding-top:8px;">
                \ud83d\udc64 ${byName} • \ud83d\udcc5 ${entryDate}
              </div>
            </div>
          </div>
        `;
      } else if (entry.type === 'late_fee') {
        // ─────────────────────────────────────────────────────────────────────────
        // LATE FEE ENTRY: Shows when a late checkout fee was charged
        // ─────────────────────────────────────────────────────────────────────────
        timelineHTML += `
          <div style="position:relative; padding-left:40px; padding-bottom:30px; border-left:3px solid #dc2626;">
            <div style="position:absolute; left:-12px; top:0; width:20px; height:20px; border-radius:50%; background:#dc2626; border:3px solid #fff;"></div>
            <div style="background:#dc2626; color:#fff; padding:15px; border-radius:8px;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                <span class="material-icons">schedule</span>
                <strong style="font-size:1.2em;">⚠️ LATE FEE ⚠️</strong>
              </div>
              <div style="font-size:1.1em; font-weight:600; margin-bottom:8px; background:rgba(0,0,0,0.2); padding:8px 12px; border-radius:6px;">
                Amount: $${parseFloat(entry.amount || 0).toFixed(2)}
              </div>
              <div style="font-size:0.9em; opacity:0.95;">
                Receipt #${entry.receiptNumber || 'N/A'}
                ${entry.method ? ` • ${entry.method.charAt(0).toUpperCase() + entry.method.slice(1)}` : ''}
              </div>
              ${entry.note ? `<div style="font-size:0.85em; opacity:0.85; margin-top:6px; font-style:italic;">"${entry.note}"</div>` : ''}
              <div style="font-size:0.85em; opacity:0.75; margin-top:8px; border-top:1px solid rgba(255,255,255,0.2); padding-top:8px;">
                \ud83d\udc64 ${byName} • \ud83d\udcc5 ${entryDate}
              </div>
            </div>
          </div>
        `;
      }
    });
  }
  
  historyOverlay.innerHTML = `
    <div class="modal-content modal-scrollable reservation-popup" style="max-width:700px;">
      <button class="close" aria-label="Close dialog" id="closeHistoryPopup">&times;</button>
      
      <div class="reservation-popup-header">
        <span class="material-icons">history</span>
        <h2>Reservation History</h2>
      </div>

      <div class="reservation-info-card" style="margin-bottom:20px;">
        <div style="text-align:center; padding:15px; background:#7c3aed; color:#fff; border-radius:8px;">
          <div style="font-size:1.3em; font-weight:600;">${escapeHTML(customer.name || 'Unknown Guest')}</div>
          <div style="font-size:0.95em; opacity:0.9; margin-top:4px;">Room ${reservation.roomNumber}</div>
          <div style="font-size:0.85em; opacity:0.8; margin-top:8px;">
            Current Stay: ${formatDateDMY(reservation.arrivalDate)} to ${formatDateDMY(reservation.departureDate)}
          </div>
        </div>
      </div>

      <div style="margin-top:20px;">
        <h3 style="margin-bottom:15px; color:#374151; font-size:1.1em;">
          <span class="material-icons" style="vertical-align:middle; font-size:20px;">timeline</span>
          Timeline
        </h3>
        ${timelineHTML}
      </div>

      <div class="modal-footer">
        <button id="closeHistory" class="btn btn-primary">Close</button>
        <button id="backToReservation" class="btn btn-ghost">Back to Reservation</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(historyOverlay);
  
  // Close handlers
  historyOverlay.querySelector("#closeHistoryPopup").onclick = () => historyOverlay.remove();
  historyOverlay.querySelector("#closeHistory").onclick = () => historyOverlay.remove();
  historyOverlay.querySelector("#backToReservation").onclick = () => {
    historyOverlay.remove();
    showEditDeletePopup(reservation);
  };
  historyOverlay.onclick = (e) => { if (e.target === historyOverlay) historyOverlay.remove(); };
}

/**
 * Legacy showRoomHistory - redirects to new room history modal
 * Opens the room selector modal and auto-selects the given room
 */
async function showRoomHistory(roomNumber) {
  openRoomHistoryModal();
  if (roomNumber) {
    loadRoomHistory(roomNumber);
  }
}

window.showRoomHistory = showRoomHistory;

async function showReceiptDetails(receiptNumber) {
  // Find the payment by receipt number (handles multiple formats)
  const allPayments = window._allPaymentsCache || [];
  
  // Normalize the search: remove leading zeros for comparison
  const searchNum = String(receiptNumber).replace(/^0+/, '') || '0';
  const searchPadded = String(receiptNumber).padStart(5, '0');
  
  const payment = allPayments.find(p => {
    if (!p.receiptNumber) return false;
    const pNum = String(p.receiptNumber).replace(/^0+/, '') || '0';
    // Match by normalized number or exact padded match
    return pNum === searchNum || p.receiptNumber === searchPadded || p.receiptNumber === receiptNumber;
  });
  
  if (!payment) {
    alert(`Receipt #${receiptNumber} not found. Make sure payments are loaded.`);
    return;
  }
  
  // Get the reservation and customer
  const reservations = window._reservationsCache || [];
  const reservation = reservations.find(r => r.id === payment.reservationId);
  const customer = customers.find(c => c.id === payment.customerId) || {};
  
  // Calculate reservation totals if reservation exists
  let totalDue = 0;
  let totalPaid = 0;
  let balance = 0;
  
  if (reservation) {
    const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
    const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
    // Include balance adjustments
    const adjustments = reservation.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    totalDue = baseTotal + totalAdjustment;
    // Filter out voided payments
    const resPayments = allPayments.filter(p => p.reservationId === reservation.id && !p.voided);
    const actualPaid = resPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    totalPaid = actualPaid + calcCreditTotal(reservation.balanceCredits);
    balance = Math.max(0, totalDue - totalPaid);
  }
  
  // Format date/time
  const paymentDate = payment.timestamp ? formatDateDMY(payment.timestamp) : 'N/A';
  const paymentTime = payment.timestamp ? new Date(payment.timestamp).toLocaleTimeString() : 'N/A';
  const paymentMethod = payment.method ? payment.method.charAt(0).toUpperCase() + payment.method.slice(1) : 'N/A';
  
  // Create popup
  const popup = document.createElement("div");
  popup.setAttribute('data-popup-type', 'receipt-details');
  popup.style.position = "fixed";
  popup.style.left = "50%";
  popup.style.top = "50%";
  popup.style.transform = "translate(-50%, -50%)";
  popup.style.background = "var(--bg-card, #fff)";
  popup.style.color = "var(--text-primary, #222)";
  popup.style.padding = "28px";
  popup.style.border = "1px solid var(--border-medium, #ccc)";
  popup.style.zIndex = "2000";
  popup.style.borderRadius = "12px";
  popup.style.boxShadow = "0 4px 24px rgba(0,0,0,0.15)";
  popup.style.width = "450px";
  popup.style.maxHeight = "80vh";
  popup.style.overflowY = "auto";
  
  popup.innerHTML = `
    <h2 style="margin-top:0;margin-bottom:16px;text-align:center;">🧾 Receipt Details</h2>
    
    <div style="background:var(--bg-tertiary, #f5f5f5);padding:16px;border-radius:8px;margin-bottom:16px;">
      <h3 style="margin:0 0 12px 0;font-size:1.1em;">Receipt #${payment.receiptNumber}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><strong>Date:</strong></div><div>${paymentDate}</div>
        <div><strong>Time:</strong></div><div>${paymentTime}</div>
        <div><strong>Amount:</strong></div><div style="color:#10b981;font-weight:600;">$${parseFloat(payment.amount).toFixed(2)}</div>
        <div><strong>Method:</strong></div><div>${paymentMethod}</div>
        ${payment.note ? `<div><strong>Note:</strong></div><div>${escapeHTML(payment.note)}</div>` : ''}
      </div>
    </div>
    
    <div style="background:var(--bg-tertiary, #f5f5f5);padding:16px;border-radius:8px;margin-bottom:16px;">
      <h3 style="margin:0 0 12px 0;font-size:1.1em;">👤 Customer</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><strong>Name:</strong></div><div>${escapeHTML(customer.name || 'Unknown')}</div>
        <div><strong>Phone:</strong></div><div>${escapeHTML(customer.telephone || 'N/A')}</div>
        <div><strong>Email:</strong></div><div>${escapeHTML(customer.email || 'N/A')}</div>
        <div><strong>Address:</strong></div><div>${escapeHTML(customer.address || 'N/A')}</div>
      </div>
    </div>
    
    ${reservation ? `
    <div style="background:var(--bg-tertiary, #f5f5f5);padding:16px;border-radius:8px;margin-bottom:16px;">
      <h3 style="margin:0 0 12px 0;font-size:1.1em;">🏨 Reservation</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><strong>Room:</strong></div><div>${reservation.roomNumber}</div>
        <div><strong>Check-In:</strong></div><div>${formatDateDMY(reservation.arrivalDate)}</div>
        <div><strong>Check-Out:</strong></div><div>${formatDateDMY(reservation.departureDate)}</div>
        <div><strong>Total Cost:</strong></div><div>$${totalDue.toFixed(2)}</div>
        <div><strong>Total Paid:</strong></div><div style="color:#10b981;">$${totalPaid.toFixed(2)}</div>
        <div><strong>Balance:</strong></div><div style="color:${balance > 0 ? '#ef4444' : '#10b981'};">$${balance.toFixed(2)}</div>
      </div>
    </div>
    ` : '<p style="color:#666;">Reservation details not found.</p>'}
    
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button id="printReceiptBtn" style="background:#10b981;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;">🖨️ Print</button>
      ${reservation ? `<button id="viewReservationBtn" style="background:#3b82f6;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;">View Reservation</button>` : ''}
      <button id="closeReceiptPopup" style="background:#6b7280;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;">Close</button>
    </div>
  `;
  
  document.body.appendChild(popup);
  
  popup.querySelector('#closeReceiptPopup').onclick = () => popup.remove();
  
  popup.querySelector('#printReceiptBtn').onclick = () => {
    const printContent = popup.innerHTML;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head><title>Receipt #${payment.receiptNumber}</title>
      <style>body{font-family:Arial,sans-serif;padding:20px;} button{display:none !important;}</style>
      </head><body>${printContent}</body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };
  
  if (reservation) {
    popup.querySelector('#viewReservationBtn').onclick = () => {
      popup.remove();
      showEditDeletePopup(reservation);
    };
  }
}

window.showReceiptDetails = showReceiptDetails;

const BatchCloseUtils = {
  toLocalDateStr(date) {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  parseTimestamp(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (ts instanceof Date) return ts;
    if (typeof ts === 'string') return new Date(ts);
    return null;
  },

  /**
   * Format date for display (DD Mon YYYY)
   */
  formatDisplayDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return 'Invalid';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  },

  /**
   * Get date range for period
   */
  getDateRange(period, customStart = null, customEnd = null) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    switch (period) {
      case 'today':
        return { start: today, end: todayEnd };
      case 'week': {
        const dayOfWeek = now.getDay();
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek, 0, 0, 0, 0);
        const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6, 23, 59, 59, 999);
        return { start: weekStart, end: weekEnd };
      }
      case 'month': {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        return { start: monthStart, end: monthEnd };
      }
      case 'lastMonth': {
        // Last month: from 1st of previous month to last day of previous month
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        return { start: lastMonthStart, end: lastMonthEnd };
      }
      case 'custom': {
        // Validate both dates are provided and valid
        if (!customStart || !customEnd || customStart.trim() === '' || customEnd.trim() === '') {
          return null;
        }
        const [sy, sm, sd] = customStart.split('-').map(Number);
        const [ey, em, ed] = customEnd.split('-').map(Number);
        // Validate parsed values
        if (isNaN(sy) || isNaN(sm) || isNaN(sd) || isNaN(ey) || isNaN(em) || isNaN(ed)) {
          return null;
        }
        return {
          start: new Date(sy, sm - 1, sd, 0, 0, 0, 0),
          end: new Date(ey, em - 1, ed, 23, 59, 59, 999)
        };
      }
      default:
        return { start: today, end: todayEnd };
    }
  }
};

/**
 * Open batch close modal and configure for user role
 */
document.getElementById('batchCloseBtn')?.addEventListener('click', () => {
  const modal = document.getElementById('batchCloseModal');
  if (!modal) return;

  modal.style.display = 'block';

  const periodSelect = document.getElementById('batchClosePeriod');
  const isStaff = currentEmployee?.role === 'staff';

  if (periodSelect) {
    // Staff can only view today's report
    Array.from(periodSelect.options).forEach(opt => {
      opt.disabled = isStaff && opt.value !== 'today';
    });
    if (isStaff) {
      periodSelect.value = 'today';
      document.getElementById('batchCloseCustomDates').style.display = 'none';
      document.getElementById('batchCloseCustomDatesEnd').style.display = 'none';
    }
  }
});

// Modal close handlers - using ModalManager for consistency
document.getElementById('closeBatchCloseModalBtn')?.addEventListener('click', () => {
  ModalManager.close('batchCloseModal');
});

document.getElementById('closeBatchCloseBtn')?.addEventListener('click', () => {
  ModalManager.close('batchCloseModal');
});

// Toggle custom date fields
document.getElementById('batchClosePeriod')?.addEventListener('change', (e) => {
  const isCustom = e.target.value === 'custom';
  document.getElementById('batchCloseCustomDates').style.display = isCustom ? 'block' : 'none';
  document.getElementById('batchCloseCustomDatesEnd').style.display = isCustom ? 'block' : 'none';
});

/* ═══════════════════════════════════════════════════════════════════════════════════
   BATCH CLOSE HISTORY
   ═══════════════════════════════════════════════════════════════════════════════════
   View and filter previous batch close sessions.
   
   FEATURES:
   - Filter by period (today, week, month, custom range, all time)
   - Filter by staff member who performed the close
   - Click on any session to view detailed breakdown
   - Shows payments, reservations, and totals for each session
   
   ARCHITECTURE:
   - loadBatchCloseHistory()       → Fetches sessions from Firestore
   - populateHistoryStaffFilter()  → Builds staff dropdown options
   - renderBatchCloseHistoryList() → Filters & renders session list
   - showBatchCloseSessionDetails()→ Shows individual session breakdown
   ═══════════════════════════════════════════════════════════════════════════════════ */

/** @type {Array} Cached batch close sessions for filtering */
let _batchCloseHistorySessions = [];

// ─── Modal Close Handlers ─────────────────────────────────────────────────────
document.getElementById('closeBatchCloseHistoryModalBtn')?.addEventListener('click', () => {
  ModalManager.close('batchCloseHistoryModal');
});

document.getElementById('closeBatchCloseHistoryBtn')?.addEventListener('click', () => {
  ModalManager.close('batchCloseHistoryModal');
});

// Back to batch close button - switches modals
document.getElementById('backToBatchCloseBtn')?.addEventListener('click', () => {
  ModalManager.close('batchCloseHistoryModal');
  ModalManager.open('batchCloseModal');
});

// ─── Filter Controls ──────────────────────────────────────────────────────────
document.getElementById('historyFilterPeriod')?.addEventListener('change', (e) => {
  const isCustom = e.target.value === 'custom';
  document.getElementById('historyCustomDates').style.display = isCustom ? 'block' : 'none';
  document.getElementById('historyCustomDatesEnd').style.display = isCustom ? 'block' : 'none';
});

document.getElementById('applyHistoryFiltersBtn')?.addEventListener('click', () => {
  renderBatchCloseHistoryList(_batchCloseHistorySessions);
});

document.getElementById('refreshHistoryBtn')?.addEventListener('click', () => {
  loadBatchCloseHistory();
});

/**
 * Load batch close sessions from Firestore
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches all sessions, sorts by date (newest first), and renders the list.
 * Called when the history modal opens or when refresh button is clicked.
 */
async function loadBatchCloseHistory() {
  const listEl = document.getElementById('batchCloseHistoryList');
  const detailsEl = document.getElementById('batchCloseSessionDetails');
  
  // Show loading state
  listEl.innerHTML = `
    <div style="padding:40px; text-align:center; color:#888;">
      <div style="font-size:2em; margin-bottom:8px;">⏳</div>
      <div>Loading sessions...</div>
    </div>`;
  detailsEl.innerHTML = '';

  try {
    const snapshot = await getDocs(collection(db, APP_CONFIG.COLLECTIONS.BATCH_CLOSE_SESSIONS));
    _batchCloseHistorySessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    _batchCloseHistorySessions.sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt));
    
    // Populate staff filter dropdown
    populateHistoryStaffFilter(_batchCloseHistorySessions);
    
    // Render the list
    renderBatchCloseHistoryList(_batchCloseHistorySessions);
  } catch (err) {
    console.error('Failed to load batch close sessions:', err);
    listEl.innerHTML = '<div style="padding:40px; text-align:center; color:#ef4444;"><div style="font-size:2em; margin-bottom:8px;"></div>Failed to load sessions. Please try again.</div>';
  }
}

/**
 * Populate the staff filter dropdown with unique staff names
 */
function populateHistoryStaffFilter(sessions) {
  const staffSelect = document.getElementById('historyFilterStaff');
  if (!staffSelect) return;
  
  const staffNames = new Set();
  sessions.forEach(s => {
    if (s.performedBy?.name) staffNames.add(s.performedBy.name);
  });
  
  staffSelect.innerHTML = '<option value="all">All Staff</option>';
  [...staffNames].sort().forEach(name => {
    staffSelect.innerHTML += `<option value="${name}">${name}</option>`;
  });
}

/**
 * Filter and render batch close history sessions
 */
function renderBatchCloseHistoryList(allSessions) {
  const listEl = document.getElementById('batchCloseHistoryList');
  const detailsEl = document.getElementById('batchCloseSessionDetails');
  detailsEl.innerHTML = '';
  
  // Get filter values
  const periodFilter = document.getElementById('historyFilterPeriod')?.value || 'month';
  const staffFilter = document.getElementById('historyFilterStaff')?.value || 'all';
  const customStart = document.getElementById('historyStartDate')?.value;
  const customEnd = document.getElementById('historyEndDate')?.value;
  
  // Calculate date range for filtering
  const now = new Date();
  let filterStartDate = null;
  let filterEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  
  if (periodFilter === 'today') {
    filterStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (periodFilter === 'week') {
    const dayOfWeek = now.getDay();
    filterStartDate = new Date(now);
    filterStartDate.setDate(now.getDate() - dayOfWeek);
    filterStartDate.setHours(0, 0, 0, 0);
  } else if (periodFilter === 'month') {
    filterStartDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  } else if (periodFilter === 'lastMonth') {
    // Last month filter
    filterStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    filterEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  } else if (periodFilter === 'custom' && customStart && customEnd) {
    filterStartDate = new Date(customStart + 'T00:00:00');
    filterEndDate = new Date(customEnd + 'T23:59:59');
  }
  // 'all' = no date filtering
  
  // Apply filters
  let filteredSessions = allSessions.filter(s => {
    // Staff filter
    if (staffFilter !== 'all' && s.performedBy?.name !== staffFilter) return false;
    
    // Date filter
    if (filterStartDate && periodFilter !== 'all') {
      const sessionDate = new Date(s.performedAt);
      if (sessionDate < filterStartDate || sessionDate > filterEndDate) return false;
    }
    
    return true;
  });
  
  // Handle empty state
  if (filteredSessions.length === 0) {
    listEl.innerHTML = `
      <div style="padding:40px; text-align:center; color:#888;">
        <div style="font-size:3em; margin-bottom:12px;">📭</div>
        <p style="margin:0 0 8px 0; font-weight:600;">No sessions found</p>
        <p style="margin:0; font-size:0.9em;">Try adjusting your filters or generate a new batch close report.</p>
      </div>
    `;
    return;
  }
  
  // Calculate summary stats
  const totalCollectedAll = filteredSessions.reduce((sum, s) => {
    return sum + (s.payments?.reduce((pSum, p) => pSum + parseFloat(p.amount || 0), 0) || 0);
  }, 0);
  const totalReceipts = filteredSessions.reduce((sum, s) => sum + (s.paymentIds?.length || 0), 0);
  
  // Build the sessions list
  listEl.innerHTML = `
    <div style="background:#e0f2fe; border-radius:8px; padding:16px; margin-bottom:20px;">
      <div style="display:flex; justify-content:space-around; flex-wrap:wrap; gap:16px;">
        <div style="text-align:center;">
          <div style="font-size:1.8em; font-weight:700; color:#0284c7;">${filteredSessions.length}</div>
          <div style="font-size:0.85em; color:#666;">Sessions</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:1.8em; font-weight:700; color:#10b981;">${totalReceipts}</div>
          <div style="font-size:0.85em; color:#666;">Total Receipts</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:1.8em; font-weight:700; color:#10b981;">$${totalCollectedAll.toFixed(2)}</div>
          <div style="font-size:0.85em; color:#666;">Total Collected</div>
        </div>
      </div>
    </div>
    
    <div style="font-size:0.9em; color:#666; margin-bottom:12px;">Showing ${filteredSessions.length} session${filteredSessions.length !== 1 ? 's' : ''}</div>
    
    ${filteredSessions.map((s, i) => {
      const date = new Date(s.performedAt);
      const dateStr = formatDateDMY(date) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const periodLabel = s.period === 'today' ? 'Today' : 
                          s.period === 'week' ? 'Week' : 
                          s.period === 'month' ? 'Month' : 'Custom';
      const sessionTotal = s.payments?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
      
      return `
        <div class="batch-session-row" 
             style="padding:16px; border:1px solid #e2e8f0; border-radius:10px; margin-bottom:10px; cursor:pointer; transition:all 0.2s; background:#fff;"
             data-session-idx="${i}"
             onmouseover="this.style.background='#f8fafc'; this.style.borderColor='#0284c7'; this.style.transform='translateX(4px)';" 
             onmouseout="this.style.background='#fff'; this.style.borderColor='#e2e8f0'; this.style.transform='translateX(0)';">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="font-weight:600; font-size:1.05em; color:#1e293b;">Session #${allSessions.length - allSessions.indexOf(s)}</div>
              <div style="color:#64748b; font-size:0.9em; margin-top:4px;">📅 ${dateStr}</div>
            </div>
            <div style="text-align:right;">
              <span style="background:#e0f2fe; color:#0284c7; padding:4px 10px; border-radius:6px; font-size:0.8em; font-weight:500;">${periodLabel}</span>
              <div style="color:#10b981; font-weight:600; font-size:1.1em; margin-top:6px;">$${sessionTotal.toFixed(2)}</div>
            </div>
          </div>
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid #f1f5f9; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:0.85em; color:#64748b;">
            <span>👤 ${s.performedBy?.name || 'Unknown'}</span>
            <span>📝 ${s.paymentIds?.length || 0} receipts</span>
            <span>🏨 ${s.reservationIds?.length || 0} reservations</span>
          </div>
        </div>
      `;
    }).join('')}
  `;

  // Add click handlers to show session details
  listEl.querySelectorAll('.batch-session-row').forEach(row => {
    row.onclick = () => {
      const idx = parseInt(row.getAttribute('data-session-idx'));
      const session = filteredSessions[idx];
      if (!session) return;
      showBatchCloseSessionDetails(session, allSessions.length - allSessions.indexOf(session));
    };
  });
}

/**
 * Show detailed view for a single batch close session
 */
function showBatchCloseSessionDetails(session, sessionNumber) {
  const detailsEl = document.getElementById('batchCloseSessionDetails');
  const totalCollected = session.payments?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
  
  // Store session for printing
  window._selectedHistorySession = session;
  window._selectedHistorySessionNumber = sessionNumber;
  
  detailsEl.innerHTML = `
    <div style="background:#f8fafc; border:2px solid #0284c7; border-radius:12px; padding:24px; margin-top:20px; animation:slideIn 0.3s ease;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid #e2e8f0;">
        <h4 style="margin:0; color:#1e293b; font-size:1.2em;">📊 Session #${sessionNumber} Details</h4>
        <div style="display:flex; gap:8px;">
          <button onclick="printHistorySession()" 
                  style="background:#0284c7; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:0.9em;">
            🖨️ Print Session
          </button>
          <button onclick="document.getElementById('batchCloseSessionDetails').innerHTML=''" 
                  style="background:#f1f5f9; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:0.9em;">
            ✕ Close Details
          </button>
        </div>
      </div>
      
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:20px;">
        <div style="background:#fff; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:0.8em; color:#64748b; margin-bottom:4px;">Performed By</div>
          <div style="font-weight:600;">${session.performedBy?.name || 'Unknown'}</div>
          <div style="font-size:0.85em; color:#64748b;">${session.performedBy?.role || 'staff'}</div>
        </div>
        <div style="background:#fff; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:0.8em; color:#64748b; margin-bottom:4px;">Date & Time</div>
          <div style="font-weight:600;">${formatDateDMY(new Date(session.performedAt))}</div>
          <div style="font-size:0.85em; color:#64748b;">${new Date(session.performedAt).toLocaleTimeString()}</div>
        </div>
        <div style="background:#fff; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
          <div style="font-size:0.8em; color:#64748b; margin-bottom:4px;">Report Period</div>
          <div style="font-weight:600;">${session.period?.charAt(0).toUpperCase() + session.period?.slice(1) || 'N/A'}</div>
          <div style="font-size:0.85em; color:#64748b;">${session.startDate?.slice(0,10)} → ${session.endDate?.slice(0,10)}</div>
        </div>
        <div style="background:#dcfce7; padding:12px; border-radius:8px; border:1px solid #86efac;">
          <div style="font-size:0.8em; color:#166534; margin-bottom:4px;">Total Collected</div>
          <div style="font-weight:700; font-size:1.3em; color:#16a34a;">$${totalCollected.toFixed(2)}</div>
          <div style="font-size:0.85em; color:#166534;">${session.paymentIds?.length || 0} receipts</div>
        </div>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div>
          <h5 style="margin:0 0 12px 0; color:#1e293b;">💵 Payments (${session.payments?.length || 0})</h5>
          <div style="max-height:250px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; background:#fff;">
            ${(session.payments?.length > 0) ? session.payments.map(p => `
              <div style="padding:10px 12px; border-bottom:1px solid #f1f5f9;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-weight:600; color:#0284c7;">#${p.receiptNumber || 'N/A'}</span>
                  <span style="color:#10b981; font-weight:600;">$${parseFloat(p.amount || 0).toFixed(2)}</span>
                </div>
                <div style="font-size:0.85em; color:#64748b; margin-top:4px;">
                  ${(p.method || 'cash').charAt(0).toUpperCase() + (p.method || 'cash').slice(1)} • By ${p.recordedByName || p.recordedBy || 'Unknown'}
                </div>
              </div>
            `).join('') : '<div style="padding:20px; text-align:center; color:#888;">No payments</div>'}
          </div>
        </div>
        
        <div>
          <h5 style="margin:0 0 12px 0; color:#1e293b;">🏨 Reservations (${session.reservations?.length || 0})</h5>
          <div style="max-height:250px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px; background:#fff;">
            ${(session.reservations?.length > 0) ? session.reservations.map(r => `
              <div style="padding:10px 12px; border-bottom:1px solid #f1f5f9;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-weight:600;">Room ${r.roomNumber}</span>
                  <span style="padding:3px 8px; border-radius:4px; font-size:0.8em; 
                        background:${r.checkedOut ? '#e5e7eb' : r.checkedIn ? '#dcfce7' : '#fef3c7'}; 
                        color:${r.checkedOut ? '#374151' : r.checkedIn ? '#166534' : '#92400e'};">
                    ${r.checkedOut ? 'Checked Out' : r.checkedIn ? 'Checked In' : 'Pending'}
                  </span>
                </div>
                <div style="font-size:0.85em; color:#64748b; margin-top:4px;">
                  ${r.arrivalDate} → ${r.departureDate} • $${r.rate || 0}/night
                </div>
              </div>
            `).join('') : '<div style="padding:20px; text-align:center; color:#888;">No reservations</div>'}
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Scroll to details
  detailsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Print a historical batch close session
 */
function printHistorySession() {
  const session = window._selectedHistorySession;
  const sessionNumber = window._selectedHistorySessionNumber;
  
  if (!session) {
    alert('No session selected.');
    return;
  }
  
  const totalCollected = session.payments?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;
  const performedDate = new Date(session.performedAt);
  
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Batch Close Session #${sessionNumber} - Glimbaro Guest House</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { text-align: center; margin-bottom: 10px; }
        h3 { text-align: center; color: #666; margin-top: 0; margin-bottom: 5px; }
        .generated-info { text-align: center; color: #999; font-size: 12px; margin-bottom: 20px; }
        .summary { display: flex; gap: 20px; justify-content: center; margin-bottom: 30px; flex-wrap: wrap; }
        .summary-card { background: #f5f5f5; padding: 15px 25px; border-radius: 8px; text-align: center; min-width: 150px; }
        .summary-card .value { font-size: 1.5em; font-weight: bold; }
        .summary-card .label { font-size: 0.9em; color: #666; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 20px; }
        th, td { padding: 6px; border: 1px solid #ddd; text-align: left; }
        th { background: #f0f0f0; font-weight: 600; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .section-title { margin-top: 30px; margin-bottom: 10px; font-weight: 600; color: #333; }
        @media print { 
          body { padding: 10px; } 
        }
      </style>
    </head>
    <body>
      <h1>📊 Batch Close Session #${sessionNumber}</h1>
      <h3>Glimbaro Guest House</h3>
      <div class="generated-info">
        Performed by: ${session.performedBy?.name || 'Unknown'} | 
        Date: ${formatDateTimeDMY(performedDate)} |
        Period: ${session.period?.charAt(0).toUpperCase() + session.period?.slice(1) || 'N/A'} (${session.startDate?.slice(0,10)} → ${session.endDate?.slice(0,10)})
      </div>
      
      <div class="summary">
        <div class="summary-card"><div class="value">${session.reservations?.length || 0}</div><div class="label">Reservations</div></div>
        <div class="summary-card"><div class="value">${session.payments?.length || 0}</div><div class="label">Receipts</div></div>
        <div class="summary-card"><div class="value">$${totalCollected.toFixed(2)}</div><div class="label">Total Collected</div></div>
      </div>
      
      <div class="section-title">Payments</div>
      <table>
        <thead>
          <tr>
            <th>Receipt #</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Recorded By</th>
          </tr>
        </thead>
        <tbody>
          ${(session.payments?.length > 0) ? session.payments.map(p => `
            <tr>
              <td>#${p.receiptNumber || 'N/A'}</td>
              <td class="text-right">$${parseFloat(p.amount || 0).toFixed(2)}</td>
              <td>${(p.method || 'cash').charAt(0).toUpperCase() + (p.method || 'cash').slice(1)}</td>
              <td>${p.recordedByName || p.recordedBy || 'Unknown'}</td>
            </tr>
          `).join('') : '<tr><td colspan="4" style="text-align:center;">No payments</td></tr>'}
        </tbody>
        <tfoot>
          <tr style="font-weight:bold; background:#f5f5f5;">
            <td>TOTAL</td>
            <td class="text-right">$${totalCollected.toFixed(2)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
      
      <div class="section-title">Reservations</div>
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Check-In</th>
            <th>Check-Out</th>
            <th>Rate</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${(session.reservations?.length > 0) ? session.reservations.map(r => `
            <tr>
              <td>Room ${r.roomNumber}</td>
              <td>${r.arrivalDate}</td>
              <td>${r.departureDate}</td>
              <td>$${r.rate || 0}/night</td>
              <td>${r.checkedOut ? 'Checked Out' : r.checkedIn ? 'Checked In' : 'Pending'}</td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align:center;">No reservations</td></tr>'}
        </tbody>
      </table>
      
      <p style="text-align:center; margin-top:30px; color:#999; font-size:11px; border-top: 1px solid #ddd; padding-top: 15px;">
        Printed: ${formatDateTimeDMY(new Date())} | End of Session Report
      </p>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
}

// Expose globally for onclick handler
window.printHistorySession = printHistorySession;

/**
 * Open Batch Close History Modal
 * ─────────────────────────────────────────────────────────────────────────────
 * Closes the batch close modal and opens history in front.
 * Uses ModalManager for consistent modal handling.
 */
document.getElementById('viewBatchCloseHistoryBtn')?.addEventListener('click', () => {
  // Close batch close modal, open history modal
  ModalManager.close('batchCloseModal');
  ModalManager.open('batchCloseHistoryModal');
  
  // Load sessions from Firestore
  loadBatchCloseHistory();
});

/* ═══════════════════════════════════════════════════════════════════════════════════
   BATCH CLOSE REPORT GENERATION
   ═══════════════════════════════════════════════════════════════════════════════════
   Creates a batch close report for the selected period.
   
   PERMISSIONS:
   ┌─────────────┬───────────────────────────────────────────────────────────────┐
   │ Role        │ Access                                                        │
   ├─────────────┼───────────────────────────────────────────────────────────────┤
   │ Staff       │ Today only - sees all receipts from all staff                │
   │ Manager     │ Any period - full access to all data                         │
   │ Admin       │ Any period - full access to all data                         │
   └─────────────┴───────────────────────────────────────────────────────────────┘
   
   WORKFLOW:
   1. Filters payments by date range
   2. Calculates totals (collected, outstanding)
   3. Displays detailed table with all reservations and payments
   4. Saves a session record to Firestore for history
   ═══════════════════════════════════════════════════════════════════════════════════ */
document.getElementById('generateBatchCloseBtn')?.addEventListener('click', async () => {
  const period = document.getElementById('batchClosePeriod').value;
  const userRole = currentEmployee?.role || 'staff';
  const userId = currentEmployee?.uid;
  const userName = currentEmployee?.name || 'Unknown';
  const isStaff = userRole === 'staff';
  const isAdminOrManager = userRole === 'admin' || userRole === 'manager';

  // Validate staff user ID exists
  if (isStaff && !userId) {
    alert('Error: Could not identify your account. Please log out and log back in.');
    console.error('Staff batch close failed: No user ID', currentEmployee);
    return;
  }

  // Get date range (staff always gets today only)
  let dateRange;
  if (isStaff) {
    dateRange = BatchCloseUtils.getDateRange('today');
  } else {
    const customStart = document.getElementById('batchCloseStartDate')?.value;
    const customEnd = document.getElementById('batchCloseEndDate')?.value;
    dateRange = BatchCloseUtils.getDateRange(period, customStart, customEnd);
    
    if (!dateRange) {
      alert('Please select both start and end dates.');
      return;
    }
  }

  const { start: startDate, end: endDate } = dateRange;
  const startStr = BatchCloseUtils.toLocalDateStr(startDate);
  const endStr = BatchCloseUtils.toLocalDateStr(endDate);

  Logger.debug('📊 Generating Batch Close:', { 
    period, 
    userRole, 
    userId, 
    userName, 
    startStr, 
    endStr 
  });

  // Load data from cache
  let reservations = [...(window._reservationsCache || [])];
  // Filter out voided payments from the start for accurate totals
  let payments = [...(window._allPaymentsCache || [])].filter(p => !p.voided);

  // Load employee names for showing who recorded each payment
  const employeeNames = {};
  try {
    const snapshot = await getDocs(collection(db, 'employees'));
    snapshot.forEach(doc => {
      employeeNames[doc.id] = doc.data().name || 'Unknown';
    });
  } catch (err) {
    console.warn('Could not load employee names:', err);
  }

  // ═══════════════════════════════════════════════════════════════
  // Get payment IDs already included in previous batch close sessions
  // This prevents the same payment from appearing in multiple batch closes
  // ═══════════════════════════════════════════════════════════════
  const previouslyBatchedPaymentIds = new Set();
  try {
    const sessionsSnapshot = await getDocs(collection(db, APP_CONFIG.COLLECTIONS.BATCH_CLOSE_SESSIONS));
    sessionsSnapshot.forEach(doc => {
      const session = doc.data();
      if (session.paymentIds && Array.isArray(session.paymentIds)) {
        session.paymentIds.forEach(id => previouslyBatchedPaymentIds.add(id));
      }
    });
    Logger.debug(`Found ${previouslyBatchedPaymentIds.size} payments in previous batch sessions`);
  } catch (err) {
    console.warn('Could not load previous batch sessions:', err);
  }

  // ═══════════════════════════════════════════════════════════════
  // BATCH CLOSE LOGIC:
  // - Shows ALL payments made in the period (regardless of who recorded them)
  // - Excludes payments already included in a previous batch close session
  // - Anyone (staff, manager, admin) sees the same payments
  // ═══════════════════════════════════════════════════════════════

  // Find payments made in this period (excluding already batched ones)
  const periodPaymentsByResId = new Map();
  let excludedCount = 0;
  payments.forEach(p => {
    // Skip if already included in a previous batch close
    if (previouslyBatchedPaymentIds.has(p.id)) {
      excludedCount++;
      return;
    }
    
    const payDate = BatchCloseUtils.parseTimestamp(p.timestamp);
    if (!payDate) return;
    
    const payDateStr = BatchCloseUtils.toLocalDateStr(payDate);
    if (payDateStr >= startStr && payDateStr <= endStr) {
      if (p.reservationId) {
        if (!periodPaymentsByResId.has(p.reservationId)) {
          periodPaymentsByResId.set(p.reservationId, []);
        }
        periodPaymentsByResId.get(p.reservationId).push(p);
      }
    }
  });

  // Filter reservations with activity in period
  const periodReservations = reservations.filter(r => {
    // Check if created in period
    if (r.createdAt) {
      const createdDate = BatchCloseUtils.parseTimestamp(r.createdAt);
      if (createdDate) {
        const createdStr = BatchCloseUtils.toLocalDateStr(createdDate);
        if (createdStr >= startStr && createdStr <= endStr) {
          return true;
        }
      }
    }
    
    // Check if has payment in period
    if (periodPaymentsByResId.has(r.id)) {
      return true;
    }

    // For non-today periods, also include date range overlap
    if (period !== 'today') {
      return r.arrivalDate <= endStr && r.departureDate >= startStr;
    }

    return false;
  });

  // Calculate period payments - ONLY from reservations that made it into periodReservations
  // This ensures staff batch close totals match the displayed reservations
  const periodReservationIds = new Set(periodReservations.map(r => r.id));
  const periodPayments = [];
  periodPaymentsByResId.forEach((paymentList, resId) => {
    if (periodReservationIds.has(resId)) {
      periodPayments.push(...paymentList);
    }
  });

  // Calculate totals
  const totalCollected = periodPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  let totalOutstanding = 0;
  let checkedInCount = 0;
  let checkedOutCount = 0;
  let pendingCount = 0;

  // Get ALL payments (unfiltered) for accurate balance calculation
  const allPaymentsForBalance = [...(window._allPaymentsCache || [])].filter(p => !p.voided);

  periodReservations.forEach(res => {
    const nights = calculateSpecialNights(res.arrivalDate, res.departureDate);
    const baseTotal = (parseFloat(res.rate) || 0) * nights;
    // Include balance adjustments
    const adjustments = res.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    const totalDue = baseTotal + totalAdjustment;
    // Use ALL payments for accurate balance (not filtered by staff)
    const resPayments = allPaymentsForBalance.filter(p => p.reservationId === res.id);
    const actualPaid = resPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const totalPaid = actualPaid + calcCreditTotal(res.balanceCredits);
    totalOutstanding += Math.max(0, totalDue - totalPaid);

    if (res.checkedOut) checkedOutCount++;
    else if (res.checkedIn) checkedInCount++;
    else pendingCount++;
  });

  Logger.debug('📊 Report Results:', {
    periodReservations: periodReservations.length,
    periodPayments: periodPayments.length,
    excludedFromPreviousBatches: excludedCount,
    totalCollected,
    totalOutstanding
  });

  // Build summary HTML
  const summaryContainer = document.getElementById('batchCloseSummary');
  
  // Info banner - show for all users
  const infoBanner = excludedCount > 0 ? `
    <div style="margin-bottom:12px; padding:12px 16px; background:#e0f2fe; border-radius:8px; color:#0369a1; border-left:4px solid #0284c7;">
      <strong>ℹ️ Batch Close Report</strong><br>
      <span style="font-size:0.9em;">Showing ${periodPayments.length} NEW payment(s) not yet batched</span><br>
      <span style="font-size:0.85em; opacity:0.8;">${excludedCount} payment(s) excluded (already in previous batch sessions)</span>
    </div>
  ` : `
    <div style="margin-bottom:12px; padding:12px 16px; background:#dcfce7; border-radius:8px; color:#166534; border-left:4px solid #22c55e;">
      <strong>📊 Batch Close Report</strong><br>
      <span style="font-size:0.9em;">Showing all ${periodPayments.length} payment(s) for this period</span>
    </div>
  `;

  summaryContainer.innerHTML = `
    ${infoBanner}
    <div style="background:#3b82f6; color:white; padding:20px; border-radius:8px; text-align:center;">
      <div style="font-size:2em; font-weight:700;">${periodReservations.length}</div>
      <div style="font-size:0.9em; opacity:0.9;">Reservations</div>
    </div>
    <div style="background:#10b981; color:white; padding:20px; border-radius:8px; text-align:center;">
      <div style="font-size:2em; font-weight:700;">$${totalCollected.toFixed(2)}</div>
      <div style="font-size:0.9em; opacity:0.9;">Collected</div>
    </div>
    <div style="background:#ef4444; color:white; padding:20px; border-radius:8px; text-align:center;">
      <div style="font-size:2em; font-weight:700;">$${totalOutstanding.toFixed(2)}</div>
      <div style="font-size:0.9em; opacity:0.9;">Outstanding</div>
    </div>
    <div style="background:#7c3aed; color:white; padding:20px; border-radius:8px; text-align:center;">
      <div style="font-size:1.4em; font-weight:700;">${checkedInCount} / ${checkedOutCount} / ${pendingCount}</div>
      <div style="font-size:0.9em; opacity:0.9;">In / Out / Pending</div>
    </div>
  `;

  // Build details table
  const detailsContainer = document.getElementById('batchCloseDetails');

  if (periodPayments.length === 0 && periodReservations.length === 0) {
    detailsContainer.innerHTML = `
      <div style="text-align:center; padding:40px; color:#666;">
        <div style="font-size:3em; margin-bottom:10px;">📭</div>
        <p>No reservations or payments found for this period.</p>
      </div>
    `;
    return;
  }

  // Sort by arrival date
  periodReservations.sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate));

  let tableHtml = `
    <div style="margin-bottom:12px; font-weight:600;">
      📅 Report Period: ${BatchCloseUtils.formatDisplayDate(startDate)} - ${BatchCloseUtils.formatDisplayDate(endDate)}
      <span style="margin-left:20px; font-weight:normal; color:#666;">Generated by: ${userName}</span>
    </div>
    <table style="width:100%; border-collapse:collapse; font-size:13px;">
      <thead>
        <tr style="background:var(--bg-tertiary, #f1f5f9);">
          <th style="padding:10px 8px; text-align:left; border-bottom:2px solid var(--border-medium, #ccc);">Guest</th>
          <th style="padding:10px 8px; text-align:left; border-bottom:2px solid var(--border-medium, #ccc);">Phone</th>
          <th style="padding:10px 8px; text-align:center; border-bottom:2px solid var(--border-medium, #ccc);">Room</th>
          <th style="padding:10px 8px; text-align:left; border-bottom:2px solid var(--border-medium, #ccc);">Dates</th>
          <th style="padding:10px 8px; text-align:center; border-bottom:2px solid var(--border-medium, #ccc);">Nights</th>
          <th style="padding:10px 8px; text-align:center; border-bottom:2px solid var(--border-medium, #ccc);">Status</th>
          <th style="padding:10px 8px; text-align:right; border-bottom:2px solid var(--border-medium, #ccc);">Cost</th>
          <th style="padding:10px 8px; text-align:right; border-bottom:2px solid var(--border-medium, #ccc);">Paid (This Batch)</th>
          <th style="padding:10px 8px; text-align:right; border-bottom:2px solid var(--border-medium, #ccc);">Balance</th>
          <th style="padding:10px 8px; text-align:left; border-bottom:2px solid var(--border-medium, #ccc);">Payment Details (Recorded By)</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const res of periodReservations) {
    const customer = customers.find(c => c.id === res.customerId) || {};
    const nights = calculateSpecialNights(res.arrivalDate, res.departureDate);
    const baseTotal = (parseFloat(res.rate) || 0) * nights;
    // Include balance adjustments
    const adjustments = res.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    const totalDue = baseTotal + totalAdjustment;
    // All payments (excluding voided) for balance calculation - use unfiltered cache
    const allPaymentsForBalance = [...(window._allPaymentsCache || [])].filter(p => !p.voided);
    const allResPayments = allPaymentsForBalance.filter(p => p.reservationId === res.id);
    const totalPaidAllTime = allResPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) + calcCreditTotal(res.balanceCredits);
    const balance = Math.max(0, totalDue - totalPaidAllTime);
    
    // Period payments only - what was paid during this report period
    const periodResPayments = periodPaymentsByResId.get(res.id) || [];
    const paidInPeriod = periodResPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

    // Build payment details for period payments
    let paymentDetailsHtml = '';
    if (periodResPayments.length > 0) {
      paymentDetailsHtml = periodResPayments.map(p => {
        const paymentDate = BatchCloseUtils.parseTimestamp(p.timestamp);
        const dateStr = paymentDate ? BatchCloseUtils.formatDisplayDate(paymentDate) : 'N/A';
        const method = (p.method || 'cash').charAt(0).toUpperCase() + (p.method || 'cash').slice(1);
        // Get recorder name - prefer recordedByName, fallback to lookup, then UID
        let recorderName = '';
        if (p.recordedByName && p.recordedByName !== 'Unknown') {
          recorderName = p.recordedByName;
        } else if (p.recordedBy && employeeNames[p.recordedBy]) {
          recorderName = employeeNames[p.recordedBy];
        } else if (p.recordedBy) {
          recorderName = `(ID: ${p.recordedBy.substring(0, 8)}...)`;
        } else {
          recorderName = '(Legacy)';
        }
        return `<div style="font-size:11px; margin:2px 0; padding:3px 6px; background:rgba(16,185,129,0.1); border-radius:4px;">
          📝 #${p.receiptNumber}: $${parseFloat(p.amount).toFixed(2)} - ${method}<br>
          <span style="color:#666;">└ ${dateStr} by ${recorderName}</span>
        </div>`;
      }).join('');
    } else {
      paymentDetailsHtml = '<span style="color:#999; font-size:11px;">No new payments</span>';
    }

    // Status badge - compute status from live payments cache (never trust stale paymentStatus field)
    const checkStatus = StatusUtils.formatCheckStatus(res);
    const paymentStatusInfo = StatusUtils.formatPaymentStatus(computeLivePaymentStatus(res));
    const statusHtml = `
      <span style="background:${checkStatus.color}; color:white; padding:2px 8px; border-radius:4px; font-size:11px;">${checkStatus.text === 'Checked Out' ? 'Out' : checkStatus.text === 'Checked In' ? 'In' : 'Pending'}</span>
      <span style="display:block; margin-top:3px; font-size:10px; color:${paymentStatusInfo.color}; font-weight:600;">${paymentStatusInfo.text}</span>
    `;

    const rowStyle = balance > 0 ? 'background:rgba(239, 68, 68, 0.05);' : '';

    tableHtml += `
      <tr style="${rowStyle} border-bottom:1px solid var(--border-light, #eee);">
        <td style="padding:10px 8px; font-weight:500;">${escapeHTML(customer.name || 'Unknown')}</td>
        <td style="padding:10px 8px;">${escapeHTML(customer.telephone || '—')}</td>
        <td style="padding:10px 8px; text-align:center; font-weight:600;">${res.roomNumber}</td>
        <td style="padding:10px 8px; font-size:12px;">${formatDateDMY(res.arrivalDate)} → ${formatDateDMY(res.departureDate)}</td>
        <td style="padding:10px 8px; text-align:center; font-weight:500;">${nights}</td>
        <td style="padding:10px 8px; text-align:center;">${statusHtml}</td>
        <td style="padding:10px 8px; text-align:right;">$${totalDue.toFixed(2)}</td>
        <td style="padding:10px 8px; text-align:right; color:#10b981; font-weight:600;">$${paidInPeriod.toFixed(2)}</td>
        <td style="padding:10px 8px; text-align:right; color:${balance > 0 ? '#ef4444' : '#10b981'}; font-weight:600;">$${balance.toFixed(2)}</td>
        <td style="padding:10px 8px;">${paymentDetailsHtml}</td>
      </tr>
    `;
  }

  tableHtml += `
      </tbody>
      <tfoot>
        <tr style="background:var(--bg-tertiary, #f1f5f9); font-weight:700;">
          <td colspan="6" style="padding:12px 8px; text-align:right;">TOTALS:</td>
          <td style="padding:12px 8px; text-align:right;">—</td>
          <td style="padding:12px 8px; text-align:right; color:#10b981;">$${totalCollected.toFixed(2)}</td>
          <td style="padding:12px 8px; text-align:right; color:#ef4444;">$${totalOutstanding.toFixed(2)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  `;

  detailsContainer.innerHTML = tableHtml;

  // Store for printing/export
  window._batchCloseData = {
    startDate,
    endDate,
    periodReservations,
    periodPayments,
    totalReservations: periodReservations.length,
    totalCollected,
    totalOutstanding,
    checkedInCount,
    checkedOutCount,
    pendingCount,
    isStaff,
    isAdminOrManager,
    generatedBy: userName,
    generatedAt: new Date().toISOString()
  };

  // Store session data for saving when printing (not on generate)
  // Session will be saved to Firestore only when user clicks "Print Batch Close"
  window._batchCloseData.sessionData = {
    performedBy: {
      uid: userId || '',
      name: userName || 'Unknown',
      role: userRole || 'staff'
    },
    period: period || 'custom',
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    paymentIds: periodPayments.map(p => p.id),
    payments: periodPayments.map(p => ({
      id: p.id || '',
      amount: p.amount || 0,
      method: p.method || 'unknown',
      timestamp: p.timestamp || null,
      recordedBy: p.recordedBy || null,
      recordedByName: p.recordedByName || 'Unknown',
      reservationId: p.reservationId || null,
      receiptNumber: p.receiptNumber || ''
    })),
    reservationIds: periodReservations.map(r => r.id),
    reservations: periodReservations.map(r => ({
      id: r.id || '',
      customerId: r.customerId || null,
      roomNumber: r.roomNumber || '',
      arrivalDate: r.arrivalDate || '',
      departureDate: r.departureDate || '',
      rate: r.rate || 0,
      createdBy: r.createdBy || null,
      createdByName: r.createdByName || 'Unknown',
      checkedIn: r.checkedIn || false,
      checkedOut: r.checkedOut || false
    }))
  };
  
  // Note: Session is NOT saved here - it's saved when user clicks "Print Batch Close"
  // This allows users to generate reports multiple times without creating duplicate sessions
});

// Print batch close report AND save session to history
document.getElementById('printBatchCloseBtn')?.addEventListener('click', async () => {
  const detailsContainer = document.getElementById('batchCloseDetails');
  const summaryContainer = document.getElementById('batchCloseSummary');
  if (!detailsContainer || !window._batchCloseData) {
    alert('Please generate a report first.');
    return;
  }

  // Save batch close session to Firestore (only on print)
  if (window._batchCloseData.sessionData) {
    try {
      const sessionToSave = {
        ...window._batchCloseData.sessionData,
        performedAt: new Date().toISOString(),
        printedAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'batch_close_sessions'), sessionToSave);
      // Clear session data so it doesn't get saved again if printed twice
      delete window._batchCloseData.sessionData;
      showToast('Batch close session saved to history', 'success');
    } catch (err) {
      console.error('Failed to save batch close session:', err);
      showToast('Report printed but session could not be saved', 'warning');
    }
  }

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Batch Close Report - Glimbaro Guest House</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { text-align: center; margin-bottom: 10px; }
        h3 { text-align: center; color: #666; margin-top: 0; margin-bottom: 5px; }
        .generated-info { text-align: center; color: #999; font-size: 12px; margin-bottom: 20px; }
        .summary { display: flex; gap: 20px; justify-content: center; margin-bottom: 30px; flex-wrap: wrap; }
        .summary-card { background: #f5f5f5; padding: 15px 25px; border-radius: 8px; text-align: center; min-width: 150px; }
        .summary-card .value { font-size: 1.5em; font-weight: bold; }
        .summary-card .label { font-size: 0.9em; color: #666; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { padding: 6px; border: 1px solid #ddd; text-align: left; }
        th { background: #f0f0f0; font-weight: 600; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .payment-detail { font-size: 10px; color: #666; margin: 2px 0; }
        tfoot td { font-weight: 700; background: #f9f9f9; }
        @media print { 
          body { padding: 10px; } 
          @page { size: landscape; }
        }
      </style>
    </head>
    <body>
      <h1>📊 Batch Close Report</h1>
      <h3>Glimbaro Guest House</h3>
      <div class="generated-info">
        Generated by: ${window._batchCloseData.generatedBy} | 
        Date: ${formatDateTimeDMY(new Date(window._batchCloseData.generatedAt))}
      </div>
      <div class="summary">
        <div class="summary-card"><div class="value">${window._batchCloseData.totalReservations}</div><div class="label">Reservations</div></div>
        <div class="summary-card"><div class="value">$${window._batchCloseData.totalCollected.toFixed(2)}</div><div class="label">Collected</div></div>
        <div class="summary-card"><div class="value">$${window._batchCloseData.totalOutstanding.toFixed(2)}</div><div class="label">Outstanding</div></div>
        <div class="summary-card"><div class="value">${window._batchCloseData.checkedInCount} / ${window._batchCloseData.checkedOutCount} / ${window._batchCloseData.pendingCount}</div><div class="label">In / Out / Pending</div></div>
      </div>
      ${detailsContainer.innerHTML}
      <p style="text-align:center; margin-top:30px; color:#999; font-size:11px; border-top: 1px solid #ddd; padding-top: 15px;">
        End of Report
      </p>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
});

// Download batch close CSV
document.getElementById('downloadBatchCloseCsvBtn')?.addEventListener('click', () => {
  if (!window._batchCloseData) {
    alert('Please generate a report first.');
    return;
  }

  const { periodReservations, startDate, endDate, isAdminOrManager } = window._batchCloseData;
  const allPayments = window._allPaymentsCache || [];

  // Load employee names for CSV
  const employeeNames = {};
  
  // Build CSV header
  let csvHeader = 'Guest Name,Phone,Address,Room,Check-In,Check-Out,Nights,Rate,Total Cost,Total Paid (All Time),Balance,Payment Status,Check Status,Period Payments (Receipt#,Amount,Method,Date,Recorded By)';
  if (isAdminOrManager) {
    csvHeader += ',Reservation Created By';
  }
  csvHeader += '\n';
  
  let csv = csvHeader;

  for (const res of periodReservations) {
    const customer = customers.find(c => c.id === res.customerId) || {};
    const nights = calculateSpecialNights(res.arrivalDate, res.departureDate);
    const baseTotal = (parseFloat(res.rate) || 0) * nights;
    // Include balance adjustments
    const adjustments = res.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    const totalDue = baseTotal + totalAdjustment;
    // Filter out voided payments
    const resPay = allPayments.filter(p => p.reservationId === res.id && !p.voided);
    const totalPaid = resPay.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) + calcCreditTotal(res.balanceCredits);
    const balance = Math.max(0, totalDue - totalPaid);

    // Get period payments with details
    const periodPayments = resPay.filter(p => {
      const payDate = BatchCloseUtils.parseTimestamp(p.timestamp);
      if (!payDate) return false;
      const payDateStr = BatchCloseUtils.toLocalDateStr(payDate);
      const startStr = BatchCloseUtils.toLocalDateStr(startDate);
      const endStr = BatchCloseUtils.toLocalDateStr(endDate);
      return payDateStr >= startStr && payDateStr <= endStr;
    });

    const periodPaymentDetails = periodPayments.map(p => {
      const payDate = BatchCloseUtils.parseTimestamp(p.timestamp);
      const dateStr = payDate ? BatchCloseUtils.formatDisplayDate(payDate) : 'N/A';
      const recorderName = p.recordedByName || '(Legacy)';
      return `#${p.receiptNumber} $${parseFloat(p.amount).toFixed(2)} ${p.method || 'cash'} ${dateStr} by ${recorderName}`;
    }).join('; ') || 'None';

    // Compute status from live payments (never trust stale paymentStatus field)
    const csvLiveStatus = computeLivePaymentStatus(res);
    let payStatus = 'Unpaid';
    if (csvLiveStatus === 'fully_paid') payStatus = 'Fully Paid';
    else if (csvLiveStatus === 'partially_paid') payStatus = 'Partial';

    let checkStatus = 'Pending';
    if (res.checkedOut) checkStatus = 'Checked Out';
    else if (res.checkedIn) checkStatus = 'Checked In';
    
    const creatorName = res.createdByName || '(Legacy)';

    const row = [
      `"${(customer.name || '').replace(/"/g, '""')}"`,
      `"${(customer.telephone || '').replace(/"/g, '""')}"`,
      `"${(customer.address || '').replace(/"/g, '""')}"`,
      res.roomNumber,
      res.arrivalDate,
      res.departureDate,
      nights,
      res.rate || 0,
      totalDue.toFixed(2),
      totalPaid.toFixed(2),
      balance.toFixed(2),
      payStatus,
      checkStatus,
      `"${periodPaymentDetails.replace(/"/g, '""')}"`
    ];
    
    if (isAdminOrManager) {
      row.push(`"${creatorName.replace(/"/g, '""')}"`);
    }

    csv += row.join(',') + '\n';
  }

  // Add summary row
  csv += `\n"SUMMARY",,,,,,,"TOTALS:","—","$${window._batchCloseData.totalCollected.toFixed(2)}","$${window._batchCloseData.totalOutstanding.toFixed(2)}",,\n`;
  csv += `"Total Reservations: ${window._batchCloseData.totalReservations}",,,"In/Out/Pending: ${window._batchCloseData.checkedInCount}/${window._batchCloseData.checkedOutCount}/${window._batchCloseData.pendingCount}"\n`;
  csv += `"Generated By: ${window._batchCloseData.generatedBy}",,,"Date: ${formatDateTimeDMY(new Date(window._batchCloseData.generatedAt))}"\n`;

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `batch-close-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});


// ═══════════════════════════════════════════════════════════════
// AUDIT LOG VIEWER
// ═══════════════════════════════════════════════════════════════

/** Cache for audit log results */
let auditLogCache = [];
let auditLogCurrentPage = 1;
const AUDIT_LOG_PAGE_SIZE = 50;

/** Open audit log modal */
document.getElementById('auditLogBtn')?.addEventListener('click', async () => {
  const modal = document.getElementById('auditLogModal');
  if (modal) {
    modal.style.display = 'block';
    // Set default dates (last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    document.getElementById('auditLogStartDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('auditLogEndDate').value = endDate.toISOString().split('T')[0];
    
    // Populate employee dropdown
    await populateAuditLogEmployeeFilter();
  }
});

/** Populate the employee filter dropdown */
async function populateAuditLogEmployeeFilter() {
  const select = document.getElementById('auditLogEmployee');
  if (!select) return;
  
  try {
    const employeesSnapshot = await getDocs(collection(db, 'employees'));
    const employees = employeesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    select.innerHTML = '<option value="">All Employees</option>';
    employees.forEach(emp => {
      select.innerHTML += `<option value="${emp.id}">${escapeHTML(emp.name)} (${emp.role})</option>`;
    });
  } catch (err) {
    console.error('Error loading employees for filter:', err);
  }
}

/** Close audit log modal */
document.getElementById('closeAuditLogModalBtn')?.addEventListener('click', () => {
  document.getElementById('auditLogModal').style.display = 'none';
});
document.getElementById('closeAuditLogBtn')?.addEventListener('click', () => {
  document.getElementById('auditLogModal').style.display = 'none';
});

/** Search audit logs with enhanced filtering */
async function searchAuditLogs() {
  const actionFilter = document.getElementById('auditLogAction')?.value || '';
  const employeeFilter = document.getElementById('auditLogEmployee')?.value || '';
  const searchText = document.getElementById('auditLogSearch')?.value?.toLowerCase() || '';
  const startDateVal = document.getElementById('auditLogStartDate')?.value;
  const endDateVal = document.getElementById('auditLogEndDate')?.value;

  const tableBody = document.getElementById('auditLogTableBody');
  const statsEl = document.getElementById('auditLogStats');
  tableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading audit logs...</td></tr>';

  try {
    // Build query for Firestore
    const logsSnapshot = await getDocs(collection(db, 'audit_logs'));
    let logs = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Apply filters
    if (actionFilter) {
      logs = logs.filter(log => log.action === actionFilter || log.details?.action === actionFilter);
    }
    if (employeeFilter) {
      logs = logs.filter(log => log.userId === employeeFilter);
    }
    if (searchText) {
      logs = logs.filter(log => {
        const searchFields = [
          log.employeeName,
          log.employeeEmail,
          log.action,
          log.entityId,
          JSON.stringify(log.details)
        ].join(' ').toLowerCase();
        return searchFields.includes(searchText);
      });
    }
    if (startDateVal) {
      const startDate = new Date(startDateVal + 'T00:00:00');
      logs = logs.filter(log => new Date(log.timestamp) >= startDate);
    }
    if (endDateVal) {
      const endDate = new Date(endDateVal + 'T23:59:59');
      logs = logs.filter(log => new Date(log.timestamp) <= endDate);
    }

    // Sort by timestamp descending (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Cache results
    auditLogCache = logs;
    auditLogCurrentPage = 1;
    
    // Show stats
    if (statsEl) {
      const uniqueEmployees = new Set(logs.map(l => l.userId)).size;
      const failedLogins = logs.filter(l => l.action?.includes('FAILED')).length;
      statsEl.innerHTML = `${logs.length} logs | ${uniqueEmployees} employees | ${failedLogins} failed attempts`;
    }

    // Render first page
    renderAuditLogPage();

  } catch (err) {
    console.error('Error fetching audit logs:', err);
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center error-message">Failed to load audit logs</td></tr>';
  }
}

/** Render current page of audit logs */
function renderAuditLogPage() {
  const tableBody = document.getElementById('auditLogTableBody');
  const paginationContainer = document.getElementById('auditLogPagination');

  const startIdx = (auditLogCurrentPage - 1) * AUDIT_LOG_PAGE_SIZE;
  const endIdx = startIdx + AUDIT_LOG_PAGE_SIZE;
  const pageLogs = auditLogCache.slice(startIdx, endIdx);
  const totalPages = Math.ceil(auditLogCache.length / AUDIT_LOG_PAGE_SIZE);

  if (pageLogs.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No audit logs found for the selected criteria</td></tr>';
    paginationContainer.innerHTML = '';
    return;
  }

  // Build table rows
  let html = '';
  for (const log of pageLogs) {
    const timestamp = formatDateTimeDMY(log.timestamp);
    const employeeName = log.employeeName || 'Unknown';
    const employeeRole = log.employeeRole ? `(${log.employeeRole})` : '';
    const action = formatAuditAction(log.action);
    const entity = log.entityType ? `${log.entityType}: ${log.entityId || 'N/A'}` : '—';
    const details = formatAuditDetails(log.details);
    const session = log.sessionId ? log.sessionId.substring(0, 12) + '...' : '—';

    // Color-code by action type
    let actionClass = '';
    let rowClass = '';
    if (log.action?.includes('CREATE') || log.action?.includes('REGISTER')) actionClass = 'color:#10b981;';
    else if (log.action?.includes('DELETE') || log.action?.includes('VOID')) actionClass = 'color:#ef4444;';
    else if (log.action?.includes('UPDATE') || log.action?.includes('EXTEND')) actionClass = 'color:#f59e0b;';
    else if (log.action?.includes('ERROR') || log.action?.includes('FAILED')) {
      actionClass = 'color:#ef4444; font-weight:bold;';
      rowClass = 'background:rgba(239,68,68,0.1);';
    }
    else if (log.action?.includes('LOGIN')) actionClass = 'color:#3b82f6;';

    html += `
      <tr style="${rowClass}">
        <td style="padding:8px; font-size:12px; white-space:nowrap;">${timestamp}</td>
        <td style="padding:8px; font-size:12px;">
          <strong>${escapeHTML(employeeName)}</strong>
          <br><small style="color:var(--text-muted);">${employeeRole}</small>
        </td>
        <td style="padding:8px; ${actionClass}">${action}</td>
        <td style="padding:8px; font-size:12px;">${entity}</td>
        <td style="padding:8px; font-size:11px; max-width:250px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHTML(JSON.stringify(log.details))}">${details}</td>
        <td style="padding:8px; font-size:10px; color:#888;">${session}</td>
      </tr>
    `;
  }
  tableBody.innerHTML = html;

  // Build pagination
  if (totalPages > 1) {
    let pagHtml = `<span style="margin-right:12px;">Page ${auditLogCurrentPage} of ${totalPages} (${auditLogCache.length} logs)</span>`;
    
    if (auditLogCurrentPage > 1) {
      pagHtml += `<button class="btn btn-ghost" onclick="goToAuditLogPage(1)">« First</button>`;
      pagHtml += `<button class="btn btn-ghost" onclick="goToAuditLogPage(${auditLogCurrentPage - 1})">‹ Prev</button>`;
    }
    if (auditLogCurrentPage < totalPages) {
      pagHtml += `<button class="btn btn-ghost" onclick="goToAuditLogPage(${auditLogCurrentPage + 1})">Next ›</button>`;
      pagHtml += `<button class="btn btn-ghost" onclick="goToAuditLogPage(${totalPages})">Last »</button>`;
    }
    
    paginationContainer.innerHTML = pagHtml;
  } else {
    paginationContainer.innerHTML = `<span style="color:#888;">Showing ${auditLogCache.length} log(s)</span>`;
  }
}

/** Navigate to audit log page */
window.goToAuditLogPage = function(page) {
  auditLogCurrentPage = page;
  renderAuditLogPage();
};

/** Format audit action for display */
function formatAuditAction(action) {
  if (!action) return '—';
  // Convert SNAKE_CASE to Title Case
  return action.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
}

/** Format audit details for display */
function formatAuditDetails(details) {
  if (!details || typeof details !== 'object') return '—';
  
  const entries = Object.entries(details);
  if (entries.length === 0) return '—';
  
  // Show key details
  const importantKeys = ['customerName', 'roomNumber', 'amount', 'receiptNumber', 'reason', 'message'];
  const shown = [];
  
  for (const key of importantKeys) {
    if (details[key] !== undefined && details[key] !== null) {
      shown.push(`${key}: ${details[key]}`);
    }
  }
  
  if (shown.length === 0) {
    // Fallback to first few entries
    return entries.slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(', ');
  }
  
  return shown.join(', ');
}

/** Export audit logs to CSV */
document.getElementById('exportAuditLogBtn')?.addEventListener('click', () => {
  if (auditLogCache.length === 0) {
    alert('No audit logs to export. Please search first.');
    return;
  }

  let csv = 'Timestamp,Action,Entity Type,Entity ID,Details,Session ID,User ID,User Agent\n';
  
  for (const log of auditLogCache) {
    const row = [
      `"${log.timestamp || ''}"`,
      `"${log.action || ''}"`,
      `"${log.entityType || ''}"`,
      `"${log.entityId || ''}"`,
      `"${JSON.stringify(log.details || {}).replace(/"/g, '""')}"`,
      `"${log.sessionId || ''}"`,
      `"${log.userId || ''}"`,
      `"${(log.userAgent || '').replace(/"/g, '""')}"`
    ];
    csv += row.join(',') + '\n';
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${getTodayLocal()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/** Attach search handlers */
document.getElementById('searchAuditLogBtn')?.addEventListener('click', searchAuditLogs);
document.getElementById('refreshAuditLogBtn')?.addEventListener('click', searchAuditLogs);


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXTEND RESERVATION MODAL
 * ═══════════════════════════════════════════════════════════════════════════
 * Opens modal to extend a guest's stay with consistent variable naming:
 * - extensionNewDeparture: The new checkout date
 * - extensionRate: Rate per night (applies to entire stay)
 * - extensionAmount: Payment amount for the extension
 * - extensionMethod: Payment method
 * - extensionReceipt: Generated receipt number
 */
async function openExtendReservationModal(reservation) {
  // Close any stray edit popup if present (defensive)
  const currentEditModal = document.querySelector('div[style*="position: fixed"][data-editpopup="true"]');
  if (currentEditModal) currentEditModal.remove();

  // ─────────────────────────────────────────────────────────────────────────
  // FETCH FRESH DATA: Ensure we have latest reservation state
  // ─────────────────────────────────────────────────────────────────────────
  try {
    const freshResDoc = await getDoc(doc(db, "reservations", reservation.id));
    if (freshResDoc.exists()) {
      const freshData = freshResDoc.data();
      Object.assign(reservation, freshData);
    }
  } catch (e) {
    console.warn("Could not fetch fresh reservation data:", e);
  }

  // Grab modal element
  const extendModal = document.getElementById("extendReservationModal");
  if (!extendModal) {
    alert("Extend modal not found.");
    return;
  }

  // Ensure modal is visible and on top
  ModalManager.open('extendReservationModal');
  extendModal.style.zIndex = "2200";

  // ─────────────────────────────────────────────────────────────────────────
  // PREFILL EXTENSION FIELDS - Use consistent naming
  // ─────────────────────────────────────────────────────────────────────────
  const extensionDepartureInput = document.getElementById("extendDeparture");
  const extensionRateInput = document.getElementById("extendPaymentRate");
  const extensionAmountInput = document.getElementById("extendPaymentAmount");
  const extensionMethodSelect = document.getElementById("extendPaymentMethod");
  const extensionReceiptInput = document.getElementById("extendReceiptNumber");

  // Set initial values from current reservation
  extensionDepartureInput.value = reservation.departureDate || "";
  extensionRateInput.value = reservation.rate || "";
  extensionAmountInput.value = "";

  // ─────────────────────────────────────────────────────────────────────────
  // LIVE EXTENSION SUMMARY: Auto-calculate when departure date or rate changes
  // ─────────────────────────────────────────────────────────────────────────
  const summaryBox      = document.getElementById("extendSummaryBox");
  const currentDepEl    = document.getElementById("extendCurrentDep");
  const newDepEl        = document.getElementById("extendNewDep");
  const addNightsEl     = document.getElementById("extendAdditionalNights");
  const expectedCostEl  = document.getElementById("extendExpectedCost");

  // Show current departure in the summary
  if (currentDepEl) currentDepEl.textContent = formatDateDMY(reservation.departureDate);

  const updateExtensionSummary = () => {
    const newDep = extensionDepartureInput.value;
    const rate = parseFloat(extensionRateInput.value) || parseFloat(reservation.rate) || 0;

    if (!reservation.departureDate) {
      if (summaryBox) summaryBox.style.display = "none";
      return;
    }

    // Extension-specific: additional nights and expected extra cost
    let additionalNights = 0;
    let expectedCost = 0;
    if (newDep) {
      const currentDep = normalizeDate(reservation.departureDate);
      const newDepDate = normalizeDate(newDep);
      additionalNights = Math.ceil((newDepDate - currentDep) / (1000 * 60 * 60 * 24));
      if (additionalNights > 0) expectedCost = additionalNights * rate;
    }

    // Always compute balance using the effective end date
    const depForBalance = (additionalNights > 0) ? newDep : reservation.departureDate;
    const extTotalNights = calculateSpecialNights(reservation.arrivalDate, depForBalance);
    const extBaseTotal = rate * extTotalNights;
    const extAdj = calcAdjustmentTotal(reservation.balanceAdjustments);
    const extNewTotal = extBaseTotal + extAdj;
    const extPaid = (window._allPaymentsCache || [])
      .filter(p => p.reservationId === reservation.id && !p.voided)
      .reduce((s, p) => s + parseFloat(p.amount || 0), 0) + calcCreditTotal(reservation.balanceCredits);
    const extBalance = Math.max(0, extNewTotal - extPaid);

    // Always show the summary box so balance is visible on open and on rate change
    if (summaryBox) summaryBox.style.display = "block";
    if (newDepEl)       newDepEl.textContent = additionalNights > 0 ? formatDateDMY(newDep) : '—';
    if (addNightsEl)    addNightsEl.textContent = additionalNights > 0 ? additionalNights : '—';
    if (expectedCostEl) expectedCostEl.textContent = additionalNights > 0 ? `$${expectedCost.toFixed(2)}` : '—';

    // Show or update balance info
    let balanceInfoEl = summaryBox.querySelector('#extendBalanceInfo');
    if (!balanceInfoEl) {
      balanceInfoEl = document.createElement('div');
      balanceInfoEl.id = 'extendBalanceInfo';
      balanceInfoEl.style.cssText = 'grid-column:1/-1; border-top:1px solid var(--border-light, #ddd); padding-top:6px; margin-top:4px; display:grid; grid-template-columns:1fr 1fr; gap:6px;';
      const gridDiv = summaryBox.querySelector('div[style*="grid"]');
      if (gridDiv) gridDiv.appendChild(balanceInfoEl);
    }
    if (balanceInfoEl) {
      balanceInfoEl.innerHTML = `
        <div><span style="color:var(--text-muted);">Total cost:</span> <strong>$${extNewTotal.toFixed(2)}</strong></div>
        <div><span style="color:var(--text-muted);">Total paid:</span> <strong style="color:#10b981;">$${extPaid.toFixed(2)}</strong></div>
        <div style="grid-column:1/-1;"><span style="color:var(--text-muted);">Outstanding balance:</span> <strong style="color:${extBalance > 0 ? '#ef4444' : '#10b981'};">$${extBalance.toFixed(2)}</strong></div>
      `;
    }

    // Auto-fill amount only when there IS an extension and field is empty
    if (!extensionAmountInput.value && additionalNights > 0) {
      extensionAmountInput.value = expectedCost.toFixed(2);
    }
  };

  // Remove stale listeners from previous opens to prevent accumulation
  if (extensionDepartureInput._extSummaryHandler) {
    extensionDepartureInput.removeEventListener("change", extensionDepartureInput._extSummaryHandler);
  }
  if (extensionRateInput._extSummaryHandler) {
    extensionRateInput.removeEventListener("input", extensionRateInput._extSummaryHandler);
  }
  extensionDepartureInput._extSummaryHandler = updateExtensionSummary;
  extensionRateInput._extSummaryHandler = updateExtensionSummary;
  extensionDepartureInput.addEventListener("change", updateExtensionSummary);
  extensionRateInput.addEventListener("input", updateExtensionSummary);

  // Show initial balance summary immediately when modal opens
  updateExtensionSummary();

  // Set min date to day after current departure
  const minDate = new Date(reservation.departureDate);
  minDate.setDate(minDate.getDate() + 1);
  const minStr = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(minDate.getDate()).padStart(2, '0')}`;
  extensionDepartureInput.min = minStr;

  // PREVIEW next receipt number (do not reserve)
  try {
    const extensionPreviewReceipt = await getNextPreviewReceiptNumber();
    extensionReceiptInput.value = extensionPreviewReceipt;
  } catch (err) {
    console.warn("Preview receipt fetch failed", err);
    extensionReceiptInput.value = "";
  }

  // Prevent form submission (Enter key) from reloading the page
  const extendForm = document.getElementById("extendReservationForm");
  if (extendForm) extendForm.onsubmit = (e) => e.preventDefault();

  // ─────────────────────────────────────────────────────────────────────────
  // CLOSE HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  const closeExtendModal = () => {
    ModalManager.close('extendReservationModal');
    // If opened from dashboard, just close – no popup to return to
    if (window._extendFromDashboard) {
      window._extendFromDashboard = false;
      return;
    }
    // Return to edit reservation modal if we came from there
    if (window._lastReservationForPopup) {
      showEditDeletePopup(window._lastReservationForPopup);
      window._lastReservationForPopup = null;
    }
  };

  const closeExtendBtn = document.getElementById("closeExtendReservationBtn");
  const cancelExtendBtn = document.getElementById("cancelExtendReservationBtn");
  if (closeExtendBtn) closeExtendBtn.onclick = closeExtendModal;
  if (cancelExtendBtn) cancelExtendBtn.onclick = closeExtendModal;

  // ─────────────────────────────────────────────────────────────────────────
  // VALIDATE EXTENSION DATA
  // ─────────────────────────────────────────────────────────────────────────
  const validateExtensionData = () => {
    const extensionNewDeparture = extensionDepartureInput.value;
    const extensionRate = parseFloat(extensionRateInput.value) || null;
    const extensionAmount = parseFloat(extensionAmountInput.value);

    // Check new departure date
    if (!extensionNewDeparture) {
      alert("Please select a new departure date.");
      return null;
    }

    // Check departure is after current departure (use normalizeDate to avoid timezone issues)
    if (normalizeDate(extensionNewDeparture) <= normalizeDate(reservation.departureDate)) {
      alert("New departure date must be after the current departure date (" + formatDateDMY(reservation.departureDate) + ").");
      return null;
    }

    // Check payment amount — allow 0 for no-payment extensions
    if (isNaN(extensionAmount) || extensionAmount < 0) {
      alert("Please enter a valid payment amount (0 or more).");
      return null;
    }

    return {
      extensionNewDeparture,
      extensionRate,
      extensionAmount
    };
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIRM EXTENSION (Save Only)
  // ─────────────────────────────────────────────────────────────────────────
  const confirmExtendBtn = document.getElementById("confirmExtendReservationBtn");
  const confirmExtendPrintBtn = document.getElementById("confirmExtendAndPrintBtn");
  
  // Spam prevention helper
  const disableExtensionButtons = () => {
    if (confirmExtendBtn) {
      confirmExtendBtn.disabled = true;
      confirmExtendBtn.innerHTML = '<span class="material-icons" style="font-size:18px; vertical-align:middle;">hourglass_empty</span> Processing...';
    }
    if (confirmExtendPrintBtn) {
      confirmExtendPrintBtn.disabled = true;
      confirmExtendPrintBtn.innerHTML = '<span class="material-icons" style="font-size:18px; vertical-align:middle;">hourglass_empty</span> Processing...';
    }
  };
  
  const enableExtensionButtons = () => {
    if (confirmExtendBtn) {
      confirmExtendBtn.disabled = false;
      confirmExtendBtn.innerHTML = '<span class="material-icons" style="font-size:18px; vertical-align:middle;">save</span> Confirm Extension';
    }
    if (confirmExtendPrintBtn) {
      confirmExtendPrintBtn.disabled = false;
      confirmExtendPrintBtn.innerHTML = '<span class="material-icons" style="font-size:18px; vertical-align:middle;">print</span> Confirm & Print';
    }
  };
  
  if (confirmExtendBtn) {
    confirmExtendBtn.onclick = async () => {
      // Prevent spam clicks
      if (confirmExtendBtn.disabled) {
        console.warn("Extension submission already in progress");
        return;
      }
      
      const extensionData = validateExtensionData();
      if (!extensionData) return;

      const { extensionNewDeparture, extensionRate, extensionAmount } = extensionData;

      // Disable buttons during processing
      disableExtensionButtons();

      // Check for overlapping reservations
      const hasOverlapConflict = await hasOverlap(
        reservation.id, 
        reservation.roomNumber, 
        reservation.arrivalDate, 
        extensionNewDeparture
      );
      
      if (hasOverlapConflict) {
        alert("Cannot extend reservation. Overlap with another booking for Room " + reservation.roomNumber + ".");
        enableExtensionButtons();
        return;
      }

      try {
        const extensionReceipt = await saveExtensionPayment(reservation, {
          newDeparture: extensionNewDeparture,
          rate: extensionRate,
          amount: extensionAmount,
          method: extensionMethodSelect.value || "cash"
        });

        // Re-enable buttons before closing (for if modal opens again)
        enableExtensionButtons();
        
        alert(extensionReceipt 
          ? "Extension saved successfully!\n\nReceipt #" + extensionReceipt
          : "Extension saved successfully!\n\nNo payment recorded — checkout date updated.");
        ModalManager.close('extendReservationModal');

        // If opened from dashboard, prompt to print registration form
        if (window._extendFromDashboard) {
          window._extendFromDashboard = false;
          const wantPrint = confirm("Would you like to print the registration form?");
          if (wantPrint) {
            const cust = customers.find(c => c.id === reservation.customerId);
            if (cust) {
              showFormPreview(reservation, cust, cust.idImageUrl || null);
            } else {
              printReceipt(extensionReceipt);
            }
          }
        } else if (window._lastReservationForPopup) {
          // Return to edit reservation modal with updated data
          window._lastReservationForPopup.departureDate = extensionNewDeparture;
          if (extensionRate) window._lastReservationForPopup.rate = extensionRate;
          showEditDeletePopup(window._lastReservationForPopup);
          window._lastReservationForPopup = null;
        }
      } catch (err) {
        console.error("Failed to save extension:", err);
        alert("Failed to save extension. Please try again.");
        enableExtensionButtons();
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIRM & PRINT EXTENSION
  // ─────────────────────────────────────────────────────────────────────────
  if (confirmExtendPrintBtn) {
    confirmExtendPrintBtn.onclick = async () => {
      // Prevent spam clicks
      if (confirmExtendPrintBtn.disabled) {
        console.warn("Extension submission already in progress");
        return;
      }
      
      const extensionData = validateExtensionData();
      if (!extensionData) return;

      const { extensionNewDeparture, extensionRate, extensionAmount } = extensionData;

      // Disable buttons during processing
      disableExtensionButtons();

      // Check for overlapping reservations
      const hasOverlapConflict = await hasOverlap(
        reservation.id, 
        reservation.roomNumber, 
        reservation.arrivalDate, 
        extensionNewDeparture
      );
      
      if (hasOverlapConflict) {
        alert("Cannot extend reservation. Overlap with another booking for Room " + reservation.roomNumber + ".");
        enableExtensionButtons();
        return;
      }

      try {
        const extensionReceipt = await saveExtensionPayment(reservation, {
          newDeparture: extensionNewDeparture,
          rate: extensionRate,
          amount: extensionAmount,
          method: extensionMethodSelect.value || "cash"
        });

        // Re-enable buttons before closing (for if modal opens again)
        enableExtensionButtons();

        ModalManager.close('extendReservationModal');

        // Update reservation object with new departure/rate for form preview
        reservation.departureDate = extensionNewDeparture;
        if (extensionRate) reservation.rate = extensionRate;

        // Show the full registration form (same as "Print Reservation Form")
        const cust = customers.find(c => c.id === reservation.customerId);
        if (cust) {
          showFormPreview(reservation, cust, cust.idImageUrl || null);
        } else if (extensionReceipt) {
          printReceipt(extensionReceipt);
        } else {
          alert("Extension saved (no payment). Checkout date updated.");
        }

        // If opened from dashboard, clear flag
        if (window._extendFromDashboard) {
          window._extendFromDashboard = false;
        } else if (window._lastReservationForPopup) {
          // Return to edit reservation modal with updated data
          window._lastReservationForPopup.departureDate = extensionNewDeparture;
          if (extensionRate) window._lastReservationForPopup.rate = extensionRate;
          showEditDeletePopup(window._lastReservationForPopup);
          window._lastReservationForPopup = null;
        }
      } catch (err) {
        console.error("Failed to save extension:", err);
        alert("Failed to save extension. Please try again.");
        enableExtensionButtons();
      }
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE EXTENSION PAYMENT
// ═══════════════════════════════════════════════════════════════════════════
// Core logic for saving an extension with payment
// Uses consistent variable naming throughout
async function saveExtensionPayment(reservation, extensionData) {
  const { newDeparture, rate, amount, method } = extensionData;
  
  // CRITICAL: Capture old departure BEFORE any mutation
  const previousDeparture = reservation.departureDate;
  
  // Calculate nights for the extended reservation (from original arrival to new departure)
  const extensionTotalNights = calculateSpecialNights(
    reservation.arrivalDate, 
    newDeparture
  );
  
  // Get current employee info
  const extensionEmployee = getCurrentEmployeeInfo();

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE RESERVATION DATA
  // ─────────────────────────────────────────────────────────────────────────
  const extensionUpdateData = {
    departureDate: newDeparture
  };
  
  // If a new rate is provided, it applies to the ENTIRE reservation
  if (rate !== null && rate > 0) {
    extensionUpdateData.rate = rate;
  }
  
  // Add extension to history
  const extensionHistory = reservation.history || [];
  const extensionHistoryEntry = {
    type: 'extended',
    date: new Date().toISOString(),
    previousDeparture: previousDeparture,
    newDeparture: newDeparture,
    totalNights: extensionTotalNights,
    previousRate: parseFloat(reservation.rate) || 0,
    rate: rate || reservation.rate,
    by: extensionEmployee.uid,
    byName: extensionEmployee.name,
    paymentAmount: amount,
    receiptNumber: null // Will be updated after payment is created
  };
  extensionHistory.push(extensionHistoryEntry);
  extensionUpdateData.history = extensionHistory;

  await updateDoc(doc(db, "reservations", reservation.id), extensionUpdateData);
  
  // ── Update in-memory reservation object so subsequent extends see the new departure ──
  reservation.departureDate = newDeparture;
  if (rate !== null && rate > 0) reservation.rate = rate;
  reservation.history = extensionHistory;

  console.log("✅ Extended reservation to:", newDeparture, "with total nights:", extensionTotalNights);

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE EXTENSION PAYMENT RECORD
  // ─────────────────────────────────────────────────────────────────────────
  let extensionReceiptNumber = null;
  
  if (!isNaN(amount) && amount > 0) {
    extensionReceiptNumber = await getNextReceiptNumber();
    document.getElementById("extendReceiptNumber").value = extensionReceiptNumber;

    const extensionPaymentMethod = method || "cash";
    
    const extensionPaymentRef = await addDoc(collection(db, "payments"), {
      customerId: reservation.customerId,
      reservationId: reservation.id,
      receiptNumber: extensionReceiptNumber,
      amount: amount,
      method: extensionPaymentMethod,
      rate: rate || reservation.rate || null,
      note: `Extension payment - ${reservation.note || ""}`.trim(),
      timestamp: new Date().toISOString(),
      recordedBy: extensionEmployee.uid,
      recordedByName: extensionEmployee.name,
      isExtension: true,
      previousDeparture: previousDeparture,
      newDeparture: newDeparture,
      qbSyncStatus: 'pending'
    });
    
    // Update history entry with receipt number and recalculate paymentStatus
    if (extensionHistory.length > 0) {
      extensionHistory[extensionHistory.length - 1].receiptNumber = extensionReceiptNumber;
      // Recalculate payment status after extension changes the total due
      const extNights = calculateSpecialNights(reservation.arrivalDate, newDeparture);
      const extRate = parseFloat(rate || reservation.rate || 0);
      const extBaseTotal = extRate * extNights;
      const extAdj = calcAdjustmentTotal(reservation.balanceAdjustments);
      const extTotalDue = extBaseTotal + extAdj;
      const extCached = (window._allPaymentsCache || []).filter(p => p.reservationId === reservation.id && !p.voided);
      const extTotalPaid = extCached.reduce((s, p) => s + parseFloat(p.amount || 0), 0) + amount;
      const extStatus = extTotalPaid >= extTotalDue ? 'fully_paid' : 'partially_paid';
      await updateDoc(doc(db, "reservations", reservation.id), { history: extensionHistory, paymentStatus: extStatus });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUSH TO QUICKBOOKS
    // ─────────────────────────────────────────────────────────────────────────
    const extensionCustomer = customers.find(c => c.id === reservation.customerId) || {};
    const extensionPayment = {
      id: extensionPaymentRef.id,
      receiptNumber: extensionReceiptNumber,
      amount: amount,
      method: extensionPaymentMethod,
      timestamp: new Date().toISOString(),
      recordedByName: extensionEmployee.name,
      customerId: reservation.customerId,
      reservationId: reservation.id
    };
    
    const extensionReservationForQB = { 
      ...reservation, 
      departureDate: newDeparture, 
      notes: `Extension - Previous checkout: ${formatDateDMY(previousDeparture)}. ${reservation.note || ""}`.trim()
    };
    
    const extensionQBData = buildQuickBooksPaymentData(
      extensionPayment, 
      extensionReservationForQB, 
      extensionCustomer, 
      currentEmployee
    );
    
    // QB sync in its own try/catch – failure must NOT block extension success
    try {
      await pushToQuickBooks(extensionQBData, extensionPaymentRef.id);
    } catch (qbErr) {
      console.warn("⚠️ Extension saved but QuickBooks sync failed:", qbErr);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AUDIT LOG
    // ─────────────────────────────────────────────────────────────────────────
    await auditLog(AUDIT_ACTIONS.RESERVATION_EXTEND, {
      previousDeparture: previousDeparture,
      newDeparture: newDeparture,
      receiptNumber: extensionReceiptNumber,
      amount: amount,
      roomNumber: reservation.roomNumber,
      customerName: extensionCustomer.name
    }, 'reservation', reservation.id);

    // ── Add extension payment to payments cache so printReceipt finds it immediately ──
    if (window._allPaymentsCache) {
      window._allPaymentsCache.push({
        id: extensionPaymentRef.id,
        customerId: reservation.customerId,
        reservationId: reservation.id,
        receiptNumber: extensionReceiptNumber,
        amount: amount,
        method: method || "cash",
        rate: rate || reservation.rate || null,
        note: `Extension payment - ${reservation.note || ""}`.trim(),
        timestamp: new Date().toISOString(),
        recordedBy: extensionEmployee.uid,
        recordedByName: extensionEmployee.name,
        isExtension: true,
        previousDeparture: previousDeparture,
        newDeparture: newDeparture
      });
      console.log('✅ Added extension payment to _allPaymentsCache:', extensionReceiptNumber);
    }
  } else {
    // $0 extension — no payment record, but still recalculate paymentStatus
    const extNights = calculateSpecialNights(reservation.arrivalDate, newDeparture);
    const extRate = parseFloat(rate || reservation.rate || 0);
    const extBaseTotal = extRate * extNights;
    const extAdj = calcAdjustmentTotal(reservation.balanceAdjustments);
    const extTotalDue = extBaseTotal + extAdj;
    const extCached = (window._allPaymentsCache || []).filter(p => p.reservationId === reservation.id && !p.voided);
    const extTotalPaid = extCached.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const extStatus = extTotalPaid >= extTotalDue ? 'fully_paid' : (extTotalPaid > 0 ? 'partially_paid' : 'unpaid');
    await updateDoc(doc(db, "reservations", reservation.id), { paymentStatus: extStatus });

    // Audit log for $0 extension
    const extensionCustomer = customers.find(c => c.id === reservation.customerId) || {};
    await auditLog(AUDIT_ACTIONS.RESERVATION_EXTEND, {
      previousDeparture, newDeparture,
      amount: 0, roomNumber: reservation.roomNumber,
      customerName: extensionCustomer.name
    }, 'reservation', reservation.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE CACHE AND REFRESH UI
  // ─────────────────────────────────────────────────────────────────────────
  if (window._reservationsCache) {
    const cacheIndex = window._reservationsCache.findIndex(r => r.id === reservation.id);
    if (cacheIndex !== -1) {
      window._reservationsCache[cacheIndex] = { 
        ...window._reservationsCache[cacheIndex], 
        departureDate: newDeparture,
        rate: rate || reservation.rate,
        history: extensionHistory
      };
      console.log('✅ Updated reservation in cache after extension:', reservation.id);
    }
  }

  // Refresh availability grid if visible
  const availModal = document.getElementById("availabilityModal");
  const startDateVal = document.getElementById("startDate")?.value;
  const endDateVal = document.getElementById("endDate")?.value;
  if (startDateVal && endDateVal && availModal && availModal.style.display !== 'none') {
    try { await renderAvailabilityGrid(); } catch (e) { console.error("Availability grid refresh failed:", e); }
  }
  
  try { await fillDashboard(); } catch (e) { console.error("Dashboard refresh failed after extension (data was saved):", e); }

  return extensionReceiptNumber;
}

// ✅ Normalize date helper (fix timezone issues)
function normalizeDate(d) {
  const parts = d.split("-");
  return new Date(parts[0], parts[1] - 1, parts[2]); // yyyy-mm-dd → local midnight
}

// ✅ Helper: Check for overlapping reservations
// HOTEL LOGIC: Same-day turnaround is ALLOWED
// - Guest A checks OUT on Day X at 1 PM
// - Guest B can check IN on Day X at 3 PM
// So: newArrival == existingDeparture is NOT an overlap
async function hasOverlap(reservationId, roomNumber, newArrival, newDeparture) {
  // Use cache if available for faster checks (works offline too)
  let all;
  if (window._reservationsCache && window._reservationsCache.length > 0) {
    all = window._reservationsCache;
  } else {
    const snapshot = await getDocs(collection(db, "reservations"));
    all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  const newArr = normalizeDate(newArrival);
  const newDep = normalizeDate(newDeparture);

  for (let res of all) {
    if (res.id === reservationId) continue; // skip same reservation
    if (res.roomNumber !== roomNumber) continue;

    const resArr = normalizeDate(res.arrivalDate);
    const resDep = normalizeDate(res.departureDate);

    // OVERLAP CHECK (allows same-day turnaround):
    // No overlap if:
    //   newDeparture <= existingArrival (new guest leaves before/on existing arrival)
    //   OR newArrival >= existingDeparture (new guest arrives on/after existing departure)
    // 
    // So OVERLAP exists if: newDep > resArr AND newArr < resDep
    const hasConflict = newDep > resArr && newArr < resDep;
    
    if (hasConflict) {
      console.log(`❌ Overlap detected: New ${newArrival} to ${newDeparture} conflicts with existing ${res.arrivalDate} to ${res.departureDate}`);
      return true;
    }
  }
  console.log(`✅ No overlap found for room ${roomNumber} from ${newArrival} to ${newDeparture}`);
  return false;
}

// Overlap check excluding current reservation, allowing same-day check-in after checkout
// Uses cache for offline compatibility
async function checkOverlapExceptAllowSameDay(currentId, room, arrival, departure) {
  // Use cache if available for faster checks (works offline too)
  let all;
  if (window._reservationsCache && window._reservationsCache.length > 0) {
    all = window._reservationsCache;
  } else {
    const snapshot = await getDocs(collection(db, "reservations"));
    all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  
  const newArr = normalizeDate(arrival);
  const newDep = normalizeDate(departure);
  
  return all.some(res => {
    if (res.id === currentId) return false;
    if (res.roomNumber !== room) return false;
    
    const resArr = normalizeDate(res.arrivalDate);
    const resDep = normalizeDate(res.departureDate);
    
    // Same-day turnaround is allowed: newArr >= resDep is OK
    // Overlap if: newDep > resArr AND newArr < resDep
    return newDep > resArr && newArr < resDep;
  });
}

// Remove unpaid reservation if slot is taken by a paid one
async function replaceUnpaidReservationIfConflict(room, arrival, departure) {
  const snapshot = await getDocs(collection(db, "reservations"));
  const now = new Date();

  const conflicts = snapshot.docs.filter(doc => {
    const data = doc.data();
    const isSameRoom = data.roomNumber === room;
    const isSameDates = data.arrivalDate === arrival && data.departureDate === departure;
    const isUnpaid = data.paymentStatus === "unpaid";
    const notExpired = new Date(data.departureDate) >= now;
    return isSameRoom && isSameDates && isUnpaid && notExpired;
  });

  for (const conflict of conflicts) {
    await deleteDoc(doc(db, "reservations", conflict.id));
    console.log(`Deleted unpaid conflicting reservation: ${conflict.id}`);
  }
}

// CSV Download
document.getElementById("downloadCsvBtn")?.addEventListener("click", () => {
  const table = document.querySelector("#availabilityGrid table");
  if (!table) return;

  let csv = [];
  const rows = table.querySelectorAll("tr");
  for (const row of rows) {
    const cols = row.querySelectorAll("th, td");
    const rowData = Array.from(cols).map(col => `"${col.textContent.trim()}"`);
    csv.push(rowData.join(","));
  }

  const blob = new Blob([csv.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "availability.csv";
  link.click();
  URL.revokeObjectURL(url);
});

// Print Grid
document.getElementById("printGridBtn")?.addEventListener("click", () => {
  const content = document.getElementById("availabilityGrid").innerHTML;
  const win = window.open("", "", "width=1000,height=800");
  win.document.write(`
    <html>
      <head>
        <title>Print</title>
        <style>
          body { font-family: Arial; padding: 10px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #000; padding: 5px; text-align: center; }
          th { background: #eee; }
          @media print {
            @page { size: landscape; margin: 0.5cm; }
            h2 { display: none; }
          }
        </style>
      </head>
      <body>
        ${content}
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
  win.close();
});

// Bind Generate Grid Button

{
  const searchCustomerBtn = document.getElementById("searchCustomerBtn");
  if (searchCustomerBtn) searchCustomerBtn.onclick = async () => {
    await loadCustomers();
    showCustomerListModal();
  };
}

function showCustomerListModal() {
  const list = document.getElementById("customerListContainer");
  const searchInput = document.getElementById("customerSearchInput");
  const countEl = document.getElementById("customerSearchCount");

  const sorted = [...customers].sort((a, b) => ((a.name||"").toLowerCase()).localeCompare((b.name||"").toLowerCase()));

  function renderList(filter = "") {
    list.innerHTML = "";
    const lowerFilter = filter.toLowerCase();
    const filtered = sorted.filter(c => {
      const name = (c.name || "").toLowerCase();
      const phone = (c.telephone || "").toLowerCase();
      return name.includes(lowerFilter) || phone.includes(lowerFilter);
    });

    if (countEl) countEl.textContent = filtered.length + ' guest' + (filtered.length !== 1 ? 's' : '') + (filter ? ' found' : ' total');

    if (filtered.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);"><span class="material-icons" style="font-size:36px; opacity:0.4; display:block; margin-bottom:4px;">person_off</span>No guests match your search</div>';
      return;
    }

    filtered.forEach(c => {
      const initials = (c.name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
      const div = document.createElement("div");
      div.style.cssText = `
        display:flex; align-items:center; gap:12px; padding:10px 14px;
        cursor:pointer; border-bottom:1px solid var(--border-light);
      `;
      div.innerHTML = `
        <div style="width:36px; height:36px; border-radius:50%; background:var(--bg-tertiary); border:1px solid var(--border-medium);
          display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-weight:700; font-size:0.75rem; flex-shrink:0;">${initials}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text-primary);">${escapeHTML(c.name || 'Unknown')}</div>
          <div style="font-size:0.78rem; color:var(--text-muted);">${escapeHTML(c.telephone || 'No phone')}</div>
        </div>
        <span class="material-icons" style="color:var(--text-muted); font-size:18px; flex-shrink:0;">chevron_right</span>
      `;
      div.onmouseenter = () => { div.style.background = 'var(--bg-tertiary)'; };
      div.onmouseleave = () => { div.style.background = 'transparent'; };

      // Single click to select & open details
      div.onclick = () => {
        ModalManager.close('searchCustomerModal');
        showCustomerDetailsModal(c);
      };

      // Double-click also opens details (same action for intuitive UX)
      div.ondblclick = () => {
        ModalManager.close('searchCustomerModal');
        showCustomerDetailsModal(c);
      };

      list.appendChild(div);
    });
  }

  renderList();
  searchInput.value = "";
  searchInput.oninput = () => renderList(searchInput.value);

  document.getElementById("closeSearchCustomerBtn").onclick = () => ModalManager.close('searchCustomerModal');
  ModalManager.open('searchCustomerModal');
  setTimeout(() => searchInput.focus(), 100);
}

function showCustomerDetailsModal(customer) {
  const info = document.getElementById("customerDetailFields");

  const initials = (customer.name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  // Count reservations & total paid
  const allRes = (window._reservationsCache || []).filter(r => r.customerId === customer.id);
  const allPay = (window._allPaymentsCache || []).filter(p => p.customerId === customer.id && !p.voided);
  const totalPaid = allPay.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

  info.innerHTML = `
    <div style="display:flex; align-items:center; gap:14px; padding-bottom:14px; border-bottom:1px solid var(--border-light); margin-bottom:14px;">
      <div style="width:44px; height:44px; border-radius:50%; background:var(--bg-tertiary); border:1px solid var(--border-medium);
        display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-weight:700; font-size:1rem; flex-shrink:0;">${initials}</div>
      <div>
        <div style="font-size:1rem; font-weight:700; color:var(--text-primary);">${escapeHTML(customer.name || 'Unknown')}</div>
        <div style="font-size:0.85em; color:var(--text-muted);">${escapeHTML(customer.telephone || 'No phone')}</div>
      </div>
    </div>
    <table style="width:100%; border-collapse:collapse; font-size:0.87em;">
      <tr><td style="padding:5px 0; color:var(--text-muted); width:110px;">Address</td><td style="padding:5px 0; color:var(--text-primary);">${escapeHTML(customer.address || '---')}</td></tr>
      <tr><td style="padding:5px 0; color:var(--text-muted);">Email</td><td style="padding:5px 0; color:var(--text-primary);">${escapeHTML(customer.email || '---')}</td></tr>
      <tr><td style="padding:5px 0; color:var(--text-muted);">Reservations</td><td style="padding:5px 0; color:var(--text-primary);">${allRes.length}</td></tr>
      <tr><td style="padding:5px 0; color:var(--text-muted);">Total Paid</td><td style="padding:5px 0; color:var(--text-primary);">$${totalPaid.toFixed(2)}</td></tr>
    </table>
    ${customer.idImageUrl ? `<div style="margin-top:12px;">
      <img src="${customer.idImageUrl}" alt="ID" style="max-width:100%; max-height:130px; border-radius:6px; border:1px solid var(--border-light); display:block;"/>
    </div>` : ''}
  `;

  // Keep track of currently selected customer
  selectedCustomerId = customer.id;

  // Edit Customer button
  const editBtn = document.getElementById("editCustomerBtn");
  if (editBtn) {
    const newEditBtn = editBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEditBtn, editBtn);
    newEditBtn.addEventListener("click", () => {
      ModalManager.close('customerDetailsModal');
      openEditCustomerModal(customer);
    });
  }

  // View Transactions button
  const txBtn = document.getElementById("viewCustomerTransactionsBtn");
  if (txBtn) {
    const newTxBtn = txBtn.cloneNode(true);
    txBtn.parentNode.replaceChild(newTxBtn, txBtn);
    newTxBtn.addEventListener("click", () => {
      ModalManager.close('customerDetailsModal');
      showTransactionsModal(customer);
    });
  }

  // View Reservations button
  const resBtn = document.getElementById("viewCustomerReservationsBtn");
  if (resBtn) {
    const newResBtn = resBtn.cloneNode(true);
    resBtn.parentNode.replaceChild(newResBtn, resBtn);
    newResBtn.addEventListener("click", () => {
      openCustomerReservations(customer.id);
    });
  }

  // Delete Customer button
  const delBtn = document.getElementById("deleteCustomerBtn");
  if (delBtn) {
    const newDelBtn = delBtn.cloneNode(true);
    delBtn.parentNode.replaceChild(newDelBtn, delBtn);
    newDelBtn.addEventListener("click", async () => {
      const activeRes = (window._reservationsCache || []).filter(r => r.customerId === customer.id && !r.checkedOut);
      if (activeRes.length > 0) {
        alert('Cannot delete ' + (customer.name || 'this guest') + ' -- they have ' + activeRes.length + ' active reservation(s). Check them out first.');
        return;
      }
      if (!confirm('Delete guest "' + (customer.name || 'Unknown') + '"?\n\nThis cannot be undone.')) return;
      try {
        await deleteDoc(doc(db, 'customers', customer.id));
        customers = customers.filter(c => c.id !== customer.id);
        ModalManager.close('customerDetailsModal');
        alert('Guest deleted.');
      } catch (err) {
        console.error('Delete customer failed:', err);
        alert('Failed to delete guest.');
      }
    });
  }

  // Show the details modal
  ModalManager.open('customerDetailsModal');

  document.getElementById("closeCustomerDetailsBtn")?.addEventListener("click", function() {
    ModalManager.close('customerDetailsModal');
  });
}



//EDIT MODAL
let editCustomerNewIdImage = null; // Store new ID image data URL

function openEditCustomerModal(customer) {
  editingCustomerId = customer.id;
  editCustomerNewIdImage = null; // Reset

  document.getElementById("editCustomerName").value = customer.name || "";
  document.getElementById("editCustomerPhone").value = customer.telephone || "";
  document.getElementById("editCustomerAddress").value = customer.address || "";
  document.getElementById("editCustomerEmail").value = customer.email || "";

  // Show current ID image or placeholder
  const idPreview = document.getElementById("editCustomerIdPreview");
  if (customer.idImageUrl) {
    idPreview.innerHTML = `<img src="${customer.idImageUrl}" alt="Customer ID" style="max-width: 200px; max-height: 150px; border-radius: 8px; border: 1px solid #ccc;" />`;
  } else {
    idPreview.innerHTML = `<span style="color: #999;">No ID image uploaded</span>`;
  }

  ModalManager.open('editCustomerModal');
}

//EDIT EVENT LSITENERS
{
  const closeEditCustomerBtn = document.getElementById("closeEditCustomerBtn");
  const cancelCustomerEditBtn = document.getElementById("cancelCustomerEditBtn");
  const hideEditCustomerModal = () => {
    ModalManager.close('editCustomerModal');
    editCustomerNewIdImage = null; // Reset on close
  };
  if (closeEditCustomerBtn) closeEditCustomerBtn.onclick = hideEditCustomerModal;
  if (cancelCustomerEditBtn) cancelCustomerEditBtn.onclick = hideEditCustomerModal;
}

// ID Image change button and file input handlers
{
  const editIdBtn = document.getElementById("editCustomerIdBtn");
  const editIdInput = document.getElementById("editCustomerIdInput");
  
  if (editIdBtn && editIdInput) {
    editIdBtn.onclick = () => editIdInput.click();
    
    editIdInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target.result;
        
        // Open crop modal with the image
        document.getElementById("idCropImage").src = dataUrl;
        ModalManager.open('idCropModal');
        
        // Set a flag to indicate we're editing customer ID (not creating new reservation)
        window._editCustomerIdCropMode = true;
        
        setTimeout(() => {
          const image = document.getElementById("idCropImage");
          // Destroy any existing cropper instance
          if (cropperInstance) {
            cropperInstance.destroy();
            cropperInstance = null;
          }
          cropperInstance = new Cropper(image, {
            aspectRatio: 3 / 2,
            viewMode: 1,
          });
        }, 100);
      };
      reader.readAsDataURL(file);
      
      // Reset input so same file can be selected again
      e.target.value = '';
    };
  }
}

{
  const saveCustomerEditBtn = document.getElementById("saveCustomerEditBtn");
  if (saveCustomerEditBtn) saveCustomerEditBtn.onclick = async (e) => {
  e.preventDefault();
  if (!editingCustomerId) return;

  const name = document.getElementById("editCustomerName").value.trim();
  const phone = document.getElementById("editCustomerPhone").value.trim();
  const address = document.getElementById("editCustomerAddress").value.trim();
  const email = document.getElementById("editCustomerEmail").value.trim();

  try {
    const customerRef = doc(db, "customers", editingCustomerId);
    
    // Build update object
    const updateData = {
      name,
      telephone: phone,
      address,
      email
    };
    
    // Include new ID image if one was selected
    if (editCustomerNewIdImage) {
      updateData.idImageUrl = editCustomerNewIdImage;
    }
    
    await updateDoc(customerRef, updateData);

    alert("Customer updated successfully.");
    ModalManager.close('editCustomerModal');
    editCustomerNewIdImage = null; // Reset
    await loadCustomers();

    // Refresh details modal if still open
    const updated = customers.find(c => c.id === editingCustomerId);
    if (updated) showCustomerDetailsModal(updated);

  } catch (err) {
    console.error("Error updating customer:", err);
    alert("Failed to update customer.");
  }
  };
}


async function showTransactionsModal(customer) {
  const modal = document.getElementById("transactionListModal");
  const list = document.getElementById("transactionListContainer");
  list.innerHTML = "";
  // Use live cache instead of fetching all payments from Firestore
  let payments = (window._allPaymentsCache || [])
    .filter(p => p.customerId === customer.id);
  // Sort by receipt number ascending, then by timestamp descending if needed
  payments.sort((a, b) => {
    // If both have receiptNumber, sort by it (as string, leading zeros)
    if (a.receiptNumber && b.receiptNumber) {
      if (a.receiptNumber !== b.receiptNumber) {
        return a.receiptNumber.localeCompare(b.receiptNumber);
      }
    }
    // Otherwise, sort by timestamp descending
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
  if (payments.length === 0) {
    list.innerHTML = "<em>No transactions found.</em>";
  } else {
    payments.forEach(p => {
      const div = document.createElement("div");
      div.className = "transaction-item";
      div.style.cursor = "pointer";
      div.style.padding = "12px 16px";
      div.style.borderBottom = "1px solid #eee";
      div.style.background = "var(--bg-secondary, #f9f9f9)";
      div.style.marginBottom = "8px";
      div.style.borderRadius = "6px";
      div.style.transition = "background 0.2s";
      const methodDisplay = p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : 'N/A';
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span><strong>Receipt #${p.receiptNumber}</strong></span>
          <span style="color:var(--accent-success, #10b981);font-weight:600;">$${parseFloat(p.amount).toFixed(2)}</span>
        </div>
        <div style="font-size:0.9em;color:var(--text-secondary, #666);margin-top:4px;">
          ${p.timestamp ? formatDateDMY(p.timestamp) : 'N/A'} • ${methodDisplay}
        </div>
      `;
      div.onmouseenter = () => div.style.background = 'var(--bg-tertiary, #e5e5e5)';
      div.onmouseleave = () => div.style.background = 'var(--bg-secondary, #f9f9f9)';
      div.onclick = async () => {
        let reservation = null;
        if (p.reservationId) {
          const resDoc = await getDoc(doc(db, "reservations", p.reservationId));
          reservation = resDoc.exists() ? { id: resDoc.id, ...resDoc.data() } : null;
        }
        showReceiptDetailModal(p, reservation);
      };
      list.appendChild(div);
    });
  }
  document.getElementById("closeTransactionListBtn").onclick = () => ModalManager.close('transactionListModal');
  ModalManager.open('transactionListModal');
}

function showReceiptDetailModal(payment, reservation) {
  // Remove any existing receipt popup
  document.querySelectorAll('[data-popup-type="receipt-detail"]').forEach(el => el.remove());
  
  // Try to get customer info
  let customer = null;
  if (payment.customerId && typeof customers !== 'undefined') {
    customer = customers.find(c => c.id === payment.customerId);
  }
  
  // Calculate reservation totals if reservation exists
  let totalDue = 0;
  let totalPaid = 0;
  let balance = 0;
  
  if (reservation) {
    const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
    const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
    // Include balance adjustments
    const adjustments = reservation.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    totalDue = baseTotal + totalAdjustment;
    // Filter out voided payments
    const resPayments = allPayments.filter(p => p.reservationId === reservation.id && !p.voided);
    const actualPaid = resPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    totalPaid = actualPaid + calcCreditTotal(reservation.balanceCredits);
    balance = Math.max(0, totalDue - totalPaid);
  }
  
  // Format date/time
  const paymentDate = payment.timestamp ? formatDateDMY(payment.timestamp) : 'N/A';
  const paymentTime = payment.timestamp ? new Date(payment.timestamp).toLocaleTimeString() : 'N/A';
  const paymentMethod = payment.method ? payment.method.charAt(0).toUpperCase() + payment.method.slice(1) : 'N/A';
  
  // Create popup (same style as showReceiptDetails)
  const popup = document.createElement("div");
  popup.setAttribute('data-popup-type', 'receipt-detail');
  popup.style.position = "fixed";
  popup.style.left = "50%";
  popup.style.top = "50%";
  popup.style.transform = "translate(-50%, -50%)";
  popup.style.background = "var(--bg-card, #fff)";
  popup.style.color = "var(--text-primary, #222)";
  popup.style.padding = "28px";
  popup.style.border = "1px solid var(--border-medium, #ccc)";
  popup.style.zIndex = "2000";
  popup.style.borderRadius = "12px";
  popup.style.boxShadow = "0 4px 24px rgba(0,0,0,0.15)";
  popup.style.width = "450px";
  popup.style.maxHeight = "80vh";
  popup.style.overflowY = "auto";
  
  // Check if voided
  const isVoided = payment.voided === true;
  const receiptTitle = isVoided 
    ? `<h3 style="margin:0 0 12px 0;font-size:1.1em;text-decoration:line-through;color:#888;">Receipt #${payment.receiptNumber} <span style="color:#ef4444;font-weight:bold;text-decoration:none;">[VOIDED]</span></h3>`
    : `<h3 style="margin:0 0 12px 0;font-size:1.1em;">Receipt #${payment.receiptNumber}</h3>`;
  
  popup.innerHTML = `
    <h2 style="margin-top:0;margin-bottom:16px;text-align:center;">🧾 Receipt Details</h2>
    
    <div style="background:var(--bg-tertiary, #f5f5f5);padding:16px;border-radius:8px;margin-bottom:16px;">
      ${receiptTitle}
      ${isVoided ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:8px;margin-bottom:12px;border-radius:4px;">
        <strong style="color:#ef4444;">⚠️ VOIDED</strong><br>
        <span style="font-size:0.9em;color:#666;">
          ${payment.voidedAt ? formatDateTimeDMY(payment.voidedAt) : 'N/A'}
          ${payment.voidReason ? '<br>Reason: ' + escapeHTML(payment.voidReason) : ''}
        </span>
      </div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><strong>Date:</strong></div><div>${paymentDate}</div>
        <div><strong>Time:</strong></div><div>${paymentTime}</div>
        <div><strong>Amount:</strong></div><div style="color:#10b981;font-weight:600;">$${parseFloat(payment.amount).toFixed(2)}</div>
        <div><strong>Method:</strong></div><div>${escapeHTML(paymentMethod)}</div>
        ${payment.note ? `<div><strong>Note:</strong></div><div>${escapeHTML(payment.note)}</div>` : ''}
      </div>
    </div>
    
    <div style="background:var(--bg-tertiary, #f5f5f5);padding:16px;border-radius:8px;margin-bottom:16px;">
      <h3 style="margin:0 0 12px 0;font-size:1.1em;">👤 Customer</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><strong>Name:</strong></div><div>${escapeHTML(customer?.name || 'Unknown')}</div>
        <div><strong>Phone:</strong></div><div>${escapeHTML(customer?.telephone || 'N/A')}</div>
        <div><strong>Email:</strong></div><div>${escapeHTML(customer?.email || 'N/A')}</div>
        <div><strong>Address:</strong></div><div>${escapeHTML(customer?.address || 'N/A')}</div>
      </div>
    </div>
    
    ${reservation ? `
    <div style="background:var(--bg-tertiary, #f5f5f5);padding:16px;border-radius:8px;margin-bottom:16px;">
      <h3 style="margin:0 0 12px 0;font-size:1.1em;">🏨 Reservation</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div><strong>Room:</strong></div><div>${reservation.roomNumber}</div>
        <div><strong>Check-In:</strong></div><div>${formatDateDMY(reservation.arrivalDate)}</div>
        <div><strong>Check-Out:</strong></div><div>${formatDateDMY(reservation.departureDate)}</div>
        <div><strong>Total Cost:</strong></div><div>$${totalDue.toFixed(2)}</div>
        <div><strong>Total Paid:</strong></div><div style="color:#10b981;">$${totalPaid.toFixed(2)}</div>
        <div><strong>Balance:</strong></div><div style="color:${balance > 0 ? '#ef4444' : '#10b981'};">$${balance.toFixed(2)}</div>
      </div>
    </div>
    ` : '<p style="color:#666;">Reservation details not found.</p>'}
    
    <div style="display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;">
      ${!isVoided ? `<button id="voidReceiptPopupBtn" style="background:#f59e0b;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;">🚫 Void Receipt</button>` : ''}
      <button id="printReceiptPopupBtn" style="background:#10b981;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;">🖨️ Print</button>
      ${reservation ? `<button id="viewReservationFromReceiptBtn" style="background:#3b82f6;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;">View Reservation</button>` : ''}
      <button id="closeReceiptPopupBtn" style="background:#6b7280;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;">Close</button>
    </div>
  `;
  
  document.body.appendChild(popup);
  
  // Close button
  popup.querySelector('#closeReceiptPopupBtn').onclick = () => popup.remove();
  
  // Void Receipt button - allows voiding receipts from customer transaction history
  if (!isVoided) {
    popup.querySelector('#voidReceiptPopupBtn').onclick = async () => {
      // Ask for reason before voiding
      const voidReason = prompt(`Void receipt #${payment.receiptNumber}?\n\nEnter reason for voiding (optional):`);
      if (voidReason === null) return; // User cancelled
      
      try {
        // Mark payment as voided in database (keeps receipt number for audit trail)
        const paymentRef = doc(db, "payments", payment.id);
        await updateDoc(paymentRef, {
          voided: true,
          voidedAt: new Date().toISOString(),
          voidReason: voidReason || "No reason provided"
        });
        
        // If this payment belongs to a reservation, update payment status
        if (reservation) {
          const allPayments = window._allPaymentsCache || [];
          const remainingPayments = allPayments.filter(p => 
            p.reservationId === reservation.id && 
            p.id !== payment.id && 
            !p.voided
          );
          const totalPaidAfterVoid = remainingPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
          
          // Calculate what's owed
          const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
          const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
          const adjustments = reservation.balanceAdjustments || [];
          const totalAdjustment = calcAdjustmentTotal(adjustments);
          const totalDue = baseTotal + totalAdjustment;
          
          // Determine new payment status
          let newStatus = "not_paid";
          if (totalPaidAfterVoid >= totalDue) {
            newStatus = "fully_paid";
          } else if (totalPaidAfterVoid > 0) {
            newStatus = "partially_paid";
          }
          
          // Update reservation
          const reservationRef = doc(db, "reservations", reservation.id);
          await updateDoc(reservationRef, { paymentStatus: newStatus });
        }
        
        // Log to audit trail
        await auditLog(AUDIT_ACTIONS.PAYMENT_VOID, {
          receiptNumber: payment.receiptNumber,
          amount: payment.amount,
          reason: voidReason || "No reason provided",
          reservationId: reservation?.id || null,
          customerName: customer?.name
        }, 'payment', payment.id);
        
        alert(`Receipt #${payment.receiptNumber} has been voided.\n\nThe receipt number is preserved for audit purposes.`);
        popup.remove();
        
        // Refresh the transaction list if it's open
        if (customer) {
          await showTransactionsModal(customer);
        }
        
        // Update dashboard
        if (typeof afterReservationOrPaymentChange === 'function') {
          await afterReservationOrPaymentChange();
        }
      } catch (err) {
        console.error("Error voiding receipt:", err);
        alert("Failed to void receipt. Please try again.");
      }
    };
  }
  
  // Print button
  popup.querySelector('#printReceiptPopupBtn').onclick = () => {
    const printContent = popup.innerHTML;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head><title>Receipt #${payment.receiptNumber}</title>
      <style>body{font-family:Arial,sans-serif;padding:20px;} button{display:none !important;}</style>
      </head><body>${printContent}</body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };
  
  if (reservation) {
    popup.querySelector('#viewReservationFromReceiptBtn').onclick = () => {
      popup.remove();
      showEditDeletePopup(reservation);
    };
  }
}

{
  const searchReceiptBtn = document.getElementById("searchReceiptBtn");
  if (searchReceiptBtn) searchReceiptBtn.onclick = () => {
    document.getElementById("searchReceiptInput").value = "";
    document.getElementById("searchReceiptError").style.display = "none";
    ModalManager.open('searchReceiptModal');
    // Focus the input
    setTimeout(() => document.getElementById("searchReceiptInput")?.focus(), 100);
  };

  const closeSearchReceiptBtn = document.getElementById("closeSearchReceiptBtn");
  if (closeSearchReceiptBtn) closeSearchReceiptBtn.onclick = () => {
    ModalManager.close('searchReceiptModal');
  };

  // Allow Enter key to search
  document.getElementById("searchReceiptInput")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      document.getElementById("submitSearchReceiptBtn")?.click();
    }
  });

  const submitSearchReceiptBtn = document.getElementById("submitSearchReceiptBtn");
  if (submitSearchReceiptBtn) submitSearchReceiptBtn.onclick = async () => {
    const receiptInput = document.getElementById("searchReceiptInput").value.trim();
    const errorDiv = document.getElementById("searchReceiptError");
    
    if (!receiptInput) {
      errorDiv.textContent = "Please enter a receipt number.";
      errorDiv.style.display = "block";
      return;
    }
    
    errorDiv.style.display = "none";

    // Show loading state
    const origText = submitSearchReceiptBtn.innerHTML;
    submitSearchReceiptBtn.disabled = true;
    submitSearchReceiptBtn.innerHTML = 'Searching...';

    try {
      // Always fetch fresh from Firestore to ensure latest data
      let allPayments = window._allPaymentsCache || [];
      if (allPayments.length === 0) {
        const paymentsSnapshot = await getDocs(collection(db, "payments"));
        allPayments = paymentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      
      // Flexible matching: strip leading zeros, non-numeric chars, and compare
      const cleanInput = receiptInput.replace(/[^0-9]/g, '');
      const searchNum = cleanInput.replace(/^0+/, '') || '0';
      const searchPadded = cleanInput.padStart(5, '0');
      
      const payment = allPayments.find(p => {
        if (!p.receiptNumber) return false;
        const rn = String(p.receiptNumber);
        const cleanRn = rn.replace(/[^0-9]/g, '');
        const pNum = cleanRn.replace(/^0+/, '') || '0';
        return pNum === searchNum || rn === searchPadded || rn === receiptInput || cleanRn === cleanInput;
      });
      
      if (!payment) {
        errorDiv.textContent = `Receipt #${receiptInput} not found.`;
        errorDiv.style.display = "block";
        return;
      }
      
      // Get reservation details
      let reservation = null;
      if (payment.reservationId) {
        const reservations = window._reservationsCache || [];
        reservation = reservations.find(r => r.id === payment.reservationId);
        if (!reservation) {
          const resDoc = await getDoc(doc(db, "reservations", payment.reservationId));
          reservation = resDoc.exists() ? { id: resDoc.id, ...resDoc.data() } : null;
        }
      }
      
      // Close search modal and show receipt details
      ModalManager.close('searchReceiptModal');
      showReceiptDetailModal(payment, reservation);
    } catch (err) {
      console.error('Receipt search error:', err);
      errorDiv.textContent = 'Search failed. Please try again.';
      errorDiv.style.display = "block";
    } finally {
      submitSearchReceiptBtn.disabled = false;
      submitSearchReceiptBtn.innerHTML = origText;
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTEND STAY – In-House Guests List (Dashboard Quick Action)
// ═══════════════════════════════════════════════════════════════════════════
{
  const extendStayBtn = document.getElementById("extendStayBtn");
  if (extendStayBtn) extendStayBtn.onclick = () => showInHouseGuestsForExtend();

  const closeInHouseGuestsBtn = document.getElementById("closeInHouseGuestsBtn");
  if (closeInHouseGuestsBtn) closeInHouseGuestsBtn.onclick = () => {
    ModalManager.close('inHouseGuestsModal');
  };
}

/**
 * Shows a modal listing in-house guests eligible for stay extension
 * Only shows guests whose departure date is today or yesterday (within 1 day)
 * Clicking a guest opens the extend reservation modal for that guest
 */
async function showInHouseGuestsForExtend() {
  const listContainer = document.getElementById("inHouseGuestsList");
  const emptyContainer = document.getElementById("inHouseGuestsEmpty");
  if (!listContainer || !emptyContainer) return;

  // Show loading state
  listContainer.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);"><span class="material-icons" style="font-size:32px; animation: spin 1s linear infinite;">hourglass_empty</span><p>Loading eligible guests...</p></div>';
  emptyContainer.style.display = "none";
  ModalManager.open('inHouseGuestsModal');

  // Get reservations from cache or fetch
  let reservations = window._reservationsCache || [];
  if (reservations.length === 0) {
    try {
      const snapshot = await getDocs(collection(db, "reservations"));
      reservations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.error("Failed to load reservations for in-house list:", e);
      listContainer.innerHTML = '<p style="color:var(--accent-danger); text-align:center;">Failed to load reservations.</p>';
      return;
    }
  }

  // Calculate date boundaries: yesterday through 3 days ahead
  const today = getTodayLocal(); // YYYY-MM-DD
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split('T')[0];
  const threeDaysAhead = new Date();
  threeDaysAhead.setDate(threeDaysAhead.getDate() + 3);
  const maxDate = threeDaysAhead.toISOString().split('T')[0];

  // Filter: checked in, not checked out, departure from yesterday to 3 days ahead
  const inHouseGuests = reservations.filter(r => {
    const isCheckedIn = r.checkedIn || !!r.actualCheckInTime;
    const isCheckedOut = !!r.checkedOut;
    if (!isCheckedIn || isCheckedOut) return false;

    // Show guests whose departure is yesterday (overdue) through 3 days from now
    const depDate = r.departureDate || '';
    return depDate >= yesterday && depDate <= maxDate;
  });

  if (inHouseGuests.length === 0) {
    listContainer.innerHTML = "";
    emptyContainer.style.display = "block";
    return;
  }

  emptyContainer.style.display = "none";

  // Sort by room number
  inHouseGuests.sort((a, b) => {
    const roomA = parseInt(a.roomNumber) || 0;
    const roomB = parseInt(b.roomNumber) || 0;
    return roomA - roomB;
  });

  // Build the guest list
  let html = '';
  for (const res of inHouseGuests) {
    // Find customer name
    const customer = customers.find(c => c.id === res.customerId);
    const guestName = customer ? customer.name : (res.customerName || 'Unknown Guest');
    const checkout = res.departureDate ? formatDateDMY(res.departureDate) : '—';
    const roomNum = res.roomNumber || '—';

    // Determine checkout urgency label
    const depDate = res.departureDate || '';
    let statusLabel = '';
    let statusColor = 'var(--text-muted)';
    if (depDate < today) {
      statusLabel = 'Overdue';
      statusColor = 'var(--accent-danger)';
    } else if (depDate === today) {
      statusLabel = 'Today';
      statusColor = 'var(--accent-warning, #f59e0b)';
    } else {
      // Future: calculate days until checkout
      const diffMs = new Date(depDate) - new Date(today);
      const diffDays = Math.round(diffMs / 86400000);
      statusLabel = diffDays === 1 ? 'Tomorrow' : `In ${diffDays} days`;
      statusColor = 'var(--accent-primary)';
    }

    html += `
      <button class="in-house-guest-card" data-res-id="${res.id}" style="
        display:flex; align-items:center; gap:12px; padding:14px 16px;
        background:var(--bg-tertiary); border:1px solid var(--border-light);
        border-radius:var(--radius-md); cursor:pointer; text-align:left;
        transition: all 0.2s ease; width:100%; font-family:inherit;
        color:var(--text-primary);
      " onmouseover="this.style.borderColor='var(--accent-primary)'; this.style.background='var(--bg-card)';"
         onmouseout="this.style.borderColor='var(--border-light)'; this.style.background='var(--bg-tertiary)';">
        <div style="
          width:44px; height:44px; border-radius:50%;
          background:var(--accent-primary);
          display:flex; align-items:center; justify-content:center;
          color:white; font-weight:700; font-size:0.85rem; flex-shrink:0;
        ">${roomNum}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; font-size:0.95rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHTML(guestName)}
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
            Checkout: ${checkout}
            <span style="margin-left:6px; font-weight:600; color:${statusColor};">&bull; ${statusLabel}</span>
          </div>
        </div>
        <span class="material-icons" style="color:var(--accent-success); font-size:22px; flex-shrink:0;">update</span>
      </button>
    `;
  }

  listContainer.innerHTML = html;

  // Add click handlers to each guest card
  listContainer.querySelectorAll('.in-house-guest-card').forEach(card => {
    card.onclick = () => {
      const resId = card.getAttribute('data-res-id');
      const reservation = inHouseGuests.find(r => r.id === resId);
      if (!reservation) return;

      // Close in-house guests modal
      ModalManager.close('inHouseGuestsModal');

      // Set flag so extend modal does NOT try to return to edit popup
      window._lastReservationForPopup = null;
      window._extendFromDashboard = true;

      // Open extend reservation modal
      openExtendReservationModal(reservation);
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOM HISTORY (Dashboard Quick Action)
// ═══════════════════════════════════════════════════════════════════════════
{
  const roomHistoryBtn = document.getElementById("roomHistoryBtn");
  if (roomHistoryBtn) roomHistoryBtn.onclick = () => openRoomHistoryModal();

  // Close X button for room history modal
  const closeRoomHistoryXBtn = document.getElementById("closeRoomHistoryBtn");
  if (closeRoomHistoryXBtn) closeRoomHistoryXBtn.onclick = () => ModalManager.close('roomHistoryModal');

  const roomHistoryBackBtn = document.getElementById("roomHistoryBackBtn");
  if (roomHistoryBackBtn) roomHistoryBackBtn.onclick = () => showRoomSelector();
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSING CLOSE BUTTON HANDLERS
// ═══════════════════════════════════════════════════════════════════════════
{
  // Receipt Detail Modal X button
  const closeReceiptDetailBtn = document.getElementById("closeReceiptDetailBtn");
  if (closeReceiptDetailBtn) closeReceiptDetailBtn.onclick = () => ModalManager.close('receiptDetailModal');

  // ID Upload Modal X button
  const closeIdUploadBtn = document.getElementById("closeIdUploadBtn");
  if (closeIdUploadBtn) closeIdUploadBtn.onclick = () => ModalManager.close('idUploadModal');

  // ID Crop Modal X button
  const closeIdCropBtn = document.getElementById("closeIdCropBtn");
  if (closeIdCropBtn) closeIdCropBtn.onclick = () => {
    cropperInstance?.destroy();
    cropperInstance = null;
    window._editCustomerIdCropMode = false;
    ModalManager.close('idCropModal');
  };

  // Email Confirmation Modal (legacy) X and Cancel buttons
  const closeEmailConfirmationBtn = document.getElementById("closeEmailConfirmationBtn");
  if (closeEmailConfirmationBtn) closeEmailConfirmationBtn.onclick = () => ModalManager.close('emailConfirmationModal');
  const cancelEmailConfirmationBtn = document.getElementById("cancelEmailConfirmationBtn");
  if (cancelEmailConfirmationBtn) cancelEmailConfirmationBtn.onclick = () => ModalManager.close('emailConfirmationModal');
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL BACKDROP CLICK-TO-CLOSE — DISABLED
// Clicking outside modals no longer closes them. Use X or Cancel buttons.
// ═══════════════════════════════════════════════════════════════════════════

function openRoomHistoryModal() {
  ModalManager.open('roomHistoryModal');
  showRoomSelector();
  buildRoomButtons();
}

function buildRoomButtons() {
  const floor1Container = document.getElementById("roomHistoryFloor1");
  const floor2Container = document.getElementById("roomHistoryFloor2");
  if (!floor1Container || !floor2Container) return;

  floor1Container.innerHTML = "";
  floor2Container.innerHTML = "";

  const makeBtn = (roomNum) => {
    const btn = document.createElement("button");
    btn.textContent = roomNum;
    btn.className = "btn";
    btn.style.cssText = `
      min-width:52px; padding:10px 6px; font-weight:700; font-size:0.9rem;
      border:1px solid var(--border-light); border-radius:var(--radius-md);
      background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer;
      transition:all 0.2s ease;
    `;
    btn.onmouseenter = () => { btn.style.background = '#8b5cf6'; btn.style.color = '#fff'; btn.style.borderColor = '#8b5cf6'; };
    btn.onmouseleave = () => { btn.style.background = 'var(--bg-tertiary)'; btn.style.color = 'var(--text-primary)'; btn.style.borderColor = 'var(--border-light)'; };
    btn.onclick = () => loadRoomHistory(roomNum);
    return btn;
  };

  APP_CONFIG.ROOMS.FLOOR_1.forEach(r => floor1Container.appendChild(makeBtn(r)));
  APP_CONFIG.ROOMS.FLOOR_2.forEach(r => floor2Container.appendChild(makeBtn(r)));
}

function showRoomSelector() {
  const selector = document.getElementById("roomHistorySelector");
  const content = document.getElementById("roomHistoryContent");
  if (selector) selector.style.display = "block";
  if (content) content.style.display = "none";
}

async function loadRoomHistory(roomNumber) {
  const selector = document.getElementById("roomHistorySelector");
  const content = document.getElementById("roomHistoryContent");
  const listEl = document.getElementById("roomHistoryList");
  const emptyEl = document.getElementById("roomHistoryEmpty");
  const roomNumEl = document.getElementById("roomHistoryRoomNum");

  if (selector) selector.style.display = "none";
  if (content) content.style.display = "block";
  if (roomNumEl) roomNumEl.textContent = roomNumber;

  listEl.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);"><span class="material-icons" style="font-size:32px; animation: spin 1s linear infinite;">hourglass_empty</span><p>Loading history...</p></div>';
  emptyEl.style.display = "none";

  // Get reservations for this room
  let reservations = window._reservationsCache || [];
  if (reservations.length === 0) {
    try {
      const snapshot = await getDocs(collection(db, "reservations"));
      reservations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      listEl.innerHTML = '<p style="color:var(--accent-danger); text-align:center;">Failed to load reservations.</p>';
      return;
    }
  }

  const roomReservations = reservations
    .filter(r => String(r.roomNumber) === String(roomNumber))
    .sort((a, b) => {
      const dateA = new Date(b.arrivalDate || b.createdAt || 0);
      const dateB = new Date(a.arrivalDate || a.createdAt || 0);
      return dateA - dateB; // newest first
    });

  if (roomReservations.length === 0) {
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }

  emptyEl.style.display = "none";

  // Get payments from cache
  const allPayments = window._allPaymentsCache || [];

  let html = '';
  for (const res of roomReservations) {
    const customer = customers.find(c => c.id === res.customerId);
    const guestName = customer ? customer.name : (res.customerName || 'Unknown Guest');
    const isCheckedIn = res.checkedIn || !!res.actualCheckInTime;
    const isCheckedOut = !!res.checkedOut;

    // Check-in/out display
    const checkInTime = res.actualCheckInTime || res.checkedInTime;
    const checkOutTime = res.actualCheckOutTime || res.checkedOutTime;
    const checkInDisplay = checkInTime ? formatDateTimeDMY(checkInTime) : (isCheckedIn ? 'Yes' : '—');
    const checkOutDisplay = checkOutTime ? formatDateTimeDMY(checkOutTime) : (isCheckedOut ? 'Yes' : '—');

    // Status badge — distinguish manual vs auto checkout
    let statusBadge = '';
    if (isCheckedOut && res.autoCheckedOut) {
      statusBadge = '<span style="background:#9333ea; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.7em; font-weight:600;" title="System auto-checkout">Auto Checked Out</span>';
    } else if (isCheckedOut) {
      statusBadge = '<span style="background:#dc2626; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.7em; font-weight:600;">Checked Out</span>';
    } else if (isCheckedIn) {
      statusBadge = '<span style="background:#16a34a; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.7em; font-weight:600;">In-House</span>';
    } else {
      statusBadge = '<span style="background:#f59e0b; color:#fff; padding:2px 8px; border-radius:12px; font-size:0.7em; font-weight:600;">Booked</span>';
    }

    // Payments for this reservation
    const resPayments = allPayments.filter(p => p.reservationId === res.id && !p.voided);
    const totalPaid = resPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

    html += `
      <div class="room-history-card" data-res-id="${res.id}" style="
        padding:14px 16px; background:var(--bg-card); border:1px solid var(--border-light);
        border-radius:var(--radius-md); cursor:pointer; transition:all 0.2s ease;
      " onmouseover="this.style.borderColor='#8b5cf6'; this.style.boxShadow='0 2px 8px rgba(139,92,246,0.15)';"
         onmouseout="this.style.borderColor='var(--border-light)'; this.style.boxShadow='none';">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-weight:700; font-size:0.95rem;">${escapeHTML(guestName)}</span>
          ${statusBadge}
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; font-size:0.82em; color:var(--text-muted);">
          <div><strong>Arrival:</strong> ${res.arrivalDate ? formatDateDMY(res.arrivalDate) : '—'}</div>
          <div><strong>Departure:</strong> ${res.departureDate ? formatDateDMY(res.departureDate) : '—'}</div>
          <div><strong>Check-in:</strong> ${checkInDisplay}</div>
          <div><strong>Check-out:</strong> ${checkOutDisplay}</div>
          <div style="grid-column:1/-1;"><strong>Paid:</strong> $${totalPaid.toFixed(2)} ${resPayments.length > 0 ? '(' + resPayments.length + ' payment' + (resPayments.length > 1 ? 's' : '') + ')' : ''}</div>
        </div>
      </div>
    `;
  }

  listEl.innerHTML = html;

  // Click handler – open reservation detail
  listEl.querySelectorAll('.room-history-card').forEach(card => {
    card.onclick = () => {
      const resId = card.getAttribute('data-res-id');
      const reservation = roomReservations.find(r => r.id === resId);
      if (reservation) {
        ModalManager.close('roomHistoryModal');
        showEditDeletePopup(reservation);
      }
    };
  });
}

{
  const checkInOutBtn = document.getElementById("checkInOutBtn");
  if (checkInOutBtn) checkInOutBtn.onclick = () => {
    ModalManager.open('checkInOutFilterModal');
    document.getElementById("checkInOutResultsContainer").innerHTML = "";
    document.getElementById("checkInOutTimeFilter").value = "today";
    document.getElementById("customCheckDateRange").style.display = "none";
  };

  const closeCheckInOutFilterBtn = document.getElementById("closeCheckInOutFilterBtn");
  if (closeCheckInOutFilterBtn) closeCheckInOutFilterBtn.onclick = () => {
    ModalManager.close('checkInOutFilterModal');
  };

  const checkInOutTimeFilter = document.getElementById("checkInOutTimeFilter");
  if (checkInOutTimeFilter) {
    checkInOutTimeFilter.onchange = function () {
      document.getElementById("customCheckDateRange").style.display = this.value === "custom" ? "block" : "none";
    };
  }

  const applyCheckInOutFilterBtn = document.getElementById("applyCheckInOutFilterBtn");
  if (applyCheckInOutFilterBtn) applyCheckInOutFilterBtn.onclick = async () => {
  const type = document.querySelector('input[name="checkType"]:checked').value;
  const filter = document.getElementById("checkInOutTimeFilter").value;
  let start, end;
  const today = new Date();
  const todayStr = getTodayLocal();
  
  if (filter === "today") {
    start = end = todayStr;
  } else if (filter === "week") {
    // Get Sunday of current week
    const dayOfWeek = today.getDay();
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - dayOfWeek);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    const sunYear = sunday.getFullYear();
    const sunMonth = String(sunday.getMonth() + 1).padStart(2, '0');
    const sunDay = String(sunday.getDate()).padStart(2, '0');
    start = `${sunYear}-${sunMonth}-${sunDay}`;
    const satYear = saturday.getFullYear();
    const satMonth = String(saturday.getMonth() + 1).padStart(2, '0');
    const satDay = String(saturday.getDate()).padStart(2, '0');
    end = `${satYear}-${satMonth}-${satDay}`;
  } else {
    start = document.getElementById("customCheckStartDate").value;
    end = document.getElementById("customCheckEndDate").value;
    if (!start || !end) {
      alert("Select a valid custom date range.");
      return;
    }
  }
  
  console.log('Filter:', filter, 'Type:', type, 'Start:', start, 'End:', end);
  
  const reservations = await loadReservations();
  let filtered;
  if (type === "checkin") {
    filtered = reservations.filter(r => r.arrivalDate >= start && r.arrivalDate <= end);
  } else {
    // For checkout, we check departureDate
    filtered = reservations.filter(r => {
      const depDate = r.departureDate;
      console.log('Checking reservation:', r.id, 'departureDate:', depDate, 'matches:', depDate >= start && depDate <= end);
      return depDate >= start && depDate <= end;
    });
  }
  
  console.log('Filtered results:', filtered.length);
  
  const resultsDiv = document.getElementById("checkInOutResultsContainer");
  resultsDiv.innerHTML = "";
  if (filtered.length === 0) {
    resultsDiv.innerHTML = "<em>No results found.</em>";
    return;
  }
  filtered.forEach(r => {
    const customer = customers.find(c => c.id === r.customerId);
    const div = document.createElement("div");
    div.className = "checkinout-item";
    div.style.cursor = "pointer";
    div.style.padding = "8px 12px";
    div.style.borderBottom = "1px solid #eee";
    div.innerHTML = `
      <strong>${escapeHTML(customer ? customer.name : "Unknown")}</strong> &nbsp; 
      <span>Room: ${r.roomNumber}</span> &nbsp; 
      <span>${type === "checkin" ? "Check-In" : "Check-Out"}: ${type === "checkin" ? r.arrivalDate : r.departureDate}</span> &nbsp; 
      <span>Duration: ${Math.max(1, Math.ceil((new Date(r.departureDate) - new Date(r.arrivalDate)) / (1000*60*60*24)))} nights</span>
    `;
    div.onclick = () => {
      alert(
        `Reservation Info:\n` +
        `Name: ${escapeHTML(customer ? customer.name : "Unknown")}\n` +
        `Phone: ${customer ? customer.telephone : ""}\n` +
        `Room: ${r.roomNumber}\n` +
        `Check-In: ${r.arrivalDate}\n` +
        `Check-Out: ${r.departureDate}\n` +
        `Nights: ${Math.max(1, Math.ceil((new Date(r.departureDate) - new Date(r.arrivalDate)) / (1000*60*60*24)))}\n`
      );
    };
    resultsDiv.appendChild(div);
  });
  };
}

document.getElementById("loadGridBtn")?.addEventListener("click", async () => {
  await renderAvailabilityGrid();
  // Switch to grid screen if grid was rendered successfully
  const grid = document.getElementById("availabilityGrid");
  if (grid && grid.innerHTML.trim()) {
    document.getElementById("availGridScreen1").style.display = "none";
    document.getElementById("availGridScreen2").style.display = "flex";
  }
});

// New Date button - switch back to date entry screen
document.getElementById("newDateBtn")?.addEventListener("click", () => {
  document.getElementById("availGridScreen2").style.display = "none";
  document.getElementById("availGridScreen1").style.display = "flex";
  document.getElementById("availabilityGrid").innerHTML = "";
});

document.getElementById("printReceiptsBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("printReceiptsModal");
  modal.style.display = "block";
  const modalContent = modal.querySelector(".modal-content");
  if (modalContent) {
    // Use proper CSS classes matching the theme
    modalContent.innerHTML = `
      <button class="close" aria-label="Close dialog" id="closePrintReceiptsModalBtn">&times;</button>
      <h2 class="modal-header-centered">🧾 Print Receipts</h2>
      
      <div class="radio-group" id="filterGroup">
        <label class="radio-option">
          <input type="radio" name="receiptFilter" value="today" checked>
          <span>Today</span>
        </label>
        <label class="radio-option">
          <input type="radio" name="receiptFilter" value="week">
          <span>This Week</span>
        </label>
        <label class="radio-option">
          <input type="radio" name="receiptFilter" value="month">
          <span>This Month</span>
        </label>
        <label class="radio-option">
          <input type="radio" name="receiptFilter" value="custom">
          <span>Custom Date Range</span>
        </label>
        <label class="radio-option">
          <input type="radio" name="receiptFilter" value="numberRange">
          <span>Receipt Number Range</span>
        </label>
      </div>
      
      <div id="customDateRange" class="date-range-container">
        <div class="date-range-row">
          <label>
            From:
            <input type="date" id="customStartDate">
          </label>
          <label>
            To:
            <input type="date" id="customEndDate">
          </label>
        </div>
      </div>
      
      <div id="numberRangeGroup" class="date-range-container">
        <label>Enter Receipt Number Range:</label>
        <div class="date-range-row">
          <input type="text" id="startReceiptNum" maxlength="5" placeholder="Start (e.g. 00001)">
          <span style="align-self:center;">—</span>
          <input type="text" id="endReceiptNum" maxlength="5" placeholder="End (e.g. 00005)">
        </div>
      </div>
      
      <div class="modal-footer">
        <button id="generateReceiptsBtn" class="btn btn-primary">🖨 Generate Receipts</button>
        <button id="closePrintReceiptsBtn" class="btn btn-secondary">Cancel</button>
      </div>
    `;
    
    // Radio button selection logic
    let selectedFilter = "today";
    const filterRadios = modalContent.querySelectorAll('input[name="receiptFilter"]');
    const customDateRange = modalContent.querySelector("#customDateRange");
    const numberRangeGroup = modalContent.querySelector("#numberRangeGroup");
    
    filterRadios.forEach(radio => {
      radio.addEventListener("change", () => {
        selectedFilter = radio.value;
        // Show/hide appropriate input groups
        customDateRange.style.display = selectedFilter === "custom" ? "block" : "none";
        numberRangeGroup.style.display = selectedFilter === "numberRange" ? "block" : "none";
      });
    });
    
    // Close button handlers
    modalContent.querySelector("#closePrintReceiptsModalBtn").onclick = () => {
      modal.style.display = "none";
    };
    modalContent.querySelector("#closePrintReceiptsBtn").onclick = () => {
      modal.style.display = "none";
    };
    
    // Generate Receipts button
    modalContent.querySelector("#generateReceiptsBtn").onclick = async () => {
      let startDate, endDate;
      const today = new Date();
      let filterByNumberRange = false;
      if (selectedFilter === "today") {
        startDate = endDate = today;
      } else if (selectedFilter === "week") {
        const first = today.getDate() - today.getDay();
        startDate = new Date(today.getFullYear(), today.getMonth(), first);
        endDate = new Date();
      } else if (selectedFilter === "month") {
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        endDate = new Date();
      } else if (selectedFilter === "custom") {
        startDate = new Date(modalContent.querySelector("#customStartDate").value);
        endDate = new Date(modalContent.querySelector("#customEndDate").value);
        if (isNaN(startDate) || isNaN(endDate)) {
          alert("Please select a valid date range.");
          return;
        }
      } else if (selectedFilter === "numberRange") {
        filterByNumberRange = true;
      }
      if (!filterByNumberRange) {
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
      }

      const paymentsSnap = await getDocs(collection(db, "payments"));
      const reservationsSnap = await getDocs(collection(db, "reservations"));
      const customersSnap = await getDocs(collection(db, "customers"));

      const reservations = Object.fromEntries(reservationsSnap.docs.map(d => [d.id, d.data()]));
      const customers = Object.fromEntries(customersSnap.docs.map(d => [d.id, d.data()]));

      let filtered = paymentsSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }));

      if (filterByNumberRange) {
        // Only filter by receipt number range
        const startNum = modalContent.querySelector("#startReceiptNum").value.trim();
        const endNum = modalContent.querySelector("#endReceiptNum").value.trim();
        if (startNum && endNum && /^\d{5}$/.test(startNum) && /^\d{5}$/.test(endNum)) {
          filtered = filtered.filter(p => {
            const num = p.receiptNumber;
            return num >= startNum && num <= endNum;
          });
        } else {
          alert("Please enter a valid 5-digit start and end receipt number.");
          return;
        }
      } else {
        // Filter by date range
        filtered = filtered.filter(p => {
          const normalizedTs = normalizeTimestamp(p.timestamp);
          if (!normalizedTs) return false;
          const ts = new Date(normalizedTs);
          return ts >= startDate && ts <= endDate;
        });
        // Optionally, if number range is filled, further filter
        const startNum = modalContent.querySelector("#startReceiptNum").value.trim();
        const endNum = modalContent.querySelector("#endReceiptNum").value.trim();
        if (startNum && endNum && /^\d{5}$/.test(startNum) && /^\d{5}$/.test(endNum)) {
          filtered = filtered.filter(p => {
            const num = p.receiptNumber;
            return num >= startNum && num <= endNum;
          });
        }
      }

      // Sort by receipt number ascending
      filtered.sort((a, b) => a.receiptNumber.localeCompare(b.receiptNumber));

      if (filtered.length === 0) {
        alert("No receipts found for the selected period.");
        return;
      }

      const receiptsPerPage = 8;
      const pages = Math.ceil(filtered.length / receiptsPerPage);
      let html = `<html><head><title>Glimbaro Guest House Receipts</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; padding: 0; margin: 0; background: #fff; }
          .brand-header {
            text-align: center;
            margin-bottom: 6px;
          }
          .brand-header h1 {
            margin: 0;
            font-size: 18px;
            letter-spacing: 1px;
          }
          .brand-header p {
            margin: 0;
            font-size: 11px;
            color: #555;
          }
          .receipt {
            border: 1.5px solid #2d2d2d;
            padding: 14px 18px;
            margin-bottom: 14px;
            border-radius: 10px;
            font-size: 15px;
            background: #fff;
            color: #222;
            width: 45%;
            min-width: 320px;
            max-width: 420px;
            display: inline-block;
            vertical-align: top;
            box-sizing: border-box;
            margin-right: 3%;
            box-shadow: 0 2px 8px rgba(0,0,0,0.10);
          }
          .receipt:nth-child(2n) { margin-right: 0; }
          h2 { text-align: center; margin-top: 12px; font-size: 16px; }
          .receipt strong { color: #2a4d7a; }
          @media print {
            @page { size: A4; margin: 8mm; }
            .receipt { page-break-inside: avoid; }
          }
        </style>
      </head><body>
        <div class="brand-header">
          <h1>Glimbaro Guest House</h1>
        </div>
        <h2>Receipt Summary</h2>`;

      // Build a lookup of ALL non-voided payments per reservation for accurate balance
      const allPaymentsList = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(pay => !pay.voided);
      const allPaymentsByRes = {};
      allPaymentsList.forEach(pay => {
        if (!allPaymentsByRes[pay.reservationId]) allPaymentsByRes[pay.reservationId] = [];
        allPaymentsByRes[pay.reservationId].push(pay);
      });

      for (let i = 0; i < pages; i++) {
        html += `<div style="width:100%; display:flex; flex-wrap:wrap; justify-content:center; gap:2.5%; margin-bottom:18px;">`;
        const slice = filtered.slice(i * receiptsPerPage, (i + 1) * receiptsPerPage);
        for (let p of slice) {
          const reservation = reservations[p.reservationId] || {};
          const customer = customers[p.customerId] || {};
          const arrivalRaw = reservation.arrivalDate || "-";
          const departureRaw = reservation.departureDate || "-";
          const arrival = arrivalRaw !== "-" ? formatDateDMY(arrivalRaw) : "-";
          const departure = departureRaw !== "-" ? formatDateDMY(departureRaw) : "-";
          // Use calculateSpecialNights for correct night count with special offers
          let nights = 1;
          try {
            nights = calculateSpecialNights(arrivalRaw, departureRaw);
          } catch (e) {
            try {
              const a = new Date(arrivalRaw);
              const d = new Date(departureRaw);
              nights = Math.max(1, Math.ceil((d - a) / (1000 * 60 * 60 * 24)));
            } catch (e2) {}
          }
          // Use ALL non-voided payments for this reservation (not just filtered batch)
          const resPayments = allPaymentsByRes[p.reservationId] || [];
          const totalPaid = resPayments.reduce((sum, pay) => sum + parseFloat(pay.amount || 0), 0) + calcCreditTotal(reservation.balanceCredits);
          // Use reservation.rate (not payment's rate) for consistent total
          const baseTotal = (parseFloat(reservation.rate) || parseFloat(p.rate) || 0) * nights;
          // Include balance adjustments
          const adjustments = reservation.balanceAdjustments || [];
          const totalAdjustment = calcAdjustmentTotal(adjustments);
          const totalDue = baseTotal + totalAdjustment;
          let balance = Math.max(0, totalDue - totalPaid);
          if (isNaN(balance)) balance = 0;
          const roomNumber = reservation.roomNumber || p.roomNumber || "-";
          let stayDuration = "-";
          if (arrival !== "-" && departure !== "-") {
            stayDuration = `${arrival} to ${departure} (${nights} night${nights > 1 ? 's' : ''})`;
          }
          
          // Check if voided
          const isVoided = p.voided === true;
          const receiptNumberDisplay = isVoided 
            ? `<div style="text-decoration:line-through;color:#888;"><strong>Receipt #:</strong> ${p.receiptNumber} <span style="color:#ef4444;font-weight:bold;text-decoration:none;">[VOIDED]</span></div>`
            : `<div><strong>Receipt #:</strong> ${p.receiptNumber}</div>`;
          const voidedNotice = isVoided 
            ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:6px;margin:8px 0;border-radius:4px;">
                <strong style="color:#ef4444;">⚠️ VOIDED</strong><br>
                <span style="font-size:0.85em;color:#666;">
                  ${p.voidedAt ? formatDateTimeDMY(p.voidedAt) : 'N/A'}
                  ${p.voidReason ? '<br>Reason: ' + p.voidReason : ''}
                </span>
              </div>`
            : '';
          
          html += `
          <div class="receipt">
            ${receiptNumberDisplay}
            ${voidedNotice}
            <div><strong>Customer Name:</strong> ${customer.name || "Unknown"}</div>
            <div><strong>Phone:</strong> ${customer.telephone || "-"}</div>
            <div><strong>Address:</strong> ${customer.address || "-"}</div>
            <div><strong>Room #:</strong> ${roomNumber}</div>
            <div><strong>Receipt Date:</strong> ${formatDateTimeDMY(p.timestamp)}</div>
            <div><strong>Stay Duration:</strong> ${stayDuration}</div>
            <div><strong>Payment Method:</strong> ${p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : 'Cash'}</div>
            <div><strong>Amount Paid:</strong> $${parseFloat(p.amount).toFixed(2)}</div>
            <div><strong>Balance:</strong> $${balance.toFixed(2)}</div>
          </div>`;
        }
        html += `</div>`;
        if (i < pages - 1) html += `<div style="page-break-after: always;"></div>`;
      }
      html += `</body></html>`;
      const win = window.open("", "_blank", "width=1000,height=800");
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
      win.close();
      modal.style.display = "none";
    };
    modalContent.querySelector("#closePrintReceiptsBtn").onclick = () => {
      modal.style.display = "none";
    };
  }
});
//print form
{
  const printRegistrationFormBtn = document.getElementById("printRegistrationFormBtn");
  if (printRegistrationFormBtn) printRegistrationFormBtn.onclick = () => {
    // Stamp exact print time on the form before printing
    const printTimestampEl = document.getElementById("formPrintTimestamp");
    if (printTimestampEl) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      printTimestampEl.textContent = `Printed: ${dd}/${mm}/${yyyy} ${hh}:${min}`;
    }
    window.print();
    setTimeout(() => {
      document.getElementById("registrationFormPreviewModal").style.display = "none";
    }, 500);
  };

  const cancelPreviewBtn = document.getElementById("cancelPreviewBtn");
  if (cancelPreviewBtn) cancelPreviewBtn.onclick = () => {
    document.getElementById("registrationFormPreviewModal").style.display = "none";
  };
}


document.getElementById("closePrintReceiptsBtn")?.addEventListener("click", () => {
  document.getElementById("printReceiptsModal").style.display = "none";
});

document.querySelectorAll("input[name='receiptFilter']").forEach(el => {
  el.addEventListener("change", () => {
    const isCustom = document.querySelector("input[name='receiptFilter']:checked").value === "custom";
    document.getElementById("customDateRange").style.display = isCustom ? "block" : "none";
  });
});

document.getElementById("generateReceiptsBtn")?.addEventListener("click", async () => {
  const filter = document.querySelector("input[name='receiptFilter']:checked").value;
  let startDate, endDate;
  const today = new Date();
  
  if (filter === "today") {
    startDate = endDate = today;
  } else if (filter === "week") {
    const first = today.getDate() - today.getDay();
    startDate = new Date(today.setDate(first));
    endDate = new Date();
  } else if (filter === "month") {
    startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    endDate = new Date();
  } else if (filter === "custom") {
    startDate = new Date(document.getElementById("customStartDate").value);
    endDate = new Date(document.getElementById("customEndDate").value);
    if (isNaN(startDate) || isNaN(endDate)) {
      alert("Please select a valid date range.");
      return;
    }
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  const paymentsSnap = await getDocs(collection(db, "payments"));
  const reservationsSnap = await getDocs(collection(db, "reservations"));
  const customersSnap = await getDocs(collection(db, "customers"));

  const reservations = Object.fromEntries(reservationsSnap.docs.map(d => [d.id, d.data()]));
  const customers = Object.fromEntries(customersSnap.docs.map(d => [d.id, d.data()]));

  const filtered = paymentsSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => {
      const normalizedTs = normalizeTimestamp(p.timestamp);
      if (!normalizedTs) return false;
      const ts = new Date(normalizedTs);
      return ts >= startDate && ts <= endDate;
    });

  if (filtered.length === 0) {
    alert("No receipts found for the selected period.");
    return;
  }

  const receiptsPerPage = 8;
  const pages = Math.ceil(filtered.length / receiptsPerPage);
  let html = `<html><head><title>Glimbaro Guest House Receipts</title>
    <style>
      body { font-family: 'Segoe UI', sans-serif; padding: 0; margin: 0; background: #fff; }
      .brand-header {
        text-align: center;
        margin-bottom: 6px;
      }
      .brand-header h1 {
        margin: 0;
        font-size: 18px;
        letter-spacing: 1px;
      }
      .brand-header p {
        margin: 0;
        font-size: 11px;
        color: #555;
      }
      .receipt {
        border: 1.5px solid #2d2d2d;
        padding: 14px 18px;
        margin-bottom: 14px;
        border-radius: 10px;
        font-size: 15px;
        background: #fff;
        color: #222;
        width: 45%;
        min-width: 320px;
        max-width: 420px;
        display: inline-block;
        vertical-align: top;
        box-sizing: border-box;
        margin-right: 3%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.10);
      }
      .receipt:nth-child(2n) { margin-right: 0; }
      h2 { text-align: center; margin-top: 12px; font-size: 16px; }
      .receipt strong { color: #2a4d7a; }
      @media print {
        @page { size: A4; margin: 8mm; }
        .receipt { page-break-inside: avoid; }
      }
    </style>
  </head><body>
    <div class="brand-header">
      <h1>Glimbaro Guest House</h1>
      <p>Comfort. Convenience. Care.</p>
    </div>
    <h2>Receipt Summary</h2>`;

  // Build a lookup of ALL non-voided payments per reservation for accurate balance
  const allPaymentsList = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(pay => !pay.voided);
  const allPaymentsByRes = {};
  allPaymentsList.forEach(pay => {
    if (!allPaymentsByRes[pay.reservationId]) allPaymentsByRes[pay.reservationId] = [];
    allPaymentsByRes[pay.reservationId].push(pay);
  });

  for (let i = 0; i < pages; i++) {
    // Center receipts on the page using flexbox
    html += `<div style="width:100%; display:flex; flex-wrap:wrap; justify-content:center; gap:2.5%; margin-bottom:18px;">`;
    const slice = filtered.slice(i * receiptsPerPage, (i + 1) * receiptsPerPage);

    for (let p of slice) {
      const reservation = reservations[p.reservationId] || {};
      const customer = customers[p.customerId] || {};
      const arrivalRaw = reservation.arrivalDate || "-";
      const departureRaw = reservation.departureDate || "-";
      const arrival = arrivalRaw !== "-" ? formatDateDMY(arrivalRaw) : "-";
      const departure = departureRaw !== "-" ? formatDateDMY(departureRaw) : "-";

      // Use calculateSpecialNights for correct night count with special offers
      let nights = 1;
      try {
        nights = calculateSpecialNights(arrivalRaw, departureRaw);
      } catch (e) {
        try {
          const a = new Date(arrivalRaw);
          const d = new Date(departureRaw);
          nights = Math.max(1, Math.ceil((d - a) / (1000 * 60 * 60 * 24)));
        } catch (e2) {}
      }
      // Use ALL non-voided payments for this reservation (not just filtered batch)
      const resPayments = allPaymentsByRes[p.reservationId] || [];
      const totalPaid = resPayments.reduce((sum, pay) => sum + parseFloat(pay.amount || 0), 0) + calcCreditTotal(reservation.balanceCredits);
      // Use reservation.rate (not payment's rate) for consistent total
      const baseTotal = (parseFloat(reservation.rate) || parseFloat(p.rate) || 0) * nights;
      // Include balance adjustments
      const adjustments = reservation.balanceAdjustments || [];
      const totalAdjustment = calcAdjustmentTotal(adjustments);
      const totalDue = baseTotal + totalAdjustment;
      let balance = Math.max(0, totalDue - totalPaid);
      if (isNaN(balance)) balance = 0;

      // Room number fix
      const roomNumber = reservation.roomNumber || p.roomNumber || "-";

      // Stay duration fix
      let stayDuration = "-";
      if (arrival !== "-" && departure !== "-") {
        stayDuration = `${arrival} to ${departure} (${nights} night${nights > 1 ? 's' : ''})`;
      }

      html += `
      <div class="receipt">
        <div><strong>Receipt #:</strong> ${p.receiptNumber}</div>
        <div><strong>Customer Name:</strong> ${customer.name || "Unknown"}</div>
        <div><strong>Phone:</strong> ${customer.telephone || "-"}</div>
        <div><strong>Address:</strong> ${customer.address || "-"}</div>
        <div><strong>Room #:</strong> ${roomNumber}</div>
        <div><strong>Receipt Date:</strong> ${formatDateTimeDMY(p.timestamp)}</div>
        <div><strong>Stay Duration:</strong> ${stayDuration}</div>
        <div><strong>Amount Paid:</strong> $${parseFloat(p.amount).toFixed(2)}</div>
        <div><strong>Balance:</strong> $${balance.toFixed(2)}</div>
      </div>`;
    }
    html += `</div>`;

    if (i < pages - 1) html += `<div style="page-break-after: always;"></div>`;
  }

  html += `</body></html>`;

  const win = window.open("", "_blank", "width=1000,height=800");
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  win.close();

  document.getElementById("printReceiptsModal").style.display = "none";
});

/**
 * Build receipts array with accurate point-in-time "Balance After" for each payment.
 * Uses the reservation's extension history to determine what the total cost was
 * at the time of each payment, so early payments don't show inflated balances
 * caused by later extensions.
 */
function buildReceiptsWithBalance(sortedPayments, reservation) {
  const currentRate = parseFloat(reservation.rate || 0);
  const arrivalDate = reservation.arrivalDate;
  const adjustmentTotal = calcAdjustmentTotal(reservation.balanceAdjustments);

  // Build a timeline of departure AND rate changes from extension history
  const extensions = (reservation.history || [])
    .filter(h => h.type === 'extended' && h.date && h.newDeparture)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Determine the original departure (before any extensions)
  const originalDeparture = extensions.length > 0
    ? extensions[0].previousDeparture
    : reservation.departureDate;

  // Determine the original rate (before any extensions changed it)
  const originalRate = (extensions.length > 0 && extensions[0].previousRate != null)
    ? parseFloat(extensions[0].previousRate)
    : currentRate;

  let cumulativePaid = 0;
  return sortedPayments.map(p => {
    const paymentTime = DateUtils.normalizeTimestamp(p.timestamp) || '';

    // Find the departure date AND rate that were active at this payment's time
    let activeDeparture = originalDeparture;
    let activeRate = originalRate;
    for (const ext of extensions) {
      if (ext.date <= paymentTime) {
        activeDeparture = ext.newDeparture;
        if (ext.rate != null) activeRate = parseFloat(ext.rate);
      }
    }

    const nights = calculateSpecialNights(arrivalDate, activeDeparture);
    const totalAtThisPoint = activeRate * nights + adjustmentTotal;
    cumulativePaid += parseFloat(p.amount || 0);
    const balanceAfter = Math.max(0, totalAtThisPoint - cumulativePaid);

    return {
      number: p.receiptNumber || "—",
      date: p.timestamp ? formatDateDMY(p.timestamp) : "—",
      amount: p.amount || "0.00",
      method: p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : 'N/A',
      balanceAfter: balanceAfter.toFixed(2),
    };
  });
}

//Generate FORM FUNCTION
function buildRegistrationFormHTML(reservation, customer, croppedImageDataURL, paymentSummary) {
  const room = reservation.roomNumber;
  const arrival = formatDateDMY(reservation.arrivalDate);
  const departure = formatDateDMY(reservation.departureDate);
  const totalPaid = paymentSummary.totalPaid.toFixed(2);
  const totalDue = paymentSummary.totalDue.toFixed(2);
  const balance = paymentSummary.balanceRemaining.toFixed(2);
  const rate = parseFloat(reservation.rate || 0);
  const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
  const printDate = formatDateTimeDMY(new Date().toISOString());
  
  // Credit entries to show on form (from reservation.balanceCredits)
  const creditsOnForm = (reservation.balanceCredits || []).filter(c => c.showOnForm !== false);
  const creditsTotalForForm = creditsOnForm.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
  
  // Get latest receipt info
  const latestReceipt = paymentSummary.receipts.length > 0 ? paymentSummary.receipts[paymentSummary.receipts.length - 1] : null;
  const receiptNumber = latestReceipt ? latestReceipt.number : 'N/A';
  const receiptDate = latestReceipt ? latestReceipt.date : formatDateDMY(new Date());
  const allReceiptNumbers = paymentSummary.receipts.map(r => r.number).join(', ') || 'N/A';
  const paymentMethods = [...new Set(paymentSummary.receipts.map(r => r.method))].filter(m => m && m !== 'N/A').join(', ') || 'N/A';
  const latestPaymentMethod = latestReceipt ? latestReceipt.method : 'N/A';
  
  // Check-in status
  const isCheckedIn = reservation.checkedIn || !!reservation.actualCheckInTime;
  const checkedInTime = reservation.actualCheckInTime ? formatDateTimeDMY(reservation.actualCheckInTime) : (reservation.checkedInTime ? formatDateTimeDMY(reservation.checkedInTime) : null);
  const isCheckedOut = reservation.checkedOut;
  const checkedOutTime = reservation.checkedOutTime ? formatDateTimeDMY(reservation.checkedOutTime) : null;

  // ============================================
  // SINGLE PAGE: Guest Registration + Tear-off Receipt
  // Dynamically compact when many receipts exist
  // ============================================
  const receiptCount = paymentSummary.receipts.length;
  const hasCredits = creditsOnForm.length > 0;
  const hasNote = !!reservation.note;
  // Compact when content is heavy: 4+ receipts, or 3+ receipts with credits/notes
  const isCompact = receiptCount > 3 || (receiptCount > 2 && (hasCredits || hasNote));
  const ledgerFont = receiptCount > 8 ? '7' : receiptCount > 5 ? '8' : isCompact ? '9' : '11';
  const ledgerPad = receiptCount > 5 ? '1px 2px' : isCompact ? '1px 3px' : '2px 3px';
  
  const page1 = `
    <div class="registration-form-page" style="font-family:Arial,sans-serif; font-size:${isCompact ? '11' : '13'}px; line-height:${isCompact ? '1.2' : '1.3'}; color:#000; background:white; padding:${isCompact ? '4px 14px' : '10px 18px'}; box-sizing:border-box; max-width:100%;">
      
      <!-- HEADER -->
      <h2 style="text-align:center; margin:0 0 ${isCompact ? '3' : '8'}px 0; font-size:${isCompact ? '17' : '22'}px; border-bottom:2px solid #2a4d7a; padding-bottom:${isCompact ? '2' : '6'}px;">
        Glimbaro Guest House - Registration Form
      </h2>

      <!-- GUEST INFO + ID IMAGE -->
      <div style="display:flex; justify-content:space-between; margin-bottom:${isCompact ? '4' : '10'}px; gap:12px;">
        <div style="flex:3; min-width:0;">
          <table style="width:100%; border-collapse:collapse; font-size:${isCompact ? '11' : '13'}px;">
            <tr>
              <td style="padding:${isCompact ? '2' : '4'}px 0; font-weight:bold; width:65px;">Guest:</td>
              <td style="padding:${isCompact ? '2' : '4'}px 0; border-bottom:1px solid #ccc; font-size:${isCompact ? '12' : '15'}px;">${escapeHTML(customer.name)}</td>
            </tr>
            <tr>
              <td style="padding:${isCompact ? '2' : '4'}px 0; font-weight:bold;">Address:</td>
              <td style="padding:${isCompact ? '2' : '4'}px 0; border-bottom:1px solid #ccc;">${escapeHTML(customer.address)}</td>
            </tr>
            <tr>
              <td style="padding:${isCompact ? '2' : '4'}px 0; font-weight:bold;">Phone:</td>
              <td style="padding:${isCompact ? '2' : '4'}px 0; border-bottom:1px solid #ccc;">${escapeHTML(customer.telephone)}</td>
            </tr>
            <tr>
              <td style="padding:${isCompact ? '2' : '4'}px 0; font-weight:bold;">Email:</td>
              <td style="padding:${isCompact ? '2' : '4'}px 0; border-bottom:1px solid #ccc;">${escapeHTML(customer.email || 'N/A')}</td>
            </tr>
            <tr>
              <td style="padding:${isCompact ? '2' : '4'}px 0; font-weight:bold;">Room:</td>
              <td style="padding:${isCompact ? '2' : '4'}px 0; border-bottom:1px solid #ccc; font-size:${isCompact ? '14' : '17'}px; font-weight:bold; color:#2a4d7a;">${room}</td>
            </tr>
          </table>
        </div>
        <div style="flex:2; min-width:0; border:2px solid #2a4d7a; border-radius:6px; height:${isCompact ? '110' : '145'}px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#f5f5f5;">
          ${croppedImageDataURL ? `<img src="${croppedImageDataURL}" alt="Guest ID" style="max-width:100%; max-height:100%; object-fit:contain;" />` : '<span style="color:#999; font-size:14px;">No ID</span>'}
        </div>
      </div>

      <!-- CHECK-IN/OUT TIMES -->
      <div style="display:flex; gap:${isCompact ? '6' : '10'}px; margin-bottom:${isCompact ? '3' : '8'}px;">
        <div style="flex:1; background:#e3f2fd; padding:${isCompact ? '3px 4px' : '8px'}; border-radius:6px; border:1px solid #2196f3; text-align:center;">
          <div style="font-size:${isCompact ? '8' : '11'}px; color:#666; font-weight:bold;">SCHEDULED CHECK-IN</div>
          <div style="font-size:${isCompact ? '11' : '15'}px; font-weight:bold; margin-top:2px;">${arrival} @ 3:00 PM</div>
          ${isCheckedIn ? `<div style="font-size:${isCompact ? '8' : '11'}px; color:#28a745; font-weight:bold; margin-top:1px;">CHECKED IN: ${checkedInTime}</div>` : ''}
        </div>
        <div style="flex:1; background:#fce4ec; padding:${isCompact ? '3px 4px' : '8px'}; border-radius:6px; border:1px solid #e91e63; text-align:center;">
          <div style="font-size:${isCompact ? '8' : '11'}px; color:#666; font-weight:bold;">SCHEDULED CHECK-OUT</div>
          <div style="font-size:${isCompact ? '11' : '15'}px; font-weight:bold; margin-top:2px;">${departure} @ 1:00 PM</div>
          ${isCheckedOut ? `<div style="font-size:${isCompact ? '8' : '11'}px; color:#dc3545; font-weight:bold; margin-top:1px;">CHECKED OUT: ${checkedOutTime}</div>` : ''}
        </div>
      </div>

      <!-- PAYMENT SUMMARY WITH RUNNING BALANCE -->
      <div style="background:#f8f9fa; padding:${isCompact ? '3px 5px' : '6px 8px'}; border-radius:6px; border:1px solid #dee2e6; margin-bottom:${isCompact ? '3' : '6'}px;">
        <div style="display:flex; justify-content:space-between; font-size:${isCompact ? '10' : '12'}px; margin-bottom:3px; padding-bottom:2px; border-bottom:1px solid #dee2e6;">
          <div><strong>Rate:</strong> $${rate.toFixed(2)}/night × ${nights} night${nights !== 1 ? 's' : ''}</div>
          <div><strong>Total Cost:</strong> $${totalDue}</div>
          <div><strong>Current Balance:</strong> <span style="color:${parseFloat(balance) > 0 ? '#dc3545' : '#28a745'}; font-weight:bold;">$${balance}</span></div>
        </div>
        
        <!-- PAYMENT LEDGER -->
        ${paymentSummary.receipts.length > 0 ? `
        <table style="width:100%; font-size:${ledgerFont}px; border-collapse:collapse;">
          <tr style="background:#2a4d7a; color:#fff;">
            <th style="padding:${ledgerPad}; text-align:left;">Receipt #</th>
            <th style="padding:${ledgerPad}; text-align:left;">Date</th>
            <th style="padding:${ledgerPad}; text-align:center;">Method</th>
            <th style="padding:${ledgerPad}; text-align:right;">Paid</th>
            <th style="padding:${ledgerPad}; text-align:right;">Balance After</th>
          </tr>
          ${(() => {
            const allR = paymentSummary.receipts;
            const MAX_MAIN = 5;
            if (allR.length > MAX_MAIN) {
              const hidden = allR.slice(0, allR.length - (MAX_MAIN - 1));
              const hiddenTotal = hidden.reduce((s, r) => s + parseFloat(r.amount), 0);
              const shown = allR.slice(allR.length - (MAX_MAIN - 1));
              return `
              <tr style="border-bottom:1px solid #dee2e6; background:#f0f0f0;">
                <td colspan="3" style="padding:${ledgerPad}; font-style:italic; color:#666;">${hidden.length} earlier payments</td>
                <td style="padding:${ledgerPad}; text-align:right; color:#28a745; font-weight:bold;">$${hiddenTotal.toFixed(2)}</td>
                <td style="padding:${ledgerPad}; text-align:right; color:#666;">—</td>
              </tr>` + shown.map(r => {
                const paidAmt = parseFloat(r.amount);
                const bal = parseFloat(r.balanceAfter || 0);
                return `
              <tr style="border-bottom:1px solid #dee2e6;">
                <td style="padding:${ledgerPad}; font-weight:bold;">${r.number}</td>
                <td style="padding:${ledgerPad};">${r.date}</td>
                <td style="padding:${ledgerPad}; text-align:center; text-transform:capitalize;">${r.method}</td>
                <td style="padding:${ledgerPad}; text-align:right; color:#28a745; font-weight:bold;">$${paidAmt.toFixed(2)}</td>
                <td style="padding:${ledgerPad}; text-align:right; color:${bal > 0 ? '#dc3545' : '#28a745'}; font-weight:bold;">$${bal.toFixed(2)}</td>
              </tr>`;
              }).join('');
            }
            return allR.map(r => {
            const paidAmt = parseFloat(r.amount);
            const bal = parseFloat(r.balanceAfter || 0);
            return `
              <tr style="border-bottom:1px solid #dee2e6;">
                <td style="padding:${ledgerPad}; font-weight:bold;">${r.number}</td>
                <td style="padding:${ledgerPad};">${r.date}</td>
                <td style="padding:${ledgerPad}; text-align:center; text-transform:capitalize;">${r.method}</td>
                <td style="padding:${ledgerPad}; text-align:right; color:#28a745; font-weight:bold;">$${paidAmt.toFixed(2)}</td>
                <td style="padding:${ledgerPad}; text-align:right; color:${bal > 0 ? '#dc3545' : '#28a745'}; font-weight:bold;">$${bal.toFixed(2)}</td>
              </tr>`;
          }).join('');
          })()}
        </table>
        ` : `<div style="font-size:11px; color:#999; text-align:center;">No payments recorded yet</div>`}
        
        ${creditsOnForm.length > 0 ? `
        <div style="margin-top:${isCompact ? '3' : '5'}px; padding:${isCompact ? '2px 4px' : '4px 6px'}; background:#e8f4fd; border:1px solid #90caf9; border-radius:4px;">
          <div style="font-size:${isCompact ? '9' : '11'}px; font-weight:bold; color:#2a4d7a; margin-bottom:2px;">Credits Applied:</div>
          ${creditsOnForm.map(c => `
            <div style="display:flex; justify-content:space-between; font-size:${isCompact ? '9' : '11'}px; padding:1px 0; border-bottom:1px dotted #ccc;">
              <span style="color:#555;">${escapeHTML(c.reason)}${c.timestamp ? ` <span style="font-size:0.8em;color:#999;">(${formatDateDMY(c.timestamp)})</span>` : ''}</span>
              <span style="color:#2a4d7a; font-weight:bold;">$${parseFloat(c.amount).toFixed(2)}</span>
            </div>
          `).join('')}
          <div style="text-align:right; font-size:${isCompact ? '9' : '11'}px; font-weight:bold; color:#2a4d7a; margin-top:2px;">Total Credits: $${creditsTotalForForm.toFixed(2)}</div>
        </div>
        ` : ''}
      </div>

      <!-- IMPORTANT INFORMATION -->
      <div style="padding:${isCompact ? '4px 6px' : '6px 8px'}; background:#fff3cd; border:1px solid #ffc107; border-radius:6px; margin-bottom:${isCompact ? '3' : '6'}px;">
        <h4 style="margin:0 0 2px 0; font-size:${isCompact ? '11' : '13'}px; color:#856404;">Important Information</h4>
        <ul style="margin:0; padding-left:16px; font-size:${isCompact ? '10' : '12'}px; color:#856404; line-height:${isCompact ? '1.3' : '1.5'};">
          <li>Check-in: <strong>3:00 PM</strong> | Check-out: <strong>1:00 PM</strong></li>
          <li>Guests are responsible for any damages or missing items</li>
          <li><strong>$10 USD</strong> security deposit required (returned when keys are returned)</li>
          <li>Management is not liable for valuables left in rooms</li>
          <li>All rates must be paid in advance | Extra persons: <strong>$10 USD</strong>/person/night</li>
          <li>Late checkout fee: <strong>20%</strong> of room rate per hour | <strong>No refunds</strong></li>
        </ul>
      </div>

      ${reservation.note ? `
      <div style="padding:${isCompact ? '2px 5px' : '4px 8px'}; background:#f8f9fa; border:1px solid #dee2e6; border-radius:4px; margin-bottom:${isCompact ? '3' : '6'}px;">
        <div style="font-size:${isCompact ? '9' : '11'}px; font-weight:bold; color:#333; margin-bottom:1px;">Notes:</div>
        <div style="font-size:${isCompact ? '9' : '11'}px; color:#555;">${escapeHTML(reservation.note)}</div>
      </div>
      ` : ''}

      <!-- SIGNATURES -->
      <div style="display:flex; justify-content:space-between; margin-bottom:${isCompact ? '3' : '6'}px;">
        <div style="width:45%;">
          <p style="margin:0 0 2px 0; font-weight:bold; font-size:${isCompact ? '10' : '13'}px;">Guest Signature:</p>
          <div style="border-bottom:2px solid #000; height:${isCompact ? '18' : '28'}px;"></div>
          <p style="margin:2px 0 0 0; font-size:${isCompact ? '8' : '11'}px; color:#666;">Date: ______________</p>
        </div>
        <div style="width:45%;">
          <p style="margin:0 0 2px 0; font-weight:bold; font-size:${isCompact ? '10' : '13'}px;">Receptionist:</p>
          <div style="border-bottom:2px solid #000; height:${isCompact ? '18' : '28'}px;"></div>
          <p style="margin:2px 0 0 0; font-size:${isCompact ? '8' : '11'}px; color:#666;">Date: ______________</p>
        </div>
      </div>

      <!-- FOOTER -->
      <div style="text-align:center; padding:${isCompact ? '2' : '5'}px 0; border-top:1px solid #ccc; font-size:${isCompact ? '8' : '11'}px; color:#666;">
        <strong>Glimbaro Guest House</strong> | Cayon Street, PO Box 457, Basseterre, St. Kitts | Tel: (869) 663-0777 | (869) 465-2935 | (869) 465-1786
        <br><span style="font-size:${isCompact ? '7' : '9'}px; color:#aaa;">Printed: ${printDate}</span>
      </div>

      <!-- TEAR-OFF LINE -->
      <div style="border-top:2px dashed #000; margin:${isCompact ? '3' : '6'}px 0; position:relative; page-break-before:auto;">
        <span style="position:absolute; top:-8px; left:15px; background:white; padding:0 8px; font-size:${isCompact ? '8' : '11'}px; font-weight:bold;">TEAR HERE - GUEST COPY</span>
      </div>

      <!-- TEAR-OFF RECEIPT -->
      <div style="border:2px solid #2a4d7a; border-radius:6px; padding:${isCompact ? '3px 5px' : '6px 8px'}; background:#f8f9fa; page-break-inside:avoid;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:${isCompact ? '2' : '4'}px;">
          <div>
            <strong style="font-size:${isCompact ? '12' : '15'}px; color:#2a4d7a;">Glimbaro Guest House</strong>
            <div style="font-size:${isCompact ? '8' : '10'}px; color:#666;">Cayon St, Basseterre | (869) 663-0777</div>
          </div>
          <div style="font-size:${isCompact ? '10' : '13'}px; font-weight:bold; color:#2a4d7a; text-align:right;">Payment Receipt<br><span style="font-size:${isCompact ? '9' : '11'}px; font-weight:normal;">Room ${room}</span></div>
        </div>
        
        <div style="display:flex; justify-content:space-between; font-size:${isCompact ? '9' : '12'}px; margin-bottom:${isCompact ? '2' : '4'}px;">
          <div><strong>Guest:</strong> ${escapeHTML(customer.name)}</div>
          <div><strong>Room:</strong> ${room}</div>
          <div><strong>Date:</strong> ${receiptDate}</div>
        </div>
        
        <div style="display:flex; justify-content:space-between; font-size:${isCompact ? '9' : '12'}px; margin-bottom:${isCompact ? '2' : '4'}px;">
          <div><strong>In:</strong> ${arrival} @ 3PM</div>
          <div><strong>Out:</strong> ${departure} @ 1PM</div>
          <div><strong>Rate:</strong> $${rate.toFixed(2)}/night × ${nights}</div>
        </div>
        
        <!-- PAYMENT LEDGER -->
        ${paymentSummary.receipts.length > 0 ? `
        <div style="margin:${isCompact ? '1' : '4'}px 0; padding:2px; background:#fff; border:1px solid #dee2e6; border-radius:4px;">
          <table style="width:100%; font-size:${ledgerFont}px; border-collapse:collapse;">
            <tr style="background:#2a4d7a; color:#fff;">
              <th style="padding:${ledgerPad}; text-align:left;">Receipt</th>
              <th style="padding:${ledgerPad}; text-align:right;">Paid</th>
              <th style="padding:${ledgerPad}; text-align:right;">Balance</th>
            </tr>
            ${(() => {
              const allR = paymentSummary.receipts;
              const MAX_TEAROFF = 3;
              if (allR.length > MAX_TEAROFF) {
                const hidden = allR.slice(0, allR.length - (MAX_TEAROFF - 1));
                const hiddenTotal = hidden.reduce((s, r) => s + parseFloat(r.amount), 0);
                const shown = allR.slice(allR.length - (MAX_TEAROFF - 1));
                return `
                <tr style="border-bottom:1px dotted #ccc; background:#f0f0f0;">
                  <td style="padding:${ledgerPad}; font-style:italic; color:#666;">${hidden.length} earlier payments</td>
                  <td style="padding:${ledgerPad}; text-align:right; color:#28a745; font-weight:bold;">$${hiddenTotal.toFixed(2)}</td>
                  <td style="padding:${ledgerPad}; text-align:right; color:#666;">—</td>
                </tr>` + shown.map(r => {
                  const paidAmt = parseFloat(r.amount);
                  const bal = parseFloat(r.balanceAfter || 0);
                  return `
                <tr style="border-bottom:1px dotted #ccc;">
                  <td style="padding:${ledgerPad};"><strong>#${r.number}</strong> <span style="font-size:${isCompact ? '7' : '9'}px;color:#666;">(${r.date})</span></td>
                  <td style="padding:${ledgerPad}; text-align:right; color:#28a745; font-weight:bold;">$${paidAmt.toFixed(2)}</td>
                  <td style="padding:${ledgerPad}; text-align:right; color:${bal > 0 ? '#dc3545' : '#28a745'}; font-weight:bold;">$${bal.toFixed(2)}</td>
                </tr>`;
                }).join('');
              }
              return allR.map(r => {
                const paidAmt = parseFloat(r.amount);
                const bal = parseFloat(r.balanceAfter || 0);
                return `
                <tr style="border-bottom:1px dotted #ccc;">
                  <td style="padding:${ledgerPad};"><strong>#${r.number}</strong> <span style="font-size:${isCompact ? '7' : '9'}px;color:#666;">(${r.date})</span></td>
                  <td style="padding:${ledgerPad}; text-align:right; color:#28a745; font-weight:bold;">$${paidAmt.toFixed(2)}</td>
                  <td style="padding:${ledgerPad}; text-align:right; color:${bal > 0 ? '#dc3545' : '#28a745'}; font-weight:bold;">$${bal.toFixed(2)}</td>
                </tr>`;
              }).join('');
            })()}
          </table>
        </div>
        ` : ''}
        
        ${creditsOnForm.length > 0 ? `
        <div style="margin:${isCompact ? '1' : '3'}px 0; font-size:${isCompact ? '8' : '10'}px; background:#e8f4fd; padding:${isCompact ? '2px 4px' : '3px 5px'}; border-radius:3px; border:1px solid #90caf9;">
          <strong style="color:#2a4d7a;">Credits:</strong>
          ${creditsOnForm.map(c => `<span style="margin-left:6px;">${escapeHTML(c.reason)}: <strong>$${parseFloat(c.amount).toFixed(2)}</strong></span>`).join(' |')}
        </div>
        ` : ''}
        
        <!-- FINAL TOTALS -->
        <div style="display:flex; justify-content:space-between; padding:${isCompact ? '2px 4px' : '4px 6px'}; background:#e8f5e9; border-radius:4px; font-size:${isCompact ? '9' : '12'}px;">
          <div><strong>Total Cost:</strong> $${totalDue}</div>
          <div><strong>Balance:</strong> <span style="color:${parseFloat(balance) > 0 ? '#dc3545' : '#28a745'}; font-weight:bold;">$${balance}</span></div>
        </div>
        ${isCheckedIn ? `<div style="text-align:center; margin-top:${isCompact ? '1' : '3'}px; font-size:${isCompact ? '8' : '11'}px; color:#28a745; font-weight:bold;">Checked In: ${checkedInTime}</div>` : ''}
        
        <div style="text-align:center; margin-top:${isCompact ? '1' : '4'}px; font-size:${isCompact ? '7' : '10'}px; color:#666;">
          Thank you for staying with us! | Tel: (869) 663-0777 | (869) 465-2936 | (869) 465-1786
          <br><span style="font-size:${isCompact ? '6' : '8'}px;color:#aaa;">Printed: ${printDate}</span>
        </div>
      </div>

    </div>
  `;

  /* ============================================
   * PAGE 2: BACK (Payment Ledger) - COMMENTED OUT FOR FUTURE DUPLEX PRINTING
   * ============================================
   *
  // Build 13 table rows
  let tableRows = '';
  let runningBalance = parseFloat(totalDue);

  for (let i = 0; i < 13; i++) {
    if (i < paymentSummary.receipts.length) {
      const receipt = paymentSummary.receipts[i];
      const payment = parseFloat(receipt.amount);
      const balanceAfter = Math.max(0, runningBalance - payment);
      
      tableRows += `
        <tr>
          <td style="padding:10px; border: 1px solid #dee2e6; text-align: center;">${receipt.date}</td>
          <td style="padding:10px; border:1px solid #dee2e6; text-align:center;">$${rate.toFixed(2)}</td>
          <td style="padding: 10px; border: 1px solid #dee2e6; text-align:center;">$${totalDue}</td>
          <td style="padding:10px; border:1px solid #dee2e6; text-align:center;">$${payment.toFixed(2)}</td>
          <td style="padding:10px; border:1px solid #dee2e6; text-align:center;">$${balanceAfter.toFixed(2)}</td>
          <td style="padding:10px; border:1px solid #dee2e6; text-align: center;">${receipt.number}</td>
        </tr>
      `;
      
      runningBalance = balanceAfter;
    } else {
      tableRows += `
        <tr>
          <td style="padding:10px; border:1px solid #dee2e6; height:35px;">&nbsp;</td>
          <td style="padding:10px; border:1px solid #dee2e6;">&nbsp;</td>
          <td style="padding:10px; border:1px solid #dee2e6;">&nbsp;</td>
          <td style="padding: 10px; border:1px solid #dee2e6;">&nbsp;</td>
          <td style="padding:10px; border: 1px solid #dee2e6;">&nbsp;</td>
          <td style="padding:10px; border:1px solid #dee2e6;">&nbsp;</td>
        </tr>
      `;
    }
  }

  const page2 = `
    <div class="registration-form-page" style="width:8.5in; height:11in; padding: 0.5in; box-sizing:border-box;">
      <div style="font-family:Arial, sans-serif; font-size:13px; color:#000;">
        <h2 style="text-align:center; margin:0 0 20px 0; font-size: 20px; border-bottom:2px solid #2a4d7a; padding-bottom:8px;">
          Payment Ledger
        </h2>

        <div style="margin-bottom:16px; padding:12px; background:#f8f9fa; border-radius:6px; border:1px solid #dee2e6;">
          <div style="display:flex; justify-content:space-between; font-size:14px;">
            <div><strong>Guest: </strong> ${escapeHTML(customer.name)}</div>
            <div><strong>Room:</strong> ${room}</div>
            <div><strong>Stay:</strong> ${arrival} to ${departure}</div>
          </div>
        </div>

        <table style="width:100%; border-collapse:collapse; margin-bottom: 20px; border:2px solid #2a4d7a;">
          <thead>
            <tr style="background:#2a4d7a; color: white;">
              <th style="padding: 12px; border:1px solid #2a4d7a; text-align:center; font-weight:bold;">Date</th>
              <th style="padding:12px; border: 1px solid #2a4d7a; text-align:center; font-weight:bold;">Room Cost</th>
              <th style="padding:12px; border:1px solid #2a4d7a; text-align: center; font-weight:bold;">Total</th>
              <th style="padding:12px; border:1px solid #2a4d7a; text-align: center; font-weight:bold;">Payment</th>
              <th style="padding:12px; border:1px solid #2a4d7a; text-align: center; font-weight:bold;">Balance</th>
              <th style="padding:12px; border:1px solid #2a4d7a; text-align:center; font-weight: bold;">Receipt No.</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>

        <div style="margin-top:20px; padding:16px; background:#f8f9fa; border-radius:6px; border:2px solid #2a4d7a;">
          <div style="display:flex; justify-content:space-around; font-size:16px; font-weight:bold;">
            <div>Total Cost:  <span style="color:#2a4d7a;">$${totalDue}</span></div>
            <div>Total Paid: <span style="color:#28a745;">$${totalPaid}</span></div>
            <div>Balance: <span style="color: ${parseFloat(balance) > 0 ? '#dc3545' : '#28a745'};">$${balance}</span></div>
          </div>
        </div>

        <div style="margin-top:25px;">
          <h4 style="margin:0 0 10px 0; font-size:14px;">Additional Notes:</h4>
          <div style="border: 1px solid #ccc; min-height:80px; padding: 10px; border-radius:4px; background: white;">
            ${reservation.note ? escapeHTML(reservation.note) : '<em style="color:#999;">No additional notes</em>'}
          </div>
        </div>

        <div style="text-align:center; margin-top:25px; padding-top:12px; border-top:1px solid #ccc; font-size: 11px; color:#666;">
          <strong>Glimbaro Guest House</strong> | Cayon Street, Basseterre, St. Kitts | Tel: (869) 663-0777
        </div>
      </div>
    </div>
  `;
  * END OF PAGE 2 COMMENT - Uncomment when duplex printing is available
  */

  // Return ONLY page 1 (single page)
  return page1;
}




//PRINT
{
  const printReservationBtn = document.getElementById("printReservationBtn");
  if (printReservationBtn) printReservationBtn.onclick = async () => {
    if (!currentReservation) return;
    const customer = customers.find(c => c.id === currentReservation.customerId) || {};
    await showFormPreview(currentReservation, customer, customer.idImageUrl || null);
  };
}


// CHECK-IN CONFIRMATION POPUP (replaces SMS popup)
function showCheckInConfirmationPopup(reservation, customer, receiptNumber, amountPaid, balance, duration) {
  const modal = document.getElementById("checkInConfirmationModal");
  const content = document.getElementById("checkInSummaryContent");

  const nights = duration;
  const total = (parseFloat(amountPaid) + parseFloat(balance)).toFixed(2);

  content.innerHTML = `
    <p><strong>Guest:</strong> ${escapeHTML(customer.name)}</p>
    <p><strong>Room:</strong> ${reservation.roomNumber}</p>
    <p><strong>Check-In Date:</strong> ${formatDateDMY(reservation.arrivalDate)}</p>
    <p><strong>Check-Out Date:</strong> ${formatDateDMY(reservation.departureDate)}</p>
    <p><strong>Duration:</strong> ${nights} night(s)</p>
    <p><strong>Receipt #:</strong> ${receiptNumber}</p>
    <p><strong>Amount Paid:</strong> $${parseFloat(amountPaid).toFixed(2)}</p>
    <p><strong>Balance:</strong> $${parseFloat(balance).toFixed(2)}</p>
  `;

  ModalManager.open('checkInConfirmationModal');

  // Handle "Yes, Checking In Now" button
  document.getElementById("confirmCheckInNowBtn").onclick = async () => {
    const now = new Date();
    const actualCheckInTime = now.toISOString();
    
    try {
      // Update reservation with actual check-in time
      await updateDoc(doc(db, "reservations", reservation.id), {
        actualCheckInTime: actualCheckInTime,
        checkedIn: true,
        checkedInBy: currentEmployee?.uid || null,
        checkedInByName: currentEmployee?.name || 'Unknown'
      });
      
      // Audit log
      await auditLog(AUDIT_ACTIONS.RESERVATION_UPDATE, {
        action: 'check_in',
        reservationId: reservation.id,
        roomNumber: reservation.roomNumber,
        customerName: customer.name,
        actualCheckInTime: actualCheckInTime
      }, 'reservation', reservation.id);
      
      alert(`Guest checked in at ${now.toLocaleTimeString()}`);
      ModalManager.close('checkInConfirmationModal');
      ModalManager.open('registrationPromptModal');
    } catch (err) {
      console.error("Check-in error:", err);
      alert("Failed to record check-in time.");
    }
  };

  // Handle "No, Not Yet" button - skip check-in but continue flow
  document.getElementById("skipCheckInBtn").onclick = () => {
    ModalManager.close('checkInConfirmationModal');
    ModalManager.open('registrationPromptModal');
  };

  // Handle close button
  const closeBtn = document.getElementById("closeCheckInConfirmationBtn");
  if (closeBtn) {
    closeBtn.onclick = () => {
      ModalManager.close('checkInConfirmationModal');
      ModalManager.open('registrationPromptModal');
    };
  }
}

// ============================================================================
// SECTION: SMS & CHECK-IN CONFIRMATION
// ============================================================================
/**
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                    GUEST NOTIFICATION SYSTEM                                │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │  After a payment is recorded, the system can optionally:                    │
 * │  1. Confirm check-in (mark actualCheckInTime)                              │
 * │  2. Send SMS confirmation to guest's phone                                  │
 * │                                                                             │
 * │  SMS INTEGRATION:                                                           │
 * │  SMS messages are sent via the Render backend API which uses Twilio.       │
 * │  The backend handles Twilio credentials and message delivery.              │
 * │                                                                             │
 * │  POST-PAYMENT FLOW:                                                         │
 * │  ┌─────────────────────────────────────────────────────────────────────┐   │
 * │  │  Payment Confirmed                                                  │   │
 * │  │         ↓                                                           │   │
 * │  │  Check-In Confirmation Popup                                        │   │
 * │  │     ├─ "Confirm Check-In" → Mark as checked in                     │   │
 * │  │     └─ "Not Yet" → Skip check-in                                   │   │
 * │  │         ↓                                                           │   │
 * │  │  Registration Form / ID Upload Flow                                 │   │
 * │  └─────────────────────────────────────────────────────────────────────┘   │
 * │                                                                             │
 * │  Note: The original SMS popup has been replaced with a check-in             │
 * │  confirmation popup. SMS sending can be triggered elsewhere if needed.      │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Legacy SMS popup - now redirects to check-in confirmation.
 * 
 * This function was originally used to prompt staff to send an SMS
 * confirmation to the guest. It has been replaced with a check-in
 * confirmation workflow but is kept for backward compatibility.
 * 
 * @param {Object} reservation - Reservation document
 * @param {Object} customer - Customer document
 * @param {string} receiptNumber - Receipt number from payment
 * @param {number} amountPaid - Amount just paid
 * @param {number} balance - Remaining balance due
 * @param {number} duration - Number of nights
 */
function showSMSConfirmationPopup(reservation, customer, receiptNumber, amountPaid, balance, duration) {
  // Redirect to new check-in confirmation popup
  showCheckInConfirmationPopup(reservation, customer, receiptNumber, amountPaid, balance, duration);
}

// ============================================================================
// SECTION: INVOICE GENERATION
// ============================================================================
/**
 * Generates a printable HTML invoice for a reservation.
 * 
 * Invoice includes:
 * - Guest contact information
 * - Reservation details (dates, room, nights)
 * - Itemized payment history
 * - Total cost, amount paid, and balance due
 * - Guesthouse policies and disclaimer
 * 
 * @param {Object} customer - Customer document with name, email, phone, address
 * @param {Object} reservation - Reservation document
 * @param {Array<Object>} selectedPayments - Array of payment documents to include
 * @param {number} totalCost - Total cost of the reservation
 * @returns {string} HTML string for the invoice
 */
function generateInvoiceHTML(customer, reservation, selectedPayments, totalCost) {
  // Calculate totals
  const totalPaid = selectedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) + calcCreditTotal(reservation?.balanceCredits);
  const balance = Math.max(0, totalCost - totalPaid);

  // Build payment rows HTML
  const receiptList = selectedPayments.map(p => `
    <tr>
      <td>${p.receiptNumber}</td>
      <td>${formatDateDMY(p.timestamp)}</td>
      <td>$${parseFloat(p.amount).toFixed(2)}</td>
    </tr>
  `).join("");

  // Return complete invoice HTML
  return `
    <div style="font-family:'Courier New', Courier, monospace; font-size: 14px; width: 8in; margin: auto;">
      <h2 style="text-align:center; border-bottom:1px dashed #aaa; padding-bottom:10px;">🧾 Official Receipt</h2>
      <p><strong>Guest:</strong> ${customer.name || ""}</p>
      <p><strong>Email:</strong> ${customer.email || ""}</p>
      <p><strong>Phone:</strong> ${customer.phone || ""}</p>
      <p><strong>Address:</strong> ${customer.address || ""}</p>

      <hr style="border: none; border-top: 1px dashed #ccc;" />

      <table style="width:100%; border-collapse: collapse;">
        <tr><td><strong>Reservation ID</strong></td><td>${reservation.id}</td></tr>
        <tr><td><strong>Check-In</strong></td><td>${formatDateDMY(reservation.arrivalDate)}</td></tr>
        <tr><td><strong>Check-Out</strong></td><td>${formatDateDMY(reservation.departureDate)}</td></tr>
        <tr><td><strong>Room</strong></td><td>${reservation.roomNumber}</td></tr>
      </table>

      <hr style="border: none; border-top: 1px dashed #ccc;" />

      <table style="width:100%; border-collapse: collapse;">
        <tr><td><strong>Total Amount</strong></td><td>$${totalCost.toFixed(2)}</td></tr>
        <tr><td><strong>Total Paid</strong></td><td>$${totalPaid.toFixed(2)}</td></tr>
        <tr><td><strong>Balance Due</strong></td><td>$${balance.toFixed(2)}</td></tr>
        <tr><td><strong>Notes</strong></td><td>${escapeHTML(reservation.note || 'None')}</td></tr>

      </table>

      <hr style="border: none; border-top: 1px dashed #ccc;" />

      <h4>Payments:</h4>
      <table style="width:100%; border-collapse: collapse; border: 1px solid #ccc;">
        <thead>
          <tr style="background-color:#f0f0f0;">
            <th style="text-align:left; padding:5px;">Receipt #</th>
            <th style="text-align:left; padding:5px;">Date</th>
            <th style="text-align:right; padding:5px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${receiptList}
        </tbody>
      </table>

      <p style="font-size:12px; color:#444; margin-top:20px;">
        <strong>Disclaimer:</strong><br>
        Guest is liable for damages or losses. Rates are payable in advance. No refunds.<br>
        <strong>Check-in:</strong> 3:00 PM  <strong>Check-out:</strong> 1:00 PM
      </p>
    </div>
  `;
}

// ===========================================================================
// SPECIAL OFFERS - Night Calculation
// ===========================================================================
// Calculate the number of nights for a stay
// ===========================================================================

function calculateSpecialNights(arrival, departure, offer) {
  // Calculate total nights of the stay (offer parameter kept for backward compatibility but not used)
  const start = new Date(arrival);
  const end = new Date(departure);
  return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
}

// When user selects arrival date, auto-calculate departure display
function getAdjustedDepartureDate(arrivalDate, offerCode) {
  return null; // No longer used
}

// For extending stays - validate extension length
function calculateSpecialNightsForExtension(currentDeparture, newDeparture, offer) {
  const start = new Date(currentDeparture);
  const end = new Date(newDeparture);
  const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return diff > 0; // Any positive extension is valid
}
{
  const summaryBtn = document.getElementById("summaryBtn");
  if (summaryBtn) summaryBtn.onclick = () => {
    window.location.href = 'reports.html';
  };

  const closeSummaryModal = document.getElementById("closeSummaryModal");
  if (closeSummaryModal) closeSummaryModal.onclick = () => {
    ModalManager.close('summaryModal');
  };

  const summaryRange = document.getElementById("summaryRange");
  if (summaryRange) summaryRange.onchange = (e) => {
    const val = e.target.value;
    const isCustom = val === "custom";
    document.getElementById("summaryStartGroup").style.display = isCustom ? "block" : "none";
    document.getElementById("summaryEndGroup").style.display = isCustom ? "block" : "none";
  };
}

{
  const loadSummaryBtn = document.getElementById("loadSummaryBtn");
  if (loadSummaryBtn) {
    loadSummaryBtn.onclick = async () => {
      const range = document.getElementById("summaryRange").value;
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      
      let startDate, endDate;

      switch (range) {
        case "day":
          startDate = today;
          endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
          break;
        case "week":
          startDate = new Date(today);
          startDate.setDate(startDate.getDate() - startDate.getDay());
          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 6);
          endDate.setHours(23, 59, 59, 999);
          break;
        case "month":
          startDate = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
          endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
          break;
        case "lastMonth":
          startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1, 0, 0, 0, 0);
          endDate = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
          break;
        case "custom":
          const customStart = document.getElementById("summaryStart").value;
          const customEnd = document.getElementById("summaryEnd").value;
          if (!customStart || !customEnd) {
            alert("Please select both start and end dates.");
            return;
          }
          const [sy, sm, sd] = customStart.split('-').map(Number);
          const [ey, em, ed] = customEnd.split('-').map(Number);
          startDate = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
          endDate = new Date(ey, em - 1, ed, 23, 59, 59, 999);
          break;
        case "outstanding":
          await loadSummary(null, null, "outstanding");
          return;
        default:
          startDate = today;
          endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      }

      await loadSummary(startDate, endDate, range);
    };
  }
}

/**
 * Load Summary Report
 * Generates a table of reservations filtered by date range or outstanding balance.
 *
 * CONSISTENCY RULES:
 * - Voided payments are ALWAYS excluded (both p.voided AND p.qbSyncStatus === 'voided')
 * - Every row shows the FULL reservation financials (Total Due / Total Paid / Balance)
 * - Footer totals are the EXACT sum of every visible row's columns
 * - Total Due - Total Paid = Outstanding Balance (always)
 * - Filter logic determines WHICH reservations appear, not partial amounts
 *
 * FILTER BEHAVIOR:
 * - day         : reservations created today OR that received a payment today
 * - week        : reservations whose stay overlaps the current week
 * - month       : reservations whose stay overlaps the current month
 * - lastMonth   : reservations whose stay overlaps last month
 * - custom      : reservations whose stay overlaps the custom date range
 * - outstanding : reservations with a balance > 0
 */
async function loadSummary(startDate, endDate, range) {
  const tbody = document.querySelector("#summaryTable tbody");
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="16" style="text-align:center;padding:24px;color:var(--text-muted);">Loading report...</td></tr>';

  // ─── DATE HELPERS ─────────────────────────────────────────────────────────
  const toLocalDateStr = (d) => {
    if (!d) return null;
    const date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  };

  const parseTimestamp = (ts) => {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (ts instanceof Date) return ts;
    if (typeof ts === 'string') { const d = new Date(ts); return isNaN(d.getTime()) ? null : d; }
    return null;
  };

  const startStr    = toLocalDateStr(startDate);
  const endStr      = toLocalDateStr(endDate);
  const isDateRange = !!(startStr && endStr);

  // ─── FRESH PAYMENT DATA ───────────────────────────────────────────────────
  // Always fetch from Firestore — financial reports must be accurate, never stale.
  let allPayments = [];
  try {
    const paySnap = await getDocs(collection(db, 'payments'));
    allPayments = paySnap.docs.map(d => ({ id: d.id, ...d.data() }));
    window._allPaymentsCache = allPayments; // keep cache in sync
  } catch (fetchErr) {
    console.warn('[Report] Fresh payment fetch failed, using cache:', fetchErr);
    allPayments = window._allPaymentsCache || [];
  }

  // ─── TRIPLE VOID CHECK ────────────────────────────────────────────────────
  // Exclude a payment if ANY of these three flags marks it as voided.
  const validPayments = allPayments.filter(p =>
    !p.voided &&
    p.qbSyncStatus !== 'voided' &&
    p.status       !== 'voided'
  );

  // ─── RESERVATIONS ─────────────────────────────────────────────────────────
  const reservations = window._reservationsCache || await loadReservations();

  // ─── EMPLOYEE NAMES ───────────────────────────────────────────────────────
  const employeeNames = {};
  try {
    const empSnap = await getDocs(collection(db, 'employees'));
    empSnap.forEach(d => { employeeNames[d.id] = d.data().name || 'Unknown'; });
  } catch (err) { console.warn('[Report] Could not load employee names:', err); }

  // ─── INDEX PAYMENTS (O(n) once, O(1) per reservation lookup) ─────────────
  // allTimePayByRes : reservationId -> all valid non-voided payments ever
  // periodPayByRes  : reservationId -> valid payments dated within startStr..endStr
  const allTimePayByRes = new Map();
  const periodPayByRes  = new Map();

  for (const p of validPayments) {
    if (!p.reservationId) continue;

    if (!allTimePayByRes.has(p.reservationId)) allTimePayByRes.set(p.reservationId, []);
    allTimePayByRes.get(p.reservationId).push(p);

    if (isDateRange) {
      const payStr = toLocalDateStr(parseTimestamp(p.timestamp));
      if (payStr && payStr >= startStr && payStr <= endStr) {
        if (!periodPayByRes.has(p.reservationId)) periodPayByRes.set(p.reservationId, []);
        periodPayByRes.get(p.reservationId).push(p);
      }
    }
  }

  // ─── FOOTER ACCUMULATORS ──────────────────────────────────────────────────
  let sumTotalDue    = 0;
  let sumAllTimePaid = 0;
  let sumPeriodRev   = 0; // matches QuickBooks P&L: receipts dated IN the period only
  let sumBalance     = 0;

  // ─── BUILD ROWS ───────────────────────────────────────────────────────────
  tbody.innerHTML = '';

  for (const reservation of reservations) {
    const resAllTimePays = allTimePayByRes.get(reservation.id) || [];
    const resPeriodPays  = periodPayByRes.get(reservation.id)  || [];

    // Financials
    const nights          = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
    const rate            = parseFloat(reservation.rate) || 0;
    const baseTotal       = rate * nights;
    const adjustments     = reservation.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    const totalDue    = baseTotal + totalAdjustment;
    const actualAllTimePaid = resAllTimePays.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const creditTotal = calcCreditTotal(reservation.balanceCredits);
    const allTimePaid = actualAllTimePaid + creditTotal;
    const periodPaid  = resPeriodPays.reduce( (s, p) => s + (parseFloat(p.amount) || 0), 0);
    const balance     = Math.max(0, totalDue - allTimePaid);

    // ── Filter ──────────────────────────────────────────────────────────────
    let include = false;
    if (range === 'outstanding') {
      include = balance > 0;
    } else if (range === 'day') {
      const createdStr = toLocalDateStr(parseTimestamp(reservation.createdAt));
      include = (createdStr === startStr) || periodPayByRes.has(reservation.id);
    } else if (isDateRange) {
      const arrStr = reservation.arrivalDate;
      const depStr = reservation.departureDate;
      include = (arrStr && depStr && arrStr <= endStr && depStr >= startStr) || periodPayByRes.has(reservation.id);
    }
    if (!include) continue;

    // ── Customer ────────────────────────────────────────────────────────────
    const customer      = customers.find(c => c.id === reservation.customerId);
    const customerName  = customer?.name      || 'Unknown';
    const customerPhone = customer?.telephone || '\u2014';

    // ── Receipts column: period receipts first, then all-time count ──────────
    const sortByTime = (a, b) => (a.timestamp || '').localeCompare(b.timestamp || '');
    const periodNums   = [...resPeriodPays].sort(sortByTime).map(p => p.receiptNumber).filter(Boolean);
    const allTimeNums  = [...resAllTimePays].sort(sortByTime).map(p => p.receiptNumber).filter(Boolean);
    let receiptsDisplay = '\u2014';
    if (isDateRange && periodNums.length > 0) {
      receiptsDisplay = periodNums.join(', ');
      const extra = allTimeNums.length - periodNums.length;
      if (extra > 0) receiptsDisplay += ` <span style="color:var(--text-muted);font-size:0.8em;">(+${extra} other)</span>`;
    } else if (allTimeNums.length > 0) {
      receiptsDisplay = allTimeNums.join(', ');
    }

    // ── Status ──────────────────────────────────────────────────────────────
    let displayStatus = 'Unpaid';
    let statusColor   = '#ef4444';
    if      (allTimePaid >= totalDue && totalDue > 0) { displayStatus = 'Fully Paid'; statusColor = '#10b981'; }
    else if (allTimePaid > 0)                          { displayStatus = 'Partial';    statusColor = '#f59e0b'; }

    const checkStatusInfo = StatusUtils.formatCheckStatus(reservation);
    const numGuests = reservation.numGuests || reservation.guests || reservation.numberOfGuests || 1;

    // ── Creator ─────────────────────────────────────────────────────────────
    let creatorName = '\u2014';
    if      (reservation.createdByName  && reservation.createdByName  !== 'Unknown') creatorName = reservation.createdByName;
    else if (reservation.createdBy      && employeeNames[reservation.createdBy])     creatorName = employeeNames[reservation.createdBy];
    else if (reservation.recordedByName && reservation.recordedByName !== 'Unknown') creatorName = reservation.recordedByName;
    else if (reservation.createdBy)                                                  creatorName = `(ID: ${reservation.createdBy.substring(0,8)}...)`;

    // ── Notes ───────────────────────────────────────────────────────────────
    let notes = escapeHTML(reservation.note || reservation.notes || '\u2014');
    if (notes.length > 30) notes = notes.substring(0, 30) + '...';

    // ── Row HTML ────────────────────────────────────────────────────────────
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space:nowrap;"><strong>${customerName}</strong></td>
      <td style="white-space:nowrap;">${customerPhone}</td>
      <td style="text-align:center;font-weight:bold;">${reservation.roomNumber || '\u2014'}</td>
      <td style="white-space:nowrap;">${formatDateDMY(reservation.arrivalDate)}</td>
      <td style="white-space:nowrap;">${formatDateDMY(reservation.departureDate)}</td>
      <td style="text-align:center;">${nights}</td>
      <td style="text-align:center;">${numGuests}</td>
      <td style="text-align:right;">$${rate.toFixed(2)}</td>
      <td style="text-align:right;">$${totalDue.toFixed(2)}</td>
      <td style="text-align:right;color:var(--text-secondary);">$${allTimePaid.toFixed(2)}</td>
      <td style="text-align:right;font-weight:600;color:${periodPaid > 0 ? '#10b981' : 'var(--text-muted)'};">${isDateRange ? '$'+periodPaid.toFixed(2) : '\u2014'}</td>
      <td style="text-align:right;color:${balance > 0 ? '#ef4444' : '#10b981'};font-weight:600;">$${balance.toFixed(2)}</td>
      <td style="white-space:nowrap;">
        <span style="color:${statusColor};font-weight:500;">${displayStatus}</span>
        <span style="color:${checkStatusInfo.color};font-size:0.85em;">${checkStatusInfo.text !== 'Pending' ? ' \u00b7 ' + checkStatusInfo.text : ''}</span>
      </td>
      <td style="font-size:0.85em;">${receiptsDisplay}</td>
      <td style="font-size:0.85em;">${creatorName}</td>
      <td style="font-size:0.85em;max-width:150px;overflow:hidden;text-overflow:ellipsis;" title="${escapeHTML(reservation.note || '')}">${notes}</td>
    `;
    tbody.appendChild(tr);

    // Accumulators — every value matches exactly what is displayed in its column
    sumTotalDue    += totalDue;
    sumAllTimePaid += allTimePaid;
    sumPeriodRev   += periodPaid;
    sumBalance     += balance;
  }

  // ─── FOOTER ───────────────────────────────────────────────────────────────
  const footer = document.getElementById('summaryFooter');
  if (!footer) return;

  const rowCount    = tbody.children.length;
  const periodLabel = range === 'outstanding'
    ? 'Outstanding Balances'
    : (isDateRange ? `${formatDateDMY(startStr)} \u2013 ${formatDateDMY(endStr)}` : 'Today');

  footer.innerHTML = `
    <div style="margin-top:16px;">

      ${isDateRange && range !== 'outstanding' ? `
      <div style="background:#4f46e5;border-radius:8px;padding:18px 24px;margin-bottom:14px;color:#fff;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-size:11px;font-weight:600;opacity:0.85;text-transform:uppercase;letter-spacing:0.6px;">Revenue Received \u2014 ${periodLabel}</div>
          <div style="font-size:42px;font-weight:800;margin:4px 0;line-height:1;">$${sumPeriodRev.toFixed(2)}</div>
          <div style="font-size:11px;opacity:0.75;">Valid non-voided receipts dated within this period. Matches QuickBooks P&amp;L.</div>
        </div>
        <div style="font-size:64px;font-weight:900;opacity:0.15;line-height:1;user-select:none;">$</div>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">

        <div style="padding:12px 14px;background:var(--bg-secondary);border-radius:8px;border-top:3px solid var(--accent-primary);">
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Reservations</div>
          <div style="font-size:28px;font-weight:700;color:var(--text-primary);margin-top:2px;">${rowCount}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Shown for period</div>
        </div>

        <div style="padding:12px 14px;background:var(--bg-secondary);border-radius:8px;border-top:3px solid var(--accent-primary);">
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Total Cost</div>
          <div style="font-size:28px;font-weight:700;color:var(--text-primary);margin-top:2px;">$${sumTotalDue.toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Total cost of shown reservations</div>
        </div>

        <div style="padding:12px 14px;background:var(--bg-secondary);border-radius:8px;border-top:3px solid #6b7280;">
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Paid (All-time)</div>
          <div style="font-size:28px;font-weight:700;color:#10b981;margin-top:2px;">$${sumAllTimePaid.toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">All payments ever on shown reservations</div>
        </div>

        <div style="padding:12px 14px;background:var(--bg-secondary);border-radius:8px;border-top:3px solid #ef4444;">
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Outstanding Balance</div>
          <div style="font-size:28px;font-weight:700;color:#ef4444;margin-top:2px;">$${sumBalance.toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Still owed on shown reservations</div>
        </div>

      </div>
    </div>
  `;

  console.log('[Report]', { range, period: periodLabel, rows: rowCount, sumTotalDue, sumAllTimePaid, sumPeriodRev, sumBalance });
}

{
  const printSummaryBtn = document.getElementById("printSummaryBtn");
  if (printSummaryBtn) printSummaryBtn.onclick = () => {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`<html><head><title>Summary</title></head><body>`);
    printWindow.document.write(document.getElementById("summaryTable").outerHTML);
    printWindow.document.write(`<div>${document.getElementById("summaryFooter").innerHTML}</div>`);
    printWindow.document.write(`</body></html>`);
    printWindow.document.close();
    printWindow.print();
  };
}

// ===========================================================================
// DASHBOARD - Main room status display
// ===========================================================================
/**
 * fillDashboard() - Updates the main dashboard view
 * 
 * WHAT IT SHOWS:
 * - Total reservations count (all time)
 * - Today's check-ins (arrivals with arrivalDate = today)
 * - Today's check-outs (departures with departureDate = today)
 * - Available rooms (total - occupied)
 * - Total balance due across ALL reservations
 * - Room status grid (visual display of each room)
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * - Uses cached data (window._reservationsCache) instead of re-fetching
 * - Only updates DOM elements that exist
 * - Builds room grid HTML as string, then inserts once (faster than multiple appends)
 * - Pre-computes today's date string once for all comparisons
 * 
 * CALLED BY:
 * - debouncedDashboardUpdate() - when real-time data changes
 * - afterReservationOrPaymentChange() - after user actions
 * - Initial page load
 */
async function fillDashboard() {
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Get data from cache (or load if cache is empty)
  // Using cache avoids unnecessary database reads = faster + cheaper
  // ─────────────────────────────────────────────────────────────────────────
  let reservations = window._reservationsCache;
  let customersList = customers;
  
  if (!reservations || reservations.length === 0) {
    reservations = await loadReservations();
    window._reservationsCache = reservations;
  }
  if (!customersList || customersList.length === 0) {
    const customersSnapshot = await getDocs(collection(db, "customers"));
    customersList = customersSnapshot.docs.map(d=>({id:d.id,...d.data()}));
    customers = customersList;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Calculate today's date once (used in multiple places below)
  // Format: YYYY-MM-DD (matches how dates are stored in Firestore)
  // ─────────────────────────────────────────────────────────────────────────
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Update stats cards at the top of the dashboard
  // Each card shows a key metric for at-a-glance status
  // ─────────────────────────────────────────────────────────────────────────
  
  // Total reservations (all time) — count extensions as additional stays
  const extensionCount = reservations.reduce((sum, r) => {
    const hist = r.history || [];
    return sum + hist.filter(h => h.type === 'extended').length;
  }, 0);
  const cardTotal = document.getElementById('card_totalReservations');
  if (cardTotal) cardTotal.textContent = reservations.length + extensionCount;
  
  // Today's check-ins (guests arriving today)
  const cardCheckins = document.getElementById('card_todayCheckins');
  const todayCheckins = reservations.filter(r => r.arrivalDate === today).length;
  if (cardCheckins) cardCheckins.textContent = todayCheckins;
  
  // Today's check-outs (guests leaving today)
  const cardCheckouts = document.getElementById('card_todayCheckouts');
  const checkoutsToday = reservations.filter(r => r.departureDate === today);
  if (cardCheckouts) cardCheckouts.textContent = checkoutsToday.length;

  // Available rooms = Total rooms - Occupied rooms
  // A room is "occupied" if a reservation spans today (arrival <= today <= departure)
  const reservedRoomsToday = new Set(
    reservations
      .filter(r => r.arrivalDate <= today && today <= r.departureDate)
      .map(r => r.roomNumber)
  );
  
  const totalRooms = (typeof allowedRooms !== 'undefined') ? allowedRooms.length : 21;
  const cardAvailable = document.getElementById('card_availableRooms');
  if (cardAvailable) cardAvailable.textContent = Math.max(0, totalRooms - reservedRoomsToday.size);

  // Calculate total balance due for ACTIVE reservations only
  // (reservations that haven't departed yet or departed today)
  let totalBalanceDue = 0;
  const activeReservations = reservations.filter(r => r.departureDate >= today);
  
  for (const reservation of activeReservations) {
    const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
    const rate = parseFloat(reservation.rate) || 0;
    const baseTotal = rate * nights;
    
    // Include any balance adjustments (discounts or extra charges)
    const adjustments = reservation.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    const totalDue = baseTotal + totalAdjustment;
    
    // Subtract payments (excluding voided ones) and credits
    const allPayments = (window._allPaymentsCache || []).filter(p => p.reservationId === reservation.id && !p.voided);
    const actualPaid = allPayments.reduce((sum, pay) => sum + (parseFloat(pay.amount) || 0), 0);
    const creditTotal = calcCreditTotal(reservation.balanceCredits);
    const totalPaid = actualPaid + creditTotal;
    
    const bal = Math.max(0, totalDue - totalPaid);
    totalBalanceDue += bal;
  }
  const cardBalance = document.getElementById('card_balanceDue');
  if (cardBalance) cardBalance.textContent = `$${totalBalanceDue.toFixed(2)}`;

  // Update the revenue chart (defaults to last 7 days) - defer to ensure function is available
  if (typeof window.updateRevenueChartWithRange === 'function') {
    window.updateRevenueChartWithRange('7days');
  } else {
    // Function not yet defined, schedule for later
    setTimeout(() => {
      if (typeof window.updateRevenueChartWithRange === 'function') {
        window.updateRevenueChartWithRange('7days');
      }
    }, 100);
  }

  // ===========================================================================
  // ROOM STATUS GRID - Visual display of all rooms
  // ===========================================================================
  // Shows each room with color coding:
  // - Green = Available
  // - Red = Occupied
  // - Orange = Checking out today
  // - Gray = Under maintenance
  
  const roomNumbers = [
    '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111',
    '201', '202', '203', '204', '205', '206', '207', '208', '209', '210'
  ];
  const roomStatusGrid = document.getElementById('roomStatusGrid');
  if (roomStatusGrid) {
    const now = new Date();
    const todayStr = getTodayLocal();
    const currentHour = now.getHours();
    const isAfterCheckoutTime = currentHour >= 13;  // Check-out time is 1 PM
    
    // Build a map of which rooms have active reservations
    const roomReservationsMap = {};
    reservations.forEach(r => {
      const isActive = (r.arrivalDate <= todayStr && todayStr <= r.departureDate);
      
      if (isActive) {
        if (!roomReservationsMap[r.roomNumber]) {
          roomReservationsMap[r.roomNumber] = [];
        }
        roomReservationsMap[r.roomNumber].push(r);
      }
    });
    
    roomStatusGrid.innerHTML = roomNumbers.map(num => {
      if (maintenanceRooms.includes(num)) {
        const reason = maintenanceReasons[num] ? `<div class="room-status-reason" title="${escapeHTML(maintenanceReasons[num])}">${escapeHTML(maintenanceReasons[num])}</div>` : '';
        return `<div class="room-card maintenance" data-room="${num}">
          <div class="room-number">${num}</div>
          <div class="room-status-text">🔧 Maintenance</div>
          ${reason}
        </div>`;
      }
      
      const roomReservations = roomReservationsMap[num] || [];
      let statusClass = 'available';
      let statusText = 'Available';
      
      if (roomReservations.length > 0) {
        // Sort reservations by arrival date to handle properly
        const sortedReservations = roomReservations.sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate));
        
        // Find current guest (staying past today or checking out today but still here)
        const currentGuest = sortedReservations.find(r => {
          const isStayingPastToday = r.departureDate > todayStr;
          const isCheckingOutToday = r.departureDate === todayStr;
          const arrivedBeforeOrToday = r.arrivalDate <= todayStr;
          
          // Current guest is someone who arrived on or before today and hasn't left yet
          return arrivedBeforeOrToday && (isStayingPastToday || (isCheckingOutToday && !isAfterCheckoutTime));
        });
        
        // Find next guest (arriving today after checkout time)
        const nextGuest = sortedReservations.find(r => {
          return r.arrivalDate === todayStr && r.departureDate > todayStr;
        });
        
        if (currentGuest) {
          // There's someone currently in the room
          if (currentGuest.departureDate === todayStr && !isAfterCheckoutTime) {
            // They're checking out today and it's before checkout time
            statusClass = 'checkout-today';
            statusText = 'Checkout 1PM';
          } else {
            // They're staying past today or already checked in
            statusClass = 'occupied';
            statusText = 'Occupied';
          }
        } else if (nextGuest && isAfterCheckoutTime) {
          // No current guest, but new guest arriving today and it's past checkout time
          statusClass = 'occupied';
          statusText = 'Occupied';
        } else {
          // Room is available
          statusClass = 'available';
          statusText = 'Available';
        }
      }
      
      return `<div class="room-card ${statusClass}" data-room="${num}">
        <div class="room-number">${num}</div>
        <div class="room-status-text">${statusText}</div>
      </div>`;
    }).join('');
    
    // Add click handlers for maintenance toggle
    roomStatusGrid.querySelectorAll('.room-card').forEach(card => {
      card.addEventListener('click', () => {
        const roomNum = card.getAttribute('data-room');
        openMaintenanceModal(roomNum);
      });
    });
  }

  // populate recent reservations table
  const tbody = document.querySelector('#recentReservationsTable tbody');
  if (tbody) {
    tbody.innerHTML = '';
    const recent = reservations.slice().sort((a,b)=> (b.arrivalDate||'').localeCompare(a.arrivalDate||'')).slice(0,10);
    recent.forEach(r=>{
      const cust = customersList.find(c=>c.id===r.customerId) || {};
      const tr = document.createElement('tr');
      tr.setAttribute('data-res-id', r.id);
      
      // Use StatusUtils for consistent formatting
      const timeStatus = StatusUtils.getReservationTimeStatus(r, today);
      let statusDisplay;
      if (timeStatus === 'reserved') {
        // Future reservation - show RESERVED
        statusDisplay = '<span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:4px;font-size:0.85em;font-weight:600;">RESERVED</span>';
      } else {
        // Current or past - compute status from live payments cache (never trust stale paymentStatus field)
        const paymentStatus = StatusUtils.formatPaymentStatus(computeLivePaymentStatus(r));
        statusDisplay = `<span style="color:${paymentStatus.color};font-weight:500;">${paymentStatus.text}</span>`;
      }
      
      tr.innerHTML = `<td>${cust.name||'Unknown'}</td><td>${r.roomNumber||''}</td><td>${r.arrivalDate||''}</td><td>${r.departureDate||''}</td><td>${statusDisplay}</td>`;
      tbody.appendChild(tr);
    });
  }

  // Render 7-day availability grid on dashboard
  try {
    renderDashboardAvailabilityGrid(reservations, customersList);
  } catch (gridErr) {
    console.error("Dashboard availability grid render failed:", gridErr);
  }

  // ── ONE-TIME PER SESSION: silently heal stale paymentStatus in Firestore ──
  // Only runs after both reservations AND payments caches are loaded.
  // Uses computeLivePaymentStatus (the same logic as display) so Firestore
  // always stays consistent with what the UI is already showing.
  if (!window._paymentStatusHealDone && window._allPaymentsCache && window._allPaymentsCache.length >= 0) {
    window._paymentStatusHealDone = true; // Prevent repeated runs
    const toHeal = reservations.filter(r => {
      const computed = computeLivePaymentStatus(r);
      const stored   = r.paymentStatus;
      // Normalize legacy 'paid' alias and skip if already correct
      const storedNorm = stored === 'paid' ? 'fully_paid' : stored;
      return computed !== storedNorm;
    });
    if (toHeal.length > 0) {
      console.log(`🔧 Healing ${toHeal.length} stale paymentStatus value(s) in Firestore...`);
      toHeal.forEach(async r => {
        const correct = computeLivePaymentStatus(r);
        try {
          await updateDoc(doc(db, "reservations", r.id), { paymentStatus: correct });
          console.log(`  ✅ ${r.id}: ${r.paymentStatus} → ${correct}`);
        } catch (e) {
          console.warn(`  ⚠️ Could not heal ${r.id}:`, e.message);
        }
      });
    }
  }
}

// Dashboard 7-Day Availability Grid
function renderDashboardAvailabilityGrid(reservations, customersList) {
  const grid = document.getElementById('dashboardAvailabilityGrid');
  if (!grid) return;

  const roomNumbers = [
    '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111',
    '201', '202', '203', '204', '205', '206', '207', '208', '209', '210'
  ];

  // Generate 7 days starting from today
  const dates = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push({
      dateStr: `${year}-${month}-${day}`,
      display: `${dayNames[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`
    });
  }

  // Build table HTML
  let html = '<thead><tr><th>Room</th>';
  dates.forEach(d => {
    html += `<th>${d.display}</th>`;
  });
  html += '</tr></thead><tbody>';

  for (const room of roomNumbers) {
    html += `<tr><td>${room}</td>`;
    
    for (const dateInfo of dates) {
      const date = dateInfo.dateStr;
      // Find reservation for this room on this date
      const res = reservations.find(r =>
        r.roomNumber === room &&
        date >= r.arrivalDate &&
        date < r.departureDate // Use < for departure (checkout day room is free)
      );

      if (maintenanceRooms.includes(room)) {
        // Room is under maintenance
        html += `<td class="cell-maintenance" style="background: rgba(139, 92, 246, 0.2);">
          <span style="color: #8b5cf6; font-weight: 600; font-size: 11px;">🔧</span>
        </td>`;
      } else if (res) {
        const customer = customersList.find(c => c.id === res.customerId);
        const name = customer ? customer.name : 'Unknown';
        // Always derive status from live payments cache — never trust the stored paymentStatus field
        const liveStatus = computeLivePaymentStatus(res);
        let statusClass = 'unpaid';
        if (liveStatus === 'fully_paid') statusClass = 'paid';
        else if (liveStatus === 'partially_paid') statusClass = 'partial';
        
        // Check-in/out status - determine cell background and indicator
        // Use actualCheckInTime for check-in status (consistent with rest of app)
        const isCheckedIn = res.checkedIn || res.actualCheckInTime;
        const isCheckedOut = res.checkedOut || res.actualCheckOutTime;
        
        let checkStatusClass = '';
        let statusIndicator = '';
        if (isCheckedOut) {
          checkStatusClass = 'checked-out';
          statusIndicator = '<div style="font-size:9px;color:#6b7280;font-weight:600;">✓ Out</div>';
        } else if (isCheckedIn) {
          checkStatusClass = 'checked-in';
          statusIndicator = '<div style="font-size:9px;color:#065f46;font-weight:600;">✓ In</div>';
        } else {
          checkStatusClass = 'pending';
          statusIndicator = '<div style="font-size:9px;color:#92400e;font-weight:600;">⏳</div>';
        }
        
        html += `<td class="cell-occupied ${checkStatusClass}">
          <button class="guest-btn ${statusClass}" data-res-id="${res.id}" title="${name} - ${formatDateDMY(res.arrivalDate)} to ${formatDateDMY(res.departureDate)}">
            ${name}
          </button>
          ${statusIndicator}
        </td>`;
      } else {
        html += `<td class="cell-available"></td>`;
      }
    }
    
    html += '</tr>';
  }
  html += '</tbody>';
  
  grid.innerHTML = html;

  // Add click handlers for guest buttons
  grid.querySelectorAll('.guest-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const resId = btn.dataset.resId;
      const res = reservations.find(r => r.id === resId);
      if (res && typeof showEditDeletePopup === 'function') {
        showEditDeletePopup(res);
      }
    });
  });
}

// Global function to update revenue chart with different date ranges
window.updateRevenueChartWithRange = function(range, customStart, customEnd) {
  const allPaymentsForChart = window._allPaymentsCache || [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Helper to get normalized timestamp string for a payment
  const getPaymentDateStr = (p) => {
    const ts = normalizeTimestamp(p.timestamp);
    return ts ? ts.split('T')[0] : '';
  };
  
  // Helper to get Date object from payment timestamp
  const getPaymentDate = (p) => {
    const ts = normalizeTimestamp(p.timestamp);
    return ts ? new Date(ts) : null;
  };
  
  let labels = [];
  let data = [];
  let startDate, endDate;
  const now = new Date();
  
  switch(range) {
    case 'today':
      // Show hourly breakdown for today
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      for (let h = 0; h < 24; h++) {
        labels.push(`${h}:00`);
        const hourStart = new Date(startDate);
        hourStart.setHours(h, 0, 0, 0);
        const hourEnd = new Date(startDate);
        hourEnd.setHours(h, 59, 59, 999);
        const hourTotal = allPaymentsForChart
          .filter(p => {
            const ts = getPaymentDate(p);
            return ts && ts >= hourStart && ts <= hourEnd;
          })
          .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        data.push(hourTotal);
      }
      break;
      
    case 'week':
      // This week (Sunday to Saturday)
      const dayOfWeek = now.getDay();
      startDate = new Date(now);
      startDate.setDate(now.getDate() - dayOfWeek);
      startDate.setHours(0, 0, 0, 0);
      for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        labels.push(dayNames[d.getDay()]);
        const dayTotal = allPaymentsForChart
          .filter(p => getPaymentDateStr(p) === dateStr)
          .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        data.push(dayTotal);
      }
      break;
      
    case 'month':
      // This month - show each day
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const daysInMonth = endDate.getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        labels.push(d.toString());
        const dayTotal = allPaymentsForChart
          .filter(p => getPaymentDateStr(p) === dateStr)
          .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        data.push(dayTotal);
      }
      break;
      
    case 'custom':
      // Custom date range
      if (!customStart || !customEnd) return;
      startDate = new Date(customStart);
      endDate = new Date(customEnd);
      const diffDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
      
      if (diffDays <= 31) {
        // Show each day
        for (let i = 0; i < diffDays; i++) {
          const d = new Date(startDate);
          d.setDate(startDate.getDate() + i);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
          labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
          const dayTotal = allPaymentsForChart
            .filter(p => getPaymentDateStr(p) === dateStr)
            .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
          data.push(dayTotal);
        }
      } else {
        // Group by week for longer ranges
        let currentWeekStart = new Date(startDate);
        while (currentWeekStart <= endDate) {
          const weekEnd = new Date(currentWeekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
          const actualEnd = weekEnd > endDate ? endDate : weekEnd;
          
          labels.push(`${currentWeekStart.getMonth() + 1}/${currentWeekStart.getDate()}`);
          let weekTotal = 0;
          for (let d = new Date(currentWeekStart); d <= actualEnd; d.setDate(d.getDate() + 1)) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            weekTotal += allPaymentsForChart
              .filter(p => getPaymentDateStr(p) === dateStr)
              .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
          }
          data.push(weekTotal);
          currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        }
      }
      break;
      
    case '7days':
    default:
      // Last 7 days
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        labels.push(dayNames[d.getDay()]);
        const dayTotal = allPaymentsForChart
          .filter(p => getPaymentDateStr(p) === dateStr)
          .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        data.push(dayTotal);
      }
      break;
  }
  
  // Update chart
  if (window._revenueChart) {
    window._revenueChart.data.labels = labels;
    window._revenueChart.data.datasets[0].data = data;
    window._revenueChart.update();
    console.log('Revenue chart updated for range:', range, labels, data);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-CHECKOUT: Automatically check out overdue guests
// ═══════════════════════════════════════════════════════════════════════════════
// Runs on app load and every 30 minutes.
// If a guest's departure date has passed and they haven't been checked out,
// the system marks them as checked out automatically.
// This keeps Room History, Extend Stay, and the dashboard consistent.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Auto-checkout guests whose departure date is strictly before today.
 * Sets checkedOut, actualCheckOutTime, and an autoCheckedOut flag
 * so staff can see the system did it (not a manual checkout).
 * @returns {number} Number of guests auto-checked-out
 */
async function autoCheckoutOverdueGuests() {
  try {
    const today = getTodayLocal(); // YYYY-MM-DD

    // Use cache if available, otherwise fetch
    let reservations = window._reservationsCache || [];
    if (reservations.length === 0) {
      const snapshot = await getDocs(collection(db, "reservations"));
      reservations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // Find overdue guests: checked in, NOT checked out, departure < today
    const overdueGuests = reservations.filter(r => {
      const isCheckedIn = r.checkedIn || !!r.actualCheckInTime;
      const isCheckedOut = !!r.checkedOut;
      const depDate = r.departureDate || '';
      return isCheckedIn && !isCheckedOut && depDate < today && depDate !== '';
    });

    if (overdueGuests.length === 0) {
      Logger.debug('Auto-checkout: no overdue guests found');
      return 0;
    }

    Logger.info(`Auto-checkout: found ${overdueGuests.length} overdue guest(s), processing...`);

    // Suppress dashboard updates during batch processing to prevent spam
    window._suppressDashboardUpdates = true;

    let checkedOutCount = 0;

    for (const res of overdueGuests) {
      try {
        // Re-fetch to avoid race conditions (another tab may have checked them out)
        const freshDoc = await getDoc(doc(db, 'reservations', res.id));
        if (!freshDoc.exists()) continue;
        const freshData = freshDoc.data();
        if (freshData.checkedOut) {
          Logger.debug(`Auto-checkout: ${res.id} already checked out by another process`);
          continue;
        }

        // Build the auto-checkout timestamp at the scheduled checkout time (1 PM on departure day)
        const checkoutTimestamp = `${res.departureDate}T13:00:00`;

        await updateDoc(doc(db, 'reservations', res.id), {
          checkedOut: true,
          actualCheckOutTime: checkoutTimestamp,
          autoCheckedOut: true,
          autoCheckoutNote: `Automatically checked out — departure date ${res.departureDate} has passed`
        });

        // Update local cache immediately for consistency
        if (window._reservationsCache) {
          const idx = window._reservationsCache.findIndex(r => r.id === res.id);
          if (idx !== -1) {
            window._reservationsCache[idx] = {
              ...window._reservationsCache[idx],
              checkedOut: true,
              actualCheckOutTime: checkoutTimestamp,
              autoCheckedOut: true
            };
          }
        }

        // Find customer name for audit log
        const customer = customers.find(c => c.id === res.customerId);
        const guestName = customer?.name || res.customerName || 'Unknown';

        // Audit log
        await auditLog(AUDIT_ACTIONS.CHECKOUT || 'CHECKOUT', {
          roomNumber: res.roomNumber,
          customerName: guestName,
          reservationId: res.id,
          scheduledDeparture: res.departureDate,
          actualCheckout: res.departureDate,
          autoCheckout: true,
          reason: 'Departure date passed — system auto-checkout'
        }, 'reservation', res.id);

        checkedOutCount++;
        Logger.info(`Auto-checkout: Room ${res.roomNumber} (${guestName}) — departed ${res.departureDate}`);
      } catch (err) {
        console.error(`Auto-checkout failed for reservation ${res.id}:`, err);
      }
    }

    // Re-enable dashboard updates
    window._suppressDashboardUpdates = false;

    if (checkedOutCount > 0) {
      Logger.success(`Auto-checkout complete: ${checkedOutCount} guest(s) checked out`);
      // Single dashboard refresh after all updates are done
      debouncedDashboardUpdate();
    }

    return checkedOutCount;
  } catch (err) {
    window._suppressDashboardUpdates = false;
    console.error('Auto-checkout error:', err);
    return 0;
  }
}

// Run auto-checkout every 30 minutes to catch any guests past their departure
setInterval(autoCheckoutOverdueGuests, 30 * 60 * 1000);

// call it once your app is ready (after customers/reservations loaded)
(async () => {
  try {
    await waitForSignedInUser();
    const paymentsSnapshot = await getDocs(collection(db, "payments"));
    window._allPaymentsCache = paymentsSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log('Payments loaded:', window._allPaymentsCache.length);
    
    // Deep-link handler: called after dashboard is ready in both branches
    async function handleDeepLink() {
      const deepLinkResId = new URLSearchParams(window.location.search).get('res');
      if (!deepLinkResId) return;
      history.replaceState(null, '', window.location.pathname);
      try {
        const resDoc = await getDoc(doc(db, 'reservations', deepLinkResId));
        if (resDoc.exists()) {
          window.showEditDeletePopup({ id: resDoc.id, ...resDoc.data() });
        } else {
          console.warn('[DeepLink] Reservation not found:', deepLinkResId);
        }
      } catch (e) {
        console.warn('[DeepLink] Could not open reservation:', e);
      }
    }

    // Wait for DOM to be ready before filling dashboard
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', async () => {
        await autoCheckoutOverdueGuests();
        await fillDashboard();
        await handleDeepLink();
      });
    } else {
      await autoCheckoutOverdueGuests();
      await fillDashboard();
      await handleDeepLink();
    }
  } catch (err) {
    console.error("Dashboard init failed:", err);
  }
})();

// ✅ Print a receipt by receipt number (used after extension save)
function printReceipt(receiptNumber) {
  if (!receiptNumber) {
    console.error('No receipt number provided');
    return;
  }
  
  // Find the payment in cache
  const allPayments = window._allPaymentsCache || [];
  const payment = allPayments.find(p => p.receiptNumber === receiptNumber);
  
  if (!payment) {
    // Payment may not be in cache yet - try with a delay
    setTimeout(() => {
      const retryPayments = window._allPaymentsCache || [];
      const retryPayment = retryPayments.find(p => p.receiptNumber === receiptNumber);
      if (retryPayment) {
        printReceiptFromPayment(retryPayment);
      } else {
        alert(`Receipt #${receiptNumber} created successfully but not yet loaded. Check the Manage Payments section.`);
      }
    }, 1000);
    return;
  }
  
  printReceiptFromPayment(payment);
}

// Helper function to print from payment object
function printReceiptFromPayment(payment) {
  const reservations = window._reservationsCache || [];
  const reservation = reservations.find(r => r.id === payment.reservationId);
  const customer = customers.find(c => c.id === payment.customerId) || {};
  
  const paymentDate = payment.timestamp ? formatDateDMY(payment.timestamp) : formatDateDMY(new Date());
  const method = payment.method ? payment.method.charAt(0).toUpperCase() + payment.method.slice(1) : 'Cash';
  
  // Calculate balance info for the receipt
  let totalCost = 0;
  let totalPaidAll = 0;
  let balance = 0;
  if (reservation) {
    const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
    const rate = parseFloat(reservation.rate || 0);
    const baseTotal = rate * nights;
    const adjustments = reservation.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    totalCost = baseTotal + totalAdjustment;
    const resPayments = (window._allPaymentsCache || [])
      .filter(p => p.reservationId === reservation.id && !p.voided);
    totalPaidAll = resPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) + calcCreditTotal(reservation.balanceCredits);
    balance = Math.max(0, totalCost - totalPaidAll);
  }
  
  printSingleReceipt({
    receiptNumber: payment.receiptNumber,
    amount: parseFloat(payment.amount).toFixed(2),
    method: method,
    date: paymentDate,
    customerName: customer.name || 'Guest',
    room: reservation?.roomNumber || 'N/A',
    arrivalDate: reservation?.arrivalDate || 'N/A',
    departureDate: reservation?.departureDate || 'N/A',
    totalCost: totalCost.toFixed(2),
    totalPaid: totalPaidAll.toFixed(2),
    balance: balance.toFixed(2)
  });
}

// ✅ Print a single receipt from manage payment modal
function printSingleReceipt(data) {
  const { receiptNumber, amount, method, date, customerName, room, arrivalDate, departureDate, totalCost, totalPaid, balance } = data;
  
  // Format stay dates for display
  const arrDisplay = arrivalDate && arrivalDate !== 'N/A' ? formatDateDMY(arrivalDate) : 'N/A';
  const depDisplay = departureDate && departureDate !== 'N/A' ? formatDateDMY(departureDate) : 'N/A';
  
  const receiptHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Receipt #${receiptNumber}</title>
      <style>
        @page { size: 80mm auto; margin: 5mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
          font-family: 'Courier New', monospace; 
          font-size: 14px; 
          line-height: 1.4;
          padding: 10px;
          max-width: 300px;
        }
        .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 12px; margin-bottom: 12px; }
        .header h1 { font-size: 20px; margin-bottom: 4px; }
        .header p { font-size: 11px; color: #333; }
        .receipt-num { text-align: center; font-size: 18px; font-weight: bold; margin: 12px 0; padding: 8px; background: #f0f0f0; border-radius: 4px; }
        .details { margin: 16px 0; }
        .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dotted #ccc; }
        .row:last-child { border-bottom: none; }
        .label { font-weight: bold; }
        .amount-section { text-align: center; margin: 20px 0; padding: 16px; background: #e8f5e9; border: 2px solid #4caf50; border-radius: 8px; }
        .amount-section .label { font-size: 14px; color: #666; }
        .amount-section .value { font-size: 32px; font-weight: bold; color: #2e7d32; }
        .balance-section { margin: 12px 0; padding: 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
        .balance-row { display: flex; justify-content: space-between; padding: 3px 0; }
        .balance-row.total { border-top: 1px solid #000; margin-top: 4px; padding-top: 6px; font-weight: bold; }
        .footer { text-align: center; margin-top: 20px; padding-top: 12px; border-top: 2px dashed #000; font-size: 12px; color: #666; }
        .thank-you { font-size: 16px; font-weight: bold; margin-bottom: 8px; }
        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Glimbaro Guest House</h1>
        <p>Cayon Street, Basseterre, St. Kitts</p>
        <p>Tel: (869) 663-0777</p>
      </div>
      
      <div class="receipt-num">Receipt #${receiptNumber}</div>
      
      <div class="details">
        <div class="row">
          <span class="label">Date:</span>
          <span>${date}</span>
        </div>
        <div class="row">
          <span class="label">Guest:</span>
          <span>${customerName}</span>
        </div>
        <div class="row">
          <span class="label">Room:</span>
          <span>${room}</span>
        </div>
        <div class="row">
          <span class="label">Stay:</span>
          <span>${arrDisplay} - ${depDisplay}</span>
        </div>
        <div class="row">
          <span class="label">Payment:</span>
          <span>${method}</span>
        </div>
      </div>
      
      <div class="amount-section">
        <div class="label">AMOUNT PAID</div>
        <div class="value">$${amount}</div>
      </div>
      
      ${totalCost ? `
      <div class="balance-section">
        <div class="balance-row">
          <span>Total Cost:</span>
          <span>$${totalCost}</span>
        </div>
        <div class="balance-row">
          <span>Total Paid:</span>
          <span style="color:#2e7d32;">$${totalPaid}</span>
        </div>
        <div class="balance-row total">
          <span>Balance:</span>
          <span style="color:${parseFloat(balance) > 0 ? '#d32f2f' : '#2e7d32'};">$${balance}</span>
        </div>
      </div>
      ` : ''}
      
      <div class="footer">
        <div class="thank-you">Thank You!</div>
        <p>Keep this receipt for your records</p>
      </div>
    </body>
    </html>
  `;
  
  const printWindow = window.open('', '_blank', 'width=400,height=600');
  printWindow.document.write(receiptHTML);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 300);
}

// ✅ Reusable function to open the print registration form with cropping, preview, and Done button
async function openPrintRegistrationForm(reservation) {
  // Fetch fresh reservation data from Firestore to get latest adjustments and data
  const freshResDoc = await getDoc(doc(db, "reservations", reservation.id));
  const freshReservation = freshResDoc.exists() ? { id: freshResDoc.id, ...freshResDoc.data() } : reservation;
  
  const customer = customers.find(c => c.id === freshReservation.customerId) || {};

  // Fetch related payments
  const paymentsSnapshot = await getDocs(collection(db, "payments"));
  // Filter out voided payments for calculations and display
  const relatedPayments = paymentsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => p.reservationId === freshReservation.id && !p.voided);

  // Sort ASCENDING (oldest first) so running balance subtracts in correct order
  const sortedPayments = relatedPayments.sort(comparePaymentsByTime);
  const rate = parseFloat(freshReservation.rate || 0);
  const nights = calculateSpecialNights(freshReservation.arrivalDate, freshReservation.departureDate);
  const baseTotal = rate * nights;
  // Include balance adjustments
  const adjustments = freshReservation.balanceAdjustments || [];
  const totalAdjustment = calcAdjustmentTotal(adjustments);
  const totalDue = baseTotal + totalAdjustment;
  const actualPaid = relatedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  const creditTotal = calcCreditTotal(freshReservation.balanceCredits);
  const totalPaid = actualPaid + creditTotal;
  let balanceRemaining = Math.max(0, totalDue - totalPaid);
  if (balanceRemaining < 0) balanceRemaining = 0;

  const paymentSummary = {
    totalPaid,
    totalDue,
    balanceRemaining,
    receiptNumber: sortedPayments[0]?.receiptNumber || "—",
    receipts: buildReceiptsWithBalance(sortedPayments, freshReservation)
  };

  /*// Use stored ID image for existing reservations
  const idImage = latestCroppedImageDataUrl || ""; // or fetch from Firestore storage if you save it

  const html = buildRegistrationFormHTML(reservation, customer, idImage, paymentSummary);
  document.getElementById("formPreviewContent").innerHTML = `
    <div class="registration-form">${html}</div>
    <div class="registration-form" style="page-break-before:always;">${html}</div>
  `;
  document.getElementById("registrationFormPreviewModal").style.display = "block";*/
}

// 🔹 Show registration form directly if ID already exists
async function showRegistrationFormWithSavedId(customer) {
  try {
    const resDoc = await getDoc(doc(db, "reservations", latestReservationId));
    const reservation = resDoc.exists() ? { id: resDoc.id, ...resDoc.data() } : null;

    let relatedPayments = [];
    const paymentsSnapshot = await getDocs(collection(db, "payments"));
    // Filter out voided payments for calculations and display
    relatedPayments = paymentsSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => p.reservationId === reservation.id && !p.voided);

    // Sort ASCENDING (oldest first) so running balance subtracts in correct order
    const sortedPayments = relatedPayments.sort(comparePaymentsByTime);
    const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
    const baseTotal = (parseFloat(reservation.rate) || 0) * nights;
    // Include balance adjustments
    const adjustments = reservation.balanceAdjustments || [];
    const totalAdjustment = calcAdjustmentTotal(adjustments);
    const totalDue = baseTotal + totalAdjustment;
    const actualPaid = relatedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const creditTotal = calcCreditTotal(reservation.balanceCredits);
    const totalPaid = actualPaid + creditTotal;
    const balanceRemaining = Math.max(0, totalDue - totalPaid);

    const paymentSummary = {
      totalPaid,
      totalDue,
      balanceRemaining,
      receiptNumber: sortedPayments[0]?.receiptNumber || "—",
      receipts: buildReceiptsWithBalance(sortedPayments, reservation)
    };

    // 🔹 Use saved ID image
    const html = buildRegistrationFormHTML(reservation, customer, customer.idImageUrl, paymentSummary);
    const previewContainer = document.getElementById("formPreviewContent");
    previewContainer.innerHTML = html;

    ModalManager.open('registrationFormPreviewModal');
  } catch (err) {
    console.error("Error showing registration form with saved ID:", err);
    alert("Could not generate registration form.");
  }
}
async function showFormPreview(reservation, customer, idImageUrl) {
  // Fetch fresh reservation data from Firestore to get latest adjustments and data
  const freshResDoc = await getDoc(doc(db, "reservations", reservation.id));
  const freshReservation = freshResDoc.exists() ? { id: freshResDoc.id, ...freshResDoc.data() } : reservation;
  
  // fetch related payments - filter out voided ones
  const paymentsSnapshot = await getDocs(collection(db, "payments"));
  const relatedPayments = paymentsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => p.reservationId === freshReservation.id && !p.voided);

  // Sort payments by timestamp ASCENDING (oldest first) for proper running balance
  const sortedPayments = relatedPayments.sort(comparePaymentsByTime);

  const rate = parseFloat(freshReservation.rate || 0);
  const nights = calculateSpecialNights(
    freshReservation.arrivalDate,
    freshReservation.departureDate
  );
  const baseTotal = rate * nights;
  // Include balance adjustments
  const adjustments = freshReservation.balanceAdjustments || [];
  const totalAdjustment = calcAdjustmentTotal(adjustments);
  const totalDue = baseTotal + totalAdjustment;
  const actualPaid = relatedPayments.reduce(
    (sum, p) => sum + parseFloat(p.amount || 0),
    0
  );
  const creditTotal = calcCreditTotal(freshReservation.balanceCredits);
  const totalPaid = actualPaid + creditTotal;
  const balanceRemaining = Math.max(0, totalDue - totalPaid);

  const paymentSummary = {
    totalPaid,
    totalDue,
    balanceRemaining,
    receiptNumber: sortedPayments[0]?.receiptNumber || "—",
    receipts: buildReceiptsWithBalance(sortedPayments, freshReservation),
  };

  // build the registration form HTML
  const html = buildRegistrationFormHTML(
    freshReservation,
    customer,
    idImageUrl,
    paymentSummary
  );

  // put it into the preview modal
  const previewContainer = document.getElementById("formPreviewContent");
  previewContainer.innerHTML = html;

  // open modal
  ModalManager.open('registrationFormPreviewModal');
}
async function openCustomerReservations(customerId) {
  const modal = document.getElementById("customerReservationsModal");
  const list = document.getElementById("customerReservationsList");
  if (!modal || !list) {
    console.error("Missing customerReservationsModal or list container in HTML.");
    return;
  }

  list.innerHTML = "<p>Loading...</p>";
  ModalManager.open('customerReservationsModal');

  try {
    const snapshot = await getDocs(collection(db, "reservations"));
    const reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const custReservations = reservations.filter(r => r.customerId === customerId);

    if (custReservations.length === 0) {
      list.innerHTML = "<p>No reservations found for this customer.</p>";
      return;
    }

    list.innerHTML = "";
    custReservations.forEach(res => {
      const div = document.createElement("div");
      div.style.margin = "8px 0";
      div.style.padding = "12px";
      div.style.border = "1px solid #ddd";
      div.style.borderRadius = "8px";
      div.style.background = "#ffffff";
      div.style.color = "#333";
      div.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";

      div.innerHTML = `
        <p style="color:#333;margin:0 0 8px 0;"><strong style="color:#222;">Room:</strong> ${res.roomNumber} |
           <strong style="color:#222;">Dates:</strong> ${res.arrivalDate} → ${res.departureDate} |
           <strong style="color:#222;">Status:</strong> ${res.paymentStatus || "unpaid"}</p>
        <button class="editResBtn" data-id="${res.id}" 
          style="background:#4a90e2;color:#fff;border:none;padding:6px 12px;
          border-radius:4px;cursor:pointer;font-weight:500;">✏ Edit</button>
      `;

      list.appendChild(div);
    });

    // Delegate clicks to the container (robust even if we rebuild the list)
    list.addEventListener("click", function onListClick(e) {
      const btn = e.target.closest(".editResBtn");
      if (!btn) return;
      const resId = btn.getAttribute("data-id");
      const reservation = reservations.find(r => r.id === resId);
      if (!reservation) return;

      // Close list modal and open your existing popup
      modal.style.display = "none";
      showEditDeletePopup(reservation);
    }, { once: true }); // re-added each time we build the list

  } catch (err) {
    console.error("Failed to load reservations:", err);
    list.innerHTML = "<p>Failed to load reservations.</p>";
  }
}

// Close reservations modal
document.getElementById("closeCustomerReservationsBtn")?.addEventListener("click", () => {
  const modal = document.getElementById("customerReservationsModal");
  if (modal) modal.style.display = "none";
});

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE MANAGEMENT & INVITE CODE SYSTEM
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize user menu display
 */
function initializeUserMenu() {
  if (!currentEmployee) return;

  // Update user info display
  const userName = document.getElementById('userName');
  const userRole = document.getElementById('userRole');
  
  if (userName) userName.textContent = currentEmployee.name || 'Employee';
  if (userRole) userRole.textContent = currentEmployee.role || 'staff';

  // Show/hide admin-only options
  const generateInviteBtn = document.getElementById('generateInviteBtn');
  const manageEmployeesBtn = document.getElementById('manageEmployeesBtn');
  const inviteEmployeeBtn = document.getElementById('inviteEmployeeBtn');
  const auditLogBtn = document.getElementById('auditLogBtn');
  const bulkQBResyncBtn = document.getElementById('bulkQBResyncBtn');
  
  // Admin/Manager can invite employees
  if (currentEmployee.role === 'admin' || currentEmployee.role === 'manager') {
    if (generateInviteBtn) generateInviteBtn.style.display = '';
    if (manageEmployeesBtn) manageEmployeesBtn.style.display = '';
    if (inviteEmployeeBtn) inviteEmployeeBtn.style.display = '';
  } else {
    if (generateInviteBtn) generateInviteBtn.style.display = 'none';
    if (manageEmployeesBtn) manageEmployeesBtn.style.display = 'none';
    if (inviteEmployeeBtn) inviteEmployeeBtn.style.display = 'none';
  }
  
  // ONLY admin can see audit logs and bulk QB resync (not managers)
  if (currentEmployee.role === 'admin') {
    if (auditLogBtn) auditLogBtn.style.display = '';
    if (bulkQBResyncBtn) bulkQBResyncBtn.style.display = '';
  } else {
    if (auditLogBtn) auditLogBtn.style.display = 'none';
    if (bulkQBResyncBtn) bulkQBResyncBtn.style.display = 'none';
  }
}

/**
 * Toggle user dropdown menu
 */
document.getElementById('userMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('userDropdown');
  dropdown.classList.toggle('show');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('userDropdown');
  const userMenu = document.getElementById('userMenu');
  if (dropdown && !userMenu?.contains(e.target)) {
    dropdown.classList.remove('show');
  }
});

/**
 * Generate secure invite code - shared logic
 * Only admins/managers can generate codes
 */
async function generateInviteCode() {
  // Check permission
  if (!currentEmployee || (currentEmployee.role !== 'admin' && currentEmployee.role !== 'manager')) {
    alert('Only admins and managers can generate invite codes.');
    return;
  }

  // Determine allowed roles
  const isAdmin = currentEmployee.role === 'admin';
  
  // Prompt for role
  let roleOptions = '• staff - Regular employee';
  if (isAdmin) {
    roleOptions += '\n• manager - Can manage employees\n• admin - Full access';
  }
  
  const role = prompt(
    'Enter the role for the new employee:\n\n' +
    roleOptions + '\n\n' +
    'Enter role' + (isAdmin ? ' (staff/manager/admin):' : ' (staff only):'),
    'staff'
  );

  if (!role) return;
  
  // Validate role based on permission
  const validRoles = isAdmin ? ['staff', 'manager', 'admin'] : ['staff'];
  if (!validRoles.includes(role.toLowerCase())) {
    alert(isAdmin 
      ? 'Invalid role. Please enter: staff, manager, or admin' 
      : 'Managers can only invite staff members.');
    return;
  }

  // Prompt for expiration - default 24 hours for security
  const expiresIn = prompt(
    '⚠️ SECURITY: Invite codes expire for safety.\n\n' +
    'How many HOURS should this code be valid?\n' +
    '(Default: 24 hours, Max: 72 hours)',
    '24'
  );

  const hours = parseInt(expiresIn);
  if (isNaN(hours) || hours < 1 || hours > 72) {
    alert('Please enter a valid number between 1 and 72 hours.');
    return;
  }

  try {
    // Generate secure random code
    const code = generateSecureCode();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hours);

    // Save to Firestore
    await addDoc(collection(db, 'invite_codes'), {
      code: code,
      role: role.toLowerCase(),
      used: false,
      createdAt: new Date().toISOString(),
      createdBy: currentEmployee.uid,
      createdByName: currentEmployee.name,
      expiresAt: expiresAt.toISOString(),
      usedBy: null,
      usedAt: null
    });

    // Audit log
    await auditLog(AUDIT_ACTIONS.SETTINGS_CHANGED, {
      action: 'INVITE_CODE_GENERATED',
      code: code.substring(0, 4) + '****', // Partial code for audit
      role: role.toLowerCase(),
      expiresAt: expiresAt.toISOString(),
      expiresInHours: hours
    });

    // Format expiration
    const expireTime = formatDateTimeDMY(expiresAt);

    // Show the code to the user
    alert(
      '✅ Invite Code Generated!\n\n' +
      `Code: ${code}\n` +
      `Role: ${role}\n` +
      `Expires: ${expireTime}\n\n` +
      '⚠️ This code will EXPIRE in ' + hours + ' hours.\n' +
      'Share it immediately with the new employee.'
    );

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(code);
      console.log('Invite code copied to clipboard');
    } catch (clipErr) {
      console.warn('Could not copy to clipboard:', clipErr);
    }

  } catch (err) {
    console.error('Error generating invite code:', err);
    alert('Failed to generate invite code. Please try again.');
  }
}

/**
 * Header Invite Employee button
 */
document.getElementById('inviteEmployeeBtn')?.addEventListener('click', generateInviteCode);

/**
 * Bulk QB Resync button - Admin only
 * Shows a smart panel with last synced receipt info and unsent count
 */
document.getElementById('bulkQBResyncBtn')?.addEventListener('click', async () => {
  try {
    const paymentsSnapshot = await getDocs(collection(db, "payments"));
    const allPayments = paymentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Valid (non-voided) payments sorted by receipt number
    const validPayments = allPayments
      .filter(p => !p.voided && p.qbSyncStatus !== 'voided' && p.status !== 'voided' && p.receiptNumber)
      .sort((a, b) => {
        const numA = parseInt(a.receiptNumber.replace(/\D/g, '') || '0', 10);
        const numB = parseInt(b.receiptNumber.replace(/\D/g, '') || '0', 10);
        return numA - numB;
      });

    // Last synced receipt
    const lastSynced = [...validPayments]
      .filter(p => p.qbSyncStatus === 'synced')
      .sort((a, b) => parseInt(b.receiptNumber.replace(/\D/g, '') || '0', 10) - parseInt(a.receiptNumber.replace(/\D/g, '') || '0', 10))[0];
    const lastSyncedDisplay = lastSynced ? lastSynced.receiptNumber : 'None';

    // Latest receipt overall
    const latestReceipt = validPayments.length > 0 ? validPayments[validPayments.length - 1].receiptNumber : 'None';

    // Build simple modal
    let qbModal = document.getElementById('qbSyncSummaryModal');
    if (qbModal) qbModal.remove();

    qbModal = document.createElement('div');
    qbModal.id = 'qbSyncSummaryModal';
    qbModal.className = 'modal';
    qbModal.style.display = 'block';
    qbModal.innerHTML = `
      <div class="modal-content" style="max-width:420px;">
        <button class="close" id="closeQBSyncModal" aria-label="Close">&times;</button>
        <h2 style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
          <span class="material-icons">cloud_upload</span> Send to QuickBooks
        </h2>

        <table style="width:100%;border-collapse:collapse;font-size:0.9em;margin-bottom:16px;">
          <tr>
            <td style="padding:6px 0;color:var(--text-muted);">Last Synced Receipt</td>
            <td style="padding:6px 0;font-weight:700;color:var(--text-primary);">#${escapeHTML(lastSyncedDisplay)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:var(--text-muted);">Latest Receipt Created</td>
            <td style="padding:6px 0;font-weight:700;color:var(--text-primary);">#${escapeHTML(latestReceipt)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:var(--text-muted);">Total Valid Receipts</td>
            <td style="padding:6px 0;font-weight:700;color:var(--text-primary);">${validPayments.length}</td>
          </tr>
        </table>

        <div style="margin-bottom:16px;">
          <label for="qbStartFrom" style="font-size:0.87em;font-weight:600;color:var(--text-primary);display:block;margin-bottom:6px;">Start from receipt #:</label>
          <input type="number" id="qbStartFrom" placeholder="e.g. 106" min="1"
            style="width:100%;padding:8px 10px;border:1px solid var(--border-medium);border-radius:var(--radius-md);font-size:0.9em;background:var(--bg-primary);color:var(--text-primary);box-sizing:border-box;" />
          <div style="font-size:0.78em;color:var(--text-muted);margin-top:4px;">
            All non-voided receipts from this number up to #${escapeHTML(latestReceipt)} will be sent.
          </div>
        </div>

        <div id="qbPreviewCount" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:14px;"></div>

        <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="cancelQBSync" class="btn btn-ghost">Cancel</button>
          <button id="confirmQBSync" class="btn btn-primary">Send to QB</button>
        </div>
      </div>`;

    document.body.appendChild(qbModal);

    // Preview count updater
    function updatePreview() {
      const startNum = parseInt(document.getElementById('qbStartFrom').value) || 0;
      const toSend = validPayments.filter(p => {
        if (startNum <= 0) return p.qbSyncStatus !== 'synced';
        const num = parseInt(p.receiptNumber.replace(/\D/g, '') || '0', 10);
        return num >= startNum;
      });
      const el = document.getElementById('qbPreviewCount');
      if (el) el.textContent = toSend.length + ' receipt(s) will be sent.';
    }
    updatePreview();

    document.getElementById('qbStartFrom').addEventListener('input', updatePreview);
    document.getElementById('closeQBSyncModal').onclick = () => qbModal.remove();
    document.getElementById('cancelQBSync').onclick = () => qbModal.remove();
    qbModal.addEventListener('click', (e) => { if (e.target === qbModal) qbModal.remove(); });

    document.getElementById('confirmQBSync').onclick = async () => {
      const startNum = parseInt(document.getElementById('qbStartFrom').value) || 0;
      const btn = document.getElementById('confirmQBSync');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      qbModal.remove();
      await sendUnsentToQuickBooks(startNum);
    };

  } catch (err) {
    console.error("QB Sync error:", err);
    alert("Failed to load QB sync summary: " + err.message);
  }
});

/**
 * User menu Invite button (legacy)
 */
document.getElementById('generateInviteBtn')?.addEventListener('click', async () => {
  // Close dropdown
  document.getElementById('userDropdown')?.classList.remove('show');
  await generateInviteCode();
});

/**
 * Generate a secure random invite code
 * Format: XXXX-XXXX-XXXX (12 characters, alphanumeric)
 */
function generateSecureCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous: I,O,0,1
  const segments = 3;
  const segmentLength = 4;
  const parts = [];

  for (let s = 0; s < segments; s++) {
    let segment = '';
    for (let i = 0; i < segmentLength; i++) {
      const randomIndex = Math.floor(Math.random() * chars.length);
      segment += chars[randomIndex];
    }
    parts.push(segment);
  }

  return parts.join('-');
}

/**
 * Manage Employees Modal
 */
document.getElementById('manageEmployeesBtn')?.addEventListener('click', async () => {
  document.getElementById('userDropdown').classList.remove('show');

  // Check permission
  if (!currentEmployee || (currentEmployee.role !== 'admin' && currentEmployee.role !== 'manager')) {
    alert('Only admins and managers can manage employees.');
    return;
  }

  // Create modal dynamically
  let modal = document.getElementById('manageEmployeesModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'manageEmployeesModal';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Manage employees');
    modal.innerHTML = `
      <div class="modal-content modal-lg modal-scrollable">
        <button class="close" aria-label="Close dialog" onclick="this.closest('.modal').style.display='none'">&times;</button>
        <h2 class="modal-header-centered"><span class="material-icons" aria-hidden="true">group</span> Manage Employees</h2>
        
        <div id="employeesList" class="results-container">
          <p class="text-center text-muted">Loading employees...</p>
        </div>

        <h3 style="margin-top:24px;">📋 Active Invite Codes</h3>
        <div id="inviteCodesList" class="results-container">
          <p class="text-center text-muted">Loading invite codes...</p>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="this.closest('.modal').style.display='none'">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.style.display = 'block';

  // Load employees
  try {
    const employeesSnapshot = await getDocs(collection(db, 'employees'));
    const employees = employeesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const employeesList = document.getElementById('employeesList');
    
    if (employees.length === 0) {
      employeesList.innerHTML = '<p class="text-center text-muted">No employees found.</p>';
    } else {
      employeesList.innerHTML = `
        <table class="data-table" style="width:100%;">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${employees.map(emp => {
              const isCurrentUser = emp.id === currentEmployee?.uid;
              const canChangeRole = currentEmployee?.role === 'admin' && !isCurrentUser;
              return `
              <tr>
                <td style="padding:8px;">${escapeHTML(emp.name || 'Unknown')}</td>
                <td style="padding:8px; font-size:0.85rem;">${escapeHTML(emp.email || 'N/A')}</td>
                <td style="padding:8px;">
                  ${canChangeRole ? `
                    <select onchange="changeEmployeeRole('${emp.id}', this.value)" 
                            style="padding:4px 8px; border-radius:4px; border:1px solid var(--border-light); background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer;">
                      <option value="staff" ${emp.role === 'staff' ? 'selected' : ''}>Staff</option>
                      <option value="manager" ${emp.role === 'manager' ? 'selected' : ''}>Manager</option>
                      <option value="admin" ${emp.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                  ` : `<span style="text-transform:capitalize;">${emp.role || 'staff'}</span>`}
                </td>
                <td style="padding:8px;">
                  <span style="color:${emp.active ? 'var(--accent-success)' : 'var(--accent-danger)'}">
                    ${emp.active ? '✓ Active' : '✗ Inactive'}
                  </span>
                </td>
                <td style="padding:8px; font-size:0.85rem;">${emp.lastLogin ? formatDateDMY(new Date(emp.lastLogin.seconds * 1000)) : 'Never'}</td>
                <td style="padding:8px;">
                  ${!isCurrentUser ? `
                    <button class="btn btn-ghost" style="padding:4px 8px;font-size:0.8rem;" 
                      onclick="toggleEmployeeStatus('${emp.id}', ${!emp.active})">
                      ${emp.active ? 'Deactivate' : 'Activate'}
                    </button>
                  ` : '<span style="color:var(--text-muted); font-size:0.8rem;">You</span>'}
                </td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
      `;
    }

    // Load invite codes
    const codesSnapshot = await getDocs(collection(db, 'invite_codes'));
    const codes = codesSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(c => !c.used);

    const codesList = document.getElementById('inviteCodesList');

    if (codes.length === 0) {
      codesList.innerHTML = '<p class="text-center text-muted">No active invite codes.</p>';
    } else {
      codesList.innerHTML = `
        <table class="data-table" style="width:100%;">
          <thead>
            <tr>
              <th>Code</th>
              <th>Role</th>
              <th>Created By</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${codes.map(code => {
              const isExpired = new Date(code.expiresAt) < new Date();
              return `
                <tr style="${isExpired ? 'opacity:0.5;' : ''}">
                  <td style="font-family:monospace;">${code.code}</td>
                  <td style="text-transform:capitalize;">${code.role}</td>
                  <td>${escapeHTML(code.createdByName || 'Unknown')}</td>
                  <td style="color:${isExpired ? 'var(--accent-danger)' : 'inherit'}">
                    ${formatDateDMY(new Date(code.expiresAt))}
                    ${isExpired ? ' (Expired)' : ''}
                  </td>
                  <td>
                    <button class="btn btn-ghost" style="padding:4px 8px;font-size:0.8rem;color:var(--accent-danger);"
                      onclick="deleteInviteCode('${code.id}')">
                      Delete
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

  } catch (err) {
    console.error('Error loading employees:', err);
    document.getElementById('employeesList').innerHTML = 
      '<p class="text-center error-message">Failed to load employees.</p>';
  }
});

/**
 * Toggle employee active status
 */
window.toggleEmployeeStatus = async function(employeeId, activate) {
  if (!confirm(`Are you sure you want to ${activate ? 'activate' : 'deactivate'} this employee?`)) {
    return;
  }

  try {
    // Get employee details for audit log
    const empDoc = await getDoc(doc(db, 'employees', employeeId));
    const empData = empDoc.exists() ? empDoc.data() : {};

    await updateDoc(doc(db, 'employees', employeeId), {
      active: activate
    });

    await auditLog(AUDIT_ACTIONS.SETTINGS_CHANGED, {
      action: activate ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED',
      employeeId: employeeId,
      employeeName: empData.name || 'Unknown',
      employeeEmail: empData.email || 'Unknown'
    });

    // Refresh the modal
    document.getElementById('manageEmployeesBtn').click();
  } catch (err) {
    console.error('Error updating employee:', err);
    alert('Failed to update employee status.');
  }
};

/**
 * Change employee role (Admin only)
 */
window.changeEmployeeRole = async function(employeeId, newRole) {
  // Only admins can change roles
  if (currentEmployee?.role !== 'admin') {
    alert('Only administrators can change employee roles.');
    return;
  }

  if (!['staff', 'manager', 'admin'].includes(newRole)) {
    alert('Invalid role selected.');
    return;
  }

  try {
    // Get current employee data for audit
    const empDoc = await getDoc(doc(db, 'employees', employeeId));
    const empData = empDoc.exists() ? empDoc.data() : {};
    const oldRole = empData.role || 'staff';

    if (oldRole === newRole) return; // No change

    // Confirm role change
    const confirmed = confirm(
      `Change ${empData.name || 'this employee'}'s role from ${oldRole.toUpperCase()} to ${newRole.toUpperCase()}?\n\n` +
      `Role permissions:\n` +
      `• Staff: Basic access\n` +
      `• Manager: Can manage employees & invite codes\n` +
      `• Admin: Full access including role changes`
    );

    if (!confirmed) {
      // Revert the dropdown
      document.getElementById('manageEmployeesBtn').click();
      return;
    }

    await updateDoc(doc(db, 'employees', employeeId), {
      role: newRole,
      roleChangedAt: new Date().toISOString(),
      roleChangedBy: currentEmployee.uid
    });

    await auditLog(AUDIT_ACTIONS.SETTINGS_CHANGED, {
      action: 'EMPLOYEE_ROLE_CHANGED',
      employeeId: employeeId,
      employeeName: empData.name || 'Unknown',
      employeeEmail: empData.email || 'Unknown',
      oldRole: oldRole,
      newRole: newRole
    });

    alert(`${empData.name || 'Employee'}'s role changed to ${newRole.toUpperCase()}`);
    
    // Refresh the modal
    document.getElementById('manageEmployeesBtn').click();

  } catch (err) {
    console.error('Error changing employee role:', err);
    alert('Failed to change employee role.');
    // Refresh to revert dropdown
    document.getElementById('manageEmployeesBtn').click();
  }
};

/**
 * Delete invite code
 */
window.deleteInviteCode = async function(codeId) {
  if (!confirm('Are you sure you want to delete this invite code?')) {
    return;
  }

  try {
    await deleteDoc(doc(db, 'invite_codes', codeId));
    
    // Refresh the modal
    document.getElementById('manageEmployeesBtn').click();
  } catch (err) {
    console.error('Error deleting invite code:', err);
    alert('Failed to delete invite code.');
  }
};

// Initialize user menu on load
initializeUserMenu();

} // End of initializeApp function

// Start the application
initializeApp().catch(err => console.error('App initialization failed:', err));