# Verified WorkAgent code map for batch 3

> Published research appendix. Read the [controlling parent implementation plan](../../2026-10-23-workagent-next-two-batches.md) first: it updates the baseline, Claude-branch coordination, full Batch 2 document-attachment scope, and current budget. This file is a proposal, not implemented behavior. Snapshot locators refer to the retained local research archive, not published full source pages.

Read-only inspection on 2026-10-23. Repository: `/home/ubuntu/workagent-general-review-20261022`. This is a map of observed code, **not a claim tests passed in this research task**. No product code or database was executed or modified. The parent was concurrently committing safety work: observed HEADs included `9324205…`, `be87cc9…` and later `d4d019c4b9bebca9ca8b49d1466a92fab7514aff`. Per-file SHA-256/definition locations for the main inspection are in [code-snapshot.json](code-snapshot.json); reconcile final HEAD before implementation.

## Product and authority

| Existing path | Verified content | Batch 3 implication |
|---|---|---|
| `AGENTS.md:3–27` | Active build mode; Hermes backend/integration, Claude sole web owner; migration/retained-work protection and actual spending authority remain | Refactor freely where useful, but do not treat product ambition as spend/private-access permission |
| `docs/PRODUCT_CONTRACT.md:7–22,32–47` | General persistent work partner; ordinary Home conversation; tools are real; no domain-specific menu; scoped memory through #10; bounded continuing execution | Keep broad tools and memory attached to responsibility lifecycle, not new industry handlers |
| `docs/BUILD_PLAN.md:9–18,26–32` | Practical public retrieval/scoped files/computation; capability separate from permission; changed input/restart; memory/integration remain mission | Tool workspace is next useful mechanism, not a marketplace-first detour |
| `docs/EVIDENCE_CONTINUITY_DAY_WEEK_EVALUATION.md` | Prior live episode had real continuity but partial overall usefulness, unsafe earlier proposal choices and latency/review issues | Preserve regression evidence; do not declare batch-3 readiness from that one family |
| `STATUS.md` | Latest checkpoint plus extensive historical entries | Re-read final parent status; historical limits/checkpoint numbers are not current authorization |
| Public issue #10, snapshot `sources/11.md` | Persistent work/scoped recall/learning with inspectable corrections and seamless experience | Treat the issue as design direction, not implemented memory behavior |

## Runtime, tools and artifacts

| Existing path / symbol | Observed mechanism | Extension seam / guard |
|---|---|---|
| `backend/workagent/composition.py:195–231`, `descriptors`, `discovery` | Typed catalog: guidance, context/saved-work reads, JSON inspect, public fetch, replies, CSV/Wasm/publish; `email/calendar/web/shell/filesystem/accounts` explicitly unavailable | Generalize descriptors, preserve unavailable/permission distinction; never infer authority from discovery |
| `composition.py:171–184` | Legacy schema validators for immutable prepared requests | New registry version must not change hashes/validators on historical requests |
| `composition.py:280–287`, `HANDLERS`, `execute_read` | Explicit handler dispatch after capability checks; bounded result wrapper | Registry adapter sits behind existing run capability, not arbitrary tool-name execution |
| `contracts/alpha-capability-catalog.json` | Generated detailed schemas and stated current limits | Generated contract is evidence of declared implementation, not broad permission |
| `backend/workagent/local_operations.py` | Invoice-oriented CSV reconciliation with fixed required columns/Decimal semantics and bounded inputs | Do not relabel as general spreadsheet support; add generic data layer |
| `backend/workagent/wasm_tool.py:1–5,12–16,25–80` | Import-free Wasmtime, pinned engine `49.0.0`; 16,000-byte code, max eight integer args, 50,000 fuel, 1 MiB memory; i64→i64 interface; no WASI/host imports | Retain this small safe kernel; separate isolated Python profile, never in-process host fallback |
| `backend/workagent/public_retrieval.py:20–22,36–89,138–166` | Public HTTPS destination/address checks, DNS pinning, bounded text extraction; 262,144-byte body, 20,000-character text, three redirects | Reuse SSRF and extraction defenses; add search/snapshot provenance without bypassing them |
| `backend/workagent/products.py:188–225`, `_calculate_product` | `PublishArtifact` retains inert shape-checked draft; CSV/Wasm provide actual observations; existing artifact kind cannot silently change | General execution result must remain distinct from draft correctness |
| `products.py:227–261`, `execute_local_product` | Auth before execution, recheck exact operation/base before publish, readback of retained result | Model for sandbox/connector transaction split; no locks held across IO |
| `products.py:317,491,598,707` | General staging/completion, continuity materials and downloadable products | Add tool observations and binary exports through typed paths; preserve continuation behavior |
| `backend/workagent/product_models.py:69–114` | Bounded rectangular table; FileBody only `.csv/.wat/.txt`, exact UTF-8 hash and MIME agreement; CSV formula-injection check | Rich attachments do not already imply rich exports. Add typed blob representation for binaries |
| `contracts/message-attachments.json` | At most two current-message text attachments, total/file bound 200,000 bytes; UTF-8, exact retained content; many text/code extensions; executable=false | A `.py` upload is inert input, not permission to execute it |
| `backend/workagent/broker.py:8–27,43–79` | Assignment-bound capability; no free-form principal; exact selected source/assignment/artifact checks | Keep authoritative principal derivation in service, never model arguments |
| `backend/workagent/provider_attempts.py:22,70,82,99,143` | Grant configuration/revoke/admission/checks and provider-attempt lifecycle | Reuse generation/admission fences; connector grant distinct from model route grant |
| `backend/workagent/responses_ledger.py:42,338,383` | Reservation/event ledger, observations and summary | Add tool-cost categories under shared budget; don't reinterpret unknown costs or reservations |
| `backend/workagent/responses_worker.py:178–183,204–352,433` | Transport authorization, bounded worker/HTTP steps and cancel | New tools settle results under lifecycle cancel/restart fences |
| `backend/workagent/request_packing.py:62,114,165,196` | Metrics, context projection, selection preparation and final packing check | Typed memory gets an explicit sub-budget and still passes total request bounds |

## Existing context versus proposed memory

| Existing path / symbol | Verified scope | What it does not establish |
|---|---|---|
| `backend/workagent/work_context.py:52–85`, `index` | Frozen descriptors for explicitly permitted, same-owner, open, source-free conversations; responsibility runs disable this cross-conversation index; no unauthorized counts/titles | Not workspace-wide search; not durable learned facts; not cross-project edit authority |
| `work_context.py:95–121`, `search` | Literal Unicode word overlap; bounded excerpts; exact revision/content descriptors; correction-priority instruction | Not semantic search, calibrated truth resolution or automatic preference extraction |
| `work_context.py:124–138`, `validate_consumed` | Reauthorizes retained search hits against current permitted conversations and exact descriptors | A memory service must extend this fence to source ACLs, supersession, expiry and forget |
| `backend/migrations/029_work_context_search.sql:10–90` | Database-side validation binds source descriptors, excerpts, run, selected decision and frozen grant; rejects responsibility search and source-bearing conversations | A Python policy check alone is not the entire existing security boundary |
| `backend/workagent/evidence_context.py:11–19,22–73` | Same-conversation attachments/sources/pending evidence, exact hashes and current ACL recheck; bounded bodies; explicit untrusted/omission notice | Evidence availability is not acceptance, authority or permanent memory |
| `backend/workagent/saved_work.py`, `index`, `discover`, `revalidate_reads` | Exact offered revisions and bounded discovery; read before editing | New file/memory recall must not turn arbitrary IDs into edit targets |
| `backend/workagent/skill_catalog.py` | Reviewed installed skills with exact version/hash loading | Skills are guidance, not grants; no unreviewed agent self-installation implied |
| `backend/workagent/conversation_context.py` | Bounded conversation context | Compact context is not evidence that learning or cross-assignment transfer works |

## Generated views and interface boundaries

- `backend/workagent/flexible_work.py:14–39`: `_view_bindings` checks generation, exact current revision/body hash, same owner conversation, source dependencies and bounded body size. Only document/structured table data is exposed.
- `flexible_work.py:41–66`: `invoke_view_action` resolves the action target from saved declarations, revalidates exact view/binding/generation in a transaction and returns a bounded read response. It is not arbitrary backend action authority.
- `web/src/lib/sandbox.ts:12–35`: iframe sandbox is `allow-scripts`, **not** `allow-same-origin`; CSP denies network/forms/frames/objects and allows inline display assets. This is a generated-view boundary, not a compute or logged-in-browser sandbox.
- `web/src/components/SandboxedView.tsx`: host-controlled message channel and frame. Keep connector credentials and memory mutation outside it.
- `web/src/components/FlexibleWork.tsx`: existing generated/flexible artifact presentation. New tool/file/memory surfaces should compose with the stable shell.
- `web/src/lib/client/api.ts`, `web/src/lib/client/real-api.ts`, `web/src/lib/client/products.ts`: actual client API integration paths. There is no current `web/src/lib/api.ts` at the inspected checkout.
- `backend/workagent/operator_tui.py`, `backend/workagent/prompt_cli.py`: existing operator/CLI entrypoints to reconcile with the conversational TUI/lifecycle batch. Do not build new memory affordances only in an operator tool.
- `backend/workagent/proposal_review.py`: parent safety/review code added during this inspection. Reconcile final implementation and tests; batch 3 must not bypass its human-edit and candidate-review decisions.

## Existing routes and contract generation

Observed in `backend/workagent/api.py`:

- `:147`: `GET /v1/workspaces/{workspace_id}/conversations/{conversation_id}/work-context`.
- `:151–165`: list/create/get/promote work areas.
- `:173–195`: conversations, message posting, cancel and delegation.
- `:197–227`: assignment creation/control and responsibility activate/update/control/read.
- `:233–246`: artifact/revision read, observation readback and text product download with `Content-Disposition`, `nosniff` and `X-Content-SHA256`.
- `:248–269`: history, view actions, proposals, human save, request revision and proposal acceptance.

**Actual generator:** `backend/export_contracts.py:23–43` writes `contracts/*.json`; `contracts/package.json:7–8` defines `npm run generate` and `npm run check`, producing `contracts/src/schema.d.ts` and alpha types. These are the existing paths to extend. No guessed `backend/tools/openapi.py` or existing `test_openapi.py` is relied on.

`web/package.json` supplies `typecheck`, `lint`, `test` (Vitest), and `test:e2e` (Playwright). Future verification uses those scripts under Claude's ownership.

## Existing regression tests to preserve

These named files were confirmed present; their assertions were not executed here:

- `backend/tests/test_proposal_review.py`, `test_proposal_review_pg.py`, `test_proposal_review_parent.py`, `test_proposal_review_findings.py` — parent safety/review surface, reconcile final contents.
- `test_sustained_continuity.py`, `test_repeated_responsibility_continuation.py`, `test_responsibilities.py` — lifecycle/continuation regression surface.
- `test_saved_work_retrieval.py`, `test_work_context_search.py`, `test_evidence_continuity.py`, `test_evidence_continuity_guards.py` — authorized retained context, correction behavior and reauthorization.
- `test_public_retrieval_followthrough.py`, `test_local_work_capabilities.py`, `test_json_inspection_runtime.py`, `test_text_attachments.py`, `test_text_attachment_journey.py` — current narrow tool behavior.
- `test_cancelled_response_receipts.py`, `test_cancelled_response_observation.py`, `test_settled_turn_recovery.py` — late/cancelled observations and recovery.
- `test_ledger_summary_projection.py`, `test_budget_summary_aggregation.py`, `test_alpha_budget.py`, `test_budget_carryforward.py` — honest accounting and aggregate capacity.
- `test_request_packing.py`, `test_request_packing_runtime.py`, `test_responses_migrations.py` — bounded context and retained-state/schema behavior.

`test_work_context_search.py:39–63` demonstrates a synthetic corrected-preference retrieval/reopen test and verifies no edit authority; `:66–82` excludes unauthorized metadata; `:85–100` changes revision/correction/membership/grant before another paid operation. These are good patterns to extend, not live proof of a learned memory system.

## Migration and scope warnings

The inspected migration chain ended at `046_cancelled_receipt_terminalization.sql`. The plan's 047–049 are **proposed, unreserved**; parent/lifecycle work can consume those numbers. Do not overwrite or repurpose an existing migration.

The checkout changed under the parent while this research ran. Paths, symbols and per-file hashes establish what was inspected, but no claim is made that every item belonged to one immutable tree or matches the installed private runtime. A final implementation owner must freeze the integrated baseline before code changes. This research did not access live database contents, auth secrets, private user accounts or installed runtime state.
