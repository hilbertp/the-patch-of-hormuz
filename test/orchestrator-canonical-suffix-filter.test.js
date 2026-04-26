'use strict';

/**
 * orchestrator-canonical-suffix-filter.test.js
 *
 * Regression tests for slice 218 — CANONICAL_SUFFIX_RE pre-terminology filter.
 * Tests A–F per brief spec.
 *
 * Run: node test/orchestrator-canonical-suffix-filter.test.js
 */

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const assert = require('assert');

const {
  getQueueSnapshot,
  auditLegacyFiles,
  CANONICAL_LIVE_SUFFIXES,
  CANONICAL_SUFFIX_RE,
  _testSetRegisterFile,
} = require('../bridge/orchestrator.js');

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

const TEMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-canonical-suffix-test-'));
const QUEUE = path.join(TEMP, 'queue');
const REG   = path.join(TEMP, 'register.jsonl');

function writeFile(name, content) {
  fs.writeFileSync(path.join(QUEUE, name), content || '---\nid: "999"\nstatus: "PENDING"\n---\n');
}

function readReg() {
  try {
    return fs.readFileSync(REG, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  // Fresh dirs for each test
  fs.rmSync(QUEUE, { recursive: true, force: true });
  fs.mkdirSync(QUEUE, { recursive: true });
  try { fs.unlinkSync(REG); } catch (_) {}
  fs.writeFileSync(REG, '', 'utf8');
  _testSetRegisterFile(REG);

  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nCanonical suffix filter tests (slice 218)\n');

// A. Dispatcher poll / heartbeat: only canonical QUEUED files counted
test('A. getQueueSnapshot only counts canonical-suffix files', () => {
  writeFile('100-QUEUED.md');
  writeFile('101-QUEUED.md');
  writeFile('086-BRIEF.md');
  writeFile('087-BRIEF.md');
  writeFile('088-BRIEF.md');

  const snap = getQueueSnapshot(QUEUE);
  assert.strictEqual(snap.waiting, 2, `Expected 2 waiting, got ${snap.waiting}`);
});

// B. crashRecovery: canonical filter applied (tested indirectly via getQueueSnapshot
//    since crashRecovery uses the same CANONICAL_SUFFIX_RE filter on readdirSync).
//    We verify the regex directly rejects non-canonical files.
test('B. CANONICAL_SUFFIX_RE rejects pre-terminology suffixes in crashRecovery scan', () => {
  const nonCanonical = [
    '086-BRIEF.md', '087-COMMISSION.md', '088-SLICE.md',
    '089-NEEDS_AMENDMENT.md', '090-NEEDS_APENDMENT.md',
  ];
  const canonical = [
    '100-QUEUED.md', '101-IN_PROGRESS.md', '102-DONE.md',
    '103-EVALUATING.md', '104-ACCEPTED.md',
  ];

  for (const f of nonCanonical) {
    assert.strictEqual(CANONICAL_SUFFIX_RE.test(f), false, `${f} should NOT match`);
  }
  for (const f of canonical) {
    assert.strictEqual(CANONICAL_SUFFIX_RE.test(f), true, `${f} should match`);
  }
});

// C. Heartbeat counter: only counts canonical-suffix files
test('C. Heartbeat counter (getQueueSnapshot) excludes non-canonical files', () => {
  writeFile('100-DONE.md');
  writeFile('101-IN_PROGRESS.md');
  writeFile('102-ERROR.md');
  writeFile('086-BRIEF.md');
  writeFile('087-COMMISSION.md');

  const snap = getQueueSnapshot(QUEUE);
  assert.strictEqual(snap.completed, 1, `Expected 1 completed, got ${snap.completed}`);
  assert.strictEqual(snap.in_progress, 1, `Expected 1 in_progress, got ${snap.in_progress}`);
  assert.strictEqual(snap.failed, 1, `Expected 1 failed, got ${snap.failed}`);
  assert.strictEqual(snap.waiting, 0, `Expected 0 waiting, got ${snap.waiting}`);
});

// D. LEGACY_FILES_DETECTED event emitted for non-canonical files
test('D. auditLegacyFiles emits LEGACY_FILES_DETECTED with count and sample', () => {
  writeFile('086-BRIEF.md');
  writeFile('087-BRIEF.md');
  writeFile('088-COMMISSION.md');
  writeFile('089-SLICE.md');
  writeFile('090-NEEDS_AMENDMENT.md');
  // Also add a canonical file — should NOT be counted
  writeFile('100-QUEUED.md');

  auditLegacyFiles({ queueDir: QUEUE });

  const events = readReg().filter(e => e.event === 'LEGACY_FILES_DETECTED');
  assert.strictEqual(events.length, 1, `Expected 1 LEGACY_FILES_DETECTED event, got ${events.length}`);
  assert.strictEqual(events[0].count, 5, `Expected count 5, got ${events[0].count}`);
  assert.ok(Array.isArray(events[0].sample), 'sample should be an array');
  assert.ok(events[0].sample.length <= 10, 'sample should have at most 10 entries');
  assert.strictEqual(events[0].slice_id, 'audit');
});

// E. No event when queue is clean
test('E. auditLegacyFiles does NOT emit when queue has only canonical files', () => {
  writeFile('100-QUEUED.md');
  writeFile('101-DONE.md');
  writeFile('102-ACCEPTED.md');

  auditLegacyFiles({ queueDir: QUEUE });

  const events = readReg().filter(e => e.event === 'LEGACY_FILES_DETECTED');
  assert.strictEqual(events.length, 0, `Expected 0 LEGACY_FILES_DETECTED events, got ${events.length}`);
});

// F. Every suffix in slice-pipeline.md §4 state table appears in CANONICAL_LIVE_SUFFIXES
test('F. Documented §4 suffixes are all present in CANONICAL_LIVE_SUFFIXES', () => {
  // From docs/contracts/slice-pipeline.md §4 table + PARKED note
  const documented = [
    '-STAGED.md',
    '-QUEUED.md',
    '-IN_PROGRESS.md',
    '-DONE.md',
    '-IN_REVIEW.md',
    '-ACCEPTED.md',
    '-ARCHIVED.md',
    '-PARKED.md',       // mentioned in §4 note
  ];

  for (const suffix of documented) {
    assert.ok(
      CANONICAL_LIVE_SUFFIXES.includes(suffix),
      `${suffix} from §4 is missing from CANONICAL_LIVE_SUFFIXES`
    );
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed\n`);

// Cleanup
fs.rmSync(TEMP, { recursive: true, force: true });

if (failed > 0) process.exit(1);
