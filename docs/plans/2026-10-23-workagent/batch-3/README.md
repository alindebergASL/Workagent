# WorkAgent next batch 3 — research package

> Published research appendix. Read the [controlling parent implementation plan](../../2026-10-23-workagent-next-two-batches.md) first: it updates the baseline, Claude-branch coordination, full Batch 2 document-attachment scope, and current budget. This file is a proposal, not implemented behavior. Snapshot locators refer to the retained local research archive, not published full source pages.

**Planning only; implementation and new access/spend remain unapproved.** Prepared 2026-10-23.

## Read in order

1. [Implementation plan](implementation-plan.md) — full ambitious endpoint, useful first slice, build/reuse decisions, capability/permission separation, bounded compute, connector/OAuth lifecycle, inspectable memory, proposed schema/routes/migrations, owners and ordered tasks/tests.
2. [Evaluation plan](evaluation-plan.md) — varied real-work trajectories after approval, synthetic-only default, paired tool and memory baselines, hidden randomized/frozen oracles, privacy/spend gates, negative transfer and user-effort measurement.
3. [Verified code map](verified-code-map.md) — exact existing modules, symbols, routes, generation commands, tests and limitations; parent safety/lifecycle integration dependencies.
4. [Source evidence ledger](source-evidence-ledger.md) — primary sources, actual short quotes, evidence quality, retrieval limitations and bounded design inferences.

## Recommended first delivery

A scoped file/data/code workbench plus reviewed cross-assignment memory and exact-version provenance: do useful research/editorial/data/software work, revise after changed input, preserve human edits, export actual files, then transfer a reviewed preference/procedure to another assignment. Pilot public GitHub reads; private connectors and external writes require separate explicit approval. Keep WorkAgent authoritative; adapt selected Hermes/MCP components instead of embedding an unconstrained shell agent or rebuilding a connector marketplace.

## Findings worth preserving

- Current MCP documentation retrieved here identifies **2026-07-28**, including modern per-request compatibility semantics. Do not implement only from remembered 2025 initialization/session guidance. Recheck SDK support at implementation time.
- Existing WorkAgent capabilities are narrow but real. Literal context search is not durable learned memory; invoice CSV/Wasm/custom views are not a general spreadsheet/Python/browser workspace.
- Start memory with attributed, scoped, versioned records and correction/forget semantics. Compare against raw-history retrieval before paying the complexity cost of graph/vector services.
- MemoryArena and LifelongAgentBench support evaluating later action/transfer, not recall alone. Add scope leakage, negative transfer, forgotten-memory resurfacing, user review effort and latency/cost.
- Official dots and Meta Muse pages are documented experience targets only. No competitor account trial or parity claim.

## Evidence and validation files

- `sources/`: extracted primary pages; `NN-full.md` where the extractor returned a truncated view; `09-browser.md` is the successful public Meta page recovery.
- `source-evidence.json`, `snapshot-manifest.json`, `retrieval-index.json`: source metadata, exact quotes, hashes and raw retrieval returns.
- `upstream-versions.json`: unauthenticated public maintainer commit pins, not installed runtime versions.
- `code-snapshot.json`: per-file hashes and definition locations from read-only inspection; parent commits moved during research.
- `quote-verification.json`, `planning-validation.json`: 42 checked short quotes across 43 unique attempted primary URLs; 26 claimed existing regression-test paths confirmed; local document links/anchors checked. One productivity subpage was title-only and supports no substantive claim.
- `citations.json`: retrieval-tool citation index; its numeric IDs differ from stable `SNN` source IDs used by these documents.
- [Reusable research workflow](RESEARCH_WORKFLOW.md): lessons retained within the permitted research directory, not installed into another profile or the product.

## What was not done

No repository modification, product implementation/test run, model call, migration, live DB read/write, service start, commit/push, private account/connector access, message or external effect. The final read-only `git status --short` was empty at parent HEAD `d4d019c4b9bebca9ca8b49d1466a92fab7514aff`; this is not a claim that the parent did no work. Future migration numbers are proposed/unreserved and must be reconciled with the final safety/lifecycle batch.
