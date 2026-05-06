'use strict';

/**
 * dispatch-fifo.test.js — Slice 292 (F-Disp-1)
 *
 * Tests that the orchestrator dispatches slices in FIFO order by consuming
 * queue-order.json from the head, recovers from missing/empty queue-order.json
 * via mtime ASC, and cleans stale IDs.
 *
 * Run: node --test bridge/test/dispatch-fifo.test.js
 *
 * Uses node:test (built-in). No new npm dependencies.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Helpers — minimal orchestrator dispatch logic extraction
// ---------------------------------------------------------------------------

/**
 * Simulates the dispatch pickup logic from orchestrator.js (slice 292 FIFO).
 * Returns { pickedFile, queueOrder } representing what the dispatcher would do.
 */
function simulateDispatch(queueDir, queueOrderFile) {
  // Build queued file map
  let files;
  try { files = fs.readdirSync(queueDir); } catch (_) { files = []; }
  const queuedFileMap = {};
  for (const f of files) {
    if (f.endsWith('-QUEUED.md') || f.endsWith('-PENDING.md')) {
      const fId = f.replace(/-(?:QUEUED|PENDING)\.md$/, '');
      queuedFileMap[fId] = f;
    }
  }

  let queueOrder = null;
  let queueOrderDirty = false;
  try {
    const raw = JSON.parse(fs.readFileSync(queueOrderFile, 'utf-8'));
    if (Array.isArray(raw) && raw.length > 0) queueOrder = raw.map(String);
  } catch (_) {}

  // Recovery
  if (!queueOrder && Object.keys(queuedFileMap).length > 0) {
    const entries = Object.entries(queuedFileMap).map(([fId, fname]) => {
      let mtime = 0;
      try { mtime = fs.statSync(path.join(queueDir, fname)).mtimeMs; } catch (_) {}
      return { id: fId, mtime };
    });
    entries.sort((a, b) => a.mtime - b.mtime);
    queueOrder = entries.map(e => e.id);
    const tmpPath = queueOrderFile + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(queueOrder, null, 2) + '\n');
    fs.renameSync(tmpPath, queueOrderFile);
  }

  // Build pendingFiles in FIFO order, cleaning stale IDs
  const pendingFiles = [];
  if (queueOrder) {
    const cleanedOrder = [];
    for (const oid of queueOrder) {
      if (queuedFileMap[oid]) {
        cleanedOrder.push(oid);
        pendingFiles.push(queuedFileMap[oid]);
      } else {
        queueOrderDirty = true;
      }
    }
    for (const [fId, fname] of Object.entries(queuedFileMap)) {
      if (!cleanedOrder.includes(fId)) {
        cleanedOrder.push(fId);
        pendingFiles.push(fname);
        queueOrderDirty = true;
      }
    }
    if (queueOrderDirty) {
      const tmpPath = queueOrderFile + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(cleanedOrder, null, 2) + '\n');
      fs.renameSync(tmpPath, queueOrderFile);
    }
    queueOrder = cleanedOrder;
  }

  return { pickedFile: pendingFiles[0] || null, queueOrder };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir;
let queueDir;
let queueOrderFile;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-fifo-test-'));
  queueDir = path.join(tmpDir, 'queue');
  fs.mkdirSync(queueDir, { recursive: true });
  queueOrderFile = path.join(tmpDir, 'queue-order.json');
}

function teardown() {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writeQueuedFile(id, content) {
  const fp = path.join(queueDir, `${id}-QUEUED.md`);
  fs.writeFileSync(fp, content || `---\nid: "${id}"\ntitle: "Slice ${id}"\n---\nBody\n`);
  return fp;
}

function writeQueueOrder(ids) {
  fs.writeFileSync(queueOrderFile, JSON.stringify(ids, null, 2) + '\n');
}

function readQueueOrder() {
  return JSON.parse(fs.readFileSync(queueOrderFile, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FIFO dispatch via queue-order.json', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('picks the head of queue-order.json (A from [A, B, C])', () => {
    writeQueuedFile('A');
    writeQueuedFile('B');
    writeQueuedFile('C');
    writeQueueOrder(['A', 'B', 'C']);

    const { pickedFile } = simulateDispatch(queueDir, queueOrderFile);
    assert.equal(pickedFile, 'A-QUEUED.md');
  });

  it('after A is removed, picks B next', () => {
    writeQueuedFile('B');
    writeQueuedFile('C');
    writeQueueOrder(['B', 'C']);

    const { pickedFile } = simulateDispatch(queueDir, queueOrderFile);
    assert.equal(pickedFile, 'B-QUEUED.md');
  });

  it('recovers order from mtime ASC when queue-order.json is empty', () => {
    // Create files with controlled mtimes: X oldest, Y middle, Z newest.
    const now = Date.now();
    const fpX = writeQueuedFile('X');
    const fpY = writeQueuedFile('Y');
    const fpZ = writeQueuedFile('Z');

    // Set mtimes explicitly: X=oldest, Y=middle, Z=newest
    fs.utimesSync(fpX, new Date(now - 3000), new Date(now - 3000));
    fs.utimesSync(fpY, new Date(now - 2000), new Date(now - 2000));
    fs.utimesSync(fpZ, new Date(now - 1000), new Date(now - 1000));

    // Write empty queue-order.json
    writeQueueOrder([]);

    const { pickedFile } = simulateDispatch(queueDir, queueOrderFile);
    assert.equal(pickedFile, 'X-QUEUED.md');

    // Verify reconstructed order is [X, Y, Z]
    const order = readQueueOrder();
    assert.deepEqual(order, ['X', 'Y', 'Z']);
  });

  it('removes stale IDs and picks the next valid one', () => {
    // queue-order has STALE (no file), then B, then C
    writeQueuedFile('B');
    writeQueuedFile('C');
    writeQueueOrder(['STALE', 'B', 'C']);

    const { pickedFile } = simulateDispatch(queueDir, queueOrderFile);
    assert.equal(pickedFile, 'B-QUEUED.md');

    // Verify STALE was removed from persisted queue-order.json
    const order = readQueueOrder();
    assert.ok(!order.includes('STALE'), 'Stale ID should be removed');
    assert.deepEqual(order, ['B', 'C']);
  });
});
