# Intake next-action outcome UI: `4c36ede`

Frontend for the responsibility outcome in `handoffs/backend/INTAKE_CONTRACT.md`, built on the contract checkpoint `1c04566`. All runs were executed at `4c36ede` with a clean tree. **No provider calls, no transport, no credentials.** Fixture computation, plus one synthetic provider attempt for the unknown state.

Each screenshot comes in three widths: `-desktop` (1440), `-mobile` (390) and `-narrow` (320). `web/scripts/intake_evidence.py` produced them. It creates a fresh disposable PostgreSQL database, runs `web/scripts/intake-states.mjs`, restarts the API and web processes, then runs the reopen phase. The browser only reads; mutations go through the domain API, the fixture worker, and `web/scripts/intake_synthetic.py` (backend trusted seams).

| # | State | How it was produced | What the UI shows (checked on Agent, Spaces and the assignment) |
|---|---|---|---|
| 01–02 | `prepared` | fixture initial run | "Ready for review". "What review means" says the next action hasn't been carried out. |
| 03–04 | `decision_required` | human save, then a fixture revision against that exact base | "Decision needed" everywhere, including the artifact header. The decision card shows the bound `question.prompt` verbatim. |
| 05–06 | `readback_verified` | exact-base accept | "Approved revision · confirmed by reading it back". "What I checked" lists the document checks and states the next action itself was not carried out. |
| 07 | `waiting` / `consumer_unavailable` | operator grant plus a managed assignment (no transport installed) | "Agent not connected": "…isn't connected yet. Nothing has been sent." The server reason is under Details. |
| 08 | `outcome_unknown` | **synthetic** attempt: prepared, dispatched, then marked unknown (nothing sent) | "Waiting to confirm what happened". There is no retry or send control; "Check again" re-reads only. Provenance reads "Run origin not verified". |
| 09–10 | all of the above | — | Home and Spaces agree. The Home lede orients without urgency. |
| 11–12 | after API/web restart | `--reopen` phase | Same approved revision, still `readback_verified`. The unknown run is still unknown, and `run_ids` is unchanged (nothing was resent or readmitted). See `restart.json`. |

`state.json` holds the exact projected outcomes, and `real-demo/` holds the canonical `scripts/workagent.py demo` at the same commit (`dirty: false`, 9/9 fault regressions).

**Backend observation for Hermes.** The synthetic attempt was prepared with `evidence_origin='synthetic_provider_receipt'`. The assignment projection still reports the run's `execution.evidence_origin` as `unverified` (see `state.json` → `unknown_outcome.execution`). The UI shows exactly what is projected ("Run origin not verified"). If the projection should carry the attempt's bound origin, that is a backend change. The UI already maps `synthetic_provider_receipt` to "Synthetic test receipt · not a live run".
