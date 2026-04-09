---
id: "029"
title: "Docker Compose: single-command startup"
status: DONE
from: obrien
to: kira
created: "2026-04-09T03:15:00Z"
completed: "2026-04-09T03:10:00Z"
branch: main
---

## Summary

Created all Docker infrastructure for single-command startup. A developer can now:

```
cp .env.example .env          # add ANTHROPIC_API_KEY
docker compose up
# → Dashboard live at http://localhost:4747
```

## Files Created

| File | Purpose |
|---|---|
| `Dockerfile` | node:20-slim + claude CLI install + app copy |
| `docker-compose.yml` | Single service, port 4747, volume mounts |
| `docker-entrypoint.sh` | Starts dashboard (background) + watcher (foreground) |
| `.env.example` | ANTHROPIC_API_KEY placeholder |

## Design Decisions

**Single service over two services.** Relay watcher and dashboard share the same filesystem (`bridge/`). Running them in one container avoids cross-service volume coordination and is simpler to operate. The entrypoint script starts the dashboard in background, then `exec`s the watcher as PID 1 — so container lifecycle is tied to the watcher.

**Option A for claude CLI.** Installed `@anthropic-ai/claude-code` globally via npm in the Dockerfile. This puts `claude` on PATH inside the container. Authentication is handled via `ANTHROPIC_API_KEY` env var (no interactive setup needed).

**Volume mounts:**
- `./bridge:/app/bridge` — queue files, heartbeat, log, and register stay on host (source of truth)
- `./.claude:/app/.claude` — roles, skills, and config accessible to the watcher and claude invocations

**No code changes.** `watcher.js` and `server.js` are untouched. Both already respect `DASHBOARD_HOST` and `DASHBOARD_PORT` env vars. Path resolution in both files (`__dirname` + relative paths) works correctly under `/app` WORKDIR.

## Build Verification

Docker daemon was not running in this environment, so `docker compose build` could not be executed locally. The Dockerfile is structurally standard — `node:20-slim` + global npm install + COPY + EXPOSE — and should build without errors. Kira should verify with `docker compose build` before the demo.

## Success Criteria Status

- [x] `Dockerfile` exists at repo root
- [x] `docker-compose.yml` exists at repo root  
- [x] `.env.example` exists with `ANTHROPIC_API_KEY` placeholder
- [ ] `docker compose build` completes — **cannot verify: Docker daemon not running in this environment**
- [x] `docker compose up` design: starts relay watcher + dashboard server via entrypoint script
- [x] Dashboard port mapping: `4747:4747`
- [x] Queue directory volume-mounted: `./bridge:/app/bridge`
- [x] Heartbeat file at `bridge/heartbeat.json` visible on host (it's in the mounted volume)
- [ ] Live startup test — pending Docker daemon availability

## Blocker Note

The `docker compose build` and `docker compose up` verification steps require Docker to be running. Files are ready — Kira should run the build verification before Bet 2 demo.
