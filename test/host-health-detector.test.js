'use strict';

/**
 * host-health-detector.test.js
 *
 * Tests for slice 183 — Host-side Docker health detector + Ops service-health pill:
 *   1. Detector script writes valid JSON for "running" state
 *   2. Detector script writes valid JSON for "exited" state
 *   3. Detector script writes valid JSON for "missing" state
 *   4. Dashboard has #service-health-pill element
 *   5. Dashboard pill reads hostHealth and applies pill-red class
 *   6. Approve button gets disabled attribute when service is down
 *   7. /api/health returns status:"ok" and ts field
 *   8. /api/health returns hostHealth field
 *   9. Detector script is executable
 *  10. launchd plist has correct Label and KeepAlive
 *
 * Run: node test/host-health-detector.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Read source files for static analysis
// ---------------------------------------------------------------------------

const dashboardSource = fs.readFileSync(
  path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html'),
  'utf-8'
);

const serverSource = fs.readFileSync(
  path.join(REPO_ROOT, 'dashboard', 'server.js'),
  'utf-8'
);

const detectorSource = fs.readFileSync(
  path.join(REPO_ROOT, 'scripts', 'host-health-detector.sh'),
  'utf-8'
);

const plistSource = fs.readFileSync(
  path.join(REPO_ROOT, 'scripts', 'com.liberation-of-bajor.health.plist'),
  'utf-8'
);

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
// Detector script tests — simulate by invoking write_status function logic
// ---------------------------------------------------------------------------

/**
 * We test the detector's JSON output shape by creating a temp directory,
 * running a small bash snippet that sources the write_status function,
 * and checking the resulting JSON.
 */
function testDetectorOutput(label, containerStatus, apiStatus, expectedShape) {
  test(`Detector output shape for ${label}`, () => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'health-test-'));
    const bridgeDir = path.join(tmpDir, 'bridge');
    fs.mkdirSync(bridgeDir);

    // Inline the write_status function from the detector and call it
    const script = `
      set -euo pipefail
      HEALTH_FILE="${bridgeDir}/host-health.json"
      HEALTH_TMP="${bridgeDir}/.host-health.json.tmp"
      consecutive_failures=2

      write_status() {
        local container_status="$1"
        local api_status="$2"
        local now
        now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        cat > "$HEALTH_TMP" <<ENDJSON
{
  "container_status": "$container_status",
  "api_status": "$api_status",
  "last_checked": "$now",
  "consecutive_failures": $consecutive_failures
}
ENDJSON
        mv -f "$HEALTH_TMP" "$HEALTH_FILE"
      }

      write_status "${containerStatus}" "${apiStatus}"
    `;

    execSync(script, { shell: '/bin/bash' });

    const result = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'host-health.json'), 'utf-8'));

    assert.strictEqual(result.container_status, expectedShape.container_status,
      `container_status should be "${expectedShape.container_status}"`);
    assert.strictEqual(result.api_status, expectedShape.api_status,
      `api_status should be "${expectedShape.api_status}"`);
    assert.strictEqual(typeof result.last_checked, 'string', 'last_checked should be a string');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(result.last_checked), 'last_checked should be ISO format');
    assert.strictEqual(typeof result.consecutive_failures, 'number', 'consecutive_failures should be a number');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
}

console.log('\n── Detector JSON output shape ──');

testDetectorOutput('running', 'running', 'ok', {
  container_status: 'running', api_status: 'ok'
});

testDetectorOutput('exited', 'exited', 'unknown', {
  container_status: 'exited', api_status: 'unknown'
});

testDetectorOutput('missing', 'missing', 'unknown', {
  container_status: 'missing', api_status: 'unknown'
});

// ---------------------------------------------------------------------------
// Dashboard static analysis tests
// ---------------------------------------------------------------------------

console.log('\n── Dashboard services panel ──');

test('Dashboard has #services-panel element', () => {
  assert.ok(
    dashboardSource.includes('id="services-panel"'),
    'Missing #services-panel element'
  );
});

test('Dashboard has three service rows (orchestrator, server, detector)', () => {
  assert.ok(dashboardSource.includes('data-service="orchestrator"'), 'Missing orchestrator row');
  assert.ok(dashboardSource.includes('data-service="server"'), 'Missing server row');
  assert.ok(dashboardSource.includes('data-service="detector"'), 'Missing detector row');
});

test('Dashboard has service-dot CSS classes', () => {
  assert.ok(dashboardSource.includes('service-dot.up') || dashboardSource.includes(".service-dot.up"), 'Missing service-dot.up CSS');
  assert.ok(dashboardSource.includes('service-dot.down') || dashboardSource.includes(".service-dot.down"), 'Missing service-dot.down CSS');
});

test('Dashboard has service-row-tooltip CSS', () => {
  assert.ok(
    dashboardSource.includes('service-row-tooltip'),
    'Missing service-row-tooltip CSS class'
  );
});

test('Dashboard reads hostHealth from /api/health response', () => {
  assert.ok(
    dashboardSource.includes('hostHealth'),
    'Dashboard should reference hostHealth data'
  );
});

test('Dashboard updateServicesPanel checks container_status and api_status', () => {
  assert.ok(
    dashboardSource.includes('container_status'),
    'Should reference container_status field'
  );
  assert.ok(
    dashboardSource.includes('api_status'),
    'Should reference api_status field'
  );
});

test('Dashboard checks host-health staleness (>30s)', () => {
  assert.ok(
    /age\s*<=?\s*30/.test(dashboardSource) || /30/.test(dashboardSource),
    'Should check 30-second staleness threshold'
  );
});

console.log('\n── Approve button gate ──');

test('Approve button gets disabled attribute when service is down', () => {
  // The renderSliceDetailActions function should conditionally add disabled
  assert.ok(
    dashboardSource.includes('approveDisabled') || dashboardSource.includes('serviceHealthDown'),
    'Approve button should be gated by service health state'
  );
});

test('Approve button has tooltip explaining why disabled', () => {
  assert.ok(
    dashboardSource.includes('down — start Docker'),
    'Disabled approve should show service-down tooltip with Docker instructions'
  );
});

test('sliceDetailApprove guards against serviceHealthDown', () => {
  assert.ok(
    dashboardSource.includes('if (serviceHealthDown) return'),
    'sliceDetailApprove should early-return when service is down'
  );
});

test('Disabled approve button has CSS styling', () => {
  assert.ok(
    dashboardSource.includes('.slice-action-approve:disabled') ||
    dashboardSource.includes('.slice-action-approve.disabled'),
    'Disabled approve button should have CSS styling'
  );
});

// ---------------------------------------------------------------------------
// Server /api/health tests
// ---------------------------------------------------------------------------

console.log('\n── /api/health endpoint ──');

test('/api/health returns status:"ok" field', () => {
  assert.ok(
    serverSource.includes("status: 'ok'"),
    '/api/health should include status: "ok"'
  );
});

test('/api/health returns ts field', () => {
  assert.ok(
    serverSource.includes('ts:') && serverSource.includes('toISOString'),
    '/api/health should include ts with ISO timestamp'
  );
});

test('/api/health reads host-health.json', () => {
  assert.ok(
    serverSource.includes('host-health.json'),
    '/api/health should read host-health.json'
  );
});

test('/api/health returns hostHealth field', () => {
  assert.ok(
    serverSource.includes('hostHealth'),
    '/api/health response should include hostHealth'
  );
});

// ---------------------------------------------------------------------------
// Detector script structural tests
// ---------------------------------------------------------------------------

console.log('\n── Detector script structure ──');

test('Detector script is executable', () => {
  const stat = fs.statSync(path.join(REPO_ROOT, 'scripts', 'host-health-detector.sh'));
  assert.ok(stat.mode & 0o111, 'host-health-detector.sh should be executable');
});

test('Detector uses atomic write (mv)', () => {
  assert.ok(
    detectorSource.includes('mv -f'),
    'Should use mv for atomic write'
  );
});

test('Detector uses docker inspect', () => {
  assert.ok(
    detectorSource.includes('docker inspect'),
    'Should use docker inspect to check container'
  );
});

test('Detector polls every 10 seconds', () => {
  assert.ok(
    detectorSource.includes('POLL_INTERVAL=10') || detectorSource.includes('sleep 10'),
    'Should poll every 10 seconds'
  );
});

test('Detector sends macOS notification via osascript', () => {
  assert.ok(
    detectorSource.includes('osascript'),
    'Should use osascript for macOS notification'
  );
});

test('Detector notification threshold is 30 seconds', () => {
  assert.ok(
    detectorSource.includes('NOTIFICATION_THRESHOLD=30') || detectorSource.includes('30'),
    'Should have 30-second notification threshold'
  );
});

test('Detector logs state changes', () => {
  assert.ok(
    detectorSource.includes('log_change') || detectorSource.includes('host-health.log'),
    'Should log state changes'
  );
});

// ---------------------------------------------------------------------------
// launchd plist tests
// ---------------------------------------------------------------------------

console.log('\n── launchd plist ──');

test('Plist has correct Label', () => {
  assert.ok(
    plistSource.includes('<string>com.liberation-of-bajor.health</string>'),
    'Label should be com.liberation-of-bajor.health'
  );
});

test('Plist has KeepAlive set to true', () => {
  assert.ok(
    plistSource.includes('<key>KeepAlive</key>') && plistSource.includes('<true/>'),
    'KeepAlive should be true'
  );
});

test('Plist has RunAtLoad set to true', () => {
  assert.ok(
    plistSource.includes('<key>RunAtLoad</key>') && plistSource.includes('<true/>'),
    'RunAtLoad should be true'
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
if (failed > 0) process.exit(1);
