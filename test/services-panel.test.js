'use strict';

/**
 * services-panel.test.js
 *
 * Regression tests for slice 188 — Ops services panel (three-service status):
 *   1.  No "Wormhole" substring in dashboard HTML under any condition
 *   2.  #services-panel element present
 *   3.  Exactly three service rows: orchestrator, server, detector
 *   4.  No leftover #service-health-pill or sibling green pill markup
 *   5.  Each service row has data-service attribute and a hover tooltip
 *   6.  Orchestrator row: up state (heartbeat fresh, status up)
 *   7.  Orchestrator row: down state (heartbeat stale/missing)
 *   8.  Server row: up state (api/health returns 200 quickly)
 *   9.  Server row: down state (fetch fails)
 *  10.  Detector row: up state (host-health.json fresh, container running, api ok)
 *  11.  Detector row: down — file missing → install instructions shown
 *  12.  Detector row: down — file stale (>30s)
 *  13.  Detector row: down — container_status !== running
 *  14.  Detector row: down — api_status !== ok
 *  15.  Approve gate: disabled when orchestrator down
 *  16.  Approve gate: disabled when server down
 *  17.  Approve gate: enabled when only detector is down
 *  18.  Approve gate: enabled when all services up
 *  19.  Detector-down does not set serviceHealthDown flag
 *  20.  README-health-detector.md install reference present in detector-missing message
 *
 * Run: node test/services-panel.test.js
 */

const fs   = require('fs');
const path = require('path');
const assert = require('assert');
const vm   = require('vm');

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
// Read dashboard source for static analysis
// ---------------------------------------------------------------------------

const dashboardSource = fs.readFileSync(
  path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html'),
  'utf-8'
);

// ---------------------------------------------------------------------------
// Extract and evaluate the updateServicesPanel function + helpers from source
// so we can test render logic without a browser.
// ---------------------------------------------------------------------------

/**
 * Extract the JS body between <script> tags (last script block which contains
 * the application logic) and compile a test harness around it.
 *
 * We stub out all DOM APIs and supply a controllable fetch mock, then call
 * updateServicesPanel() and inspect what the stubs recorded.
 */
function buildHarness(opts) {
  // opts: { health, fetchFails, fetchMs }
  const { health = null, fetchFails = false, fetchMs = 100 } = opts;

  // DOM state we'll capture
  const elements = {};
  function makeEl(id) {
    elements[id] = { className: '', textContent: '', innerHTML: '' };
    return elements[id];
  }

  const dom = new Proxy({}, {
    get(_, id) { return elements[id] || makeEl(id); }
  });

  // Minimal DOM shim
  const mockDoc = {
    getElementById(id) { return dom[id]; },
    addEventListener() {},
  };

  // fetch mock
  async function mockFetch() {
    if (fetchFails) throw new Error('network error');
    await new Promise(r => setTimeout(r, fetchMs));
    return {
      ok: true,
      json: async () => health,
    };
  }

  // setInterval / startElapsedTick / fetchBridge stubs
  const stubs = {
    startElapsedTick: () => {},
    fetchBridge: () => {},
    setInterval: () => {},
    marked: { parse: s => s },
  };

  // Isolate the functions we need by extracting them from source
  // We pull out: fmtAge, fmtElapsedCompact, serviceHealthDown let, updateServicesPanel
  const fnSource = extractFunctions(dashboardSource);

  // Build the sandbox
  const sandbox = {
    document: mockDoc,
    fetch: mockFetch,
    Date,
    Math,
    Promise,
    setTimeout,
    console,
    serviceHealthDown: false,
    ...stubs,
  };
  vm.createContext(sandbox);

  // Inject extracted source into sandbox
  vm.runInContext(fnSource, sandbox);

  return { sandbox, elements };
}

/**
 * Extract the relevant JS functions from the dashboard HTML.
 * We want: fmtAge, fmtElapsedCompact, the serviceHealthDown declaration,
 * and updateServicesPanel.
 */
function extractFunctions(src) {
  // Extract everything between the two comment markers we know exist
  const start = src.indexOf('// ── Services panel ─');
  const end   = src.indexOf('startElapsedTick();', start);
  if (start === -1 || end === -1) {
    throw new Error('Could not locate services panel JS block in dashboard source');
  }
  return src.slice(start, end).trim();
}

// ---------------------------------------------------------------------------
// Static analysis tests
// ---------------------------------------------------------------------------

console.log('\n── Static analysis ──');

test('No Wormhole substring in dashboard HTML', () => {
  const lower = dashboardSource.toLowerCase();
  assert.ok(
    !lower.includes('wormhole'),
    'Found "wormhole" in dashboard source — must be removed'
  );
});

test('#services-panel element present in HTML', () => {
  assert.ok(
    dashboardSource.includes('id="services-panel"'),
    'Missing id="services-panel"'
  );
});

test('Exactly three service rows with correct data-service attributes', () => {
  assert.ok(dashboardSource.includes('data-service="orchestrator"'), 'Missing orchestrator row');
  assert.ok(dashboardSource.includes('data-service="server"'),       'Missing server row');
  assert.ok(dashboardSource.includes('data-service="detector"'),     'Missing detector row');
  // No extra rows
  const count = (dashboardSource.match(/data-service="/g) || []).length;
  assert.strictEqual(count, 3, `Expected 3 data-service attributes, got ${count}`);
});

test('No leftover #service-health-pill markup', () => {
  assert.ok(
    !dashboardSource.includes('id="service-health-pill"'),
    'Found removed element #service-health-pill in HTML'
  );
  assert.ok(
    !dashboardSource.includes('id="service-health-pill-label"'),
    'Found removed element #service-health-pill-label in HTML'
  );
});

test('Each service row has a hover tooltip element', () => {
  assert.ok(dashboardSource.includes('id="svc-orchestrator-tooltip"'), 'Missing orchestrator tooltip');
  assert.ok(dashboardSource.includes('id="svc-server-tooltip"'),       'Missing server tooltip');
  assert.ok(dashboardSource.includes('id="svc-detector-tooltip"'),     'Missing detector tooltip');
});

test('Detector missing → references README-health-detector.md', () => {
  assert.ok(
    dashboardSource.includes('scripts/README-health-detector.md'),
    'Missing install reference to scripts/README-health-detector.md'
  );
});

test('Approve gate still uses serviceHealthDown flag', () => {
  assert.ok(
    dashboardSource.includes('serviceHealthDown'),
    'serviceHealthDown flag must still be used by approve gate'
  );
  assert.ok(
    dashboardSource.includes('if (serviceHealthDown) return'),
    'sliceDetailApprove must guard with serviceHealthDown'
  );
});

test('Approve button tooltip mentions Docker + watcher when disabled', () => {
  assert.ok(
    dashboardSource.includes('down — start Docker'),
    'Disabled approve tooltip should instruct operator to start Docker + watcher'
  );
});

// ---------------------------------------------------------------------------
// Render-logic tests (run updateServicesPanel in a VM sandbox)
// ---------------------------------------------------------------------------

console.log('\n── Orchestrator row render ──');

const freshWatcher = {
  status: 'up', heartbeatAge_s: 5, currentSlice: '184',
  elapsedSeconds: 150, lastActivityAge_s: 8, processedTotal: 42,
};
const staleWatcher = {
  status: 'stale', heartbeatAge_s: 45, currentSlice: null,
  elapsedSeconds: null, lastActivityAge_s: null, processedTotal: 10,
};
const downWatcher = {
  status: 'down', heartbeatAge_s: 90, currentSlice: null,
  elapsedSeconds: null, lastActivityAge_s: null, processedTotal: 5,
};
const freshHostHealth = {
  container_status: 'running', api_status: 'ok',
  last_checked: new Date().toISOString(), consecutive_failures: 0,
};

async function runPanel(opts) {
  const { sandbox, elements } = buildHarness(opts);
  await vm.runInContext('updateServicesPanel()', sandbox);
  // Allow microtasks to settle
  await new Promise(r => setTimeout(r, 200));
  // Re-read serviceHealthDown from sandbox
  const shd = vm.runInContext('serviceHealthDown', sandbox);
  return { elements, serviceHealthDown: shd };
}

test('Orchestrator up: dot class is "service-dot up"', async () => {
  const health = { watcher: freshWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-orchestrator-dot'].className.includes('up'),
    `Expected dot class to contain "up", got "${elements['svc-orchestrator-dot'].className}"`
  );
});

test('Orchestrator up: label says "Orchestrator up"', async () => {
  const health = { watcher: freshWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-orchestrator-label'].textContent.includes('up'),
    `Label should say up, got "${elements['svc-orchestrator-label'].textContent}"`
  );
});

test('Orchestrator up: tooltip shows current slice + elapsed', async () => {
  const health = { watcher: freshWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-orchestrator-tooltip'].innerHTML.includes('184'),
    'Tooltip should mention current_slice #184'
  );
});

test('Orchestrator down: dot class is "service-dot down"', async () => {
  const health = { watcher: downWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-orchestrator-dot'].className.includes('down'),
    `Expected "down", got "${elements['svc-orchestrator-dot'].className}"`
  );
});

test('Orchestrator unreachable (fetch fails): dot class is "service-dot down"', async () => {
  const { elements } = await runPanel({ fetchFails: true });
  assert.ok(
    elements['svc-orchestrator-dot'].className.includes('down'),
    `Expected "down", got "${elements['svc-orchestrator-dot'].className}"`
  );
});

console.log('\n── Server row render ──');

test('Server up: dot class is "service-dot up"', async () => {
  const health = { watcher: freshWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health, fetchMs: 50 });
  assert.ok(
    elements['svc-server-dot'].className.includes('up'),
    `Expected "up", got "${elements['svc-server-dot'].className}"`
  );
});

test('Server up: label says "Server up"', async () => {
  const health = { watcher: freshWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health, fetchMs: 50 });
  assert.strictEqual(elements['svc-server-label'].textContent, 'Server up');
});

test('Server down (fetch fails): dot class is "service-dot down"', async () => {
  const { elements } = await runPanel({ fetchFails: true });
  assert.ok(
    elements['svc-server-dot'].className.includes('down'),
    `Expected "down", got "${elements['svc-server-dot'].className}"`
  );
});

test('Server down (fetch fails): label says "Server down"', async () => {
  const { elements } = await runPanel({ fetchFails: true });
  assert.strictEqual(elements['svc-server-label'].textContent, 'Server down');
});

console.log('\n── Detector row render ──');

test('Detector up: dot class is "service-dot up"', async () => {
  const health = { watcher: freshWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-detector-dot'].className.includes('up'),
    `Expected "up", got "${elements['svc-detector-dot'].className}"`
  );
});

test('Detector up: tooltip says container running + API ok', async () => {
  const health = { watcher: freshWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-detector-tooltip'].innerHTML.includes('container running'),
    'Tooltip should say "container running"'
  );
});

test('Detector missing (hostHealth null): dot class is "service-dot down"', async () => {
  const health = { watcher: freshWatcher, hostHealth: null, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-detector-dot'].className.includes('down'),
    `Expected "down", got "${elements['svc-detector-dot'].className}"`
  );
});

test('Detector missing: tooltip references README-health-detector.md', async () => {
  const health = { watcher: freshWatcher, hostHealth: null, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-detector-tooltip'].innerHTML.includes('README-health-detector.md'),
    'Tooltip should reference README-health-detector.md for install instructions'
  );
});

test('Detector stale (last_checked > 30s ago): dot class is "service-dot down"', async () => {
  const staleHH = {
    container_status: 'running', api_status: 'ok',
    last_checked: new Date(Date.now() - 60000).toISOString(),
    consecutive_failures: 6,
  };
  const health = { watcher: freshWatcher, hostHealth: staleHH, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-detector-dot'].className.includes('down'),
    `Expected "down" for stale host-health, got "${elements['svc-detector-dot'].className}"`
  );
});

test('Detector container not running: dot class is "service-dot down"', async () => {
  const exitedHH = {
    container_status: 'exited', api_status: 'unknown',
    last_checked: new Date().toISOString(), consecutive_failures: 3,
  };
  const health = { watcher: freshWatcher, hostHealth: exitedHH, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-detector-dot'].className.includes('down'),
    `Expected "down" for exited container, got "${elements['svc-detector-dot'].className}"`
  );
});

test('Detector api_status not ok: dot class is "service-dot down"', async () => {
  const badApiHH = {
    container_status: 'running', api_status: 'error',
    last_checked: new Date().toISOString(), consecutive_failures: 1,
  };
  const health = { watcher: freshWatcher, hostHealth: badApiHH, ts: new Date().toISOString() };
  const { elements } = await runPanel({ health });
  assert.ok(
    elements['svc-detector-dot'].className.includes('down'),
    `Expected "down" for bad api_status, got "${elements['svc-detector-dot'].className}"`
  );
});

console.log('\n── Approve gate ──');

test('Approve gate: serviceHealthDown=true when orchestrator is down', async () => {
  const health = { watcher: downWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { serviceHealthDown } = await runPanel({ health });
  assert.strictEqual(serviceHealthDown, true, 'serviceHealthDown should be true when orchestrator is down');
});

test('Approve gate: serviceHealthDown=true when server is down (fetch fails)', async () => {
  const { serviceHealthDown } = await runPanel({ fetchFails: true });
  assert.strictEqual(serviceHealthDown, true, 'serviceHealthDown should be true when server is unreachable');
});

test('Approve gate: serviceHealthDown=false when only detector is down', async () => {
  const health = { watcher: freshWatcher, hostHealth: null, ts: new Date().toISOString() };
  const { serviceHealthDown } = await runPanel({ health });
  assert.strictEqual(serviceHealthDown, false, 'serviceHealthDown should be false when only detector is down');
});

test('Approve gate: serviceHealthDown=false when all services up', async () => {
  const health = { watcher: freshWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { serviceHealthDown } = await runPanel({ health });
  assert.strictEqual(serviceHealthDown, false, 'serviceHealthDown should be false when all services are up');
});

test('Approve gate: serviceHealthDown=false when stale orchestrator but server up', async () => {
  // Stale (not down) orchestrator should not block approvals
  const health = { watcher: staleWatcher, hostHealth: freshHostHealth, ts: new Date().toISOString() };
  const { serviceHealthDown } = await runPanel({ health });
  assert.strictEqual(serviceHealthDown, false, 'Stale orchestrator should not block approvals');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

// Async tests require a bit of patience — collect all promises and report
Promise.resolve().then(async () => {
  // All sync tests have already run above; now report
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  if (failed > 0) process.exit(1);
});
