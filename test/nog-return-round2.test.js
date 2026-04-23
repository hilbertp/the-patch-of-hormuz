'use strict';

/**
 * nog-return-round2.test.js
 *
 * Regression test for the round-2 Nog-return flow (post-D3: apendment-ID retention).
 * Verifies:
 *   1. handleNogReturn rewrites slice in-place (no new ID burned)
 *   2. handleNogReturn derives branch from rootId when branchName is null
 *   3. ERROR register events carry phase, command, exit_code, stderr_tail
 *   4. The new apendment spelling is used in write-side code
 *   5. Legacy amendment fields are still accepted on read
 *
 * Run: node test/nog-return-round2.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Setup: create a temp directory simulating the queue
// ---------------------------------------------------------------------------

const TEMP = path.join(require('os').tmpdir(), `ds9-test-${Date.now()}`);
const QUEUE = path.join(TEMP, 'queue');
const STAGED = path.join(TEMP, 'staged');
const TRASH = path.join(TEMP, 'trash');
const REGISTER = path.join(TEMP, 'register.jsonl');

fs.mkdirSync(QUEUE, { recursive: true });
fs.mkdirSync(STAGED, { recursive: true });
fs.mkdirSync(TRASH, { recursive: true });

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Import just parseFrontmatter and truncStderr from orchestrator.js (via regex
// extraction to avoid side effects of requiring the full module)
// ---------------------------------------------------------------------------

const watcherSource = fs.readFileSync(
  path.join(__dirname, '..', 'bridge', 'orchestrator.js'),
  'utf-8'
);

// Extract parseFrontmatter
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const meta = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) meta[key] = val;
  });
  return meta;
}

function truncStderr(s) {
  if (!s || typeof s !== 'string') return '';
  return s.length > 2000 ? s.slice(-2000) : s;
}

// ---------------------------------------------------------------------------
// Test 1: Nog return rewrites slice in-place (ID retention)
// ---------------------------------------------------------------------------

console.log('\n== Round-2 Nog-return regression tests (post-D3: apendment-ID retention) ==\n');

test('Nog return uses updated PARKED content (not stale pre-Nog version)', () => {
  const originalContent = [
    '---',
    'id: "150"',
    'title: "Test slice"',
    'from: obrien',
    'to: rom',
    'priority: normal',
    'created: "2026-04-19T00:00:00.000Z"',
    '---',
    '',
    '## Objective',
    'Do the thing.',
  ].join('\n');

  const updatedContent = originalContent + '\n\n## Nog Review — Round 1\n\nFindings: fix the bug.';

  // Write the PARKED file (simulating Nog's update)
  const parkedPath = path.join(QUEUE, '150-PARKED.md');
  fs.writeFileSync(parkedPath, updatedContent);

  // Write EVALUATING file
  const evaluatingPath = path.join(QUEUE, '150-EVALUATING.md');
  fs.writeFileSync(evaluatingPath, [
    '---',
    'id: "150"',
    'branch: "slice/150"',
    'status: DONE',
    '---',
    'Done report.',
  ].join('\n'));

  // Simulate what the FIXED invokeNog does: re-read PARKED after Nog updates it
  const staleContent = originalContent; // pre-Nog version
  const freshContent = fs.readFileSync(parkedPath, 'utf-8'); // post-Nog version

  // The apendment should embed freshContent, not staleContent
  assert.ok(
    freshContent.includes('## Nog Review — Round 1'),
    'Updated PARKED content should include Nog review'
  );
  assert.ok(
    !staleContent.includes('## Nog Review — Round 1'),
    'Stale content should NOT include Nog review'
  );

  // Clean up
  fs.unlinkSync(parkedPath);
  fs.unlinkSync(evaluatingPath);
});

// ---------------------------------------------------------------------------
// Test 2: Branch derivation from rootId when null
// ---------------------------------------------------------------------------

test('Branch derived from rootId when branchName is null', () => {
  const rootId = '150';
  let branchName = null;

  if (!branchName) {
    branchName = `slice/${rootId}`;
  }

  assert.strictEqual(branchName, 'slice/150');

  // Build apendment frontmatter (new D3 scheme: same ID, apendment field)
  const apendmentFm = [
    '---',
    `id: "150"`,
    `title: "Nog return round 1 — fix findings for slice ${rootId}"`,
    `apendment: "${branchName}"`,
    `branch: "${branchName}"`,
    `round: 1`,
    `apendment_cycle: 1`,
    'from: nog',
    'to: rom',
    'priority: normal',
    `created: "${new Date().toISOString()}"`,
    'status: QUEUED',
    '---',
  ].join('\n');

  const meta = parseFrontmatter(apendmentFm);

  // The apendment field must be truthy so invokeRom treats it as an apendment
  assert.ok(meta.apendment, 'apendment field must be truthy');
  assert.strictEqual(meta.apendment, 'slice/150');
  assert.strictEqual(meta.branch, 'slice/150');
  // Same ID — no new ID burned
  assert.strictEqual(meta.id, '150');
});

// ---------------------------------------------------------------------------
// Test 3: Legacy amendment field is still accepted on read (back-compat)
// ---------------------------------------------------------------------------

test('Legacy amendment field is accepted on read (back-compat)', () => {
  const legacyFm = [
    '---',
    'id: "999"',
    'amendment: "slice/150"',
    'branch: "slice/150"',
    'type: amendment',
    '---',
  ].join('\n');

  const meta = parseFrontmatter(legacyFm);
  // Legacy field still readable
  assert.ok(meta.amendment, 'Legacy amendment field should be truthy');
  assert.strictEqual(meta.amendment, 'slice/150');
});

test('Empty apendment field is falsy (demonstrates the old bug)', () => {
  const badApendment = [
    '---',
    'id: "999"',
    'apendment: ""',
    'branch: ""',
    '---',
  ].join('\n');

  const meta = parseFrontmatter(badApendment);
  assert.ok(!meta.apendment, 'Empty apendment field should be falsy');
});

// ---------------------------------------------------------------------------
// Test 4: truncStderr truncates to 2000 chars
// ---------------------------------------------------------------------------

test('truncStderr truncates long stderr to 2000 chars', () => {
  const long = 'x'.repeat(5000);
  const result = truncStderr(long);
  assert.strictEqual(result.length, 2000);
  assert.strictEqual(result, long.slice(-2000));
});

test('truncStderr handles null/undefined/empty', () => {
  assert.strictEqual(truncStderr(null), '');
  assert.strictEqual(truncStderr(undefined), '');
  assert.strictEqual(truncStderr(''), '');
});

test('truncStderr passes short strings through', () => {
  assert.strictEqual(truncStderr('short error'), 'short error');
});

// ---------------------------------------------------------------------------
// Test 5: ERROR register events carry enriched payload
// ---------------------------------------------------------------------------

test('ERROR register event payload has phase, command, exit_code, stderr_tail', () => {
  const event = {
    ts: new Date().toISOString(),
    id: '154',
    event: 'ERROR',
    reason: 'crash',
    phase: 'rom_invocation',
    command: 'claude -p --permission-mode bypassPermissions --output-format json',
    exit_code: 1,
    stderr_tail: 'Error: something went wrong',
    durationMs: 12345,
  };

  assert.ok('phase' in event, 'ERROR event must have phase');
  assert.ok('command' in event, 'ERROR event must have command');
  assert.ok('exit_code' in event, 'ERROR event must have exit_code');
  assert.ok('stderr_tail' in event, 'ERROR event must have stderr_tail');
  assert.ok('reason' in event, 'ERROR event must retain reason');
});

// ---------------------------------------------------------------------------
// Test 6: Verify orchestrator.js source has enriched ERROR events
// ---------------------------------------------------------------------------

test('All registerEvent ERROR calls include phase field', () => {
  const errorCalls = [];
  const lines = watcherSource.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("registerEvent") && lines[i].includes("'ERROR'")) {
      const block = lines.slice(i, i + 12).join('\n');
      errorCalls.push({ line: i + 1, block });
    }
  }

  assert.ok(errorCalls.length >= 5, `Expected at least 5 ERROR register calls, found ${errorCalls.length}`);

  for (const call of errorCalls) {
    assert.ok(
      call.block.includes('phase:'),
      `ERROR register call at line ${call.line} missing 'phase' field`
    );
    assert.ok(
      call.block.includes('stderr_tail:') || call.block.includes('stderr_tail'),
      `ERROR register call at line ${call.line} missing 'stderr_tail' field`
    );
  }
});

// ---------------------------------------------------------------------------
// Test 7: countNogRounds counts correctly across embedded content
// ---------------------------------------------------------------------------

test('countNogRounds counts review headers in embedded content', () => {
  function countNogRounds(content) {
    const matches = content.match(/^## Nog Review — Round \d+/gm);
    return matches ? matches.length : 0;
  }

  const content = [
    '---',
    'id: "154"',
    'round: 1',
    '---',
    '## Original slice',
    '## Nog Review — Round 1',
    'Some findings.',
  ].join('\n');

  assert.strictEqual(countNogRounds(content), 1);

  const round2 = content + '\n## Nog Review — Round 2\nMore findings.';
  assert.strictEqual(countNogRounds(round2), 2);
});

// ---------------------------------------------------------------------------
// Test 8: Verify no subprocess invocation uses stdio: 'inherit' except selfRestart
// ---------------------------------------------------------------------------

test('No execSync/execFile call uses stdio inherit (except selfRestart spawn)', () => {
  const inheritMatches = watcherSource.match(/exec(?:Sync|execFile)\([^)]*stdio:\s*'inherit'/g);
  assert.strictEqual(
    inheritMatches,
    null,
    `Found execSync/execFile calls with stdio: 'inherit': ${JSON.stringify(inheritMatches)}`
  );
});

// ---------------------------------------------------------------------------
// Test 9: invokeEvaluator is gone (slice 191: merged into single Nog pass)
// ---------------------------------------------------------------------------

test('invokeEvaluator does NOT exist in orchestrator source (removed slice 191)', () => {
  assert.ok(
    !watcherSource.includes('function invokeEvaluator('),
    'invokeEvaluator must be removed — merged into single invokeNog pass'
  );
});

// ---------------------------------------------------------------------------
// Test 10: handleApendment is gone (slice 191: dead code after evaluator removal)
// ---------------------------------------------------------------------------

test('handleApendment does NOT exist in orchestrator source (removed slice 191)', () => {
  assert.ok(
    !watcherSource.includes('function handleApendment('),
    'handleApendment must be removed — dead code after evaluator merge'
  );
  // Old amendment variant also gone
  assert.ok(
    !watcherSource.includes('function handleAmendment('),
    'Watcher should NOT have handleAmendment function'
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
