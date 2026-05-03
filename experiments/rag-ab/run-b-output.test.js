'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { getRecentGateEvents, REGISTER_PATH } = require('../state/gate-history');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let originalContent;

function saveOriginal() {
  try {
    originalContent = fs.readFileSync(REGISTER_PATH, 'utf-8');
  } catch (_) {
    originalContent = null;
  }
}

function restoreOriginal() {
  if (originalContent === null) {
    try { fs.unlinkSync(REGISTER_PATH); } catch (_) {}
  } else {
    fs.writeFileSync(REGISTER_PATH, originalContent, 'utf-8');
  }
}

function writeRegister(lines) {
  fs.writeFileSync(REGISTER_PATH, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getRecentGateEvents', () => {
  beforeEach(() => { saveOriginal(); });
  afterEach(() => { restoreOriginal(); });

  it('returns empty array when register.jsonl is missing', () => {
    try { fs.unlinkSync(REGISTER_PATH); } catch (_) {}
    const result = getRecentGateEvents();
    assert.deepEqual(result, []);
  });

  it('returns empty array when register.jsonl is empty', () => {
    fs.writeFileSync(REGISTER_PATH, '', 'utf-8');
    const result = getRecentGateEvents();
    assert.deepEqual(result, []);
  });

  it('filters only events starting with gate-', () => {
    writeRegister([
      { event: 'gate-mutex-acquired', ts: '2026-05-01T10:00:00Z' },
      { event: 'slice-accepted', ts: '2026-05-01T10:01:00Z' },
      { event: 'gate-mutex-released', ts: '2026-05-01T10:02:00Z' },
      { event: 'brief-dispatched', ts: '2026-05-01T10:03:00Z' },
    ]);
    const result = getRecentGateEvents();
    assert.equal(result.length, 2);
    assert.equal(result[0].event, 'gate-mutex-acquired');
    assert.equal(result[1].event, 'gate-mutex-released');
  });

  it('respects the limit parameter', () => {
    const lines = [];
    for (let i = 0; i < 10; i++) {
      lines.push({ event: 'gate-test-event', seq: i });
    }
    writeRegister(lines);
    const result = getRecentGateEvents(3);
    assert.equal(result.length, 3);
    assert.equal(result[0].seq, 7);
    assert.equal(result[2].seq, 9);
  });

  it('skips malformed JSON lines without crashing', () => {
    const raw = [
      JSON.stringify({ event: 'gate-ok', val: 1 }),
      'this is not json {{{',
      JSON.stringify({ event: 'gate-ok', val: 2 }),
    ].join('\n') + '\n';
    fs.writeFileSync(REGISTER_PATH, raw, 'utf-8');

    const result = getRecentGateEvents();
    assert.equal(result.length, 2);
    assert.equal(result[0].val, 1);
    assert.equal(result[1].val, 2);
  });

  it('defaults to limit of 50', () => {
    const lines = [];
    for (let i = 0; i < 60; i++) {
      lines.push({ event: 'gate-bulk', seq: i });
    }
    writeRegister(lines);
    const result = getRecentGateEvents();
    assert.equal(result.length, 50);
    assert.equal(result[0].seq, 10);
    assert.equal(result[49].seq, 59);
  });
});
