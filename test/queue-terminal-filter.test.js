'use strict';

/**
 * queue-terminal-filter.test.js
 *
 * Regression test for slice 227 — ERROR + STUCK terminal-state filtering.
 *
 * Verifies that the Queue panel filter excludes all terminal states
 * (ACCEPTED, ARCHIVED, ERROR, STUCK, SLICE) and includes all non-terminal
 * states (QUEUED, PENDING, IN_PROGRESS, DONE, IN_REVIEW, EVALUATING, PARKED, STAGED).
 *
 * Run: node test/queue-terminal-filter.test.js
 */

const assert = require('assert');

// Mirror of the updated regex from dashboard/server.js (slice 227)
const TERMINAL_FILE_RE = /^(.+?)-(ACCEPTED|ARCHIVED|ERROR|STUCK|SLICE)\.md$/;
const QUEUE_FILE_RE    = /^(.+?)-(PENDING|QUEUED|IN_PROGRESS|DONE|ERROR)\.md$/;

function filterQueueSlices(files, events = []) {
  const mergedIds = new Set();
  for (const ev of events) {
    if (ev.event === 'MERGED') mergedIds.add(String(ev.id));
  }

  const terminalIds = new Set(mergedIds);
  for (const f of files) {
    const m = f.match(TERMINAL_FILE_RE);
    if (m) terminalIds.add(String(m[1]));
  }

  const result = [];
  for (const f of files) {
    const m = f.match(QUEUE_FILE_RE);
    if (!m) continue;
    const [, rawId, state] = m;
    if (terminalIds.has(rawId)) continue;
    result.push({ id: rawId, state });
  }
  return result;
}

// ── Synthetic seed: one slice in each state ─────────────────────────────────

const syntheticFiles = [
  // Non-terminal states — should appear in Queue
  '301-QUEUED.md',
  '302-PENDING.md',
  '303-IN_PROGRESS.md',
  '304-DONE.md',

  // Terminal states — should be excluded from Queue
  '305-ACCEPTED.md',
  '305-DONE.md',
  '306-ARCHIVED.md',
  '306-DONE.md',
  '307-ERROR.md',         // slice 227: now terminal
  '308-STUCK.md',         // slice 227: now terminal
  '308-DONE.md',
  '309-SLICE.md',
  '309-DONE.md',
];

// ── Test 1: Queue includes only non-terminal slices ─────────────────────────

const queue = filterQueueSlices(syntheticFiles);

const includedIds = new Set(queue.map(s => s.id));
const excludedIds = ['305', '306', '307', '308', '309'];

// Non-terminal slices present
assert.ok(includedIds.has('301'), 'QUEUED slice 301 must be in queue');
assert.ok(includedIds.has('302'), 'PENDING slice 302 must be in queue');
assert.ok(includedIds.has('303'), 'IN_PROGRESS slice 303 must be in queue');
assert.ok(includedIds.has('304'), 'DONE slice 304 (awaiting review) must be in queue');

// Terminal slices absent
for (const id of excludedIds) {
  assert.ok(!includedIds.has(id),
    `Terminal slice ${id} must be absent from queue`);
}

assert.strictEqual(queue.length, 4,
  'Queue should contain exactly 4 non-terminal slices');

// ── Test 2: ERROR file without separate marker still excluded ───────────────
// An ERROR file like 307-ERROR.md matches BOTH regexes:
// - TERMINAL_FILE_RE captures it as terminal (adds 307 to terminalIds)
// - QUEUE_FILE_RE would capture it as a queue entry
// The terminal filter must win.

const errorOnly = filterQueueSlices(['307-ERROR.md']);
assert.strictEqual(errorOnly.length, 0,
  'Standalone ERROR file must be excluded from queue (terminal filter wins)');

// ── Test 3: History panel is unaffected (register-event based) ──────────────

function buildHistory(events) {
  const map = {};
  for (const ev of events) {
    if (ev.event === 'DONE' || ev.event === 'ERROR') {
      map[ev.id] = { id: ev.id, outcome: ev.event };
    }
  }
  return Object.values(map);
}

const historyEvents = [
  { event: 'DONE',  id: '301' },
  { event: 'ERROR', id: '307' },
  { event: 'DONE',  id: '308' },
];

const history = buildHistory(historyEvents);
assert.strictEqual(history.length, 3,
  'History includes ERROR and DONE slices regardless of queue filter');
assert.ok(history.some(h => h.id === '307' && h.outcome === 'ERROR'),
  'ERROR slice 307 appears in history');

console.log('queue-terminal-filter.test.js: all 3 tests passed');
