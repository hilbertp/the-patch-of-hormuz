'use strict';

/**
 * orchestrator-validation.test.js
 *
 * Tests for the validateIntakeMeta helper introduced in slice 198.
 * Verifies that:
 *   - Fresh slices still require all 6 fields (id, title, from, to, priority, created)
 *   - Amendment/rework files pass with only 4 fields (id, title, from, to) when
 *     any amendment signal is present: rounds[], round>1, apendment, amendment,
 *     or non-null references.
 *
 * Tests A–F match the acceptance criteria from brief 198:
 *   A: Fresh slice missing priority+created → rejected
 *   B: Amendment with rounds array → accepted
 *   C: Amendment with round > 1 → accepted
 *   D: Amendment with apendment ref → accepted
 *   E: Amendment with rounds but blank id → rejected with ['id']
 *   F: Fresh slice with blank priority → rejected with ['priority']
 *
 * Run: node test/orchestrator-validation.test.js
 */

const assert = require('assert');

const { validateIntakeMeta } = require('../bridge/orchestrator.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tests A–F
// ---------------------------------------------------------------------------

console.log('\nvalidateIntakeMeta — intake validation (slice 198)');

// Test A: fresh slice with only 4 fields → missing priority + created
test('A: fresh slice missing priority+created → rejected with both fields', () => {
  const meta = { id: '999', title: 'My Slice', from: 'kira', to: 'rom' };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, false, 'should be invalid');
  assert.deepStrictEqual(missingFields.sort(), ['created', 'priority']);
});

// Test B: amendment with rounds array → passes 4-field set
test('B: amendment with rounds array → accepted with id/title/from/to only', () => {
  const meta = {
    id: '189',
    title: 'Rework round 2',
    from: 'rom',
    to: 'nog',
    rounds: [{ round: 1, verdict: 'REJECTED' }],
  };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, true, 'should be valid');
  assert.deepStrictEqual(missingFields, []);
});

// Test C: amendment with round > 1 → accepted
test('C: amendment with round: 2 → accepted with id/title/from/to only', () => {
  const meta = { id: '189', title: 'Rework', from: 'rom', to: 'nog', round: '2' };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, true, 'should be valid');
  assert.deepStrictEqual(missingFields, []);
});

// Test D: amendment with apendment ref → accepted
test('D: amendment with apendment field → accepted with id/title/from/to only', () => {
  const meta = { id: '194', title: 'Fix', from: 'rom', to: 'nog', apendment: 'slice/189-fix' };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, true, 'should be valid');
  assert.deepStrictEqual(missingFields, []);
});

// Test E: amendment (rounds array present) but blank/missing id → rejected with ['id']
test('E: amendment with rounds but blank id → rejected with [\'id\']', () => {
  const meta = {
    id: '',
    title: 'Rework round 2',
    from: 'rom',
    to: 'nog',
    rounds: [{ round: 1, verdict: 'REJECTED' }],
  };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, false, 'should be invalid');
  assert.deepStrictEqual(missingFields, ['id']);
});

// Test F: fresh slice with blank priority → rejected with ['priority']
test('F: fresh slice with blank priority → rejected with [\'priority\']', () => {
  const meta = {
    id: '999',
    title: 'My Slice',
    from: 'kira',
    to: 'rom',
    priority: '',
    created: '2026-04-24T08:54:59.687Z',
  };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, false, 'should be invalid');
  assert.deepStrictEqual(missingFields, ['priority']);
});

// ---------------------------------------------------------------------------
// Additional coverage — other amendment signals
// ---------------------------------------------------------------------------

console.log('\nvalidateIntakeMeta — additional amendment signals');

test('type: amendment → accepted with 4 fields', () => {
  const meta = { id: '189', title: 'Fix', from: 'rom', to: 'nog', type: 'amendment' };
  const { ok } = validateIntakeMeta(meta);
  assert.strictEqual(ok, true);
});

test('amendment field → accepted with 4 fields', () => {
  const meta = { id: '189', title: 'Fix', from: 'rom', to: 'nog', amendment: 'slice/189' };
  const { ok } = validateIntakeMeta(meta);
  assert.strictEqual(ok, true);
});

test('references non-null string → accepted with 4 fields', () => {
  const meta = { id: '189', title: 'Fix', from: 'rom', to: 'nog', references: '188' };
  const { ok } = validateIntakeMeta(meta);
  assert.strictEqual(ok, true);
});

test('references "null" string → treated as fresh slice, requires 6 fields', () => {
  const meta = { id: '999', title: 'My Slice', from: 'kira', to: 'rom', references: 'null' };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, false);
  assert.deepStrictEqual(missingFields.sort(), ['created', 'priority']);
});

test('empty rounds array → treated as fresh slice, requires 6 fields', () => {
  const meta = { id: '999', title: 'My Slice', from: 'kira', to: 'rom', rounds: [] };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, false);
  assert.deepStrictEqual(missingFields.sort(), ['created', 'priority']);
});

test('round: 1 → treated as fresh slice, requires 6 fields', () => {
  const meta = { id: '999', title: 'My Slice', from: 'kira', to: 'rom', round: '1' };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, false);
  assert.deepStrictEqual(missingFields.sort(), ['created', 'priority']);
});

test('null meta → rejects all required fields', () => {
  const { ok, missingFields } = validateIntakeMeta(null);
  assert.strictEqual(ok, false);
  assert.deepStrictEqual(missingFields.sort(), ['created', 'from', 'id', 'priority', 'title', 'to']);
});

test('fresh slice with all 6 fields → accepted', () => {
  const meta = {
    id: '999',
    title: 'My Slice',
    from: 'kira',
    to: 'rom',
    priority: 'high',
    created: '2026-04-24T08:54:59.687Z',
  };
  const { ok, missingFields } = validateIntakeMeta(meta);
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(missingFields, []);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
