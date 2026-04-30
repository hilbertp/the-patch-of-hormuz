'use strict';

/**
 * api-queue-remove.test.js — Slice 272
 *
 * POST /api/queue/:id/remove moves a QUEUED slice to trash,
 * updates queue-order.json, and emits a register event.
 *
 * Run: node test/api-queue-remove.test.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(REPO, 'bridge', 'queue');
const TRASH_DIR = path.join(REPO, 'bridge', 'trash');
const QUEUE_ORDER = path.join(REPO, 'bridge', 'queue-order.json');
const REGISTER = path.join(REPO, 'bridge', 'register.jsonl');
const HEARTBEAT = path.join(REPO, 'bridge', 'heartbeat.json');

const TEST_ID = '99901';
const PORT = 4747;

// ---------------------------------------------------------------------------
// Backup / restore helpers
// ---------------------------------------------------------------------------

let origQueueOrder, origHeartbeat, origRegisterSize;

function backup() {
  try { origQueueOrder = fs.readFileSync(QUEUE_ORDER, 'utf8'); } catch (_) { origQueueOrder = '[]'; }
  try { origHeartbeat = fs.readFileSync(HEARTBEAT, 'utf8'); } catch (_) { origHeartbeat = null; }
  origRegisterSize = fs.existsSync(REGISTER) ? fs.statSync(REGISTER).size : 0;
}

function restore() {
  // Remove test QUEUED file if still present
  const qf = path.join(QUEUE_DIR, `${TEST_ID}-QUEUED.md`);
  try { fs.unlinkSync(qf); } catch (_) {}

  // Remove trash file
  const trashFiles = fs.readdirSync(TRASH_DIR).filter(f => f.startsWith(`${TEST_ID}-QUEUED.md.removed-`));
  for (const f of trashFiles) { try { fs.unlinkSync(path.join(TRASH_DIR, f)); } catch (_) {} }

  // Restore queue-order
  fs.writeFileSync(QUEUE_ORDER, origQueueOrder, 'utf8');

  // Restore heartbeat
  if (origHeartbeat) fs.writeFileSync(HEARTBEAT, origHeartbeat, 'utf8');

  // Truncate register back to original size
  if (fs.existsSync(REGISTER) && fs.statSync(REGISTER).size > origRegisterSize) {
    const fd = fs.openSync(REGISTER, 'r+');
    fs.ftruncateSync(fd, origRegisterSize);
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function post(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: urlPath, method: 'POST' }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function runTests() {
  backup();
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  \u2713 ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  \u2717 ${t.name}`);
      console.log(`    ${err.message}`);
    }
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  restore();
  process.exit(failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createQueuedSlice() {
  const content = [
    '---',
    `id: "${TEST_ID}"`,
    `title: "Test slice ${TEST_ID}"`,
    'status: "QUEUED"',
    '---',
    '',
    '## Tasks',
    '- Test task',
  ].join('\n');
  fs.writeFileSync(path.join(QUEUE_DIR, `${TEST_ID}-QUEUED.md`), content, 'utf8');

  // Add to queue-order
  const order = JSON.parse(fs.readFileSync(QUEUE_ORDER, 'utf8'));
  if (!order.includes(TEST_ID)) order.push(TEST_ID);
  fs.writeFileSync(QUEUE_ORDER, JSON.stringify(order, null, 2), 'utf8');

  // Ensure heartbeat doesn't reference our test id
  try {
    const hb = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
    if (String(hb.current_slice) === TEST_ID) {
      hb.current_slice = null;
      fs.writeFileSync(HEARTBEAT, JSON.stringify(hb, null, 2), 'utf8');
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\napi-queue-remove.test.js (slice 272)\n');

test('POST /api/queue/:id/remove returns 200 and archives the slice', async () => {
  createQueuedSlice();

  const res = await post(`/api/queue/${TEST_ID}/remove`);
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.action, 'archived');
});

test('QUEUED file moved to trash with .removed- suffix', async () => {
  const qf = path.join(QUEUE_DIR, `${TEST_ID}-QUEUED.md`);
  assert.ok(!fs.existsSync(qf), 'QUEUED file should no longer exist');

  const trashFiles = fs.readdirSync(TRASH_DIR).filter(f => f.startsWith(`${TEST_ID}-QUEUED.md.removed-`));
  assert.ok(trashFiles.length >= 1, `expected trash file, found: ${trashFiles}`);
});

test('queue-order.json no longer contains the archived id', async () => {
  const order = JSON.parse(fs.readFileSync(QUEUE_ORDER, 'utf8'));
  assert.ok(!order.includes(TEST_ID), `queue-order still contains ${TEST_ID}`);
});

test('register.jsonl has slice-archived-from-queue event', async () => {
  const lines = fs.readFileSync(REGISTER, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  assert.strictEqual(last.event, 'slice-archived-from-queue');
  assert.strictEqual(last.slice_id, TEST_ID);
  assert.strictEqual(last.reason, 'user-removed');
});

runTests();
