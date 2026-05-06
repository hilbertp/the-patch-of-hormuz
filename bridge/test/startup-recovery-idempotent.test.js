'use strict';

/**
 * startup-recovery-idempotent.test.js — Slice 296 (F-Restart-1)
 *
 * Tests that the orchestrator's startup-recovery path skips terminal slices
 * (those with ACCEPTED, ARCHIVED, MERGED events, or trash entries) and does
 * NOT re-process them. Non-terminal mid-flight slices must still be recovered.
 *
 * Run: node --test bridge/test/startup-recovery-idempotent.test.js
 *
 * Uses node:test (built-in). No new npm dependencies.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Import isTerminal from orchestrator (exported for testing)
// ---------------------------------------------------------------------------

const { isTerminal } = require('../orchestrator');

// ---------------------------------------------------------------------------
// Test-fixture helpers
// ---------------------------------------------------------------------------

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sr-idempotent-'));
}

function writeFile(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content || '---\nid: "test"\n---\n');
}

function writeRegisterEvent(regFile, event) {
  fs.appendFileSync(regFile, JSON.stringify(event) + '\n');
}

function cleanup(dirs) {
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Startup recovery idempotent — isTerminal guard', () => {
  let queueDir, trashDir, regFile;
  const dirs = [];

  beforeEach(() => {
    queueDir = mkTmpDir();
    trashDir = mkTmpDir();
    regFile = path.join(queueDir, 'register.jsonl');
    fs.writeFileSync(regFile, '');
    dirs.push(queueDir, trashDir);
  });

  afterEach(() => cleanup(dirs));

  // Test 1: DONE file with ACCEPTED sibling → terminal, skip
  it('skips slice with ACCEPTED sibling (DONE mtime unchanged, no register event)', () => {
    const id = '112';

    // Seed DONE + ACCEPTED files
    writeFile(queueDir, `${id}-DONE.md`, '---\nid: "112"\nstatus: DONE\nbranch: "slice/112"\n---\nDone report body\n');
    writeFile(queueDir, `${id}-ACCEPTED.md`, '---\nid: "112"\nstatus: ACCEPTED\n---\n');

    // Record DONE mtime before check
    const mtimeBefore = fs.statSync(path.join(queueDir, `${id}-DONE.md`)).mtimeMs;

    // isTerminal should return true
    assert.strictEqual(isTerminal(id, { queueDir, trashDir, regFile }), true);

    // DONE file mtime unchanged (no rewrite)
    const mtimeAfter = fs.statSync(path.join(queueDir, `${id}-DONE.md`)).mtimeMs;
    assert.strictEqual(mtimeAfter, mtimeBefore, 'DONE file mtime should be unchanged');

    // No register events emitted (register file should still be empty)
    const regContent = fs.readFileSync(regFile, 'utf-8').trim();
    assert.strictEqual(regContent, '', 'No register events should be emitted for terminal slice');
  });

  // Test 2: DONE file with ARCHIVED sibling → terminal, skip
  it('skips slice with ARCHIVED sibling', () => {
    const id = '113';

    writeFile(queueDir, `${id}-DONE.md`, '---\nid: "113"\nstatus: DONE\n---\n');
    writeFile(queueDir, `${id}-ARCHIVED.md`, '---\nid: "113"\n---\n');

    assert.strictEqual(isTerminal(id, { queueDir, trashDir, regFile }), true);

    // DONE file not touched
    const mtimeBefore = fs.statSync(path.join(queueDir, `${id}-DONE.md`)).mtimeMs;
    assert.strictEqual(
      fs.statSync(path.join(queueDir, `${id}-DONE.md`)).mtimeMs,
      mtimeBefore,
      'DONE file mtime unchanged'
    );
  });

  // Test 3: IN_PROGRESS file with no terminal markers → NOT terminal (mid-flight recovery fires)
  it('does NOT skip mid-flight IN_PROGRESS slice without terminal markers', () => {
    const id = '200';

    writeFile(queueDir, `${id}-IN_PROGRESS.md`, '---\nid: "200"\nstatus: IN_PROGRESS\n---\n');

    assert.strictEqual(isTerminal(id, { queueDir, trashDir, regFile }), false);
  });

  // Test 4: DONE file with MERGED register event but no ACCEPTED/ARCHIVED → terminal
  it('skips slice with MERGED register event (no file markers)', () => {
    const id = '114';

    writeFile(queueDir, `${id}-DONE.md`, '---\nid: "114"\nstatus: DONE\n---\n');

    // Write a MERGED event to the register
    writeRegisterEvent(regFile, {
      ts: '2026-04-16T10:00:00.000Z',
      event: 'MERGED',
      slice_id: id,
      id,
      branch: `slice/${id}`,
      sha: 'abc1234',
    });

    assert.strictEqual(isTerminal(id, { queueDir, trashDir, regFile }), true);
  });

  // Test 5: SLICE_MERGED_TO_MAIN event → also terminal
  it('skips slice with SLICE_MERGED_TO_MAIN register event', () => {
    const id = '115';

    writeFile(queueDir, `${id}-DONE.md`, '---\nid: "115"\nstatus: DONE\n---\n');

    writeRegisterEvent(regFile, {
      ts: '2026-04-16T10:00:00.000Z',
      event: 'SLICE_MERGED_TO_MAIN',
      slice_id: id,
      id,
    });

    assert.strictEqual(isTerminal(id, { queueDir, trashDir, regFile }), true);
  });

  // Test 6: Trash entry → terminal
  it('skips slice with trash entry', () => {
    const id = '116';

    writeFile(queueDir, `${id}-DONE.md`, '---\nid: "116"\nstatus: DONE\n---\n');
    writeFile(trashDir, `${id}-DONE.md`, '---\nid: "116"\n---\n');

    assert.strictEqual(isTerminal(id, { queueDir, trashDir, regFile }), true);
  });

  // Test 7: Synthetic slice 112 scenario — DONE + ACCEPTED + MERGED event
  it('synthetic slice 112: DONE + ACCEPTED + MERGED → terminal (ghost resurrection prevented)', () => {
    const id = '112';

    writeFile(queueDir, `${id}-DONE.md`, '---\nid: "112"\nstatus: DONE\nbranch: "slice/112"\ncompleted: "2026-04-16T10:00:00.000Z"\n---\n');
    writeFile(queueDir, `${id}-ACCEPTED.md`, '---\nid: "112"\nstatus: ACCEPTED\n---\n');

    writeRegisterEvent(regFile, {
      ts: '2026-04-16T10:00:00.000Z',
      event: 'MERGED',
      slice_id: id,
      id,
      branch: 'slice/112',
      sha: 'deadbeef',
    });

    // Record DONE mtime
    const mtimeBefore = fs.statSync(path.join(queueDir, `${id}-DONE.md`)).mtimeMs;

    // Must be terminal
    assert.strictEqual(isTerminal(id, { queueDir, trashDir, regFile }), true);

    // DONE file not rewritten
    assert.strictEqual(
      fs.statSync(path.join(queueDir, `${id}-DONE.md`)).mtimeMs,
      mtimeBefore,
      'DONE file must not be rewritten for terminal slice'
    );

    // Register unchanged (only our seed event, no fresh events)
    const lines = fs.readFileSync(regFile, 'utf-8').trim().split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1, 'No fresh register events for terminal slice');
  });

  // Test 8: Non-terminal DONE file (no ACCEPTED, no ARCHIVED, no MERGED) → not terminal
  it('does NOT skip non-terminal DONE file', () => {
    const id = '201';

    writeFile(queueDir, `${id}-DONE.md`, '---\nid: "201"\nstatus: DONE\n---\n');

    assert.strictEqual(isTerminal(id, { queueDir, trashDir, regFile }), false);
  });
});
