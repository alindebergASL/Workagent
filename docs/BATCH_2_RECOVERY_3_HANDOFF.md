# Batch 2 recovery 3 — web repair verified, Batch 2 incomplete

Task `t_762e2de6`. Workspace `/home/ubuntu/workagent-continuation-20261026`; branch `hermes/b2-conversational-client`; HEAD remains `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d` with intentional uncommitted integrated source. No commit, push, merge, deployment, service restart, database operation, dependency install or product-provider call occurred. Reserved parent checkout untouched. Successor `t_77ca6df4` owns exact-source integrated verification; its existing child `t_5f6349b3` owns subsequent journeys. This completes only the bounded web repair/review/build card, not A01–A35/P1–P8 or Batch 2.

## Source and ownership

- Verified historical `.local/web-before-correction`→`.local/web` correction was already integrated; no blind reapplication. Historical source comparisons are retained; the one differing TypeScript incremental build cache is not source.
- Claude Opus 5.5 was sole web implementer in fresh current-source snapshot `.local/recovery3/claude`, session `77bb3812-1b67-40fe-bbbc-3bba603ef4ed`. Every integration used scoped deltas and original/current-base equality; never copy this lane wholesale later.
- Sixteen web source/test files differ from this card's start. New files include `home-start.ts`, `resource-freshness.ts`, `b2-correction.test.ts`, and `post-message-types.test.ts`. Backend and contracts remain byte-identical to the card baseline. Canonical contracts were regenerated from current backend, then checked; no generated schema hand edits.
- `products.ts` and `real-api.ts` now consume generated **PostMessage-Input** request types. Derived OperationComposer typing recovers without a component edit. Removed obsolete unsafe document-ref cast. Current Input/Output schemas are structurally equal; the type assertions prove endpoint compatibility, not reference-name discrimination. In-memory original `PostMessage` substitution reproduces TS2339 without source mutation. Failed Output-mutation expectations are retained, not claimed green.

## Corrected review findings

Independent Astra combined review covered durable IndexedDB bytes, scope/restoration, unknown uploads, per-message refs, proxy/download boundaries, and latest checkpoint fencing. Material corrections were implemented by Claude; subsequent rereviews stayed on the corrected risks and reused unaffected findings.

- Exact upload command/request identity and immutable destination persist with each staged generation **before dispatch**. Unknown outcomes and lost receipt writes replay the same envelope. Legacy in-doubt/ref-only entries without destination/identity fail closed with explicit recovery.
- Home document-bearing create/upload/send continuation uses verified durable localStorage before every external step, including final send. A persistence failure does not silently dispatch a new unjournalled effect.
- Staged writes/removals are serialized; delayed earlier writes cannot resurrect a deleted generation or overwrite a newer receipt. Async staging captures its originating scope/epoch. Origin-only cleanup does not consult a different workspace's current document list.
- Failed/corrupt restoration blocks Send/Queue/hand-over, with reachable retry/discard/explicit-continue recovery. Pending Home starts with missing expected documents allow reattachment.
- Fresh Continue requires current canonical same-conversation/same-version snapshot and current checkpoint evidence. Resource evidence carries its actual key, so old-key evidence is ineligible even before effects reset state. Pending/failing refresh invalidates eligibility; legitimate successor runs need not have a new human request. Uncertain exact Continue replay stays separate.
- Home selection uses layout-effect reset and cleanup epoch invalidation, including empty/assignment-only destinations and unmount; late operations cannot replace another workspace's draft/error or navigate back.

Review history is preserved under `docs/evidence/batch2-recovery3/`: `review-first.md`, `review-reread.md`, `review-final.md`, `review-lifecycle.md`, and `review-adjudicated.md`. **Final disposition: PASS for the bounded combined source review, retaining unaffected conclusions.** The last apparent residual—unconditional `finally` release of the existing shared submitting lock—was independently adjudicated nonmaterial: both operation handlers reject another start while that lock is held, and releasing it changes no other draft/error/navigation. Guarding only the release would strand controls. This is a known cross-workspace waiting UX limitation, not a claim of mounted/browser proof.

## Actual final gates

All ran serially against the same final bytes, with source hashes checked before/after and again afterward. No TypeScript suppression or build bypass.

| Command | Result |
| --- | --- |
| `npm --prefix contracts run generate` | exit 0; canonical regeneration at start, outputs unchanged |
| `npm --prefix contracts run check` | exit 0; backend export, generated TS drift, alpha types and contract tsc |
| `npm --prefix web run typecheck` | exit 0 |
| `npm --prefix web test -- --maxWorkers=1 --reporter=default --reporter=junit --outputFile.junit=../docs/evidence/batch2-recovery3/final-tests.xml` | exit 0; **470 passed, 0 failed, 0 errors, 0 skipped**, independently counted from XML |
| `npm --prefix web run lint` | exit 0; zero-warning ESLint |
| `npm --prefix web run format:check` | exit 0 |
| `npm --prefix web run build -- --webpack` | exit 0; compiled, actual TypeScript phase completed, page generation and build traces finished |
| `git diff --check` | exit 0 |

Build environment: `NEXT_TELEMETRY_DISABLED=1`, `NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain`, `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1`. Build ID `ZEfTGZW7PafQj_asfgwNp`; build exists in `web/.next`, not served or deployed. Next.js 16.3.4, Node v22.22.2, npm12.0.2. Full commands, exit codes and durations: `final-results.json`; log `final-build.log` explicitly records actual TypeScript execution. Earlier 436-test baseline and first corrected 458-test gates remain as historical evidence, not final coverage.

Source hashes:

- `test-source-manifest.json`: 593 backend/contracts/web source/config/test files including intended untracked files; SHA-256 `54410baa2cfc12665748dd8a89b10382660411c53832e265cf1fbfe3b2ff8e6c`.
- `scoped-changes.json`: sixteen changed files, baseline and final hashes; SHA-256 `c153ee7a40f7ee47bb7384b3b5c476ee148ddfbeef6855afd4bd4c4090066465`.
- `final-results.json`: SHA-256 `a6311bdadd0e240d1c068f3ef97d9148fb83668cdae1e343a05a493e038dd693`.
- Additional repository candidate manifest and evidence index accompany this handoff. Historical RED logs and failed review reports were not erased. No code changed after final review/gates.

## Honest limits and successor instructions

Actual browser IndexedDB/localStorage persistence, close/reopen, quota/blocked storage, enabled recovery buttons, delayed navigation/scope switching, per-message document display, desktop1440/phone390/narrow320 and cross-client/PTY journeys remain downstream. Tests here use memory storage and wired controller/transition helpers, **not mounted React/browser storage**. No fresh API/PostgreSQL journey was run on this card. Reuse unchanged predecessor backend review evidence, but run the declared integrated campaign next. Old API18963 was not restarted or used as current proof.

Known boundaries: fixed local principal rather than general account switching; document-list pagination remains unchanged; explicit new-upload recovery may leave an unattached prior server document; continue-without-unreadable-documents is an explicit user choice retaining disk records; old ref-only staged entries need reconciliation. Home assignment hand-over's older async settlement path was not part of the document-start fix. Preserve these for downstream journey scrutiny instead of representing the entire UX as proven.

No task-owned Claude/Codex/build worker remains after final verification. Disk check:14GB available; no cleanup performed and shared dependency targets unchanged. Product budget remains cumulative100USD including historical liabilities; no paid product evaluation or model-authority change. Claude's final reported cumulative developer-tool list-price counter is5.649097399999997USD, not verified billing and not a product allocation. Astra via OpenAI Codex handled integration and independent review. Reusable QA lessons were submitted to the skill approval queue, not silently installed.
