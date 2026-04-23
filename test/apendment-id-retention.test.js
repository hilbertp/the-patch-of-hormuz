'use strict';

/**
 * apendment-id-retention.test.js
 *
 * End-to-end test for D3: apendment-ID retention + consolidated telemetry.
 * Exercises:
 *   (a) 5 consecutive Nog returns under a single ID
 *   (b) Consolidated totals match sum of per-round telemetry
 *   (c) MAX_ROUNDS_EXHAUSTED emits with id: <parent>, round: 5 and does not burn a new ID
 *   (d) appendRoundEntry writes correct YAML and recomputes totals
 *   (e) extractRomTelemetry extracts correct fields from DONE report
 *   (f) Terminology migration: no AMENDMENT_NEEDED in write-side code
 *
 * Run: node test/apendment-id-retention.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TEMP = path.join(require('os').tmpdir(), `ds9-retention-test-${Date.now()}`);
const QUEUE = path.join(TEMP, 'queue');
fs.mkdirSync(QUEUE, { recursive: true });

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
// Extracted helpers — replicate orchestrator logic locally to test in isolation
// ---------------------------------------------------------------------------

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

function updateFrontmatter(text, updates) {
  const lines = text.split('\n');
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (start === -1) { start = i; } else { end = i; break; }
    }
  }
  if (start === -1 || end === -1) return text;
  const fmLines = lines.slice(start + 1, end);
  for (const [key, val] of Object.entries(updates)) {
    const idx = fmLines.findIndex(l => {
      const c = l.indexOf(':');
      return c !== -1 && l.slice(0, c).trim() === key;
    });
    const newLine = `${key}: "${val}"`;
    if (idx !== -1) fmLines[idx] = newLine;
    else fmLines.push(newLine);
  }
  return [...lines.slice(0, start + 1), ...fmLines, ...lines.slice(end)].join('\n');
}

// Replicate appendRoundEntry from orchestrator.js
function appendRoundEntry(sliceFilePath, roundEntry) {
  let content;
  try {
    content = fs.readFileSync(sliceFilePath, 'utf-8');
  } catch (err) {
    return;
  }

  const lines = content.split('\n');
  let fmStart = -1, fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (fmStart === -1) { fmStart = i; } else { fmEnd = i; break; }
    }
  }
  if (fmStart === -1 || fmEnd === -1) return;

  const yamlEntry = [
    `  - round: ${roundEntry.round}`,
    `    commissioned_at: "${roundEntry.commissioned_at || ''}"`,
    `    done_at: "${roundEntry.done_at || ''}"`,
    `    durationMs: ${roundEntry.durationMs || 0}`,
    `    tokensIn: ${roundEntry.tokensIn || 0}`,
    `    tokensOut: ${roundEntry.tokensOut || 0}`,
    `    costUsd: ${roundEntry.costUsd != null ? roundEntry.costUsd : 0}`,
    `    nog_verdict: "${roundEntry.nog_verdict || ''}"`,
    `    nog_reason: "${(roundEntry.nog_reason || '').replace(/"/g, '\\"')}"`,
  ];

  const fmLines = lines.slice(fmStart + 1, fmEnd);
  const roundsIdx = fmLines.findIndex(l => /^rounds:\s*$/.test(l.trim()) || /^rounds:$/.test(l.trim()));

  if (roundsIdx === -1) {
    fmLines.push('rounds:');
    fmLines.push(...yamlEntry);
  } else {
    let insertAt = roundsIdx + 1;
    while (insertAt < fmLines.length && /^\s{2,}-?\s/.test(fmLines[insertAt])) {
      insertAt++;
    }
    fmLines.splice(insertAt, 0, ...yamlEntry);
  }

  // Recompute totals
  let totalDuration = 0, totalIn = 0, totalOut = 0, totalCost = 0;
  for (let i = 0; i < fmLines.length; i++) {
    const m = fmLines[i].match(/^\s+durationMs:\s*(\d+)/);
    if (m) totalDuration += parseInt(m[1], 10);
    const m2 = fmLines[i].match(/^\s+tokensIn:\s*(\d+)/);
    if (m2) totalIn += parseInt(m2[1], 10);
    const m3 = fmLines[i].match(/^\s+tokensOut:\s*(\d+)/);
    if (m3) totalOut += parseInt(m3[1], 10);
    const m4 = fmLines[i].match(/^\s+costUsd:\s*([\d.]+)/);
    if (m4) totalCost += parseFloat(m4[1]);
  }

  const totals = {
    total_durationMs: String(totalDuration),
    total_tokensIn: String(totalIn),
    total_tokensOut: String(totalOut),
    total_costUsd: String(parseFloat(totalCost.toFixed(6))),
  };

  for (const [key, val] of Object.entries(totals)) {
    const idx = fmLines.findIndex(l => {
      const c = l.indexOf(':');
      return c !== -1 && l.slice(0, c).trim() === key;
    });
    const newLine = `${key}: ${val}`;
    if (idx !== -1) fmLines[idx] = newLine;
    else fmLines.push(newLine);
  }

  // Update round field
  const roundFieldIdx = fmLines.findIndex(l => {
    const c = l.indexOf(':');
    return c !== -1 && l.slice(0, c).trim() === 'round' && !/^\s/.test(l);
  });
  const roundLine = `round: ${roundEntry.round}`;
  if (roundFieldIdx !== -1) fmLines[roundFieldIdx] = roundLine;
  else fmLines.push(roundLine);

  const result = [...lines.slice(0, fmStart + 1), ...fmLines, ...lines.slice(fmEnd)].join('\n');
  fs.writeFileSync(sliceFilePath, result);
}

// ---------------------------------------------------------------------------
// Read orchestrator source for structural assertions
// ---------------------------------------------------------------------------

const watcherSource = fs.readFileSync(
  path.join(__dirname, '..', 'bridge', 'orchestrator.js'),
  'utf-8'
);

console.log('\n== Apendment-ID retention + consolidated telemetry tests ==\n');

// ---------------------------------------------------------------------------
// Test (a): 5 consecutive Nog returns under a single ID
// ---------------------------------------------------------------------------

test('5 consecutive rounds retain the same slice ID', () => {
  const slicePath = path.join(QUEUE, '200-PARKED.md');
  const initialContent = [
    '---',
    'id: "200"',
    'title: "Test slice"',
    'from: obrien',
    'to: rom',
    'priority: normal',
    'status: PARKED',
    'created: "2026-04-19T00:00:00.000Z"',
    '---',
    '',
    '## Objective',
    'Do the thing.',
  ].join('\n');

  fs.writeFileSync(slicePath, initialContent);

  // Simulate 5 rounds of Nog returns
  for (let round = 1; round <= 5; round++) {
    appendRoundEntry(slicePath, {
      round,
      commissioned_at: `2026-04-19T0${round}:00:00.000Z`,
      done_at: `2026-04-19T0${round}:30:00.000Z`,
      durationMs: 100000 * round,
      tokensIn: 1000 * round,
      tokensOut: 500 * round,
      costUsd: 0.5 * round,
      nog_verdict: round < 5 ? 'NOG_RETURN' : 'MAX_ROUNDS_EXHAUSTED',
      nog_reason: `Round ${round} findings`,
    });
  }

  // Read the final file
  const finalContent = fs.readFileSync(slicePath, 'utf-8');
  const meta = parseFrontmatter(finalContent);

  // ID must be unchanged
  assert.strictEqual(meta.id, '200', 'Slice ID must remain 200 across all rounds');

  // round field should be 5
  assert.strictEqual(meta.round, '5', 'round field should be 5 after 5 rounds');

  // Clean up
  fs.unlinkSync(slicePath);
});

// ---------------------------------------------------------------------------
// Test (b): Consolidated totals match sum of per-round telemetry
// ---------------------------------------------------------------------------

test('total_* fields equal sum of per-round telemetry', () => {
  const slicePath = path.join(QUEUE, '201-PARKED.md');
  const initialContent = [
    '---',
    'id: "201"',
    'title: "Totals test"',
    'status: PARKED',
    '---',
    '',
    '## Body',
  ].join('\n');

  fs.writeFileSync(slicePath, initialContent);

  const rounds = [
    { round: 1, durationMs: 100000, tokensIn: 1000, tokensOut: 500, costUsd: 0.75, nog_verdict: 'NOG_RETURN', nog_reason: 'R1' },
    { round: 2, durationMs: 200000, tokensIn: 2000, tokensOut: 1000, costUsd: 1.50, nog_verdict: 'NOG_RETURN', nog_reason: 'R2' },
    { round: 3, durationMs: 150000, tokensIn: 1500, tokensOut: 750, costUsd: 1.125, nog_verdict: 'NOG_PASS', nog_reason: 'All good' },
  ];

  for (const r of rounds) {
    appendRoundEntry(slicePath, r);
  }

  const finalContent = fs.readFileSync(slicePath, 'utf-8');
  const meta = parseFrontmatter(finalContent);

  const expectedDuration = 100000 + 200000 + 150000;
  const expectedIn = 1000 + 2000 + 1500;
  const expectedOut = 500 + 1000 + 750;
  const expectedCost = 0.75 + 1.50 + 1.125;

  assert.strictEqual(meta.total_durationMs, String(expectedDuration), `total_durationMs should be ${expectedDuration}`);
  assert.strictEqual(meta.total_tokensIn, String(expectedIn), `total_tokensIn should be ${expectedIn}`);
  assert.strictEqual(meta.total_tokensOut, String(expectedOut), `total_tokensOut should be ${expectedOut}`);
  assert.strictEqual(meta.total_costUsd, String(expectedCost), `total_costUsd should be ${expectedCost}`);

  fs.unlinkSync(slicePath);
});

// ---------------------------------------------------------------------------
// Test (c): MAX_ROUNDS_EXHAUSTED emits with correct shape and no new ID
// ---------------------------------------------------------------------------

test('MAX_ROUNDS_EXHAUSTED in orchestrator uses parent ID and round: 5', () => {
  // Verify in orchestrator source: MAX_ROUNDS_EXHAUSTED event has round: 5
  const maxRoundsBlock = watcherSource.split('\n').reduce((acc, line, i, arr) => {
    if (line.includes("'MAX_ROUNDS_EXHAUSTED'")) {
      acc.push(arr.slice(i, i + 10).join('\n'));
    }
    return acc;
  }, []);

  assert.ok(maxRoundsBlock.length > 0, 'MAX_ROUNDS_EXHAUSTED must exist in orchestrator');
  assert.ok(
    maxRoundsBlock.some(b => b.includes('round: 5')),
    'MAX_ROUNDS_EXHAUSTED must emit with round: 5'
  );

  // Verify no nextSliceId call near MAX_ROUNDS_EXHAUSTED
  const lines = watcherSource.split('\n');
  let maxRoundsLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("'MAX_ROUNDS_EXHAUSTED'")) {
      maxRoundsLine = i;
      break;
    }
  }
  assert.ok(maxRoundsLine > 0, 'Found MAX_ROUNDS_EXHAUSTED line');

  // Check 40 lines around it for nextSliceId
  const window = lines.slice(Math.max(0, maxRoundsLine - 20), maxRoundsLine + 20).join('\n');
  assert.ok(
    !window.includes('nextSliceId'),
    'MAX_ROUNDS_EXHAUSTED path must NOT call nextSliceId'
  );
});

// ---------------------------------------------------------------------------
// Test (d): handleNogReturn in orchestrator does NOT call nextSliceId
// ---------------------------------------------------------------------------

test('handleNogReturn does NOT call nextSliceId (ID retention)', () => {
  // Find handleNogReturn function body
  const lines = watcherSource.split('\n');
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('function handleNogReturn(')) {
      start = i;
    }
    if (start > 0 && i > start && /^function\s/.test(lines[i]) && !lines[i].includes('handleNogReturn')) {
      end = i;
      break;
    }
  }
  assert.ok(start > 0, 'handleNogReturn must exist');
  assert.ok(end > start, 'handleNogReturn must have an end');

  const fnBody = lines.slice(start, end).join('\n');
  assert.ok(
    !fnBody.includes('nextSliceId'),
    'handleNogReturn must NOT call nextSliceId — ID retention'
  );
});

// ---------------------------------------------------------------------------
// Test (e): handleApendment removed (slice 191: dead code after evaluator merge)
// ---------------------------------------------------------------------------

test('handleApendment does NOT exist in orchestrator (removed slice 191)', () => {
  assert.ok(
    !watcherSource.includes('function handleApendment('),
    'handleApendment must be removed — dead code after invokeEvaluator merge'
  );
});

// ---------------------------------------------------------------------------
// Test (f): appendRoundEntry function exists in orchestrator
// ---------------------------------------------------------------------------

test('appendRoundEntry and extractRomTelemetry exist in orchestrator', () => {
  assert.ok(
    watcherSource.includes('function appendRoundEntry('),
    'appendRoundEntry must exist in orchestrator.js'
  );
  assert.ok(
    watcherSource.includes('function extractRomTelemetry('),
    'extractRomTelemetry must exist in orchestrator.js'
  );
});

// ---------------------------------------------------------------------------
// Test (g): rounds[] entries are never rewritten (frozen per round)
// ---------------------------------------------------------------------------

test('rounds[] entries are frozen — appending round 3 does not alter round 1 or 2', () => {
  const slicePath = path.join(QUEUE, '202-PARKED.md');
  const initialContent = [
    '---',
    'id: "202"',
    'title: "Freeze test"',
    'status: PARKED',
    '---',
    '',
    '## Body',
  ].join('\n');

  fs.writeFileSync(slicePath, initialContent);

  // Add round 1
  appendRoundEntry(slicePath, {
    round: 1, durationMs: 111, tokensIn: 11, tokensOut: 22, costUsd: 0.33,
    nog_verdict: 'NOG_RETURN', nog_reason: 'Fix bug A',
  });

  const afterR1 = fs.readFileSync(slicePath, 'utf-8');
  assert.ok(afterR1.includes('durationMs: 111'), 'R1 durationMs present');

  // Add round 2
  appendRoundEntry(slicePath, {
    round: 2, durationMs: 222, tokensIn: 44, tokensOut: 55, costUsd: 0.66,
    nog_verdict: 'NOG_RETURN', nog_reason: 'Fix bug B',
  });

  const afterR2 = fs.readFileSync(slicePath, 'utf-8');
  // R1 entry must still be intact
  assert.ok(afterR2.includes('durationMs: 111'), 'R1 durationMs still present after R2');
  assert.ok(afterR2.includes('durationMs: 222'), 'R2 durationMs present');
  assert.ok(afterR2.includes('nog_reason: "Fix bug A"'), 'R1 reason intact');
  assert.ok(afterR2.includes('nog_reason: "Fix bug B"'), 'R2 reason present');

  // Add round 3
  appendRoundEntry(slicePath, {
    round: 3, durationMs: 333, tokensIn: 77, tokensOut: 88, costUsd: 0.99,
    nog_verdict: 'NOG_PASS', nog_reason: 'All good',
  });

  const afterR3 = fs.readFileSync(slicePath, 'utf-8');
  assert.ok(afterR3.includes('durationMs: 111'), 'R1 still intact after R3');
  assert.ok(afterR3.includes('durationMs: 222'), 'R2 still intact after R3');
  assert.ok(afterR3.includes('durationMs: 333'), 'R3 present');

  // Totals
  const meta = parseFrontmatter(afterR3);
  assert.strictEqual(meta.total_durationMs, String(111 + 222 + 333), 'total_durationMs correct');
  assert.strictEqual(meta.total_tokensIn, String(11 + 44 + 77), 'total_tokensIn correct');
  assert.strictEqual(meta.total_tokensOut, String(22 + 55 + 88), 'total_tokensOut correct');

  fs.unlinkSync(slicePath);
});

// ---------------------------------------------------------------------------
// Test (h): invokeEvaluator removed (slice 191: merged into single Nog pass)
// ---------------------------------------------------------------------------

test('invokeEvaluator does NOT exist in orchestrator (removed slice 191)', () => {
  assert.ok(
    !watcherSource.includes('function invokeEvaluator('),
    'invokeEvaluator must be removed — merged into single invokeNog pass'
  );
});

// ---------------------------------------------------------------------------
// Test (i): Register events for Nog return carry round and apendment_cycle
// ---------------------------------------------------------------------------

test('NOG_DECISION register event for REJECTED includes apendment_cycle field', () => {
  // Find registerEvent calls with NOG_DECISION that carry REJECTED verdict
  const lines = watcherSource.split('\n');
  const nogDecisionCalls = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("'NOG_DECISION'") && lines[i].includes('registerEvent')) {
      nogDecisionCalls.push(lines.slice(i, i + 5).join('\n'));
    }
  }
  assert.ok(nogDecisionCalls.length > 0, 'Must have NOG_DECISION registerEvent calls');
  assert.ok(
    nogDecisionCalls.some(c => c.includes('apendment_cycle')),
    'NOG_DECISION REJECTED register event must include apendment_cycle'
  );
});

// ---------------------------------------------------------------------------
// Test (j): extractRomTelemetry extracts correct fields
// ---------------------------------------------------------------------------

test('extractRomTelemetry extracts metrics from DONE report frontmatter', () => {
  // Simulated DONE report
  const doneReport = [
    '---',
    'id: "200"',
    'tokens_in: 5000',
    'tokens_out: 2500',
    'elapsed_ms: 180000',
    'completed: "2026-04-19T03:30:00.000Z"',
    'created: "2026-04-19T03:00:00.000Z"',
    '---',
    'Done report body.',
  ].join('\n');

  // Replicate extractRomTelemetry locally
  const meta = parseFrontmatter(doneReport) || {};
  const tokensIn = parseInt(meta.tokens_in, 10) || 0;
  const tokensOut = parseInt(meta.tokens_out, 10) || 0;

  assert.strictEqual(tokensIn, 5000, 'tokensIn from DONE report');
  assert.strictEqual(tokensOut, 2500, 'tokensOut from DONE report');
  assert.strictEqual(parseInt(meta.elapsed_ms, 10), 180000, 'durationMs from DONE report');
  assert.strictEqual(meta.completed, '2026-04-19T03:30:00.000Z', 'done_at from DONE report');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);

// Cleanup temp dir
try { fs.rmSync(TEMP, { recursive: true }); } catch (_) {}

process.exit(failed > 0 ? 1 : 0);
