'use strict';

/**
 * gate-telemetry.js — Single module that owns all gate-related metric emission.
 *
 * Imported by orchestrator and gate-mutex. No metric writes scattered across
 * call sites. All gate events flow through emit() → registerEvent().
 *
 * Slice 260 (W-Bash-C).
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Default register path — overridable via setRegisterPath() for testing.
let REGISTER_PATH = path.resolve(__dirname, '..', 'register.jsonl');

/**
 * Override the register file path (used by tests to isolate writes).
 */
function setRegisterPath(p) {
  REGISTER_PATH = p;
}

// ---------------------------------------------------------------------------
// Event catalogue — every gate event type must be listed here.
// ---------------------------------------------------------------------------

const VALID_EVENTS = new Set([
  'gate-mutex-acquired',
  'gate-mutex-released',
  'gate-mutex-orphan-recovered',
  'gate-deferred-squash',
  'gate-drain-completed',
  'gate-state-transition',
  'gate-state-reinitialized',
  'lock-cycle',
  // Ziyal §Gate states — UI-facing gate lifecycle events (slice 265+)
  'gate-start',
  'tests-updated',
  'regression-pass',
  'regression-fail',
  'merge-complete',
  'gate-abort',
  // Nog telemetry — side-effect of Nog's verdict (slice 270)
  'NOG_TELEMETRY',
]);

// ---------------------------------------------------------------------------
// Core emit
// ---------------------------------------------------------------------------

/**
 * emit(eventName, fields)
 *
 * Appends a structured JSON line to register.jsonl.
 * eventName must be one of VALID_EVENTS.
 * fields is a plain object merged into the entry.
 *
 * This is the ONLY function that writes gate telemetry to register.
 */
function emit(eventName, fields) {
  if (!VALID_EVENTS.has(eventName)) {
    throw new Error(`gate-telemetry: unknown event "${eventName}". Add it to VALID_EVENTS.`);
  }

  const entry = Object.assign(
    { ts: new Date().toISOString(), event: eventName },
    fields || {}
  );

  try {
    fs.appendFileSync(REGISTER_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Telemetry write failure must not crash the caller.
    // Swallow and continue — best-effort observability.
    try {
      process.stderr.write(`gate-telemetry: write failed: ${err.message}\n`);
    } catch (_) { /* truly nothing we can do */ }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { emit, setRegisterPath, VALID_EVENTS };
