# Attended recovery and delivery — October16

Current application candidate: `41a373965fd6aed6fdd6d55599a265515017cd9e`.
This document supersedes prior launch/owner/grant statements in the October16 handoff.

## Ownership

The current attended CLI session is the sole integration owner. Claude remains sole web owner. Native task `t_dae2fde4` remains blocked and its dependent tasks gated: no resets, unknown acknowledgements, replay or new dispatcher owner. The two bound interpreters and their controllers are gone; compute executions are terminal while admission outcomes remain unknown. Their completed commit/build/restart and database effects were read back and preserved. Managed-worker process projection refuses unsupported reads instead of falsely returning empty. Transcript and OS inventory found no remaining build/test/delegation; product API/web/worker are separately active.

Installed Hermes `0.22.0+2222.gccc6355` logs establish `synchronous_rpc_on_event_loop` persistence failure at21:36:47 and21:39:22. Issue139612 matches the user-visible error and two-failure blocking classification, not a proven memory-pressure cause. No Hermes upgrade or lock clearing was performed.

## Frozen service identity

All three product services started21:36:28UTC from the separate frozen41a3739 candidate, not the editing checkout. API3177325, web3177326, worker3177327; build `S3q1X0z3unkcQp8UaAsyV`. Runtime and consumer hashes plus report digests are in [the sanitized evidence](evidence/RECOVERY_CHECKPOINT_20261016.json). A docs-only publication does not change loaded application identity.

## Evidence and authority

Scoped backend results: publication1, settled/adaptive94, recovery168, corrected activation2 passed. These are reused retained reports, not a new/full backend run. Latest combined frontend308 passed plus lint/types/format/contracts/webpack build. Initial5 collection errors and rejected activation1/2 remain retained. Historical interrupted405-case run and earlier failed probes are not green.

Installed grant `workagent-alpha-recovery-20261016-01` remains unchanged and compatible. At22:09UTC: cumulative authorization$50; allocation encumbered$43.086, unactivated$6.914; shared reservations$15.43464 including carry$3.42992;2 unknown usage steps retained. These are not billed charges. The existing envelope originally added24 generation/count slots and240reads, max10runs across3synthetic conversations. Current consumption must always be read back; no reinstall/enlargement is authorized here.

## Delivery state

The bounded live journey below is complete, with qualifications and retained failures. Remote access did not block local browser evaluation. Authenticated [SSH review access](REVIEW_ACCESS_20261016.md) uses the existing host identity and loopback3152, not a public web deployment. User-device connection is not verified. No default merge, production deployment, external business effects, new paid route or private-data expansion. Memory/learning remains sequenced through issue10.

## Fresh live checkpoint,22:42UTC

[Machine-readable measurements and checks](evidence/LIVE_REVIEW_20261016.json).
[Actual sanitized screenshots](evidence/review-20261016/manifest.json):
[desktop proposal](evidence/review-20261016/desktop-proposal.png),
[phone accepted table](evidence/review-20261016/phone-accepted-table.png),
[phone concise answer](evidence/review-20261016/phone-concision.png).
These are real Chromium app captures, not design concepts; phone is390×844 emulation.

| Ordinary request | Browser acknowledgement | First useful browser content | Server reply persisted |
|---|---:|---:|---:|
| Plain explanation, no artifact |0.148s|133.650s|132.643s|
| Make it shorter |3.991s|NOT MEASURED after navigation|131.328s|
| Editable supply table from attached JSON |6.057s|145.506s|138.789s|
| Corrected stock + changed requirement, propose revision |0.297s|142.511s|140.898s|
| Unavailable web/manual verification obstacle |0.280s|30.432s|28.846s|

The separate initial checklist request failed `schema_validation_failed` with no
artifact. It remains held, and an attempted follow-up was refused with the draft
retained and no provider call. It is not omitted or called a success. Independent
supply work progressed while this request and existing human-held work remained held.

### What was genuinely useful

- The simple answer explained password reuse risks and a practical first step,
  without imposing an artifact/workflow. The follow-up shrank110to45words (59.1%),
  in2sentences with the explanation and next step intact.
- The supply table saved correct shortages5/0/6/1 from an actual315-byte JSON
  attachment. This proved real attachment/broker/persistence use, NOT external
  retrieval or shell/code execution; no hidden fixture/model-output script.
- A human edit changed gloves18to12 and added an exact coordinator-approval
  sentence. The next natural request changed required glasses12to20. The proposed
  table had shortages13/3/6/1, preserved the human sentence and warning, and left
  the saved human revision untouched until explicit browser acceptance.
- Acceptance produced exactly one new revision. Reopening after a worker restart
  retained it:1artifact,3revisions (initial/human/accepted),1accepted proposal, no
  repeated dispatch per phase and no post-acceptance provider/reservation changes.
- During creation, an intentional service restart recovered the same accepted
  provider response and attempt, without regeneration. The launcher ignores
  `--component` for restart, so that first restart affected the entire target:
  API22:32:59/web22:33:29/worker22:32:59. The later `systemctl --user restart
  workagent-alpha-worker.service` affected only worker, nowPID3281492 since22:39:10.
- With no web capability, the agent declined to invent manual/glasses compatibility
  and independently offered a safe evidence-gathering/comparison path. This proves
  capability-aware helpful fallback, not a real failed network fetch or web retrieval.

### Timing interpretation and experience

1.7–14.5s elapsed from persisted admission to first count (queue/lease/preflight/DB
combined). Per-phase count calls0.4–1.9s and dispatch-to-identity0.6–5.2s include
commit overhead. Long113–119s gaps between reads align with lease expiry. Actual
provider completion inside those gaps is unknown; neither all-provider nor all-local
attribution is justified. Persist-to-browser delays on captured successes0.9–2.7s.
Individual SQL execution time was not instrumented; read-only snapshot timings are
not substituted for total database cost. The shorter response's exact browser
completion time was lost when navigating; server completion is retained.

Desktop proposal/diff/accept controls were inspected. Phone390px reflows the table
into labeled row cards, with no page horizontal overflow, and exposes Work/Conversation
tabs. Actual physical-phone/assistive-technology and user-device SSH access remain
NOT TESTED. A supplementary post-reopen desktop screenshot call timed out after60s;
its preceding DOM readback succeeded and the existing captured evidence is retained.

### Remaining defects and current operating state

- Backend status projection briefly calls healthy in-flight count/dispatch windows
  unknown/blocked, causing a false stopped warning. Claude correctly refused a UI
  timing workaround (PR9 comment6225920341); attended source inspection confirmed
  `responses_ledger.py:307` and `execution_status.py:63`. Next fix must distinguish
  demonstrably live in-flight operations from abandoned unknowns without hiding risk.
- Known malformed checklist result leaves the canonical run running-shaped while
  the UI/admission correctly hold it; no generic safe user resolution was exercised.
  The underlying model validation error is not retained beyond its sanitized code.
- Latency remains excessive for simple tasks. Further work should retain the live
  owner while polling accepted IDs, not shorten authoritative fences or retry sends.
- Edits in the notes control collapsed line separators during typing; the exact
  human sentence survived. The proposal retained stale source prose but clearly
  marked the old glove-surplus sentence superseded. This is safe, not polished.

At22:41:57UTC all product services active, worker idle/can_advance=true, runtime and
consumer hashes match the unchanged installed grant. Shared reservations$16.88576,
up$1.45112 from the pre-evaluation checkpoint; allocation encumbered$43.086,
unactivated$6.914 of the existing$50. Original2unknown usage steps remain. No
billing claim or refund. Remaining13generation/13count/214read slots,4run admissions.

Development owner is this attended CLI session, NOT a running unattended task.
The failed dispatcher admissions stay unknown and blocked/gated cards stay preserved;
no locks/retries were cleared. Do not describe them as continuing development.

Engineering: scoped deterministic and demonstrated safety/recovery checks PASS;
known projection/liveness/latency defects prevent an all-green engineering verdict.
Usefulness: bounded demonstrated journey PASS with1retainedfailedrequest; broader
agent/tool/memory breadth NOT established. Experience/access: desktop/emulated phone
usable for bounded review, authenticated SSH route host-side verified; user-device
connection remains unverified. This is review-ready with limitations, not alpha acceptance.

