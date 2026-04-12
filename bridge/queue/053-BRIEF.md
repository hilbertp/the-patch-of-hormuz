---
id: "053"
title: "Rubicon details panel: markdown render + Read/Edit/Kira modes"
summary: "The Details expander in staged commission cards renders the body as formatted markdown by default, with a three-way mode toggle: Read (rendered), Edit (raw textarea, user submits directly), and Kira (user writes rough notes, Kira cleans up before queuing)."
goal: "Philipp can read commission bodies as formatted markdown, edit them directly and re-save, or jot rough amendment notes for Kira to rewrite."
from: kira
to: obrien
priority: high
created: "2026-04-11T00:00:00Z"
references: "042 047"
timeout_min: null
status: "PENDING"
---

## Backend change — dashboard/server.js

Add one new endpoint:

```
POST /api/bridge/staged/:id/update-body
Body: { body: string }
```

Reads the staged file `bridge/staged/:id-STAGED.md`, replaces the markdown body (everything after the closing `---` of the frontmatter) with the submitted body, and writes the file back. Returns `{ ok: true }` on success.

No queue move, no trash. This is a pure in-place edit of the staged file.

## Frontend changes — dashboard/lcars-dashboard.html

### 1. Add marked.js

In the `<head>`, add:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js"></script>
```

### 2. Details panel structure

Replace the current Details toggle + body with the following structure per staged card:

```html
<div class="staged-details-section" id="staged-details-section-{id}">
  <div class="staged-details-toolbar" style="display:none" id="staged-details-toolbar-{id}">
    <button class="staged-mode-btn active" id="staged-mode-read-{id}"  onclick="stagedSetMode('{id}','read')">Read</button>
    <button class="staged-mode-btn"        id="staged-mode-edit-{id}"  onclick="stagedSetMode('{id}','edit')">Edit</button>
    <button class="staged-mode-btn"        id="staged-mode-kira-{id}"  onclick="stagedSetMode('{id}','kira')">Ask Kira</button>
  </div>

  <!-- READ: rendered markdown -->
  <div class="staged-details-body staged-mode-read-body open" id="staged-details-read-{id}"></div>

  <!-- EDIT: raw textarea, direct submit -->
  <div class="staged-mode-edit-body" id="staged-details-edit-{id}" style="display:none">
    <textarea class="staged-edit-textarea" id="staged-edit-ta-{id}"></textarea>
    <div class="staged-edit-actions">
      <button class="staged-btn staged-btn-commission" onclick="stagedSubmitEdit('{id}')">Save</button>
      <button class="staged-btn staged-btn-cancel"     onclick="stagedSetMode('{id}','read')">Cancel</button>
    </div>
  </div>

  <!-- KIRA: rough notes → Kira rewrites -->
  <div class="staged-mode-kira-body" id="staged-details-kira-{id}" style="display:none">
    <textarea class="staged-edit-textarea staged-kira-textarea" id="staged-kira-ta-{id}" placeholder="Write rough notes — Kira will clean them up before sending to the queue…"></textarea>
    <div class="staged-edit-actions">
      <button class="staged-btn staged-btn-amend" onclick="stagedSubmitKira('{id}')">Send to Kira</button>
      <button class="staged-btn staged-btn-cancel" onclick="stagedSetMode('{id}','read')">Cancel</button>
    </div>
  </div>

  <button class="staged-details-toggle" onclick="stagedToggleDetails('{id}')" id="staged-details-btn-{id}">▶ Details</button>
</div>
```

The toolbar appears only when the details section is open. Default mode is always Read.

### 3. CSS additions

```css
/* Mode toolbar */
.staged-details-toolbar {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  margin-top: 8px;
}

.staged-mode-btn {
  background: none;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  padding: 2px 10px;
}

.staged-mode-btn.active {
  background: #111827;
  color: #ffffff;
  border-color: #111827;
}

/* Read: rendered markdown */
.staged-details-body {
  display: none;
  margin-top: 0;
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  color: #374151;
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
}

/* Basic markdown styles inside rendered body */
.staged-details-body h2 { font-size: 14px; font-weight: 600; margin: 12px 0 4px; }
.staged-details-body h3 { font-size: 13px; font-weight: 600; margin: 10px 0 4px; }
.staged-details-body p  { margin: 4px 0; }
.staged-details-body ul, .staged-details-body ol { margin: 4px 0 4px 16px; }
.staged-details-body li { margin: 2px 0; }
.staged-details-body code { background: #e5e7eb; border-radius: 3px; padding: 1px 4px; font-family: monospace; font-size: 12px; }
.staged-details-body pre { background: #e5e7eb; border-radius: 4px; padding: 8px; overflow-x: auto; }
.staged-details-body pre code { background: none; padding: 0; }
.staged-details-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 8px 0; }

/* Edit + Kira: raw textarea */
.staged-edit-textarea {
  width: 100%;
  min-height: 200px;
  font-family: monospace;
  font-size: 12px;
  color: #374151;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 8px;
  resize: vertical;
  background: #f9fafb;
  box-sizing: border-box;
  line-height: 1.5;
}

.staged-kira-textarea {
  font-family: system-ui, -apple-system, sans-serif;
  min-height: 100px;
}

.staged-edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
```

### 4. JS additions

```js
// Store raw body per id so Edit textarea always has the current content
const stagedBodyCache = {};

function stagedSetMode(id, mode) {
  const toolbar = document.getElementById('staged-details-toolbar-' + id);
  const readEl  = document.getElementById('staged-details-read-' + id);
  const editEl  = document.getElementById('staged-details-edit-' + id);
  const kiraEl  = document.getElementById('staged-details-kira-' + id);

  readEl.style.display = mode === 'read' ? '' : 'none';
  editEl.style.display = mode === 'edit' ? '' : 'none';
  kiraEl.style.display = mode === 'kira' ? '' : 'none';

  ['read','edit','kira'].forEach(m => {
    const btn = document.getElementById('staged-mode-' + m + '-' + id);
    if (btn) btn.classList.toggle('active', m === mode);
  });

  if (mode === 'edit') {
    const ta = document.getElementById('staged-edit-ta-' + id);
    if (ta) ta.value = stagedBodyCache[id] || '';
  }
  if (mode === 'kira') {
    const ta = document.getElementById('staged-kira-ta-' + id);
    if (ta) ta.value = '';
  }
}

function stagedToggleDetails(id) {
  const section = document.getElementById('staged-details-section-' + id);
  const toolbar = document.getElementById('staged-details-toolbar-' + id);
  const readEl  = document.getElementById('staged-details-read-' + id);
  const btn     = document.getElementById('staged-details-btn-' + id);
  const isOpen  = readEl.classList.contains('open');

  if (isOpen) {
    readEl.classList.remove('open');
    readEl.style.display = 'none';
    toolbar.style.display = 'none';
    // collapse edit/kira too
    stagedSetMode(id, 'read');
    if (btn) btn.innerHTML = '&#9656; Details';
  } else {
    readEl.classList.add('open');
    readEl.style.display = '';
    toolbar.style.display = '';
    stagedSetMode(id, 'read');
    if (btn) btn.innerHTML = '&#9662; Details';
  }
}

async function stagedSubmitEdit(id) {
  const ta = document.getElementById('staged-edit-ta-' + id);
  if (!ta) return;
  const body = ta.value;
  try {
    const res = await fetch('/api/bridge/staged/' + id + '/update-body', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      stagedBodyCache[id] = body;
      // re-render read view
      const readEl = document.getElementById('staged-details-read-' + id);
      if (readEl) readEl.innerHTML = marked.parse(body);
      stagedSetMode(id, 'read');
    }
  } catch (_) {}
}

async function stagedSubmitKira(id) {
  const ta = document.getElementById('staged-kira-ta-' + id);
  if (!ta || !ta.value.trim()) return;
  try {
    const res = await fetch('/api/bridge/staged/' + id + '/amend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: ta.value }),
    });
    if (res.ok) stagedSetMode(id, 'read');
  } catch (_) {}
}
```

### 5. renderStagedCards update

When building each card, populate the read view with rendered markdown and cache the raw body:

```js
stagedBodyCache[item.id] = item.body || '';
const readEl = document.getElementById('staged-details-read-' + eid);
if (readEl) readEl.innerHTML = marked.parse(item.body || '');
```

### 6. fetchStaged guard extension

Add textarea check so poll doesn't re-render while user is editing:

```js
if (document.querySelector('.staged-edit-textarea:focus')) return;
```

Add this alongside the existing guards in `fetchStaged()`.

## Success Criteria

- [ ] Details panel opens with rendered markdown by default (Read mode)
- [ ] Toolbar shows Read / Edit / Ask Kira buttons when details is open
- [ ] Edit mode shows raw monospace textarea pre-filled with commission body
- [ ] Saving in Edit mode calls POST /api/bridge/staged/:id/update-body and refreshes Read view
- [ ] Ask Kira mode shows a plain-text textarea for rough notes, Send calls existing amend endpoint
- [ ] fetchStaged does not re-render while any staged textarea is focused
- [ ] Details still auto-stays-open (existing guard still works)
- [ ] No changes to Commission / Reject flows
