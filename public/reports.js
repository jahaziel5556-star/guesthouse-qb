// @ts-nocheck
/**
 * reports.js  -  Standalone Reports page logic.
 * ES module - imported by reports.html.
 * Revenue figures use only valid, non-voided payments.
 * "Revenue Received (Period)" matches QuickBooks P&L.
 */

import {
  db,
  collection,
  getDocs,
  requireAuth,
  applyTheme,
  toggleTheme,
  formatDateDMY,
  calculateSpecialNights,
  escapeHTML,
  StatusUtils,
  loadCustomers,
  showSpinner,
  hideSpinner,
  showToast,
  exportTableToCSV
} from './shared.js';

// ─── State ────────────────────────────────────────────────────────────────────
let tableCollapsed = false;

// ─── Bootstrap ────────────────────────────────────────────────────────────────
(async () => {
  applyTheme();

  try {
    await requireAuth();
  } catch {
    return;
  }

  const overlay = document.getElementById('authLoadingOverlay');
  if (overlay) overlay.style.display = 'none';

  bindEvents();
})();

// ─── Event bindings ───────────────────────────────────────────────────────────
function bindEvents() {
  // Show/hide custom date inputs
  document.getElementById('summaryRange').addEventListener('change', e => {
    const isCustom = e.target.value === 'custom';
    document.getElementById('customStartGroup').style.display = isCustom ? 'flex' : 'none';
    document.getElementById('customEndGroup').style.display   = isCustom ? 'flex' : 'none';
  });

  document.getElementById('loadReportBtn').addEventListener('click', loadReport);

  document.getElementById('toggleTableBtn').addEventListener('click', () => {
    const wrapper = document.getElementById('tableWrapper');
    const btn     = document.getElementById('toggleTableBtn');
    tableCollapsed = !tableCollapsed;
    wrapper.classList.toggle('collapsed', tableCollapsed);
    btn.textContent = tableCollapsed ? 'Expand Table' : 'Collapse Table';
  });

  document.getElementById('printBtn').addEventListener('click', () => window.print());

  document.getElementById('csvBtn').addEventListener('click', () => {
    const table = document.getElementById('reportTable');
    if (!table || document.getElementById('reportBody').children.length === 0) {
      showToast('Load a report first.', 'warning');
      return;
    }
    exportTableToCSV(table, 'report.csv');
    showToast('CSV downloaded.', 'success');
  });

  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toLocalDateStr(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function parseTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string') { const d = new Date(ts); return isNaN(d.getTime()) ? null : d; }
  return null;
}

// ─── Build start/end from the range selector ──────────────────────────────────
function buildDateRange() {
  const range = document.getElementById('summaryRange').value;
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let startDate, endDate;

  switch (range) {
    case 'day':
      startDate = today;
      endDate   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      break;
    case 'week': {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    case 'month':
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      endDate   = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    case 'lastMonth':
      startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      endDate   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
      break;
    case 'custom': {
      const s = document.getElementById('summaryStart').value;
      const e = document.getElementById('summaryEnd').value;
      if (!s || !e) { showToast('Please select both a start and end date.', 'warning'); return null; }
      const [sy, sm, sd] = s.split('-').map(Number);
      const [ey, em, ed] = e.split('-').map(Number);
      startDate = new Date(sy, sm - 1, sd);
      endDate   = new Date(ey, em - 1, ed, 23, 59, 59, 999);
      break;
    }
    case 'outstanding':
      return { range, startDate: null, endDate: null };
    default:
      startDate = today;
      endDate   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  }
  return { range, startDate, endDate };
}

// ─── Main report loader ───────────────────────────────────────────────────────
async function loadReport() {
  const dateParams = buildDateRange();
  if (!dateParams) return;

  const { range, startDate, endDate } = dateParams;
  const startStr    = toLocalDateStr(startDate);
  const endStr      = toLocalDateStr(endDate);
  const isDateRange = !!(startStr && endStr);

  const tbody = document.getElementById('reportBody');
  tbody.innerHTML = '<tr><td colspan="16" style="text-align:center;padding:24px;color:var(--text-muted);">Loading...</td></tr>';

  showSpinner('spinner');

  try {
    // ── Fresh Firestore fetch every time — financial reports must never be stale ──
    const [paySnap, reservations, customers, empSnap] = await Promise.all([
      getDocs(collection(db, 'payments')),
      getDocs(collection(db, 'reservations')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))),
      loadCustomers(),
      getDocs(collection(db, 'employees'))
    ]);

    // Triple void check — exclude if ANY flag marks it voided
    const validPayments = paySnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => !p.voided && p.qbSyncStatus !== 'voided' && p.status !== 'voided');

    const employeeNames = {};
    empSnap.forEach(d => { employeeNames[d.id] = d.data().name || 'Unknown'; });

    // Index payments: O(n) once, O(1) per reservation
    const allTimePayByRes = new Map(); // reservationId -> all valid payments ever
    const periodPayByRes  = new Map(); // reservationId -> valid payments in date range

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

    // Footer accumulators — each matches its displayed column exactly
    let sumTotalDue    = 0;
    let sumAllTimePaid = 0;
    let sumPeriodRev   = 0;
    let sumBalance     = 0;

    tbody.innerHTML = '';

    for (const reservation of reservations) {
      const resAllTimePays = allTimePayByRes.get(reservation.id) || [];
      const resPeriodPays  = periodPayByRes.get(reservation.id)  || [];

      const nights    = calculateSpecialNights(reservation.arrivalDate, reservation.departureDate);
      const rate      = parseFloat(reservation.rate) || 0;
      const baseTotal = rate * nights;
      const adjs      = reservation.balanceAdjustments || [];
      const adjTotal  = adjs.reduce((s, a) => s + (a.type === 'discount' ? -a.amount : a.amount), 0);
      const totalDue    = baseTotal + adjTotal;
      const allTimePaid = resAllTimePays.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
      const periodPaid  = resPeriodPays.reduce( (s, p) => s + (parseFloat(p.amount) || 0), 0);
      const balance     = Math.max(0, totalDue - allTimePaid);

      // Filter
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

      // Customer
      const customer      = customers.find(c => c.id === reservation.customerId);
      const customerName  = customer?.name      || 'Unknown';
      const customerPhone = customer?.telephone || '\u2014';

      // Receipts column — period receipts first
      const sortByTime  = (a, b) => (a.timestamp || '').localeCompare(b.timestamp || '');
      const periodNums  = [...resPeriodPays].sort(sortByTime).map(p => p.receiptNumber).filter(Boolean);
      const allTimeNums = [...resAllTimePays].sort(sortByTime).map(p => p.receiptNumber).filter(Boolean);
      let receiptsDisplay = '\u2014';
      if (isDateRange && periodNums.length > 0) {
        receiptsDisplay = escapeHTML(periodNums.join(', '));
        const extra = allTimeNums.length - periodNums.length;
        if (extra > 0) receiptsDisplay += ` <span style="color:var(--text-muted);font-size:0.8em;">(+${extra} other)</span>`;
      } else if (allTimeNums.length > 0) {
        receiptsDisplay = escapeHTML(allTimeNums.join(', '));
      }

      // Status
      let displayStatus = 'Unpaid';
      let statusColor   = '#ef4444';
      if      (allTimePaid >= totalDue && totalDue > 0) { displayStatus = 'Fully Paid'; statusColor = '#10b981'; }
      else if (allTimePaid > 0)                          { displayStatus = 'Partial';    statusColor = '#f59e0b'; }

      const checkInfo = StatusUtils.formatCheckStatus(reservation);
      const numGuests = reservation.numGuests || reservation.guests || reservation.numberOfGuests || 1;

      // Creator
      let creatorName = '\u2014';
      if      (reservation.createdByName  && reservation.createdByName  !== 'Unknown') creatorName = reservation.createdByName;
      else if (reservation.createdBy      && employeeNames[reservation.createdBy])     creatorName = employeeNames[reservation.createdBy];
      else if (reservation.recordedByName && reservation.recordedByName !== 'Unknown') creatorName = reservation.recordedByName;
      else if (reservation.createdBy)                                                  creatorName = `(ID: ${reservation.createdBy.substring(0,8)}...)`;

      // Notes
      let notes = escapeHTML(reservation.note || reservation.notes || '\u2014');
      if (notes.length > 30) notes = notes.substring(0, 30) + '...';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="white-space:nowrap;"><strong>${escapeHTML(customerName)}</strong></td>
        <td style="white-space:nowrap;">${escapeHTML(customerPhone)}</td>
        <td style="text-align:center;font-weight:bold;">${escapeHTML(reservation.roomNumber || '\u2014')}</td>
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
          <span style="color:${checkInfo.color};font-size:0.85em;">${checkInfo.text !== 'Pending' ? ' \u00b7 ' + checkInfo.text : ''}</span>
        </td>
        <td style="font-size:0.85em;">${receiptsDisplay}</td>
        <td style="font-size:0.85em;">${escapeHTML(creatorName)}</td>
        <td style="font-size:0.85em;max-width:150px;overflow:hidden;text-overflow:ellipsis;" title="${escapeHTML(reservation.note || '')}">${notes}</td>
      `;
      tbody.appendChild(tr);

      sumTotalDue    += totalDue;
      sumAllTimePaid += allTimePaid;
      sumPeriodRev   += periodPaid;
      sumBalance     += balance;
    }

    // If no rows matched
    if (tbody.children.length === 0) {
      tbody.innerHTML = `<tr><td colspan="16" style="text-align:center;padding:40px;color:var(--text-muted);">No reservations found for this period.</td></tr>`;
    }

    // Footer
    renderFooter(range, startStr, endStr, isDateRange, tbody.children.length, sumTotalDue, sumAllTimePaid, sumPeriodRev, sumBalance);

    const label = `${tbody.children.length} reservation${tbody.children.length === 1 ? '' : 's'}`;
    document.getElementById('rowCountLabel').textContent  = label;
    document.getElementById('footerRowCount').textContent = label;

    console.log('[Report]', { range, startStr, endStr, rows: tbody.children.length, sumTotalDue, sumAllTimePaid, sumPeriodRev, sumBalance });

  } catch (err) {
    console.error('[Report] Error loading report:', err);
    showToast('Failed to load report. Please try again.', 'error');
    tbody.innerHTML = `<tr><td colspan="16" style="text-align:center;padding:24px;color:var(--accent-danger);">Error loading report data.</td></tr>`;
  } finally {
    hideSpinner('spinner');
  }
}

// ─── Footer cards ─────────────────────────────────────────────────────────────
function renderFooter(range, startStr, endStr, isDateRange, rowCount, sumTotalDue, sumAllTimePaid, sumPeriodRev, sumBalance) {
  const footer = document.getElementById('reportFooter');
  if (!footer) return;

  const periodLabel = range === 'outstanding'
    ? 'Outstanding Balances'
    : (isDateRange ? `${formatDateDMY(startStr)} \u2013 ${formatDateDMY(endStr)}` : 'Today');

  footer.innerHTML = `
    <div style="margin-top:16px;">

      ${isDateRange && range !== 'outstanding' ? `
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:12px;padding:18px 24px;margin-bottom:14px;color:#fff;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-size:11px;font-weight:600;opacity:0.85;text-transform:uppercase;letter-spacing:0.6px;">Revenue Received - ${periodLabel}</div>
          <div style="font-size:42px;font-weight:800;margin:4px 0;line-height:1;">$${sumPeriodRev.toFixed(2)}</div>
          <div style="font-size:11px;opacity:0.75;">Valid non-voided receipts dated within this period. Matches QuickBooks P&amp;L.</div>
        </div>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">

        <div style="padding:12px 14px;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:8px;border-top:3px solid var(--accent-primary);">
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Reservations</div>
          <div style="font-size:28px;font-weight:700;color:var(--text-primary);margin-top:2px;">${rowCount}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Shown for period</div>
        </div>

        <div style="padding:12px 14px;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:8px;border-top:3px solid var(--accent-primary);">
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Total Due</div>
          <div style="font-size:28px;font-weight:700;color:var(--text-primary);margin-top:2px;">$${sumTotalDue.toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Total owed on shown reservations</div>
        </div>

        <div style="padding:12px 14px;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:8px;border-top:3px solid #6b7280;">
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Paid (All-time)</div>
          <div style="font-size:28px;font-weight:700;color:#10b981;margin-top:2px;">$${sumAllTimePaid.toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">All payments ever on shown reservations</div>
        </div>

        <div style="padding:12px 14px;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:8px;border-top:3px solid #ef4444;">
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Outstanding Balance</div>
          <div style="font-size:28px;font-weight:700;color:#ef4444;margin-top:2px;">$${sumBalance.toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Still owed on shown reservations</div>
        </div>

      </div>
    </div>
  `;
}
