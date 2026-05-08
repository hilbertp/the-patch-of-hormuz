---
id: J-watch-slice-live-log
category: observability
status: draft
last_reviewed: 2026-05-08
---

# Watch a slice's live log while Rom is implementing

## What the user is trying to accomplish

Rom is actively implementing a slice (IN_PROGRESS state). Philipp wants to check on progress, opens the Ops Center, and sees Rom's live log output (stdout/stderr from the `claude -p` invocation) streaming in the Active Build panel.

## Preconditions

- A slice is in IN_PROGRESS state (Rom is actively working)
- Rom's `claude -p` invocation has write access to a live-log file or event stream
- The Ops Center dashboard is open and subscribed to events
- At least a few seconds of log output have been written

## Steps

1. Rom is implementing slice 250, `claude -p` is running, and log lines are being written
2. The orchestrator or Rom's invocation writes log lines to a file (e.g., `bridge/logs/slice-250.log`) or emits `log-output` events to `bridge/events.jsonl`
3. Philipp opens the Ops Center dashboard or refreshes it
4. The Active Build panel shows the slice's title and description
5. The "View live log" button is present in the build-foot action group
6. Philipp clicks "View live log"
7. A modal or side panel opens, showing the streaming log output (last ~100 lines or a scrollable transcript)
8. New log lines appear in real-time as Rom's process writes them
9. The log updates at a reasonable latency (sub-second if log events are used; polling if file-based)
10. Philipp can scroll up to see older log lines (if the log is truncated, show a "scroll up for more" indicator)

## Expected outcomes

- Live log modal opens and displays recent log output
- New lines appear in real-time (or ~1s delay if file-polling)
- Log text is monospace, readable, with line numbers if helpful
- Close button (✕) is visible; pressing Escape also closes the modal
- If Rom's process hangs or crashes, the log stops updating (not an error state, expected behavior)
- Logs are persisted to disk (retained for post-mortem if Rom fails; archived if successful)
- No network errors or timeout warnings in the browser console

## Known failure modes

- **View live log button does not appear.** The orchestrator may not have wired the log-output path, or the template is missing the button. *Recovery:* Check that Rom's invocation writes log lines somewhere the orchestrator can find them.
- **Log modal opens but shows no content.** The log file may be empty or the orchestrator hasn't started streaming yet. *Recovery:* Wait a few seconds; Rom may still be initializing. If still empty after 10s, check that Rom's process is actually running (check `ps aux`).
- **Log updates are laggy or don't refresh.** The file-polling interval may be too long (e.g., 5s). *Recovery:* Increase polling frequency. If using events, verify `events.jsonl` is being written atomically and not getting corrupted.
- **Log contains interleaved stdout/stderr out of order.** Rom's output may not be synchronized. *Recovery:* This is a known limitation of subprocess output capture; expected behavior if Rom does multi-threaded logging. Sufficient for observability purposes.

## Sources

- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — Active Build panel, "View live log" button
- `bridge/orchestrator.js` — log capture and event emission for IN_PROGRESS slices
- `bridge/events.jsonl` — log-output event format (if event-driven)
- `bridge/logs/` directory (if file-based)

## Open questions

- Is the live log stored per-slice per-round, or accumulated across all rounds? If Rom reworks in Round 2, does the Round 1 log disappear or persist in history?
- Does the live log include environment variables or command-line arguments (e.g., the `claude -p` invocation itself), or only stdout/stderr?
- If Rom's log output exceeds a size limit (e.g., 10MB), does the oldest content get truncated, or is the entire log persisted and the modal just shows the tail?
- Can Philipp download the log transcript, or is it view-only?
