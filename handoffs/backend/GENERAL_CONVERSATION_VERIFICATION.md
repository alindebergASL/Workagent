# B1 local execution verification

Candidate checkpoint on `hermes/general-conversation-cli`, based on
`b76eef865b13486e045d20e2c4586b3975e6ba2c`. Parent review/re-run and Claude schema
ACK are pending. This is controlled engineering evidence, **not** usefulness,
experience or Andrew acceptance. No push, merge, deployment or inference performed.

## Test-first and final regression

New `backend/tests/test_conversations.py` was written first; initial run failed
collection with `ModuleNotFoundError: workagent.general_worker`. Implementation
then made the new tests pass. Additional adversarial tests cover rollback,
forgery, profile drift and provider/key import refusal.

Final command, using a **fresh disposable real PostgreSQL DB** provisioned by this
checkout's `backend/dev_db.py` and a reused Python venv (never its old source tree):

```sh
cd /home/ubuntu/workagent-general-cli
source /home/ubuntu/.hermes/cache/scratch/general-b1.env
PYTHONPATH="$PWD/backend" /home/ubuntu/workagent-intake/backend/.venv/bin/python -m pytest backend/tests -q
```

Observed: **335 passed, zero skips**, 402.78 seconds. The one warning is the existing
Starlette `anyio.abc.BlockingPortal` deprecation. The focused new file separately
returned **14 passed**, zero skips, 9.86 seconds.

Covered: source-free create/list/post, concurrent replay/CAS, HTTP-admitted turn
through the same worker, current source/membership/viewer denial, cross-workspace
concealment, source content and access-generation drift, lease reclaims/stale
fences, new steering/cancel, persistent process restarts, explicit paused delegation,
worker origin and typed result forgery refusal, atomic rollback, commit replay,
outbox ACK/no duplicated side effects, distinct profile pins, prior registry pins,
CLI live/default/provider refusal before environment/DB use, and a guarded fresh
interpreter denying provider imports/credential lookup and non-loopback sockets.
Legacy intake/domain/revision/proposal/fixture/provider-grant/Responses suites ran
in the same full command. These are synthetic local tests, not provider calls.

The initial full regression found a real compatibility issue: the dynamically
projected pre-Responses registry drifted when `Run` and `Assignment` grew. Fixed
by archiving the exact pre-B1 generated registry under a new byte-bound filename
and projecting the older schema from that archive. Final full regression passes.
No accepted bundles or prior archive files were modified.

## Actual runnable CLI demonstration

First provision a separate empty disposable DB and run the executable demo:

```sh
cd /home/ubuntu/workagent-general-cli
export PYTHONPATH="$PWD/backend"
PY=/home/ubuntu/workagent-intake/backend/.venv/bin/python
$PY backend/dev_db.py --env-file /home/ubuntu/.hermes/cache/scratch/my-fresh-b1-demo.env
source /home/ubuntu/.hermes/cache/scratch/my-fresh-b1-demo.env
$PY scripts/general_b1_demo.py --controlled
```

The demo refuses a non-`workagent_test_` or nonempty database, seeds **zero sources**,
and invokes fresh CLI interpreters for prompt, continue, inspect, delegate and
inspect. It asserts durable readback; it never writes a direct assistant answer.
The product `GeneralWorker` alone commits the typed controlled transport output.

Observed output from the local run (these are real DB-generated IDs):

```json
{
  "mode": "controlled",
  "usefulness": "unverified",
  "workspace_id": "b1-demo-a4f6a2d1-2dab-46a6-994f-0e9b18375b06",
  "conversation_id": "cc34b7c9-fa96-49e4-a495-7d8a69788b0f",
  "run_ids": [
    "db93ac01-37c0-4d4c-b76d-35e0dd013362",
    "1f61a9e6-7660-4ad4-95a2-787c8a98987e"
  ],
  "message_ids": [
    "c0ecc1dd-dce8-4256-a2ba-a5c76a6df57e",
    "e7aba6f4-c7f9-461a-b13b-730a43e5e774",
    "e0b81cad-6591-4289-924b-4119849f3bfa",
    "4de3ca1e-fa4d-44df-8cf1-709da37640ca"
  ],
  "assignment_id": "b755307b-60c5-44a7-bc21-b0197c5006dc",
  "message_count": 4,
  "retained_after_process_restart": true,
  "provider_attempt_count": 0,
  "source_count": 0,
  "assignment_count": 1,
  "pending_dispatch_count": 0,
  "assistant_text": "Controlled transport: retained 2 human message(s). What outcome would you like to work toward? This verifies persistence and worker wiring, not model usefulness."
}
```

Saved disposable environments are scratch-only:
`/home/ubuntu/.hermes/cache/scratch/general-b1.env` and `general-b1-demo.env`.
No DSN/password or raw private context is in this repository or report.
The demo initially encountered `scripts/workagent.py` shadowing the package;
fixed by deriving this checkout's backend path before importing, and pinning
that same path for its child processes. The exact demo then succeeded.

## Contract and scope checks

- Regenerated OpenAPI JSON, typed TS, illustrative examples and tool-registry JSON.
- `backend/export_contracts.py --check`: “Contracts match canonical Python models.”
- `node contracts/check-drift.mjs`: “Generated TypeScript matches OpenAPI.”
- `contracts/node_modules/.bin/tsc --noEmit -p contracts/tsconfig.json`: passed
  immediately after generation. A later repeat was blocked by the host lifecycle
  guard because TypeScript's `_tsc.js` exceeds its 1 MiB scanner cap; no bypass
  attempted. Generated contract files did not change between these two commands.
- `git diff --check`: passed. Static added-code scan: no shell/eval or secret-literal
  matches. SQL dynamic owner column comes only from two internal literals;
  all values are bound parameters.
- Compared 99 tracked protected files against reset commit bytes (old migrations
  001–008, agent bundles, web, evidence/grants paths when present): no changes.
- No `.local` reads/writes, no changes to parent docs/status, no new B2/B3 modules,
  no provider dependency/harness selection. npm installed only locked contract
  development dependencies; audit reported zero vulnerabilities.
- Migration 009 adds nullable conversation-bound runs with exactly-one-owner DB
  constraint, immutable run ownership/messages and conversation linkage. Existing
  command ledger/outbox/run capabilities are reused, not replaced.

## Still not implemented / not accepted

- Live model usefulness, live provider credential path/grant, and real model answer
  quality: entirely unverified and deliberately disabled.
- B2: CSV reconciliation/table/file product results, calculation provenance,
  editable artifacts and file download. B1 only admits typed `text` results.
- B3: sandboxed tooling, maker artifacts, execution/readback and safe revision
  behavior. Parent's separate local-operation/WASM preparation is not included here.
- Delegated responsibility execution/scheduling: explicitly paused records only;
  resume is refused, never turned into a silent intake run.
- UI/browser experience and explicit frontend contract agreement: pending.
- No background daemon or automatic dispatcher startup; HTTP turns advance using
  the explicit bounded `workagent.general_worker --controlled` batch command.
- Context budget failures or denied claims remain queued/recoverable; a crash after
  claim can require the existing 120-second lease expiry. There is no external-
  effect exactly-once claim for a future live transport.
