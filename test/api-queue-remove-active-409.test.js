'use strict';

/**
 * api-queue-remove-active-409.test.js — Slice 272
 *
 * POST /api/queue/:id/remove while heartbeat reports the id as
 * current_slice returns 409.
 *
 * Run: node test/api-queue-remove-active-409.test.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

const REPO = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(REPO, 'bridge', 'queue');
const HEARTBEAT = path.join(REPO, 'bridge', 'heartbeat.json');

const TEST_ID = '99903';
const PORT = 4747;

let origHeartbeat;

function backup() {
  try { origHeartbeat = fs.readFileSync(HEARTBEAT, 'utf8'); } catch (_) { origHeartbeat = null; }
}

function restore() {
  if (origHeartbeat) fs.writeFileSync(HEARTBEAT, origHeartbeat, 'utf8');
  try { fs.unlinkSync(path.join(QUEUE_DIR, `${TEST_ID}-QUEUED.md`)); } catch (_) {}
}

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

console.log('\napi-queue-remove-active-409.test.js (slice 272)\n');

test('POST /api/queue/:id/remove returns 409 when slice is current_slice in heartbeat', async () => {
  // Create a QUEUED file so the 404 check passes if heartbeat check runs second
  fs.writeFileSync(path.join(QUEUE_DIR, `${TEST_ID}-QUEUED.md`), '---\nid: "99903"\nstatus: "QUEUED"\n---\n', 'utf8');

  // Set heartbeat to reference this slice
  const hb = origHeartbeat ? JSON.parse(origHeartbeat) : {};
  hb.current_slice = TEST_ID;
  fs.writeFileSync(HEARTBEAT, JSON.stringify(hb, null, 2), 'utf8');

  const res = await post(`/api/queue/${TEST_ID}/remove`);
  assert.strictEqual(res.status, 409, `expected 409, got ${res.status}`);
  assert.strictEqual(res.body.error, 'already-picked-up');
});

runTests();
