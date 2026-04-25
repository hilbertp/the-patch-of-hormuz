'use strict';

/**
 * new-slice.js — Deterministic slice creator
 *
 * Creates a well-formed slice file in bridge/staged/ with all required
 * frontmatter fields guaranteed. O'Brien must use this to create slices —
 * never write frontmatter by hand.
 *
 * Usage:
 *   node bridge/new-slice.js \
 *     --title "F-12 — some feature" \
 *     --goal  "One sentence describing the outcome." \
 *     --priority normal|high|critical \
 *     [--to rom|leeta]         (default: rom) \
 *     [--depends-on "095,096"] (comma-separated IDs this slice depends on, informational only) \
 *     [--amendment "slice/095-fix-title"]  (exact branch name to reuse for amendment) \
 *     [--timeout 20]           (inactivity timeout in minutes, default: 20) \
 *     [--body-file /path/to/body.md]   (optional markdown body, or pipe via stdin)
 *     [--restage <id>]         (re-stage an existing slice under its original ID; see below)
 *
 * Re-staging (--restage <id>):
 *   Use --restage when a slice needs to be re-run under its original numeric ID rather
 *   than getting a new max+1 ID. This is the correct path after a PARKED or failed slice:
 *   it archives the prior queue artifacts to bridge/trash/ with .attempt<N> suffixes,
 *   renames the prior git branch to slice/<id>-attempt<N>, and writes a fresh STAGED file
 *   with the same ID. The round counter resets cleanly; the slice's identity is preserved.
 *   Do NOT use --restage for genuinely new slices — those get max+1 IDs automatically.
 *
 * Writes: bridge/staged/{id}-STAGED.md
 * Prints: the created file path, then the full file contents.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { nextSliceId } = require('./orchestrator.js');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const QUEUE_DIR     = process.env.DS9_QUEUE_DIR     || path.resolve(__dirname, 'queue');
const STAGED_DIR    = process.env.DS9_STAGED_DIR    || path.resolve(__dirname, 'staged');
const REGISTER_FILE = process.env.DS9_REGISTER_FILE || path.resolve(__dirname, 'register.jsonl');
const TRASH_DIR     = process.env.DS9_TRASH_DIR     || path.resolve(__dirname, 'trash');

// ---------------------------------------------------------------------------
// Required fields — must match orchestrator.js REQUIRED_FIELDS exactly
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ['id', 'title', 'from', 'to', 'priority', 'created'];

// ---------------------------------------------------------------------------
// Arg parsing — minimal, no external deps
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const name = key.slice(2);
      const val  = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[name] = val;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_PRIORITIES = ['normal', 'high', 'critical'];
const VALID_TO         = ['rom', 'leeta'];

function validate(fields) {
  const errors = [];
  if (!fields.title || !fields.title.trim())
    errors.push('--title is required and must be non-empty');
  if (!fields.goal || !fields.goal.trim())
    errors.push('--goal is required and must be non-empty');
  if (!VALID_PRIORITIES.includes(fields.priority))
    errors.push(`--priority must be one of: ${VALID_PRIORITIES.join(', ')} (got: ${fields.priority})`);
  if (!VALID_TO.includes(fields.to))
    errors.push(`--to must be one of: ${VALID_TO.join(', ')} (got: ${fields.to})`);
  return errors;
}

// ---------------------------------------------------------------------------
// Terminal states for queue-file archival
// ---------------------------------------------------------------------------

const TERMINAL_STATES = ['DONE', 'PARKED', 'ACCEPTED', 'ERROR', 'STUCK', 'NOG', 'ARCHIVED'];

// ---------------------------------------------------------------------------
// Restage helpers
// ---------------------------------------------------------------------------

/**
 * Compute the next attempt number for a given slice id.
 * Finds the highest .attempt<N> suffix among existing trash files for this id.
 */
function nextAttemptN(id) {
  let maxN = 0;
  try {
    const files = fs.readdirSync(TRASH_DIR);
    for (const f of files) {
      const m = f.match(new RegExp(`^${id}-.*\\.attempt(\\d+)$`));
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
  } catch (_) {}
  return maxN + 1;
}

/**
 * Validate that a restage target has prior history.
 * Checks: COMMISSIONED event in register, terminal files in queue, or files in trash.
 */
function hasPriorHistory(id) {
  // Check register for COMMISSIONED event
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.some(line => {
      try {
        const raw = JSON.parse(line);
        const sid = String(raw.slice_id || raw.id || '');
        return sid === id && raw.event === 'COMMISSIONED';
      } catch (_) { return false; }
    })) return true;
  } catch (_) {}

  // Check queue for terminal files
  try {
    const files = fs.readdirSync(QUEUE_DIR);
    if (files.some(f => {
      const m = f.match(/^(\d+)-([A-Z_]+)\.md$/);
      return m && m[1] === id && TERMINAL_STATES.includes(m[2]);
    })) return true;
  } catch (_) {}

  // Check trash for prior attempt files
  try {
    const files = fs.readdirSync(TRASH_DIR);
    if (files.some(f => f.startsWith(`${id}-`) && f.includes('.attempt'))) return true;
  } catch (_) {}

  return false;
}

/**
 * Validate that a restage target is not currently active.
 * Returns the active state string if active, or null if safe to restage.
 */
function findActiveState(id) {
  const activeStates = ['STAGED', 'IN_PROGRESS', 'QUEUED', 'PENDING', 'EVALUATING'];
  for (const state of activeStates) {
    if (fs.existsSync(path.join(STAGED_DIR, `${id}-STAGED.md`)) && state === 'STAGED')
      return 'STAGED';
    if (fs.existsSync(path.join(QUEUE_DIR, `${id}-${state}.md`)))
      return state;
  }
  return null;
}

/**
 * Archive terminal queue files for `id` to trash with .attempt<N> suffixes.
 * Returns the attempt number used.
 */
function archiveQueueFiles(id) {
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  const attemptN = nextAttemptN(id);

  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR);
  } catch (_) {
    return attemptN;
  }

  for (const f of files) {
    const m = f.match(/^(\d+)-([A-Z_]+)\.md$/);
    if (!m || m[1] !== id || !TERMINAL_STATES.includes(m[2])) continue;
    const src = path.join(QUEUE_DIR, f);
    const dst = path.join(TRASH_DIR, `${f}.attempt${attemptN}`);
    fs.renameSync(src, dst);
  }

  return attemptN;
}

/**
 * Rename git branch slice/<id> to slice/<id>-attempt<N>.
 * Fails silently (logs warning) if branch doesn't exist or rename fails.
 */
function renameGitBranch(id, attemptN) {
  const from = `slice/${id}`;
  const to   = `slice/${id}-attempt${attemptN}`;
  try {
    execSync(`git branch -m ${from} ${to}`, { stdio: 'pipe' });
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString().trim() : err.message;
    // Not an error if the branch simply doesn't exist
    if (!msg.includes('not found') && !msg.includes('no branch')) {
      console.warn(`WARNING: Could not rename branch ${from} → ${to}: ${msg}`);
    }
  }
}

/**
 * Strip `rounds:` and `round:` lines from the YAML frontmatter block of a body string.
 * Only removes lines within the opening --- ... --- block.
 */
function stripRoundsFields(body) {
  if (!body.startsWith('---')) return body;
  const endIdx = body.indexOf('\n---', 3);
  if (endIdx === -1) return body;

  const frontmatter = body.slice(0, endIdx + 4); // includes closing ---
  const rest        = body.slice(endIdx + 4);

  const cleaned = frontmatter
    .split('\n')
    .filter(line => !/^rounds?:/.test(line.trim()))
    .join('\n');

  return cleaned + rest;
}

// ---------------------------------------------------------------------------
// Frontmatter builder
// ---------------------------------------------------------------------------

function buildFrontmatter(fields) {
  const lines = ['---'];
  lines.push(`id: "${fields.id}"`);
  lines.push(`title: "${fields.title.replace(/"/g, '\\"')}"`);
  lines.push(`goal: "${fields.goal.replace(/"/g, '\\"')}"`);
  lines.push(`from: obrien`);
  lines.push(`to: ${fields.to}`);
  lines.push(`priority: ${fields.priority}`);
  lines.push(`created: "${fields.created}"`);
  if (fields.depends_on) lines.push(`depends_on: "${fields.depends_on}"`);
  if (fields.amendment) lines.push(`amendment: "${fields.amendment}"`);
  if (fields.timeout_min) lines.push(`timeout_min: ${fields.timeout_min}`);
  lines.push(`status: STAGED`);
  lines.push('---');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  // Defaults
  const to         = args.to       || 'rom';
  const priority   = args.priority || 'normal';
  const timeoutMin = args.timeout  ? parseInt(args.timeout, 10) : 20;

  // Collect body: --body-file or stdin
  let body = '';
  if (args['body-file']) {
    try {
      body = fs.readFileSync(args['body-file'], 'utf8').trim();
    } catch (err) {
      console.error(`ERROR: Could not read --body-file: ${err.message}`);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    try {
      body = fs.readFileSync('/dev/stdin', 'utf8').trim();
    } catch (_) {}
  }

  // Strip rounds:/round: from body frontmatter if body-file was provided
  if (args['body-file'] && body) {
    body = stripRoundsFields(body);
  }

  const fields = {
    title:      args.title      || '',
    goal:       args.goal       || '',
    to,
    priority,
    depends_on: args['depends-on'] || null,
    amendment:  args.amendment    || null,
    timeout_min: isNaN(timeoutMin) ? 20 : timeoutMin,
    created:    new Date().toISOString(),
  };

  // Validate
  const errors = validate(fields);
  if (errors.length > 0) {
    console.error('ERROR: Slice not created — validation failed:\n');
    errors.forEach(e => console.error(`  • ${e}`));
    console.error('\nUsage: node bridge/new-slice.js --title "..." --goal "..." [--to rom|leeta] [--priority normal|high|critical] [--depends-on "095,096"] [--amendment "slice/095-fix"] [--timeout 20] [--body-file body.md] [--restage <id>]');
    process.exit(1);
  }

  // --restage path
  if (args.restage) {
    const rawId = args.restage;
    if (!/^\d+$/.test(rawId)) {
      console.error(`ERROR: --restage <id>: id must be numeric digits (got: ${rawId})`);
      process.exit(1);
    }
    const id = String(parseInt(rawId, 10)).padStart(3, '0');

    // Validate: must not be currently active
    const activeState = findActiveState(id);
    if (activeState) {
      console.error(`ERROR: --restage ${id}: slice ${id} is currently active (state: ${activeState}); abort or wait`);
      process.exit(1);
    }

    // Validate: must have prior history
    if (!hasPriorHistory(id)) {
      console.error(`ERROR: --restage ${id}: no prior history for slice ${id}; use a normal stage instead`);
      process.exit(1);
    }

    // Archive prior queue artifacts
    const attemptN = archiveQueueFiles(id);

    // Rename prior git branch
    renameGitBranch(id, attemptN);

    fields.id = id;
  } else {
    // Normal path: assign ID, ensuring no collision with existing staged files
    fs.mkdirSync(STAGED_DIR, { recursive: true });
    fields.id = nextSliceId(QUEUE_DIR);
    while (fs.existsSync(path.join(STAGED_DIR, `${fields.id}-STAGED.md`))) {
      fields.id = String(parseInt(fields.id, 10) + 1).padStart(3, '0');
    }
  }

  // Build file content
  fs.mkdirSync(STAGED_DIR, { recursive: true });
  const frontmatter = buildFrontmatter(fields);
  const content = body
    ? `${frontmatter}\n\n${body}\n`
    : `${frontmatter}\n\n## Objective\n\n${fields.goal}\n\n## Tasks\n\n<!-- O'Brien: fill in tasks -->\n\n## Success criteria\n\n<!-- O'Brien: fill in ACs -->\n`;

  // Verify all required fields are present (self-check)
  const missingCheck = REQUIRED_FIELDS.filter(f => !content.includes(`${f}:`));
  if (missingCheck.length > 0) {
    console.error(`INTERNAL ERROR: Generated file is missing required fields: ${missingCheck.join(', ')}`);
    process.exit(2);
  }

  // Write
  const outPath = path.join(STAGED_DIR, `${fields.id}-STAGED.md`);
  fs.writeFileSync(outPath, content, 'utf8');

  // Emit RESTAGED if this ID already has a prior COMMISSIONED event in the register.
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    const hasPriorCommission = lines.some(line => {
      try {
        const raw = JSON.parse(line);
        const sid = String(raw.slice_id || raw.id || '');
        return sid === String(fields.id) && raw.event === 'COMMISSIONED';
      } catch (_) { return false; }
    });
    if (hasPriorCommission) {
      const entry = { ts: new Date().toISOString(), event: 'RESTAGED', slice_id: String(fields.id) };
      fs.appendFileSync(REGISTER_FILE, JSON.stringify(entry) + '\n');
    }
  } catch (_) {
    // Register absent or unreadable — first-ever staging, no RESTAGED needed.
  }

  console.log(`Created: ${outPath}`);
  console.log('');
  console.log(content);
}

main();
