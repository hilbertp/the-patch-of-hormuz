# Liberation of Bajor

A local file queue where AI agents coordinate autonomously — one writes commissions, a watcher picks them up, another executes them, a third reviews the result.

## Quick start

```bash
git clone https://github.com/hilbertp/liberation-of-bajor
cd liberation-of-bajor
ANTHROPIC_API_KEY=your-key docker compose up
```

Open `http://localhost:4747`.

## What you'll see

A dashboard showing the pipeline in real time:

- **Roles** — which agents are connected (Kira, O'Brien) and which are coming soon
- **Active commission** — what's in flight, which role owns it, how long it's been there
- **Queue** — pending commissions waiting to be picked up
- **Recent completions** — last few finished commissions with outcomes (DONE / AMENDED / ERROR)
- **System health** — relay status, last heartbeat

## How it works

Kira (delivery coordinator) writes a commission file to `bridge/queue/`. A watcher process detects the new file and invokes O'Brien (implementor) via `claude -p`. O'Brien executes the commission and writes a structured report back to the queue. An evaluator reviews the output and either accepts it or sends an amendment. The entire loop runs without human intervention. Files on disk are the source of truth — no database, no message broker.

## Roles

| Role | Description | Status |
|---|---|---|
| Kira | Delivery coordinator — writes commissions, evaluates reports | Active |
| O'Brien | Implementor — executes commissions via Claude Code CLI | Active |
| Dax | Architect — designs systems, answers hard technical questions | Active |
| Sisko | Product manager — defines priorities and success criteria | Active |
| Ziyal | Designer — UI/UX, dashboards, visual specs | Active |
| Nog | Code reviewer | Coming soon |
| Bashir | QA / testing | Coming soon |

## Project structure

```
bridge/
  queue/          # Commission and report files (the live state machine)
  staged/         # Staging area for Philipp's commission review (Rubicon)
  register.jsonl  # Append-only event log (watcher + evaluator)
  watcher.js      # Detects new commissions, invokes O'Brien
  bridge.config.json
dashboard/        # Web UI served on port 4747
.claude/
  roles/          # Per-role instructions and handoff files
  CLAUDE.md       # O'Brien's anchor file
```

## Requirements

- Docker and Docker Compose
- Anthropic API key (set as `ANTHROPIC_API_KEY`)

## Contributing

Contributions are welcome. Open an issue to discuss what you'd like to add before sending a PR.
