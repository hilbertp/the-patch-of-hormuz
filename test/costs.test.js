'use strict';

/**
 * costs.test.js
 *
 * Regression tests for slice 201 — Cost Center panel:
 *   1.  Dashboard HTML: #cost-center element present
 *   2.  Dashboard HTML: cost-center-table class present
 *   3.  Dashboard HTML: /api/costs fetch reference present in JS
 *   4.  Dashboard HTML: 30s poll interval for cost center
 *   5.  Dashboard HTML: cost-center-updated timestamp element present
 *   6.  /api/costs returns valid JSON with by_role array
 *   7.  Rom row: sums tokensIn, tokensOut, costUsd from DONE events only
 *   8.  Sisko row: count=2 when two sessions (one with values, one null)
 *   9.  Sisko row: cost_usd sums only non-null entries
 *  10.  total_cost_usd excludes null cost entries
 *  11.  Rom row: non-DONE register events excluded from count
 *  12.  Nog row: rounds[] summed across multiple DONE.md files
 *
 * Run: node test/costs.test.js
 */

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const assert  = require('assert');
const http    = require('http');

const REPO_ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Spin up a test server instance with overridden file paths
// ---------------------------------------------------------------------------

async function runCostsRequest({ registerLines = [], sessionLines = [], queueFiles = [] }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'costs-test-'));

  // Write bridge dir structure
  const bridgeDir  = path.join(tmp, 'bridge');
  const queueDir   = path.join(bridgeDir, 'queue');
  for (const d of [
    queueDir,
    path.join(bridgeDir, 'errors'),
    path.join(bridgeDir, 'staged'),
    path.join(bridgeDir, 'trash'),
    path.join(bridgeDir, 'control'),
    path.join(tmp, 'dashboard'),
  ]) { fs.mkdirSync(d, { recursive: true }); }

  // register.jsonl
  if (registerLines.length > 0) {
    fs.writeFileSync(
      path.join(bridgeDir, 'register.jsonl'),
      registerLines.map(o => JSON.stringify(o)).join('\n') + '\n',
      'utf8'
    );
  }

  // sessions.jsonl
  if (sessionLines.length > 0) {
    fs.writeFileSync(
      path.join(bridgeDir, 'sessions.jsonl'),
      sessionLines.map(o => JSON.stringify(o)).join('\n') + '\n',
      'utf8'
    );
  }

  // queue DONE.md files with rounds
  for (const { id, rounds } of queueFiles) {
    let roundsYaml = 'rounds:\n';
    for (const r of rounds) {
      roundsYaml += `  - round: ${r.round}\n`;
      roundsYaml += `    tokensIn: ${r.tokensIn}\n`;
      roundsYaml += `    tokensOut: ${r.tokensOut}\n`;
      roundsYaml += `    costUsd: ${r.costUsd}\n`;
    }
    const content = `---\nid: "${id}"\nstatus: DONE\n${roundsYaml}---\n\n## Summary\n`;
    fs.writeFileSync(path.join(queueDir, `${id}-DONE.md`), content, 'utf8');
  }

  // Runtime stubs
  fs.writeFileSync(path.join(bridgeDir, 'heartbeat.json'),
    JSON.stringify({ ts: new Date().toISOString(), status: 'idle' }), 'utf8');
  fs.writeFileSync(path.join(bridgeDir, 'nog-active.json'),    '{}', 'utf8');
  fs.writeFileSync(path.join(bridgeDir, 'first-output.json'),  '{}', 'utf8');
  fs.writeFileSync(path.join(bridgeDir, 'queue-order.json'),   '[]', 'utf8');
  fs.writeFileSync(path.join(bridgeDir, 'staged-order.json'),  '[]', 'utf8');

  // Minimal lifecycle-translate shim
  fs.writeFileSync(
    path.join(bridgeDir, 'lifecycle-translate.js'),
    `'use strict';\nfunction translateEvent(ev){return ev;}\nfunction resetDedupeState(){}\nmodule.exports={translateEvent,resetDedupeState};\n`,
    'utf8'
  );

  // Minimal dashboard HTML
  fs.writeFileSync(path.join(tmp, 'dashboard', 'lcars-dashboard.html'),
    '<!DOCTYPE html><html></html>', 'utf8');

  // Build patched server source
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'dashboard', 'server.js'), 'utf8');
  const port = 14748 + Math.floor(Math.random() * 3000);
  const patched = serverSrc
    .replace(
      /const REPO_ROOT\s*=\s*path\.resolve\(__dirname,\s*'\.\.'\);/,
      `const REPO_ROOT = ${JSON.stringify(tmp)};`
    )
    .replace(
      /const PORT\s*=\s*process\.env\.DASHBOARD_PORT[^;]+;/,
      `const PORT = ${port};`
    );
  const patchedPath = path.join(tmp, 'patched-server.js');
  fs.writeFileSync(patchedPath, patched, 'utf8');

  const child = require('child_process').spawn(process.execPath, [patchedPath], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      http.get(`http://localhost:${port}/api/costs`, (res) => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          child.kill();
          try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`Invalid JSON: ${body.slice(0, 200)}`)); }
        });
      }).on('error', (err) => {
        child.kill();
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
        reject(err);
      });
    }, 400);
  });
}

// ---------------------------------------------------------------------------
// Static analysis tests (sync)
// ---------------------------------------------------------------------------

console.log('\n── Static analysis ──');

const dashboardSource = fs.readFileSync(
  path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html'),
  'utf-8'
);

test('Dashboard HTML: #cost-center element present', () => {
  assert.ok(dashboardSource.includes('id="cost-center"'),
    'Missing id="cost-center"');
});

test('Dashboard HTML: cost-center-table class present', () => {
  assert.ok(dashboardSource.includes('class="cost-center-table"'),
    'Missing class="cost-center-table"');
});

test('Dashboard HTML: /api/costs fetch reference present', () => {
  assert.ok(dashboardSource.includes('/api/costs'),
    'Missing /api/costs in dashboard JS');
});

test('Dashboard HTML: 30s poll interval for cost center', () => {
  assert.ok(dashboardSource.includes('30000'),
    'Missing 30000ms poll interval');
});

test('Dashboard HTML: cost-center-updated timestamp element present', () => {
  assert.ok(dashboardSource.includes('id="cost-center-updated"'),
    'Missing id="cost-center-updated"');
});

// ---------------------------------------------------------------------------
// Endpoint tests (async, collected and run at end)
// ---------------------------------------------------------------------------

console.log('\n── /api/costs endpoint ──');

Promise.resolve().then(async () => {
  async function testAsync(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${e.message}`);
    }
  }

  await testAsync('/api/costs: valid JSON with rom, nog, sisko rows', async () => {
    const data = await runCostsRequest({
      registerLines: [
        { event: 'DONE', ts: '2026-01-01T00:00:00Z', tokensIn: 100, tokensOut: 200, costUsd: 0.01 },
      ],
      sessionLines: [
        { ts: '2026-01-01T00:00:00Z', role: 'sisko', label: 'test',
          model: 'claude-sonnet-4-6', tokens_in: null, tokens_out: null, cost_usd: null },
      ],
    });
    assert.ok(Array.isArray(data.by_role), 'by_role must be array');
    const roles = data.by_role.map(r => r.role);
    assert.ok(roles.includes('rom'),    'missing rom row');
    assert.ok(roles.includes('nog'),    'missing nog row');
    assert.ok(roles.includes('sisko'),  'missing sisko row');
    assert.ok('total_cost_usd' in data, 'missing total_cost_usd');
    assert.ok('updated_at'     in data, 'missing updated_at');
  });

  await testAsync('Rom row: sums tokensIn/Out/cost from DONE events only', async () => {
    const data = await runCostsRequest({
      registerLines: [
        { event: 'DONE',         ts: '2026-01-01T00:00:00Z', tokensIn: 1000, tokensOut: 2000, costUsd: 0.10 },
        { event: 'DONE',         ts: '2026-01-02T00:00:00Z', tokensIn: 500,  tokensOut: 1000, costUsd: 0.05 },
        { event: 'COMMISSIONED', ts: '2026-01-02T00:00:00Z', tokensIn: 9999, tokensOut: 9999, costUsd: 99.0 },
        { event: 'DONE',         ts: '2026-01-03T00:00:00Z', tokensIn: 200,  tokensOut: 400,  costUsd: 0.02 },
      ],
    });
    const rom = data.by_role.find(r => r.role === 'rom');
    assert.strictEqual(rom.count,      3,     'count should be 3 DONE events');
    assert.strictEqual(rom.tokens_in,  1700,  'tokens_in sum mismatch');
    assert.strictEqual(rom.tokens_out, 3400,  'tokens_out sum mismatch');
    assert.ok(Math.abs(rom.cost_usd - 0.17) < 0.001, `cost_usd mismatch: ${rom.cost_usd}`);
  });

  await testAsync('Sisko row: count=2 (one entry with values, one null)', async () => {
    const data = await runCostsRequest({
      sessionLines: [
        { ts: '2026-01-01T00:00:00Z', role: 'sisko', label: 'A',
          model: 'claude-sonnet-4-6', tokens_in: 1000, tokens_out: 2000, cost_usd: 0.10 },
        { ts: '2026-01-02T00:00:00Z', role: 'sisko', label: 'B',
          model: 'claude-sonnet-4-6', tokens_in: null, tokens_out: null, cost_usd: null },
      ],
    });
    const sisko = data.by_role.find(r => r.role === 'sisko');
    assert.strictEqual(sisko.count, 2, 'sisko count should be 2');
  });

  await testAsync('Sisko row: cost_usd sums only non-null entries', async () => {
    const data = await runCostsRequest({
      sessionLines: [
        { ts: '2026-01-01T00:00:00Z', role: 'sisko', label: 'A',
          model: 'claude-sonnet-4-6', tokens_in: 1000, tokens_out: 2000, cost_usd: 0.50 },
        { ts: '2026-01-02T00:00:00Z', role: 'sisko', label: 'B',
          model: 'claude-sonnet-4-6', tokens_in: null, tokens_out: null, cost_usd: null },
      ],
    });
    const sisko = data.by_role.find(r => r.role === 'sisko');
    assert.ok(Math.abs(sisko.cost_usd - 0.50) < 0.001,
      `Expected 0.50, got ${sisko.cost_usd}`);
  });

  await testAsync('total_cost_usd excludes null sisko cost entries', async () => {
    const data = await runCostsRequest({
      registerLines: [
        { event: 'DONE', ts: '2026-01-01T00:00:00Z', tokensIn: 100, tokensOut: 100, costUsd: 1.00 },
      ],
      sessionLines: [
        { ts: '2026-01-01T00:00:00Z', role: 'sisko', label: 'S',
          model: 'claude-sonnet-4-6', tokens_in: null, tokens_out: null, cost_usd: null },
      ],
    });
    assert.ok(Math.abs(data.total_cost_usd - 1.00) < 0.001,
      `Expected total 1.00, got ${data.total_cost_usd}`);
  });

  await testAsync('Rom row: non-DONE register events excluded', async () => {
    const data = await runCostsRequest({
      registerLines: [
        { event: 'COMMISSIONED', ts: '2026-01-01T00:00:00Z', tokensIn: 500, tokensOut: 500, costUsd: 5.0 },
        { event: 'ERROR',        ts: '2026-01-01T00:00:00Z', tokensIn: 200, tokensOut: 200, costUsd: 2.0 },
        { event: 'DONE',         ts: '2026-01-02T00:00:00Z', tokensIn: 100, tokensOut: 100, costUsd: 0.10 },
      ],
    });
    const rom = data.by_role.find(r => r.role === 'rom');
    assert.strictEqual(rom.count, 1, 'Only DONE events should count');
    assert.ok(Math.abs(rom.cost_usd - 0.10) < 0.001, `cost should be 0.10, got ${rom.cost_usd}`);
  });

  await testAsync('Nog row: rounds[] summed across multiple DONE.md files', async () => {
    const data = await runCostsRequest({
      queueFiles: [
        {
          id: '100',
          rounds: [
            { round: 1, tokensIn: 500,  tokensOut: 1000, costUsd: 0.05 },
            { round: 2, tokensIn: 300,  tokensOut: 600,  costUsd: 0.03 },
          ],
        },
        {
          id: '101',
          rounds: [
            { round: 1, tokensIn: 200, tokensOut: 400, costUsd: 0.02 },
          ],
        },
      ],
    });
    const nog = data.by_role.find(r => r.role === 'nog');
    assert.strictEqual(nog.count,      3,    'nog count should be 3 rounds total');
    assert.strictEqual(nog.tokens_in,  1000, 'nog tokens_in sum mismatch');
    assert.strictEqual(nog.tokens_out, 2000, 'nog tokens_out sum mismatch');
    assert.ok(Math.abs(nog.cost_usd - 0.10) < 0.001,
      `nog cost_usd mismatch: ${nog.cost_usd}`);
  });

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  if (failed > 0) process.exit(1);
});
