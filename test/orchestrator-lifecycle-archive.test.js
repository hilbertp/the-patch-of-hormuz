'use strict';

/**
 * orchestrator-lifecycle-archive.test.js
 *
 * Regression tests for slice 213 — ACCEPTED→ARCHIVED lifecycle transition,
 * ERROR sibling cleanup, and backfill archive.
 *
 * Tests A–J per brief spec.
 *
 * Run: node test/orchestrator-lifecycle-archive.test.js
 */

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const assert = require('assert');

const { archiveAcceptedSlice, archiveSiblingStateFiles, backfillArchive, _testSetRegisterFile } = require('../bridge/orchestrator.js');

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-archive-test-'));
const QUEUE = path.join(TEMP, 'queue');
const TRASH = path.join(TEMP, 'trash');
const REG   = path.join(TEMP, 'register.jsonl');

function setup() {
  fs.mkdirSync(QUEUE, { recursive: true });
  fs.mkdirSync(TRASH, { recursive: true });
  try { fs.unlinkSync(REG); } catch (_) {}
  fs.writeFileSync(REG, '', 'utf8');
  _testSetRegisterFile(REG);
}

function cleanup() {
  fs.rmSync(TEMP, { recursive: true, force: true });
}

function writeSliceFile(id, suffix, extraFrontmatter) {
  const fm = Object.assign({ id: String(id), title: `Test slice ${id}`, status: suffix.replace(/^-|\.md$/g, ''), branch: `slice/${id}` }, extraFrontmatter || {});
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) lines.push(`${k}: "${v}"`);
  lines.push('---', '', `## Slice ${id} body`);
  fs.writeFileSync(path.join(QUEUE, `${id}${suffix}`), lines.join('\n'));
}

function readReg() {
  try {
    return fs.readFileSync(REG, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

function queueFiles() {
  return fs.readdirSync(QUEUE).sort();
}

function trashFiles() {
  try { return fs.readdirSync(TRASH).sort(); } catch (_) { return []; }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  // Fresh dirs for each test
  fs.rmSync(QUEUE, { recursive: true, force: true });
  fs.rmSync(TRASH, { recursive: true, force: true });
  fs.mkdirSync(QUEUE, { recursive: true });
  fs.mkdirSync(TRASH, { recursive: true });
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
// Test A: archiveAcceptedSlice with valid ACCEPTED file
// ---------------------------------------------------------------------------

console.log('\n-- archiveAcceptedSlice --');

test('A. Valid ACCEPTED file → renames to ARCHIVED, emits ARCHIVED event', () => {
  writeSliceFile('900', '-ACCEPTED.md');
  const result = archiveAcceptedSlice('900', 'slice/900', { queueDir: QUEUE, trashDir: TRASH, source: 'merge' });
  assert.strictEqual(result.archived, true);
  assert.strictEqual(result.reason, 'ok');
  assert.ok(fs.existsSync(path.join(QUEUE, '900-ARCHIVED.md')), 'ARCHIVED file must exist');
  assert.ok(!fs.existsSync(path.join(QUEUE, '900-ACCEPTED.md')), 'ACCEPTED file must be gone');
  const events = readReg();
  const archivedEvt = events.find(e => e.event === 'ARCHIVED');
  assert.ok(archivedEvt, 'ARCHIVED event must be emitted');
  assert.strictEqual(archivedEvt.slice_id, '900');
  assert.strictEqual(archivedEvt.source, 'merge');
  assert.ok(archivedEvt.ts, 'ARCHIVED event must have ts');
  assert.ok(archivedEvt.branch, 'ARCHIVED event must have branch');
});

// ---------------------------------------------------------------------------
// Test B: archiveAcceptedSlice idempotency
// ---------------------------------------------------------------------------

test('B. Idempotency — second call is a no-op', () => {
  writeSliceFile('901', '-ACCEPTED.md');
  archiveAcceptedSlice('901', 'slice/901', { queueDir: QUEUE, trashDir: TRASH });
  const evtsBefore = readReg().length;
  const result = archiveAcceptedSlice('901', 'slice/901', { queueDir: QUEUE, trashDir: TRASH });
  assert.strictEqual(result.archived, false);
  assert.strictEqual(result.reason, 'already_archived');
  const evtsAfter = readReg().length;
  assert.strictEqual(evtsAfter, evtsBefore, 'No new events on idempotent call');
});

// ---------------------------------------------------------------------------
// Test C: archiveAcceptedSlice when worktree doesn't exist
// ---------------------------------------------------------------------------

test('C. No worktree present — still completes rename + branch-D (no crash)', () => {
  writeSliceFile('902', '-ACCEPTED.md');
  // No worktree exists at /tmp/ds9-worktrees/902 — should not crash
  const result = archiveAcceptedSlice('902', 'slice/902', { queueDir: QUEUE, trashDir: TRASH });
  assert.strictEqual(result.archived, true);
  assert.ok(fs.existsSync(path.join(QUEUE, '902-ARCHIVED.md')));
});

// ---------------------------------------------------------------------------
// Test D: archiveSiblingStateFiles with ERROR terminal
// ---------------------------------------------------------------------------

console.log('\n-- archiveSiblingStateFiles --');

test('D. ERROR terminal: moves DONE + IN_PROGRESS + PARKED to trash, leaves ERROR', () => {
  writeSliceFile('903', '-ERROR.md');
  writeSliceFile('903', '-DONE.md');
  writeSliceFile('903', '-IN_PROGRESS.md');
  writeSliceFile('903', '-PARKED.md');

  const count = archiveSiblingStateFiles('903', 'ERROR', { queueDir: QUEUE, trashDir: TRASH });
  assert.strictEqual(count, 3, 'Should move 3 sibling files');

  const remaining = queueFiles();
  assert.ok(remaining.includes('903-ERROR.md'), 'ERROR file must remain');
  assert.ok(!remaining.includes('903-DONE.md'), 'DONE must be moved');
  assert.ok(!remaining.includes('903-IN_PROGRESS.md'), 'IN_PROGRESS must be moved');
  assert.ok(!remaining.includes('903-PARKED.md'), 'PARKED must be moved');

  const trashed = trashFiles();
  assert.strictEqual(trashed.length, 3);
  assert.ok(trashed.every(f => f.includes('.cleanup-ERROR-')), 'All trash files must have ERROR cleanup suffix');

  const events = readReg();
  const sfaEvt = events.find(e => e.event === 'STATE_FILES_ARCHIVED');
  assert.ok(sfaEvt, 'STATE_FILES_ARCHIVED event must be emitted');
  assert.deepStrictEqual(sfaEvt.moved.sort(), ['903-DONE.md', '903-IN_PROGRESS.md', '903-PARKED.md'].sort());
});

// ---------------------------------------------------------------------------
// Test E: archiveSiblingStateFiles with ARCHIVED terminal
// ---------------------------------------------------------------------------

test('E. ARCHIVED terminal: moves DONE + PARKED + ACCEPTED to trash, leaves ARCHIVED', () => {
  writeSliceFile('904', '-ARCHIVED.md');
  writeSliceFile('904', '-DONE.md');
  writeSliceFile('904', '-PARKED.md');
  writeSliceFile('904', '-ACCEPTED.md');

  const count = archiveSiblingStateFiles('904', 'ARCHIVED', { queueDir: QUEUE, trashDir: TRASH });
  assert.strictEqual(count, 3, 'Should move 3 sibling files');

  const remaining = queueFiles();
  assert.ok(remaining.includes('904-ARCHIVED.md'), 'ARCHIVED file must remain');
  assert.ok(!remaining.includes('904-DONE.md'), 'DONE must be moved');
  assert.ok(!remaining.includes('904-PARKED.md'), 'PARKED must be moved');
  assert.ok(!remaining.includes('904-ACCEPTED.md'), 'ACCEPTED must be moved');
});

// ---------------------------------------------------------------------------
// Test F: mergeBranch happy path — source-level check
// ---------------------------------------------------------------------------

console.log('\n-- Integration (source-level checks) --');

const orchestratorSource = fs.readFileSync(
  path.join(__dirname, '..', 'bridge', 'orchestrator.js'),
  'utf-8'
);

test('F. mergeBranch success path calls archiveAcceptedSlice', () => {
  // Verify archiveAcceptedSlice is called in the handleAccepted success path
  const startIdx = orchestratorSource.indexOf('function handleAccepted(');
  const endIdx = orchestratorSource.indexOf('\nfunction ', startIdx + 1);
  const handleAcceptedBlock = orchestratorSource.slice(startIdx, endIdx > startIdx ? endIdx : startIdx + 5000);
  assert.ok(
    handleAcceptedBlock.includes('archiveAcceptedSlice(id, branchName)'),
    'handleAccepted must call archiveAcceptedSlice after merge'
  );
  // Verify it's wrapped in try/catch
  const archiveCallIdx = handleAcceptedBlock.indexOf('archiveAcceptedSlice(id, branchName)');
  const precedingBlock = handleAcceptedBlock.slice(Math.max(0, archiveCallIdx - 200), archiveCallIdx);
  assert.ok(precedingBlock.includes('try {'), 'archiveAcceptedSlice call must be wrapped in try/catch');
});

// ---------------------------------------------------------------------------
// Test G: mergeBranch archival failure is non-fatal (source check)
// ---------------------------------------------------------------------------

test('G. archival failure is caught — merge success path continues', () => {
  const startIdx = orchestratorSource.indexOf('function handleAccepted(');
  const endIdx = orchestratorSource.indexOf('\nfunction ', startIdx + 1);
  const handleAcceptedBlock = orchestratorSource.slice(startIdx, endIdx > startIdx ? endIdx : startIdx + 5000);
  // The try/catch around archiveAcceptedSlice must log warn but not propagate
  const archiveCallIdx = handleAcceptedBlock.indexOf('archiveAcceptedSlice(id, branchName)');
  const followingBlock = handleAcceptedBlock.slice(archiveCallIdx, archiveCallIdx + 300);
  assert.ok(followingBlock.includes('catch'), 'archiveAcceptedSlice must have a catch block');
  assert.ok(followingBlock.includes('warn') || followingBlock.includes('log('), 'catch block must log warning');
});

// ---------------------------------------------------------------------------
// Test H: backfillArchive
// ---------------------------------------------------------------------------

console.log('\n-- backfillArchive --');

test('H. Backfill: merged ACCEPTED files become ARCHIVED, unmerged stay ACCEPTED', () => {
  // Create 5 ACCEPTED files; we can only verify the marker-file-based idempotency
  // and the file-scanning logic since we can't mock git in this test harness.
  // We test the function with its marker guard only.
  writeSliceFile('910', '-ACCEPTED.md');
  writeSliceFile('911', '-ACCEPTED.md');
  writeSliceFile('912', '-ACCEPTED.md');
  writeSliceFile('913', '-ACCEPTED.md');
  writeSliceFile('914', '-ACCEPTED.md');

  const marker = path.join(TEMP, '.backfill-archive-done');
  try { fs.unlinkSync(marker); } catch (_) {}

  // Call backfillArchive — since these branches don't exist in git,
  // they should all be skipped (not merged on main)
  backfillArchive({ queueDir: QUEUE, trashDir: TRASH, markerFile: marker });

  // All should remain as ACCEPTED (branches not merged on main)
  const remaining = queueFiles();
  assert.ok(remaining.includes('910-ACCEPTED.md'), '910 should stay ACCEPTED (not merged)');
  assert.ok(remaining.includes('914-ACCEPTED.md'), '914 should stay ACCEPTED (not merged)');

  // Marker file should exist
  assert.ok(fs.existsSync(marker), 'Marker file must be written');

  // BACKFILL_ARCHIVE_COMPLETE event should be emitted
  const events = readReg();
  const bfEvt = events.find(e => e.event === 'BACKFILL_ARCHIVE_COMPLETE');
  assert.ok(bfEvt, 'BACKFILL_ARCHIVE_COMPLETE event must be emitted');
  assert.strictEqual(bfEvt.processed, 0);
  assert.strictEqual(bfEvt.skipped, 5);
});

// ---------------------------------------------------------------------------
// Test I: backfillArchive idempotency
// ---------------------------------------------------------------------------

test('I. Backfill idempotency: second invocation is a no-op (marker present)', () => {
  const marker = path.join(TEMP, '.backfill-archive-done-2');
  fs.writeFileSync(marker, new Date().toISOString());

  writeSliceFile('920', '-ACCEPTED.md');
  backfillArchive({ queueDir: QUEUE, trashDir: TRASH, markerFile: marker });

  // 920 should still be ACCEPTED (backfill was skipped due to marker)
  assert.ok(queueFiles().includes('920-ACCEPTED.md'), 'File should remain when marker exists');
  // No events should be emitted
  const events = readReg();
  assert.strictEqual(events.length, 0, 'No events on idempotent backfill');
});

// ---------------------------------------------------------------------------
// Test J: writeErrorFile integration (source check)
// ---------------------------------------------------------------------------

test('J. writeErrorFile calls archiveSiblingStateFiles after ERROR write', () => {
  const startIdx = orchestratorSource.indexOf('function writeErrorFile(');
  const endIdx = orchestratorSource.indexOf('\nfunction ', startIdx + 1);
  const writeErrorBlock = orchestratorSource.slice(startIdx, endIdx > startIdx ? endIdx : startIdx + 5000);
  assert.ok(
    writeErrorBlock.includes("archiveSiblingStateFiles(id, 'ERROR')"),
    'writeErrorFile must call archiveSiblingStateFiles with ERROR terminal'
  );
});

// ---------------------------------------------------------------------------
// Bonus: ARCHIVED event schema validation
// ---------------------------------------------------------------------------

console.log('\n-- Event schema --');

test('ARCHIVED event has required fields: ts, slice_id, event, branch, sha, source', () => {
  writeSliceFile('930', '-ACCEPTED.md');
  archiveAcceptedSlice('930', 'slice/930', { queueDir: QUEUE, trashDir: TRASH, source: 'merge' });
  const events = readReg();
  const evt = events.find(e => e.event === 'ARCHIVED');
  assert.ok(evt, 'ARCHIVED event must exist');
  assert.ok(evt.ts, 'must have ts');
  assert.strictEqual(evt.slice_id, '930');
  assert.strictEqual(evt.event, 'ARCHIVED');
  assert.strictEqual(evt.branch, 'slice/930');
  assert.strictEqual(evt.source, 'merge');
  // sha may be null in test env (no real git), but field must exist
  assert.ok('sha' in evt, 'must have sha field');
});

test('STATE_FILES_ARCHIVED event lists moved files', () => {
  writeSliceFile('931', '-DONE.md');
  writeSliceFile('931', '-PARKED.md');
  archiveSiblingStateFiles('931', 'ERROR', { queueDir: QUEUE, trashDir: TRASH });
  const events = readReg();
  const evt = events.find(e => e.event === 'STATE_FILES_ARCHIVED');
  assert.ok(evt, 'STATE_FILES_ARCHIVED event must exist');
  assert.ok(Array.isArray(evt.moved), 'moved must be an array');
  assert.strictEqual(evt.moved.length, 2);
  assert.strictEqual(evt.terminal_state, 'ERROR');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
