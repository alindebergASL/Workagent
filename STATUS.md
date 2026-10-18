# WorkAgent — implementation and delivery status

## 2026-10-18: working private review candidate, experience not accepted

The mission remains a general, persistent, useful work partner. These are reusable
capability/runtime increments and an actual retained-work journey, not a claim
that a workshop example or a green suite completes the product. Memory and
learning remain sequenced through issue #10.

### Published and running

- Running development candidate: `f9179a01c711bbb9d02f5f4eb57d46c42a0920e9`,
  `/home/ubuntu/workagent-candidates/f9179a0`.
- All three services actually restarted at 2026-10-18 01:30:04 UTC; systemd
  definitions and process working directories match that frozen checkout.
- Web build `fwb8IMkPdDNGS__bEwy_6`, built with real natural admission enabled
  at `907f4b6`, reused after proving frontend/contract/runtime bytes identical.
- Claude owner head `ddd4acc` (including `60cda46`) was merged at `907f4b6`:
  clearer responsibilities, stale calculation indicators, human-confirmed exit
  from unconfirmed requests and post-save refresh handling. Claude remains the
  sole web implementation owner.
- Earlier local increments `e51de17` and `5f70a73` are published. Scoped saved-work
  discovery and durable background context landed through `8fa48fd` / `c555c3c`.
- Launcher fix `f9179a0` honors component-only control and waits for explicit
  service stops rather than mistaking a stopping target for full quiescence.

### Working behavior verified

Real `gpt-6.1-sol` work advanced under the installed allowance, not merely a
healthy process. The retained conversation produced an ordinary text answer,
a shorter answer, an agent-chosen editable table from an attached CSV, a proposed
revision preserving a human stock correction and exact approval note, and one
accepted revision. Later changed facts were answered without changing the saved
table. A ninth human turn completed across a service restart by retrieving the
same accepted provider response, without a second generation for that phase.
Historical held requests were not replayed; the two existing paused
responsibilities remain paused.

Measured server completion for the six newly executed turns through the ninth
human message: 36.05s ordinary answer, 31.78s shorter answer, 73.41s table,
46.55s revision proposal, 47.13s unavailable-source alternative, 69.79s later
update including restart. The shorter answer was browser-visible at 32.471s,
with a 103.2ms message acknowledgement. It reduced 76 whitespace-delimited words
to 35 while retaining recommendation and trade-off. The timing evidence separates
pre-count delay, count/submit event windows and known-ID polling windows; those
windows include ledger/queue work and are not pure provider latency.

A tenth human turn completed on the final frontend/build in 52.96s server time,
with a 2.619s browser-observed message acknowledgement. It retained the latest
borrowed-stock/requirement facts, offered approval and preparation steps, made no
contact and left the saved artifact at revision 3. Exact browser first-result time
for this turn was not captured: the bounded message pane kept a constant visible
reply count, defeating that observer. The exact 32.471s shorter-reply measurement
above remains valid.

Final shared reservation is $19.26032, including historical carry/unknowns, with
two retained unknown usage steps. The installed allowance has capacity for at
most 25 more generation reservations ($3.298), subject to all other grant limits;
this is not an authorization increase or a billing claim.

### Authority and review access

The original cumulative authorization remains $50. Allocated authorization is
$47.04360, unactivated remainder $2.95640; current project envelope $22.55832.
Installed `workagent-standing-20261018-02` is a zero-addition compatible successor
of `workagent-standing-20261018-01`. Frontend/launcher refreshes changed no grant.
Historical reservations, unknown outcomes and attempt bindings were retained.
Reservation accounting is not a provider invoice; live usage remains bounded by
the installed finite allowance.

Execution had been unavailable because route/pricing verification exceeded the
24-hour freshness requirement, not because the heartbeat was missing. Fresh
same-model metadata/pricing evidence restored authorized execution. No new route,
public listener, default-branch merge or production deployment was authorized.

Use `docs/REVIEW_ACCESS_20261018.md` for the SSH-loopback entry and direct retained
conversation/table links. Host-side authenticated access is verified; user-device
SSH access and physical-phone behavior are not. Phone captures use Chromium
390×844 emulation.

### Validation: reused versus fresh

- Frozen `7032da5` lease/status run: 44 pass / 6 fail, retained honestly.
- Corrected frozen `6a75c32` targeted run: 13 pass. All 11 failures in the earlier
  39-pass/11-failure run have later passing case evidence.
- Frozen `6a75c32` standing/sustained/handoff run: 41 pass / 1 obsolete known-ID
  expectation. `e6071f3` replacement matrix: 4 pass; known IDs may yield/retrieve,
  while lost IDs, count problems and malformed outcomes remain held.
- Frozen `c555c3c` real disposable-PostgreSQL context/retrieval suite: 15 pass,
  generated contracts match. This covers discovery beyond the initial 12 items,
  exact SQL receipts and scope rejection, background goal/instructions/dependencies,
  proposal-only edits, maintained next actions and later-event continuation.
  These are controlled-transport tests, not live-model background quality proof.
- Across the preceding scopes, 107 distinct current cases have passing latest
  evidence; four renamed obsolete cases remain explicitly mapped to replacements.
  This is reused plus fresh evidence, NOT one full-backend-suite pass.
- Frozen `907f4b6`: 318 frontend tests, typecheck, lint and production build pass.
  The deployed build was separately compiled through the credential-free launcher
  build environment with natural admission enabled.
- Launcher regression: reproduced 11 failures before the fix; 21 tests pass after.
- Independent Astra review of `6a75c32` found no concrete new Python/SQL authority
  blocker in its scoped static review. Its three activation-helper findings were
  corrected. Later context/frontend changes are outside that review's exact scope.

### Remaining product failures and ownership

1. Home creates a conversation in the first historical workspace, not the
   workspace with usable standing authority. The real request failed with 422 and
   draft preserved. Claude was given exact evidence in PR #9 comment6243959390.
   This is distinct from the already-fixed cross-workspace Home feed. The direct
   conversation path works; ordinary Home admission is NOT accepted.
2. Public website retrieval is not installed. The agent truthfully offered an
   alternative rather than inventing prices or placing an order; that does not
   establish general research capability.
3. Latency, Home's large initial request fan-out and source/account integration
   remain product gaps. Full backend suite and physical/user-device review remain
   outstanding. No broad completion verdict is implied.
4. The historical managed dispatcher chain remains blocked/UNKNOWN, not reset.
   No unattended integration successor is claimed. Development ownership is the
   attended integration session until its explicit handoff; product-worker
   operation is separate and continues within the existing grant.

Next integration action: take Claude's Home destination fix, rebuild the exact
combined candidate, and re-exercise ordinary Home admission without widening
historical workspace authority. Preserve the full general-agent scope, not just
this retained journey.
