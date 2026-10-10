# Flexible work #13 — live proof checkpoint (not integrated acceptance)

## Integration update (supersedes the frontend blocker below)

Claude's `878b6b867c3173e428d3744d8c53da92506b9152` is now integrated, preserving
his sole frontend ownership. Initial combined `pnpm check` (163 tests) and
production build pass. The new `scripts/verify_flexible_integration.py` has
exercised the real production UI/API/fresh PostgreSQL/continuous controlled
consumer through create/save/propose/accept and all-process restart/reopen.
`scripts/verify_flexible_product.mjs` exercises the actual retained live-model
calculator/table/custom-view in the production application, including scoped
refresh, trusted malformed-action refusal, CSV export, Home and phone rendering.
These pre-commit smoke results are not substituted for exact-candidate gates;
final exact-SHA results are reported on PR #9 with the published candidate.

Independent review found an acceptance-check conflict. Real-DB red regressions
confirmed failure at `guard_acceptance_evidence` before publication (earlier than
the reviewer's inferred publication gate). The runtime now explicitly rejects a
shape-only draft selected for supplied human CSV/Wasm checks before verification,
then continues or reaches the existing step limit. SQL and migrations are
unchanged. Tests cover both check types, no draft publication, idempotent replay,
and correction to executable work that passes the supplied checks without
claiming universal goal completion.

The paragraphs below retain the original checkpoint's exact evidence/history;
the earlier frontend blocker is resolved, not an outstanding request to Claude.

## Exact scope and review path

- Backend published on `hermes/flexible-work-13`: initial contract implementation `f2b747a11c68eec03ea3632dfffa55fb543ac028`; live-generation runtime `fffb69b3c3227d53a7137507b207face9d9b25d7` adds bridge instructions only.
- Existing frontend host/navigation ancestor: Claude's `9e278e43abadb3e4a462533476b809c0dbff87b7`. Claude remains the sole frontend owner; Hermes owns backend/runtime/integration.
- [Backend handoff](FLEXIBLE_VIEW_CONTRACT.md), generated `contracts/openapi.json` and `contracts/src/schema.d.ts`; coordination on [PR #9](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6090158598).
- This checkpoint adds reproducible evidence/harnesses and corrects the human-save prose path. It does not implement a second frontend or mark #13 complete.
- **No exact combined candidate exists yet.** Claude's published branch still contains the host but not the structured-table/custom-view renderers/adapter. `pnpm check` and `pnpm build` currently fail on expanded union handling in `ObservedOutput.tsx` and `OperationComposer.tsx`. The build compiles then fails TypeScript; this is not an environmental exception.

## Actual model-created work

All prompts concern fictional data. They entered ordinary conversations as natural-language messages with `operation:null`, through the existing authorized `gpt-6.1-sol` route. No task-name route, hardcoded application page, deterministic substitute for inference, or direct model save/approval was added.

1. **Rainwater calculator:** the model selected a reusable WASM tool. An independent Python integer oracle re-executed its exact saved code in fresh Wasmtime instances: **107 arithmetic cases passed**, plus **four invalid-domain rejections**. This establishes those bounded arithmetic results, not physical roof efficiency or universal tool correctness.
2. **Venue comparison:** the model created self-describing fields and four rows matching the supplied synthetic facts. Initially only Willow Hall qualified. A real human save raised its price from £250 to £350 and added the exact Marta note. The model then proposed a corrected comparison: no qualifying venue under unchanged requirements; suggested £50/£20 discounts without assuming either discount existed. It preserved field/row identities and human facts/note. A human explicitly accepted that proposal.
3. **Useful custom view of the second goal:** the model authored durable HTML/CSS/JS, a readable fallback and an exact-version declared `read_binding`. It reads the actual saved table via the broker, not copied venue values. Budget/capacity/accessibility controls recompute local matches; £300/70/step-free gives no matches, £350 gives Willow Hall and River Centre, and relaxing accessibility at £300 admits Station Loft. No control writes saved facts or books a venue.

Product state remains **partial / needs_validation**. Operator checks here do not change product verification status. The model's own assessments remain draft text; generated claims cannot establish independent verification.

## Persistence and boundary proof

- The human table revision was saved and read back before interrupting both owned API and consumer processes after final provider identity persistence but before result receipt. After restart, the exact human revision remained current. Recovery retrieved the existing response without another generation dispatch (six before/six after); the pending proposal was then explicitly accepted and reopened. Historical and other saved review services were untouched.
- The real saved custom source was mounted through Claude's unchanged `SandboxedView`, application CSS and response-header policy in an **isolated integration harness**. Authenticated broker calls happen outside the iframe; no bearer is delivered to generated code.
- **Ten host/lifecycle checks passed**: actual filtering, retained human note, real read-only refresh, undeclared approval refused before broker invocation, extra arbitrary-target payload rejected 422, parent DOM/storage blocked, phone fit, real human-save invalidation with 404, and exact-source/human-fallback-edit reopen with successful fresh-revision action.
- On stale refresh, the generated view keeps previously loaded data with an explicit red failure and “Previously loaded data only — refresh failed” summary. It does not pretend the refresh succeeded. An initial harness assertion incorrectly demanded clearing the cached rows; that run failed. Source/screenshot inspection established explicit retained-data disclosure; the corrected assertion tests the requested visible-failure semantics, and the rerun passed. Both save revisions remain in local immutable history.
- Claude's existing **nine real-Chromium sandbox regressions passed**: no network/resource requests, storage/cookies/parent DOM, top navigation, popups, dialogs, form submissions or downloads; bounded source/messages and allowed actions. This is Chromium coverage, not every browser engine or a hard CPU quota against hostile loops.
- Backend regressions cover membership revocation, restored membership with stale generation, missing/foreign/stale target equivalence, CAS, malformed actions, immutable history and DB rejection of forged “verified” publication. Those are real disposable-PostgreSQL tests, not inferred from the sandbox results.

## Ledger

`evidence/flexible-work-13/budget.json` retains the cumulative ledger summary and six carry-forward records. Before this generation, all source grants were frozen and **$3.42992** of historical reserved liability was carried, not reset.

At this checkpoint: **eight live dispatches**, zero unknown new usage steps; **$4.48528 cumulative reserved liability against the single $20 cap**. The latest live-generation conservative usage estimate is **$0.2369175**, not total historical spend and not provider billing. Historical reservations remain charged in full. No expiry or new project-wide stop was invented from generation limits.

## Evidence and replay

The [bundle](../../evidence/flexible-work-13/manifest.json) hashes allowlisted synthetic prompts, original/current revisions, generated source, independent checks, restart proof, budget summary and desktop/phone/stale screenshots. No credentials, DSNs, provider transport payloads or private environment files are published.

From the repository with backend dependencies installed:

```sh
backend/.venv/bin/python scripts/verify_flexible_evidence.py
```

This revalidates every retained file hash, canonical revision/body hashes, independently re-executes the WASM oracle cases, and checks original venue facts and preserved human edits. It makes zero provider calls. The fixture-specific expectations are test oracles, not product routes or renderer branches.

With the owned private proof API env loaded and frontend dependencies installed:

```sh
node scripts/verify_flexible_view.mjs 597739cf-363b-49ea-becb-decf484c452c .local/view-read-proof
```

Default mode is read-only; `--save-stale` is explicitly mutation-bearing and restricted to the owned loopback `flexible-proof` workspace. It saves a human fallback note, proves the old frame's action is refused, then reopens the exact saved revision. No source/data generation occurs.

## Gates and remaining work

- Initial exact backend `f2b747a`: **768 passed**, one dependency deprecation warning, on a fresh isolated database. Runtime bridge follow-up: **17 focused/isolation passed**. Canonical contract export, generated TS drift and contract typecheck pass on current bytes.
- Current frontend unit suite passes independently; **frontend aggregate and production build fail** as described above. Existing host sandbox and actual generated-source harness pass, but neither is a whole-product browser gate.
- A fresh full-backend attempt after this checkpoint's proof began but the foreground tool terminated at its execution timeout before completion. Its partial dots are **not PASS evidence**. The eventual exact combined candidate still needs the full fresh-DB gate; do not substitute earlier counts.
- Remaining engineering: consume Claude's new renderer/adapter commit; wire trusted status/actions and ordinary history/proposal/edit recovery; run backend/frontend/build/contracts/full browser gates against that exact combined SHA; obtain independent final review and reconcile the product/work/acceptance/build/runtime status documents to delivered behavior.
- Remaining usefulness/experience: computed filter matches are useful, but per-row assessment text still describes the original £300 threshold and can appear contradictory after raising the budget. It is labeled draft/derived, not recomputed evidence. Fields are verbose on phones, the fallback is long, and controls are local session state. These observations must inform integrated UX review rather than be hidden by green tests.
- Preserve #13 open. No default-branch merge or deployment is authorized or performed. This document is a reviewable checkpoint, **not milestone completion**.
