# WorkAgent — authoritative implementation status

Private alpha IN PROGRESS, not accepted. Full mission: general agency + extensible
skills/tools + scoped context/memory + durable continuity + authorized initiative
+ optional Spaces + Intelligent UI. HTTP CLI is a shared-runtime diagnostic client,
not a product pivot. User authority: docs/GENERAL_MODEL_AUTHORIZATION.md.

## Candidate and owners

Integration branch: hermes/overnight-intelligent-work. Published launch10741ac;
lease fix e091c50 merged a80634e; development bounds 5255ef0 (additive migration
027) plus owner merge ff0cce7 (ed5cd7e execution views integrated, frontend279
PASS + webpack PASS, in-browser verified on the live turn). Hermes owns backend/runtime/contracts/integration; existing Claude
session owns web. No default-branch merge or production replacement.

## Current execution / observed progress

Supported launch: scripts/dev_service.py + service.json now points at the new
bounded development grant workagent-alpha-dev-20261015-04. All three services
(api 8152, web 3152, worker) run under user systemd against the retained
database 47b87fe3b82e and private worker state; readiness returns TRUE with
idle/can_advance_authorized_work, and stays truthful across worker stop/restart.

New grant (installed via domain authority configure_grant with the reviewed
route record, exact readback verified): same official gpt-6.1-sol project/route,
max_steps 8, 66 generations/68 counts/596 reads, cost ceiling 12.136640 —
9.498240 existing shared reserved + the historical 2.638400 increment; the $20
project cap and $40 operator aggregate are unchanged and still authoritative.
The exhausted 03 grant was revoked (domain authority), never edited in place.
SQL file retained at /home/ubuntu/workagent-private-alpha/iteration1-grant.sql.

Migration 027 (additive, 001-026 untouched): alpha bindings may now declare
proportionate caps (steps<=8, gen/count<=256, reads<=4096) while historical
adaptive grants remain hard-pinned to their original literals; responses_steps
phase enum extended to selection_8; responsibility recording accepts later
phases. Verified by new test_development_bounds.py (fresh DB migration gate,
repeat-safe re-migration, per-grant stop at its own bound, later-phase
responsibility receipt, legacy schema cannot use new phases) + updated
test_alpha_budget. Focused88 PASS; regression batches 233+18+30+40 PASS
(retained XMLs under /home/ubuntu/workagent-private-alpha/). One combined
invocation hit the 420s tool timeout and was discarded — not counted.

LIVE model proof (not fixtures): posted a real capability-inspection request;
worker completed it through official_api (3 steps + final, then a second turn
with 2 steps). A human correction turn produced the required revised answer
stating what was NOT verified. Budget after both runs: 5 dispatches/0.65960
reserved on the new grant; 6.72792 total local dispatch reservation. Same
conversation read back identically via HTTP API and via the browser UI
(da3af935). Older preview 3151/8151 untouched. 63e52832 stays frozen/blocked.

## Budget and next work

Operator aggregate checkpoint: encumbrance 25.408720 + new live reservations
0.65960 = 26.068320 of 40; the grant ceiling 12.136640 caps shared project
reservation. Two old unknown count attempts remain quarantined; 63e52832
malformed final remains terminal. No cancels.

Next: merged web-owner slice (ed5cd7e execution views) integration + frontend
regression; browser-persistent Intelligent UI value-editing proof; reusable
tool/skill increment (skill catalog already discovers/loads; needs varied-work
proof); cross-conversation scoped context; due-condition responsibility
advance; then different-model/multi-persona milestone review and authenticated
alpha access. Frozen worker SIGKILL/state-preservation evidence retained in
supervision-verification.json.

Historical evidence (scope/failures retained, not current instructions):
docs/OVERNIGHT_20261015_BATCH4.md. Private receipts/service config:
/home/ubuntu/workagent-private-alpha (never publish credentials or payloads).
