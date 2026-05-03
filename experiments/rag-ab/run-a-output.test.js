'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir;
let registerPath;
let mod;

function makeTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-history-test-'));
  registerPath = path.join(tmpDir, 'register.jsonl');
}

function cleanTmpDir() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Require gate-history with REGISTER_PATH patched to tmpDir.
 * We overwrite the module-level constant after require.
 */
function loadModule() {
  // Fresh require each time to avoid stale state
  const modPath = require.resolve('../state/gate-history');
  delete require.cache[modPath];
  mod = require('../state/gate-history');
  // Patch the path — module exposes REGISTER_PATH but it's const,
  // so we re-point the internal via a small fs-level trick: we write
  // to the real path. Instead, we'll write a helper that creates
  // a register at the expected location.
}

function writeRegister(lines) {
  const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(registerPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests — we test the function logic by writing to the real REGISTER_PATH
// temporarily, then restoring.
// ---------------------------------------------------------------------------

const REAL_REGISTER_PATH = path.resolve(__dirname, '..', 'register.jsonl');
let originalRegister;

function backupRegister() {
  try {
    originalRegister = fs.readFileSync(REAL_REGISTER_PATH, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      originalRegister = null;
    } else {
      throw err;
    }
  }
}

function restoreRegister() {
  if (originalRegister === null) {
    try { fs.unlinkSync(REAL_REGISTER_PATH); } catch (_) {}
  } else {
    fs.writeFileSync(REAL_REGISTER_PATH, originalRegister, 'utf-8');
  }
}

function writeRealRegister(lines) {
  const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(REAL_REGISTER_PATH, content, 'utf-8');
}

describe('gate-history: getRecentGateEvents', () => {
  beforeEach(() => {
    backupRegister();
    loadModule();
  });

  afterEach(() => {
    restoreRegister();
  });

  it('returns [] when register.jsonl does not exist', () => {
    try { fs.unlinkSync(REAL_REGISTER_PATH); } catch (_) {}
    const result = mod.getRecentGateEvents();
    assert.deepEqual(result, []);
  });

  it('returns [] when register.jsonl is empty', () => {
    fs.writeFileSync(REAL_REGISTER_PATH, '', 'utf-8');
    const result = mod.getRecentGateEvents();
    assert.deepEqual(result, []);
  });

  it('filters only gate- prefixed events', () => {
    writeRealRegister([
      { ts: '2026-05-01T00:00:00Z', event: 'gate-mutex-acquired', dev_tip_sha: 'aaa' },
      { ts: '2026-05-01T00:01:00Z', event: 'NOG_TELEMETRY', verdict: 'pass' },
      { ts: '2026-05-01T00:02:00Z', event: 'lock-cycle', cycle_phase: 'unlock' },
      { ts: '2026-05-01T00:03:00Z', event: 'gate-mutex-released', reason: 'regression_pass' },
    ]);

    const result = mod.getRecentGateEvents();
    assert.equal(result.length, 2);
    assert.equal(result[0].event, 'gate-mutex-acquired');
    assert.equal(result[1].event, 'gate-mutex-released');
  });

  it('respects the limit parameter', () => {
    const lines = [];
    for (let i = 0; i < 10; i++) {
      lines.push({ ts: `2026-05-01T00:0${i}:00Z`, event: 'gate-start', i });
    }
    writeRealRegister(lines);

    const result = mod.getRecentGateEvents(3);
    assert.equal(result.length, 3);
    assert.equal(result[0].i, 7);
    assert.equal(result[2].i, 9);
  });

  it('returns all events when fewer than limit', () => {
    writeRealRegister([
      { ts: '2026-05-01T00:00:00Z', event: 'gate-abort' },
    ]);

    const result = mod.getRecentGateEvents(50);
    assert.equal(result.length, 1);
    assert.equal(result[0].event, 'gate-abort');
  });

  it('skips malformed JSON lines without crashing', () => {
    const content = [
      JSON.stringify({ ts: '2026-05-01T00:00:00Z', event: 'gate-start' }),
      '{ this is broken json !!!',
      JSON.stringify({ ts: '2026-05-01T00:01:00Z', event: 'gate-abort' }),
    ].join('\n') + '\n';
    fs.writeFileSync(REAL_REGISTER_PATH, content, 'utf-8');

    const result = mod.getRecentGateEvents();
    assert.equal(result.length, 2);
    assert.equal(result[0].event, 'gate-start');
    assert.equal(result[1].event, 'gate-abort');
  });
});
