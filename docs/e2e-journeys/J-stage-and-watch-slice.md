---
id: J-stage-and-watch-slice
category: authoring-staging
status: draft
last_reviewed: 2026-05-08
---

# Stage a new slice and watch it in Ops

## What the user is trying to accomplish

O'Brien drafts a new slice (a unit of work with acceptance criteria), stages it into the queue via a CLI tool, and then opens the Ops Center dashboard to see the slice appear in the Staged panel, ready for Philipp's approval.

## Preconditions

- Ops Center is running on a local dashboard server (`dashboard/server.js`)
- Bridge is connected to a running orchestrator (`bridge/orchestrator.js`)
- O'Brien has a working idea for a new slice (goal, ACs, estimated hours)
- No other slices are currently IN_PROGRESS (clean state assumed)

## Steps

1. O'Brien runs `new-slice.js` from the repo root with the slice scope and title, piping the prompt body
2. The CLI outputs the new slice file path (e.g., `bridge/staged/123-STAGED.md`)
3. O'Brien opens the Ops Center dashboard in a browser (or refreshes if already open)
4. The dashboard polls `bridge/queue/` and `bridge/staged/` (or subscribes to watcher events)
5. The Staged panel updates to show the new slice in the lower group ("Staged — awaiting your approval")
6. The new slice row displays: slice ID, title, a count badge showing queue position
7. The Ops topology is unaffected (dev branch remains unchanged; no commits ahead yet)

## Expected outcomes

- Slice file exists at `bridge/staged/123-STAGED.md` with full frontmatter and body
- Slice appears in the Staged group of the Queue panel within ~1–2 seconds of staging
- Slice is clickable (row can be expanded to show full body, tabs for Slice body / Tags & deps)
- Approve button is ready (visible in the staged row's action group)
- No network errors or timeout warnings in the browser console
- Register contains no erroneous events for this slice yet (only happens on next user action)

## Known failure modes

- **Slice staging fails silently.** The orchestrator may be down or the `bridge/staged/` directory is write-protected. *Recovery:* Check `bridge/.run.pid` and verify orchestrator is running. Check file permissions on `bridge/staged/`. Re-run `new-slice.js`.
- **Dashboard does not refresh.** The server may not be watching the filesystem or events are not flowing. *Recovery:* Hard refresh the browser (`Cmd+Shift+R`). Check browser console for network errors. Verify `dashboard/server.js` is running and `events.jsonl` is being written to.
- **Slice appears but with truncated or malformed body.** The slice file may not have been fully written. *Recovery:* Check the file size of `bridge/staged/123-STAGED.md` and verify it contains the full frontmatter and body sections.

## Sources

- `docs/contracts/slice-lifecycle.md` — STAGED state definition and state transitions
- `docs/architecture/LIFECYCLE-NAMES-ADR.md` — canonical state names and file suffixes
- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — Ops UI: Queue panel, Staged group
- `scripts/new-slice.js` — actual CLI tool for slice creation
- `bridge/orchestrator.js` — watcher loop that polls filesystem and emits `COMMISSIONED` / `STAGED` events

## Open questions

- What is the latency guarantee from "slice file written" to "dashboard panel updates"? Is it synchronous event-driven or polling-based? The brief mentions `events.jsonl` subscription but doesn't specify if there's also a fallback file-watch or HTTP poll.
- When multiple slices are staged in rapid succession (e.g., O'Brien stages 5 slices), what is the ordering guarantee in the Staged panel? Is it file mtime, creation order, or alphabetical by ID?
- Does the dashboard persist scroll position / expansion state when the page auto-updates, or does it reset to the top?
