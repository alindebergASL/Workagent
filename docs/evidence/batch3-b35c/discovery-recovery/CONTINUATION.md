# Discovery continuation recovery — actual live checkpoint, study incomplete

## Result

Corrected the actual `adaptive.continuation_context` failure. Gateway discovery
returns `CapabilityPage` (`schema_version=capability-page/v2`, `items`), while
legacy composition returns `general-alpha-v1` with `capabilities`. The consumer
now distinguishes these schemas, validates v2, and rejects unknown schemas rather
than inventing empty discovery. Authority, availability/denial reasons, identity
and schema hashes remain visible. Only the model copy omits descriptor schemas,
with an explicit omission label; full immutable receipts remain unchanged.

A first correction preserving output schemas exceeded normal input capacity in
the real restricted-PG worker path (53,390 estimated tokens). That failure remains
in evidence. The corrected projection supported the next actual live selection
at 24,302 estimated input tokens (provider count/usage remain distinct). Limits
were not increased: normal 50k input / 8192 output remains.

## Verification and scoped review

- Exact retained live tool reply reproduces the old KeyError; original red test
  is retained. Corrected projection preserves all23 actual descriptors and the
  original observation byte content.
-9 focused controls pass: real gateway producer, restricted-PG worker restart,
  next selection, immutable receipt, no duplicate execution, revoke-before-resume
  denial, legacy discovery, malformed/unknown schemas and denial preservation.
-31 existing source-amendment/observer/installer controls pass (reused scopes,
  not31 live trials).
-8 new activation controls plus8 existing amendment controls pass: interruption
  after each file boundary, exact resume/idempotency, tampered replacement,
  arbitrary intermediate state and premature approval denial.
- Initial independent review held activation for missing replacement precheck
  and interrupted-activation recovery. Both corrected; exact scoped closure
  PASS is retained. Projection received static review; PostgreSQL tests were
  parent-executed, not independently rerun.
- Additional real restricted-PG diagnostic test passes one exact extra GET after
  malformed result, unchanged immutable result and identity/state negatives.
  A strengthened assertion also reproduces restart returning `running` without
  new provider calls. Initial assertion-location failure is retained.

Evidence directory: `.local/batch3/b35c/discovery-recovery/`.

## Explicit source succession, no historical rewrite

Predecessor approved amendment:
`ad77c47fedbef0477e6e0c6c62aafb81b391fa6ffc800c1a1656184f543b99ac`.

Current active amendment:
`6237bf590c16c1264afe0a00094d135e14614f70ded22c26d3b22d7deee7d7a9`.

Current B1/M1 product inventory:
`1d8c959d1769a93c8285c776a852820ee9735868d1b50b679f925b8bfb4237b9`.
B0 source is unchanged and B0 observer recovery remains unimplemented/denied.

`evaluation/amend_discovery_continuation.py` preserves the predecessor manifest,
approval, application, original journal bindings and exact failed075 worker
product snapshot. Only `adaptive.py` differs between that product and the new
candidate. It exercises actual cold adapter/controller constructors on copies;
original operation/receipt hashes remain unchanged. Activation is source-only,
locked, validates bytes before mutation and permits only exact ordered
intermediate states. No075 installation, bootstrap, accounting correction,
certificate issuance, grant reset or replacement study store occurred.

Do not rerun its preparation/activation now. Active amendment and application
were read back before live work. Source artifacts remain uncommitted with inherited
work preserved; no deployment, publication or default merge.

## Actual live progression and next failure

Original identities are retained:
- trajectory `d477c622c837a9cc1fb1f0be`
- run `6ad4f6c8-091b-4660-a362-732c9af752a3`
- attempt `20afa88b-46ac-46fd-9c65-f5fea9c181c4`
- pending bridge key `71a972ed3d6898e4ad57852ab4a59b9b78b9c8c2f01fb44ad5bc19165a179e4e`

Observer04 advanced to NEW selection_3 without reposting earlier requests. It
acknowledged response `resp_089e1a2789695b03006ae3f6226e6487d0ae19867dd2ef49ff`.
One normal GET retained `malformed / schema_validation_failed` with usage. The
worker then repeatedly returned running from that terminal malformed receipt,
not pending provider execution. Observer was stopped; no cancellation, fake
terminal state, lease surgery or duplicate create was performed.

A separately scoped, reviewed diagnostic (`evaluation/diagnose_schema_rejection.py`)
performed ONE extra exact GET through unchanged transport and per-read SQL
reservation, preserving the original result. This is a real extra read, not a
claim that selection_3 was read only once. The helper refuses a second invocation.
Raw response is private and saved; no credential is included in its evidence.

The exact observed operation is `files_create_draft`. Its4224-byte text was paired
with an all-zero SHA256. Actual UTF-8 SHA256 is
`554ad60bb09186312457a06a3922c3f285e1313332a0cc32f942879cb5d5d40a`.
`WorkingText`/`TextBytes.exact` raises `exact UTF-8 hash required`. No corrected
DTO was executed and no old rejection was reclassified. This is now a diagnosed
model-generated-content hash/API boundary failure, distinct from the fixed
versioned discovery failure.

`LIVE_CHECKPOINT.json` records the exact readback:3 acknowledged generations,
one count/send/create per phase; reads1/1/2; first two tool results retained;
selection_3 has no tool result. Run remains running, original bridge sending,
**0/72 episodes collected**. Existing2USD first phase remains the only issued
study allocation. No new allocation or certificate, no new money requested;
100USD cumulative authority remains. Unknown historical liabilities remain.

## Remaining engineering, not a generic permission blocker

Do not invoke the observer again expecting progress: `_adaptive_work` returns
running for retained malformed selections; `_step` correctly reuses the old
result and does not refetch. Current SQL also requires a preceding satisfied
continuation receipt before a new selection; skipping indexes or inserting a
fabricated tool result would be wrong.

Continue on the SAME card with a narrow product solution for known schema
rejection and generated-content hashing. Preserve original malformed bytes and
usage, exact request schemas/identities, descriptor/grant pins, authority denials,
real unknowns and all counts. Do not silently replace all-zero hash with a valid
hash and execute the old decision. The trusted tool can derive output-byte
integrity for new generated content; hashes of pre-existing refs must remain
strict. Any API/schema/runtime change needs exact historical-request restoration,
disposable worker-path tests and the existing scoped reviewer before activation.

Then recover this same run through a legitimate supported path, collect actual
outcomes, and continue original12 trajectories/72 episodes, independent blinded
scoring, verified downloads and desktop/phone usefulness. Retain all failures,
intervention effort and source changes; this is not a clean original cohort.
Root `t_82b30c02` owns publication/acceptance. No new task graph or generic budget
approval is needed.

Official model: gpt-6.1-sol. Development/review: gpt-6-astra via openai-codex;
development-tool costs remain outside the product ledger and unreconciled.
