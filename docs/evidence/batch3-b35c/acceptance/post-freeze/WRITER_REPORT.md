# Post-freeze correction — writer handoff

Candidate only. Frozen cohorts, outputs, grades, old fresh72 helpers and installed data remain unchanged. No PG, provider, funding, grant, deployment, commit or publication operation was performed by this writer. Development model GPT-6 Astra/high; tool costs remain outside the product ledger and unreconciled.

## Implemented

**F1:** Adaptive selection, prepared final and newly prepared final distinguish known `incomplete/failed/cancelled/refused/malformed` results from pending/no-result. Exact count/request/response bindings, immutable schema restoration, current provider/tool authority, context, fence, and settled prior phases are rechecked. Native uncertainty, missing provider results and ambiguous counts deny settlement. Known terminal failures become durable `partial/blocked`, with an explicit incomplete-goal explanation on the run and `blocked/await_person` checkpoint. No fake final message, request replacement, usage rewriting, tool replay or provider resend. A repeated ordinary worker visit reads the terminal run. Normal completed publication is unchanged.

This deliberately does **not** reconcile a failed provider attempt as a successful completed final or relax successor SQL. Existing conservative accounting/admission remains; terminal failure is surfaced honestly, not permission for automatic retry.

**F2:** Only a fully decoded, hash-invalid `files_create_draft` in a targeted scope whose exact original result is `malformed/schema_validation_failed` returns to the existing authenticated 076 selection-rejection path. Current authority is checked first; any native attempt at that phase or unresolved native effect denies. There is no permission-error catch and no execution of corrected hash bytes. Existing 078 authorized patch rejection and 079 valid-hash target rejection remain distinct. Repeated rejection is immutable, bounded and may proceed only to a NEW authorized choice. No SQL migration is needed; 001–088 unchanged.

**F3:** New, future-only `evaluation/post_freeze_packets.py`:
- Separates explanatory unresolved text from count/dispatch/native ambiguity. It can retain partial packets, exact current authorized material/proposals and actual run-produced revision identities. Conversation context is explicitly not attributed wholesale to the run. Unknown effects still deny. No success or content-grade claim.
- Explicit `review_proposal` delegates to ordinary AcceptProposal/DismissProposal CAS, requires justification and exact base/proposed/current revision bindings, checks protected text before and after, and never invents removal/older-proposal acknowledgments.
- `require_reviewed_transition` blocks pending proposals and changed/missing exact review receipts. Acceptance is never automatic; an exact accepted-command retry must still pass the ordinary command ledger, and a fresh command against an accepted proposal remains denied. The helper is a future seam, **not integration into any frozen or new campaign**. A future caller must invoke the transition check immediately before its dependent action and collect again after an explicit review.

## Precise F3 no-change dispositions

Parent-owned `F3_PARENT_DIAGNOSIS.md` and `F3_FROZEN_DIAGNOSIS.json` establish R02-E1's actual cause: frozen B0's local estimate 41,203 exceeded packing ceiling 37,000; it prepared no seventh count/dispatch. Six provider phases settled. This was neither exact provider 50,000-token refusal nor owner funding exhaustion. Current `request_packing.py:187–192,199–208` already retains the compacted exact request for mandatory counting. No code/cap change is needed. Parent `parent-packing.log`: 11 PASS, reused at that exact scope.

Current per-run safeguards remain: `run.budget_units==1` and used-unit claim/execution checks; adaptive selected-phase ordinal against grant `max_steps` (normally eight, plus a final); 50k/8192 exact request reservation/count policy; grant count/generation/read limits; input/output cumulative reservation limits and shared conservative cost/carry in `Ledger.reserve_operation`. `stop_general_budget` remains partial and does not abandon sent/prepared histories. Frozen R03-E1/R01-E3 each used eight selections plus completed final and retained `partial/step_limit`: useful saved work is not overall completion. Frozen collector `fresh72_application.py:332` incorrectly required empty `unresolved`, conflating explanatory text with external uncertainty; it is **not edited**. New future collector checks actual external history instead. Safe normal next-turn admission is tested for a fully settled partial; ambiguous/terminal-failed attempts retain their existing conservative admission restrictions.

## Files and binding impact

Product: `backend/workagent/{general_worker,general_responses,file_input_rejection,run_checkpoints}.py`.
Future helper: `evaluation/post_freeze_packets.py`.
Tests: `backend/tests/test_post_freeze_{terminal,packets,terminal_pg,review_pg}.py`.
Exact hashes are in `MANIFEST.json`; original product preimages in `predecessor/`. All four product files already participate in `consumer_hash`.

`export_contracts --check` reports **only** generated `capability-registry-v2.json` drift: `connectors.github.discover` and `connectors.github.read` implementation hashes include general_responses.py. Schema/API shapes and all other descriptor fields remain unchanged. Per backend/evaluation-only ownership, canonical contracts were not edited; exact generated proposed catalog is `capability-registry-v2.proposed.json`, for parent's integration. `BINDING_IMPACT.json` records the new consumer and descriptor delta. No historical pins or releases rewritten; ordinary new-fixture installation uses actual current descriptors.

## Execution and preserved failures

- Writer offline branch/identity/unknown/revoked/explicit-review controls: **41 PASS** (`offline-03.log`, final run in `offline-freeze.log`:41 PASS in4.26s). No database.
- First offline run:29 PASS. Second:40 PASS/1 FAIL because test's simulated SELECT 1 row was an empty (false) dict. Fixed that test double to a real truthy row; original log retained.
- All14 new PG cases collect successfully; final collection log is `collection-final.log`. Collection is **not PG execution**.
- Parent interim `pg-debug-01.log`: **10 PASS/1 FAIL in143.64s**, on interim bytes. Failure was our partial fixture using non-continuity Alpha, which correctly stopped after its first publication with partial/needs-validation. Fixture now explicitly uses existing sustained-continuity activation and two selected phases to test step_limit. That failure is preserved; final PG proof remains parent-owned and pending. The late retained-work terminal and ordinary review cases likewise need actual PG.
- New native-unknown and valid-patch exclusion reuse is scoped to the exact existing test selectors below; no blanket suite requested.

## Parent commands (serial, retain disposable DB)

If no NEW fixture already exists, ordinary provisioning (do not replace an existing env):

```bash
E="$PWD/.local/batch3/b35c/post-freeze-correction"
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend backend/.venv/bin/python backend/dev_db.py --env-file "$E/fixture.private.env" > "$E/provision-new.log" 2>&1
```

Parent has already provisioned a NEW disposable fixture at that path; reuse its private env without printing it. Full focused candidate proof, or select remaining cases after parent source-bound review of the interim ten:

```bash
set -a
source .local/batch3/b35c/post-freeze-correction/fixture.private.env
set +a
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend:evaluation backend/.venv/bin/python -m pytest -q \
  backend/tests/test_post_freeze_terminal_pg.py \
  backend/tests/test_post_freeze_review_pg.py \
  backend/tests/test_file_input_rejection.py::test_mismatch_pre_dispatch_restart_new_selection \
  backend/tests/test_file_input_rejection.py::test_after_commit_unknown_not_resolvable_no_resend_checkpoint \
  backend/tests/test_general_alpha_runtime.py::test_unknown_provider_send_is_not_regenerated \
  --basetemp=.local/batch3/b35c/post-freeze-correction/pytest-final-pg \
  > .local/batch3/b35c/post-freeze-correction/parent-final-pg.log 2>&1
```

No R1/R3/broad suite rerun. No live success, paid evaluation, campaign readiness or C/D release claimed. Parent owns final PG, independent review, generated-catalog integration and publication.
