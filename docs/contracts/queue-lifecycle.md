# Queue Lifecycle — Liberation of Bajor

*Contract version: 1.0*
*Source: PRD — Liberation of Bajor v2.1, §5.1, §5.4; Architecture v1.1*
*Author: Kira*
*Locked: 2026-04-06*

---

## Overview

The queue is a directory of markdown files at `bridge/queue/`. Each file represents one brief and moves through a defined lifecycle. State is visible as a filename suffix — anyone can inspect the queue by opening the directory in Finder.

---

## State machine

```
PENDING ──► IN_PROGRESS ──► DONE
                        └──► ERROR
```

| State | Filename | Meaning |
|---|---|---|
| `PENDING` | `{id}-PENDING.md` | Brief written by Kira, waiting to be picked up. |
| `IN_PROGRESS` | `{id}-IN_PROGRESS.md` | Watcher has picked it up; O'Brien is executing. |
| `DONE` | `{id}-DONE.md` | O'Brien finished and wrote a report. Kira can evaluate. |
| `ERROR` | `{id}-ERROR.md` | The `claude -p` invocation failed. Infrastructure broke. |

There is no backward transition. Once a file reaches DONE or ERROR, it is a permanent record and is not re-processed.

---

## Transitions

### PENDING → IN_PROGRESS

**Who:** The watcher.

**How:** `fs.renameSync(pendingPath, inProgressPath)` — atomic on APFS. Atomicity prevents double-pickup if the watcher is somehow restarted mid-poll.

**When:** The watcher polls the queue (default: every 5 seconds), finds the lowest-ID PENDING file, and renames it immediately before invoking O'Brien. FIFO ordering — the lowest ID is always processed first.

### IN_PROGRESS → DONE

**Who:** O'Brien writes `{id}-DONE.md`. The watcher then deletes `{id}-IN_PROGRESS.md`.

**How:** O'Brien writes the DONE file directly to the queue directory. The watcher verifies the file exists after O'Brien's process exits and removes the IN_PROGRESS file.

**When:** O'Brien completes execution (successfully or not) and exits. O'Brien always writes a DONE file, even for PARTIAL or BLOCKED outcomes.

### IN_PROGRESS → ERROR

**Who:** The watcher.

**How:** The watcher writes `{id}-ERROR.md` and removes `{id}-IN_PROGRESS.md`.

**When:** The `claude -p` invocation fails — non-zero exit code with no DONE file written, process timeout, or crash. The ERROR file contains: timestamp, exit code, stderr, stdout (if any), and the failure reason.

---

## DONE vs. ERROR distinction

This distinction is non-negotiable.

| | DONE | ERROR |
|---|---|---|
| **Written by** | O'Brien | Watcher |
| **Means** | O'Brien executed and produced a report | `claude -p` invocation failed |
| **Kira's action** | Evaluate the report | Diagnose infrastructure; O'Brien cannot self-report |
| **Status field** | `DONE`, `PARTIAL`, or `BLOCKED` | N/A (ERROR files are not brief reports) |

A DONE file with `status: PARTIAL` or `status: BLOCKED` is not an error — it means O'Brien ran, made progress (or didn't), and is reporting the situation. Kira evaluates and decides next steps.

An ERROR file means nobody evaluated anything — the invocation itself failed before O'Brien could run or report.

---

## ID assignment

Kira assigns IDs when writing new briefs. The rule:

1. Read the queue directory (including archive if maintained).
2. Find the highest existing numeric ID across all files in any state.
3. Increment by 1.
4. Zero-pad to three digits.

**Examples:** `001`, `002`, `003`, ..., `042`, `099`, `100`.

**No gaps are backfilled.** If brief `004` is deleted, the next brief is `005`, not `004`.

**Race conditions are acceptable in v1.** The watcher processes one brief at a time (sequential). If parallel processing is ever added (Layer 5), IDs should switch to timestamps or UUIDs.

---

## Crash recovery (v1)

On watcher startup, the watcher scans for orphaned state:

| Orphaned state found | Recovery action |
|---|---|
| `{id}-IN_PROGRESS.md` with neither DONE nor ERROR | Re-queue as PENDING (rename back to `{id}-PENDING.md`). |
| `{id}-IN_PROGRESS.md` with `{id}-DONE.md` present | Delete IN_PROGRESS. Brief is complete. |
| `{id}-IN_PROGRESS.md` with `{id}-ERROR.md` present | Delete IN_PROGRESS. Brief failed — Kira must evaluate. |

**Re-queuing risk:** Re-queuing a brief that already ran partway is accepted for v1. Briefs are code and file tasks, not side-effecting operations (no emails sent, no external APIs called). Running them twice is recoverable.

---

## What Kira polls for

After writing a brief with a known ID, Kira polls for:

- `{id}-DONE.md` — O'Brien's structured report
- `{id}-ERROR.md` — infrastructure failure

Kira polls **by known ID**, not by scanning for any new file in the directory. Scanning is weaker and risks racing with prior briefs that resolve late.

Optional hygiene: before polling for the report, Kira reads `bridge/heartbeat.json` to confirm the watcher is alive. The heartbeat file contains: timestamp, status (`idle`/`processing`), current brief ID, elapsed time, and total processed count.

---

## Queue and git

The queue directory is tracked in git. Every brief and report is a permanent record. Cleanup (moving files to `bridge/archive/`) is a manual or scripted operation — it does not happen automatically.

**Why:** Inspectability is non-negotiable. Philipp can reconstruct the full history of what was briefed, executed, and reported by reading the git log of `bridge/queue/`.
