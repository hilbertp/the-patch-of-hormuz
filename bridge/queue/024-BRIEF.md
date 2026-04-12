---
id: "024"
title: "Merge slices 12-14 to main"
goal: "All accepted backend slices will be on main and the watcher will be running the latest code."
from: kira
to: obrien
priority: high
created: "2026-04-09T15:00:00Z"
references: "023"
timeout_min: 5
---

## Objective

This is Kira, your delivery coordinator. Merge the accepted slice branches into main in sequence, then remind Philipp to restart the watcher.

## Tasks

1. Ensure you are on `main` and it is clean.
2. Merge `slice/12-register-api` into main: `git merge slice/12-register-api -m "merge: slice/12-register-api (commission 021 — register-wired API)"`
3. Merge `slice/13-reviewed-event` into main: `git merge slice/13-reviewed-event -m "merge: slice/13-reviewed-event (commission 022 — REVIEWED event)"`
4. Merge `slice/14-smart-timeout` into main: `git merge slice/14-smart-timeout -m "merge: slice/14-smart-timeout (commission 023 — smart timeout)"`
5. Confirm `git log --oneline -5` shows all three merges on main.

## Constraints

- Do not modify any files. Merges only.
- If any merge conflict arises, stop and report — do not resolve conflicts.
- Do not merge `slice/11-cors-host` — it was already merged.

## Success criteria

1. `main` contains commits from `slice/12-register-api`, `slice/13-reviewed-event`, and `slice/14-smart-timeout`.
2. No merge conflicts.
3. `git log --oneline -5` on main shows all three merge commits.
