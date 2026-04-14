# Kira Advantage List (KAL)

Items surfaced between Kira and Philipp after the ruflo-benchmark-baseline branch was cut. Logged here for post-sprint comparison: did Ruflo independently surface any of these? This file lives on main only and is not present on ruflo-benchmark-baseline.

- **Wormhole scope gap:** Wormhole eliminates permission prompts for the Kira drain, but `/handoff-to-teammate` writes also trigger a prompt — one per file, every time any Cowork role hands off to another. Wormhole should cover handoffs too.
- **Skill rename:** `/wrap-up` implies end of session. The skill is now used mid-session to keep memory current. Renamed to `/housekeep-memory`.
- **Terminology rename:** "Brief" renamed to "Slice" everywhere — docs, code, UI. Risk flagged: the commission→brief rename earlier broke the pipeline. This one needs a two-phase approach: docs first, code + verification second.
- **Drain extensibility:** The autonomous self-activation pattern is built for Kira in Sprint 3 but should not be Kira-specific by design. Any role should be able to get a drain in a future sprint without architectural rework.
