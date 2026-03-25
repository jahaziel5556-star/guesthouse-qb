// @ts-nocheck
/**
 * availability.js  -  Standalone Availability Grid page logic.
 * ES module - imported by availability.html.
 */

import {
  db,
  collection,
  getDocs,
  requireAuth,
  applyTheme,
  toggleTheme,
  getDateRange,
  escapeHTML,
  loadReservations,
  loadCustomers,
  showSpinner,
  hideSpinner,
  showToast,
  exportTableToCSV
} from './shared.js';

// ─── Room list (matches main1.js APP_CONFIG.ROOMS) ────────────────────────────
const ALL_ROOMS = [
  '101','102','103','104','105','106','107','108','109','110','111',
  '201','202','203','204','205','206','207','208','209','210'
];

// ─── State ────────────────────────────────────────────────────────────────────
let lastTableEl   = null;   // keep reference for CSV export
let gridCollapsed = false;

// ─── Bootstrap ────────────────────────────────────────────────────────────────
(async () => {
  applyTheme();

  // Hide auth overlay once theme is applied (before auth check completes)
  try {
    await requireAuth();
  } catch {
    return; // requireAuth already redirected to login.html
  }

  const overlay = document.getElementById('authLoadingOverlay');
  if (overlay) overlay.style.display = 'none';

  bindEvents();

  // Default dates: today and +14 days
  const today = new Date();
  const plus14 = new Date(today);
  plus14.setDate(plus14.getDate() + 14);
  document.getElementById('startDate').value = isoDate(today);
  document.getElementById('endDate').value   = isoDate(plus14);
})();

// ─── Event bindings ───────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('loadGridBtn').addEventListener('click', renderGrid);

  document.getElementById('toggleGridBtn').addEventListener('click', () => {
    const wrapper = document.getElementById('gridWrapper');
    const btn     = document.getElementById('toggleGridBtn');
    gridCollapsed = !gridCollapsed;
    wrapper.classList.toggle('collapsed', gridCollapsed);
    btn.textContent = gridCollapsed ? 'Expand Table' : 'Collapse Table';
  });

  document.getElementById('printBtn').addEventListener('click', () => {
    window.print();
  });

  document.getElementById('csvBtn').addEventListener('click', () => {
    if (!lastTableEl) { showToast('Generate a grid first.', 'warning'); return; }
    exportTableToCSV(lastTableEl, 'availability.csv');
    showToast('CSV downloaded.', 'success');
  });

  document.getElementById('filterInput').addEventListener('input', applyFilter);

  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
}

// ─── Main grid render ─────────────────────────────────────────────────────────
async function renderGrid() {
  const start = document.getElementById('startDate').value;
  const end   = document.getElementById('endDate').value;

  if (!start || !end || start > end) {
    showToast('Please select a valid date range.', 'warning');
    return;
  }

  showSpinner('spinner');
  const gridContainer = document.getElementById('availabilityGrid');
  gridContainer.innerHTML = '';
  lastTableEl = null;

  try {
    const [reservations, customers] = await Promise.all([loadReservations(), loadCustomers()]);

    const dates = getDateRange(start, end);
    const table = document.createElement('table');
    table.className = 'availability-grid-table';

    // Header row
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>Room</th>' + dates.map(d => {
      const dt  = new Date(d + 'T00:00:00');
      const day = dt.getDate();
      const mon = dt.toLocaleString('default', { month: 'short' });
      return `<th>${day} ${mon}</th>`;
    }).join('');
    table.appendChild(headerRow);

    // Data rows
    for (const room of ALL_ROOMS) {
      const row = document.createElement('tr');
      row.innerHTML = `<td data-room="${escapeHTML(room)}">${escapeHTML(room)}</td>`;

      for (const date of dates) {
        const cell = document.createElement('td');
        const res  = reservations.find(r =>
          r.roomNumber === room &&
          date >= r.arrivalDate &&
          date <= r.departureDate
        );

        if (res) {
          const customer = customers.find(c => c.id === res.customerId);
          const name     = customer ? customer.name : 'Unknown';
          const btn      = document.createElement('button');
          btn.textContent = name;
          btn.className   = 'guest-btn';
          btn.title       = `${escapeHTML(name)} | Room ${room} | ${res.arrivalDate} to ${res.departureDate} - Click to view/edit`;
          btn.type        = 'button';
          btn.dataset.guest = name.toLowerCase();

          if (res.paymentStatus === 'fully_paid')           btn.classList.add('paid');
          else if (res.paymentStatus === 'partially_paid') btn.classList.add('partial');
          else                                              btn.classList.add('unpaid');

          // Navigate back to dashboard and open the reservation popup
          btn.addEventListener('click', () => {
            window.location.href = 'index.html?res=' + encodeURIComponent(res.id);
          });

          cell.appendChild(btn);
        } else {
          cell.classList.add('cell-available');
          cell.title = `Room ${room} available on ${date}`;
        }

        row.appendChild(cell);
      }

      table.appendChild(row);
    }

    gridContainer.appendChild(table);
    lastTableEl = table;

    const count = ALL_ROOMS.length;
    const label = `${count} rooms | ${dates.length} days`;
    document.getElementById('rowCountLabel').textContent  = label;
    document.getElementById('footerRowCount').textContent = label;

    // Re-apply any active filter
    applyFilter();

    // Expand collapsed grid if it was hidden
    if (gridCollapsed) {
      gridCollapsed = false;
      document.getElementById('gridWrapper').classList.remove('collapsed');
      document.getElementById('toggleGridBtn').textContent = 'Collapse Table';
    }

  } catch (err) {
    console.error('[Availability] Error rendering grid:', err);
    showToast('Failed to load data. Please try again.', 'error');
    gridContainer.innerHTML = '<p style="padding:24px; text-align:center; color:var(--accent-danger);">Error loading availability data.</p>';
  } finally {
    hideSpinner('spinner');
  }
}

// ─── Filter ───────────────────────────────────────────────────────────────────
function applyFilter() {
  if (!lastTableEl) return;
  const query = document.getElementById('filterInput').value.trim().toLowerCase();
  const rows  = Array.from(lastTableEl.querySelectorAll('tr')).slice(1); // skip header

  rows.forEach(row => {
    if (!query) {
      row.style.display = '';
      return;
    }
    const roomCell = row.querySelector('td[data-room]');
    const room     = roomCell ? roomCell.dataset.room.toLowerCase() : '';
    const guestCells = Array.from(row.querySelectorAll('.guest-btn'));
    const hasMatch = room.includes(query) || guestCells.some(b => b.dataset.guest.includes(query));
    row.style.display = hasMatch ? '' : 'none';
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
