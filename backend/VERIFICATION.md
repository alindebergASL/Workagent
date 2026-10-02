# Verification — first domain/API baseline

Observed on Python 3.12.3, Node 22.22.2, PostgreSQL 16 using a newly provisioned,
non-owner runtime role and isolated `workagent_test_*` database. This is fixture /
local application evidence, not provider-runtime or full S0/S1 acceptance.

## Executed

```sh
# backend/
.venv/bin/python dev_db.py --env-file .baseline.env
uv pip sync --python .venv/bin/python --require-hashes requirements.lock
. ./.baseline.env
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q workagent tests
uv pip check --python .venv/bin/python

# contracts/
npm ci --ignore-scripts
npm run generate
npm run check
```

- PostgreSQL suite: **17 passed**, no skips (final observed run: 11.54 seconds).
- One non-failing Starlette TestClient/AnyIO BlockingPortal deprecation warning.
- Python byte-compilation passed; installed-package compatibility check passed.
- npm clean lockfile install passed; npm reported zero vulnerabilities in that
  install's 36-package audit. This is not a broader security-audit claim.
- OpenAPI/tool/example canonical export comparison passed.
- Generated TypeScript drift comparison and `tsc --noEmit` passed.
- `git diff --cached --check` passed during the commit gate.

## Behavioral assertions actually exercised

1. Concurrent duplicate command submissions produce one assignment, one command
   result and one mutation audit/outbox pair; a changed request ID replays exactly,
   while changed intent conflicts. A fresh service instance reads recorded results.
2. Actor-data-derived plan/checklist, exact protected-note preservation, arbitrary
   three-row input generalization, independent artifact/work/source revisions.
3. Stale proposal retains separate bytes and cannot accept over human edits, even
   with a freshly supplied expected ID; keep-current retains the dismissed proposal;
   a new proposal against the new base can be accepted.
4. Concurrent human saves have one winner and one version conflict.
5. Outsider/source revocation checks on assignment, artifact, history, proposal,
   run and command replay paths; inaccessible assignments disappear from lists.
6. Task creation remains unresolved; missing/mismatched readback stays unresolved;
   separate matching get records verified-created evidence and inspections.
7. Lease exclusion, expired-lease reclaim, stale-fence rejection and access-generation
   change before commit preserve the prior state.
8. Worker principal cannot human-save/accept; a forged capability is refused.
9. Runtime cannot edit authority records or immutable revisions; even migration owner
   revision updates are rejected by the immutable trigger.
10. Deliberate audit failure rolls assignment/run/command/outbox mutations back.
11. HTTP auth, extra-field/schema rejection, bounded pagination, queued 202, denied
    404 and command-conflict 409; OpenAPI security requirements are present.
12. Pause cancels outstanding work; resume creates a new initial run; incomplete
    input persists partial artifacts/unresolved information rather than a ready claim.
13. Capability-bound proposal command replay/conflict, exact scope/dependencies,
    reviewed tool allowlist and revocation before replay.
14. Source-version drift, source unavailable and exhausted budget refusal.
15. One active lease across an assignment's runs; fixture-pin drift rejected before
    publishing proposal bytes.
16. Internal adapter error has a sanitized structured envelope without exception text.
17. **Actual Uvicorn loopback subprocess** accepts a queued command; a **separate
    fixture-worker process** produces ready artifacts; HTTP human-save persists;
    terminate/restart API and re-read returns the same saved revision/text.

## Not established / boundaries

No frontend/browser UX acceptance, live provider calls, external task/calendar/sharing
mutation, OAuth/MCP server, approved-bundle activation/rollback, long-duration waits,
production multi-tenant identity or S3 protocol. There is no standalone scheduler:
fixture runs advance through an explicit worker command. The parent's broker must
bind generated model tools to assignment capabilities; schemas are not grants.
Authorization is canonical-service based, not RLS isolation for untrusted SQL clients.
Independent reviewer was not spawned because this task forbade additional agents;
this checkpoint has automated tests and implementer review, not independent approval.
No repository/root/frontend/agent/runtime paths were modified by this implementation.
