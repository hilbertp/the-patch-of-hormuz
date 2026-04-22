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
 *
 * Writes: bridge/staged/{id}-STAGED.md
 * Prints: the created file path, then the full file contents.
 */

const fs   = require('fs');
const path = require('path');
const { nextSliceId } = require('./orchestrator.js');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const QUEUE_DIR     = path.resolve(__dirname, 'queue');
const STAGED_DIR    = path.resolve(__dirname, 'staged');
const REGISTER_FILE = process.env.DS9_REGISTER_FILE || path.resolve(__dirname, 'register.jsonl');

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
    console.error('\nUsage: node bridge/new-slice.js --title "..." --goal "..." [--to rom|leeta] [--priority normal|high|critical] [--depends-on "095,096"] [--amendment "slice/095-fix"] [--timeout 20] [--body-file body.md]');
    process.exit(1);
  }

  // Assign ID, ensuring no collision with existing staged files
  fs.mkdirSync(STAGED_DIR, { recursive: true });
  fields.id = nextSliceId(QUEUE_DIR);
  while (fs.existsSync(path.join(STAGED_DIR, `${fields.id}-STAGED.md`))) {
    fields.id = String(parseInt(fields.id, 10) + 1).padStart(3, '0');
  }

  // Build file content
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
