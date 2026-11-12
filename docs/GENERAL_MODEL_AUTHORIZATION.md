# Model spending — Workagent

Andrew's cumulative spending direction, November 5, 2026; model route updated by the November 12 B01 START. It replaces earlier versions of this file ([previous version](https://github.com/alindebergASL/Workagent/blob/2f3c5dd447bf92fb34978f8960333c6fe1d165ba/docs/GENERAL_MODEL_AUTHORIZATION.md)).

- **The ceiling is $275 in total.** That's everything committed or spent since testing began, not new money. The ledger in the database enforces it. Never reset it, refund uncertain amounts to free up room, or count an amount twice.
- **What the money is for:** Andrew's own use of the installed build, and the smallest live check needed to confirm that a fix works with a real model. Nothing else without Andrew asking. In particular: no evaluation cohorts, studies or batch campaigns.
- **Which model:** OpenRouter, default `typesafe/jev-router`, with explicit-model overrides for debugging/capability-specific calls. `typesafe/jev-1.14` is a separate structured Decisions API, not a chat model; no silent direct-TypeSafe calls. Additional providers still need approval. Every enabled inference path must use the existing accounting authority; disable unaccounted auxiliary calls, compaction, children and retries. Routing tiers are not monetary caps.
- **Execution ownership:** Parent Hermes owns accounting reconciliation and real paid calls. Reconcile actual headroom before paid use; authentication alone is not spending authority. Delegated coding/review workers have no paid-call authority. Product inputs remain synthetic-only. Dated observations belong in STATUS.
- **Before paid use,** read the current accounting. When headroom drops below $25, tell Andrew in one line: known usage, uncertain liabilities, what remains. Billed spend is separate from internal allocations; report it when it's known.
- **Development tools** (review agents, coding assistants) are outside the product ledger. Keep them modest, and mention them only if they become significant.
- **Unchanged rules:**
  - an uncertain request is never re-sent blindly;
  - historical usage and receipts are kept as they are.
