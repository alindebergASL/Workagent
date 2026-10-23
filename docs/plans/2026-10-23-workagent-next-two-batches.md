# WorkAgent next two batches — Implementation Plan

> **For Hermes:** When implementation is activated, use the subagent-driven-development skill, with Hermes owning integration/backend/runtime and the existing Claude owner owning web. Use one risk-proportionate independent review per coherent release, not a new committee for every small task.

**Goal:** Make WorkAgent a useful persistent general-purpose work partner: give it unfamiliar work in either terminal or browser, change direction, leave, return to useful results and clear decisions, and have relevant lessons improve subsequent assignments.

**Architecture:** One application-owned runtime, authority model, artifact history and durable responsibility store behind both clients. A conversational Textual client consumes the same HTTP commands and durable events as the browser. Reusable tools and scoped memory extend this runtime rather than creating a second agent or a menu of domain-specific workflows.

**Tech stack:** Existing Python/FastAPI/PostgreSQL and Next.js/React; proposed Textual client, HTTP + SSE, isolated attachment parsing/code execution, selected Hermes/MCP adapters. Dependency versions, sandbox implementation and migration numbers are pinned during implementation, not assumed from these plans.

**Status:** PROPOSED implementation; research and planning complete. No Batch 2/3 implementation, new connector consent, migration, paid trial or deployment is claimed. Parent synthesis of two research packages plus the completed live evaluation, 2026-10-23 UTC.

---

## Read this first

This is the controlling sequence and scope. The detailed research plans below supply code maps, design alternatives, tests and implementation steps. If they differ on attachment scope, starting baseline, ownership, approval cadence or migration numbering, **this synthesis takes precedence**.

- [Batch 2 architecture and detailed behavior](2026-10-23-workagent/batch-2/PLAN.md)
- [Batch 2 task/file/test plan and 35 acceptance cases](2026-10-23-workagent/batch-2/IMPLEMENTATION.md)
- [Batch 2 source evidence](2026-10-23-workagent/batch-2/SOURCE_EVIDENCE.md)
- [Batch 3 task/file/schema/adapter plan](2026-10-23-workagent/batch-3/implementation-plan.md)
- [Batch 3 varied-work and longitudinal evaluation](2026-10-23-workagent/batch-3/evaluation-plan.md)
- [Batch 3 source evidence](2026-10-23-workagent/batch-3/source-evidence-ledger.md)
- [Parent verification of research/code snapshots](2026-10-23-workagent/parent-validation.json)
- [Completed current batch, including failures](../GENERAL_PROPOSAL_REVIEW_BATCH_EVALUATION.md)

The research considers official runtime/UI/protocol/security documentation, maintained implementations, primary memory/agent research and documented competitor experiences. Parent independently checked 60 quoted passages across the two packages and their code manifests. Additional parser documentation informs the expanded attachment slice. Quotes being present is provenance verification, not proof that a proposed architecture works. Raw extractions remain in `/home/ubuntu/workagent-next-batches/`; published ledgers retain source URLs, quotations and local snapshot locators rather than redistributing full third-party pages.

## 1. Product outcome, not a feature-count race

The target experience has four connected parts:

1. **Conversation:** start ordinary work without IDs, workflow forms or a prepared fixture; attach material, clarify, steer, review and accept in either UI.
2. **Ownership over time:** show what the agent owns, what it is doing, why it stopped and what will happen next; survive closed clients and worker recreation without silently abandoning the objective.
3. **Useful work:** research, calculate, transform files, produce editable/downloadable artifacts, inspect code/data and use scoped connected services when authorized.
4. **Learning across work:** carry relevant facts, preferences and proven procedures into later assignments, with provenance, corrections, exceptions and forget controls.

Dots' documented cross-channel/persistent work and Muse's conversational follow-ups/artifacts are experience references, not evidence of comparative task performance. We have not run either product head-to-head and must not claim parity from this plan.[12][13]

The central decision is **not** to replace WorkAgent wholesale with a host-level autonomous agent. Reuse selected components while keeping application authority. A CLI background thread is not durable responsibility ownership; a completion message is not a verified result; a remembered claim is not permission.

## 2. Starting baseline and coordination

Installed private runtime: `d4d019c4b9bebca9ca8b49d1466a92fab7514aff`. Verified report/evidence: `24afaedb7a6bcfe52063c013c4b85557ad256151`, branch `hermes/general-review-batch`. Research code manifests match this runtime's inspected source bytes except the subsequently updated STATUS document. Current last migration observed: `046_cancelled_response_observation.sql`.

A separate Claude phone/UI candidate exists at `7f5a6f2c4a48d954ad35e79fdc0e5e1de592a638`, branch `claude/workagent-frontend-kyg51x`. Parent re-fetched the branch and verified its named CI run is completed/failure: [run 39873966498](https://github.com/alindebergASL/Workagent/actions/runs/39873966498). PR #9's head is another branch, `hermes/general-work-reset`; do not confuse a comment there with merged code.

**First implementation action:** one integration owner reconciles the installed review changes with that Claude candidate, preserves the generated acceptance contract and existing human work, and has the web owner repair supported mobile journey coverage. Do not let two writers independently redesign proposal review or overwrite each other's artifacts. Freeze the resulting exact source baseline before new features. This is feature-branch integration, not default-branch merge or production permission.

Current live evidence creates concrete obligations:

- The first weekly proposal omitted a saved source-context note. A later explicit repair restored it. Keep a regression on **all candidates**, not just the repaired final result.
- Five multiline note objects became seventeen editor lines and hit a ten-note limit. Normalizing the text was a workaround, not a pass.
- After acceptance, dependency observations changed but last outcome prose still described pre-acceptance work. Show observation age and separate history from current state.
- Weekly amendment journal span was 505.73 seconds versus the earlier 296.80-second baseline. Fewer duplicate drafts did not mean less latency.
- The operator client cannot currently send the two acknowledgement fields. It fails closed; fix parity before making the TUI the principal evaluation surface.

## 3. Batch 2 — conversation and dependable ownership

### Milestone

**Start unfamiliar work in the terminal, attach real supported documents, make a human change in the browser, close both clients, recreate the worker, and return to the same useful work with an honest status and a safe next action.** No database shortcuts, second agent loop or manual rescue required for the supported recovery path.

### Architecture decisions

| Choice | Recommendation | Why / alternative retained |
|---|---|---|
| Terminal framework | Textual, version pinned at implementation | Headless Pilot tests and asynchronous workers are documented; real PTY tests still required. Keep scriptable CLI as fallback, not a competing runtime.[1][2] |
| Transport | Existing HTTP commands + durable SSE cursor, bounded polling fallback | SSE gives event IDs/reconnection, not durable authorization or exactly-once writes. Preserve existing command identities and receipts.[3] |
| Persistence | Extend PostgreSQL checkpoints/events/leases already owned by the app | Avoid introducing a second task ledger. Revisit Temporal only if measured reliability/operational complexity warrants migration; framework replacement cannot erase unknown sends. |
| Progress | Typed work-state projection plus optional details | Progress is a committed observation, not private reasoning text or a spinner interpreted as proof of work. |
| Resumption | Durable checkpoint + fenced successor admission | A pre-limit warning is helpful but not a recovery mechanism. Hermes documentation itself distinguishes reporting opportunities from verified completion.[4] |
| Attachments | Text parity first; bounded document ingestion in this same batch | Do not stop at a `.txt` demo and call broad attachment support done. Preserve original bytes and disclose extraction limits.[5] |

### B2.0 — integrate and freeze the safety baseline

Owner: Hermes integration; Claude web. Reconcile the branches above, regenerate contracts once, retain legacy command receipts, run focused API/client tests and repaired desktop/mobile journeys. No source migration numbers in the research documents are reserved; allocate the next number from the integrated tree.

Acceptance: source manifest, focused tests, one independent review and actual browser/terminal smoke checks agree on the same candidate. A failing head is not made green by deleting the user journey it no longer supports.

### B2.1 — safe commands and lossless editing first

Files: `backend/workagent/operator_client.py`, `operator_journal.py`, `operator_cli.py`, `operator_tui.py`; existing operator tests plus proposed versioned-journal tests. Claude owns `web/src/components/FlexibleWork.tsx`, `web/src/lib/flexible.ts` and matching tests.

- New accepts explicitly carry `acknowledge_removed_content` and `acknowledge_older_proposal`, false unless the user deliberately chooses them after reviewing the exact candidate/base.
- Freeze legacy format-1 journal validation/replay semantics. Add a versioned new command envelope rather than adding fields to previously stored commands. Replaying an old record must not regenerate a payload or manufacture consent.
- Preserve command ID, target revision/hash and attachment bytes across unknown outcomes. `resume work` reconciles responsibility state; `replay command` is a separate explicit exact-command operation.
- Replace newline-joined note editing with a structured list of multiline objects. Add/remove/reorder are explicit; unchanged notes preserve text, whitespace, order and object count. Do not repair this by silently trimming, flattening or truncating user material.
- Both clients use the server's review policy and the same comparison semantics. Accepting a proposal does not complete the goal or authorize external publication.

First runnable RED test, before changing UI (add to a focused web regression file; do not claim the expected failure was already run):

```ts
import { expect, test } from 'vitest';
import { notesFrom } from '../src/lib/flexible';

test('the old line codec cannot round-trip multiline note objects', () => {
  const saved = ['First note\nwith a second line', 'Second note'];
  expect(notesFrom(saved.join('\n'))).toEqual(saved);
});
```

Expected RED with the current codec. Preserve that reproduction; implement object-preserving editing and replace the regression's subject with actual editor save/readback (the old helper may remain for legacy plain-text inputs). Test the observed five-object/seventeen-line shape, limit boundaries, empty strings, reorder and cancel. Do not simply change the expected value to flattened text.

Small execution steps: add failing legacy-replay/no-consent tests → run focused operator suite → add a new envelope version and explicit acknowledgements → prove old records retain byte identity → add note round-trip failure → Claude implements object controls → prove UI and API saved body equality → review one coherent change and commit.

### B2.2 — conversational TUI as a real product and testing surface

- Named recent/ongoing work list; search/select without raw IDs.
- Multiline composer, paste, attachment staging/removal, visible send state and preserved draft on refresh/reconnect.
- Composer stays usable while work runs. Offer clearly distinct queue, cancel-and-replace and steer modes only when their backend semantics exist; do not relabel current supersession as true mid-run steering.
- Readable documents, tables, current/latest/earlier proposals and change summaries. Raw JSON/receipts remain in Details.
- Non-focus-stealing live progress; keyboard-first navigation; narrow terminal layout; accessible color-independent status; safe terminal text rendering.
- Status panel: responsible assignment, current action, last durable progress time, next action/check-in, wait/block reason, model and reservations/unknown cost. Never turn “command accepted” into “worker running”.
- Browser edits and TUI edits race through the same expected-version checks. Losing client refreshes visibly rather than overwriting.

The first useful release can pair this with existing safe text attachments and polling. It is a milestone within Batch 2, not completion of the whole batch.

### B2.3 — durable live work projection

Proposed seams: `work_events.py`, `progress_projection.py`, event routes in `api.py`, shared models/contracts, a terminal event consumer and Claude-owned browser event consumer. Detailed schema/commit-order options are in the Batch 2 design.

Persist events atomically with domain transitions; derive snapshots from authoritative state. Use stable workspace-scoped cursor/order, explicit cursor expiry and scoped replay. PostgreSQL notifications, if used, are wakeup hints only. Reconnect must neither skip committed work nor resurrect revoked state; fallback polling uses the same projection. Stream authentication must fit existing header auth, never a bearer token in a URL.

The visible model separates:

- intent/goal and open obligations;
- command receipt: sent, unknown, admitted, rejected;
- execution: queued, running, stale/lease-expired, stopped;
- responsibility: active, scheduled, waiting for person/dependency, blocked, paused;
- outcome: unverified, partial, verified, needs review.

These are related dimensions, not one overloaded “done” flag. After artifact acceptance, current facts reflect the new revision immediately; prior check-in prose carries its observation time and is labeled historical. An unresolved admission fee or missing figures stays unresolved.

### B2.4 — resumption that survives absence and interruption

Persist objective, current subgoal, latest safe next action, current evidence/revision references, outstanding commands, authority/budget snapshot, stopping conditions and owner/lease epoch. Save after meaningful state transitions, not only at the model's final turn. Treat model-written summaries as hints; reconstruct effects and accepted state from receipts.

At a turn/context/time boundary, admit a bounded successor only when the goal remains open, scope and budget still permit the next action, no unknown effect needs reconciliation and ownership is uncontested. Reacquire current grants/version fences, not stale credentials. Cancellation, pause and revocation fence future publication and admission.

When it cannot continue, record an actionable stopped/blocked/waiting state and one durable notification. The product must not imitate the earlier operator failure of leaving green work uninstalled with nobody owning delivery. A claimed successor needs a real admitted owner/queued record; otherwise say stopped.

Test hard kill before send, after send before receipt, after receipt before projection, after checkpoint before successor admission, and competing workers. Unknown provider outcomes never become a blind new send. Client exit alone does not cancel an owned responsibility. Notification delivery has a separate identity/status so a restart does not repeat a successful external effect.

### B2.5 — attachment scope beyond plain text

This section expands the research package's conservative text-only first milestone. **PDF text-layer, DOCX text/table content and XLSX cell/formula metadata ingestion belong in the full Batch 2 scope**, behind actual parser confinement. Batch 3 adds richer transformation, calculation, export and optional OCR/vision—not a second attachment store.

Proposed shared seams (new names to confirm at B2.0):

- `backend/workagent/attachment_store.py`: immutable scoped original objects, content hashes, safe names, lifecycle and quotas; existing text attachments remain valid.
- `backend/workagent/attachment_ingestion.py`: parser jobs, versioned extraction records, page/paragraph/sheet/cell locators, errors and coverage.
- `backend/workagent/attachment_parsers/`: isolated format adapters, not in-process parsing on the API/dispatcher.
- `backend/tests/test_attachment_ingestion.py`, `test_attachment_isolation.py`, existing message/evidence-context tests; generated contracts and both client staging views.

Suggested adapters, pending version/license/security verification: pypdf for text-layer PDFs, python-docx for OOXML documents and openpyxl for sheets. Their names do not establish universal format fidelity: pypdf is not OCR, `.doc` is not `.docx`, and openpyxl documents XML attack limitations.[14][15][16]

Required flow: stage original → validate signature/type/size → quarantine/isolated extraction → commit scoped object + extraction receipt → attach an immutable reference to a message → expose authorized excerpts/full paginated source when needed → retain across continuation → revoke/forget according to declared retention. Parser crash does not lose the original or claim it was read.

- Separate original byte hash from extracted representation hash; record parser/version, pages/sheets processed, omitted/unsupported structures and size limits.
- Enforce compressed/uncompressed size, entry count, page/cell count, CPU/RAM/time and output limits in the worker. Disable network, macros, external links and active content. Format sniffing and extension allowlists alone are not isolation.[5]
- Preserve formulas as formulas and cached values as cached values, not recomputed truth. Rich content not read must be marked unavailable; no inferred complete-document claim.
- Images may be retained and previewed with an explicit “not interpreted” state until the approved OCR/vision route exists. Scans must disclose missing text, not yield a confident empty-document summary. Audio/video and legacy Office conversion remain declared later capabilities, not hidden support claims.
- Use one object/evidence model for uploaded and later generated/connected files. Batch 3 tools resolve scoped references; no arbitrary host paths or operator home access.

### Additional parent acceptance obligations

These complement, rather than replace, A1–A35 in the detailed implementation plan.

| ID | Acceptance case | Required evidence |
|---|---|---|
| P1 | Separate Claude candidate reconciled with review-safety runtime | Exact merged feature candidate; generated contract and desktop/mobile tests retained |
| P2 | Acceptance updates current facts, not historical prose | Current revision visible; old observation timestamped; unresolved goal still open |
| P3 | PDF/DOCX/XLSX content retained and reread after restart | Original/extraction hashes and source locators match; no resupply |
| P4 | Scanned/image/unsupported sections are honest | Visible coverage/limitations; no claimed reading of missing text |
| P5 | Parser bombs, external links and escape attempts | Actual confined process failure/resource evidence; no network/host-secret access |
| P6 | Initial inferior planning candidate remains graded | Preserved failure record, review warning and protected human notes in accepted candidate |
| P7 | Turn-limit boundary has real ownership | Verified admitted successor or explicit durable stop reason; never an ownerless spinner |
| P8 | Latency and friction regression measured | Phase timing and human interventions on matched tasks, including negative results |

Full Batch 2 exit: A1–A35 and P1–P8 exercised at the appropriate unit/integration/live level; no critical permission/data-loss/unknown-replay failure; familiar regression plus unfamiliar task variations completed through both UIs. Do not require paid models for deterministic safety tests. Real task quality and real unattended continuity need live evidence in addition to mechanism tests.

## 4. Batch 3 — reusable capabilities and cross-assignment learning

### Milestone

**Give it several different kinds of work over multiple sessions. It uses appropriate tools to produce inspectable results, reuses only relevant prior lessons, adapts when corrected, and demonstrably stops using information when forgotten or revoked.** User effort falls without losing scope or trust.

### B3.0 — one capability boundary and shared file/evidence substrate

Build on Batch 2's objects, execution identity, progress, checkpoint and authority. Proposed `capability_gateway.py` and adapters mediate schema validation, scope, data-class/processor permission, resource reservation, execution receipt, cancellation and postcondition observation. Keep progressive discovery: describe available relevant tools, not a giant universal prompt.

A tool is unavailable when credentials/dependencies/scope are missing. Explain that rather than simulate output. Tool descriptions, fetched pages, attachments, MCP annotations and memories are data, not authority. Every consequential effect needs the relevant existing approval/standing grant; a learned procedure cannot mint it.

### B3.1 — first useful combined slice: computation + inspectable memory

Deliver bounded file-workspace computation and simple typed memory together through separate adapters:

- Execute real table/statistical/file transformations and tests in a job-scoped sandbox; return stdout/stderr/exit status/resource usage and actual output files.
- No app secrets, operator profile, broad host mount, unrestricted subprocess host access or default network. Pin image/packages. Choose and verify an actual isolation boundary; gVisor is a candidate, not a safety guarantee merely because a container exists.[8]
- Memory types: explicit user preference, source-backed fact, project convention, episodic outcome, validated procedure. Each has scope, provenance, validity/observation time, confidence/state and correction/supersession links.
- Start with structured/lexical bounded retrieval and an inspectable record store. Add vectors/graphs only when measured misses justify their cost and deletion complexity.
- Show “why this was recalled”, source and applicable scope. User can correct, narrow, expire or forget. Ordinary conversation remains primary; no mandatory memory-management dashboard ceremony.

First demonstration: analyze a synthetic/public dataset and produce a real downloadable result; later, a differently shaped dataset benefits from an explicitly reviewed denominator/unit-checking lesson, not copied old numbers. This is transferable capability, not an invoice-specific feature.

### B3.2 — research, files and useful outputs

- Public search/fetch with source/version locators, claim-to-evidence mapping and freshness/conflict handling; bounded read-only browser fallback where appropriate.
- Extend Batch 2 parsing to editable transformations and validated exports: text/Markdown/CSV/JSON, then DOCX/XLSX/PDF/charts through suitable adapters. Read back actual exported bytes and validate key content/layout before claiming success.
- Source changes invalidate derived claims appropriately without overwriting human edits. Reuse original file IDs and extraction receipts, not duplicate evidence stores.
- OCR/vision is a separately declared processor/capability with privacy/cost controls and explicit coverage; add when the approved route and evaluation justify it. Never convert “attached” into “understood” without execution evidence.
- Safe code/log diagnosis and patch/test output are a capability family; this is not production deployment or permission to run unknown code on the app host.

### B3.3 — connectors that are useful, not just numerous

Implement one public/read-only connector end-to-end (recommended: GitHub public repository/releases/issues) and a constrained MCP adapter with a local test server. Then implement a named-account read-only connector pilot (calendar/mail/files or a chosen work service) once access is specifically authorized. Supplied exports remain a usable alternative when consent is absent.

Permission records name account, selected resources, scopes, processor, expiry, allowed effects and grant generation. Credentials stay outside prompts/tool outputs; provider revocation and local denial are distinct statuses. Read-only access can still disclose private data, including through search queries or cached titles/counts.

**Version-sensitive finding:** the official MCP registry currently identifies `2026-07-28`, and its compatibility page describes per-request metadata with no negotiation handshake. Parent independently re-fetched both. Do not build against remembered 2025 initialize/session semantics or assume a current SDK supports the new revision; pin a compatible pair and test explicit legacy adapters if needed.[6][7]

Initial tools cannot send mail, buy, book or mutate production. The architecture should support later scoped writes with preview/approval, stable effect identity, cancellation and unknown-outcome reconciliation. Those are visible future capabilities, not implied by enabling a read connector.

### B3.4 — procedural learning and bounded delegation

- Propose lessons from observed work and corrections; attach evidence and applicability. Distinguish a suggestion from a validated procedure.
- Explicit human preferences can be recorded via the user's command; automatically inferred preferences/procedures remain inspectable proposals under the selected policy. Do not promote arbitrary source text to permanent instruction.
- Reuse selected Hermes tools/skills/MCP utilities after pin/license review, not the operator's live memory, credentials or ambient tool authority. No second hidden model budget.
- Delegate bounded independent work with a narrower scope/resource grant, explicit output contract and parent verification. Parent cancellation/expiry propagates; a child's self-report is not a verified side effect. Do not add multi-agent fan-out when one worker is sufficient.
- Learning reduces repeated mistakes and manual explanation; it must not make a specific previous conclusion or shortcut govern unrelated work.

### B3.5 — correction, forgetting and longitudinal work

Filter authorization/scope before retrieval ranking, snippet generation, counts and caches. A same-user/different-confidential-project case must not leak. Corrections can supersede permanent facts or create a time-bounded exception; track both valid time and recorded time. A historical success never licenses skipping current verification.

Forgetting immediately removes memory eligibility and invalidates summaries/embeddings/caches; prevent re-extraction from the same forgotten evidence and resurrection after restore. State separately whether the user asked to forget a derived preference or delete source documents. Apply explicit source/receipt retention policy without lying that an audit receipt rewrite occurred. A source revocation removes derived recall eligibility even when a cached embedding still exists.

Test memory through later work, not trivia alone. LongMemEval supplies temporal/update/abstention categories; MemoryArena couples memory and subsequent action; LongMemEval-V2 adds workflow/environment/premise diagnostics and highlights latency trade-offs.[9][10][11]

## 5. Evaluation through varied work, with honest comparisons

Use the detailed Batch 3 evaluation protocol for both batches' product trials; scale capability access to the installed candidate. The task families are a coverage matrix, never dispatch branches in application code.

| Family | Initial useful result | Later change/interruption | Transfer / negative-transfer test |
|---|---|---|---|
| Research | Cited recommendation and evidence table | Source changes; human edits conclusion; restart | Reuse source-validation method, not old conclusion |
| Editorial | Editable brief/invitation with protected quotations | New facts and style correction | Relevant style helps another document; required long quote stays complete |
| Data analysis | Real calculations, chart and export | Units/schema/duplicates change; preserve annotation | Reuse unit/denominator checks, not earlier values |
| Code/operations analysis | Patch or diagnosis with real tests | New error/version and human patch | Version-specific workaround must not transfer blindly |
| Personal administration | Commitments and unresolved questions | Cancellation, permission revocation, correction | Right-scope availability preference; no cross-project leakage |
| Planning | Feasible editable plan and explicit conflicts | Human completion/availability changes | Preferences transfer; old tasks and invented progress do not |
| Connector work | Versioned public issue/release brief | Scope reduced while read is in flight | No stale cache/title/memory leakage |

Every selected trajectory has initial work, human correction, absence/restart, later assignment and forget/revoke/exception probes. Include at least one actual later-session/overnight observation before claiming real overnight continuity; simulated clocks test mechanisms but are labeled as such.

Use isolated evaluator-owned answers outside product DB/files/search/memory/sandbox. Preserve failures and prompts. No fixture-specific model hints, hidden oracle leakage or success-only sampling. Vary dates, names, columns, units and topic after implementation freezes.

Separate causal questions:

- frozen current tools/history versus new tools with the same existing history: tool breadth;
- equal tools with raw-history retrieval versus reviewed typed memory: memory value;
- optional larger-history/vector/graph variant only after a demonstrated need.

Report actual artifact correctness/usefulness, human interventions/repeated resupply, first useful result and total latency, phase timing, reservation/usage/unknown cost, memory transfer and negative transfer, forgotten-content reappearance, recovery and permission failures. Small cohorts discover failures; they do not prove superiority. Choose quality/latency tolerances from matched baselines and task stakes before the trial, not an arbitrary “80%” target.

Hard failure: unauthorized access/effect/spend, data loss, cross-scope leak, fake execution/citation, unknown-effect resend or forgotten-memory resurrection. Stop the affected trial, preserve evidence and repair the shared mechanism. A useful final artifact does not cancel a hard failure.

## 6. Implementation order and release gates

1. Reconcile safety/mobile baseline and confirm exact contracts.
2. CLI review parity + structured notes; cheap deterministic regression first.
3. Conversational TUI + text attachments + shared progress polling: first usable increment.
4. Durable events/current-state projection + fenced checkpoint/resumption.
5. Scoped document ingestion and continuation; full cross-UI varied-work Batch 2 proof.
6. Batch 3 shared capability boundary and real isolated computation + inspectable scoped memory.
7. Research/file/export adapters, public connector and version-pinned MCP test server.
8. Named private read pilot only with its consent; otherwise complete synthetic/export proof and report private pilot blocked, not silently complete.
9. Scoped procedural learning/delegation, correction/forget/restore proof and longitudinal held-out tasks.

Parallelize independent client/backend seams after freezing their contract; do not parallelize competing schema owners or two web writers. Use coherent feature commits, one independent risk-focused review, parent execution of tests and post-install user journeys, and exact-source manifests. Each release gets a concise report: running artifact, verified outcome, failures, budget and actual next owner. Tests alone are not product delivery.

Detailed task commands in the research plans are **future commands**, not execution evidence. Use disposable pinned test databases, no-provider fixtures and isolated parser/sandbox tests first. Verify named files/routes still exist and allocate migrations from the then-current head; Batch 3 must reuse Batch 2 events/checkpoints/attachment objects instead of creating conflicting tables with the same ordinal.

## 7. Budget, models and authority

The completed batch's last readback was aggregate allocation **$92.10596** within the original **$100** product-evaluation ceiling, reservations **$66.58608**, three historical unknown-usage steps and five remaining generation slots. Allocation, reservations and billing differ; none is a fresh budget. Re-read live ledger before any future paid run. A full varied-task/longitudinal study must not be waved through on those five slots; plan an explicit bounded tranche or obtain additional authorization without resetting history.

Preserve current product model `gpt-6.1-sol` until a separately authorized model comparison. Engineering/integration/review remains Astra; Claude owns web. Planning used two bounded delegated research streams with Astra parent synthesis; the completion notification did not identify the child models, so they are not asserted here. Package installation, benchmarks and candidate architecture have not been exercised merely because their docs were retrieved. Count future auxiliary extraction/judge/summary/delegate/tool costs, not just the main visible reply.

Routine reversible development already covered by standing authority should not acquire per-step approval ceremonies. New private account access, external effects, data processors, production changes and spending beyond the remaining authority still need their explicit gates. This planning request does not activate either new batch.

## 8. Completion and next action

The requested current batch is installed and qualified; these two plans are now the next deliverable. No new implementation worker or scheduled product trial is active for them. The recommended next execution unit is **B2.0–B2.1: reconcile the Claude candidate, restore safe CLI/TUI acknowledgement parity, and fix structured note editing**, then continue through the full Batch 2 sequence—not stop at that first small increment.

The final ambition remains a general work partner, not a planner with extra buttons, a connector catalogue, or a memory benchmark demo.

## Sources

[1] https://textual.textualize.io/guide/testing
[2] https://textual.textualize.io/guide/workers
[3] https://html.spec.whatwg.org/multipage/server-sent-events.html
[4] https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban
[5] https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
[6] https://modelcontextprotocol.io/specification/versioning
[7] https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle
[8] https://gvisor.dev/docs/architecture_guide/security
[9] https://arxiv.org/abs/2410.10813
[10] https://proceedings.mlr.press/v306/he26am.html
[11] https://arxiv.org/abs/2605.12493
[12] https://openai.com/index/introducing-dots
[13] https://www.meta.com/help/artificial-intelligence/1331373868832401
[14] https://pypdf.readthedocs.io/en/stable/user/extract-text.html
[15] https://python-docx.readthedocs.io/en/latest/user/documents.html
[16] https://openpyxl.readthedocs.io/en/stable/index.html
