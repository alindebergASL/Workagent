# Persistent Spaces and the HTTP operator console

A project/workflow Space is **metadata on its canonical Conversation** inside an
existing authorized workspace. It is not a workspace, tenant, task ledger or a
second copy of artifacts/runs/responsibilities. No migration was needed: existing
conversation JSON stores bounded `title`, `goal`, `kind`, `origin` and optional
`identified_by_run_id`.

## Authority and publication

- `/v1/workspaces/{ws}/work-areas`: authenticated paginated GET and idempotent POST.
- `/v1/workspaces/{ws}/work-areas/{conversation}`: authenticated detail GET and
  CAS POST to promote/edit human metadata. Source authorization is rechecked,
  including replay. Human scope changes cancel queued/in-flight conversation work.
- The alpha decision schema has additive, closed `AreaReply` / `AreaPublish`
  variants, with bounded `work_area` fields. Trusted receipt-validated worker
  publication persists identification. There is **no keyword classifier**.
  Ordinary reply/publish variants remain valid. Later model turns never overwrite
  an existing identification or human metadata. Current metadata enters context.
- Existing exact policy/schema/consumer implementation hashes gate new behavior.
  Historical manifests and grant rows are not rewritten. Existing pinned live
  grants are not compatible automatically; no live grant was reactivated here.
- `/spaces/{workspace}/work/{conversation}` is the stable browser URL. It reads
  the Space detail API and uses the existing conversation, artifact editor,
  exact-target composer and proposal review components. Saved-work counts come
  from canonical proposals, not a checklist or inferred progress.

## Operator console (HTTP only)

Run from `backend`, with the private disposable environment loaded by the shell.
Never place credentials on argv or paste them in a transcript. The client accepts
only loopback HTTP, disables redirects and proxy discovery, and never retries a
write. The old read-only diagnostics viewer is unchanged.

```sh
export WORKAGENT_OPERATOR_URL=http://127.0.0.1:PORT
export WORKAGENT_WORKSPACE=WORKSPACE_ID
# LOCAL_BEARER_TOKEN must already be in the private process environment.
env -u PYTHONPATH -u PYTHONHOME .venv/bin/python -m workagent.operator_tui interactive
env -u PYTHONPATH -u PYTHONHOME .venv/bin/python -m workagent.operator_tui areas
env -u PYTHONPATH -u PYTHONHOME .venv/bin/python -m workagent.operator_tui area CONVERSATION_ID
env -u PYTHONPATH -u PYTHONHOME .venv/bin/python -m workagent.operator_tui create 'Offer launch' 'Bound the pilot' project
env -u PYTHONPATH -u PYTHONHOME .venv/bin/python -m workagent.operator_tui --command-id STABLE_ID follow CONVERSATION_ID 'Make the pilot one week' --target ARTIFACT_ID REVISION_ID SHA256
```

Other commands: `chat`, `show`, `promote`, `artifact`, `history`, `proposals`, `run`,
`observation`, `revise`, `accept PROPOSAL ARTIFACT CURRENT_REVISION`,
`dismiss PROPOSAL ARTIFACT CURRENT_REVISION`, `cancel CONVERSATION`.
`revise` is the **legacy assignment-artifact** revision-request route only;
it is not a universal conversation-artifact revision command. For conversation
artifacts use `follow CONVERSATION TEXT --target ARTIFACT REVISION SHA256`.
Neither executes a worker. Script commands and curses share the HTTP dispatcher.

### Explicit exact replay (including after CLI restart)

Before any POST the client atomically reserves a new command ID and writes its
original API URL, workspace, action, arguments and exact envelope (including CAS
version/target) to a private disk journal. Reusing `--command-id` for a new command
is refused locally, even with identical arguments. It never refreshes CAS on replay.

```sh
# Inspect the original scope/payload and last known receipt first (sensitive text).
env -u PYTHONPATH -u PYTHONHOME .venv/bin/python -m workagent.operator_tui command STABLE_ID
# Only if you choose to: resend exactly that envelope through the authenticated API.
env -u PYTHONPATH -u PYTHONHOME .venv/bin/python -m workagent.operator_tui replay STABLE_ID
```

The same `command ID` and `replay ID` commands are available after `:` in curses.
Replay uses the current bearer token, so the API reauthorizes it. A different base
URL/workspace, missing or corrupt record is refused. Readback failure preserves
the receipt and `readback_unknown` state; acknowledgement failure is
`outcome_unknown`. Neither causes automatic resubmission. A process interrupted
after reservation may leave `prepared` or `outcome_unknown`; inspect canonical
state and explicitly replay if needed. Local records are not proof of authorization.

**Privacy:** journal payloads/prompts and receipts are saved **unredacted** and may
contain sensitive text. The bearer token and HTTP headers are not journaled. The
default directory is `~/.local/state/workagent-commands`; override with an absolute
`WORKAGENT_OPERATOR_JOURNAL` path. Directories/files must be owned by you, mode
700/600; symlinks, traversal, non-regular and hard-linked records are refused.
Atomic exclusive IDs and integrity checks fail closed; the journal is bounded to
256 records of at most 1 MiB each. When full it refuses new writes, never evicts
unresolved commands. Archive privately only after resolving outstanding commands;
keep the same journal to replay. It is not a queue or worker retry system.

Interactive controls: arrows select, Enter opens; `:` enters commands; `use ID`
selects a conversation; `target ARTIFACT REVISION SHA256` sets the exact target;
`untarget` clears it; `prompt "text"` follows the selection. `r` refreshes,
PgUp/PgDn scroll, `q` quits. `cancel` requests conversation cancellation, not an
unrestricted run retry/resume. Writes display a stable ID before sending and
read back canonical state. If acknowledgement/readback is ambiguous, inspect
saved state before deciding anything else; no write is silently resubmitted.

## Controlled reproducible journey

From repository root, with the existing development dependencies:

```sh
(cd contracts && env -u PYTHONPATH -u PYTHONHOME npm run generate)
(cd web && NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1 NEXT_PUBLIC_WORKAGENT_API_MODE=real npx next build --webpack)
env -u PYTHONPATH -u PYTHONHOME backend/.venv/bin/python backend/space_fixture.py launch
```

The launcher invokes `dev_db.py` to create a **new random disposable database**
and private mode-600 environment file, seeds an empty synthetic workspace,
chooses loopback ports, starts real API/production-web processes, and stops its
owned processes in `finally`. It never reads retained live environments/DBs.
It writes evidence under `.local/budget-preparation/space-fixes/journey-*`, including
a real HTTP lost-ack/restart replay check and a per-fixture private command journal.

The browser starts a substantial synthetic service-offer request. A real API
create response is forwarded unchanged while a new *synthetic* fixture grant is
configured for that exact conversation. The existing test factory uses
`ResponsesTransport.synthetic(httpx.MockTransport(...))`: no live transport is
constructed, no network inference happens, and fixtures cannot establish model
usefulness. Only explicit admitted run IDs are advanced. The journey covers:

- parsed schema / trusted worker Space identification and saved draft;
- canonical identity shared by browser and HTTP TUI;
- saved human edit, exact target refinement, stale target rejection;
- browser proposal acceptance, TUI dismissal, saved revision/history/observation;
- actual curses PTY navigation, prompt admission, resize, refresh and quit;
- cancellation readback, leave/reopen, manual browser creation and Back/Forward;
- TUI creation/promotion, desktop and 320px screenshots, width checks.

`journey.json`, `controlled-*.json`, `tui-pty.txt`, `tui-pty-readback.json`,
`process-cleanup.json` and PNGs are evidence. `disposable.env` is private and must
not be printed. Disposable DBs/evidence are retained for independent review,
not silently dropped. The fixture launcher may be replayed to make a fresh DB.

## Limits

This is local implementation and controlled verification, **not a paid product
run, model-usefulness assessment, public deployment or live activation**. The
Space surface renders the current canonical content with existing read-only
renderers, a lead artifact selector and nearby links to the existing full editor
and exact-target refinement. Its general chat is explicitly untargeted; history
is secondary and pending proposals/errors stay visible. No second editor is embedded. Draft persistence remains the existing editor's behavior; Space goal
edits are held while refreshes happen and keep their original CAS version.
The console intentionally does not offer provider/grant controls or a worker
step/retry/resume mode. Independent controller review is still required.
