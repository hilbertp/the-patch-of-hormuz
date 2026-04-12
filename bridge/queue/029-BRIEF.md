---
id: "029"
title: "Docker Compose: single-command startup"
goal: "A stranger can run docker compose up and see the dashboard in a browser with the relay running behind it."
from: kira
to: obrien
priority: high
created: "2026-04-09T03:15:00Z"
references: null
timeout_min: null
---

## Objective

Create a Dockerfile and docker-compose.yml so the entire system — relay watcher + dashboard server — starts with `docker compose up`. This is the Bet 2 entry point per Sisko's requirements. A developer who has never seen this repo should be able to clone, `docker compose up`, and see a live dashboard in their browser.

## Context

- Sisko's Bet 2 requirements: `.claude/roles/dax/HANDOFF-BET2-REQUIREMENTS.md`
  - Entry point: `git clone ... && cd ... && docker compose up`
  - Single command, no npm install, no manual process management
  - Local-only, no cloud services, no external accounts
- The relay watcher: `bridge/watcher.js` (Node.js, polls queue, invokes `claude -p`)
- The dashboard server: `dashboard/server.js` (Node.js, Express, serves API + static HTML)
- The dashboard HTML: `dashboard/lcars-dashboard.html`
- Config: `bridge/bridge.config.json`

## Tasks

1. Create `Dockerfile` at repo root:
   - Base image: `node:20-slim`
   - Copy `bridge/`, `dashboard/`, `package.json` (if any), and necessary config
   - Install dependencies (if any)
   - The container needs `claude` CLI available — mount it from host or document that the user needs Anthropic API key as env var
   - Expose port 4747 (dashboard)

2. Create `docker-compose.yml` at repo root:
   - Service `relay`: runs `node bridge/watcher.js`
   - Service `dashboard`: runs `node dashboard/server.js`
   - OR single service running both (simpler — they share the filesystem)
   - Volume mount: `./bridge:/app/bridge` so queue files are visible on host (files are the source of truth)
   - Volume mount: `./.claude:/app/.claude` so roles/config are accessible
   - Environment: `ANTHROPIC_API_KEY` from host env or `.env` file
   - Environment: `DASHBOARD_HOST=0.0.0.0`, `DASHBOARD_PORT=4747`
   - Port mapping: `4747:4747`
   - Print URL on startup: `http://localhost:4747`

3. Create `.env.example` with:
   ```
   ANTHROPIC_API_KEY=your-key-here
   ```

4. Handle the `claude -p` dependency:
   - The watcher invokes `claude -p` to run O'Brien. Inside Docker, the Claude CLI must be available.
   - Option A: Install `@anthropic-ai/claude-code` globally in the Dockerfile via npm
   - Option B: Document that the host must have `claude` and mount it in
   - Choose the simpler option. If `claude` is an npm package, install it. If it requires native auth, document the mount.

5. Test: `docker compose up` starts both services, dashboard is reachable at `http://localhost:4747`, heartbeat file is written, queue directory is watchable.

## Constraints

- The file queue (`bridge/queue/`) must remain on the host filesystem via volume mount. Files are the source of truth — they cannot live only inside the container.
- Do not modify `watcher.js` or `server.js` behavior. This commission is infrastructure wrapping only.
- Do not bundle the Lovable frontend — that's a separate service at its own URL.
- Keep it simple: one Dockerfile, one docker-compose.yml, minimal config.

## Success Criteria

- [ ] `Dockerfile` exists at repo root, builds successfully
- [ ] `docker-compose.yml` exists at repo root
- [ ] `.env.example` exists with `ANTHROPIC_API_KEY` placeholder
- [ ] `docker compose build` completes without errors
- [ ] `docker compose up` starts relay watcher + dashboard server
- [ ] Dashboard reachable at `http://localhost:4747`
- [ ] Queue directory is volume-mounted — files created on host appear in container and vice versa
- [ ] Heartbeat file written to `bridge/heartbeat.json` (visible on host)
- [ ] DONE report includes build + startup verification
