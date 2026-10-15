# Supported private development runtime

This starts the real shared API, ResponsesDispatcher/GeneralWorker and browser.
It does not provision fixtures, grant authority, reset a database or replace the
older saved preview. The existing dispatcher still services explicitly labeled
legacy controlled profiles outside model grants; those are not live-model evidence
and never satisfy live readiness. A model-scoped failed/revoked grant does not fall
back to a controlled reply. STATUS.md is the only current candidate/service status.

## Prepare once

Use Python3.12 (older dependency pins have no Python3.14 binary wheels):

    uv venv --python python3.12 backend/.venv
    uv pip install --python backend/.venv/bin/python -r backend/requirements-live.txt
    npm --prefix contracts ci --ignore-scripts
    cd web && pnpm install --frozen-lockfile
    NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain node node_modules/next/dist/bin/next build --webpack

Supply a chmod600 JSON config outside scratch storage with these explicit fields:
name (workagent-*), root (checkout), python (venv binary), node (absolute binary),
env_file, authority_record, state_dir (existing chmod700 private worker state),
workspace, grant_id, api_port, web_port. All paths are absolute. Never substitute a
new worker-state directory for an existing accepted attempt. The environment file
contains DATABASE_URL, LOCAL_BEARER_TOKEN and LOCAL_PRINCIPAL_ID; migration/provider
credentials are not forwarded. The worker reads only its grant-approved secret
file reference. The browser receives no database/provider credential.

Database and grant provisioning are explicit owner operations; tests use separate
disposable databases. Approved project/route, fresh route evidence, original pins,
per-run limits, cumulative budgets and unknown-request quarantine remain enforced
by the canonical runtime. This launcher does not bypass any of them.

## One service path

From checkout root (replace CONFIG with the absolute private config path):

    python3 scripts/dev_service.py install --config CONFIG
    python3 scripts/dev_service.py start --config CONFIG
    python3 scripts/dev_service.py status --config CONFIG
    python3 scripts/dev_service.py restart --config CONFIG
    python3 scripts/dev_service.py stop --config CONFIG

User systemd supervises each process independently with Restart=always and a private
umask. Stop/restart never deletes the database, private state, receipts or config.
Units are not automatically enabled at boot. Use systemctl --user for component
inspection and bounded journalctl --user diagnostics. Do not dump environment or
raw worker-state files into logs. No public listeners are configured; use SSH
forwarding to the configured browser port for authenticated review access.

Readiness is not web/API200. `status` returns exit2 unless all three processes are
active AND authenticated runtime readback reports capacity to advance authorized
work. GET /v1/workspaces/{workspace_id}/execution checks current workspace access,
conversation ownership, grant validity, budget, fresh dispatcher progress and its
runtime identity. It returns safe categories, run IDs, phases and timestamps, not
private payloads. It lists at most40 recent accessible runs. No fresh worker means
unavailable. A saved result awaiting human review does not stop the dispatcher.

For diagnosis only, `run --component worker --once --config CONFIG` visits the
same dispatcher once; it is not a special executor. Legacy `.local` evaluation
wrappers are historical evidence, not the active service path.

## Compatibility and frozen evidence

    cd backend && .venv/bin/python -m workagent.runtime_identity

Save the
manifest privately; `--compare OLD_MANIFEST` identifies changed runtime files.
Documentation/frontend-only commits do not change runtime identity. Runtime source,
SQL, contracts and dependency pins do. This evidence does not authorize different
bytes: immutable grant consumer hashes and the existing explicit successor-approval
mechanism still govern compatible continuation. Historical grants/accepted attempts
are never rebound to make a changed candidate pass. Freeze failed evaluations;
label post-fix development tests separately. Unknown external sends are not retried.
