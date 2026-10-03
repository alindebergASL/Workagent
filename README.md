# Workagent

Workagent is a general, persistent work partner: think, make, handle, coordinate,
own and learn from work. Agent conversation and appropriate work surfaces form
one clean experience, with optional private/shared Spaces.

**Start here:** [Product contract](docs/PRODUCT_CONTRACT.md),
[current build plan](docs/BUILD_PLAN.md), [work contract](docs/WORK_CONTRACT.md)
and [acceptance](docs/PRODUCT_ACCEPTANCE.md).
Development ownership and instructions: [AGENTS.md](AGENTS.md).
Current coordinated handoff: [product reset](handoffs/PRODUCT_RESET.md).

**Implemented baseline:** real Next.js + FastAPI + PostgreSQL private-work app
with durable intake artifacts, human edits, exact proposal acceptance and recovery.
A bounded live Responses intake journey on synthetic context was completed;
[its report](handoffs/backend/INTAKE_ACCEPTANCE.md) is engineering evidence for
that slice, not acceptance of a general agent. The prior grant is exhausted and
expired. Default local demonstrations use labeled deterministic fixtures.
Source-free conversation, broad work products and ongoing ownership are the next
implementation work, not currently demonstrated capabilities.

The existing Claude Code session owns frontend; Hermes owns backend/runtime and
integration. Historical S0/S1 and intake constraints do not define product scope.

## Run the preserved intake demonstration
Tested on Ubuntu 24.04, Python 3.12, PostgreSQL 16, Node 22, npm, pnpm 11 and uv.
PostgreSQL must already run locally; provisioning uses `sudo -n -u postgres` to
create a **new** isolated database and separate owner/runtime roles. No existing DB
is reset. Browser dependency installation may need the host's normal system packages.

```sh
git clone https://github.com/alindebergASL/Workagent.git
cd Workagent
git checkout hermes/intake-next-action
python3 scripts/workagent.py demo
```

That command installs locked dependencies, builds the actual app, provisions only
when the ignored local env file does not exist, runs desktop/mobile browser checks,
terminates and restarts API/web, and reads back the same PostgreSQL state. It then runs
nine response-loss/conflict/source-drift regressions against a **separate** isolated
database, leaving that saved assignment unchanged. It uses controlled worker release
for the stale-proposal scenario and deliberate network interruption for loss tests;
no fabricated success response or JSON mock persistence stands in for the API/database.
Logs, screenshots, exact artifact
bodies and identifiers are under `.local/evidence/` and `.local/logs/`.

## Use the current intake profile

```sh
# After the demo, or after `python3 scripts/workagent.py setup`:
python3 scripts/workagent.py serve
```

Open **http://127.0.0.1:3000** on the same machine. The API and continuous fixture
dispatcher start together. Select **Personal intake review log**, **Method notebook**
and **Personal working plan**, describe your request, and start work. Review the
plan/checklist, inspect Sources, edit/save, request a proposal and review History.
Results are private to this local installation. There is no public URL or login flow.
The UI clearly labels fixture mode; arbitrary professional requests do not become
general-purpose model analysis in this build.

Ctrl-C stops the processes without deleting PostgreSQL state. Run the same command
with the same env file to reopen saved work. `--env PATH` selects another explicitly
provisioned local instance; `demo --skip-setup` reuses an already-built candidate.
Occupied ports 3000/8000 cause a safe refusal, not termination of another application.

The local identity is `local-human` / `local-workspace`. Its random bearer stays in
a mode-0600 ignored env file and is injected by a loopback-only server proxy, never
by a browser bundle or public credential. The migration credential is removed from
service/web process environments after provisioning. Do not bind this setup publicly.

## Verify / regenerate

```sh
# Separate disposable test DB; never run tests against your saved app instance.
backend/.venv/bin/python backend/dev_db.py --env-file backend/.tests.env
. backend/.tests.env
PYTHONPATH=backend:. backend/.venv/bin/python -m pytest -q backend/tests runtime/tests
npm --prefix contracts run generate
npm --prefix contracts run check
pnpm --dir web check
```

`backend/dev_db.py` deliberately refuses to overwrite an env file. Source the existing
file to rerun tests, or choose a new path. For an older schema, follow the explicit
migration/grant instructions in `backend/README.md`; the launcher does not silently
reset or repin old runs. The historical standalone frontend mock demo remains in
`web/README.md`; it is separate evidence, not the milestone qualification command.

## Architecture and evidence
- `backend/workagent/models.py` / `service.py`: canonical typed schemas and domain
  authorization, transactions, independent immutable revisions, tasks and command replay.
- `contracts/`: generated OpenAPI 3.1, TypeScript client, model-tool allowlist and examples.
- `backend/migrations/`: PostgreSQL authority, immutable bodies, outbox, fenced runs,
  pinned contexts/configuration and activation history.
- `agent/` and `runtime/`: reviewed pinned product guidance, selective scoped loader,
  versioned activation/rollback. These are not repository coding-agent instructions.
- `handoffs/backend/`: contract/integration checkpoints and exact limitations.
- `docs/RUNTIME_STATUS.md`: live-runtime selection/authorization boundary.

**Next qualification:** varied work through the same runtime and an integrated
experience against the prototype. Report engineering, usefulness and experience
independently. Controlled fixtures cannot establish general model capability.
See the current acceptance contract; do not reinstate historical stage ceilings
as global defaults. No new inference, default merge or deployment is implied.
