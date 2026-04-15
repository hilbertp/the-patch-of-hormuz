---
id: "112"
title: "F-06 Amendment — History panel: remove server cap + paginate to 200"
goal: "History panel shows all completed slices (up to 200), paginated 10 per page with ← newer · page N of M · X entries · older → controls."
from: kira
to: obrien
priority: high
created: "2026-04-15T00:00:00Z"
references: "101"
timeout_min: 20
status: "STAGED"
---

## Objective

The History panel currently caps results at 10 server-side and 20 client-side. With 68+ completed slices this means Philipp sees only the most recent 9–10 entries. Remove both caps and add pagination so the full history is navigable.

## Context

Spec: `.claude/roles/kira/inbox/ops-dashboard-spec.md` §History Panel. The spec says "newest first" with no entry limit — the cap was an unintentional default that was never removed.

**Current state:**
- `dashboard/server.js` line 235: `.slice(0, 10)` — only 10 entries leave the server
- `dashboard/lcars-dashboard.html` `renderHistoryPanel`: `.slice(0, 20)` — secondary cap

**Both are already fixed in commit `86fae9c`.** This slice formalises and verifies that fix.

## Tasks

1. **Verify `dashboard/server.js`**: confirm `.slice(0, 200)` is in place (not `.slice(0, 10)`). No other server changes needed.

2. **Verify `dashboard/lcars-dashboard.html`**: confirm `renderHistoryPanel` no longer slices to 20. Confirm pagination variables `historyPage`, `HISTORY_PAGE_SIZE = 10`, `cachedHistoryAllRows` are present.

3. **Pagination controls** (already implemented — verify):
   - 10 rows per page
   - Controls at bottom of `#history-list`: `← newer · page N of M · X entries · older →`
   - `historyGoPage(page)` clamps to valid range
   - Page resets to 1 when `renderHistoryPanel` is called with new data (i.e., on re-fetch the page stays if still valid, no jarring jump)
   - Expanded rows (`historyExpandedSet`) survive a page change within the same fetch cycle

4. **Restart instruction**: the server process must be restarted to pick up the `.slice(0, 200)` change. Add a comment in the DONE report confirming restart is required.

5. Commit on branch `slice/112-history-pagination`:
   ```
   fix(112): history panel — remove server cap, paginate to 200
   ```

## Constraints

- `HISTORY_PAGE_SIZE` stays 10 — balances density and scrollability.
- Pagination controls only render when `totalPages > 1`.
- No URL state — page resets on hard reload, which is acceptable.
- Touch `dashboard/server.js` and `dashboard/lcars-dashboard.html` only.

## Success Criteria

1. `/api/bridge` returns up to 200 history entries (verified: `.slice(0, 200)` in server.js).
2. History panel shows 10 rows on page 1, with `← newer · page N of M · X entries · older →` controls visible when there are more than 10 entries.
3. Navigating pages works correctly — older → advances, newer ← goes back.
4. Expanding a row on page 2 works (expand state persists through `historyExpandedSet`).
5. With 68 completed slices: page 1 of 7, 68 entries shown in controls.
6. Server must be restarted for the cap fix to take effect.
