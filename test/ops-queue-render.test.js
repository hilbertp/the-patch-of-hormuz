'use strict';

const assert = require('assert');

// Pure re-implementation of buildQueueRows() from lcars-dashboard.html for testing.
// Mirrors the exact ordering and normalization logic.
function buildQueueRows(stagedItems, bridgeSlices, queueOrder, stagedOrder) {
  function isApendment(item) {
    return item.references && item.references !== 'null';
  }

  // 1. STAGED rows — newest unordered first, then stagedOrder
  const stagedBase = stagedItems
    .filter(s => s.status !== 'NEEDS_APENDMENT')
    .map(s => ({ id: s.id, title: s.title, sprint: s.sprint, references: s.references, rowState: 'STAGED', isApendment: false }));
  const stagedOrdered = [];
  for (const oid of stagedOrder) {
    const f = stagedBase.find(s => s.id === oid);
    if (f) stagedOrdered.push(f);
  }
  const stagedUnordered = stagedBase
    .filter(s => !stagedOrder.includes(s.id))
    .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));
  const stagedRows = [...stagedOrdered, ...stagedUnordered];

  // 2. NEEDS_APENDMENT rows
  const needsAmendRows = stagedItems
    .filter(s => s.status === 'NEEDS_APENDMENT')
    .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
    .map(s => ({ id: s.id, title: s.title, sprint: s.sprint, references: s.references, rowState: 'NEEDS_APENDMENT', isApendment: false }));

  // 3. QUEUED/PENDING amendment rows — locked at top of QUEUED group
  const queuedSlices = bridgeSlices.filter(b => b.state === 'QUEUED' || b.state === 'PENDING');
  const amendmentRows = queuedSlices
    .filter(b => isApendment(b))
    .sort((a, b) => new Date(a.created || 0) - new Date(b.created || 0))
    .map(b => ({ ...b, rowState: 'QUEUED', isApendment: true }));

  // 4. QUEUED/PENDING non-amendment rows — ordered by queueOrder
  const normalQueued = queuedSlices.filter(b => !isApendment(b));
  const orderedQueued = [];
  for (const oid of queueOrder) {
    const f = normalQueued.find(b => b.id === oid);
    if (f) orderedQueued.push(f);
  }
  const unorderedQueued = normalQueued
    .filter(b => !queueOrder.includes(b.id))
    .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
  for (const b of unorderedQueued) orderedQueued.push(b);
  const queuedRows = orderedQueued.map(b => ({ ...b, rowState: 'QUEUED', isApendment: false }));

  // 5. IN_PROGRESS rows (desc ID)
  const inProgressRows = bridgeSlices
    .filter(b => b.state === 'IN_PROGRESS')
    .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10))
    .map(b => ({ ...b, rowState: 'IN_PROGRESS', isApendment: false }));

  // 6. DONE rows (desc ID)
  const doneRows = bridgeSlices
    .filter(b => b.state === 'DONE')
    .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10))
    .map(b => ({ ...b, rowState: 'DONE', isApendment: false }));

  // 7. ERROR rows (desc ID)
  const errorRows = bridgeSlices
    .filter(b => b.state === 'ERROR')
    .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10))
    .map(b => ({ ...b, rowState: 'ERROR', isApendment: false }));

  return [...stagedRows, ...needsAmendRows, ...amendmentRows, ...queuedRows, ...inProgressRows, ...doneRows, ...errorRows];
}

// ── Test 1: each state produces a row with the correct data-state value ───────

const stagedItems = [
  { id: '10', title: 'Staged slice',   status: 'STAGED',          sprint: 1, references: null },
  { id: '11', title: 'Needs amend',    status: 'NEEDS_APENDMENT', sprint: 1, references: null },
];

const bridgeSlices = [
  { id: '20', title: 'Queued slice',   state: 'QUEUED',      sprint: 1, references: null },
  { id: '21', title: 'Legacy queued',  state: 'PENDING',     sprint: 1, references: null },
  { id: '30', title: 'In progress',    state: 'IN_PROGRESS', sprint: 1, references: null },
  { id: '40', title: 'Done slice',     state: 'DONE',        sprint: 1, references: null },
  { id: '50', title: 'Error slice',    state: 'ERROR',       sprint: 1, references: null },
];

const rows = buildQueueRows(stagedItems, bridgeSlices, [], []);

assert.strictEqual(rows.length, 7, 'should produce 7 rows total (STAGED + NEEDS_APENDMENT + 2×QUEUED + IN_PROGRESS + DONE + ERROR)');

// Each row must expose a rowState matching its state literal
const byState = {};
for (const r of rows) {
  byState[r.rowState] = (byState[r.rowState] || []).concat(r);
}

assert.ok(byState['STAGED'],          'STAGED rows exist');
assert.strictEqual(byState['STAGED'].length, 1, 'one STAGED row');
assert.strictEqual(byState['STAGED'][0].id, '10', 'STAGED row id is 10');

assert.ok(byState['NEEDS_APENDMENT'], 'NEEDS_APENDMENT rows exist');
assert.strictEqual(byState['NEEDS_APENDMENT'].length, 1, 'one NEEDS_APENDMENT row');

assert.ok(byState['QUEUED'],          'QUEUED rows exist');
assert.strictEqual(byState['QUEUED'].length, 2, 'two QUEUED rows (QUEUED + PENDING normalised to QUEUED)');

assert.ok(byState['IN_PROGRESS'],     'IN_PROGRESS rows exist');
assert.strictEqual(byState['IN_PROGRESS'].length, 1, 'one IN_PROGRESS row');

assert.ok(byState['DONE'],            'DONE rows exist');
assert.strictEqual(byState['DONE'].length, 1, 'one DONE row');

assert.ok(byState['ERROR'],           'ERROR rows exist');
assert.strictEqual(byState['ERROR'].length, 1, 'one ERROR row');

// ── Test 2: ordering matches target ─────────────────────────────────────────

const expectedOrder = ['STAGED', 'NEEDS_APENDMENT', 'QUEUED', 'QUEUED', 'IN_PROGRESS', 'DONE', 'ERROR'];
const actualOrder = rows.map(r => r.rowState);
assert.deepStrictEqual(actualOrder, expectedOrder,
  'ordering must be: STAGED → NEEDS_APENDMENT → QUEUED → IN_PROGRESS → DONE → ERROR');

// ── Test 3: PENDING normalises to QUEUED rowState ────────────────────────────

const pendingRow = rows.find(r => r.id === '21');
assert.ok(pendingRow, 'PENDING slice is included in output');
assert.strictEqual(pendingRow.rowState, 'QUEUED', 'PENDING state normalises to QUEUED rowState');

// ── Test 4: amendments are locked at top of the QUEUED group ─────────────────

const amdSlices = [
  { id: '100', title: 'Amendment', state: 'QUEUED', sprint: 1, references: '50', created: '2026-01-01T00:00:00Z' },
  { id: '101', title: 'Normal',    state: 'QUEUED', sprint: 1, references: null, created: '2026-01-02T00:00:00Z' },
];
const amdRows = buildQueueRows([], amdSlices, ['101'], []);
assert.strictEqual(amdRows.length, 2, 'two QUEUED rows');
assert.strictEqual(amdRows[0].isApendment, true,  'amendment row comes first');
assert.strictEqual(amdRows[1].isApendment, false, 'normal queued row comes second');

// ── Test 5: STAGED newest-first within unordered group ───────────────────────

const multiStaged = [
  { id: '5',  title: 'Older staged', status: 'STAGED', sprint: 1, references: null },
  { id: '15', title: 'Newer staged', status: 'STAGED', sprint: 1, references: null },
];
const sortedStaged = buildQueueRows(multiStaged, [], [], []);
assert.strictEqual(sortedStaged[0].id, '15', 'newer STAGED item (higher id) appears first');
assert.strictEqual(sortedStaged[1].id, '5',  'older STAGED item appears second');

// ── Test 6: explicit stagedOrder overrides default sort ──────────────────────

const orderedRows = buildQueueRows(multiStaged, [], [], ['5', '15']);
assert.strictEqual(orderedRows[0].id, '5',  'stagedOrder: 5 first when explicitly ordered');
assert.strictEqual(orderedRows[1].id, '15', 'stagedOrder: 15 second when explicitly ordered');

console.log('ops-queue-render.test.js: all tests passed');
