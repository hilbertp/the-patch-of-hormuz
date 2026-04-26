'use strict';

/**
 * return-to-stage.test.js
 *
 * Regression tests for slice 226 — Return-to-Stage body reconstruction from
 * trash/register for ERROR sidecars.
 *
 * Tests A–E per brief spec.
 *
 * Run: node test/return-to-stage.test.js
 */

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const assert = require('assert');

const { handleReturnToStage, findOriginalSliceBody, _testSetRegisterFile, _testSetDirs } = require('../bridge/orchestrator.js');

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

const TEMP   = fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-rts-test-'));
const QUEUE  = path.join(TEMP, 'queue');
const STAGED = path.join(TEMP, 'staged');
const TRASH  = path.join(TEMP, 'trash');
const REG    = path.join(TEMP, 'register.jsonl');

function setup() {
  for (const d of [QUEUE, STAGED, TRASH]) {
    fs.mkdirSync(d, { recursive: true });
    // Clean contents
    for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
  }
  fs.writeFileSync(REG, '', 'utf8');
  _testSetRegisterFile(REG);
  _testSetDirs(QUEUE, STAGED, TRASH);
}

function cleanup() {
  fs.rmSync(TEMP, { recursive: true, force: true });
}

function makeSliceContent(id, extra) {
  const fm = Object.assign({
    id: String(id), title: `Test slice ${id}`, goal: 'Test goal',
    from: 'obrien', to: 'rom', priority: 'high',
    created: '2026-04-26T10:00:00.000Z', status: 'IN_PROGRESS',
  }, extra || {});
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) lines.push(`${k}: "${v}"`);
  lines.push('---', '', '## Tasks', '', '- Do the thing');
  return lines.join('\n');
}

function makeErrorSidecar(id) {
  return [
    '---',
    `id: "${id}"`,
    `title: "Slice ${id} — invalid_slice"`,
    'from: orchestrator',
    'to: chiefobrien',
    'status: ERROR',
    `slice_id: "${id}"`,
    `completed: "2026-04-26T12:00:00.000Z"`,
    `reason: "invalid_slice"`,
    '---',
    '',
    'Error: invalid_slice',
  ].join('\n');
}

function makeMergedContent(id) {
  return makeSliceContent(id, { status: 'ACCEPTED', from: 'obrien', to: 'rom' });
}

function readReg() {
  try {
    return fs.readFileSync(REG, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

// ---------------------------------------------------------------------------
// Test A: Return-to-stage on ACCEPTED file (existing path) — unchanged behavior
// ---------------------------------------------------------------------------
function testA() {
  setup();
  const id = '900';
  // Write an ACCEPTED file with full content (non-ERROR).
  fs.writeFileSync(path.join(QUEUE, `${id}-ACCEPTED.md`), makeMergedContent(id));

  const result = handleReturnToStage(id);
  assert.strictEqual(result.ok, true, `Test A: expected ok=true, got ${JSON.stringify(result)}`);

  // STAGED file should exist with original frontmatter (no notice for non-ERROR).
  const stagedPath = path.join(STAGED, `${id}-STAGED.md`);
  assert.ok(fs.existsSync(stagedPath), 'Test A: STAGED file should exist');
  const content = fs.readFileSync(stagedPath, 'utf-8');
  assert.ok(content.includes('goal: "Test goal"'), 'Test A: should have original goal');
  assert.ok(content.includes('priority: "high"'), 'Test A: should have original priority');
  assert.ok(!content.includes('## Return-to-Stage notice'), 'Test A: non-ERROR should NOT have notice');
  // Register event should have body_source: "none" (non-ERROR path).
  const events = readReg().filter(e => e.event === 'RETURN_TO_STAGE');
  assert.ok(events.length > 0, 'Test A: should have RETURN_TO_STAGE event');

  console.log('  PASS  Test A: ACCEPTED file return-to-stage (existing path)');
}

// ---------------------------------------------------------------------------
// Test B: ERROR sidecar with body in trash — finds body, builds STAGED with notice
// ---------------------------------------------------------------------------
function testB() {
  setup();
  const id = '901';
  // Write ERROR sidecar in queue.
  fs.writeFileSync(path.join(QUEUE, `${id}-ERROR.md`), makeErrorSidecar(id));
  // Write original IN_PROGRESS in trash.
  fs.writeFileSync(path.join(TRASH, `${id}-IN_PROGRESS.md.cleanup-ERROR-2026-04-26T12-00-00-000Z`), makeSliceContent(id));

  const result = handleReturnToStage(id);
  assert.strictEqual(result.ok, true, `Test B: expected ok=true, got ${JSON.stringify(result)}`);

  const stagedPath = path.join(STAGED, `${id}-STAGED.md`);
  assert.ok(fs.existsSync(stagedPath), 'Test B: STAGED file should exist');
  const content = fs.readFileSync(stagedPath, 'utf-8');
  assert.ok(content.includes('goal: "Test goal"'), 'Test B: should have original goal');
  assert.ok(content.includes('priority: "high"'), 'Test B: should have original priority');
  assert.ok(content.includes('status: "STAGED"'), 'Test B: status should be STAGED');
  assert.ok(content.includes('## Return-to-Stage notice'), 'Test B: should have notice');

  // ERROR file should be archived to trash.
  assert.ok(!fs.existsSync(path.join(QUEUE, `${id}-ERROR.md`)), 'Test B: ERROR file should be gone from queue');
  const trashFiles = fs.readdirSync(TRASH).filter(f => f.startsWith(`${id}-ERROR.md.return-to-stage-`));
  assert.ok(trashFiles.length > 0, 'Test B: ERROR file should be in trash with return-to-stage suffix');

  // Register event should have body_source: "trash".
  const events = readReg().filter(e => e.event === 'RETURN_TO_STAGE' && e.slice_id === id);
  assert.ok(events.length > 0, 'Test B: should have RETURN_TO_STAGE event');
  assert.strictEqual(events[0].body_source, 'trash', 'Test B: body_source should be "trash"');

  console.log('  PASS  Test B: ERROR sidecar with body in trash');
}

// ---------------------------------------------------------------------------
// Test C: ERROR sidecar with body in register only (no trash)
// ---------------------------------------------------------------------------
function testC() {
  setup();
  const id = '902';
  // Write ERROR sidecar in queue.
  fs.writeFileSync(path.join(QUEUE, `${id}-ERROR.md`), makeErrorSidecar(id));
  // Write COMMISSIONED event in register with body field.
  const regEntry = JSON.stringify({
    ts: '2026-04-26T09:00:00.000Z', slice_id: id, event: 'COMMISSIONED',
    title: `Test slice ${id}`, goal: 'Test goal', body: makeSliceContent(id),
  });
  fs.writeFileSync(REG, regEntry + '\n');

  const result = handleReturnToStage(id);
  assert.strictEqual(result.ok, true, `Test C: expected ok=true, got ${JSON.stringify(result)}`);

  const stagedPath = path.join(STAGED, `${id}-STAGED.md`);
  assert.ok(fs.existsSync(stagedPath), 'Test C: STAGED file should exist');
  const content = fs.readFileSync(stagedPath, 'utf-8');
  assert.ok(content.includes('goal: "Test goal"'), 'Test C: should have original goal');
  assert.ok(content.includes('## Return-to-Stage notice'), 'Test C: should have notice');

  // Register event should have body_source: "register".
  const events = readReg().filter(e => e.event === 'RETURN_TO_STAGE' && e.slice_id === id);
  assert.ok(events.length > 0, 'Test C: should have RETURN_TO_STAGE event');
  assert.strictEqual(events[0].body_source, 'register', 'Test C: body_source should be "register"');

  console.log('  PASS  Test C: ERROR sidecar with body in register only');
}

// ---------------------------------------------------------------------------
// Test D: ERROR sidecar with no recoverable body — returns error
// ---------------------------------------------------------------------------
function testD() {
  setup();
  const id = '903';
  // Write ERROR sidecar in queue, no trash files, no register events.
  fs.writeFileSync(path.join(QUEUE, `${id}-ERROR.md`), makeErrorSidecar(id));

  const result = handleReturnToStage(id);
  assert.strictEqual(result.ok, false, `Test D: expected ok=false, got ${JSON.stringify(result)}`);
  assert.ok(result.error.includes('no recoverable source'), `Test D: error should mention no recoverable source, got: ${result.error}`);

  // No STAGED file should be created.
  const stagedFiles = fs.readdirSync(STAGED).filter(f => f.startsWith(`${id}-`));
  assert.strictEqual(stagedFiles.length, 0, 'Test D: no STAGED file should exist');

  // ERROR file should remain in queue (non-destructive).
  assert.ok(fs.existsSync(path.join(QUEUE, `${id}-ERROR.md`)), 'Test D: ERROR file should still be in queue');

  console.log('  PASS  Test D: ERROR sidecar with no recoverable body');
}

// ---------------------------------------------------------------------------
// Test E: Reconstructed STAGED contains Return-to-Stage notice section
// ---------------------------------------------------------------------------
function testE() {
  setup();
  const id = '904';
  fs.writeFileSync(path.join(QUEUE, `${id}-ERROR.md`), makeErrorSidecar(id));
  fs.writeFileSync(path.join(TRASH, `${id}-IN_PROGRESS.md.cleanup-ERROR-2026-04-26T13-00-00-000Z`), makeSliceContent(id));

  const result = handleReturnToStage(id);
  assert.strictEqual(result.ok, true, `Test E: expected ok=true, got ${JSON.stringify(result)}`);

  const content = fs.readFileSync(path.join(STAGED, `${id}-STAGED.md`), 'utf-8');
  assert.ok(content.includes('## Return-to-Stage notice'), 'Test E: notice header must exist');
  assert.ok(content.includes('returned to STAGED via the Ops button'), 'Test E: notice body text');
  assert.ok(content.includes('bridge/trash/'), 'Test E: notice references trash path');
  assert.ok(content.includes('See register events'), 'Test E: notice references register');

  console.log('  PASS  Test E: Return-to-Stage notice content');
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

console.log('return-to-stage.test.js');
try {
  testA();
  testB();
  testC();
  testD();
  testE();
  console.log('\nAll 5 tests passed.');
} catch (err) {
  console.error('\nFAILED:', err.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
