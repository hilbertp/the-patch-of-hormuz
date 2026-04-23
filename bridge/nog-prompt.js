'use strict';

/**
 * nog-prompt.js
 *
 * Builds the prompt string passed to Nog via `claude -p` for code review.
 * Nog reviews O'Brien's work against the slice's acceptance criteria,
 * runs linting checks, and evaluates code quality per ROLE.md.
 */

/**
 * buildNogPrompt({ id, round, sliceFileContents, doneReportContents, gitDiff, slicePath })
 *
 * @param {Object} opts
 * @param {string} opts.id              - Slice ID
 * @param {number} opts.round           - Current review round (1–5)
 * @param {string} opts.sliceFileContents - Full contents of the slice file (including any prior Nog reviews)
 * @param {string} opts.doneReportContents - O'Brien's DONE report contents
 * @param {string} opts.gitDiff         - Output of `git diff main...{branch}`
 * @param {string} opts.slicePath       - Absolute path to the slice file (for Nog to append review)
 * @returns {string} The complete prompt for Nog
 */
function buildNogPrompt({ id, round, sliceFileContents, doneReportContents, gitDiff, slicePath }) {
  return [
    'You are Nog, Code Reviewer for the DS9 pipeline.',
    'Read your role definition at: .claude/roles/nog/ROLE.md',
    '',
    `You are reviewing slice ${id} — round ${round}.`,
    '',
    'Slice file (includes original brief and any prior review rounds):',
    sliceFileContents,
    '',
    "O'Brien's DONE report:",
    doneReportContents,
    '',
    `Git diff (main...branch):`,
    gitDiff,
    '',
    'Perform your review per ROLE.md. Then:',
    `1. Append your review section to the slice file at: ${slicePath}`,
    `2. Write your verdict to: bridge/queue/${id}-NOG.md`,
    '   Format: YAML frontmatter with one of the following `verdict` values, plus a one-line `summary`:',
    '     verdict: ACCEPTED  — all ACs met, quality bar cleared, nothing to fix',
    '     verdict: REJECTED  — one or more ACs unmet or quality issues found; rework needed',
    '     verdict: ESCALATE  — ACs are contradictory, impossible, or require scope change; needs O\'Brien',
    '     verdict: OVERSIZED — diff too large or scope exceeded; slice must be split before review',
    '',
    'Do not modify any code. Read only. Write only to the two files above.',
  ].join('\n');
}

module.exports = { buildNogPrompt };
