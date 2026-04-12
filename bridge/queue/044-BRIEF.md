---
id: "044"
title: "Fix: staged panel Amend input closes immediately"
summary: "The Amend button opens a browser prompt() which auto-closes on some browsers. Replace it with an inline text input that stays open until you submit."
goal: "The Amend flow in the staged commissions panel works reliably — inline text input, stays open, submits on button click."
from: kira
to: obrien
priority: high
created: "2026-04-10T00:45:00Z"
references: "042"
timeout_min: null
status: "PENDING"
---

## Problem

The staged panel's Amend button uses `window.prompt()` to capture Philipp's note. `prompt()` auto-closes on some browsers and is unreliable. The commission spec said "browser prompt() is fine for now" — it isn't.

## Fix

In `dashboard/lcars-dashboard.html`, replace the `prompt()` call in the Amend handler with an inline input that renders inside the card.

### Behavior

When Philipp clicks **Amend**:
1. Hide the three buttons
2. Show inline below the summary:
   ```
   [text input: "What should change?"]  [Submit]  [Cancel]
   ```
3. Input is focused automatically
4. **Submit**: POST `/api/bridge/staged/{id}/amend` with `{ note: inputValue }`, then refresh the card to show NEEDS_AMENDMENT state
5. **Cancel**: hide the input, show the buttons again
6. Submit is disabled if input is empty

### Reject inline confirm

While here: also replace `window.confirm()` on the Reject button with an inline confirmation:
```
Are you sure?  [Yes, reject]  [Cancel]
```
Same pattern — hide buttons, show inline confirm, restore on cancel.

## Constraints

- Only touch the staged panel JS in `dashboard/lcars-dashboard.html`
- No other changes

## Success Criteria

- [ ] Amend click shows inline text input inside the card, does not use prompt()
- [ ] Input stays open until Submit or Cancel is clicked
- [ ] Submit posts the note and updates card to NEEDS_AMENDMENT state
- [ ] Cancel restores the original buttons
- [ ] Reject uses inline confirmation, not window.confirm()
- [ ] Empty note cannot be submitted
