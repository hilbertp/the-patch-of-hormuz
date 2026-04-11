---
id: "053"
title: "Rubicon details panel: markdown render + Read/Edit/Kira modes"
from: obrien
to: kira
status: DONE
commission_id: "053"
branch: slice/42-stakeholder-review-gate
completed: "2026-04-11T01:00:00Z"
---

## What I did

Implemented the three-mode details panel for staged commission cards: Read (rendered markdown), Edit (raw textarea with direct save), and Ask Kira (rough notes sent for rewrite). Added a new server endpoint for in-place body edits.

## What succeeded

- **Backend**: Added `POST /api/bridge/staged/:id/update-body` endpoint that reads the staged file, replaces the markdown body (everything after frontmatter closing `---`), and writes back. Returns `{ ok: true }`.
- **marked.js**: Added CDN script tag for `marked@9.1.6` in `<head>`.
- **Details panel structure**: Replaced the old toggle+body with a section containing: toggle button, mode toolbar (Read/Edit/Ask Kira), rendered read view, edit textarea with Save/Cancel, kira textarea with Send to Kira/Cancel.
- **CSS**: Replaced monospace raw-text styling with rendered markdown styles (headings, lists, code blocks, pre, hr). Added `.staged-mode-btn` toolbar styles, `.staged-edit-textarea` and `.staged-kira-textarea` styles, `.staged-edit-actions` flex row.
- **JS — `stagedBodyCache`**: Raw body cached per ID on render so Edit textarea always has current content.
- **JS — `stagedSetMode(id, mode)`**: Toggles visibility of read/edit/kira panels, toggles active class on toolbar buttons, pre-fills edit textarea from cache, clears kira textarea on open.
- **JS — `stagedToggleDetails(id)`**: Opens/closes the entire details section including toolbar; resets to Read mode on close.
- **JS — `stagedSubmitEdit(id)`**: POSTs new body to `/api/bridge/staged/:id/update-body`, updates cache and re-renders read view on success.
- **JS — `stagedSubmitKira(id)`**: POSTs rough notes to existing `/api/bridge/staged/:id/amend` endpoint.
- **JS — `renderStagedCards`**: After building HTML, loops through items to populate `stagedBodyCache` and render markdown into read views via `marked.parse()`.
- **fetchStaged guard**: Added `.staged-edit-textarea:focus` check so polling doesn't re-render while user is editing.
- Details auto-stays-open guard (existing `.staged-details-body.open` check) still works.
- Commission / Amend / Reject flows unchanged.

## What failed

Nothing.
