# User-Supplied Acceptance Checks Implementation Plan

> **For Hermes:** Execute task-by-task with independent review; keep backend ownership and do not edit web or run Workagent provider generations.

**Goal:** Execute optional, immutable human-supplied acceptance cases independently of model-proposed examples, without claiming correctness beyond the supplied cases.

**Architecture:** Add a closed optional `acceptance_checks` field to the existing human post/message contract. The same bounded local executor verifies the exact staged body and persists its evidence in the existing append-only tool-result journal. Initial, continuation, final and historical model context omit the specification and expected results. Add migration013 rather than editing published migrations.

**Tech Stack:** Existing Python/Pydantic, PostgreSQL/psycopg, Wasmtime and generated OpenAPI/TypeScript.

## Invariants and scope

- No acceptance checks: preserve old behavior and old model context/provenance material (omit the new absent field when hashing historical human messages).
- Optional bounded Wasm cases (1–8, explicit export, signed-i64 expected decimal strings) or CSV totals. No arbitrary checker code, network, filesystem or new model tool.
- Only human posts under the adaptive grant can supply checks. Controlled and legacy general profiles reject them; assistant/model decisions cannot supply them.
- All supplied checks must pass before stopping at `needs_validation`; failed checks drive bounded continuation even if model examples pass. Supplied cases do not prove unrestricted natural-language correctness: keep requested-goal status unverified and run partial. Explain specifically what passed.
- Preserve immutable checks in the human message and exact typed snapshot/hash in the verification receipt. Bind to original request and staged body. PostgreSQL independently rejects absent, mismatched, empty, failed or forged acceptance receipts when publication claims the supplied checks passed.
- Redact the full acceptance evidence, expected values and specification hashes from provider payloads. Only a bounded pass/fail/count summary may reach the model. Keep full evidence available in authorized domain reads.
- Preserve edits, proposals, exact target CAS, cancellation/revocation, replay, ledger reservations and unknown sends. No automatic human acceptance.

## Task 1: RED tests and closed input/output types

Create `backend/tests/test_acceptance_checks.py` and `backend/workagent/acceptance_checks.py`. Tests cover malformed/empty/oversized cases, signed-i64 bounds, passing and failing actual Wasm, CSV discrepancies, mismatched export, and model-payload redaction. Add input types to `models.py` and receipt type to `product_models.py` without changing the model decision schema.

Run `PYTHONPATH=backend .venv/bin/python -m pytest -q backend/tests/test_acceptance_checks.py --noconftest` first for RED, then after implementation for GREEN.

## Task 2: Admission and secrecy

Modify `conversations.py` to store the optional specification only under adaptive authorization. Omit `acceptance_checks` from every provider-context message. Preserve exact historical context shape when no checks exist. Include new module bytes in `general_responses.consumer_hash()`.

## Task 3: Trusted verification and bounded feedback

Reuse the existing Wasmtime and CSV observations. Extend `adaptive.verify/stage_metadata` with independent evidence. Explicit failed user checks must prevent premature stop on passing model examples. Redact evidence through one pure helper in both continuation context and `general_worker.py` final tool output. Keep unrestricted goal status `needs_validation` and trusted explanatory copy.

## Task 4: Additive SQL guards

Create `backend/migrations/013_acceptance_checks.sql`: validate human-only specification admission, bind tool-result acceptance evidence to the exact immutable human record, verify nonempty/all-pass receipts, and tighten publication predicates. Do not mutate012 or any prior migration. Provision a NEW env/database for each precommit migration revision via `backend/dev_db.py`; never patch functions directly.

## Task 5: PostgreSQL and transport regressions

Extend `backend/tests/test_adaptive_execution.py` fixtures only as needed; add real-DB tests in `backend/tests/test_acceptance_integration.py`. Cover valid/invalid checks, wrong code despite passing self-tests, continued correction, no checks preserving behavior, no expected-answer leakage in every provider phase, restart replay, stale target/edit protection, SQL receipt forgery and unsupported profiles.

Run focused tests with `PYTHONPATH=backend .venv/bin/python -m pytest -q backend/tests/test_acceptance_integration.py backend/tests/test_adaptive_execution.py backend/tests/test_adaptive_guards.py` against the new disposable env only.

## Task 6: Generated contracts and final verification

Regenerate canonical JSON via `backend/export_contracts.py`, TypeScript via pinned `contracts/node_modules/.bin/openapi-typescript`, check drift and typecheck. Update upgrade assertions for migration013. Run the full backend suite once on final runtime bytes, obtain one independent read-only code review (report its actual model), address concrete findings, and commit only owned backend/contracts/plan/handoff paths. No new explicit provider API calls are authorized by this plan. Keep live behavior, UI acceptance, generalized goal verification and release approval explicitly separate.
