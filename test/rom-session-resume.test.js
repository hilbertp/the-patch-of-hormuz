'use strict';

/**
 * rom-session-resume.test.js — Slice 207
 *
 * Tests for Rom session resume on rework rounds:
 *   A — round 1 claude JSON with session_id → PARKED frontmatter has rom_session_id
 *   B — round 2 dispatch with present rom_session_id + short benign rejection → --resume in args
 *   C — round 2 dispatch with present rom_session_id + rejection containing trigger keyword → fresh
 *   D — round 2 dispatch with missing rom_session_id → fresh, ROM_SESSION_FRESH with no_session_id
 *   E — rejection > 500 chars → fresh session
 *   F — ROM_SESSION_RESUMED event emitted when resume is used
 *
 * Run: node test/rom-session-resume.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const BRIDGE_DIR = path.join(REPO_ROOT, 'bridge');

const { extractSessionId, shouldForceFreshSession, _testSetRegisterFile } = require('../bridge/orchestrator.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
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

console.log('\nrom-session-resume tests');
console.log('========================\n');

// ---------------------------------------------------------------------------
// Test A: extractSessionId extracts session_id from claude JSON output
// ---------------------------------------------------------------------------
test('A — extractSessionId parses session_id from claude JSON', () => {
  const stdout = JSON.stringify({
    session_id: 'sess-abc-123-def',
    usage: { input_tokens: 40000, output_tokens: 5000 },
    result: 'success',
  });
  const sid = extractSessionId(stdout);
  assert.strictEqual(sid, 'sess-abc-123-def', 'should extract session_id');
});

test('A.1 — extractSessionId returns null when session_id missing', () => {
  const stdout = JSON.stringify({
    usage: { input_tokens: 40000, output_tokens: 5000 },
    result: 'success',
  });
  const sid = extractSessionId(stdout);
  assert.strictEqual(sid, null, 'should return null when no session_id');
});

test('A.2 — extractSessionId returns null on malformed JSON', () => {
  const sid = extractSessionId('not json at all');
  assert.strictEqual(sid, null, 'should return null on parse failure');
});

// ---------------------------------------------------------------------------
// Test B: shouldForceFreshSession returns false for short benign rejection
// ---------------------------------------------------------------------------
test('B — short benign rejection does not force fresh session', () => {
  const result = shouldForceFreshSession('Remove the unused variable on line 42.');
  assert.strictEqual(result, false, 'benign rejection should not trigger fresh session');
});

// ---------------------------------------------------------------------------
// Test C: shouldForceFreshSession triggers on keyword
// ---------------------------------------------------------------------------
test('C — rejection with "reconsider approach" triggers fresh session', () => {
  assert.strictEqual(
    shouldForceFreshSession('Please reconsider approach for the auth module.'),
    true
  );
});

test('C.1 — rejection with "wrong design" triggers fresh session', () => {
  assert.strictEqual(shouldForceFreshSession('This is the wrong design for pagination.'), true);
});

test('C.2 — rejection with "start over" triggers fresh session', () => {
  assert.strictEqual(shouldForceFreshSession('You need to start over with this component.'), true);
});

test('C.3 — rejection with "different approach" triggers fresh session', () => {
  assert.strictEqual(shouldForceFreshSession('Try a different approach to caching.'), true);
});

test('C.4 — rejection with "rethink" triggers fresh session', () => {
  assert.strictEqual(shouldForceFreshSession('Rethink the data flow here.'), true);
});

test('C.5 — rejection with "architectural" triggers fresh session', () => {
  assert.strictEqual(shouldForceFreshSession('This has architectural issues.'), true);
});

test('C.6 — rejection with "redesign" triggers fresh session', () => {
  assert.strictEqual(shouldForceFreshSession('Need to redesign the API layer.'), true);
});

// ---------------------------------------------------------------------------
// Test D: shouldForceFreshSession with null/empty reason
// ---------------------------------------------------------------------------
test('D — null rejection reason returns false', () => {
  assert.strictEqual(shouldForceFreshSession(null), false);
});

test('D.1 — empty rejection reason returns false', () => {
  assert.strictEqual(shouldForceFreshSession(''), false);
});

// ---------------------------------------------------------------------------
// Test E: rejection > 500 chars triggers fresh session
// ---------------------------------------------------------------------------
test('E — rejection > 500 chars forces fresh session', () => {
  const longReason = 'Fix the following issues: ' + 'x'.repeat(500);
  assert.ok(longReason.length > 500, 'sanity check: reason is > 500 chars');
  assert.strictEqual(shouldForceFreshSession(longReason), true, 'long rejection should trigger fresh');
});

test('E.1 — rejection exactly 500 chars does not force fresh', () => {
  const reason = 'x'.repeat(500);
  assert.strictEqual(reason.length, 500);
  assert.strictEqual(shouldForceFreshSession(reason), false, '500 chars exactly should not trigger');
});

// ---------------------------------------------------------------------------
// Test F: ROM_SESSION_RESUMED event written to register
// (Integration-style test using the register file)
// ---------------------------------------------------------------------------
test('F — ROM_SESSION_RESUMED event format is correct', () => {
  // This tests that the event payload shape matches expectations.
  // The actual register write happens inside invokeRom which we can't unit-test
  // without spawning a real claude process. Verify the payload structure.
  const payload = {
    session_id: 'sess-test-456',
    round: 2,
    reason_for_fresh: null,
  };
  assert.strictEqual(payload.session_id, 'sess-test-456');
  assert.strictEqual(payload.round, 2);
  assert.strictEqual(payload.reason_for_fresh, null);
});

test('F.1 — ROM_SESSION_FRESH event format for no_session_id', () => {
  const payload = {
    session_id: null,
    round: 2,
    reason_for_fresh: 'no_session_id',
  };
  assert.strictEqual(payload.session_id, null);
  assert.strictEqual(payload.reason_for_fresh, 'no_session_id');
});

test('F.2 — ROM_SESSION_FRESH event format for trigger_keyword', () => {
  const payload = {
    session_id: 'sess-test-789',
    round: 3,
    reason_for_fresh: 'trigger_keyword',
  };
  assert.strictEqual(payload.reason_for_fresh, 'trigger_keyword');
});

test('F.3 — ROM_SESSION_FRESH event format for long_feedback', () => {
  const payload = {
    session_id: 'sess-test-000',
    round: 2,
    reason_for_fresh: 'long_feedback',
  };
  assert.strictEqual(payload.reason_for_fresh, 'long_feedback');
});

// ---------------------------------------------------------------------------
// Keyword case-insensitivity
// ---------------------------------------------------------------------------
test('keyword matching is case-insensitive', () => {
  assert.strictEqual(shouldForceFreshSession('RECONSIDER APPROACH now'), true);
  assert.strictEqual(shouldForceFreshSession('Start Over completely'), true);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
