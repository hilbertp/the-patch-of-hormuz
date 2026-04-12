# Brief Watcher — Recurring Scheduled Task

*Always-on poll that detects when O'Brien finishes a brief and evaluates the report.*

---

## Architecture (v2 — replaced one-shot chain)

A single recurring Cowork scheduled task (`kira-brief-watch`) runs every 3 minutes. It:

1. Lists all `{ID}-DONE.md` and `{ID}-ERROR.md` files in `repo/bridge/queue/`
2. Cross-references against KIRA.md's accepted slices and fix briefs tables
3. If an unreviewed report exists → evaluates it against the original brief's success criteria
4. Presents the verdict to Sisko (the human) as a notification

The task is **always on**. Kira does not need to create, remember, or manage per-brief tasks. One task covers all briefs, past and future.

---

## Why v2 replaced v1

v1 used a one-shot chain: after writing each PENDING file, Kira had to manually create a `fireAt` task. If Kira forgot (which happened with brief 017), the feedback loop broke silently. The chain also required self-renewal — each task had to create the next one, adding fragility.

v2 is a single cron job. It can't be forgotten because it's always running. It handles any number of concurrent briefs. It self-terminates evaluation (skips already-reviewed IDs) without needing manual cancellation.

---

## Task ID

`kira-brief-watch` — one task, no per-brief variants.

Schedule: `*/3 * * * *` (every 3 minutes)

---

## Kira's workflow after briefing

After writing a `{ID}-PENDING.md` file to the queue:

1. **Commit the PENDING file to git** — this is critical. The evaluation task needs the original success criteria. If the PENDING file is never committed, the task can't evaluate against it. Run:
   ```
   git add bridge/queue/{ID}-PENDING.md
   git commit -m "brief({ID}): {short title}"
   ```
2. **That's it.** The recurring task will detect the DONE/ERROR file when O'Brien finishes and evaluate automatically.

---

## What the task does NOT do

- Does NOT write files, create commits, or modify the repo
- Does NOT merge branches or update KIRA.md
- Does NOT create new briefs or amend existing ones
- Does NOT create or manage other scheduled tasks

It only reads, evaluates, and reports. Sisko acts on the verdict.

---

## Disabling / pausing

If the project is inactive and you want to stop the 3-minute polls:

```
update_scheduled_task(taskId: "kira-brief-watch", enabled: false)
```

Re-enable when work resumes:

```
update_scheduled_task(taskId: "kira-brief-watch", enabled: true)
```

---

## Deprecated: v1 one-shot chain

The old `kira-watch-{ID}` tasks (e.g. `kira-watch-013`) are deprecated and disabled. Do not create new per-brief watcher tasks.
