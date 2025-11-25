// Firebase imports are only allowed once. If this file is included multiple times or if you use a bundler, ensure these imports are not duplicated.
if (typeof window.initializeApp === 'undefined') {
  window.initializeApp = undefined; // Defensive: avoid redeclaration
}
// Only import if not already present
if (typeof initializeApp === 'undefined') {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js").then(mod => {
    window.initializeApp = mod.initializeApp;
  });
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(mod => {
    window.getFirestore = mod.getFirestore;
    window.collection = mod.collection;
    window.addDoc = mod.addDoc;
    window.getDocs = mod.getDocs;
    window.doc = mod.doc;
    window.updateDoc = mod.updateDoc;
    window.deleteDoc = mod.deleteDoc;
    window.runTransaction = mod.runTransaction;
    window.enableIndexedDbPersistence = mod.enableIndexedDbPersistence;
    window.onSnapshot = mod.onSnapshot;
    window.getDoc = mod.getDoc;
  });
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js").then(mod => {
    window.getAuth = mod.getAuth;
    window.signInAnonymously = mod.signInAnonymously;
  });
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
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
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// --- Firebase config (replace with your config) ---
const firebaseConfig = {
  apiKey: "AIzaSyCFc_jLIEOQ9iwFeDnjQJTjHYSNQVKwfWo",
  authDomain: "r-system-33a06.firebaseapp.com",
  projectId: "r-system-33a06",
  storageBucket: "r-system-33a06.firebasestorage.app",
  messagingSenderId: "317536373984",
  appId: "1:317536373984:web:01c4aa68bf0da885e45485"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Enable persistence (old API warns; this is fine for now)
try {
  enableIndexedDbPersistence(db).catch((err) => {
    console.warn('IndexedDB persistence unavailable:', err?.message || err);
  });
} catch (e) {
  console.warn('Persistence setup error:', e);
}

// Anonymous sign-in for dev
signInAnonymously(auth).then(() => console.log('✅ Signed in anonymously')).catch(e => console.error('❌ Anonymous login failed:', e));
// Lightweight helper to fetch JSON safely. Checks content-type and returns parsed JSON or throws with helpful logs.
async function fetchJson(url, options = {}) {
  const headers = { ...(options.headers || {}), Accept: 'application/json' };
  const res = await fetch(url, { ...options, headers, credentials: options.credentials || 'include' });

  const text = await res.text();
  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  if (!res.ok) {
    console.error(`${url} returned HTTP ${res.status}:`, text.slice(0, 200));
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  if (!contentType.includes('application/json')) {
    // Not JSON — give a helpful snippet in the console for debugging
    console.warn(`${url} returned non-JSON (content-type: ${contentType || 'unknown'}):`, text.slice(0, 200));
    throw new Error(`Non-JSON response from ${url}`);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('Failed to parse JSON from', url, 'body:', text.slice(0, 300));
    throw err;
  }
}

// QuickBooks check
async function checkQuickBooksLogin() {
  try {
    // Use fetchJson to get a clean JSON parse or throw with diagnostics
    try {
      const data = await fetchJson('/check-token', { method: 'GET' });
      if (!data.loggedIn && data.authUrl) {
        console.log('QuickBooks not logged in. Open auth URL in new tab.');
      } else if (data.loggedIn) {
        console.log('✅ QuickBooks session active');
      }
    } catch (err) {
      // fetchJson already logged helpful diagnostics; keep the warning concise here
      console.warn('QuickBooks login check failed or returned non-JSON:', err.message);
    }
  } catch (err) {
    console.error('❌ Error checking QuickBooks login:', err);
  }
}

setInterval(checkQuickBooksLogin, 15000);
checkQuickBooksLogin();

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


// --- #2: Detect Online/Offline Status ---
window.addEventListener('online', () => {
  console.log("🟢 Back online — syncing data…");
  retryQuickBooksQueue(); // <- Trigger retries for queued QuickBooks jobs
});

window.addEventListener('offline', () => {
  console.log("🔴 Offline — changes will sync later");
});


// Wrap onSnapshot in try/catch and handle permission-denied gracefully
try {
  onSnapshot(collection(db, "reservations"), (snapshot) => {
    const reservations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log("Live reservations update:", reservations);
    // TODO: update your UI grid here
  }, (error) => {
    console.error("Realtime listener error:", error);
    // If permission denied, show a friendly message and do not rethrow
    if (error && error.code === 'permission-denied') {
      console.warn("Firestore permission denied. Please update Firestore rules or authenticate properly.");
      // Optional UI message:
      // showBanner("Firestore permission denied. Check rules or sign-in.");
    }
  });
} catch (err) {
  console.error("Failed to initialize realtime listener:", err);
}




// Centralized helper for incrementing and getting the next receipt number
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
// --- Queue key for localStorage ---
const QB_QUEUE_KEY = "qbSyncQueue";

// Helper: get queue
function getQuickBooksQueue() {
  return JSON.parse(localStorage.getItem(QB_QUEUE_KEY) || "[]");
}

// Helper: save queue
function saveQuickBooksQueue(queue) {
  localStorage.setItem(QB_QUEUE_KEY, JSON.stringify(queue));
}

// Retry any queued syncs when back online
async function retryQuickBooksQueue() {
  const queue = getQuickBooksQueue();
  if (queue.length === 0) return;

  console.log(`🔄 Retrying ${queue.length} QuickBooks sync(s)...`);
  let stillPending = [];

  for (let item of queue) {
    try {
      await sendToQuickBooks(item);
      console.log("✅ Synced to QuickBooks:", item);
    } catch (err) {
      console.warn("❌ QuickBooks retry failed:", err);
      stillPending.push(item);
    }
  }

  saveQuickBooksQueue(stillPending);
}

// Core send function
async function sendToQuickBooks(paymentData) {
  // Use fetchJson for consistent behavior and diagnostics
  return await fetchJson('/payment-to-quickbooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentData),
    credentials: 'include'
  });
}

// Updated pushToQuickBooks with offline queue
async function pushToQuickBooks(paymentData) {
  if (!navigator.onLine) {
    console.warn("Offline — adding QuickBooks job to queue");
    const queue = getQuickBooksQueue();
    queue.push(paymentData);
    saveQuickBooksQueue(queue);
    return; // Don’t error, just queue
  }

  try {
    await sendToQuickBooks(paymentData);
    console.log("✅ Payment successfully sent to QuickBooks.");
  } catch (err) {
    console.warn("QuickBooks sync failed — queued for retry:", err);
    const queue = getQuickBooksQueue();
    queue.push(paymentData);
    saveQuickBooksQueue(queue);
  }
}

// Attach retry to online event
window.addEventListener('online', retryQuickBooksQueue);


// Close handler for Manage Payment modal
document.getElementById("closeManagePaymentBtn").onclick = () => {
  document.getElementById("managePaymentModal").style.display = "none";
};
// Add handler for Cancel button in Manage Payment Modal
const cancelPaymentBtn = document.getElementById("cancelPaymentBtn");
if (cancelPaymentBtn) {
  cancelPaymentBtn.onclick = () => {
    document.getElementById("managePaymentModal").style.display = "none";
  };
}
// 🧾 Manage Payment Modal Logic (global)
async function openManagePaymentModal(reservation) {
  const modal = document.getElementById("managePaymentModal");
  modal.style.display = "block";

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
  const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate, reservation.specialOffer);

  // Fetch all payments for this reservation
  const paymentsSnapshot = await getDocs(collection(db, "payments"));
  const payments = paymentsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => p.reservationId === reservation.id);

  // Use the rate entered at reservation (reservationRate)
  const rate = parseFloat(reservation.rate || 0);
  const total = rate * nights;
  const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  const balance = (total - totalPaid);


  // Fill summary
  document.getElementById("totalPaid").textContent = totalPaid.toFixed(2);
  document.getElementById("balanceRemaining").textContent = Math.max(0, balance).toFixed(2);
  if (document.getElementById("totalDue")) {
    document.getElementById("totalDue").textContent = total.toFixed(2);
  }

  // Fill payment history with Edit buttons
  const historyList = document.getElementById("paymentHistoryList");
  historyList.innerHTML = "";
  payments.forEach(p => {
    const div = document.createElement("div");
    div.className = "payment-entry";
    div.innerHTML = `
      <div><strong>Receipt:</strong> ${p.receiptNumber}</div>
      <div><strong>Amount:</strong> $${parseFloat(p.amount).toFixed(2)}</div>
      <button class="edit-payment-btn" data-id="${p.id}" style="background:#2196f3;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8em;">Edit</button>
    `;
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

// --- Ensure dashboard cards update on load and after changes ---

window.addEventListener('DOMContentLoaded', () => {
  fillDashboard();
});

// Call fillDashboard after payment/reservation changes
async function afterReservationOrPaymentChange() {
  await fillDashboard();
}

// Patch: Call afterReservationOrPaymentChange after relevant actions
// Save Reservation
const origSaveReservationBtnHandler = document.getElementById("saveReservationBtn").onclick;
document.getElementById("saveReservationBtn").addEventListener("click", async (e) => {
  if (typeof origSaveReservationBtnHandler === 'function') await origSaveReservationBtnHandler(e);
  await afterReservationOrPaymentChange();
});

// Save Payment
const origSavePaymentBtnHandler = document.getElementById("savePaymentBtn").onclick;
document.getElementById("savePaymentBtn").onclick = async function() {
  if (typeof origSavePaymentBtnHandler === 'function') await origSavePaymentBtnHandler();
  await afterReservationOrPaymentChange();
};

// Confirm Payment
const origConfirmPaymentBtnHandler = document.getElementById("confirmPaymentBtn").onclick;
document.getElementById("confirmPaymentBtn").onclick = async function() {
  if (typeof origConfirmPaymentBtnHandler === 'function') await origConfirmPaymentBtnHandler();
  await afterReservationOrPaymentChange();
};

// --- Patch summary modal trigger to use openSummaryModal ---
const summaryBtn = document.getElementById("openSummaryModalBtn");
if (summaryBtn) {
  summaryBtn.onclick = () => openSummaryModal();
}

  // Attach edit button events
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

      // Build popup
      const editPopup = document.createElement("div");
      editPopup.style.position = "fixed";
      editPopup.style.left = "50%";
      editPopup.style.top = "50%";
      editPopup.style.transform = "translate(-50%, -50%)";
      editPopup.style.background = "#fff";
      editPopup.style.padding = "20px";
      editPopup.style.borderRadius = "8px";
      editPopup.style.boxShadow = "0 4px 16px rgba(0,0,0,0.2)";
      editPopup.style.zIndex = "3000";
      editPopup.style.width = "300px";

      editPopup.innerHTML = `
        <h3 style="margin-top:0;margin-bottom:12px;">Edit Payment</h3>
        <label>Amount:</label>
        <input id="editPaymentAmount" type="number" step="0.01" value="${paymentData.amount}" style="width:100%;padding:6px;margin-bottom:10px;border:1px solid #ccc;border-radius:4px;">
        <label>Note:</label>
        <textarea id="editPaymentNote" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:4px;">${paymentData.note || ""}</textarea>
        <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
          <button id="cancelEditPayment" style="padding:6px 12px;border:none;background:#ccc;border-radius:4px;cursor:pointer;">Cancel</button>
          <button id="saveEditPayment" style="padding:6px 12px;border:none;background:#4caf50;color:#fff;border-radius:4px;cursor:pointer;">Save</button>
        </div>
      `;
      document.body.appendChild(editPopup);

      document.getElementById("cancelEditPayment").onclick = () => editPopup.remove();

      document.getElementById("saveEditPayment").onclick = async () => {
        const newAmount = parseFloat(document.getElementById("editPaymentAmount").value);
        const newNote = document.getElementById("editPaymentNote").value.trim();
        if (isNaN(newAmount) || newAmount <= 0) {
          alert("Please enter a valid amount.");
          return;
        }
        await updateDoc(paymentRef, {
          amount: newAmount,
          note: newNote
        });
        alert("Payment updated successfully.");
        editPopup.remove();
        openManagePaymentModal(reservation); // Refresh modal
      };
    });
  });

  // 🔹 Email receipt button (unchanged except using reservation.note + specialOffer)
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
    payments.forEach(p => {
      dropdown.innerHTML += `<option value="${p.receiptNumber}">${p.receiptNumber} - $${parseFloat(p.amount).toFixed(2)}</option>`;
    });

    selectModal.style.display = "block";
    closeBtn.onclick = cancelBtn.onclick = () => selectModal.style.display = "none";

    sendSelectedBtn.onclick = async () => {
      const selectedReceipt = dropdown.value;
      if (!selectedReceipt) {
        alert("Please select a receipt to send.");
        return;
      }
      const payment = payments.find(p => p.receiptNumber === selectedReceipt);
      if (!payment) {
        alert("Selected receipt not found.");
        return;
      }

      const templateParams = {
        customer_name: customer.name || '',
        customer_email: customer.email || '',
        customer_phone: customer.telephone || '',
        customer_address: customer.address || '',
        checkin: reservation.arrivalDate,
        checkout: reservation.departureDate,
        room: reservation.roomNumber || '',
        amount_paid: parseFloat(payment.amount).toFixed(2),
        balance: Math.max(0, total - parseFloat(payment.amount)).toFixed(2),
        total_amount: total.toFixed(2),
        receipt_number: payment.receiptNumber,
        special_offer: reservation.specialOffer 
          ? (reservation.specialOffer === '2plus1'
              ? 'Special: Pay for 2 nights get 1 extra night free'
              : reservation.specialOffer === '4plus3'
                ? 'Special: Pay for 4 nights get 3 extra nights free'
                : reservation.specialOffer)
          : 'None',
        notes: reservation.note && reservation.note.trim() !== '' 
          ? `Notes: ${reservation.note}` 
          : 'None'
      };

      try {
        await emailjs.send("service_a10nvxj", "template_zj97crc", templateParams);
        alert("Receipt emailed successfully.");
      } catch (err) {
        console.error("Email error:", err);
        alert("Failed to send receipt.");
      } finally {
        selectModal.style.display = "none";
      }
    };
  });

  // 🔹 Print receipt button (unchanged)
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
    payments.forEach(p => {
      receiptList.innerHTML += `
        <label style="display:block;">
          <input type="checkbox" name="selectedPrintReceipts" value="${p.receiptNumber}">
          Receipt #${p.receiptNumber} - $${parseFloat(p.amount).toFixed(2)} - ${new Date(p.timestamp).toLocaleDateString()}
        </label>
      `;
    });

    printModal.style.display = "block";
    closeBtn.onclick = cancelBtn.onclick = () => printModal.style.display = "none";

    confirmBtn.onclick = () => {
      const selectedReceipts = Array.from(document.querySelectorAll('input[name="selectedPrintReceipts"]:checked'))
        .map(input => input.value);
      if (selectedReceipts.length === 0) {
        alert("Please select at least one receipt to print.");
        return;
      }
      const selectedPayments = payments.filter(p => selectedReceipts.includes(p.receiptNumber));
      const invoiceHTML = generateInvoiceHTML(customer, reservation, selectedPayments, total);
      const container = document.getElementById("printableInvoiceContainer");
      container.innerHTML = invoiceHTML;
      container.style.display = "block";
      window.print();
      container.style.display = "none";
      printModal.style.display = "none";
    };
  });

  // Save new payment (unchanged)
  document.getElementById("savePaymentBtn").onclick = async () => {
    const addAmount = parseFloat(document.getElementById("paymentAmountInput").value);
    if (isNaN(addAmount) || addAmount <= 0) {
      alert("Enter a valid amount.");
      return;
    }
    const receiptCounterRef = doc(db, "counters", "receipt_counter");
    try {
      let receipt = "";
      await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(receiptCounterRef);
        let current = counterDoc.exists() ? counterDoc.data().current : 0;
        const next = current + 1;
        receipt = String(next).padStart(5, "0");
        transaction.update(receiptCounterRef, { current: next });
        const paymentRef = doc(collection(db, "payments"));
        transaction.set(paymentRef, {
          customerId: reservation.customerId,
          reservationId: reservation.id,
          amount: addAmount,
          receiptNumber: receipt,
          timestamp: new Date().toISOString()
        });
        const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate, reservation.specialOffer);
        const total = (parseFloat(reservation.rate) || 0) * nights;
        const paymentsSnapshot = await getDocs(collection(db, "payments"));
        const payments = paymentsSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(p => p.reservationId === reservation.id);
        const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) + addAmount;
        const newStatus = totalPaid >= total ? "fully_paid" : "partially_paid";
        const reservationRef = doc(db, "reservations", reservation.id);
        const updatedPaymentIds = [...(reservation.paymentIds || []), paymentRef.id];
        transaction.update(reservationRef, {
          paymentIds: updatedPaymentIds,
          paymentStatus: newStatus
        });
      });
      document.getElementById("paymentAmountInput").value = "";
      document.getElementById("paymentReceiptInput").value = "";
      await openManagePaymentModal(reservation);
    } catch (err) {
      console.error("Error saving payment:", err);
      alert("Failed to add payment.");
    }
  };
}



// Helper: Generate Unique Receipt Number
function generateReceiptNumber() {
  return "R" + Date.now();
}

// Global variables for payment/receipt
let previewReceiptNumber = null;
let latestReservationId = null;
let latestCustomerId = null;


// 🔄 Global Variables
let customers = [];
let selectedCustomerId = null;


// Allowed rooms for validation
const allowedRooms = [...Array(11).keys()].map(i => (101 + i).toString()).concat([...Array(10).keys()].map(i => (201 + i).toString()));

// Simple phone regex: allows +, digits, spaces, dashes, parentheses (basic check)
const phoneRegex = /^[+\d\s\-()]{7,}$/;

// Load customers from Firestore
async function loadCustomers() {
  const snapshot = await getDocs(collection(db, "customers"));
  customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
await loadCustomers();

// 🔍 Search & Autofill
const searchInput = document.getElementById("searchName");
const suggestionsBox = document.getElementById("suggestions");

searchInput.addEventListener("input", () => {
  const term = searchInput.value.toLowerCase();
  suggestionsBox.innerHTML = "";

  // Style the suggestions box container
  suggestionsBox.style.position = "absolute";
  suggestionsBox.style.background = "#fff";
  suggestionsBox.style.border = "1px solid #ccc";
  suggestionsBox.style.borderRadius = "6px";
  suggestionsBox.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
  suggestionsBox.style.marginTop = "2px";
  suggestionsBox.style.zIndex = "1000";
  suggestionsBox.style.minWidth = searchInput.offsetWidth + "px";
  suggestionsBox.style.maxHeight = "220px";
  suggestionsBox.style.overflowY = "auto";

  if (term.length < 1) {
    suggestionsBox.style.display = "none";
    return;
  }

  const matches = customers.filter(c => c.name.toLowerCase().includes(term));
  if (matches.length > 0) {
    suggestionsBox.style.display = "block";
    matches.forEach(c => {
      const div = document.createElement("div");
      div.classList.add("suggestion-item");
      div.textContent = `${c.name} (${c.address})`;
      // Style each suggestion item
      div.style.padding = "10px 16px";
      div.style.cursor = "pointer";
      div.style.borderBottom = "1px solid #f0f0f0";
      div.style.background = "#f9f9f9";
      div.style.transition = "background 0.2s";
      div.addEventListener("mouseenter", () => {
        div.style.background = "#e6f0ff";
      });
      div.addEventListener("mouseleave", () => {
        div.style.background = "#f9f9f9";
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

//AUTOFILLL
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

// Real-time validation helpers for form fields
function validateName(name) {
  return name.trim().length >= 3;
}
function validateAddress(address) {
  return address.trim().length >= 3;
}
function validateTelephone(tel) {
  return phoneRegex.test(tel.trim());
}
function validateRoom(room) {
  return allowedRooms.includes(room.trim());
}
function validateDates(arrival, departure) {
  if (!arrival || !departure) return false;

  const arrDate = new Date(arrival);
  const depDate = new Date(departure);

  // Allow past dates, only disallow if arrival is after departure
  return arrDate <= depDate;
}

// 📝 Save Reservation (with payment prompt integration)
document.getElementById("saveReservationBtn").addEventListener("click", async (e) => {
  e.preventDefault();

  const name = document.getElementById("name").value.trim();
  const address = document.getElementById("address").value.trim();
  const telephone = document.getElementById("telephone").value.trim();
  const email = document.getElementById("customer-email").value.trim();
  const arrivalDate = document.getElementById("arrival").value;
  const departureDate = document.getElementById("departure").value;
  const roomNumber = document.getElementById("room").value.trim();
  const rate = parseFloat(document.getElementById("reservationRate").value);
  const specialOffer = document.getElementById("specialOffer").value;
  const note = document.getElementById("reservationNote").value || "";

  if (isNaN(rate) || rate < 0) {
    alert("Please enter a valid nightly rate.");
    return;
  }



// Validate offer match with selected dates
if (specialOffer && !calculateSpecialNights(arrivalDate, departureDate, specialOffer)) {
  alert("Selected special requires specific number of nights. Please adjust your dates.");
  return;
}




// Placeholder for checkOverlapAllowSameDayOrReplaceUnpaid
async function checkOverlapAllowSameDayOrReplaceUnpaid(roomNumber, arrivalDate, departureDate) {
  // TODO: Implement logic to check for overlapping reservations and handle unpaid ones
  console.warn("checkOverlapAllowSameDayOrReplaceUnpaid is a placeholder function. Implement its logic.");
  return false; // Placeholder: assume no overlap for now
}

  // Validate all fields and show specific alerts
  if (!name || !address || !telephone || !arrivalDate || !departureDate || !roomNumber) {
    alert("Please fill in all fields.");
    return;
  }
  if (!validateName(name)) {
    alert("Name must be at least 3 characters.");
    return;
  }
  if (!validateAddress(address)) {
    alert("Address must be at least 3 characters.");
    return;
  }
  if (!validateTelephone(telephone)) {
    alert("Please enter a valid telephone number.");
    return;
  }
  if (!validateRoom(roomNumber)) {
    alert(`Room number must be one of: ${allowedRooms.join(", ")}`);
    return;
  }
  if (!validateDates(arrivalDate, departureDate)) {
    alert("Please enter valid arrival and departure dates. Arrival cannot be after departure or be in the past.");
    return;
  }

 // Overlapping check with unpaid override allowed
const overlapping = await checkOverlapAllowSameDayOrReplaceUnpaid(roomNumber, arrivalDate, departureDate);
if (overlapping) {
  alert("Overlapping reservation exists for the selected room and dates.");
  return;
}

// Overlap check that deletes unpaid reservations if conflict
async function checkOverlapAllowSameDayOrReplaceUnpaid(room, arrival, departure) {
  const snapshot = await getDocs(collection(db, "reservations"));
  const all = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

  const newArr = new Date(arrival);
  const newDep = new Date(departure);

  for (let res of all) {
    if (res.roomNumber !== room) continue;

    const resArr = new Date(res.arrivalDate);
    const resDep = new Date(res.departureDate);

    // Overlap condition (allow same-day check-in after checkout)
    const isOverlap = !(newDep < resArr || newArr >= resDep);
    if (!isOverlap) continue;

    // If reservation has payments, block
    if (res.paymentStatus && res.paymentStatus !== "unpaid") {
      return true; // block new reservation
    }

    // If unpaid → delete it so we can override
    await deleteDoc(doc(db, "reservations", res.id));
    console.log(`🗑 Deleted unpaid overlapping reservation: ${res.id}`);
  }

  return false; // no blocking paid overlaps found
}



  // Placeholder for future: remove unpaid reservation if slot is taken
  await replaceUnpaidReservationIfConflict(roomNumber, arrivalDate, departureDate);

  try {
    let customerId = selectedCustomerId;
    if (!customerId) {
      // Add new customer and update global list immediately
      const newCustomer = await addDoc(collection(db, "customers"), { name, address, telephone, email });
      customerId = newCustomer.id;
      await loadCustomers();  // Refresh customers immediately so new one is searchable
    }

    // Add reservation with payment fields, including rate
    const reservationDoc = await addDoc(collection(db, "reservations"), {
      customerId,
      arrivalDate,
      departureDate,
      roomNumber,
      specialOffer,
      note,
      rate, // <-- Save the rate
      paymentStatus: "unpaid",
      paymentIds: []
    });

    alert("Reservation saved successfully.");
    latestCustomerId = customerId;
    latestReservationId = reservationDoc.id;
    previewReceiptNumber = generateReceiptNumber();
    document.getElementById("paymentPromptModal").style.display = "block";

    // Clear form manually
    document.getElementById("searchName").value = "";
    document.getElementById("name").value = "";
    document.getElementById("address").value = "";
    document.getElementById("telephone").value = "";
    document.getElementById("arrival").value = "";
    document.getElementById("departure").value = "";
    document.getElementById("room").value = "";

    selectedCustomerId = null;
    document.getElementById("addReservationModal").style.display = "none";

    // 🔹 Reset ID preview
  document.getElementById("customerIdPreview").innerHTML =
  `<span style="font-size:0.9em; color:#666;">No ID on file</span>`;


  } catch (err) {
    console.error("Error saving reservation:", err);
    alert("Failed to save reservation.");
  }
});

// Helper: Preview next receipt number

async function getNextPreviewReceiptNumber() {
  const receiptDoc = await getDoc(doc(db, "counters", "receipt_counter"));
  const current = receiptDoc.exists() ? receiptDoc.data().current : 0;
  return String(current + 1).padStart(5, "0");
}

// Payment Prompt Modal Button Logic
document.getElementById("yesPaymentBtn").addEventListener("click", async () => {
  previewReceiptNumber = await getNextPreviewReceiptNumber();
  document.getElementById("previewReceiptNumber").value = previewReceiptNumber;
  document.getElementById("paymentPromptModal").style.display = "none";
  document.getElementById("addPaymentModal").style.display = "block";
});

document.getElementById("noPaymentBtn").addEventListener("click", () => {
  document.getElementById("paymentPromptModal").style.display = "none";
});

// Payment Modal Close Buttons
document.getElementById("closeAddPaymentBtn").addEventListener("click", () => {
  document.getElementById("addPaymentModal").style.display = "none";

  const customer = customers.find(c => c.id === latestCustomerId);
  if (customer?.idImageUrl) {
    // 🔹 Already has ID → go straight to registration form preview
    showRegistrationFormWithSavedId(customer);
  } else {
    // 🔹 No ID yet → prompt to upload
    document.getElementById("registrationPromptModal").style.display = "block";
  }
});

document.getElementById("closePaymentPromptBtn").addEventListener("click", () => {
  document.getElementById("paymentPromptModal").style.display = "none";
});

// Confirm & Save Payment
document.getElementById("confirmPaymentBtn").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("paymentAmount").value);
  const method = document.getElementById("paymentMethod").value;
  if (isNaN(amount) || amount <= 0) {
    alert("Enter a valid amount.");
    return;
  }
  if (!method) {
    alert("Please select a payment method.");
    return;
  }

  try {
    const receipt = await getNextReceiptNumber();

    const resDoc = await getDoc(doc(db, "reservations", latestReservationId));
    const reservation = resDoc.exists() ? { id: resDoc.id, ...resDoc.data() } : null;

    // Save payment with method
    const paymentRef = await addDoc(collection(db, "payments"), {
      customerId: latestCustomerId,
      reservationId: latestReservationId,
      receiptNumber: receipt,
      amount,
      method, // ✅ save payment method
      timestamp: new Date().toISOString()
    });

    // Recompute paid/remaining to set paymentStatus
    const paymentsSnapshot = await getDocs(collection(db, "payments"));
    const payments = paymentsSnapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.reservationId === latestReservationId);

    const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate, reservation.specialOffer);
    const totalDue = (parseFloat(reservation.rate) || 0) * nights;
    const totalPaid = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const newStatus = totalPaid >= totalDue ? "fully_paid" : "partially_paid";

    await updateDoc(doc(db, "reservations", latestReservationId), {
      paymentStatus: newStatus,
      paymentIds: [...(reservation.paymentIds || []), paymentRef.id]
    });

    alert("Payment successful. Receipt #" + receipt);

    //CALL
    const customer = customers.find(c => c.id === latestCustomerId);
    const balance = Math.max(0, totalDue - totalPaid).toFixed(2);
    showEmailConfirmationPopup(reservation, customer, receipt, amount, balance, nights);

    // Cleanup after transaction
    document.getElementById("paymentAmount").value = "";
    document.getElementById("previewReceiptNumber").value = "";
    previewReceiptNumber = null;
    document.getElementById("addPaymentModal").style.display = "none";
    document.getElementById("registrationPromptModal").style.display = "block";

    // Sync to QuickBooks after successful payment
    if (reservation && customer) {
      await pushToQuickBooks({
        name: customer.name,
        email: customer.email,
        phone: customer.telephone,
        address: customer.address,
        customerNumber: customer.customerNumber,
        amount: amount,
        receiptNumber: receipt,
        date: new Date().toISOString().split("T")[0],
        room: reservation.roomNumber,
        checkin: reservation.arrivalDate,
        checkout: reservation.departureDate,
        notes: reservation.notes,
        specialOffer: reservation.specialOffer
      });
    }
  } catch (err) {
    console.error("Transaction failed:", err);
    alert("Failed to process payment.");
  }
});


//workflow modal handlers
document.getElementById("continueToIdUploadBtn").onclick = async () => {
  const customer = customers.find(c => c.id === latestCustomerId);

  if (customer?.idImageUrl) {
    // 🔹 Skip upload → go straight to form preview with saved ID
    document.getElementById("registrationPromptModal").style.display = "none";
    await showRegistrationFormWithSavedId(customer);
    return;
  }

  // 🔹 Otherwise: normal upload flow
  uploadedIdFile = null;
  latestCroppedImageDataUrl = null;
  document.getElementById("idUploadInput").value = "";
  document.getElementById("registrationPromptModal").style.display = "none";
  document.getElementById("idUploadModal").style.display = "block";
};


document.getElementById("cancelIdUploadBtn").onclick = () => {
  document.getElementById("idUploadModal").style.display = "none";
};

//FIle upload and open crop tool
document.getElementById("idUploadInput").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;

  uploadedIdFile = file;
  const reader = new FileReader();
  reader.onload = function (event) {
    document.getElementById("idCropImage").src = event.target.result;
    document.getElementById("idUploadModal").style.display = "none";
    document.getElementById("idCropModal").style.display = "block";

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
document.getElementById("cancelCropBtn").onclick = () => {
  cropperInstance?.destroy();
  cropperInstance = null;
  document.getElementById("idCropModal").style.display = "none";
};

document.getElementById("cropAndContinueBtn").onclick = async () => {
  if (!cropperInstance) return;

  const canvas = cropperInstance.getCroppedCanvas({
    width: 300,
    height: 200,
  });

  latestCroppedImageDataUrl = canvas.toDataURL("image/jpeg");
  cropperInstance.destroy();
  cropperInstance = null;

  document.getElementById("idCropModal").style.display = "none";

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
    relatedPayments = allPayments.filter(p => p.reservationId === reservation.id);
  } catch (err) {
    console.error("Error fetching payments:", err);
    relatedPayments = [];
  }

  const sortedPayments = relatedPayments.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const rate = parseFloat(reservation.rate || 0);
  const arrival = new Date(reservation.arrivalDate);
  const departure = new Date(reservation.departureDate);
  const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate, reservation.specialOffer);
  const totalDue = (parseFloat(reservation.rate) || 0) * nights;
  const totalPaid = relatedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  let balanceRemaining = Math.max(0, totalDue - totalPaid);
  if (balanceRemaining < 0) balanceRemaining = 0;


  const paymentSummary = {
    totalPaid,
    totalDue,
    balanceRemaining,
    receiptNumber: sortedPayments[0]?.receiptNumber || "—",
    receipts: sortedPayments.slice(0, 4).map(p => ({
      number: p.receiptNumber || "—",
      date: p.timestamp?.split("T")[0] || "—",
      amount: p.amount || "0.00"
    }))
  };

const idToUse = customer?.idImageUrl || latestCroppedImageDataUrl || null;
const html = buildRegistrationFormHTML(reservation, customer, idToUse, paymentSummary);


  const previewContainer = document.getElementById("formPreviewContent");
  previewContainer.innerHTML = `
    <div class="registration-form">${html}</div>
    <div class="registration-form" style="page-break-before:always;">${html}</div>
  `;

  document.getElementById("registrationFormPreviewModal").style.display = "block";
};

// Overlapping check allowing same-day check-in after checkout
async function checkOverlapAllowSameDay(room, arrival, departure) {
  const snapshot = await getDocs(collection(db, "reservations"));
  const all = snapshot.docs.map(doc => doc.data());

  // Compare dates allowing check-in on same day as previous guest checks out
  return all.some(res => {
    if (res.roomNumber !== room) return false;

    const resArr = new Date(res.arrivalDate);
    const resDep = new Date(res.departureDate);
    const newArr = new Date(arrival);
    const newDep = new Date(departure);

    // Overlap if:
    // NOT (newDep < resArr OR newArr > resDep)
    // BUT same-day allowed, so newArr == resDep is allowed
    // So overlap if newDep >= resArr AND newArr < resDep
    return !(newDep < resArr || newArr >= resDep);
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

// 📁 Load Reservations
async function loadReservations() {
  const snapshot = await getDocs(collection(db, "reservations"));
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Modal Open/Close handlers
document.getElementById("openAddReservationBtn").addEventListener("click", () => {
  document.getElementById("addReservationModal").style.display = "block";
});
document.getElementById("closeAddReservationBtn").addEventListener("click", () => {
  document.getElementById("addReservationModal").style.display = "none";
});
document.getElementById("showAvailabilityBtn").addEventListener("click", () => {
  document.getElementById("availabilityModal").style.display = "block";
});
document.getElementById("closeAvailabilityBtn").addEventListener("click", () => {
  document.getElementById("availabilityModal").style.display = "none";
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
  const modal = document.getElementById('addReservationModal');
  if (modal) modal.style.display = 'none';
}

document.getElementById("clearReservationFormBtn").onclick = () => {
  clearAddReservationForm();
};

window.addEventListener("click", (e) => {
  // Disable click-outside-to-close for important modals
  const blockCloseIds = ["paymentPromptModal", "addPaymentModal"];
  for (let id of blockCloseIds) {
    if (e.target.id === id) return;
  }

  // Normal modals
  if (e.target.id === "addReservationModal") {
    document.getElementById("addReservationModal").style.display = "none";
  }
  if (e.target.id === "availabilityModal") {
    document.getElementById("availabilityModal").style.display = "none";
  }
  if (e.target.id === "editDeletePopup") {
    document.getElementById("editDeletePopup").style.display = "none";
  }
  if (e.target.id === "managePaymentModal") {
    document.getElementById("managePaymentModal").style.display = "none";
  }
});



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
  const header = document.createElement("tr");
  header.innerHTML = `<th>Room \\ Date</th>` + dates.map(d => `<th>${d}</th>`).join("");
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
        if (res.paymentStatus === "unpaid") {
          button.style.background = "red";
        } else if (res.paymentStatus === "partially_paid") {
          button.style.background = "blue";
        } else {
          button.style.background = "green"; // fully paid
        }
        button.style.border = "none";
        button.style.padding = "2px 5px";
        button.style.cursor = "pointer";
        button.title = `Reservation`;
        button.addEventListener("click", () => showEditDeletePopup(res));
        cell.appendChild(button);
      } else {
        cell.style.backgroundColor = "#ccffcc";
      }

      row.appendChild(cell);
    }

    table.appendChild(row);
  }

  grid.appendChild(table);
}


function showEditDeletePopup(reservation) {
  const customer = customers.find(c => c.id === reservation.customerId);

  function calculateNights(arrival, departure) {
    const start = new Date(arrival);
    const end = new Date(departure);
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  }

  const popup = document.createElement("div");
  popup.style.position = "fixed";
  popup.style.left = "50%";
  popup.style.top = "50%";
  popup.style.transform = "translate(-50%, -50%)";
  popup.style.background = "#f8fafd";
  popup.style.color = "#222";
  popup.style.padding = "32px 28px";
  popup.style.border = "1.5px solid #b3c6e0";
  popup.style.zIndex = "2000";
  popup.style.borderRadius = "16px";
  popup.style.boxShadow = "0 4px 24px rgba(0,0,0,0.13)";
  popup.style.maxHeight = "90vh";
  popup.style.overflowY = "auto";
  popup.style.width = "500px";
  popup.style.fontSize = "17px";
  popup.style.fontFamily = "Segoe UI, Arial, sans-serif";

  popup.innerHTML = `
    <h2 style="margin-top:0;margin-bottom:18px;font-size:1.4em;color:#2a4d7a;text-align:center;">Edit or Delete Reservation</h2>

    <div style="background:#f1f5fb;padding:14px 16px;border-radius:10px;margin-bottom:20px;color:#222;">
      <div style="margin-bottom:6px;"><strong>Name:</strong> ${customer?.name || 'Unknown'}</div>
      <div style="margin-bottom:6px;"><strong>Phone:</strong> ${customer?.telephone || 'N/A'}</div>
      <div style="margin-bottom:6px;"><strong>Address:</strong> ${customer?.address || 'N/A'}</div>
      <div style="margin-bottom:6px;"><strong>Nights:</strong> ${calculateNights(reservation.arrivalDate, reservation.departureDate)}</div>
      <div><strong>Note:</strong> ${reservation.note || 'None'}</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:18px;">
      <div>
        <label style="font-weight:500;display:block;margin-bottom:6px;">Room</label>
        <input id="editRoom" value="${reservation.roomNumber}" style="width:100%;padding:8px 10px;border:1px solid #b3c6e0;border-radius:6px;font-size:1em;" />
      </div>
      <div>
        <label style="font-weight:500;display:block;margin-bottom:6px;">Check-in</label>
        <input type="date" id="editArrival" value="${reservation.arrivalDate}" style="width:100%;padding:8px 10px;border:1px solid #b3c6e0;border-radius:6px;font-size:1em;" />
      </div>
      <div>
        <label style="font-weight:500;display:block;margin-bottom:6px;">Checkout</label>
        <input type="date" id="editDeparture" value="${reservation.departureDate}" style="width:100%;padding:8px 10px;border:1px solid #b3c6e0;border-radius:6px;font-size:1em;" />
      </div>
      <div>
        <label style="font-weight:500;display:block;margin-bottom:6px;">Special Offer</label>
        <select id="editSpecialOffer" style="width:100%;padding:8px 10px;border:1px solid #b3c6e0;border-radius:6px;font-size:1em;">
          <option value="">None</option>
          <option value="2plus1">Pay 2 Nights Get 1 Free</option>
          <option value="4plus3">Pay 4 Nights Get 3 Free</option>
        </select>
      </div>
    </div>

    <div style="margin-top:28px; display:flex; flex-wrap:wrap; justify-content:flex-end; gap:12px;">
      <button id="extendReservationBtn" style="background:#7e57c2;color:#fff;padding:8px 18px;border:none;border-radius:6px;font-size:1em;cursor:pointer;">🛌 Extend Reservation</button>
      <button id="managePaymentBtn" style="background:#ffa726;color:#000;padding:8px 18px;border:none;border-radius:6px;font-size:1em;cursor:pointer;">💳 Manage Payment</button>
      <button id="saveEditBtn" style="background:#2a4d7a;color:#fff;padding:8px 18px;border:none;border-radius:6px;font-size:1em;cursor:pointer;">💾 Save</button>
      <button id="deleteBtn" style="background:#e74c3c;color:#fff;padding:8px 18px;border:none;border-radius:6px;font-size:1em;cursor:pointer;">🗑 Delete</button>
      <button id="cancelPopup" style="background:#eee;color:#222;padding:8px 18px;border:none;border-radius:6px;font-size:1em;cursor:pointer;">Cancel</button>
      <button id="printRegistrationFromEditBtn" 
        style="background:#4caf50;color:#fff;padding:8px 18px;border:none;border-radius:6px;font-size:1em;cursor:pointer;">
        📄 Print Guest Registration Form
      </button>
    </div>
  `;

  document.body.appendChild(popup);

  // --- Print button handler ---
  document.getElementById("printRegistrationFromEditBtn").onclick = async () => {
    const customer = customers.find(c => c.id === reservation.customerId) || {};
    popup.remove(); // close edit popup

    // ✅ If ID exists, skip upload
    if (customer.idImageUrl) {
      await showFormPreview(reservation, customer, customer.idImageUrl);
      return;
    }

    // ❌ If no ID yet, ask to upload
    document.getElementById("idUploadModal").style.display = "block";

    document.getElementById("cropAndContinueBtn").onclick = async () => {
      if (!cropperInstance) return;
      const canvas = cropperInstance.getCroppedCanvas({ width: 300, height: 200 });
      const croppedImageDataURL = canvas.toDataURL("image/jpeg");

      cropperInstance.destroy();
      cropperInstance = null;
      document.getElementById("idCropModal").style.display = "none";

      // Save ID
      await updateDoc(doc(db, "customers", reservation.customerId), {
        idImageUrl: croppedImageDataURL
      });
      const idx = customers.findIndex(c => c.id === reservation.customerId);
      if (idx !== -1) customers[idx].idImageUrl = croppedImageDataURL;

      await showFormPreview(reservation, customer, croppedImageDataURL);
    };
  };

  // Pre-fill special offer
  document.getElementById("editSpecialOffer").value = reservation.specialOffer || "";

  // Cancel popup
  document.getElementById("cancelPopup").onclick = () => popup.remove();

  // Delete
  document.getElementById("deleteBtn").onclick = async () => {
    if (!confirm("Are you sure you want to delete this reservation?")) return;
    await deleteDoc(doc(db, "reservations", reservation.id));
    alert("Deleted.");
    popup.remove();
    renderAvailabilityGrid();
  };

  // Save edits
  document.getElementById("saveEditBtn").onclick = async () => {
    const room = document.getElementById("editRoom").value.trim();
    const arrival = document.getElementById("editArrival").value;
    const departure = document.getElementById("editDeparture").value;
    const specialOffer = document.getElementById("editSpecialOffer").value;

    if (!room || !arrival || !departure) {
      alert("All fields are required.");
      return;
    }

    await updateDoc(doc(db, "reservations", reservation.id), {
      roomNumber: room,
      arrivalDate: arrival,
      departureDate: departure,
      specialOffer
    });

    alert("Reservation updated.");
    popup.remove();
    renderAvailabilityGrid();
  };

  // Manage payment
  document.getElementById("managePaymentBtn").onclick = async () => {
    popup.remove();
    await openManagePaymentModal(reservation);
  };

  // Extend
  document.getElementById("extendReservationBtn").onclick = () => {
    popup.remove();
    openExtendReservationModal(reservation);
  };
}

window.showEditDeletePopup = showEditDeletePopup;


// --- Unified openExtendReservationModal(reservation) ---
async function openExtendReservationModal(reservation) {
  // Close any stray edit popup if present (defensive)
  const currentEditModal = document.querySelector('div[style*="position: fixed"][data-editpopup="true"]');
  if (currentEditModal) currentEditModal.remove();

  // Grab modal element
  const modal = document.getElementById("extendReservationModal");
  if (!modal) {
    alert("Extend modal not found.");
    return;
  }

  // Ensure modal is visible and on top
  modal.style.display = "block";
  modal.style.zIndex = "2200";

  // Prefill fields
  document.getElementById("extendDeparture").value = reservation.departureDate || "";
  document.getElementById("extendSpecialOffer").value = reservation.specialOffer || "";
  document.getElementById("extendPaymentRate").value = reservation.rate || "";
  document.getElementById("extendPaymentAmount").value = "";

  // PREVIEW next receipt number (do not reserve)
  try {
    const preview = await getNextPreviewReceiptNumber();
    document.getElementById("extendReceiptNumber").value = preview;
  } catch (err) {
    console.warn("Preview receipt fetch failed", err);
    document.getElementById("extendReceiptNumber").value = "";
  }

  // Close handlers
  document.getElementById("closeExtendReservationBtn").onclick =
  document.getElementById("cancelExtendReservationBtn").onclick = () => {
    modal.style.display = "none";
  };

// ✅ Normalize date helper (fix timezone issues)
function normalizeDate(d) {
  const parts = d.split("-");
  return new Date(parts[0], parts[1] - 1, parts[2]); // yyyy-mm-dd → local midnight
}

// ✅ Helper: Check for overlapping reservations
async function hasOverlap(reservationId, roomNumber, newArrival, newDeparture) {
  const snapshot = await getDocs(collection(db, "reservations"));
  const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const newArr = normalizeDate(newArrival);
  const newDep = normalizeDate(newDeparture);

  for (let res of all) {
    if (res.id === reservationId) continue; // skip same reservation
    if (res.roomNumber !== roomNumber) continue;

    const resArr = normalizeDate(res.arrivalDate);
    const resDep = normalizeDate(res.departureDate);

    // Overlap if NOT (newDep < resArr OR newArr > resDep)
    if (!(newDep < resArr || newArr > resDep)) {
      return true;
    }
  }
  return false;
}

// 🔹 Shared extension save logic
async function saveExtension(reservation, modal, { newDeparture, offer, rate, amount }) {
  let finalReceipt = null;

  // 1) Update reservation with new departure, rate, offer
  await updateDoc(doc(db, "reservations", reservation.id), {
    departureDate: newDeparture,
    specialOffer: offer || (reservation.specialOffer || ""),
    ...(rate !== null ? { rate } : {})
  });

  // 2) Add payment record (ONLY if valid amount entered)
  if (!isNaN(amount) && amount > 0) {
    finalReceipt = await getNextReceiptNumber();
    document.getElementById("extendReceiptNumber").value = finalReceipt;

    await addDoc(collection(db, "payments"), {
      customerId: reservation.customerId,
      reservationId: reservation.id,
      receiptNumber: finalReceipt,
      amount,
      rate: rate || reservation.rate || null,
      note: reservation.note || "",
      timestamp: new Date().toISOString()
    });

    // 3) Push to QuickBooks
    const customer = customers.find(c => c.id === reservation.customerId) || {};
    await pushToQuickBooks({
      name: customer.name,
      email: customer.email,
      phone: customer.telephone,
      address: customer.address,
      customerNumber: customer.customerNumber,
      amount: amount,
      receiptNumber: finalReceipt,
      date: new Date().toISOString().split("T")[0],
      room: reservation.roomNumber,
      checkin: reservation.arrivalDate,
      checkout: newDeparture,
      notes: reservation.note || "",
      specialOffer: offer || reservation.specialOffer
    });
  }

  // 4) Refresh UI
  await renderAvailabilityGrid();

  return finalReceipt;
}

// 🔹 Confirm (save only)
const confirmBtn = document.getElementById("confirmExtendReservationBtn");
confirmBtn.onclick = async () => {
  const newDeparture = document.getElementById("extendDeparture").value;
  const offer = document.getElementById("extendSpecialOffer").value;
  const rate = parseFloat(document.getElementById("extendPaymentRate").value) || null;
  const amount = parseFloat(document.getElementById("extendPaymentAmount").value);

  // ✅ Validations
  if (!newDeparture) {
    alert("Please select a new departure date.");
    return;
  }
  if (!amount || isNaN(amount) || amount <= 0) {
    alert("Please enter the 'Amount Being Paid' before confirming extension.");
    return;
  }
  if (offer && !calculateSpecialNightsForExtension(reservation.departureDate, newDeparture, offer)) {
    alert("Special offer duration does not match the selected extension.");
    return;
  }

  // 🚫 Ensure no overlap
  const overlap = await hasOverlap(reservation.id, reservation.roomNumber, reservation.arrivalDate, newDeparture);
  if (overlap) {
    alert("Cannot extend reservation. Overlap with another booking.");
    return;
  }

  try {
    const finalReceipt = await saveExtension(reservation, modal, { newDeparture, offer, rate, amount });
    alert("Extension saved with payment. Receipt #" + finalReceipt);
    modal.style.display = "none";
  } catch (err) {
    console.error("Failed to save extension:", err);
    alert("Failed to save extension. See console.");
  }
};

// 🔹 Confirm & Print
const confirmPrintBtn = document.getElementById("confirmExtendAndPrintBtn");
if (confirmPrintBtn) {
  confirmPrintBtn.onclick = async () => {
    const newDeparture = document.getElementById("extendDeparture").value;
    const offer = document.getElementById("extendSpecialOffer").value;
    const rate = parseFloat(document.getElementById("extendPaymentRate").value) || null;
    const amount = parseFloat(document.getElementById("extendPaymentAmount").value);

    // ✅ Validations
    if (!newDeparture) {
      alert("Please select a new departure date.");
      return;
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      alert("Please enter the 'Amount Being Paid' before confirming extension.");
      return;
    }
    if (offer && !calculateSpecialNightsForExtension(reservation.departureDate, newDeparture, offer)) {
      alert("Special offer duration does not match the selected extension.");
      return;
    }

    // 🚫 Ensure no overlap
    const overlap = await hasOverlap(reservation.id, reservation.roomNumber, reservation.arrivalDate, newDeparture);
    if (overlap) {
      alert("Cannot extend reservation. Overlap with another booking.");
      return;
    }

    try {
      const finalReceipt = await saveExtension(reservation, modal, { newDeparture, offer, rate, amount });
      modal.style.display = "none";
      printReceipt(finalReceipt);
    } catch (err) {
      console.error("Failed to save extension:", err);
      alert("Failed to save extension. See console.");
    }
  };
}

// 🔹 Availability Grid with fixed date validation
async function renderAvailabilityGrid() {
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;

  if (!start || !end) {
    alert("Please select a valid date range.");
    return;
  }

  const startDate = normalizeDate(start);
  const endDate = normalizeDate(end);

  if (startDate > endDate) {
    alert("Please select a valid date range.");
    return;
  }

  const rooms = [...Array(11).keys()].map(i => (101 + i).toString())
    .concat([...Array(10).keys()].map(i => (201 + i).toString()));

  const dates = getDateRange(start, end);
  const reservations = await loadReservations();
  const grid = document.getElementById("availabilityGrid");
  grid.innerHTML = "";

  const table = document.createElement("table");
  const header = document.createElement("tr");
  header.innerHTML = `<th>Room \\ Date</th>` + dates.map(d => `<th>${d}</th>`).join("");
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
        if (res.paymentStatus === "unpaid") {
          button.style.background = "red";
        } else if (res.paymentStatus === "partially_paid") {
          button.style.background = "blue";
        } else {
          button.style.background = "green"; // fully paid
        }
        button.style.border = "none";
        button.style.padding = "2px 5px";
        button.style.cursor = "pointer";
        button.title = `Reservation`;
        button.addEventListener("click", () => showEditDeletePopup(res));
        cell.appendChild(button);
      } else {
        cell.style.backgroundColor = "#ccffcc";
      }

      row.appendChild(cell);
    }

    table.appendChild(row);
  }

  grid.appendChild(table);
}
}

// Overlap check excluding current reservation, allowing same-day check-in after checkout
async function checkOverlapExceptAllowSameDay(currentId, room, arrival, departure) {
  const snapshot = await getDocs(collection(db, "reservations"));
  const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return all.some(res =>
    res.id !== currentId &&
    res.roomNumber === room &&
    !(new Date(departure) < new Date(res.arrivalDate) || new Date(arrival) >= new Date(res.departureDate))
  );
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
document.getElementById("downloadCsvBtn").addEventListener("click", () => {
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
document.getElementById("printGridBtn").addEventListener("click", () => {
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


// --- 1. Search Customer Button & Popups (using existing HTML) ---
document.getElementById("searchCustomerBtn").onclick = async () => {
  await loadCustomers();
  showCustomerListModal();
};

function showCustomerListModal() {
  const modal = document.getElementById("searchCustomerModal");
  const list = document.getElementById("customerListContainer");
  const searchInput = document.getElementById("customerSearchInput");
  const confirmBtn = document.getElementById("confirmCustomerSelectionBtn");
  let selectedCustomer = null;
  const sorted = [...customers].sort((a, b) => ((a.name||"").toLowerCase()).localeCompare((b.name||"").toLowerCase()));
  function renderList(filter = "") {
    list.innerHTML = "";
    const filtered = sorted.filter(c => (c.name || "").toLowerCase().includes(filter.toLowerCase()));
    filtered.forEach(c => {
      const div = document.createElement("div");
      div.textContent = c.name;
      div.className = "customer-list-item";
      div.style.padding = "8px 12px";
      div.style.cursor = "pointer";
      div.style.borderBottom = "1px solid #eee";
      div.onclick = () => {
        Array.from(list.children).forEach(child => child.style.background = "");
        div.style.background = "#e6f0ff";
        selectedCustomer = c;
        confirmBtn.disabled = false;
      };
      list.appendChild(div);
    });
    confirmBtn.disabled = true;
    selectedCustomer = null;
  }
  renderList();
  searchInput.value = "";
  searchInput.oninput = () => renderList(searchInput.value);
  confirmBtn.onclick = () => {
    if (selectedCustomer) {
      modal.style.display = "none";
      showCustomerDetailsModal(selectedCustomer);
    }
  };
  document.getElementById("closeSearchCustomerBtn").onclick = () => modal.style.display = "none";
  modal.style.display = "block";
}

function showCustomerDetailsModal(customer) {
  const modal = document.getElementById("customerDetailsModal");
  const info = document.getElementById("customerDetailFields");

  // Fill fields
  info.innerHTML = `
    <div><strong>Name:</strong> ${customer.name || ""}</div>
    <div><strong>Phone:</strong> ${customer.telephone || ""}</div>
    <div><strong>Address:</strong> ${customer.address || ""}</div>
    <div><strong>Email:</strong> ${customer.email || "N/A"}</div>
    <div><strong>ID:</strong> ${customer.id || ""}</div>
  `;

  // Keep track of currently selected customer
  selectedCustomerId = customer.id;

  // 🔹 Edit Customer button
  const editBtn = document.getElementById("editCustomerBtn");
  if (editBtn) {
    const newEditBtn = editBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEditBtn, editBtn);
    newEditBtn.addEventListener("click", () => {
      modal.style.display = "none";
      openEditCustomerModal(customer);
    });
  }

  // 🔹 View Transactions button
  const txBtn = document.getElementById("viewCustomerTransactionsBtn");
  if (txBtn) {
    const newTxBtn = txBtn.cloneNode(true);
    txBtn.parentNode.replaceChild(newTxBtn, txBtn);
    newTxBtn.addEventListener("click", () => {
      modal.style.display = "none";
      showTransactionsModal(customer);
    });
  }

  // 🔹 View Reservations button (NEW)
  const resBtn = document.getElementById("viewCustomerReservationsBtn");
  if (resBtn) {
    const newResBtn = resBtn.cloneNode(true);
    resBtn.parentNode.replaceChild(newResBtn, resBtn);
    newResBtn.addEventListener("click", () => {
      // Keep details modal open OR close first (your choice).
      // modal.style.display = "none";
      openCustomerReservations(customer.id);
    });
  }

  // Show the details modal
  modal.style.display = "block";

  document.getElementById("closeCustomerDetailsBtn").addEventListener("click", function() {
    // hide the modal
    document.getElementById("customerDetailsModal").style.display = "none";
});
}



//EDIT MODAL
function openEditCustomerModal(customer) {
  editingCustomerId = customer.id;

  document.getElementById("editCustomerName").value = customer.name || "";
  document.getElementById("editCustomerPhone").value = customer.telephone || "";
  document.getElementById("editCustomerAddress").value = customer.address || "";
  document.getElementById("editCustomerEmail").value = customer.email || "";

  document.getElementById("editCustomerModal").style.display = "block";
}

//EDIT EVENT LSITENERS
document.getElementById("closeEditCustomerBtn").onclick =
document.getElementById("cancelCustomerEditBtn").onclick = () => {
  document.getElementById("editCustomerModal").style.display = "none";
};

document.getElementById("saveCustomerEditBtn").onclick = async () => {
  if (!editingCustomerId) return;

  const name = document.getElementById("editCustomerName").value.trim();
  const phone = document.getElementById("editCustomerPhone").value.trim();
  const address = document.getElementById("editCustomerAddress").value.trim();
  const email = document.getElementById("editCustomerEmail").value.trim();

  try {
    const customerRef = doc(db, "customers", editingCustomerId);
    await updateDoc(customerRef, {
      name,
      telephone: phone,
      address,
      email
    });

    alert("Customer updated successfully.");
    document.getElementById("editCustomerModal").style.display = "none";
    await loadCustomers();

    // Refresh details modal if still open
    const updated = customers.find(c => c.id === editingCustomerId);
    if (updated) showCustomerDetailsModal(updated);

  } catch (err) {
    console.error("Error updating customer:", err);
    alert("Failed to update customer.");
  }
};


async function showTransactionsModal(customer) {
  const modal = document.getElementById("transactionListModal");
  const list = document.getElementById("transactionListContainer");
  list.innerHTML = "";
  const paymentsSnapshot = await getDocs(collection(db, "payments"));
  let payments = paymentsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
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
      div.style.padding = "8px 12px";
      div.style.borderBottom = "1px solid #eee";
      div.innerHTML = `
        <strong>Receipt:</strong> ${p.receiptNumber} &nbsp; 
        <strong>Date:</strong> ${p.timestamp ? p.timestamp.split("T")[0] : ""} &nbsp; 
        <strong>Amount:</strong> $${parseFloat(p.amount).toFixed(2)}
        <tr><td><strong>Special Offer</strong></td><td>${reservation.specialOffer || 'None'}</td></tr>
        <tr><td><strong>Notes</strong></td><td>${reservation.note || 'None'}</td></tr>
      `;
      div.onclick = async () => {
        let reservation = null;
        if (p.reservationId) {
          const resDoc = await getDoc(doc(db, "reservations", p.reservationId));
          reservation = resDoc.exists() ? resDoc.data() : null;
        }
        showReceiptDetailModal(p, reservation);
      };
      list.appendChild(div);
    });
  }
  document.getElementById("closeTransactionListBtn").onclick = () => modal.style.display = "none";
  modal.style.display = "block";
}

function showReceiptDetailModal(payment, reservation) {
  const modal = document.getElementById("receiptDetailModal");
  const content = document.getElementById("receiptDetailContent");
  // Try to get customer info
  let customer = null;
  if (payment.customerId && typeof customers !== 'undefined') {
    customer = customers.find(c => c.id === payment.customerId);
  }
  // Compute details with improved fallback to payment data
  let room = '-';
  let stay = '-';
  let nights = '-';
  let balance = '-';
  let rate = null;
  let arrival = null;
  let departure = null;
  // Prefer reservation, fallback to payment
  if (reservation) {
    room = reservation.roomNumber || payment.roomNumber || '-';
    arrival = reservation.arrivalDate || payment.arrivalDate || null;
    departure = reservation.departureDate || payment.departureDate || null;
    rate = reservation.rate != null ? parseFloat(reservation.rate) : (payment.rate != null ? parseFloat(payment.rate) : null);
  } else {
    room = payment.roomNumber || '-';
    arrival = payment.arrivalDate || null;
    departure = payment.departureDate || null;
    rate = payment.rate != null ? parseFloat(payment.rate) : null;
  }
  if (arrival && departure) {
    stay = arrival + ' to ' + departure;
    const arr = new Date(arrival);
    const dep = new Date(departure);
    nights = Math.max(1, Math.ceil((dep - arr) / (1000*60*60*24)));
    if (!isNaN(rate) && rate !== null) {
      balance = (rate * nights - parseFloat(payment.amount || 0)).toFixed(2);
      balance = '$' + balance;
    } else {
      balance = '-';
    }
  }
  content.innerHTML = `
    <div><strong>Receipt #:</strong> ${payment.receiptNumber}</div>
    <div><strong>Name:</strong> ${customer ? customer.name : '-'}</div>
    <div><strong>Phone:</strong> ${customer ? customer.telephone || '-' : '-'}</div>
    <div><strong>Address:</strong> ${customer ? customer.address || '-' : '-'}</div>
    <div><strong>Amount Paid:</strong> $${parseFloat(payment.amount).toFixed(2)}</div>
    <div><strong>Date:</strong> ${payment.timestamp ? payment.timestamp.split("T")[0] : ""}</div>
    <div><strong>Room:</strong> ${room}</div>
    <div><strong>Stay:</strong> ${stay}</div>
    <div><strong>Nights:</strong> ${nights}</div>
    <div><strong>Balance:</strong> ${balance}</div>
  `;
  document.getElementById("closeReceiptDetailBtn").onclick = () => modal.style.display = "none";
  modal.style.display = "block";
}

// --- 2. Search Receipt Button & Popup (using existing HTML) ---
document.getElementById("searchReceiptBtn").onclick = () => {
  document.getElementById("searchReceiptInput").value = "";
  document.getElementById("searchReceiptError").style.display = "none";
  document.getElementById("searchReceiptModal").style.display = "block";
};
document.getElementById("closeSearchReceiptBtn").onclick = () => {
  document.getElementById("searchReceiptModal").style.display = "none";
};
document.getElementById("submitSearchReceiptBtn").onclick = async () => {
  const receiptNum = document.getElementById("searchReceiptInput").value.trim();
  const errorDiv = document.getElementById("searchReceiptError");
  if (!receiptNum) {
    errorDiv.textContent = "Please enter a receipt number.";
    errorDiv.style.display = "block";
    return;
  }
  const paymentsSnapshot = await getDocs(collection(db, "payments"));
  const payment = paymentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    .find(p => p.receiptNumber === receiptNum);
  if (!payment) {
    errorDiv.textContent = "Receipt not found.";
    errorDiv.style.display = "block";
    return;
  }
  let customer = customers.find(c => c.id === payment.customerId);
  let reservation = null;
  if (payment.reservationId) {
    const resDoc = await getDoc(doc(db, "reservations", payment.reservationId));
    reservation = resDoc.exists() ? resDoc.data() : null;
  }
  showReceiptDetailModal(payment, reservation);
  document.getElementById("searchReceiptModal").style.display = "none";
};

// --- 3. Check-In / Check-Out Filter Button & Popups (using existing HTML) ---
document.getElementById("checkInOutBtn").onclick = () => {
  document.getElementById("checkInOutFilterModal").style.display = "block";
  document.getElementById("checkInOutResultsContainer").innerHTML = "";
  document.getElementById("checkInOutTimeFilter").value = "today";
  document.getElementById("customCheckDateRange").style.display = "none";
};
document.getElementById("closeCheckInOutFilterBtn").onclick = () => {
  document.getElementById("checkInOutFilterModal").style.display = "none";
};
document.getElementById("checkInOutTimeFilter").onchange = function() {
  document.getElementById("customCheckDateRange").style.display = this.value === "custom" ? "block" : "none";
};
document.getElementById("applyCheckInOutFilterBtn").onclick = async () => {
  const type = document.querySelector('input[name="checkType"]:checked').value;
  const filter = document.getElementById("checkInOutTimeFilter").value;
  let start, end;
  const today = new Date();
  if (filter === "today") {
    start = end = today.toISOString().split("T")[0];
  } else if (filter === "week") {
    const now = new Date();
    const first = new Date(now.setDate(now.getDate() - now.getDay()));
    const last = new Date(now.setDate(now.getDate() - now.getDay() + 6));
    start = first.toISOString().split("T")[0];
    end = last.toISOString().split("T")[0];
  } else {
    start = document.getElementById("customCheckStartDate").value;
    end = document.getElementById("customCheckEndDate").value;
    if (!start || !end) {
      alert("Select a valid custom date range.");
      return;
    }
  }
  const reservations = await loadReservations();
  let filtered;
  if (type === "checkin") {
    filtered = reservations.filter(r => r.arrivalDate >= start && r.arrivalDate <= end);
  } else {
    filtered = reservations.filter(r => r.departureDate >= start && r.departureDate <= end);
  }
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
      <strong>${customer ? customer.name : "Unknown"}</strong> &nbsp; 
      <span>Room: ${r.roomNumber}</span> &nbsp; 
      <span>${type === "checkin" ? "Check-In" : "Check-Out"}: ${type === "checkin" ? r.arrivalDate : r.departureDate}</span> &nbsp; 
      <span>Duration: ${Math.max(1, Math.ceil((new Date(r.departureDate) - new Date(r.arrivalDate)) / (1000*60*60*24)))} nights</span>
    `;
    div.onclick = () => {
      alert(
        `Reservation Info:\n` +
        `Name: ${customer ? customer.name : "Unknown"}\n` +
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

// Bind Generate Grid Button
document.getElementById("loadGridBtn").addEventListener("click", () => {
  renderAvailabilityGrid();
});

// --- Print Receipts Modal Logic ---
document.getElementById("printReceiptsBtn").addEventListener("click", () => {
  // REVERT GUI TO ORIGINAL STYLE, REPLACE RADIO WITH INDIVIDUAL BUTTONS
  const modal = document.getElementById("printReceiptsModal");
  modal.style.display = "block";
  const modalContent = modal.querySelector(".modal-content");
  if (modalContent) {
    // Center modal absolutely and remove any duplicate modal content
    modalContent.innerHTML = `
      <div style="position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:100%; max-width:420px; padding:32px 24px; background:#f8fafd; border-radius:16px; box-shadow:0 4px 24px rgba(0,0,0,0.13); text-align:center; z-index:9999;">
        <h2 style="margin-bottom:22px; color:#2a4d7a; font-size:1.35em;">Print Receipts</h2>
        <div id="filterGroup" style="display:flex; flex-direction:column; align-items:center; gap:18px; margin-bottom:18px;">
          <button class="receiptFilterBtn" data-filter="today" style="width:80%; font-size:1.15em; padding:16px 0; border-radius:10px; border:2px solid #2a4d7a; background:#fff; color:#2a4d7a; font-weight:500; cursor:pointer; transition:background 0.2s, color 0.2s;">Today</button>
          <button class="receiptFilterBtn" data-filter="week" style="width:80%; font-size:1.15em; padding:16px 0; border-radius:10px; border:2px solid #2a4d7a; background:#fff; color:#2a4d7a; font-weight:500; cursor:pointer; transition:background 0.2s, color 0.2s;">This Week</button>
          <button class="receiptFilterBtn" data-filter="month" style="width:80%; font-size:1.15em; padding:16px 0; border-radius:10px; border:2px solid #2a4d7a; background:#fff; color:#2a4d7a; font-weight:500; cursor:pointer; transition:background 0.2s, color 0.2s;">This Month</button>
          <button class="receiptFilterBtn" data-filter="custom" style="width:80%; font-size:1.15em; padding:16px 0; border-radius:10px; border:2px solid #2a4d7a; background:#fff; color:#2a4d7a; font-weight:500; cursor:pointer; transition:background 0.2s, color 0.2s;">Custom Range</button>
          <button class="receiptFilterBtn" data-filter="numberRange" style="width:80%; font-size:1.15em; padding:16px 0; border-radius:10px; border:2px solid #2a4d7a; background:#fff; color:#2a4d7a; font-weight:500; cursor:pointer; transition:background 0.2s, color 0.2s;">Receipt Number Range</button>
        </div>
        <div id="customDateRange" style="display:none; margin-bottom:18px;">
          <input type="date" id="customStartDate" style="margin-right:8px; padding:6px 10px; border-radius:6px; border:1px solid #b3c6e0;" />
          <input type="date" id="customEndDate" style="padding:6px 10px; border-radius:6px; border:1px solid #b3c6e0;" />
        </div>
        <div id="numberRangeGroup" style="display:none; margin-bottom:18px;">
          <label style="display:block; margin-bottom:8px; color:#2a4d7a; font-weight:500;">Enter Receipt Number Range</label>
          <div style="display:flex; gap:10px; justify-content:center;">
            <input type="text" id="startReceiptNum" maxlength="5" placeholder="Start (e.g. 00001)" style="padding:7px 10px; border-radius:6px; border:1px solid #b3c6e0; width:100px; text-align:center; font-size:1em;" />
            <span style="align-self:center;">-</span>
            <input type="text" id="endReceiptNum" maxlength="5" placeholder="End (e.g. 00005)" style="padding:7px 10px; border-radius:6px; border:1px solid #b3c6e0; width:100px; text-align:center; font-size:1em;" />
          </div>
        </div>
        <button id="generateReceiptsBtn" style="background:#2a4d7a; color:#fff; padding:10px 28px; border:none; border-radius:8px; font-size:1.1em; cursor:pointer; margin-top:10px;">Generate Receipts</button>
        <button id="closePrintReceiptsBtn" style="background:#eee; color:#222; padding:10px 28px; border:none; border-radius:8px; font-size:1.1em; cursor:pointer; margin-top:14px;">Close</button>
      </div>
    `;
    // Button selection logic
    let selectedFilter = "today";
    const filterBtns = modalContent.querySelectorAll(".receiptFilterBtn");
    filterBtns.forEach(btn => {
      btn.onclick = () => {
        filterBtns.forEach(b => {
          b.style.background = "#fff";
          b.style.color = "#2a4d7a";
          b.style.borderColor = "#2a4d7a";
        });
        btn.style.background = "#2a4d7a";
        btn.style.color = "#fff";
        btn.style.borderColor = "#2a4d7a";
        selectedFilter = btn.getAttribute("data-filter");
        // Show/hide custom date range and number range
        modalContent.querySelector("#customDateRange").style.display = selectedFilter === "custom" ? "block" : "none";
        modalContent.querySelector("#numberRangeGroup").style.display = selectedFilter === "numberRange" ? "block" : "none";
      };
    });
    // Default highlight
    filterBtns[0].click();
    // Generate Receipts button uses selectedFilter
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
          const ts = new Date(p.timestamp);
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

      for (let i = 0; i < pages; i++) {
        html += `<div style="width:100%; display:flex; flex-wrap:wrap; justify-content:center; gap:2.5%; margin-bottom:18px;">`;
        const slice = filtered.slice(i * receiptsPerPage, (i + 1) * receiptsPerPage);
        for (let p of slice) {
          const reservation = reservations[p.reservationId] || {};
          const customer = customers[p.customerId] || {};
          const arrival = reservation.arrivalDate || "-";
          const departure = reservation.departureDate || "-";
          let totalPaid = 0;
          let totalDue = 0;
          let nights = 1;
          try {
            const a = new Date(arrival);
            const d = new Date(departure);
            nights = Math.max(1, Math.ceil((d - a) / (1000 * 60 * 60 * 24)));
          } catch (e) {}
          if (reservation.paymentIds && Array.isArray(reservation.paymentIds)) {
            totalPaid = filtered
              .filter(pay => pay.reservationId === p.reservationId)
              .reduce((sum, pay) => sum + parseFloat(pay.amount || 0), 0);
          }
          totalDue = (parseFloat(p.rate) || 0) * nights;
          let balance = totalDue - totalPaid;
          if (isNaN(balance)) balance = 0;
          const roomNumber = reservation.roomNumber || p.roomNumber || "-";
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
            <div><strong>Receipt Date:</strong> ${new Date(p.timestamp).toLocaleString()}</div>
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
      modal.style.display = "none";
    };
    modalContent.querySelector("#closePrintReceiptsBtn").onclick = () => {
      modal.style.display = "none";
    };
  }
});
//print form
document.getElementById("printRegistrationFormBtn").onclick = () => {
  window.print();
  setTimeout(() => {
  document.getElementById("registrationFormPreviewModal").style.display = "none";
}, 500);
};

document.getElementById("cancelPreviewBtn").onclick = () => {
  document.getElementById("registrationFormPreviewModal").style.display = "none";
};


document.getElementById("closePrintReceiptsBtn").addEventListener("click", () => {
  document.getElementById("printReceiptsModal").style.display = "none";
});

document.querySelectorAll("input[name='receiptFilter']").forEach(el => {
  el.addEventListener("change", () => {
    const isCustom = document.querySelector("input[name='receiptFilter']:checked").value === "custom";
    document.getElementById("customDateRange").style.display = isCustom ? "block" : "none";
  });
});

document.getElementById("generateReceiptsBtn").addEventListener("click", async () => {
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
      const ts = new Date(p.timestamp);
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

  for (let i = 0; i < pages; i++) {
    // Center receipts on the page using flexbox
    html += `<div style="width:100%; display:flex; flex-wrap:wrap; justify-content:center; gap:2.5%; margin-bottom:18px;">`;
    const slice = filtered.slice(i * receiptsPerPage, (i + 1) * receiptsPerPage);

    for (let p of slice) {
      const reservation = reservations[p.reservationId] || {};
      const customer = customers[p.customerId] || {};
      const arrival = reservation.arrivalDate || "-";
      const departure = reservation.departureDate || "-";

      // Calculate correct balance for this payment
      let totalPaid = 0;
      let totalDue = 0;
      let nights = 1;
      try {
        const a = new Date(arrival);
        const d = new Date(departure);
        nights = Math.max(1, Math.ceil((d - a) / (1000 * 60 * 60 * 24)));
      } catch (e) {}
      if (reservation.paymentIds && Array.isArray(reservation.paymentIds)) {
        totalPaid = filtered
          .filter(pay => pay.reservationId === p.reservationId)
          .reduce((sum, pay) => sum + parseFloat(pay.amount || 0), 0);
      }
      totalDue = (parseFloat(p.rate) || 0) * nights;
      let balance = totalDue - totalPaid;
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
        <div><strong>Receipt Date:</strong> ${new Date(p.timestamp).toLocaleString()}</div>
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
//Generate FORM FUNCTION
function buildRegistrationFormHTML(reservation, customer, croppedImageDataURL, paymentSummary) {
  const room = reservation.roomNumber;
  const arrival = reservation.arrivalDate;
  const departure = reservation.departureDate;
  const totalPaid = paymentSummary.totalPaid.toFixed(2);
  const totalDue = paymentSummary.totalDue.toFixed(2);
  const balance = paymentSummary.balanceRemaining.toFixed(2);

  // Always show 4 receipt slots
  const receiptRows = [];
  for (let i = 0; i < 4; i++) {
    const r = paymentSummary.receipts[i] || { number: "—", date: "—", amount: "0.00" };
    receiptRows.push(`
      <tr>
        <td style="padding: 2px 4px;">${i + 1}</td>
        <td style="padding: 2px 4px;">${r.number}</td>
        <td style="padding: 2px 4px;">${r.date}</td>
        <td style="padding: 2px 4px;">$${parseFloat(r.amount).toFixed(2)}</td>
      </tr>
    `);
  }

  const receiptsHTML = receiptRows.join("");

  return `
    <div style="font-family:Arial; font-size:12px; line-height:1.3;">
      <h2 style="text-align:center; margin-bottom:10px;">Glimbaro Guest Registration</h2>

      <div style="display:flex; justify-content:space-between;">
        <div style="width:58%;">
          <p><strong>Name:</strong> ${customer.name}</p>
          <p><strong>Address:</strong> ${customer.address}</p>
          <p><strong>Phone:</strong> ${customer.telephone}</p>
          <p><strong>Room Number:</strong> ${room}</p>
          <p><strong>Arrival:</strong> ${arrival}</p>
          <p><strong>Departure:</strong> ${departure}</p>
        </div>
        <div style="width:38%; border:1px dotted #888; height:120px; text-align:center;">
          <img src="${croppedImageDataURL}" alt="Guest ID" style="max-width:100%; max-height:100%;" />
        </div>
      </div>

      <table style="width:100%; border-collapse:collapse; margin-top:10px; font-size:11px;">
        <thead>
          <tr style="border-bottom:1px solid #ccc;">
            <th>#</th>
            <th>Receipt #</th>
            <th>Date</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${receiptsHTML}
        </tbody>
      </table>

      <div style="margin-top:6px; display:flex; justify-content:space-between;">
        <p><strong>Total Paid:</strong> $${totalPaid}</p>
        <p><strong>Total Due:</strong> $${totalDue}</p>
        <p><strong>Balance:</strong> $${balance}</p>
      </div>

      <div style="margin-top:10px;">
        <p>Guest Signature: ______________________</p>
        <p>Receptionist Signature: ___________________</p>
      </div>

      <div style="margin-top:10px; font-size:11px;">
        <strong>Disclaimer:</strong> Guests are responsible for damages or missing items. Glimbaro Guest House is not liable for loss of money, jewelry, or valuables. All room rates are payable in advance.<br>
        <strong>Check-in:</strong> 3:00 PM  <strong>Check-out:</strong> 1:00 PM<br>
        <em>No refunds.</em>
      </div>

      <!-- Contact Info in One Line -->
      <div style="text-align:center; font-size:11px; color:#777; margin-top:8px; white-space:nowrap; overflow:hidden;">
        Glimbaro’s Guest House — Cayon Street, PO Box 457, Basseterre, St. Kitts — Tel: (869)6630777 | (869)4652936 | (869)4651786
      </div>
    </div>
  `;
}

//PRINT
document.getElementById("printReservationBtn").onclick = () => {
  openPrintPopup(currentReservation); 
};


//EMAIIIIL POPUP
function showEmailConfirmationPopup(reservation, customer, receiptNumber, amountPaid, balance, duration) {
  const modal = document.getElementById("emailConfirmationModal");
  const content = document.getElementById("emailSummaryContent");

  content.innerHTML = `
    <p><strong>Name:</strong> ${customer.name}</p>
    <p><strong>Email:</strong> ${customer.email}</p>
    <p><strong>Phone:</strong> ${customer.telephone}</p>
    <p><strong>Address:</strong> ${customer.address}</p>
    <p><strong>Receipt #:</strong> ${receiptNumber}</p>
    <p><strong>Reservation ID:</strong> ${reservation.id}</p>
    <p><strong>Room:</strong> ${reservation.roomNumber}</p>
    <p><strong>Check-In:</strong> ${reservation.arrivalDate}</p>
    <p><strong>Check-Out:</strong> ${reservation.departureDate}</p>
    <p><strong>Nights:</strong> ${duration}</p>
    <p><strong>Amount Paid:</strong> $${parseFloat(amountPaid).toFixed(2)}</p>
    <p><strong>Balance:</strong> $${parseFloat(balance).toFixed(2)}</p>
    <p><strong>Special Offer:</strong> ${reservation.specialOfferDescription || 'None'}</p>
    <p><strong>Notes:</strong> ${reservation.notes || 'N/A'}</p>
  `;

  modal.style.display = "block";

  document.getElementById("sendEmailConfirmationBtn").onclick = async () => {
    const payload = {
      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: customer.telephone,
      customer_address: customer.address,
      receipt_number: receiptNumber,
      reservation_id: reservation.id,
      checkin: reservation.arrivalDate,
      checkout: reservation.departureDate,
      room: reservation.roomNumber,
      amount_paid: parseFloat(amountPaid).toFixed(2),
      balance: parseFloat(balance).toFixed(2),
      total_amount: (parseFloat(amountPaid) + parseFloat(balance)).toFixed(2),
      special_offer: reservation.specialOffer 
        ? (reservation.specialOffer === '2plus1'
            ? 'Special: Pay for 2 nights get 1 extra night free'
      : reservation.specialOffer === '4plus3'
        ? 'Special: Pay for 4 nights get 3 extra nights free'
        : reservation.specialOffer)
  : 'None',
notes: reservation.note && reservation.note.trim() !== '' 
  ? `Notes: ${reservation.note}` 
  : 'None'

    };

    try {
      await emailjs.send("service_a10nvxj", "template_cip6nna", payload);
      alert("📧 Email confirmation sent!");
      modal.style.display = "none";
      document.getElementById("registrationPromptModal").style.display = "block";
    } catch (err) {
      console.error("EmailJS error:", err);
      alert("❌ Failed to send email.");
    }
  };

  document.getElementById("cancelEmailConfirmationBtn").onclick = () => {
    modal.style.display = "none";
  };
}
function generateInvoiceHTML(customer, reservation, selectedPayments, totalCost) {
  const totalPaid = selectedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  const balance = Math.max(0, totalCost - totalPaid);

  const receiptList = selectedPayments.map(p => `
    <tr>
      <td>${p.receiptNumber}</td>
      <td>${new Date(p.timestamp).toLocaleDateString()}</td>
      <td>$${parseFloat(p.amount).toFixed(2)}</td>
    </tr>
  `).join("");

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
        <tr><td><strong>Check-In</strong></td><td>${reservation.arrivalDate}</td></tr>
        <tr><td><strong>Check-Out</strong></td><td>${reservation.departureDate}</td></tr>
        <tr><td><strong>Room</strong></td><td>${reservation.roomNumber}</td></tr>
      </table>

      <hr style="border: none; border-top: 1px dashed #ccc;" />

      <table style="width:100%; border-collapse: collapse;">
        <tr><td><strong>Total Amount</strong></td><td>$${totalCost.toFixed(2)}</td></tr>
        <tr><td><strong>Total Paid</strong></td><td>$${totalPaid.toFixed(2)}</td></tr>
        <tr><td><strong>Balance Due</strong></td><td>$${balance.toFixed(2)}</td></tr>
        <tr><td><strong>Special Offer</strong></td><td>${reservation.specialOffer || 'None'}</td></tr>
        <tr><td><strong>Notes</strong></td><td>${reservation.note || 'None'}</td></tr>

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


function calculateSpecialNights(arrival, departure, offer) {
  const start = new Date(arrival);
  const end = new Date(departure);
  let nights = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));

  // Apply special offers
  if (offer === "2plus1") {
    const paidBlocks = Math.floor(nights / 3); // every 3 nights, 1 free
    nights = nights - paidBlocks;
  } else if (offer === "4plus3") {
    const paidBlocks = Math.floor(nights / 7); // every 7 nights, 3 free
    nights = nights - (paidBlocks * 3);
  }

  return nights;
}

function getAdjustedDepartureDate(arrivalDate, offerCode) {
  const start = new Date(arrivalDate);
  switch (offerCode) {
    case "2plus1":
      start.setDate(start.getDate() + 3);
      break;
    case "4plus3":
      start.setDate(start.getDate() + 7);
      break;
    default:
      return null;
  }
  return start.toISOString().split("T")[0];
}

document.getElementById("specialOffer").addEventListener("change", () => {
  const arrivalDate = document.getElementById("arrival").value;
  const selected = document.getElementById("specialOffer").value;
  if (arrivalDate && selected) {
    const autoDep = getAdjustedDepartureDate(arrivalDate, selected);
    if (autoDep) {
      document.getElementById("departure").value = autoDep;
    }
  }
});

 function calculateSpecialNightsForExtension(currentDeparture, newDeparture, offer) {
  const start = new Date(currentDeparture);
  const end = new Date(newDeparture);
  const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

  if (offer === "2plus1") return diff === 3; // 2 paid nights + 1 free
  if (offer === "4plus3") return diff === 7; // 4 paid nights + 3 free
  return true;
}
document.getElementById("summaryBtn").onclick = () => {
  document.getElementById("summaryModal").style.display = "block";
};

document.getElementById("closeSummaryModal").onclick = () => {
  document.getElementById("summaryModal").style.display = "none";
};

document.getElementById("summaryRange").onchange = (e) => {
  const val = e.target.value;
  document.getElementById("summaryStart").style.display = val === "custom" ? "inline-block" : "none";
  document.getElementById("summaryEnd").style.display = val === "custom" ? "inline-block" : "none";
};

// 📊 Summary Range Button
// When "Load Summary" button is clicked
document.getElementById("loadSummaryBtn").onclick = async () => {
  const range = document.getElementById("summaryRange").value;
  let startDate, endDate;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (range === "day") {
    startDate = endDate = today;
  } else if (range === "week") {
    startDate = new Date(today);
    startDate.setDate(startDate.getDate() - startDate.getDay()); // Sunday
    endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
  } else if (range === "month") {
    startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (range === "custom") {
    startDate = new Date(document.getElementById("summaryStart").value);
    endDate = new Date(document.getElementById("summaryEnd").value);
  } else if (range === "outstanding") {
    // ✅ Outstanding ignores dates
    await loadSummary(null, null, "outstanding");
    return;
  }

  await loadSummary(startDate, endDate, range);
};


// The main summary loader
async function loadSummary(startDate, endDate, range) {
  const tbody = document.querySelector("#summaryTable tbody");
  tbody.innerHTML = "";

  let totalEarnings = 0;
  let totalOutstanding = 0;

  const reservations = window._reservationsCache || await loadReservations();
  const paymentsSnapshot = await getDocs(collection(db, "payments"));
  const allPayments = paymentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

  for (const reservation of reservations) {
    const customer = customers.find(c => c.id === reservation.customerId);
    const name = customer ? customer.name : "Unknown";

    const nights = calculateSpecialNights(
      reservation.arrivalDate,
      reservation.departureDate,
      reservation.specialOffer
    );
    const rate = parseFloat(reservation.rate) || 0;
    const totalDue = rate * nights;

    const resPayments = allPayments.filter(p => p.reservationId === reservation.id);
    const totalPaid = resPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const bal = Math.max(0, totalDue - totalPaid);

    // ✅ Get latest receipt number
    let latestReceipt = "—";
    if (resPayments.length > 0) {
      resPayments.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
      latestReceipt = resPayments[0].receiptNumber || "—";
    }

    // ✅ Filtering logic
    let include = false;
    if (range === "outstanding") {
      include = bal > 0;
    } else {
      const arrDate = new Date(reservation.arrivalDate);
      if (!isNaN(arrDate)) {
        include = (!startDate || arrDate >= startDate) &&
                  (!endDate || arrDate <= endDate);
      }
    }

    if (!include) continue;

    // ✅ Build table row in correct order
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${name}</td>
      <td>${latestReceipt}</td>
      <td>${reservation.arrivalDate}</td>
      <td>$${totalDue.toFixed(2)}</td>
      <td>$${totalPaid.toFixed(2)}</td>
      <td style="color:${bal > 0 ? 'red' : 'green'};">
        $${bal.toFixed(2)}
      </td>
    `;
    tbody.appendChild(tr);

    // ✅ Totals
    totalEarnings += totalPaid;
    totalOutstanding += bal;
  }

  // ✅ Footer
  document.getElementById("summaryFooter").innerHTML = `
    <strong>Total Earnings:</strong> $${totalEarnings.toFixed(2)}<br>
    <strong>Outstanding Balance:</strong> $${totalOutstanding.toFixed(2)}
  `;
}

document.getElementById("printSummaryBtn").onclick = () => {
  const printWindow = window.open("", "_blank");
  printWindow.document.write(`<html><head><title>Summary</title></head><body>`);
  printWindow.document.write(document.getElementById("summaryTable").outerHTML);
  printWindow.document.write(`<div>${document.getElementById("summaryFooter").innerHTML}</div>`);
  printWindow.document.write(`</body></html>`);
  printWindow.document.close();
  printWindow.print();
};
// quick dashboard fill (add this where reservations/customers are available)
async function fillDashboard() {
  const reservations = await loadReservations();
  const customersSnapshot = await getDocs(collection(db, "customers"));
  const customersList = customersSnapshot.docs.map(d=>({id:d.id,...d.data()}));
  // cache for click handlers on new UI
  window._reservationsCache = reservations;

  document.getElementById('card_totalReservations').textContent = reservations.length;
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('card_todayCheckins').textContent = reservations.filter(r=> r.arrivalDate === today).length;
  // rooms calc (allowedRooms exists in your file)
  const reservedRoomsToday = new Set(reservations.filter(r => {
    const a = r.arrivalDate; const d = r.departureDate;
    return a <= today && today <= d;
  }).map(r=>r.roomNumber));
  const totalRooms = (typeof allowedRooms !== 'undefined') ? allowedRooms.length : 21;
  document.getElementById('card_availableRooms').textContent = Math.max(0, totalRooms - reservedRoomsToday.size);

  // Calculate and display total balance due
  let totalBalanceDue = 0;
  for (const reservation of reservations) {
    const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate, reservation.specialOffer);
    const rate = parseFloat(reservation.rate) || 0;
    const totalDue = rate * nights;
    // Get all payments for this reservation
    const allPayments = (window._allPaymentsCache || []).filter(p => p.reservationId === reservation.id);
    const totalPaid = allPayments.reduce((sum, pay) => sum + (parseFloat(pay.amount) || 0), 0);
    const bal = Math.max(0, totalDue - totalPaid);
    totalBalanceDue += bal;
  }
  document.getElementById('card_balanceDue').textContent = totalBalanceDue.toFixed(2);

  // populate recent reservations table
  const tbody = document.querySelector('#recentReservationsTable tbody');
  tbody.innerHTML = '';
  const recent = reservations.slice().sort((a,b)=> (b.arrivalDate||'').localeCompare(a.arrivalDate||'')).slice(0,10);
  recent.forEach(r=>{
    const cust = customersList.find(c=>c.id===r.customerId) || {};
    const tr = document.createElement('tr');
    tr.setAttribute('data-res-id', r.id);
    tr.innerHTML = `<td>${cust.name||'Unknown'}</td><td>${r.roomNumber||''}</td><td>${r.arrivalDate||''}</td><td>${r.departureDate||''}</td><td>${r.paymentStatus||''}</td>`;
    tbody.appendChild(tr);
  });
}

// call it once your app is ready (after customers/reservations loaded)
(async () => {
  const paymentsSnapshot = await getDocs(collection(db, "payments"));
  window._allPaymentsCache = paymentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  await fillDashboard();
})();
// ✅ Reusable function to open the print registration form with cropping, preview, and Done button
async function openPrintRegistrationForm(reservation) {
  const customer = customers.find(c => c.id === reservation.customerId) || {};

  // Fetch related payments
  const paymentsSnapshot = await getDocs(collection(db, "payments"));
  const relatedPayments = paymentsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => p.reservationId === reservation.id);

  const sortedPayments = relatedPayments.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const rate = parseFloat(reservation.rate || 0);
  const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate, reservation.specialOffer);
  const totalDue = rate * nights;
  const totalPaid = relatedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  let balanceRemaining = Math.max(0, totalDue - totalPaid);
  if (balanceRemaining < 0) balanceRemaining = 0;

  const paymentSummary = {
    totalPaid,
    totalDue,
    balanceRemaining,
    receiptNumber: sortedPayments[0]?.receiptNumber || "—",
    receipts: sortedPayments.slice(0, 4).map(p => ({
      number: p.receiptNumber || "—",
      date: p.timestamp?.split("T")[0] || "—",
      amount: p.amount || "0.00"
    }))
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
if (document.getElementById("receiptPreviewModal")?.style.display === "block") {
  const payments = await getPaymentsForReservation(updatedRes.id);
  const previewHTML = generateInvoiceHTML(updatedCust, updatedRes, payments, /* total */);
  document.getElementById("receiptPreviewContent").innerHTML = previewHTML;
}

// 🔹 Show registration form directly if ID already exists
async function showRegistrationFormWithSavedId(customer) {
  try {
    const resDoc = await getDoc(doc(db, "reservations", latestReservationId));
    const reservation = resDoc.exists() ? { id: resDoc.id, ...resDoc.data() } : null;

    let relatedPayments = [];
    const paymentsSnapshot = await getDocs(collection(db, "payments"));
    relatedPayments = paymentsSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => p.reservationId === reservation.id);

    const sortedPayments = relatedPayments.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    const nights = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate, reservation.specialOffer);
    const totalDue = (parseFloat(reservation.rate) || 0) * nights;
    const totalPaid = relatedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const balanceRemaining = Math.max(0, totalDue - totalPaid);

    const paymentSummary = {
      totalPaid,
      totalDue,
      balanceRemaining,
      receiptNumber: sortedPayments[0]?.receiptNumber || "—",
      receipts: sortedPayments.slice(0, 4).map(p => ({
        number: p.receiptNumber || "—",
        date: p.timestamp?.split("T")[0] || "—",
        amount: p.amount || "0.00"
      }))
    };

    // 🔹 Use saved ID image
    const html = buildRegistrationFormHTML(reservation, customer, customer.idImageUrl, paymentSummary);
    const previewContainer = document.getElementById("formPreviewContent");
    previewContainer.innerHTML = `
      <div class="registration-form">${html}</div>
      <div class="registration-form" style="page-break-before:always;">${html}</div>
    `;

    document.getElementById("registrationFormPreviewModal").style.display = "block";
  } catch (err) {
    console.error("Error showing registration form with saved ID:", err);
    alert("Could not generate registration form.");
  }
}
async function showFormPreview(reservation, customer, idImageUrl) {
  // fetch related payments
  const paymentsSnapshot = await getDocs(collection(db, "payments"));
  const relatedPayments = paymentsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => p.reservationId === reservation.id);

  const sortedPayments = relatedPayments.sort((a, b) =>
    (b.timestamp || "").localeCompare(a.timestamp || "")
  );

  const rate = parseFloat(reservation.rate || 0);
  const nights = calculateSpecialNights(
    reservation.arrivalDate,
    reservation.departureDate,
    reservation.specialOffer
  );
  const totalDue = rate * nights;
  const totalPaid = relatedPayments.reduce(
    (sum, p) => sum + parseFloat(p.amount || 0),
    0
  );
  const balanceRemaining = Math.max(0, totalDue - totalPaid);

  const paymentSummary = {
    totalPaid,
    totalDue,
    balanceRemaining,
    receiptNumber: sortedPayments[0]?.receiptNumber || "—",
    receipts: sortedPayments.slice(0, 4).map((p) => ({
      number: p.receiptNumber || "—",
      date: p.timestamp?.split("T")[0] || "—",
      amount: p.amount || "0.00",
    })),
  };

  // build the registration form HTML
  const html = buildRegistrationFormHTML(
    reservation,
    customer,
    idImageUrl,
    paymentSummary
  );

  // put it into the preview modal
  const previewContainer = document.getElementById("formPreviewContent");
  previewContainer.innerHTML = `
    <div class="registration-form">${html}</div>
    <div class="registration-form" style="page-break-before:always;">${html}</div>
  `;

  // open modal
  document.getElementById("registrationFormPreviewModal").style.display = "block";
}
// ✅ Clear Reservation Form Button
document.getElementById("clearReservationFormBtn").addEventListener("click", () => {
  document.getElementById("searchName").value = "";
  document.getElementById("name").value = "";
  document.getElementById("address").value = "";
  document.getElementById("telephone").value = "";
  document.getElementById("customer-email").value = "";
  document.getElementById("arrival").value = "";
  document.getElementById("departure").value = "";
  document.getElementById("room").value = "";
  document.getElementById("reservationRate").value = "";
  document.getElementById("specialOffer").value = "";
  document.getElementById("reservationNote").value = "";
  selectedCustomerId = null;

  // Reset ID preview
  document.getElementById("customerIdPreview").innerHTML =
    `<span style="font-size:0.9em; color:#666;">No ID on file</span>`;
});



async function openCustomerReservations(customerId) {
  const modal = document.getElementById("customerReservationsModal");
  const list = document.getElementById("customerReservationsList");
  if (!modal || !list) {
    console.error("Missing customerReservationsModal or list container in HTML.");
    return;
  }

  list.innerHTML = "<p>Loading...</p>";
  modal.style.display = "block";

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
      div.style.padding = "8px";
      div.style.border = "1px solid #ccc";
      div.style.borderRadius = "6px";
      div.style.background = "#f9f9f9";

      div.innerHTML = `
        <p><strong>Room:</strong> ${res.roomNumber} |
           <strong>Dates:</strong> ${res.arrivalDate} → ${res.departureDate} |
           <strong>Status:</strong> ${res.paymentStatus || "unpaid"}</p>
        <button class="editResBtn" data-id="${res.id}" 
          style="background:#4a90e2;color:#fff;border:none;padding:6px 10px;
          border-radius:4px;cursor:pointer;">✏ Edit</button>
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
