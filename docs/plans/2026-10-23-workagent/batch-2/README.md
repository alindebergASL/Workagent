# WorkAgent next batches — Batch 2 research handoff

> Published research appendix. Read the [controlling parent implementation plan](../../2026-10-23-workagent-next-two-batches.md) first: it updates the baseline, Claude-branch coordination, full Batch 2 document-attachment scope, and current budget. This file is a proposal, not implemented behavior. Snapshot locators refer to the retained local research archive, not published full source pages.

**Research/plan only. No implementation authority, installation or product-test pass is implied.** Prepared 2026-10-23 UTC from read-only inspection of `/home/ubuntu/workagent-general-review-20261022` and primary documentation. The parent was concurrently finishing its current candidate; use its final manifest as the implementation baseline.

## Read in this order

1. [PLAN.md](PLAN.md) — north-star experience, alternatives, architecture/state axes, attachments, events, control/review semantics, durable continuation and scope/cost boundaries.
2. [IMPLEMENTATION.md](IMPLEMENTATION.md) — proposed exact files/routes/schema work, staged tasks, test commands, first milestone and **35-row acceptance matrix**.
3. [CODE_MAP.md](CODE_MAP.md) — verified current code paths and limitations, with inspection line references.
4. [SOURCE_EVIDENCE.md](SOURCE_EVIDENCE.md) — primary quotes/URLs, claim-to-source map, retrieval limitations, and attributed fresh parent finding.

Supporting evidence:

- [repo-evidence-manifest.json](repo-evidence-manifest.json): inspected HEAD/dirty state, file hashes and later note-editor follow-up.
- [citation-ledger.json](citation-ledger.json): first-seen source registry.
- `sources/retrieval-index.json` (local sources/retrieval-index.json): 19 requests, 18 substantive extractions and one failed guessed URL retained honestly; recovered canonical background-session source included.
- [document-validation.json](document-validation.json): document integrity checks, citation/quote validation and acceptance-row enumeration. **Not product test output.**

## Recommended direction

Use a Textual conversational HTTP client, retain the operator CLI/journal, evolve the existing PostgreSQL runtime with authorized durable events/checkpoints, and use SSE plus polling fallback. Do not replace the domain/effect authority with Temporal, Hermes background threads or a second task board merely to make a new UI. Dots and Muse are documented experience targets, not verified benchmarks.

## First work and new live defect

- Begin with safe CLI/TUI proposal-review acknowledgement parity. Current operator acceptance payload lacks the flags; preserve format-1 exact replay and never fabricate consent. Fresh explicit review requires a new command.
- Add structured multiline note editing as a concrete first-milestone blocker. Parent's live case had **5 note objects / 17 displayed lines**; flattening intra-note newlines to continue is a workaround, **not PASS**. Claude owns the web fix; T3a/A35 specifies byte-preserving round-trip and cross-UI regression evidence.
- No product code, DB, running services, provider models or connectors were changed by this research. No current-candidate install claim was independently verified here.

## Ownership and next action

Hermes: backend/runtime/TUI/integration. Claude: sole web owner. No further subagent delegation was used.

**Next action after explicit batch activation:** T0 reconciles the parent's final candidate and handoff; T1 starts review-safe command parity. This document is the durable handoff; it does not imply an implementation worker is currently running.
