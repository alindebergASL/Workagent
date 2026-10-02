# Workagent — private-work local build

A solo workspace for selected-source intake analysis, a saved working plan/checklist,
human edits, inspectable stale proposals and reopening persisted work after restart.

**Current operating mode:** real Next.js application + FastAPI domain services +
PostgreSQL, with **deterministic synthetic-fixture computation**. It is not live-model
inference, production authentication, Google integration or a hosted deployment.
The existing frontend is Claude Code's work; Hermes owns backend and integration.

## Run the complete demonstration
Tested on Ubuntu 24.04, Python 3.12, PostgreSQL 16, Node 22, npm, pnpm 11 and uv.
PostgreSQL must already run locally; provisioning uses `sudo -n -u postgres` to
create a **new** isolated database and separate owner/runtime roles. No existing DB
is reset. Browser dependency installation may need the host's normal system packages.

```sh
git clone https://github.com/alindebergASL/Workagent.git
cd Workagent
git checkout hermes/s0-s1-build
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

## Use the workspace

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

**Qualification remains incomplete:** live managed-first session/recovery/wait/compaction
proof and live approved-skill ablation require authorized product API access and a
bounded grant. Andrew's usefulness judgment is also required. Fixture behavior does
not close those requirements. No S2–S5 work or default-branch merge is implied.
