# WorkAgent — authoritative delivery status

## Latest: changing supplier assignment — PARTIAL, evidence continuity gap

Step 1 was exercised live on installed runtime `8137e18`, with five synthetic source
texts, a human requirement correction, and one unattended check-in. WorkAgent
correctly recommended Alder at $11,360 initially, then Birch at $13,920 after the
quantity/budget change and later signed amendment. The human note and historical
assessment were preserved; the revised proposal remains unaccepted.

The scheduled run completed, but its attachment context was empty, work-area
context null, and saved-work discovery exposed only the accepted document. It
could not reread the amendment or its own pending proposal, honestly disclosed the
gap, and asked for the already-supplied amendment again. This is NOT a full product
pass. The earlier two-item timing proof remains valid but does not cover this gap.

Full report: [changing assignment evaluation](docs/CEDAR_CHANGING_ASSIGNMENT_EVALUATION.md).
Evidence: `/home/ubuntu/workagent-real-assignment-evidence/verified-results.json`
(`full_step1_product_pass=false`; parent verifier executed successfully).
Grant `-13`: aggregate allocation $78.44924 within the same $100; reservations
$53.34320, not billing; historical unknown generations remain three. No code or
frontend changes; no default-branch merge or production deployment. Evaluation
complete; no engineering successor active. Next concrete engineering target:
authorized attachment/pending-proposal continuity across scheduled work.

## Active continuation: repeated ongoing work

Andrew reaffirmed that routine steps do not need incremental approval. Development
has resumed; a green batch is not a mission stop. Next: two responsibilities across
multiple check-ins, worker recreation, changed human input and pause, with saved
edits and duplicate-effect protection preserved, followed by actual desktop/phone
verification and coherent integration. Repair café independently completed its
repeated cycle; the two-item exercise failed at Library. Draft binding and bounded
kind-rejection settlement are installed privately; a fresh full proof remains due.
Evidence lives at `/home/ubuntu/workagent-draft-binding-evidence` and
`/home/ubuntu/workagent-repeated-continuation-evidence`. Parent owns real PostgreSQL
execution and fixes; Claude retains web ownership. No new paid route, private-data
scope, business effects, default-branch merge or production deployment authorized.
Existing cumulative $100 product-evaluation ceiling remains in force.

## Latest: fresh exercise #4 PASSED on the installed cancelled-receipt runtime

- Full two-item changed-between-waves proof completed on runtime `8137e18` (exercise #4;
  `exercise4-verified.json`, parent-executed read-only DB verification):
  bake-sale (`d5ea6d4c`…/doc `95a355e0`…) and garden-fair (`29b68e16`…/doc `9459296b`…).
- For BOTH items the DB timestamps prove the intended ordering: wave-1 human edit
  (04:37:53/04:37:58Z) → first check-in note (04:44:32/04:44:13Z) → wave-2 human edit
  (04:46:45/04:46:50Z) → second check-in note (04:52:44/04:53:49Z). Second runs
  (`a31e3e2e`, `dd432e0a`) bound the wave-2 revisions; second notes carry both the
  original human constraints and the wave-2 updates (nut-free + gluten-free/ramp; native
  plants + pollinator/path). Both responsibilities ended `waiting_person` with no further
  check-in; zero proposals; desktop + 390px-phone readbacks pass with no overflow.
- Successor grant `-12` activated before the exercise (allocated authority **$74.93160**
  of the same cumulative $100, +$5.58684 technical envelope; aggregate never reset;
  reservations $48.99788 not billing; unknown generations back to the three historical).
  Activation preserved all retained state byte-for-byte; predecessor revoked for new
  sends only; no old attempts rebound.
- This closes the cycle broken in exercise #3 (timing miss) and the stall fixed by
  `8137e18`: the full Ask → work → edit → leave → continue → return-proven loop now has
  a live PASS with DB-timestamp ordering evidence on both items.

## Latest: cancelled-receipt fix installed and live-verified

- Runtime is now candidate `cancelled-receipts-20261022` at
  **8137e18479e92114b9e6f064da1054eeb51cc77f** (was `standing-capacity-20261022` @
  `646ed09`). Install used the standing pattern: preconditions matched the reviewed
  manifest (migration046 SHA-256 `ff5993a6…`), services stopped, exclusive `pg_dump`
  backup `before-cancelled-receipts.dump`, additive 046 applied once with all retained
  rows and budget provably unchanged across the migration, config root switched, services
  restarted ready. No new allowance; grant `workagent-continuation-20261022-11` unchanged.
- Live settlement verified against the pre-install baseline: the cancelled repair-day run
  `a4163ad3` stayed cancelled with byte-identical run/step/event history; exactly one new
  terminal `result` matching the stored identity and usage; one honest
  `cancelled_unapplied` disposition; no dispatch/count/tool_result additions; both human
  revisions unchanged. Unknown generations dropped **4 → 3** (only the three historical
  unknowns remain — the cancelled attempt genuinely settled; nothing was rewritten).
- Post-settlement the responsibility admitted one NEW run `e70c305f` through ordinary
  gates, bound to the LATEST human revision `7cdd3027` (wave-2 note with the
  bicycle-puncture/east-doorway update). That run completed three selections
  (publish_artifact, advance_responsibility, reply), wrote the second readiness note
  `96bddf1b` using the human's wave-2 constraints, and ended `waiting_person` with no
  further check-in. Desktop and 390px-phone readbacks confirm the note content and no
  overflow (`recovered-note-*.png/json`). Reservations $43.41104, not billing.
- This closes the live stall discovered by exercise #3: human edit preserved, no resend,
  honest unapplied disposition, then ordinary continuation with the newest saved context.
  Exercise #3 as a whole still is NOT the changed-between-waves proof (its timing miss is
  documented above); a fresh exercise with ordering proven from DB timestamps is still
  owed. Residual reviewer-noted gap: broader source-access/revocation coverage.

- Private feature branch `hermes/cancelled-response-receipts` HEAD
  **8137e18479e92114b9e6f064da1054eeb51cc77f**, now the INSTALLED runtime (see above);
  pushed and read back. (Superseded by the install section above.)
- Diagnosis chain, all parent-verified: a human edit correctly cancelled an in-flight
  scheduled run and preserved the edit, but the retained exact provider identity had no
  terminal receipt, so all later responsibility admission waited forever. No request was
  resent or history rewritten. Three-step reproduction: read-only diagnosis; tests-only
  writer produced `test_cancelled_response_receipts.py` (parent-executed: exactly the two
  intended REDs plus a passing never-resend control); implementation writer produced the
  candidate while leaving the RED file untouched.
- Parent found the implementation initially missed a second SQL guard; first parent run
  failed 8/25 on `guard_responsibility_phase`. Parent patched the unpublished migration
  for exact authorized observation there too: v2 disposable DB 25/25 PASS.
- Independent review returned **HOLD**: a runtime SQL caller could replay an old result
  through a TEMP-table trigger to forge a `cancelled_unapplied` disposition. Parent
  executed both that replay and a stronger runtime-created `pg_temp` wrapper trigger:
  2 genuine REDs (`review-replay-red.xml`). Correction: trusted producer trigger function
  is now `SECURITY DEFINER` with fixed search path, exact relation/operation/trigger
  identity checks, public-qualified targets; the disposition guard additionally requires
  the real table owner's identity. Fresh v3 disposable DB: targeted suite **28/28 PASS**
  (`parent-v3-final.xml`), migration applied twice idempotently; broader regressions
  earlier passed **180/180** on the pre-hardening build. Focused follow-up review: **PASS**
  on the corrected source; residual broader source-access/revocation coverage remains open.
- Design preserved: cancelled run stays cancelled; human revision, request bytes, identity,
  grants, budget and unknown liabilities unchanged; no `tool_result` fabrication; only the
  exact known response may be GET-observed once under current authority with shared read
  accounting; pre-cancellation results without recorded effects stay ambiguous and
  blocking; unknown sends without identity stay quarantined; settled receipts unblock only
  NEW ordinary admission bound to the latest human revision.
- Commit `8137e18` freezes exactly the reviewed bytes (Python/tests match the v1 manifest;
  migration046 SHA-256 `ff5993a63d41f9633439cb09041782d40d79b08e4bdf3bfc24ccb0f9d5b840ad`).
  Install + live-settlement verification completed; the fresh changed-between-waves
  cycle passed as exercise #4 (see top section).
- Evidence: `/home/ubuntu/workagent-cancelled-receipt-evidence/` (diagnosis, tasks,
  worker logs, RED/GREEN XML, replay reproduction, live baseline hashes, review results,
  final manifest). Disposable DBs `b2c1fc9a1169` (v2, old checksum) and `f55cf72dfe42` (v3)
  exist; the older request-capacity DB carries the superseded first 046 checksum and must
  not be reused with this source.

## Latest: combined runtime installed; fresh proof found a cancellation stall

- Private source `646ed0914be8f97d26a828e7d62dbb8cea83e89c`, candidate
  `standing-capacity-20261022`, combines Claude's `d52928a` UI and the standing
  capacity correction (`1122d83`, integration `646ed09`). Migration045 installed
  with backup and exact retained-state/budget verification. No default-branch or
  production deployment.
- Standing-only cumulative schema ceilings now allow 1,024 generations/counts and
  matching token totals. This does not allocate money or change per-request limits.
  Scoped/fixed caps, explicit lower grants, $100 monetary ceiling and unknown-send
  protections remain. Parent PostgreSQL run: **265 passed, one deliberately
  deselected legacy database-provisioning case**; independent Astra review PASS.
  No full backend-suite claim; reviewer noted an unrelated pre-existing SQL/Python
  `cancel_limit=0.0` parity caveat, not a new regression or an exhaustive parity pass.
- Both UI review issues are corrected: a real reply is not denied, and an earlier
  responsibility receipt no longer hides a later refusal/budget stop. Parent reran
  all **350 owner unit tests**, three independent review reproductions, typecheck,
  lint and formatting on `d52928a`. Canonical combined webpack build/TypeScript passed
  with `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1`, without credentials in build env.
  Installed desktop/phone readback confirms saved human notes and a working reply
  composer (enabled with text, disabled empty); no message sent by that UI probe.
- Native successor `workagent-continuation-20261022-11` is activated for NEW work.
  Allocated authority is **$69.34476 of the same cumulative $100**, not billing.
  Activation preserved all historical requests, events, attempts, pauses and budget
  carry, including three unknown generations and Garden's unresolved count. Old
  attempts remain bound to their original, now-revoked send authority; none resumed
  or rebound. Activation itself made zero provider requests; fresh work is separate.
- Fresh exercise #3 is **NOT a full pass**. Book-swap remained paused beyond its
  original deadline, then completed both check-ins after Resume (runs `a7849dbc`
  and `348e4661`), retained two readiness notes and ended `waiting_person` with no
  further check-in. Both runs bound the first human revision `cfb8bc7d`. Parent DB
  verification and desktop/390px-phone note readbacks passed. Its second human edit
  was saved at `03:08:44Z`, AFTER both check-ins, not between them. That late edit
  persisted, but cannot prove updated input was used in the second check-in.
- Repair-day completed its first check-in, but a later human edit crossed its second
  run (`a4163ad3`, dispatch `02:59:20Z`, edit/cancellation `02:59:37Z`). The human edit
  correctly won; no stale second note was published. A known provider identity and
  three reads were retained, but no terminal result. Further continuation now waits
  for that attempt to settle; no unknown request was resent or reclassified. This
  is genuine mid-flight-edit/stall evidence caused by the test's timing, not a clean
  between-wave edit pass. Read-only Astra diagnosis is active; no correction claimed.
- Actual worker restart/readiness/PID change and unchanged source were verified.
  Latest reservation total **$42.99720**, not billing; unknown generations now **four**
  (three historical plus the cancelled repair-day attempt). Allocated authority remains
  $69.34476 of the original cumulative $100. Prior Library/Garden evidence is unchanged.
  The full fresh changed-between-waves two-item proof remains outstanding.
- Evidence: `/home/ubuntu/workagent-request-capacity-evidence/` (tests/review/build,
  migration backup/install readback and browser captures),
  `/home/ubuntu/workagent-frontend-verification-evidence/` (owner fix regressions),
  `/home/ubuntu/workagent-fresh-ownership-evidence/` (authority, two requests,
  human edits, pause, restart, leave-app and read-only observations).

## Earlier: known kind-rejection fix installed; historical pause respected

- Private source `fd110a77e87203d15a8ce4384721bc77b1feb351`, candidate
  `local-rejection-20261022`; feature integration `3dcc886`. Pure artifact-kind
  compatibility rejection now reaches the existing durable rejected-observation
  and bounded continuation/finalization path. Access/CAS/receipt identity and
  unknown sends remain fail-closed; actual publication still forbids kind changes.
- Independent Astra source review PASS; **77 distinct focused cases passed**:
  37 settlement/authority/draft-binding cases, 36 existing edit/recovery cases,
  and four independent selected-versus-staged publication guards. No failures,
  errors or skips in those batches; no full-suite claim.
- Installed with a database backup and no migration. All retained state matched
  before worker restart; independent readback verified running source, readiness,
  immutable old request/event rows, protected human revisions, exact responsibility
  lifecycles, unchanged grant/route, and zero new provider requests/reservations.
- **Library was not recovered.** Its deliberate Pause after responsibility recording
  changed work version 2 to 4 and state `waiting_event` to `paused`. Read-only
  execution of the exact authority guard now proves `version_conflict` before the
  kind-rejection stage. That is an authorization barrier, not permission to rewrite
  history, undo Pause or weaken CAS. The historical run still has no assistant reply;
  the failed two-item test remains failed. Live correction behavior needs a fresh
  authorized request; controlled PostgreSQL recovery is already verified.
- Repair café remains waiting for a person with its two saved notes; Garden remains
  paused with its unresolved count receipt. Three historical unknown generations
  remain. Product grant and cumulative $100 ceiling unchanged; billing unavailable.
- Claude's new web branch `9dce8ef` supplies refusal/saved-work wording and existing
  `failure_reason`/`next_action` guidance. It is not installed. Next combined build
  must set `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1`; Claude retains web ownership.
- Evidence: `/home/ubuntu/workagent-local-rejection-evidence/` —
  `test-summary.json`, `review-verdict.txt`, `installed.json`,
  `installation-verified.json`, `before-local-rejection.dump`. The installation
  verifier explicitly reports `known_kind_rejection_retained=false` and the pause
  barrier; it does not turn an installation success into a recovery claim.

## Earlier: same-turn draft binding installed; fresh live cycle

- Private runtime `draft-binding-20261022` is installed at
  `fa2448310db7b378c94373f8880438ae309e954a`; feature integration `0da661b`.
  New drafts become discoverable/bindable before the final answer through exact
  receipt-bound publication. Finalization reuses the saved identity. Existing
  artifact edits remain proposals; human/access/lease/unknown-send fences remain.
- Independent Astra full-diff review PASS after two reproduced fixes: context
  overflow can now settle safely across restart, and an exact retained recording
  remains authorized when an own new draft displaces its dependency at the catalog
  boundary. Real PostgreSQL evidence covers **61 distinct cases across batches**:
  59 green before the final narrow window correction, 32 green in the post-fix
  batch, then both window cases green after correcting the fixture's expected
  terminal state (scheduled responsibility is `partial`, not completed `ready`).
  The test now also requires one model-receipted reply. This is not a full-suite claim.
- An older background fixture copied a packed `body_reference` as a document.
  Failure was reproduced on unchanged pre-increment runtime; resolving the exact
  reference and checking its hash made that fixture pass without runtime changes.
- Migration 044 adds a unique exact-selection index. Install took a quiescent
  backup and verified retained rows, budget, and route unchanged. Independent
  readback verified the source, all migration checksums, ready services, unchanged
  request/event journals, preserved human note, and paused old Garden responsibility.
  No product request or added allowance was needed for installation. Web unchanged.
- Fresh ordinary Home requests are active: Library desk readiness
  `397e3a93-090c-4a1c-abdc-9d35851a4002` and Repair café readiness
  `32a69429-27ae-4caf-83fe-b5eea1724790`. They request two check-ins, latest saved
  edits, separate preparation notes and a final human-decision hold, with no external
  effects. Desktop/phone edits, restart, repeated continuation and pause isolation
  remain to be demonstrated on this fresh cycle. Both drafts were actually saved
  and bound in their initial model turns. Repair café's human note was saved at
  390px and survived reload. Library selected a table, then attempted an existing-
  artifact table-to-document conversion; its received selection_5 is repeatedly
  rejected as `unsupported_operation` without terminal settlement. Library's
  responsibility was paused through the UI and read back paused. The full two-item
  exercise is therefore not a pass. Repair café remains independently scheduled
  while an isolated Astra diagnostic reproduces the new rejection failure.
  Private worker was restarted before the scheduled check-in, with readiness
  confirmed and source unchanged; the browser was left on about:blank. The earlier
  repaired cycle also stays failed evidence. Current grant/$100 ceiling unchanged.
- **Repair café independently completed the repeated cycle without runtime changes.**
  After the phone edit, leaving the app and worker restart, scheduled runs
  `50fe3f92-515f-4cd4-a3d1-c395341d8be7` and
  `f7cc145e-61b8-43b6-b62d-5c103db65d1b` both finished `ready`, saving distinct
  first/second readiness notes. Both used human revision
  `95440418-b5f7-489f-b5e0-595b2a2d8cff`, which stayed unchanged. The responsibility
  ended `waiting_person`, with no next check-in; Library remained paused with no
  background admission. Independent DB verification passed, then both notes were
  reopened on desktop/390px phone with their human constraints visible and no
  horizontal overflow. This proves one repeated responsibility plus pause isolation,
  **not** the requested full two-responsibility/changed-between-waves exercise.
  Whole fresh exercise reservation increase was $3.72456 to $38.23804, not billing;
  historical unknown-generation count returned to three after current work settled.
- Library's known-rejection defect is independently reproduced in two PostgreSQL
  cases after restart. The correct kind-change denial happens before durable local
  rejection retention, causing repeated dispatch instead of settlement. An isolated
  Astra implementation is extending the existing rejected-observation path; no
  kind conversion, proposal acceptance, receipt rewriting or unknown replay is allowed.
  That correction is not installed. No live history was changed to force success.
- Evidence: `/home/ubuntu/workagent-draft-binding-evidence` — `test-summary.json`,
  `window-review-verdict.txt`, `installed.json`, `installation-verified.json`,
  `before-draft-binding.dump`, `fresh-live-requests.json`, `repair-cycle-verified.json`,
  `repair-ui-readbacks.json`, desktop/phone note captures. Rejection reproduction:
  `/home/ubuntu/workagent-local-rejection-evidence/actual-red.xml` and `.log`.

## Earlier checkpoint: live stop/publication failure fixed; draft binding active

- Installed private candidate `stop-reasons-20261022` at
  `3e83495eb2c702273b3e130ab519079ad625c9d8`; parent integration `227e9a6`.
  `Run.stop_reason` now accepts the three outcomes already emitted by the worker.
  Three real PostgreSQL RED cases reproduced the rollback; **11 targeted cases
  passed** after the fix, including retained work and no-send replay. Independent
  review found stale generated TypeScript; regeneration, schema-drift checks,
  TypeScript compilation and canonical Python checks resolved that finding.
- The original Reading-room turn recovered automatically from its existing final
  receipts: state `partial`, reason `waiting_for_user`, one saved document and one
  assistant reply. Exact prepared-request and event journals are unchanged;
  **zero new product requests or reservations** were needed for recovery.
  The document is `45f11fee-9dd2-44dd-ba36-c664b980355a`. It was opened on desktop
  and phone; a protected human note was saved through the 390px phone editor and
  verified after reload in both editor and result views, with no horizontal overflow.
- This does **not** make the failed scheduled cycle a pass. Same-turn draft
  discovery/binding remains broken (two actual RED cases, proposal control GREEN).
  One Astra implementation worker is active in
  `/home/ubuntu/workagent-draft-binding-20261022`, implementing receipt-bound early
  publication of new drafts while retaining human-edit and context fences.
- Garden's responsibility remains UI-confirmed paused, and its unresolved
  count-only attempt remains untouched. No historical unknown was cleared.
  Product generation reservations added by this failed exercise: **$1.86228**,
  not billed spend. Current reservation total $34.51348; cumulative allocated
  authority $63.75792 of the unchanged $100 ceiling. Developer-tool billing is
  separate and not available here.
- UI follow-up for Claude: the partial-turn banner says work is not saved despite
  displaying the recovered saved document, and the document-side reply cannot link
  its version. Neither was edited or counted as resolved. Evidence:
  `/home/ubuntu/workagent-stop-reasons-evidence` (XML, review, installation,
  `live-recovery-verified.json`, desktop/phone captures, `phone-edit-verified.json`).

## Repeated-work verification and live capacity correction

Latest: final capacity/alpha-budget/repeated-work run **101 passed, zero failed,
errored or skipped**; full-diff independent Astra re-review PASS after the drift
fix. Private candidate `cumulative-input-capacity-20261021` at
`bd6aed7d130e2279900fd24402c871cf5071afd3` is installed and read back ready/idle;
migration 043 checksum, exact tested files and unchanged pre-install accounting
were verified. Parent feature branch contains the correction as `0dc09370`.
Web is unchanged. Successor `workagent-continuation-20261021-10` provides at most
32 further generation reservations ($6.62144), with aggregate allocated authority
$63.75792 within the existing cumulative $100. This is allocation, not billing.
The fresh Home exercise **failed** before the requested repeated-work cycle:
Garden `da14559b-4d3a-4a96-9077-acdddeeafdf1` drafted an artifact, but subsequent
saved-work discovery could not see it; it recorded an unbound responsibility with
an already-due check-in. Responsibility `6b388f51-3d87-46d9-ba3d-e50afc8297c4`
was paused through the UI and read back confirmed. Garden's selection_5 has a
count reservation without a terminal count receipt; the worker logged HTTP window
closed before I/O. It remains unresolved, not replayed or rewritten.
Reading-room `9d41e296-c4f7-40f5-84d2-1d6cce8f8806` reached a receipted final
answer but publication repeats a runtime failure. Parent reproduced all three
continuity stop variants failing at products.py:464: `Run.stop_reason` allowed
only `budget_limit`, while the worker writes `blocked`, `waiting_for_user` and
`step_limit`. The narrow model/contract fix and replay tests are running in
`/home/ubuntu/workagent-stop-reasons-20261022`; independent review is active.
Astra is separately preparing an executable same-turn draft-discovery/binding
regression in `/home/ubuntu/workagent-draft-binding-20261022`.
Twelve stale automated preview tabs were closed, leaving one. Their polling
confounds latency; observed database timeouts are not yet fully attributed.
No fresh repeated-cycle or complete phone-use pass is claimed. Development
continues; the failed exercise is retained as evidence rather than repaired into
an apparent pass. The bullets below retain the earlier capacity diagnostic sequence.

- Controlled PostgreSQL/HTTP verification: **18 passed, zero failed/skipped**
  across repeated ownership, sustained continuation and check-in boundaries.
  One shared grant drove five runs across two responsibilities: changed human
  input/steering, worker recreation after retained publication receipts, a paused
  responsibility while its peer advanced, and an unaccepted proposal based on the
  human-edited revision. Duplicate visits added no sends or effects. Independent
  Astra static review of the new regression: PASS. This is not fresh live-model
  or desktop/phone proof.
- Live preflight remained on `reply-bound-20261021`, with unchanged reservation
  total `$32.65120` and three retained unknown-usage steps. Only two generation
  slots remained. Preparing further bounded authority exposed the stale 5,120,000
  aggregate input ceiling: it still assumed 20k rather than 50k per generation.
  Preflight failed before live writes or new product calls.
- A narrow correction is under verification in
  `/home/ubuntu/workagent-cumulative-input-capacity-20261021`: 256 x 50k input
  capacity, unchanged generation/count/output/dollar caps, additive migration 043,
  unchanged historical rows. Six real SQL acceptance probes failed before the fix.
  Independent review caught a numeric-prefix drift-check flaw; two real failing
  tests reproduced it before the SQL token-boundary correction. Final tests and
  re-review are active, not yet claimed passed or installed.
- Evidence: `/home/ubuntu/workagent-repeated-continuation-evidence` (initial
  `final.xml`, review verdict, capacity RED probes and separately named final runs).
  Continue with private installation and actual repeated-work UI proof after the
  correction is verified; no new user checkpoint approval is needed.

## 2026-10-21: older budget/guard regression batch closed

- Final targeted rerun: all 33 cases passed, with no errors or skips. Baseline was
  30 passes and three failures caused by fixtures retaining the old reservation
  cost and generation counts. Independent Astra static review passed.
- Test-only changes use current reservation constants, leave one generation before
  the unchanged synthetic $20 cap, and preserve SQL-denial, concurrent-workspace,
  successor-accounting, retained-unpublished-work and no-refill assertions.
  Successor prefill uses 95 genuine synthetic generation reservations; the useful
  96th is admitted and the next is denied. No ledger fabrication or refunds.
- No runtime code, migration, web, contract, grant, allowance or live-data changes.
  Private runtime remains `1dd509a7a65e3a97d862b2c1f79ce7c6190c2e99`; no restart or
  installation was needed. No paid product calls were made by these tests.
- Evidence: `/home/ubuntu/workagent-budget-fixture-evidence/`, especially
  `baseline.xml`, `final.xml` and `review-verdict.txt`.
- This bounded follow-up is complete. No coding/test successor has been launched;
  development is stopped at this checkpoint, not silently continuing. The private
  app remains available. The full backend suite and overall product completion
  are not claimed.

## Earlier checkpoint: assistant output persistence bound aligned

- Running private candidate `1dd509a7a65e3a97d862b2c1f79ce7c6190c2e99` at
  `/home/ubuntu/workagent-candidates/reply-bound-20261021`; tested-file hashes,
  installed source, readiness and idle execution state verified after startup.
- Durable assistant text accepts the general reply schema's 12,000-character
  maximum. Human commands and stored human/system text retain 10,000. Rejected
  text/author assignments preserve the original object instead of leaving an
  invalid partial mutation. OpenAPI regenerated; canonical export check passes.
- Scope correction: private alpha's `AlphaReply` deliberately still caps selected
  replies at 10,000. No provider schema/policy pin or grant was widened. Existing
  status-bearing explanation shortening is also unchanged. This is a persistence
  consistency fix, not a new 12k private-alpha output entitlement.
- Initial DTO regressions reproduced five failures; parent reproduced two more
  assignment-mutation failures. Final targeted verification: 26 passing, no skips,
  including four restricted-PostgreSQL publication/replay cases using controlled
  transports. Independent Astra review passed the production diff. Parent then
  corrected the additional test fixture to use the general profile and unescaped
  Unicode JSON; no production budget checks changed. No full-suite claim.
- No new product calls, migration, grant, route, allowance or private-data access.
  Backup and exact retained-data hashes verified; post-start budget remains
  $32.65120 reserved with three historical unknown liabilities. Saved human table
  revision and pending proposal remain unchanged. Existing web build reused.
- Evidence: `/home/ubuntu/workagent-reply-bound-evidence/`, especially `red.xml`,
  `assignment-red.xml`, `parent-complete.xml`, `review-verdict.txt`,
  `review-scope.md`, `verified-manifest.json` and `post-install-verified.json`.
- Active follow-up: bounded regression run of the older budget-carryforward and
  adaptive-guard fixtures against current input-budget rules, under a disposable
  restricted test role. Evidence: `/home/ubuntu/workagent-budget-fixture-evidence/`.
  This is verification work, not a running coding worker or additional live trial.
- No default-branch merge or production deployment; broader mission remains active.

## Earlier checkpoint: settled-count lease handoff installed; no live speedup claim

- Running private candidate: `829d8ef5688d53bf4539999ef6cd02ed70e8841c`,
  `/home/ubuntu/workagent-candidates/settled-count-handoff-20261021`. Readiness
  verified; services active. Existing web build unchanged.
- A successful token count with no generation dispatch can now hand off an
  unusable lease immediately instead of waiting for expiry. The next fenced visit
  reuses the exact prepared request and count. Existing active-I/O, unknown-send,
  problem/cancellation, authority and fencing checks are unchanged.
- Isolated implementation was unable to connect to PostgreSQL in its sandbox and
  did not claim a behavioral pass. Parent independently reproduced all three RED
  cases against the old guard, applied the reviewed change, and ran all 29 targeted
  handoff cases successfully under the restricted database role. Tests include
  intake/general/adaptive reuse, accounting, stale capability, active I/O and
  revoked/changed authority. No full-suite claim.
- Code-only installation used a verified backup and retained-data hashes. No
  migration, grant, route, allowance or scope change. Post-start readback confirms
  unchanged accounting ($32.65120 reserved, three historical unknown liabilities),
  the same saved human table revision and its still-pending proposal. No additional
  paid product calls were made for this increment.
- Controlled tests prove removal of this lease wait; they do not establish a live
  end-to-end speedup or explain the whole earlier 253.617002-second local gap.
- Evidence: `/home/ubuntu/workagent-lease-handoff-evidence/`, including
  `parent-{red,green}.xml`, `parent-review.json`, `installed.json`, `readiness.json`,
  and `post-install-verified.json`.
- Next bounded implementation: the independently confirmed 12,000-character model
  reply versus 10,000-character saved-message mismatch from Claude's handoff.
  Preserve human-input bounds and regenerate canonical contracts; no live product
  calls or deployment by the isolated worker. Broader mission remains active.
- No default-branch merge or production deployment.

## Earlier checkpoint: original conversation recovered; varied table task passed

- Running private candidate: `8aeec66ec10eb1ac96122b10e25dfdd9b994eaa9`,
  `/home/ubuntu/workagent-candidates/turn-recovery-20261021`. No web implementation
  changes, database migration, new grant, route renewal, allowance or private-data
  expansion. Installed after a verified backup; retained data/accounting matched.
- New human steering can fence an interrupted turn when every sent step has exact
  terminal receipts and committed local effects. A later prepared step with zero
  journal events is provably unsent and may be fenced, not replayed. Unknown sends,
  unapplied results and ambiguous events remain blocking. Details: `docs/TURN_RECOVERY.md`.
- TDD reproduced both the original denial and the actual zero-event trailing step.
  Latest targeted batches cover 22 distinct passing cases. Independent gpt-6-astra
  static review passed, then narrowly rechecked the unsent-tail delta; locking and
  fencing were inspected, not newly concurrency-load-tested. No full-suite claim.
  Reviewer calls are developer-tool use, not product-ledger evaluation charges.
- Original conversation `6dfa709d-eb3f-4404-89ca-a42d27546f9c` recovered through its
  normal message UI. Old run `2a3cf395-7ba4-47e5-aef4-a28513659dde` is cancelled;
  new run `3642ec7f-4fd3-40ce-b8d9-4da71afb75f8` replied successfully. Exact old
  attempt/step/event hashes stayed unchanged. Human revision
  `22e96383-ea9e-4b92-80c1-5c7cc74b3ae1` and both paused handovers stayed unchanged.
  The old goal was not relabelled complete and no old operation was replayed.
- Varied live task: Home created an editable volunteer-rota structured table in
  conversation `6f85265d-a0bc-4e6b-b02c-66b5a6fee83e`. A human changed Pack-down End
  to `12:45` and saved a no-personal-details note. Follow-up produced pending
  proposal `18cb75f0-eb64-4521-bbdb-8857002f388d` against human revision
  `ec4eb168-71be-4fb7-9adc-666b5b70759c`, adding a Check column while preserving
  every existing cell and the full note. The saved revision is unchanged; nothing
  was accepted/distributed. Desktop and 390px phone-width return views checked.
- This increment reserved +$1.65536, not billed spend. Current shared reservation
  total is $32.65120 against installed $33.06504, leaving $0.41384/two generation
  slots. Aggregate allocated authority remains $57.55032 within cumulative $100.
  All three historical unknown liabilities remain; no additional allocation made.
- Recovery reply latency was 344.265122 seconds, versus 77.55005/80.436438 for the
  table turns. A read-only Astra audit found a 253.617002-second local count-to-dispatch
  gap and a specific settled-count handoff omission; exact attribution of the entire
  gap remains unproven. A bounded Astra implementation worker is active in isolated
  worktree `/home/ubuntu/workagent-lease-handoff-20261021`, branch
  `hermes/settled-count-handoff`. It owns only the handoff guard and focused tests,
  with no live product calls or deployment permission. Parent integration/verification
  remains required. Evidence: `/home/ubuntu/workagent-lease-handoff-evidence/`.
- Evidence: `/home/ubuntu/workagent-turn-recovery-20261021/`, including
  `recovery-{red,final,regressions}.xml`, `unsent-tail-red.xml`, `review*-verdict.txt`,
  `installed.json`, `recovery-{before,after}.json`, `varied-verified.json`,
  `varied-{desktop,phone}.png`, and `latency-evidence.json`.
- No default-branch merge or production deployment. This recovery increment is
  delivered; the broader build mission remains active, not declared complete.

## Earlier checkpoint: 50k input budgeting installed; fresh scheduled cycle passed

- Running private candidate: `9be5a541ccda6b8c3f136bbbffe175b211de2d01`,
  `/home/ubuntu/workagent-candidates/paused-context-20261021`. API/web/worker
  readiness verified; unchanged frontend build `cbtj8hC3EMVpHTJz7R2ei`.
- Implemented all five input-budget changes: 50,000-token exact-provider preflight,
  complete-request local budgeting with continuation headroom, identical structured
  body references, compact inactive lifecycles with frozen scoped detail retrieval,
  and content-free size metrics. See `docs/INPUT_BUDGET.md`. Local counts are estimates,
  not provider counts or billing. Offline replay of the earlier rejected request
  estimated 9.9% fewer input tokens; no historical request was rewritten.
- Installed migrations 041/042 after backup/archive verification. Retained saved
  work, requests, receipts and accounting hashed unchanged. Historical count
  rejections retain their original 20k semantics; unknown sends remain blocking.
- Latest results across the integrated targeted batches cover 129 distinct passing
  cases, with earlier failures retained and superseded by reruns. Independent review
  found a non-adaptive budget-stop defect; it was fixed with a red/green regression.
  This is not a full-suite or single-run green claim.
- A live request counted 17,241 input tokens and recorded its handover, then exposed
  an older paused-handover bookkeeping defect. A narrow fix preserves only the
  receipt-bound own refresh when all substantive lifecycle fields are identical.
  Eight regression cases now pass, including real human-control rejection. The fix
  is installed with identical retained data, grant, route and accounting.
- Interrupted run `2a3cf395-7ba4-47e5-aef4-a28513659dde` remains blocked: its check-in
  passed during diagnosis and its handover was subsequently paused. A new message
  in that conversation is refused as unresolved. No replay/history rewrite was
  forced. This remains a recovery/usability limitation, not a clean pass.
- Fresh synthetic conversation `b7f68f2a-6501-4820-b35b-883ce93c56e0` was created through
  Home. Initial run `620a3358-e3c5-4ddd-abbe-276c3694fce0` completed and saved editable
  document `7d804d72-b6c9-4acb-b98b-1958b6696f15`. The complete fresh cycle passed:
  ask → saved work → handover → human edit → leave → planned worker restart →
  unattended scheduled continuation → return to a pending proposal. No code,
  configuration or repair was applied during this fresh cycle.
- Check-in was scheduled for `20:13:22.268263Z`; the dispatcher admitted continuation
  `f772b736-a36e-42ed-8090-cff03ffdde47` at `20:13:22.804086Z` (0.535823 seconds late,
  not early). It freshly fetched W3C once and published pending proposal
  `c32f3cf1-7502-4d11-a321-1a6facfa2c29` at `20:15:47.048425Z`. The current human
  revision `7ce9a31c-ff6c-4c20-9f79-8ff515719617` remains authoritative and is the
  proposal base. Both full human notes are preserved. The handover waits for a
  person with no next check-in; the proposal was not accepted or distributed.
- The terminal read-only verifier checked schedule timing, fresh source reads,
  unique generation phases, exact provider counts, unchanged human revision,
  pending proposal and the three historical unknown liabilities. All five
  continuation counts were below 50k. A public read remains observation, not goal
  verification. Browser return controls and the saved human edit were checked at
  desktop and 390px phone width, with no horizontal overflow; no physical-device
  or printed-output accessibility claim is made.
- Existing cumulative authorization remains $100. Aggregate allocated authority is
  $57.55032, not billed spend. Installation activated at most $4.96608 of further
  generation reservations (24 generations/32 counts) with all earlier usage and
  three unknown liabilities retained. No second allowance, new route or private-data
  scope was created. Post-install generation reservations total +$2.89688, including
  the interrupted attempt and fresh journey; these are not provider billing.
  No default-branch merge or production deployment.
- Evidence: `/home/ubuntu/workagent-input-optimization-20261021/`, including
  `targeted-test-summary.json`, `installation-verified.json`, `paused-refresh-{red,green}`,
  `paused-fix-installed.json`, `paused-fix-readiness.json`, `fresh-{edited,planned-restart,
  after-restart,complete}.json`, `verified-f772b736-a36e-42ed-8090-cff03ffdde47.json`,
  and `fresh-return-{desktop,phone}.png`.
- This input-budget increment is delivered. Broader mission work, including safe
  recovery of the older blocked conversation, remains open. No autonomous coding
  successor is active at this checkpoint; application services remain running.

## Earlier checkpoint: migration 040 installed; recovery passed, clean repeat failed

- Running private candidate: `4bf4d505c4699f24174b92979af39047bf725aec`,
  `/home/ubuntu/workagent-candidates/retained-read-20261021`; same verified web build.
  API/web/worker active. No default-branch merge or production deployment.
- The earlier failing DB test had not applied migration 040: `context` seeds data,
  but does not migrate. Applied the migration explicitly using the disposable owner
  DSN and verified its checksum, installed function and replay. All 24 focused
  follow-through/continuity cases pass under the restricted runtime role. Contracts
  match. No full-suite claim.
- Installed migration 040 after `pre-migration-040.dump` and archive-list verification.
  Before/after hashes of retained work, requests, contexts, attempts, events, grants,
  dispatch records and accounting match. Route evidence is unchanged.
- Continuation `c0890cf0-ecf6-462f-8c7c-aff7c0f5a61d` recovered and published pending
  proposal `c07f450c-6cb8-42e3-8482-3ac2c6a2cdfc`, preserving human revision
  `22e96383-ea9e-4b92-80c1-5c7cc74b3ae1` and the editor note. The responsibility now
  waits for feedback with no further check-in. This is recovery evidence only.
- A new conversation-request cycle recorded responsibility
  `14929614-e5c9-4dcd-8ea1-abdf290131ea`, but its initiating run
  `3484f86c-efd1-4bc7-b617-658ef579a62f` hit `input_count_exceeds_limit` at selection_2:
  20,039 tokens versus 20,000. The prepared request and count rejection are retained.
  The cycle did not reach the later-edit/restart test and is NOT a clean pass.
- Input-packing diagnosis: the failed request's model context contains 22,079 JSON
  characters of messages, 16,697 of work-area context and 4,703 of action observations.
  Removing duplicate discovery schemas was not a general solution for growing
  conversation/hand-over context. No stored request has been rewritten to hide this.
- Current grant: 193/199 count calls consumed; six remain, versus eight planned for
  another full repeat. Eight generation slots remain. Evaluation reservations are
  +$5.40872; three historical unknown liabilities remain. No allocation, grant limit
  or request-size limit was raised. These are reservations, not provider billing.
- Engineering stopped at this bounded verification checkpoint; no coding worker is
  active. Application services remain running. Next work is bounded model-context
  packing plus sufficient existing-authority request-count capacity for another full
  live repeat. Claude's `be3bc57` UI diagnostics handoff is ready but not integrated.
- Evidence: `/home/ubuntu/workagent-reset-20261020/`, including
  `saved-read-followthrough-final.{log,xml}`, `retained-read-runtime-migration.json`,
  `retained-read-installed.json`, `verified-c0890cf0-ecf6-462f-8c7c-aff7c0f5a61d.json`
  and `clean-fifth-recorded.json`.

## Earlier checkpoint: recovery fixes installed; fresh live cycle in progress

- Running private candidate: `4048e8f6eeb9afee0e29e2bca1afbf8e3dcbac72`,
  `/home/ubuntu/workagent-candidates/compact-context-20261021`, web build
  `cbtj8hC3EMVpHTJz7R2ei`. Readiness verified. Migration 039 applied after a
  verified backup; retained work, request histories, grants, budget and route evidence
  hashed identically before/after migration. No new allocation or evidence renewal.
- Installed recording-context normalization and implicit scheduled-wait boundary:
  the run's own receipt-bound bookkeeping cannot invalidate its frozen context;
  `next_check_in_at` without an explicit wait object still prevents early work.
  Human edits, controls and actual authority changes remain fenced.
- Installed per-run closed dispatcher diagnostics and safe new admission past
  cancelled prepared-only attempts with zero request steps/events. Old attempts and
  accounting are unchanged. Prepared requests and ambiguous sends remain blocking.
  Also fixed execution status ordering: Run has `observed_at`, not `created_at`;
  random IDs must not hide the newest run from the bounded status list.
- Independent implementation handoff: `handoffs/backend/STALLED_TURN_STATUS.md`.
  Parent reviewed the diff; 96 child cases verified from JUnit. Integrated recovery
  and timing checks plus status-ordering regression bring that set to 106 unique
  passing cases. TypeScript passed. No full backend-suite claim.
- Recovery now verified for both earlier failed cycles. Latest continuation
  `91babe5d-274f-48d0-9ef1-111fe0d443f4` fetched W3C again and published pending
  proposal `c16ceab1-ec53-45d6-977c-cbfa0d30a416` against human revision
  `452d5634-1aad-4e1a-a2a5-f0752bcc357c`. The two-page edit and editor note survive;
  the responsibility waits for feedback with no further check-in. This is recovery,
  not an uninterrupted scheduled-cycle pass.
- A fresh request then hit a known input-count rejection before recording a handover:
  22,428 tokens versus the unchanged 20,000 limit. Full capability schemas duplicated
  the schemas already sent with the function definition. Installed a model-input-only
  projection removing that duplication; retained tool receipts remain complete.
  A fresh explicit human turn may supersede an exact count-rejected request only
  when every earlier send/action is settled; automatic retry and unknown sends remain
  held. 39 focused input/context/admission/acceptance cases pass. The failed request
  is retained; this fix did not rewrite or resend it.
- A fresh six-minute handover request has been sent through the ordinary composer.
  Hermes is continuing the actual edit/leave/restart/return check. It is not yet a pass.
- Claude remains web owner. Installed frontend verification: 44 DOM regressions,
  345 unit tests and production build; 390px browser layout and saved edits checked.
  Physical-phone testing is not claimed. Backend now supplies optional fixed
  `failure_reason`/`next_action`; current UI still uses its legacy category fallback.
- Last measured evaluation reservation increase: $4.08952. Bound: $6.33216 / 48
  generation slots within existing grant limits and cumulative $100 authority.
  Historical unknown-usage liabilities remain reserved. No new allocation. These
  figures describe reservations, not provider billing.
- Evidence: `/home/ubuntu/workagent-reset-20261020/`. Earlier failed/late journeys
  remain failed/late evidence; the mission remains active and incomplete.

## 2026-10-19: result-first candidate running; phase incomplete

This section supersedes the historical checkpoint below. The full phase is NOT
accepted: phone outcome density still needs the sole frontend owner's fix, and
the live scheduled follow-up failed before the timing fix was installed.

- Running application: `a8be0900a372e067226655edc790fd294cf6e8a3` in
  `/home/ubuntu/workagent-candidates/phase2-combined-20261019`, web build
  `lk4BYZ8UTVn1Z3csBZ2ls`, private loopback review stack only.
- Claude remains sole web owner. Integrated through `617990f`: outcome/result-first
  Home and responsibility pages, paged Home summaries, clearer conversation
  check-back/steering, explicit decision prompts and preserved document line breaks.
- Backend: SQL-side budget aggregation, operator-evidence reload without timestamp
  renewal, bounded public HTTPS retrieval, scoped paged Home summary, and a fix
  preventing changed dependencies from overriding future scheduled check-ins.
- Activation08 was code-only with $0 added allocation. Before/after retained-row
  hashes and budget match; readiness passed. The $100 cumulative ceiling and
  $53.63960 allocated authority remain unchanged. Three unknown-usage steps remain
  reserved. No default-branch merge, production deployment or private-data expansion.
- Verified installed Home → saved newsletter; responsibility → canonical workshop
  result; reply steering; refresh and human notes; desktop and 390/320px layouts.
  No horizontal overflow observed. Physical-phone/user-device testing not performed.
- 341 web tests, TypeScript, lint and production build passed. Targeted backend
  evidence resolves 70 unique cases across the initial suite and corrected race
  rerun; no full-backend-suite claim. Race tests now allow normal bounded visits
  and use short in-process mock HTTP timeouts rather than exhausting a live-network
  allowance on the loaded host. Production timeout safety was not relaxed.
- Live unfamiliar-task evidence: ordinary Home request fetched W3C guidance and
  saved a source-linked newsletter checklist. A protected human note and later
  print-distribution edit survived refresh and worker-only restart, with all three
  revisions retained. The scheduled continuation started 71.057242 seconds early,
  was cancelled when the due-time changed, and produced no proposal. No unknown
  request was replayed. The failed test responsibility was taken back through its
  normal UI control. The timing fix subsequently passed real-clock/restart tests
  with a synthetic provider, but has NOT been re-proven in a live model journey.
- This journey reserved $1.45112 across 11 generations, not provider billing.
  Development/review tooling is outside that ledger; current final tooling cost
  has not been reconciled (last earlier Claude-lane accounting was $10.584020).
- Remaining UI acceptance issue: the full outcome paragraph pushes the result and
  steering down on phone. Requested faithful concise/expandable treatment from
  Claude in [6278283661](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6278283661).
  A posted request is not proof of an active successor.

Evidence: `docs/evidence/result-first-20261019/`; private detailed evaluation and
activation records: `/home/ubuntu/workagent-phase2-20261019/`. Product code remains
running; no autonomous engineering successor is established by this checkpoint.

## Historical: delivery reconciliation complete; alpha experience not accepted

**The requested first delivery step is delivered:** the shared feature branch contains
the identified running review candidate, and the retained responsibility opens its saved
checklist through the intended conversation-owned interface. This is not full alpha or
mission acceptance. The mission remains a general, persistent, useful work partner.

### Published and actually running

- Application commit: **`8d37f75bb365140dc5b971f806349e6ad87e93cc`**, published on
  `hermes/build-mode-continuity` / [PR16](https://github.com/alindebergASL/Workagent/pull/16).
- Frozen runtime directory: `/home/ubuntu/workagent-candidates/result-link-20261019`.
- Web build: **`kpjoA0f1_sg1VSgVHyGNd`**, built with natural admission enabled and
  the real same-origin API using the credential-free launcher build environment.
- API/web/product worker restarted **2026-10-19 17:38:30 UTC**. Systemd startup
  records and `/proc` working directories were read back against the frozen source.
- The subsequent documentation/evidence commit does not change application bytes;
  use the application SHA above to identify the tested/running implementation.
- No default-branch merge, production deployment or expanded private-data access.

### Ownership and preservation

Hermes resumed attended integration ownership after gateway readback showed the earlier
build/recovery sessions not running (previous build owner's pending queue empty) and
process inspection found no competing coding/test writer. The original five-path diff
and files were preserved in `/home/ubuntu/workagent-reconcile-20261019/preserved-files/`
and `preserved-start.diff` before changes. Historical supervisor UNKNOWN admissions
were not reset or replayed.

Claude remained sole frontend implementation owner, working in an isolated checkout.
Her `1e18a4b9a0110e8910efae54e0713c7be8f84c45` was integrated as `8d37f75`.
The prior owner frontend `891a457` was already integrated; Home routing was not a
missing merge and is no longer the earlier entry blocker.

### Changes reconciled and published

1. Previously installed/local `bcb4595e7dce7fc66215b44be0975077bede942f` is now published.
   It projects only the responsibility's actually published continuation artifacts,
   without moving their conversation ownership or accepting/revising them.
2. `dfa5a55` keeps those rich products out of legacy assignment projection; genuine
   assignment-owned artifacts remain supported. This compatibility change alone is
   **not** the delivered UX—the following frontend change completes it.
3. `8d37f75` adds **Saved work** to the responsibility, reads canonical artifact
   metadata with bounded concurrency, and links the actual saved title to its
   conversation artifact route. Denied reads discard retained titles; failed/stale
   reads are explicit. The legacy adapter does not coerce conversation products.
4. `1c7f956` records Andrew's explicit **$100 cumulative** model-testing ceiling,
   including all previous allocations/reservations/unknowns, not a fresh $100.

### Actual browser verification on the final candidate

Before integration the retained responsibility failed with **“This product belongs to
a conversation.”** After integration:

- The responsibility loads, truthfully shows **Waiting for a person**, and says
  nothing is currently running for it.
- **Saved work → Workshop opening checklist — 8 volunteers** opens
  `/conversations/17e886ef-b952-41a1-b4b1-4c3aebb19125/artifacts/0c3b5475-ee24-4a18-85d6-1abce53f7aca`
  with the correct workspace query parameter.
- The actual saved checklist renders, including corrected staffing, the no-contact
  statement and human-review limitations. It is not a reconstructed demo output.
- The result remains accessible after a full refresh. A freshly reloaded responsibility
  still exposes the canonical link. This was repeated at 390×844 phone emulation;
  the result had no horizontal page overflow. Physical-phone testing is not claimed.
- Home loads its composer and links the retained responsibility. This pass did not
  submit a new Home/model request; earlier paid Home admission evidence is reused.

Canonical owner remains `conversation_id=17e886ef-b952-41a1-b4b1-4c3aebb19125`,
`assignment_id=null`. The checklist's exact current revision is unchanged:
`1ca2804e-3ccc-48e5-a8e9-908e7c301340`.

Before/after hashes match for all inspected retained rows in assignments, artifacts,
revisions, proposals, conversations/messages, provider attempts, response events/steps
and budget carry. Shared accounting also matches exactly. **Zero new product-model
count, generation, read or cancel calls were made for this delivery step.**

### Fresh checks and their limits

On frozen `8d37f75`:

- **17 focused backend checks passed** on real disposable PostgreSQL, covering sustained
  output projection/ownership, maintained continuation, execution categories, revocation
  scope and retained-count budget classification. Generated contracts match Python.
- **337 frontend tests passed**, plus typecheck, lint and production webpack build.
- Fresh real-browser checks described above, desktop and phone emulation.
- Independent Hermes/Astra static review returned scoped **no-blocker** for canonical
  routing, access/ownership, compatibility and allowance conservation. It did not execute
  the activation or substitute for the subsequent runtime readback.
- Activation dry-run and actual post-activation state readback passed. The first dry-run
  exposed a distinction between the runtime's pinned route/data/effect authorization
  hash and the new cumulative-budget approval; the helper now retains the former and
  separately records the latter. No application gate or historical binding was weakened.

A preliminary snapshot **including the deferred performance patch** produced 19 pass /
4 fail. One failure is a concrete reason not to ship that patch: omitting adaptive
readback changes budget-blocked classification into generic work-blocked. The final
candidate retains full semantics and its budget-classification test passes. Three other
preliminary failures expected multi-phase completion in one dispatcher visit but observed
working/provider-pending. They were not weakened or represented as resolved by this
focused run. An initial final-run invocation also had two incorrect test selectors and
collected no tests; the corrected 17-pass invocation is the reported result.

No full-current-head backend-suite pass is claimed. Earlier scoped lease/recovery,
15-case context discovery, human-edit/proposal and real-model journey evidence is reused
where unchanged—not reported as freshly rerun here. The successful retained checklist
required earlier rejection/recovery fixes; it remains evidence of eventual preparation,
not proof of on-time intervention-free scheduled delivery.

### Current authority and accounting

Installed successor: **`workagent-standing-20261019-06`**, predecessor
`workagent-standing-20261019-05` revoked compatibly for new admissions only.

| Item | Verified amount/count |
|---|---:|
| Cumulative model-testing authorization | $100.00000 |
| Previous aggregate allocated authority retained | $47.04360 |
| Bounded addition: 50 generation slots × $0.13192 | $6.59600 |
| New aggregate allocated authority | $53.63960 |
| Authorized but unactivated remainder | $46.36040 |
| Current project reservation ceiling | $29.15432 |
| Shared reservation, unchanged by this step | $21.23912 |
| Remaining installed reservation headroom | $7.91520 |
| Remaining generation/count slots | 60 / 60 |
| Retained unknown usage steps | 2 |

Carry is included, not refunded. Historical bindings and attempts remain unchanged.
The same official `gpt-6.1-sol` route, principal/workspace, synthetic-only context,
storage acknowledgement, per-run step/cancel limits and data/effect boundaries remain.
The existing stricter project-level schema ceiling did not need expansion for this
bounded increment. Reservations are not verified provider billing.

Development tooling is separate: Claude's `claude-fable-5` implementation lane reported
**$10.584020** against its $12 CLI cap. Hermes/Astra integration/review usage has no
separately reconciled invoice in this evidence. Neither is silently deducted from or
presented as product-ledger model-testing consumption.

### Remaining local changes and operational issue

Exactly two pre-existing performance files remain modified in the integration checkout,
**not committed, not included in the frozen candidate and not installed**:

- `backend/workagent/execution_status.py`
- `backend/workagent/products.py`

Their original contents and a deferred patch/probe are preserved outside the checkout.
The attempted shortcut drops adaptive semantics required for budget/review classification;
do not publish it unchanged. The source/authority and frontend fixes are separate.

The authenticated execution endpoint returned HTTP200, **idle** and
**`can_advance_authorized_work=true`**, but its measured final read took **6.018 seconds**.
The launcher uses a five-second readiness deadline, so its aggregate `ready` probe still
reported false. This is an observable latency/readiness defect, not proof that the worker
lost authority; it was also present before this rollout. Do not advertise a completely
green readiness probe or solve it by silently suppressing semantic fields.

Next engineering action: repair shared-accounting/status-read cost while preserving
adaptive budget/review classification, then recheck the existing five-second readiness
probe. Home's aggregate feed read cost, broad tools/public retrieval, persistent timing,
account integrations, memory/learning (#10) and user-device acceptance remain backlog.

### Review and handoff

[Review access and retained-work links](docs/REVIEW_ACCESS_20261018.md).
[Fresh verification manifest](docs/evidence/reconciliation-20261019/verification.json).
[Runtime/accounting readback](docs/evidence/reconciliation-20261019/verified-delivery.json).
Screenshots in the same evidence directory are actual captures of this candidate.

This bounded delivery step has no unfinished implementation/test/review job being
represented as an active successor. The product worker continues within the installed
grant; the retained responsibility correctly waits for the human. No unattended
continuation of the broader development backlog is claimed. Deferred work remains
explicitly identified for the next integration owner, rather than silently shipped.
