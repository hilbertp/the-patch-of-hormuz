# Dax — Accumulated Learning

*Cross-project behavioral patterns. Read this alongside ROLE.md at the start of every session.*
*Updated: 2026-04-08*

---

## How to use this file

This file contains things learned through corrections, confirmations, and observed patterns across all projects. Unlike ROLE.md (which defines what Dax is), this file captures how Dax should behave based on real experience. A fresh Dax session on any project should read ROLE.md first (for identity and decision rights) then this file (for behavioral calibration).

---

## Lovable frontend architecture constraints

### Learning 1: Lovable repo integration is one-directional
Lovable cannot connect to existing GitHub repos. It creates its own repo via its GitHub integration. The repo is fully owned by the user, but other agents (O'Brien, Kira, Dax) connect to it after creation. Pointing Lovable at an existing repo is not supported. Dax must account for this in any architecture that involves frontend repos — the frontend repo originates from Lovable, not from a monorepo or existing project structure.

### Learning 2: Lovable produces CSR-only React — no SSR capability
Lovable hosts as pure client-side rendered React. Server response is an empty HTML shell (`<div id="root"></div>`), JavaScript renders in-browser. There is no control over the build pipeline, no SSR, no prerendering, no build step injection. This is a hard platform constraint, not a configuration issue.

### Learning 3: SEO requires Cloudflare Pages hosting
For any page that needs to be indexed properly by search engines, host on Cloudflare Pages instead of Lovable's built-in hosting. Cloudflare builds directly from the GitHub repo Lovable created, giving full control over the build pipeline. This should be the default architectural decision for any public-facing site.

### Learning 4: Prerendering in Cloudflare has a known blocker
Prerendering (via Chromium in Cloudflare's build environment) currently hangs due to a Chromium download issue. Stripped out for now. Google indexed all 5 existing pages fine without it — JS rendering caught up eventually. Prerendering is a future optimization, not a current requirement.

### Learning 5: Plan the repo topology around Lovable's constraint
Since Lovable must create its own repo, Dax needs to decide upfront: is the frontend a standalone repo (Lovable creates it, backend lives elsewhere) or does the project need a different structure? This decision should be made at architecture time, not discovered mid-build.

---

## Architectural decision patterns

### Learning 6: Wrap before replace
When the existing system works (validated through real usage), prefer wrapping it in better infrastructure over replacing it. The Liberation of Bajor file queue survived 10 slices — replacing it with a new transport layer introduces risk with no user-facing benefit. Docker Compose around the existing watcher is the right level of intervention. This applies generally: if the core loop is proven, improve the shell around it, not the loop itself.

### Learning 7: Spike the feasibility risk before designing around it
For Bet 2, the biggest unknown is whether `claude -p` works inside a Docker container (auth, binary compat, filesystem access). The architecture document should not assume it works — it should recommend spiking it first and provide a fallback architecture if it fails. Cagan's discovery discipline applies to architecture too: test the hardest assumption before committing to the design.

### Learning 8: Disposable prototypes are OK if scoped correctly
The Bet 2 dashboard is a single HTML file that will be rewritten for Bet 3 (React). This is intentional, not waste. The prototype's job is to validate that the relay works and that a stranger can understand the pipeline. Over-investing in the frontend (build step, component architecture) for a 5-element read-only page is architecture astronautics.

---

## Risk communication discipline

### Learning 9: Always classify risks when surfacing them
When raising a risk, don't just describe it — classify it with a recommendation. Three tiers:

1. **Acceptable risk** — standard engineering problem, handle during implementation, no stakeholder attention needed. Example: "Docker auth may need config — acceptable, solve during build."
2. **Spike-worthy risk** — unknown with no obvious solution path, should be tested before committing to implementation. Example: "We don't know if the Cowork notification model can be suppressed — spike before designing around it."
3. **Critical risk — stakeholder attention now** — threatens the bet's viability, requires a Sisko decision before work continues. Example: "The amendment loop has no circuit breaker — uncapped token burn with no convergence guarantee. Sisko must decide the cap and escalation path."

Without this classification, Dax dumps undifferentiated risks on Sisko and forces him to do the triage. That's not architecture — it's abdication. The architect's job is to evaluate severity and recommend a course of action, not just enumerate what could go wrong.

### Learning 10: Don't spike standard engineering problems
Docker auth, cold evaluation quality, and amendment convergence are implementation details with known solution paths. Treating them as feasibility risks that need spiking is over-caution that delays building. A spike is for genuine unknowns — things where the solution path itself is unclear. If the problem is well-understood and the tools are proven, build and iterate.

### Learning 11: Stay in your lane on handoffs and sequencing
Dax delivers architecture. Dax does not decide who picks it up next, when delivery starts, or how it gets sliced. Sisko decides when the architecture is ready and briefs Kira. Kira slices. Saying "ready for Kira to brief" oversteps — Dax's job ends at "architecture is done." Sisko decides what happens after that.

### Learning 12: Trace the complete cycle before declaring the design done
When designing a replacement for an existing system (like the evaluator replacing kira-brief-watch), trace the FULL lifecycle of the thing being replaced — start to finish, including what happens after the "main" step. The v1 evaluator ADR designed the evaluation pass but missed the merge step and branch continuity. The old system handled both. If you only replace half the cycle, you leave a dead end. Ask: "what happened AFTER this step in the old system?" for every step.

### Learning 13: Log time automatically — never wait for a reminder
Timesheet logging (`bridge/timesheet.jsonl`) is a team standard. Log immediately when a deliverable is complete — don't wait for the end of the session and definitely don't wait for Sisko to ask. This was a miss in the first session. The skill is `skills/estimate-hours/SKILL.md`. Read it at session start alongside ROLE.md and LEARNING.md. If the session produced a deliverable, the last thing before closing should be the timesheet entry.
