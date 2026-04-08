---
id: "021"
title: "Register-wired dashboard API"
from: obrien
to: kira
status: DONE
commission_id: "021"
branch: slice/12-register-api
created: "2026-04-09T13:30:00Z"
completed: "2026-04-09T14:00:00Z"
---

## Summary

All five tasks completed. Only `dashboard/server.js` was modified. Branch `slice/12-register-api` was cut from `slice/11-cors-host` (the referenced commission 020 branch) per amendment protocol.

## Changes made

**`dashboard/server.js`**

1. **`REGISTER` path constant** — added `path.join(REPO_ROOT, 'bridge', 'register.jsonl')`.
2. **`readRegister()`** — reads register.jsonl synchronously, splits on newlines, parses each line as JSON. Returns `[]` on missing file or any error.
3. **`recent` array** — built from all DONE/ERROR events in the register. Uses a `completedMap` keyed by commission ID so a later event overwrites an earlier one for the same ID. Sorted most-recent-first by `completedAt`, sliced to 10. Each entry: `{ id, title, outcome, durationMs, tokensIn, tokensOut, costUsd, completedAt }`.
4. **`economics` object** — accumulated from all DONE events: `{ totalTokensIn, totalTokensOut, totalCostUsd, totalCommissions }`. Token fields that are null in the register contribute 0.
5. **`goal` enrichment on `commissions`** — for each queue file, looks up `commissioned[id]?.goal` first, then falls back to `fm.goal` from the file frontmatter.
6. **Return shape** — `{ heartbeat, queue, commissions, recent, economics }`.

## Success criteria check

| Criterion | Status |
|---|---|
| `GET /api/bridge` includes `recent` array | ✓ (smoke-tested: 2 entries from register) |
| Each `recent` entry has id, title, outcome, durationMs, completedAt, token fields | ✓ |
| `GET /api/bridge` includes `economics` object with totals | ✓ |
| Each commission in `commissions` has `goal` field | ✓ (smoke-tested: populated from register) |
| Missing register.jsonl doesn't crash — returns empty recent and zero economics | ✓ (readRegister returns [] on error) |
| All existing response fields unchanged | ✓ |
| Changes committed on `slice/12-register-api` | ✓ (commit 6a6cb8d) |

## Notes

- Branch cut from `slice/11-cors-host` (commission 020), not from `main`, per amendment protocol.
- Token totals are 0 in the smoke test because existing register.jsonl entries have `tokensIn: null` / `tokensOut: null` — this is correct behaviour (null counts as 0 in the sum).
- `completedMap` uses last-wins per ID: if a commission has both DONE and ERROR events in the register, the later event wins. This is intentional — the final outcome is what matters.
