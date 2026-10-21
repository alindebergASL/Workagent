# WorkAgent — authoritative delivery status

## 2026-10-21: two runtime fixes installed; recovery/status work active

- Running private candidate: `f574d4094f01930b1a78276583286e7fc2b6e0bc`,
  `/home/ubuntu/workagent-candidates/checkin-boundary-20261021`, web build
  `cbtj8hC3EMVpHTJz7R2ei`. API/web/worker restarted and readiness verified.
  Code-only installation: no new migrations, grant, allocation or route-evidence renewal.
- Found and reproduced the hours-long stall: recording a second responsibility
  incremented the conversation version; scheduler bookkeeping on an older waiting
  responsibility then invalidated the recording turn's frozen context. The narrow
  normalization reconstructs the original context hash only for that exact own
  receipt-bound change. Human controls, other edits and authority checks stay fenced.
  Existing requests, histories and saved work were not rewritten.
- Core independent review found no blockers. Parent verification: 37 distinct focused
  backend/DB cases passed, including recovery, unchanged stored context/request bytes,
  pause/cancel/pause-then-resume rejection and safe closed-code denial diagnostics.
  No full backend-suite claim. Evidence: `recording-refresh-{red,green,verified}.*`.
- Claude's phone fix remains installed; additionally integrated `3877954` + `ca8a7f5`
  for visible browser-storage warnings and the editor-reopen test fix. Verified 44 DOM
  regressions, 345 frontend unit tests and production build. Installed 390px browser
  check has no horizontal overflow. Physical-phone testing is not claimed.
- Live recovery completed: recording `dfa8735a-b703-4fe8-ab01-6d77e699cf6d` published;
  overdue continuation `633d2fa3-abc2-4707-bc7f-9e19d3e71d30` automatically ran,
  fetched W3C guidance and published proposal `ee9be1f2-92d5-458f-b1f0-b63edd1bdbd1`.
  The human editor note and current human revision are preserved; proposal is pending,
  responsibility waits for a person, and no further check-in is scheduled.
  This verifies recovery, not an uninterrupted scheduled cycle.
- Fresh-cycle finding (04:45 UTC): a plan with `next_check_in_at` but `wait=null`
  admitted continuation `0aacb6ed-1fa1-415a-810d-fef4b57856eb` 73.532976 seconds
  early. The later human edit cancelled it before any response step or I/O event;
  its retained attempt is `prepared`. Replacement admission is currently held up.
  The two-page distribution edit and protected editor note are saved. This is failed
  timing evidence, not a clean-cycle pass (`implicit-wait-live-failure.json`).
- The missing-wait timing fix is now installed; 28 focused timing/lifecycle cases
  passed, including real-DB edit/restart checks and preserved explicit event waits.
  A fresh live post-fix timing pass is still pending. Isolated implementation worker
  `deleg_ce1e80e5` is fixing genuine stale-context status visibility and investigating
  safe admission past cancelled, provably unsent attempts. It has no live-provider or
  deployment authority. Its status/cancellation changes are not installed yet.
- Latest evaluation reservations increased by $3.29800;
  the three historical unknown-usage steps remain. Evaluation bound: $4.61720 / 35
  generation slots, wholly within the same existing allowance and cumulative $100
  authorization. These are reservations, not provider billing; $0 new allocation.
- Evidence: `/home/ubuntu/workagent-reset-20261020/`, including the read-only
  `verified-633d2fa3-abc2-4707-bc7f-9e19d3e71d30.json`, test logs and pre-install backup.
  Earlier failed/late journeys remain failed/late evidence. The mission is active,
  not complete; older unrelated blocked requests have not been erased or replayed.

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
