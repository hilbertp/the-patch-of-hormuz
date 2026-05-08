---
id: J-inspect-slice-history
category: observability
status: draft
last_reviewed: 2026-05-08
---

# Inspect a merged slice's history and artifacts

## What the user is trying to accomplish

A slice has been merged and is now in the History panel. Philipp wants to review what was done: the ACs, Rom's work, Nog's review, the diff, and the cost. Philipp clicks the slice in history to expand it and see the detailed artifacts.

## Preconditions

- A slice is in ARCHIVED state (merged and worktree pruned)
- The slice appears in the History panel with an `ACCEPTED` outcome badge
- The slice file exists at `bridge/queue/XXX-ARCHIVED.md` with all appended blocks
- The slice's diff is still accessible (branch may be deleted, but a snapshot or the merged commit is auditable)
- All artifacts are readable: Rom DONE report, Nog Review block, diff summary

## Steps

1. The History panel shows the archived slice as a compact row: ID, outcome badge (ACCEPTED), title, cost, duration
2. Philipp clicks the row to expand it
3. The chevron rotates 90° and the row expands to show four tabs: "Rom report", "Nog verdict", "Diff (N files)", "Slice body"
4. The default tab is "Slice body" — showing the original slice body (goal, ACs, scope)
5. Philipp clicks "Rom report" tab
6. The tab content shows the appended `## Rom DONE Report — Round N` block in monospace, scrollable if long
7. Philipp clicks "Nog verdict" tab
8. The tab content shows the appended `## Nog Review — Round N` block with the verdict and reason
9. Philipp clicks "Diff (38 files)" tab
10. The tab content shows a summary of changed files and a diff patch (first ~150 lines; full diff available if user scrolls or clicks "Open in editor")
11. Philipp clicks the "Open in editor" button in the expanded footer
12. The slice file is opened in the user's configured editor for further review

## Expected outcomes

- Slice row expands to show a detail block with 4 tabs
- Each tab has its own data source: frontmatter+body for "Slice body", appended block for "Rom report", appended block for "Nog verdict", git diff for "Diff"
- Tab switching is instant (no async load delay)
- If a tab has no data (e.g., "Rom report" for a slice that hasn't been worked yet), show an italic placeholder: "(no {tab_name} available)"
- Scroll behavior within each tab is independent (scrolling in one tab doesn't affect others)
- "Open in editor" button opens the file in the default editor defined in the system or the Ops Center config
- No network errors or timeouts

## Known failure modes

- **Tab data is missing or corrupted.** A DONE report block may be malformed or the diff may be inaccessible. *Recovery:* The per-tab fallback placeholder should prevent the entire detail view from breaking. If data is genuinely missing, that's a data-integrity issue (escalate to O'Brien).
- **Diff is huge and the tab freezes.** A slice may have touched 100+ files. *Recovery:* Limit the diff preview to the first N lines and provide a "View full diff in editor" button. Or lazy-load the diff on tab click.
- **"Open in editor" does nothing.** The editor config may be missing or the path may be invalid. *Recovery:* Check system editor config. Fall back to a "copy to clipboard" option if editor open fails.
- **Slice file is deleted or archived before the user opens the detail view.** The data sources may disappear. *Recovery:* This shouldn't happen (archived slices are not deleted); but if it does, the tab will show the fallback placeholder.

## Sources

- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — History panel, expanded detail, tabs, cost fallback
- `docs/contracts/slice-format.md` — DONE Report and Nog Review block formats
- `docs/contracts/slice-lifecycle.md` — ARCHIVED state definition
- `bridge/orchestrator.js` — diff extraction logic (git diff main...slice/<id>)

## Open questions

- Is the Diff tab a unified patch, a side-by-side view, or a textual summary? The spec says "Diff (N files)" but not the format.
- Does the "Slice body" tab show the frontmatter (with metadata like tokens_in, elapsed_ms) or just the narrative body sections?
- If Rom worked multiple rounds, which DONE Report is shown? The most recent (Round N)? Or a consolidated view of all rounds? Should Nog's feedback from earlier rounds be visible?
- Can Philipp export the history detail as a PDF or markdown for documentation?
