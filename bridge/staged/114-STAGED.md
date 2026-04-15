---
id: "114"
title: "F-06 Amendment 2 — History panel: fixed height, pinned pagination footer"
goal: "History panel stays the same height on every page — 10 collapsed rows fit comfortably, pagination footer never moves regardless of how many entries are on the current page."
from: kira
to: obrien
priority: normal
created: "2026-04-15T00:00:00Z"
references: "112"
timeout_min: 20
status: "STAGED"
---

## Objective

Right now the history panel shrinks on any page with fewer than 10 entries (the last page, for example). The pagination footer jumps upward, the panel collapses, and the layout shifts. The panel must be a fixed height: sized to hold exactly 10 collapsed rows plus breathing room plus the pagination footer, which is pinned at the bottom of the panel at all times.

## Behaviour spec

- **Collapsed row height:** each `.history-row-main` is `padding: 8px 0` + 13px text + 1px border ≈ 34px. Use `36px` as the working height per row.
- **10 rows:** `10 × 36px = 360px` of row area.
- **Breathing room:** add `20px` of extra space above the pagination footer — rows should not butt right up against it.
- **Pagination footer:** `~44px` tall (existing `.history-pagination` with `padding: 10px 12px`).
- **Total row area height (fixed):** `360 + 20 = 380px`.
- **Full panel min-height** = top padding (20px) + section title + margin (≈ 29px) + row area (380px) + pagination footer (44px) + bottom padding (20px) ≈ **493px**. Use `min-height: 493px` on `.brief-history`.

When a row is **expanded**, the panel may grow beyond `min-height` — that is acceptable. The constant height constraint applies only to the collapsed (default) state.

## Implementation

### Structural change

Move `.history-pagination` **out of** `#history-list` and into `.brief-history` as a sibling below `#history-list`. Currently both live inside `#history-list`'s `innerHTML` — split them.

New DOM structure inside `.brief-history`:
```
.brief-history
  .section-title          ← unchanged
  #history-list           ← rows only, no pagination inside
  #history-pagination     ← new fixed element, always rendered
```

### CSS changes

```css
/* Panel: flex column, fixed minimum height */
.brief-history {
  /* existing: background, border, border-radius, padding, box-shadow */
  display: flex;
  flex-direction: column;
  min-height: 493px;
}

/* Row area: grows to fill available space, pushing footer to bottom */
.history-list {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Pagination: always present as a DOM element, hidden when totalPages <= 1 */
#history-pagination {
  margin-top: 4px;
  border-top: 1px solid #f3f4f6;
  padding: 10px 12px 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
}
#history-pagination.hidden { visibility: hidden; }
/* Remove the existing .history-pagination class entirely — replaced by #history-pagination */
```

### JS changes

1. **Extract `#history-pagination` from HTML** — add a permanent `<div id="history-pagination" class="hidden"></div>` to the static HTML (inside `.brief-history`, after `#history-list`). It is always present in the DOM.

2. **`renderHistoryPage()`** — write only the row HTML into `#history-list`. Write pagination controls into `#history-pagination` separately. When `totalPages <= 1`, add class `hidden` to `#history-pagination` (keeps space, hides content). Remove it when pagination is active.

   ```js
   function renderHistoryPage() {
     const listEl  = document.getElementById('history-list');
     const pageEl  = document.getElementById('history-pagination');
     if (!listEl || !pageEl) return;

     // ... (existing row building logic unchanged) ...
     listEl.innerHTML = rowsHtml;  // rows only

     // Pagination footer
     if (totalPages > 1) {
       pageEl.classList.remove('hidden');
       pageEl.innerHTML = `
         <button class="history-pg-btn" onclick="historyGoPage(${historyPage - 1})" ${newerDisabled ? 'disabled' : ''}>&#8592; newer</button>
         <span class="history-pg-info">page ${historyPage} of ${totalPages} &middot; ${total} entries</span>
         <button class="history-pg-btn" onclick="historyGoPage(${historyPage + 1})" ${olderDisabled ? 'disabled' : ''}>older &#8594;</button>
       `;
     } else {
       pageEl.classList.add('hidden');
       pageEl.innerHTML = '';
     }
   }
   ```

3. **Static HTML** — update `dashboard/lcars-dashboard.html` panel markup:
   ```html
   <div class="panel-history">
     <div class="brief-history" style="margin-bottom:0">
       <div class="section-title">History</div>
       <div class="history-list" id="history-list"></div>
       <div id="history-pagination" class="hidden"></div>
     </div>
   </div>
   ```

## Constraints

- Only `dashboard/lcars-dashboard.html` — no server changes.
- `min-height: 493px` is the target. If during implementation the row area measures differently, adjust to ensure exactly 10 rows + breathing room is visible without scrolling.
- Do not add `overflow: hidden` or `overflow: scroll` to `.history-list` — rows must be allowed to expand in place.
- `.history-row:last-child { border-bottom: none; }` rule must remain.
- Existing `.history-pg-btn` and `.history-pg-info` CSS stays. Remove `.history-pagination` CSS class (it is replaced by the `#history-pagination` ID element in static HTML).

## Success Criteria

1. Panel is the same height on page 1 (10 entries) and the last page (even 1 entry).
2. Pagination footer (`← newer · page N of M · X entries · older →`) is always at the same vertical position.
3. When `totalPages === 1`, the footer area is invisible but still occupies its space (no layout shift).
4. Expanding a history row makes the panel taller — it does not displace the footer upward.
5. No horizontal scrollbar introduced.
6. Committed on `slice/114-history-panel-fixed-height`.
