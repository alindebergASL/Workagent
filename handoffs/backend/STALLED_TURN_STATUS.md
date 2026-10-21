# Stalled turn readback and prepared-only cancellation

## Canonical path

`ResponsesDispatcher.once()` previously logged a closed denial code but did not
retain it. `execution_status.read()` classified an accepted provider identity as
`awaiting_provider`; the worker heartbeat's single last-run status was overwritten
by the next visit. `_capacity()` consequently counted blocked known-ID work as
read capacity.

Migration 039 adds only `run_dispatches.failure_reason` (closed DB allowlist) and
`failure_checked_at`. Admission identity and monotonic acknowledgement remain
protected. The dispatcher records actionable denials independently per run;
contention, `action_unresolved` and unclassified transport exceptions do not erase
them. Newer successful visits clear them; older concurrent visits cannot overwrite
newer diagnostics. These fields are **not scheduling or retry authority**.

The existing authenticated `/v1/workspaces/{workspace}/execution` exposes blocked
runs with `failure_category`, `failure_reason`, and fixed `next_action` guidance.
No exception details, provider text or private context are persisted in those
fields. Revoked grants are also classified directly from canonical grant state.
Terminal outcomes and invalid/unknown provider receipts retain precedence. Blocked
known-ID work is not counted as current read capacity; unrelated work can proceed.
A compatible code fix can resume the same request under unchanged authority and
clear the diagnostic. The dispatcher does not cancel, acknowledge, drop, rewrite,
rebind or bypass source/grant checks to change status.

## Prepared-only cancellation

A second reproduced blocker was `has_unresolved_attempt()` treating a cancelled
run with a retained `prepared` attempt, zero response steps and zero response
events as an unresolved send. New admission now ignores **only** that exact
Responses-profile case (also requiring no provider identity/result hash). The
old run/attempt and cumulative admission/accounting are retained. A live prepared
run, any prepared step, reserved count/send, or unknown liability remains held.

Traced SQL `guard_general_admission`, `guard_responsibility_admission`,
`guard_general_message` and `require_responsibility_binding`: none repeats the
Python unresolved-attempt predicate. Therefore no SQL authority exception is
needed. The regression executes a real dependency edit → cancellation → new
continuation through the restricted runtime role, including config/message SQL
triggers, then completes using mock HTTP. Original attempt/steps/events remain
byte-for-byte equal. No timing implementation files changed.

## Verification

96 unique tests passed, zero skipped, in four bounded batches using the supplied
disposable PostgreSQL environment and restricted runtime role:

- `test_stalled_turn_status.py`, `test_cancelled_unsent_admission.py`,
  `test_responsibility_resume.py`: 26 passed.
- `test_execution_status.py`, `test_dispatch_denial_reason.py`,
  `test_continuous_workers_pure.py`, `test_dispatcher_resilience.py`,
  `test_runtime_failure_diagnostics.py`: 47 passed.
- `test_general_responses_blockers.py::test_current_conversation_context_drift_stops_pre_io`,
  `test_general_responses_blockers.py::test_cumulative_admission_api_sql_cancellation_and_revocation`,
  `test_responses_leases.py::test_dispatcher_recovers_known_final_and_progresses_beside_unknown`:
  4 passed (includes parametrization).
- `test_runtime.py`, `test_recording_context_refresh.py`: 19 passed.

Run from repository root with `PYTHONPATH=backend`, the supplied venv Python,
`-m pytest backend/tests/<file-or-selector> -q --tb=short`. JUnit evidence is in
`/home/ubuntu/.hermes/cache/scratch/stalled-turn-*.xml` (four files).
Both new regressions were red before their corresponding fix. Missing database
environment was explicitly tested to fail during fixture setup, not skip.
Migration 039 was applied and replayed with historical admissions unchanged.
Canonical contract export/check, generated TypeScript and its initial typecheck
passed. A later repeat typecheck was blocked by the runner's script-size scan
limit, not a compiler diagnostic; no contract changes occurred between checks.
`git diff --check` passed. No full-suite or independent-review claim.

## Integration / limits

- Apply migration 039 before running this backend. Existing table-level UPDATE
  grants cover the new diagnostic columns; no new privilege grants are required.
- Existing failures become visible on the next dispatcher visit; this is not a
  backfill or a repair action. A direct worker invocation outside this dispatcher
  does not persist a diagnostic. Workspace summary may still show working when
  other work progresses; the blocked run remains explicit in `runs`.
- Unclassified transport errors retain existing unknown-send/worker-health
  behavior; no arbitrary exception text becomes a public reason.
- This supplies backend readback and generated contracts, not new web rendering.
- The cancelled exemption intentionally excludes even prepared request bytes with
  no send events. Broadening that case needs its own proof; no blanket release.
- No live DB, provider, service, configuration, deployment or paid calls used.
