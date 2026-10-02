# Intake review fixes — execution evidence

Base: `bb048a96c9e9880bff5defc9f444b141a461dc77`. Scope: R1/R2/R3 and explicit
synthetic origin; no transport, provider/account request, inference, deployment,
web edit, push or merge. Parent-owned `INTAKE_LIVE_GRANT.json` is not part of this fix.
A user grant is not an execution receipt or a passed backend review.

## Actual verification

Using `/home/ubuntu/.hermes/cache/scratch/intake-review-venv/bin/python` and the
redacting `intake_review_runner.py` with existing `.local/intake-checkpoint-v3.env`:

- Before implementation: **14 intended-state regressions failed** (receipt refused
  after authority loss; abandoned run still running; revoked/expired run preparing;
  missing unresolved/question fields; postcommit ACK refused).
- Security refinement: a new capability-reconstruction test **failed before**
  one-way receipt-key separation, then passed. Class tags alone did not attenuate
  the reused lease secret; the final receipt capability contains a separate,
  domain-separated derived key, not the original worker lease key.
- Final focused checkpoint + review regressions: **52 passed**, 1 existing
  Starlette/AnyIO deprecation warning, 52.76 seconds.
- Final entire `backend/tests runtime/tests`: **101 passed**, same warning,
  98.03 seconds. No skipped database tests.
- Canonical Python export check, generated TypeScript drift check, and
  `npm exec -- tsc --noEmit`: passed. OpenAPI, tool registry, examples and TS
  schema regenerated. `git diff --check`: passed.
- Additive 005 applied to the disposable PostgreSQL DB; journal prefix (including
  checksums/timestamps) unchanged. Second migration apply was a no-op. Runtime ACL
  tests verify required attempt privileges and deny grant/publication mutation.
- No diff in web, fixtures, runtime, fixture adapter or migrations 001–004.
  Both old registry generations remain hash-verified.

Scratch logs: `intake-fixes-red.txt`, `intake-fixes-capability-red.txt`,
`intake-fixes-focused-green.txt`, `intake-fixes-full-green.txt` under
`/home/ubuntu/.hermes/cache/scratch/`. Raw reviewer probes were not edited;
`test_intake_independent_review.py` remains SHA-256
`ae977bd344fcf56997cf8cd9d1921f842fc1c25dc19a963b7c49f400c398ebe6`.

## Boundaries / remaining gates

All receipt evidence above is **synthetic**, never live attestation. The separate
Sol user grant was not exercised; no product credential/transport was configured.
The consumer must privately persist its receipt capability before dispatch.
Lost credentials and legacy pre-005 attempts have no free-principal bypass; an
unknown dispatch stays non-resendable. A retained result without a committed
publication cannot be ACKed as published or committed under an expired/revoked
grant. New grant admission after an already-committed revoke-before-ACK sequence
is tested. Migration/projection details are in `INTAKE_CONTRACT.md`.

This is implementation/test evidence, **not independent approval of the final
patch**. The parent must perform final independent review and frontend integration.
