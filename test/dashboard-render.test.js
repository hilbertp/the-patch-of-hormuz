'use strict';

const assert = require('assert');

// ── Helpers — mirror production render logic from lcars-dashboard.html ─────────

const HISTORY_PAGE_SIZE = 5;

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderQueueActionsHtml(row) {
  const isQueued = row.rowState === 'QUEUED';
  const isStaged = row.rowState === 'STAGED';
  const eid = escHtml(row.id);
  if (isQueued) {
    return `<span class="queue-accepted-pill">&#10003; Accepted</span>
          <button class="queue-btn-edit" onclick="queueEdit('${eid}')">Edit</button>`;
  } else if (isStaged) {
    return `<button class="queue-btn-accept" onclick="queueAccept('${eid}')">Accept</button>
          <button class="queue-btn-edit" onclick="queueEdit('${eid}')">Edit</button>`;
  }
  return '';
}

function renderQueueRows(rows) {
  return rows.map(row => {
    const actionsHtml = renderQueueActionsHtml(row);
    return `<span class="queue-row-actions">${actionsHtml}</span>`;
  }).join('\n');
}

function paginateHistory(allRows, page) {
  const total = allRows.length;
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const safePage = Math.max(1, Math.min(totalPages, page));
  const start = (safePage - 1) * HISTORY_PAGE_SIZE;
  const rows = allRows.slice(start, start + HISTORY_PAGE_SIZE);
  return { rows, totalPages, page: safePage, total };
}

// ── Test 1: Queue panel — Accept button vs Accepted pill ─────────────────────

const syntheticQueueRows = [
  { id: '10', rowState: 'STAGED',      title: 'Slice awaiting approval' },
  { id: '20', rowState: 'QUEUED',      title: 'Approved slice 1' },
  { id: '21', rowState: 'QUEUED',      title: 'Approved slice 2' },
  { id: '30', rowState: 'IN_PROGRESS', title: 'Active build' },
];

const queueHtml = renderQueueRows(syntheticQueueRows);

// STAGED row shows [Accept] button
const acceptMatches = queueHtml.match(/class="queue-btn-accept"/g) || [];
assert.strictEqual(acceptMatches.length, 1,
  'exactly 1 queue-btn-accept button (STAGED row only)');

// QUEUED rows show Accepted pill — not Accept button
const pillMatches = queueHtml.match(/class="queue-accepted-pill"/g) || [];
assert.strictEqual(pillMatches.length, 2,
  'exactly 2 queue-accepted-pill spans (2 QUEUED rows)');

// IN_PROGRESS row has neither Accept button nor Accepted pill
const inProgressHtml = renderQueueRows([{ id: '30', rowState: 'IN_PROGRESS', title: 'Active' }]);
assert.ok(!inProgressHtml.includes('queue-btn-accept'),
  'IN_PROGRESS row has no Accept button');
assert.ok(!inProgressHtml.includes('queue-accepted-pill'),
  'IN_PROGRESS row has no Accepted pill');

// ── Test 2: Queue panel — [Edit] visible for both STAGED and QUEUED rows ─────

const editMatches = queueHtml.match(/class="queue-btn-edit"/g) || [];
assert.strictEqual(editMatches.length, 3,
  'Edit button visible for STAGED + 2 QUEUED rows (3 total)');

// ── Test 3: Accepted pill is non-interactive (span, not button) ──────────────

assert.ok(!queueHtml.includes('<button class="queue-accepted-pill"'),
  'Accepted pill must not be a <button>');
assert.ok(queueHtml.includes('<span class="queue-accepted-pill">'),
  'Accepted pill must be a <span>');

// ── Test 4: History pagination — 12 rows paginates at 5 ─────────────────────

const historyRows = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), title: `Slice ${i + 1}` }));

const page1 = paginateHistory(historyRows, 1);
assert.strictEqual(page1.rows.length, 5, 'page 1 has 5 rows');
assert.strictEqual(page1.totalPages, 3, '12 rows / 5 = 3 pages');
assert.strictEqual(page1.page, 1, 'current page is 1');

const page2 = paginateHistory(historyRows, 2);
assert.strictEqual(page2.rows.length, 5, 'page 2 has 5 rows');

const page3 = paginateHistory(historyRows, 3);
assert.strictEqual(page3.rows.length, 2, 'page 3 has 2 rows (12 - 10)');
assert.strictEqual(page3.page, 3, 'current page is 3');

// ── Test 5: Pagination controls state ────────────────────────────────────────

function renderPaginationControls(page, totalPages) {
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;
  return {
    prevDisabled,
    nextDisabled,
    label: `Page ${page} of ${totalPages}`,
  };
}

const ctrl1 = renderPaginationControls(1, 3);
assert.ok(ctrl1.prevDisabled,   'Prev disabled on page 1');
assert.ok(!ctrl1.nextDisabled,  'Next enabled on page 1');
assert.strictEqual(ctrl1.label, 'Page 1 of 3', 'label on page 1');

const ctrl3 = renderPaginationControls(3, 3);
assert.ok(!ctrl3.prevDisabled,  'Prev enabled on page 3');
assert.ok(ctrl3.nextDisabled,   'Next disabled on last page');
assert.strictEqual(ctrl3.label, 'Page 3 of 3', 'label on page 3');

// ── Test 6: HISTORY_PAGE_SIZE constant is 5 ──────────────────────────────────

assert.strictEqual(HISTORY_PAGE_SIZE, 5, 'HISTORY_PAGE_SIZE must be 5');

console.log('dashboard-render.test.js: all tests passed');
