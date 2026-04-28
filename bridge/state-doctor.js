'use strict';

/**
 * state-doctor.js — Read-only diagnostic CLI for the Bashir gate system.
 *
 * Reads state files and prints a unified text view with sections:
 *   Orchestrator | Bashir | Gate | Pause flag | Recent events | Anomalies
 *
 * Usage: node bridge/state-doctor.js
 *
 * Exit codes: 0 = success, 1 = unexpected error
 * Read-only: no writes, no git mutations, no subprocess except git rev-parse.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.join(REPO_ROOT, 'bridge', 'state');

const STALE_THRESHOLD_MS = 120_000; // 2 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return { data: JSON.parse(raw), exists: true, error: null };
  } catch (err) {
    if (err.code === 'ENOENT') return { data: null, exists: false, error: null };
    return { data: null, exists: true, error: err.message };
  }
}

function readText(filePath) {
  try {
    return { text: fs.readFileSync(filePath, 'utf-8').trim(), exists: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { text: null, exists: false };
    return { text: null, exists: true, error: err.message };
  }
}

function fileExists(filePath) {
  try { fs.accessSync(filePath); return true; } catch { return false; }
}

function gitRevParse(ref) {
  try {
    return execSync(`git rev-parse ${ref}`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

function ageMs(isoTs) {
  if (!isoTs) return null;
  return Date.now() - new Date(isoTs).getTime();
}

function fmtAge(ms) {
  if (ms == null) return 'unknown';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m ago`;
}

function readLastRegisterEvents(filePath, count, filter) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const parsed = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (!filter || filter(obj)) parsed.push(obj);
      } catch { /* skip malformed lines */ }
    }
    return parsed.slice(-count);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    return [];
  }
}

function pad(label, width) {
  return (label + ':').padEnd(width);
}

// ---------------------------------------------------------------------------
// Data collection (exported for testing)
// ---------------------------------------------------------------------------

function collectState() {
  const branchState = readJson(path.join(STATE_DIR, 'branch-state.json'));
  const gateRunning = readJson(path.join(STATE_DIR, 'gate-running.json'));
  const bashirHb = readJson(path.join(STATE_DIR, 'bashir-heartbeat.json'));
  const orchHb = readJson(path.join(REPO_ROOT, 'bridge', 'heartbeat.json'));
  const runPid = readText(path.join(REPO_ROOT, 'bridge', '.run.pid'));
  const pauseFlag = fileExists(path.join(REPO_ROOT, 'bridge', '.pipeline-paused'));

  const gateEvents = ['gate-start', 'gate-pass', 'gate-fail', 'gate-abort',
    'gate-running', 'gate-timeout', 'recovery-scan'];
  const recentEvents = readLastRegisterEvents(
    path.join(REPO_ROOT, 'bridge', 'register.jsonl'),
    20,
    (e) => gateEvents.includes(e.event) || gateEvents.includes(e.type)
  );

  // Git rev-parse for drift detection
  const mainSha = gitRevParse('main');

  return { branchState, gateRunning, bashirHb, orchHb, runPid, pauseFlag, recentEvents, mainSha };
}

// ---------------------------------------------------------------------------
// Anomaly detection (exported for testing)
// ---------------------------------------------------------------------------

function detectAnomalies(state) {
  const anomalies = [];
  const { branchState, gateRunning, bashirHb, pauseFlag, mainSha } = state;

  const mutexPresent = gateRunning.exists && !gateRunning.error;
  const hbExists = bashirHb.exists && !bashirHb.error;
  const hbTs = bashirHb.data && bashirHb.data.ts;
  const hbAge = ageMs(hbTs);
  const hbStale = hbAge != null && hbAge > STALE_THRESHOLD_MS;

  // Mutex present but no heartbeat at all
  if (mutexPresent && !hbExists) {
    anomalies.push({
      id: 'mutex-no-heartbeat',
      severity: 'HIGH',
      message: 'Mutex present but no Bashir heartbeat file exists. Possible orphan (see F1).'
    });
  }

  // Mutex present but heartbeat stale
  if (mutexPresent && hbExists && hbStale) {
    anomalies.push({
      id: 'mutex-heartbeat-stale',
      severity: 'HIGH',
      message: `Mutex present but Bashir heartbeat is stale (${fmtAge(hbAge)}). Possible crash (see F1).`
    });
  }

  // Gate state says RUNNING but no mutex
  if (branchState.data && branchState.data.gate) {
    const gateStatus = branchState.data.gate.status;
    if (gateStatus === 'GATE_RUNNING' && !mutexPresent) {
      anomalies.push({
        id: 'gate-running-no-mutex',
        severity: 'HIGH',
        message: 'branch-state.json gate is GATE_RUNNING but no mutex file exists (see F4).'
      });
    }
  }

  // Branch state tip mismatch with git
  if (branchState.data && branchState.data.branch && mainSha) {
    const recorded = branchState.data.branch.main &&
      branchState.data.branch.main.tip_sha;
    if (recorded && recorded !== mainSha) {
      anomalies.push({
        id: 'main-tip-mismatch',
        severity: 'CRITICAL',
        message: `branch-state.json main tip (${recorded.slice(0, 8)}) != git main (${mainSha.slice(0, 8)}). Possible force-push (see F10).`
      });
    }
  }

  // Pause flag present
  if (pauseFlag) {
    anomalies.push({
      id: 'pause-flag-present',
      severity: 'INFO',
      message: 'Pipeline pause flag is set. Dispatch is halted (see F12).'
    });
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(state, anomalies) {
  const lines = [];
  const W = 22; // label padding width

  lines.push('='.repeat(60));
  lines.push('  STATE DOCTOR — Bashir Gate System');
  lines.push('='.repeat(60));
  lines.push('');

  // --- Orchestrator ---
  lines.push('--- Orchestrator ---');
  const { orchHb, runPid } = state;
  if (orchHb.exists && !orchHb.error && orchHb.data) {
    lines.push(`  ${pad('Status', W)} ${orchHb.data.status || 'unknown'}`);
    lines.push(`  ${pad('Heartbeat', W)} ${fmtAge(ageMs(orchHb.data.ts))}`);
    lines.push(`  ${pad('Current slice', W)} ${orchHb.data.current_slice || '(none)'}`);
    const q = orchHb.data.queue;
    if (q) {
      lines.push(`  ${pad('Queue', W)} waiting=${q.waiting || 0} active=${q.active || 0} done=${q.done || 0} error=${q.error || 0}`);
    }
  } else if (orchHb.exists && orchHb.error) {
    lines.push(`  ${pad('Heartbeat', W)} (parse error: ${orchHb.error})`);
  } else {
    lines.push(`  ${pad('Heartbeat', W)} (absent)`);
  }
  if (runPid.exists && runPid.text) {
    lines.push(`  ${pad('PID', W)} ${runPid.text}`);
  } else {
    lines.push(`  ${pad('PID', W)} (absent)`);
  }
  lines.push('');

  // --- Bashir ---
  lines.push('--- Bashir ---');
  const { bashirHb } = state;
  if (bashirHb.exists && !bashirHb.error && bashirHb.data) {
    const age = ageMs(bashirHb.data.ts);
    const stale = age != null && age > STALE_THRESHOLD_MS;
    lines.push(`  ${pad('Heartbeat', W)} ${fmtAge(age)}${stale ? ' [STALE]' : ''}`);
    lines.push(`  ${pad('Slice', W)} ${bashirHb.data.slice_id || '(none)'}`);
  } else if (bashirHb.exists && bashirHb.error) {
    lines.push(`  ${pad('Heartbeat', W)} (parse error: ${bashirHb.error})`);
  } else {
    lines.push(`  ${pad('Heartbeat', W)} (absent)`);
  }
  lines.push('');

  // --- Gate ---
  lines.push('--- Gate ---');
  const { branchState, gateRunning } = state;
  if (branchState.exists && !branchState.error && branchState.data && branchState.data.gate) {
    const g = branchState.data.gate;
    lines.push(`  ${pad('Status', W)} ${g.status || 'unknown'}`);
    if (g.slice_id) lines.push(`  ${pad('Slice', W)} ${g.slice_id}`);
    if (g.started_at) lines.push(`  ${pad('Started', W)} ${fmtAge(ageMs(g.started_at))}`);
    if (g.last_failure) lines.push(`  ${pad('Last failure', W)} ${g.last_failure}`);
  } else if (branchState.exists && branchState.error) {
    lines.push(`  ${pad('branch-state.json', W)} (parse error)`);
  } else {
    lines.push(`  ${pad('branch-state.json', W)} (absent)`);
  }
  if (gateRunning.exists && !gateRunning.error && gateRunning.data) {
    lines.push(`  ${pad('Mutex', W)} PRESENT`);
    if (gateRunning.data.started_at) {
      lines.push(`  ${pad('Mutex age', W)} ${fmtAge(ageMs(gateRunning.data.started_at))}`);
    }
  } else if (gateRunning.exists && gateRunning.error) {
    lines.push(`  ${pad('Mutex', W)} PRESENT (parse error)`);
  } else {
    lines.push(`  ${pad('Mutex', W)} (absent)`);
  }
  lines.push('');

  // --- Pause flag ---
  lines.push('--- Pause Flag ---');
  lines.push(`  ${pad('Status', W)} ${state.pauseFlag ? 'PRESENT' : '(absent)'}`);
  lines.push('');

  // --- Recent events ---
  lines.push('--- Recent Events ---');
  if (state.recentEvents.length === 0) {
    lines.push('  (no gate-relevant events found)');
  } else {
    for (const evt of state.recentEvents) {
      const type = evt.event || evt.type || 'unknown';
      const ts = evt.ts || evt.timestamp || '';
      const extra = evt.slice_id ? ` slice=${evt.slice_id}` : '';
      lines.push(`  ${ts}  ${type}${extra}`);
    }
  }
  lines.push('');

  // --- Anomalies ---
  lines.push('--- Anomalies ---');
  if (anomalies.length === 0) {
    lines.push('  None detected.');
  } else {
    for (const a of anomalies) {
      lines.push(`  [${a.severity}] ${a.message}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const state = collectState();
  const anomalies = detectAnomalies(state);
  const output = render(state, anomalies);
  process.stdout.write(output);
  process.exit(0);
}

// Export internals for testing
module.exports = { collectState, detectAnomalies, render, readJson, readText, fileExists, ageMs, STALE_THRESHOLD_MS };

// Run if invoked directly
if (require.main === module) {
  main();
}
