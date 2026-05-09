'use strict';

/**
 * bashir-non-gate-dispatch.test.js — Slice 299
 *
 * Tests for the non-gate Bashir dispatch path:
 *   1. buildBashirNonGatePrompt hydrates template with slice body
 *   2. buildBashirNonGatePrompt hydrates heartbeat path
 *   3. Non-gate prompt does NOT contain gate-specific scaffolding
 *   4. Non-gate prompt template file exists and is well-formed
 *   5. Dispatch routes to: bashir slices through non-gate path (not Rom)
 *   6. Default timeout for bashir slices is 60 minutes
 *
 * Run: node test/bashir-non-gate-dispatch.test.js
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
// Load module under test
// ---------------------------------------------------------------------------

const orchestrator = require('../bridge/orchestrator');
const TEMPLATE_PATH = path.resolve(__dirname, '..', 'bridge', 'templates', 'bashir-non-gate-prompt.md');
const GATE_TEMPLATE_PATH = path.resolve(__dirname, '..', 'bridge', 'templates', 'bashir-prompt.md');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nbashir-non-gate-dispatch.test.js');
console.log('\u2500'.repeat(50));

test('non-gate prompt template file exists', () => {
  assert.ok(fs.existsSync(TEMPLATE_PATH), 'bashir-non-gate-prompt.md should exist');
});

test('buildBashirNonGatePrompt hydrates slice body', () => {
  const sliceContent = [
    '---',
    'id: "100"',
    'title: "Test Bashir slice"',
    'from: obrien',
    'to: bashir',
    'priority: normal',
    'created: "2026-05-09T12:00:00.000Z"',
    '---',
    '',
    '## Goal',
    '',
    'Scout the test infrastructure.',
    '',
    '## Tasks',
    '',
    '- Investigate existing test patterns',
  ].join('\n');

  const prompt = orchestrator.buildBashirNonGatePrompt(sliceContent);

  assert.ok(prompt.includes('Scout the test infrastructure'), 'Should include slice body content');
  assert.ok(prompt.includes('Investigate existing test patterns'), 'Should include slice tasks');
  assert.ok(prompt.includes('id: "100"'), 'Should include slice frontmatter');
});

test('buildBashirNonGatePrompt hydrates heartbeat path', () => {
  const sliceContent = '---\nid: "100"\n---\n\nBody text.';
  const prompt = orchestrator.buildBashirNonGatePrompt(sliceContent);

  assert.ok(prompt.includes('bridge/state/bashir-heartbeat.json'), 'Should contain heartbeat path');
  assert.ok(!prompt.includes('{{HEARTBEAT_PATH}}'), 'Template variable should be replaced');
});

test('non-gate prompt does NOT contain gate-specific scaffolding', () => {
  const sliceContent = '---\nid: "100"\n---\n\nBody.';
  const prompt = orchestrator.buildBashirNonGatePrompt(sliceContent);

  assert.ok(!prompt.includes('{{SLICE_ACS}}'), 'Should not contain SLICE_ACS variable');
  // The non-gate template mentions gate-telemetry only to PROHIBIT its use (Do NOT).
  // It should NOT contain instructions to USE gate-telemetry (like the gate template does).
  assert.ok(!prompt.includes("require('./bridge/state/gate-telemetry')"), 'Should not contain gate-telemetry require instruction');
  assert.ok(!prompt.includes('AC-blind constraint'), 'Should not contain AC-blind constraint');
  assert.ok(prompt.includes('Non-Gate Slice'), 'Should identify as non-gate');
});

test('non-gate prompt includes mode: non-gate instructions', () => {
  const sliceContent = '---\nid: "100"\n---\n\nBody.';
  const prompt = orchestrator.buildBashirNonGatePrompt(sliceContent);

  assert.ok(prompt.includes('non-gate'), 'Should mention non-gate mode');
  assert.ok(prompt.includes('Do NOT'), 'Should include prohibition instructions');
  assert.ok(prompt.includes('roles/bashir/ROLE.md'), 'Should reference Bashir ROLE.md');
});

test('non-gate template differs from gate template', () => {
  const nonGate = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const gate = fs.readFileSync(GATE_TEMPLATE_PATH, 'utf-8');

  assert.notStrictEqual(nonGate, gate, 'Templates should be different files');
  assert.ok(gate.includes('{{SLICE_ACS}}'), 'Gate template should have SLICE_ACS');
  assert.ok(!nonGate.includes('{{SLICE_ACS}}'), 'Non-gate template should NOT have SLICE_ACS');
  assert.ok(nonGate.includes('{{SLICE_BODY}}'), 'Non-gate template should have SLICE_BODY');
  assert.ok(!gate.includes('{{SLICE_BODY}}'), 'Gate template should NOT have SLICE_BODY');
});

test('BASHIR_NON_GATE_DEFAULT_TIMEOUT_MS is 60 minutes', () => {
  assert.strictEqual(
    orchestrator.BASHIR_NON_GATE_DEFAULT_TIMEOUT_MS,
    60 * 60 * 1000,
    'Default non-gate Bashir timeout should be 60 minutes'
  );
});

test('BASHIR_NON_GATE_PROMPT_TEMPLATE points to correct file', () => {
  assert.strictEqual(
    orchestrator.BASHIR_NON_GATE_PROMPT_TEMPLATE,
    TEMPLATE_PATH,
    'Should point to bashir-non-gate-prompt.md'
  );
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
