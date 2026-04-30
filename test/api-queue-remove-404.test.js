'use strict';

/**
 * api-queue-remove-404.test.js — Slice 272
 *
 * POST /api/queue/:id/remove for a non-existent id returns 404.
 *
 * Run: node test/api-queue-remove-404.test.js
 */

const http = require('http');
const assert = require('assert');

const PORT = 4747;
const FAKE_ID = '99902';

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
  process.exit(failed > 0 ? 1 : 0);
}

console.log('\napi-queue-remove-404.test.js (slice 272)\n');

test('POST /api/queue/:id/remove for non-existent id returns 404', async () => {
  const res = await post(`/api/queue/${FAKE_ID}/remove`);
  assert.strictEqual(res.status, 404, `expected 404, got ${res.status}`);
  assert.ok(res.body.error, 'response should have error field');
});

runTests();
