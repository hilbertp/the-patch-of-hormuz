---
id: "113"
title: "F-02 Amendment 2 — header service health: per-service status row"
goal: "Header shows a scannable per-service status row (Watcher · Bridge · Wormhole) with age and state for each, so Philipp can see at a glance which background services are up or stale without hovering."
from: kira
to: obrien
priority: high
created: "2026-04-15T00:00:00Z"
references: "106"
timeout_min: 20
status: STAGED
---

## Objective

Replace the single combined `online`/`offline` health pill with a three-service status row. The user needs to know whether each background service is running, without needing to know they exist or hover to find out.

The three services that run in the background:

| Service | What it does | How health is measured |
|---------|-------------|------------------------|
| **Watcher** | Orchestrates builds — polls queue, invokes O'Brien, runs Nog evaluator | `bridge/heartbeat.json` → field `ts`; stale > 30s, down > 60s |
| **Bridge** (server) | Serves this dashboard, proxies API calls | If this page loaded, it's up. No separate check needed. |
| **Wormhole** | Relay — writes files on behalf of Cowork/Claude sessions | `bridge/wormhole-heartbeat.json` → field `ts`; down > 300s |

## New design

Replace the current single pill in the header with a compact inline row:

```
● Watcher  12s ago   ●  Wormhole  2m ago
```

- Each service: `● Name  age` on one line, no hover required
- Dot colour: green (up), amber (stale), red (down / file missing)
- Age shown as `Xs ago` or `Xm Xs ago` — live, ticks every 5s
- Clicking the row (or hovering) expands a small tooltip with extra detail: last activity, processed total (watcher), last write path (wormhole)
- Bridge/server is excluded from the row — if the page is rendering, it's up

**Watcher thresholds:**
- `up` — heartbeat age < 30s (green)
- `stale` — 30s–60s (amber) — watcher may be slow or between polls
- `down` — > 60s or file missing (red)

**Wormhole thresholds:**
- `up` — last write age < 300s / 5 min (green)
- `stale` — 5–15 min (amber)
- `down` — > 15 min or file missing (red)

## Tasks

1. **Remove** the existing `.health-pill` element and all associated CSS (`.health-pill`, `.health-pill-dot`, `.health-pill-waveform`, `.health-pill-tooltip`, `.health-tooltip-*`).

2. **Add HTML** — replace pill with:
   ```html
   <div class="service-health" id="service-health">
     <span class="svc-item" id="svc-watcher">
       <span class="svc-dot" id="svc-watcher-dot"></span>
       <span class="svc-name">Watcher</span>
       <span class="svc-age" id="svc-watcher-age">—</span>
     </span>
     <span class="svc-sep">·</span>
     <span class="svc-item" id="svc-wormhole">
       <span class="svc-dot" id="svc-wormhole-dot"></span>
       <span class="svc-name">Wormhole</span>
       <span class="svc-age" id="svc-wormhole-age">—</span>
     </span>
   </div>
   ```

3. **Add CSS**:
   ```css
   .service-health { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #374151; }
   .svc-item { display: flex; align-items: center; gap: 4px; }
   .svc-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
   .svc-dot.up    { background: #16a34a; }
   .svc-dot.stale { background: #d97706; }
   .svc-dot.down  { background: #dc2626; }
   .svc-name { font-weight: 500; }
   .svc-age  { color: #6b7280; font-size: 11px; }
   .svc-sep  { color: #d1d5db; }
   ```

4. **Update `updateHealthPill()`** — rename to `updateServiceHealth()`, update the element IDs. For each service compute status and age string:
   ```js
   function fmtAge(s) {
     if (s == null || s < 0) return '—';
     if (s < 60) return `${Math.round(s)}s ago`;
     return `${Math.floor(s/60)}m ${Math.round(s%60)}s ago`;
   }
   ```
   Set `svc-watcher-dot` className to `svc-dot up|stale|down`, `svc-watcher-age` textContent to age string.
   Same for wormhole. If either service is down, set overall page title or add a `[!]` note.

5. **Update the `setInterval`** — keep 15s interval, rename to `updateServiceHealth`.

6. Commit on branch `slice/113-service-health-row`:
   ```
   fix(113): header service health — per-service status row replaces combined pill
   ```

## Constraints

- Touch `dashboard/lcars-dashboard.html` only (server `/api/health` endpoint already returns both services correctly).
- Do not add a third "Bridge" entry — bridge is self-evidently up if the page is rendering.
- Age must tick live (update every 5s client-side using cached `lastHealthData`).
- Must work when `wormhole-heartbeat.json` is absent (show `down`).

## Success Criteria

1. Header shows `● Watcher  Xs ago · ● Wormhole  Xm Xs ago` (or appropriate stale/down state) without any hover.
2. Watcher dot is green when `heartbeat.json` age < 30s, amber 30–60s, red > 60s or missing.
3. Wormhole dot is green when `wormhole-heartbeat.json` age < 300s, amber 300–900s, red > 900s or missing.
4. Ages update every 5 seconds without a server round-trip (compute from cached timestamps).
5. No `online`/`offline` combined label anywhere — each service speaks for itself.
6. Old health pill CSS/HTML fully removed.
