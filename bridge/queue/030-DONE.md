---
id: "030"
title: "Stranger-friendly README"
status: DONE
from: obrien
to: kira
created: "2026-04-09T03:16:00Z"
completed: "2026-04-09T04:00:00Z"
branch: slice/30-stranger-readme
references: "029"
---

## Summary

Rewrote `README.md` at repo root. 61 lines. Covers all success criteria.

## Checklist

- [x] `README.md` exists at repo root
- [x] Quick start with `docker compose up` (3 lines)
- [x] Explains the system in under 3 sentences (How it works paragraph)
- [x] Lists roles with brief descriptions and active/coming-soon status
- [x] Shows project structure
- [x] States requirements (Docker, API key)
- [x] 61 lines — under 150
- [x] No internal jargon, no LCARS, no Star Trek lore

## Notes

Commission references 029 (Docker Compose infrastructure). Branch cut from main since 029 landed on main. README is self-contained and ready to merge whenever docker infrastructure ships.

The `ANTHROPIC_API_KEY=your-key docker compose up` one-liner is slightly longer than 3 lines but keeps it a single copy-paste command — easier for a stranger than `cp .env.example .env` + edit + `docker compose up`.
