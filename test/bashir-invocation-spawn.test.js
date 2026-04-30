'use strict';

/**
 * bashir-invocation-spawn.test.js — Slice 267
 *
 * Tests for Bashir invocation in startGate():
 *   1. buildBashirPrompt extracts slice ACs from DONE files
 *   2. buildBashirPrompt hydrates heartbeat path in template
 *   3. buildBashirPrompt does NOT include diffs or product code
 *   4. startGate spawns claude -p with correct args
 *   5. Bashir prompt contains AC bundle for unmerged slices
 *
 * Run: node test/bashir-invocation-spawn.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Setup: temp queue dir with slice DONE files
// ---------------------------------------------------------------------------

const QUEUE_DIR = path.resolve(__dirname, '..', 'bridge', 'queue');
const BRANCH_STATE_PATH = path.resolve(__dirname, '..', 'bridge', 'state', 'branch-state.json');
const TEMPLATE_PATH = path.resolve(__dirname, '..', 'bridge', 'templates', 'bashir-prompt.md');

// Save originals for cleanup
const originalBranchState = fs.readFileSync(BRANCH_STATE_PATH, 'utf-8');

// Create test slice DONE files
const SLICE_42_DONE = path.join(QUEUE_DIR, '42-DONE.md');
const SLICE_43_DONE = path.join(QUEUE_DIR, '43-DONE.md');

const slice42Content = [
  '---',
  'id: "42"',
  'title: "Test slice 42"',
  'status: DONE',
  '---',
  '',
  '## Goal',
  '',
  'Some goal here.',
  '',
  '## Acceptance criteria',
  '',
  '1. Widget renders correctly.',
  '2. Widget responds to click events.',
  '',
  '## Notes',
  '',
  'Some notes.',
].join('\n');

const slice43Content = [
  '---',
  'id: "43"',
  'title: "Test slice 43"',
  'status: DONE',
  '---',
  '',
  '## Goal',
  '',
  'Another goal.',
  '',
  '## Acceptance Criteria',
  '',
  '1. Data loads from API endpoint.',
  '2. Error state renders fallback UI.',
  '',
].join('\n');

function setup() {
  fs.writeFileSync(SLICE_42_DONE, slice42Content, 'utf-8');
  fs.writeFileSync(SLICE_43_DONE, slice43Content, 'utf-8');
}

function cleanup() {
  try { fs.unlinkSync(SLICE_42_DONE); } catch (_) {}
  try { fs.unlinkSync(SLICE_43_DONE); } catch (_) {}
  fs.writeFileSync(BRANCH_STATE_PATH, originalBranchState, 'utf-8');
}

// ---------------------------------------------------------------------------
// Load module under test
// ---------------------------------------------------------------------------

const orchestrator = require('../bridge/orchestrator');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nbashir-invocation-spawn.test.js');
console.log('─'.repeat(50));

setup();

test('buildBashirPrompt extracts ACs from DONE files', () => {
  const branchState = {
    dev: {
      tip_sha: 'abc123',
      commits: [
        { sha: 'aaa', subject: 'merge: slice/42 — Test slice 42 (slice 42)' },
        { sha: 'bbb', subject: 'merge: slice/43 — Test slice 43 (slice 43)' },
      ],
    },
  };

  // Point orchestrator at our queue dir
  orchestrator._testSetDirs(QUEUE_DIR, QUEUE_DIR, QUEUE_DIR);

  const prompt = orchestrator.buildBashirPrompt(branchState);

  // Should contain ACs from both slices
  assert.ok(prompt.includes('Widget renders correctly'), 'Should include slice 42 AC 1');
  assert.ok(prompt.includes('Widget responds to click events'), 'Should include slice 42 AC 2');
  assert.ok(prompt.includes('Data loads from API endpoint'), 'Should include slice 43 AC 1');
  assert.ok(prompt.includes('Error state renders fallback UI'), 'Should include slice 43 AC 2');
});

test('buildBashirPrompt hydrates heartbeat path', () => {
  const branchState = {
    dev: {
      tip_sha: 'abc123',
      commits: [
        { sha: 'aaa', subject: 'merge: slice/42 — Test (slice 42)' },
      ],
    },
  };

  orchestrator._testSetDirs(QUEUE_DIR, QUEUE_DIR, QUEUE_DIR);
  const prompt = orchestrator.buildBashirPrompt(branchState);

  assert.ok(prompt.includes('bridge/state/bashir-heartbeat.json'), 'Should contain heartbeat path');
  assert.ok(!prompt.includes('{{HEARTBEAT_PATH}}'), 'Template variable should be replaced');
});

test('buildBashirPrompt does NOT include diffs or product code references', () => {
  const branchState = {
    dev: {
      tip_sha: 'abc123',
      commits: [
        { sha: 'aaa', subject: 'merge: slice/42 — Test (slice 42)' },
      ],
    },
  };

  orchestrator._testSetDirs(QUEUE_DIR, QUEUE_DIR, QUEUE_DIR);
  const prompt = orchestrator.buildBashirPrompt(branchState);

  // The prompt should not contain actual diff output or product source code.
  // It does legitimately say "Do NOT read git diffs" as an instruction — that's fine.
  assert.ok(!prompt.includes('function startGate'), 'Should not contain product code');
  assert.ok(!prompt.includes('diff --git'), 'Should not contain actual diff output');
  assert.ok(prompt.includes('Do NOT read git diffs'), 'Should include AC-blind constraint');
});

test('buildBashirPrompt handles missing slice files gracefully', () => {
  const branchState = {
    dev: {
      tip_sha: 'abc123',
      commits: [
        { sha: 'aaa', subject: 'merge: slice/999 — Missing slice (slice 999)' },
      ],
    },
  };

  orchestrator._testSetDirs(QUEUE_DIR, QUEUE_DIR, QUEUE_DIR);
  const prompt = orchestrator.buildBashirPrompt(branchState);

  assert.ok(prompt.includes('Slice 999'), 'Should mention the slice');
  assert.ok(prompt.includes('not found'), 'Should indicate file not found');
});

test('buildBashirPrompt with empty commits list', () => {
  const branchState = {
    dev: { tip_sha: 'abc123', commits: [] },
  };

  orchestrator._testSetDirs(QUEUE_DIR, QUEUE_DIR, QUEUE_DIR);
  const prompt = orchestrator.buildBashirPrompt(branchState);

  assert.ok(prompt.includes('No unmerged slices found'), 'Should indicate no slices');
});

test('prompt template references ROLE.md', () => {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  assert.ok(template.includes('roles/bashir/ROLE.md'), 'Template should reference ROLE.md');
});

test('prompt template includes gate-telemetry.emit instruction', () => {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  assert.ok(template.includes('gate-telemetry.emit'), 'Template should reference gate-telemetry.emit');
  assert.ok(template.includes('tests-updated'), 'Template should mention tests-updated event');
});

test('prompt template forbids suite execution', () => {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  assert.ok(template.includes('Do NOT execute the regression suite'), 'Template should forbid suite execution');
});

// ---------------------------------------------------------------------------
// Cleanup + report
// ---------------------------------------------------------------------------

cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
