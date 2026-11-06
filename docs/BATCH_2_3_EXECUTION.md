# Batch 2 / Batch 3 execution

Activated by Andrew in the October 26 session: recover the two-batch sliced plan and execute. The controlling scope remains `plans/2026-10-23-workagent-next-two-batches.md`; no first increment is the whole mission.

## Live-source reconciliation

The old plan's web blocker was superseded by Claude's subsequent work. Refetched `origin/claude/workagent-frontend-kyg51x` at `0929a2525c117338b3698f6bae59e42e897652b3`; GitHub run 40153102982 returned completed/success for that exact head. Claude had already merged review-safety code at b61c0e8 and repaired supported mobile journeys. Integrated that web head with the published research plan branch in feature merge `0cb205c9c4d10cea6324e3ee08cb5df14aa9eabf`. No default-branch merge or installation.

Parent checkout: `/home/ubuntu/workagent-batch2-20261026`, branch `hermes/conversational-continuity`.

## Current implementation checkpoint

- B2.0 verified: 59 operator/review unit checks, 83 disposable PostgreSQL review/attachment checks, 370 web unit tests, canonical/generated contract drift checks, mock webpack production build, and all 15 supported desktop/mobile/narrow browser journeys passed. The first runner failed on global pnpm's external-node_modules reinstall protection; npm-run/direct-node plus the separately locked contracts dependencies resolved the environment problem.
- B2.1 commands integrated from Astra: format-2 commands explicitly carry false-by-default acknowledgement flags; legacy format-1 validation/replay remains frozen. Parent reran 115 combined operator/review/new staging/Pilot tests, plus a real FastAPI/restricted-PostgreSQL operator test proving read-only review, default rejection, explicit acknowledged acceptance, exact replay and immutable history.
- B2.1 structured notes integrated from Claude Opus 5.5: one multiline editor per object, explicit add/remove/reorder/undo, preserved whitespace and count, and empty-note validation without silent deletion. The shared component also replaces the older product-table/tool editor. Document notes were already structured. Parent web suite is 377 passing tests; real webpack build including TypeScript, ESLint and Prettier pass.
- Parent real-stack browser proof passed at 1440/390/320px with controlled synthetic fixtures and actual API/PostgreSQL readback: untouched five-note/seventeen-line save, reload, editing one note, reorder/remove, blank-note blocking, whitespace-only note, discard, ten-note bound and horizontal containment. No browser page errors. The general-purpose reproducible seed/browser scripts passed a separate fresh-fixture rerun at all three widths. The initial seed-script extraction hit a module-shadowing import and was corrected; its failure was retained before the green rerun.
- Independent Astra review found one P2: removing a note then discarding leaves stale Undo history, which can duplicate the restored note. The parent reproduced it in the actual API/browser path before correction. Claude corrected external-list reset while preserving ordinary editor-originated identity/Undo. A narrow independent Astra rereview returned PASS; its attempted tests were honestly blocked by the read-only sandbox. Parent then ran the real corrected production build, 381 frontend tests, lint/format, 100 backend checks including real HTTP/PostgreSQL, and the full fresh-fixture browser journey with the reset regression at all three widths. Original failure and final readback/review are retained in `docs/evidence/batch2-first-increment/`.
- B2.2 groundwork, not a completed slice: optional Textual 8.2.8 dependency/lock, inert exact-byte local text staging (11 checks), and conversation-first async terminal prototype (5 Pilot checks). These eight unfinished files are preserved outside the reviewed B2.1 candidate at `/home/ubuntu/workagent-b22-groundwork-20261026`, with backend-relative paths. Missing restart-safe drafts, attachment send/replay, exact target/review panels, current-state projection and full TUI/browser journey are still owed. Do not replace the installed operator with this partial UI.

Original isolated implementation lanes were `/home/ubuntu/workagent-b2-commands-20261026` and `/home/ubuntu/workagent-b2-notes-20261026`. Both implementers finished; their diffs were inspected and integrated by the parent. Claude's same resumed session reported total-cost counters $2.3719086 before correction and $3.0002948 afterward; these are developer-tool list-price counters, not verified billing, and are not added to product-model reservations. Parent owns publication and continuing integration. No default-branch merge, production replacement, live private-data access or product-provider run occurred.

## Full scope still owed

B2.2 Textual conversational client and retained text attachments; B2.3 durable scoped event/current-state projection; B2.4 fenced checkpoints/resumption with unknown-effect protection; B2.5 confined PDF/DOCX/XLSX ingestion; A01–A35/P1–P8 integration and cross-UI proof. Then B3.0 capability boundary, B3.1 real computation/scoped memory, B3.2 research/files/exports, B3.3 public connector/MCP and consent-gated private pilot, B3.4 procedures/delegation, B3.5 correction/forget/revoke/restore plus longitudinal varied work.

No new product paid run. Existing cumulative $100 authority and historical unknown liabilities remain; last documented allocations/reservations are not a fresh live billing query. Re-read ledger before spending. No new private-account/processor access, business effects, production replacement or database maintenance authorized. Synthetic isolated DB provisioning is used for engineering tests. Host initially had 17 GB available; no destructive cleanup performed. Heavy builds/browser jobs use bounded concurrency.

Research refresh: Textual workers/testing official documentation re-fetched; PyPI reports Textual 8.2.8, MIT, Python >=3.9,<4.0. Version availability is not yet installation or compatibility evidence. Original research remains preserved.

## 2026-10-27 — Step 2 independent acceptance (append-only evidence history)

Card `t_99a458da` independently accepted the remaining synthetic safety scope:
A09/A21/A22/A23/A26/A33/A34 PASS, A27 backend accepted but full row **PENDING**
paired web/TUI next-action evidence. Previously accepted A13/A25 were not rerun.
All 612 current core hashes and 1,437 deployed hashes match the pinned candidate;
raw manifests, SIGKILL/process identities, wire/ledger cutpoints, old-runtime pins,
expiry/refusal counters and disposable rollback preservation were checked.

The matrix derived from `process-order-fence-proof/parent-acceptance/` contains
43 unique IDs, **29 PASS / 14 PENDING**; seven status changes, A27 evidence-only
qualification, and 35 unrelated rows unchanged. Prior assessments and failed attempts
remain intact. Exact report, matrix, evidence bindings and verification are at
`/home/ubuntu/workagent-acceptance-remaining-20261026/step2-safety/acceptance/`.
A23 proves the production atomic local responsibility effect, not external connectors;
A26 is scoped to supported expiry/revocation schemas; A34 is application-version
rollback with canonical old reads, not a nonexistent feature flag/installed rollback.

All Step 2 author attempts total 107 synthetic provider operations and two effect
observations. Reviewer performed no new behavioral/browser/build campaign, paid
calls or product-source edits. Independent readback confirms zero fixture sessions,
33 absent prior child identities, active services/idle timer, released reviewer lease
and no active leases. Synthetic DB/private stores retained. **Step 2 done is not
full Batch 2 done: publication remains HOLD.** Step 3, paid/live evaluation and
Batch 3 were not started. Existing cumulative $100 ceiling/liabilities remain; no
active successor or continuing work is represented under this completed card.

## 2026-10-28 — Step 3 paired-client acceptance (append-only evidence history)

The single independent reviewer `t_a6098a56` accepted all authorized synthetic
paired-client obligations from the four serial slices. Literal browser/native-PTY
input, canonical PG/network receipts and actual screenshots were inspected; no
second reviewer or broad test/build/browser campaign was run. A04/A05/A06/A20/A27/
A30/P4 now PASS; A01/A02 mechanism proof is accepted while live quality remains
PENDING. Exact matrix:43 unique IDs,36 PASS/7 PENDING,34 unrelated rows unchanged.
A07/A08/A10/P7/P8 stay pending; no synthetic output is promoted to live usefulness.

Final622-file source manifest SHA256
`a2bd405f417b5c6adba12ee67ed1dc59cb07a5cce5d2c1535a233beea555629f`
binds the intentional dirty integration at HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d`.
Step3 contains37 changed/added source/test/contract files relative to Step2 (10 new);
reviewer product edits zero. Final isolated production build `_0J4OPn8I5QJf9a-2c5nD`
has149 verified bundle files; all1,437 staging hashes remain unchanged. Earlier
proofs retain their original build bindings and explicit changed-source impact map.

`/home/ubuntu/workagent-acceptance-remaining-20261026/step3-clients/acceptance/`
contains required REVIEW/verification/acceptance-matrix/STEP3-RESULT plus raw/visual
bindings and source-impact map. Original A05 metadata-only recovery RED, native
scroll RED, all harness failures and two inherited budget-test failures are retained.
No all-suite-green claim. Actual command bindings and15 responsiveness cases pass;
these measure controlled interaction mechanisms, not live model latency/P8.

Zero paid product calls/reservations; preserved synthetic databases have no live
attempts/other sessions. All owned campaign browser/PTYS/processes/listeners and
reviewer lease are stopped/released; idle timer and unchanged staging services stay
active. DB/original/evidence preservation remains intentional, with no destructive
cleanup, production replacement, merge, publication or Batch3 release.

**Step3 is complete; full Batch2/publication remains HOLD.** Next authorized work is
read-only ledger/liability reconciliation and bounded live-evaluation-envelope
preparation. `t_75bcdd10` is currently todo with other unmet prerequisites, not a
running successor. Completion notify+wake returns the evidence to the orchestrator
for routine continuation; this is not a user-ordered stop or a generic permission
gate. No automatic paid dispatch or cumulative$100 budget reset is authorized.

## 2026-10-28 — Accepted Batch2 publication/runtime handoff

Later final acceptance closes all43 literal rows with qualifications preserved;
historical partial matrices above remain historical, not current publication gates.
The [publication packet](evidence/batch2-publication/README.md) contains the exact
630-file final source manifest, independent publication review, retained original
acceptance,525 passing web tests,2 real process/HTTP tests and actual desktop/phone/
narrow browser plus native readback. Product source commit:
`1c36002cd2481ef2f3195ae4c52ba4dd05e0608c`; feature base remains
`hermes/conversational-continuity`. Exact-head remote CI/PR readback belongs to this
publication card's final handoff; frontend mock CI is not real-stack acceptance.

Current loopback development stack: web3197/API18967 with new disposable PG,
optimized build and synthetic fixture only. No model worker, no new paid calls,
no production/default merge/public exposure. Existing audit-only `t_99aaa2a0`
receives final SHA/PR/CI/proof/runtime/budget; Batch3 continues through the declared
successor graph only after that audit. No mission-complete claim.
