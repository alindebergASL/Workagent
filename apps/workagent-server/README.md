# Workagent runtime: B01, B02 and first B03 slice

Concrete implementation, **not a completed B01**. Native Univer Sheets use PostgreSQL
persistence, one owner and one runner. See [STATUS](../../STATUS.md) for checks and
Parent's deployed/live evidence. No fixture mode is exposed by the product server.
Parent's November 13 briefing confirms the cancelled/canonical reconciliation repair
is deployed and live-qualified at 9513084. B03 below is a new source checkpoint.

## Install and checks

From repository root with Node 24.22.2 on PATH (the supplied toolchain works):

```sh
export NODE_OPTIONS=--max-old-space-size=3072
pnpm install --frozen-lockfile
npm run test:mechanisms
PYTHONPATH=backend python3 -m unittest discover -s backend/tests -p test_workspace_accounting_bridge.py -v
npm run test:http
npm run test:integration
npm run typecheck
npm run build -- --configLoader native
```

Use pnpm 11.28.5 and the retained `pnpm-workspace.yaml` / `pnpm-lock.yaml`; Parent owns
installs and lock changes. Stop on installation policy refusals; do not approve or
bypass blocked scripts. The worker uses Parent-provided linked dependencies without modifying them. The direct
DSH dependencies are pinned coherently to 0.2.2-rc.1, Univer to 1.4.0. The integration
test is an explicitly scripted mechanism fixture using the actual DSH loop, never
proof of model usefulness. `test:integration` also runs the real installed Univer SDK
against durable file fixtures and checks client draft fences/recovery. Mechanism tests use file/transport/issuer fixtures and
never access a database, credentials or network inference. The separate HTTP fixture
opens only an ephemeral loopback listener and is intended for Parent/CI.

## Parent-only private setup

Required environment variable names: `WORKAGENT_DATABASE_URL`, `WORKAGENT_OWNER_ID`,
`WORKAGENT_AUTH_TOKEN` (at least 32 random characters), `WORKAGENT_ORIGIN`, and
`WORKAGENT_STATE_DIR`. Supply a fresh dedicated product DB and volume. Do not reuse
an alpha/legacy application schema. No dotenv or operator credential files are read.

Parent applies `migrations/0001_workspace.sql` to the explicitly disposable product
DB, then sets `WORKAGENT_DISPOSABLE_SCHEMA=workagent_b01` and runs `npm run provision`
once. Repeated initialization refuses; startup never migrates or resets a database.

`npm start` serves the built client and API together. `WORKAGENT_BIND` defaults to
`127.0.0.1`; the only alternative is the dedicated server's `10.0.14.244`.
`WORKAGENT_PORT` defaults to 8310. Remote `WORKAGENT_ORIGIN` must use HTTPS via Parent's
private proxy. The access-key login creates an HttpOnly, SameSite cookie (Secure on
HTTPS); mutation requests require the exact origin. Single-owner use only. The key
is never supplied to the model. A PostgreSQL advisory lock refuses a second runner.

For inference, Parent supplies `OPENROUTER_API_KEY` and selects the accounting mode
below. `WORKAGENT_MODEL` defaults to `typesafe/jev-router`; explicit model overrides
remain supported. No call occurs on merely opening work. Missing accounting or key
blocks a requested turn while direct sheet editing remains available.

## Stable client/server boundary

All API results are JSON; errors are `{error: code}`. Principal comes from server
authentication, never request JSON. No CORS. Source input is bounded synthetic text,
CSV or Markdown pasted/read in the browser; there is no remote URL fetch, code tool,
private account, parser service or operator-home mount.

- `POST /api/session` `{token}`; `DELETE /api/session` ends the cookie session.
- `GET /api/work` lists owned work; `GET /api/work/:id` returns the saved workbook,
  messages, status, proposals and `expected` revisions. Polling never generates.
- `POST /api/sources` `{commandId,name,content,synthetic:true}` returns `{id,name}`.
- `POST /api/work/commands` `{commandId,kind:'start'|'continue'|'cancel',text?,sourceIds,
  workId?,expectedIntentRevision?}` atomically admits a command and durable job.
  Identical duplicate returns original identity; changed reuse returns 409.
- `POST /api/work/:id/save` `{commandId,book,contentRevision,permissionRevision}` saves
  the complete native Univer snapshot with atomic preconditions. A 409 preserves the
  server version and the browser draft; it never silently merges over human content.
- `POST /api/work/:id/proposals/:proposalId` `{commandId,decision:'accept'|'reject',
  expected}`. Acceptance requires the reviewed content/intent/permission/cancellation
  revisions still current. Obsolete proposals require a fresh agent review. Rejecting
  an obsolete proposal is allowed. Agent mutations are internal, never HTTP-exposed.

`expected` is `{contentRevision,intentRevision,permissionRevision,cancellationEpoch}`.
Human cell contributions remain protected even after a fresh agent read. Proposals
show old/new cells and retain their originating revisions. Snapshot, command result,
job and product event commit together under the PostgreSQL row lock. This is a
bounded single-owner snapshot authority, **not** Univer collaborative OT. Local
unsaved drafts persist on the device; server saves are the cross-device authority.

## OpenRouter-backed accounting and adequate output

Parent applies `migrations/0003_provider_journal.sql` additively to the existing product
DB using its installer role. It creates only `workagent_provider`; it never updates
alpha, `workspace_accounting`, certificates, bindings, receipts or policies. Give the
existing application role USAGE on `workagent_provider` and its sequence, and SELECT,
INSERT on `workagent_provider.journal`. Keep schema/table ownership with the installer
and do not grant UPDATE, DELETE, TRUNCATE or DDL. Startup never applies migrations.

Set `WORKAGENT_ACCOUNTING_MODE=openrouter` to select this mode in `main.mjs`.
`WORKAGENT_ISSUER_SOCKET` is unused in this mode; there are no old-issuer calls.
`WORKAGENT_MAX_OUTPUT_TOKENS` defaults to **32768** (positive integer, up to the
technical envelope of 1,000,000). `WORKAGENT_REASONING_EFFORT` may be `low`, `medium`
or `high`; omit it to retain router/provider defaults. DSH adapter metadata supports
these explicit selections. `WORKAGENT_REQUEST_TIMEOUT_MS` defaults to 300000 (5 min),
configurable from 1000 to 1800000. Provider capability/credit denials remain binding;
these controls neither purchase funds nor increase provider limits.

Each inference reads `GET /api/v1/key` with the same key and records limit, remaining,
reset, shared-key usage, budgets and effective budget. Exhausted returned budgets stop
dispatch. An immutable journal records exact serialized body/hash, native session and
request identity, preparation, one-use dispatch, raw receipts and provider-reported
costs. A key snapshot is **not an atomic reservation** and cannot guarantee external
in-flight spending. OpenRouter enforces the configured limits. There is no replacement
local dollar ceiling or funding certificate. Two dispatcher slots and twelve model
calls per turn remain the concurrency/resource bounds. Retries remain disabled.

Authenticated `GET /api/accounting` reports the selected mode's costs, unresolved
request count, initial/latest shared-key snapshots and null verified invoice cost.
Project request costs are distinct from shared-key totals. Unknown requests retain
identity and evidence without automatic replay; terminal usage missing monetary cost
stays unresolved. Exact retained-generation GET reconciliation remains available
through `reconcileOpenRouterReceipt` with this adapter; it cannot resend inference.
HTTP 402/403/429 evidence is retained; 429 is a rate limit, not a budget signal.
Denied requests conservatively remain unresolved when no monetary receipt is present.

Parent must qualify this additive schema, restricted-role immutability, concurrent
one-use dispatch, restart/acknowledgement loss, actual key metadata, retained charges
and the private browser journey. Local journal fixtures do not establish PostgreSQL
or provider proof. Existing completed live provider IDs must not be replayed. A new
deliberate continuation uses a new intent/session and the current saved workbook.

## Retained certificate mode

The default `WORKAGENT_ACCOUNTING_MODE=certificate` preserves the original socket
adapter and all immutable v2 policy constraints, including its 4096-token ceiling.
Changing the host allowance alone cannot enlarge this historical mode. New rebuild
work uses the explicit OpenRouter mode above; no old certificate needs rewriting or
reissuing. The existing [certificate adapter contract](../../backend/workagent/workspace_accounting_README.md)
remains available for historical inspection/reconciliation. No old ledger/schema or
issuer implementation is changed by this repair. See STATUS for Parent's prior
certificate/database/live checks and the owner's superseding fresh-budget direction.

The wire retains session identity, resolved models, tool IDs, raw SSE frames, reasoning
and usage. Tools are released only after receipt retention; length-truncated tool JSON
never executes but its terminal charge survives. Children, compaction, sharing,
feedback, search, log contribution and Decisions API remain disabled.

Outbound history on the switchable `typesafe/jev-router` route omits all
`reasoning_details` (unsigned text/summary, signed text and encrypted payloads) from
the first continuation, before serialization, hashing and reservation. A single
opaque provider item can pin routing, so this does not wait for mixed providers.
Normal assistant text, tool calls/arguments and tool result content/IDs are preserved.
Explicit fixed-model routes retain allowlisted replay only when the recorded
response model exactly equals the authorized route; absent/different models omit it.
Replay types/fields still validate before selection. Full responses, raw frames,
DSH replayState and journal history remain unchanged; this is outbound selection,
not stored-history cleanup or permission to retry an unknown request. Provider
denials retain unknown liability without automatic resend or invented settlement.

## B02 recovery and independent dispatch

The service retains one PostgreSQL leadership lock and runs two worker slots. Claims
exclude another active job for the same work. New intent supersedes queued older
intent and interrupts only older live handles; unrelated work has separate native
sessions, accepted context and source lists. Shutdown stops claiming, cancels native
activity and drains job settlement before releasing leadership.

Jobs persist `admitted`, `session_ready`, `prompt_accepted`, `execution_started` and
`completed` or `incomplete` terminal phases, fixed session IDs, accepted context and native request-step IDs
(`sessionId:step:sequence`). These step IDs do not replace financial request hashes,
provider IDs, one-use dispatch or immutable receipts.
Public DSH persistence reads reconcile existing native logs before create/resume.
Session creation and pending inbox acceptance each cross a public flush barrier.
The public API has no wake-only inbox operation: after the durable execution marker,
the same pending message ID moves through `followup`. Any crash beyond that marker
is conservatively interrupted, even if no provider call ultimately happened. Native
request/history evidence also prohibits automatic replay. Explicit new continuation
is a new intent/session; it does not retry the old uncertain request. Completed
messages recover without duplicate contributions. Native `turn/end` max-tokens and
reasoning-only empty replies now persist as incomplete, including recovery between
native closure and product settlement. Earlier edits/replies remain saved, and the
client invites a deliberate continuation. No retry is automatic. This does not
retroactively rewrite already-settled historical jobs. No retained data is deleted.

`GET /api/events?after=<nonnegative integer>` authenticates before reading the owner
snapshot and returns `{kind:'events'|'reset',cursor,events,works,snapshots}`. Omitted,
future, expired (more than 256 events) or gapped cursors yield a full snapshot reset.
The replay window limits responses without deleting retained events. Every result
shares one committed watermark. Client polling is single-flight; this is JSON replay,
not SSE. Native drafts, composer/source drafts and unresolved command/source IDs are
stored per work on the device. Switching keeps drafts; late replies cannot replace
later navigation. Local storage failure blocks draft-discarding navigation.

B02 tests use actual installed DSH with scripted local inference and file storage,
including subprocess loss without cleanup at durability boundaries, concurrency,
shutdown and intent targeting. Route tests use handlers without opening listeners.
They do not establish PostgreSQL, financial, browser, remote or phone behavior.
The supported native Vite config loader builds within the worker sandbox without
writing temporary configuration into shared dependencies. See STATUS for actual
checks; Parent retains final browser and live accounting verification.

## B03: owned-file background maintenance

The actual conversation UI has **Keep a cell current** on saved work: upload/paste a
synthetic flat JSON object, select one scalar field and a sheet/row/column, and bind.
The same panel publishes subsequent complete source revisions, changes settings,
pauses/resumes/ends, explicitly relinks a protected cell, and shows freshness,
findings and a durable maintenance inbox. Changes use the native workbook authority.
No browser watcher or model call implements maintenance. Thresholds affect notices,
not propagation; equal quiet-hour endpoints disable quiet hours. Digest delay starts
at the first pending meaningful finding. Notifications remain inside this product.

**Installation:** no new SQL migration, provisioning/reset, grant or package install.
The existing `workagent_b01.workspace.data` transaction stores additive
`ownedSources`, `observations`, work `responsibilities`/`inbox`, commands/jobs/events.
Missing collections initialize on their first authorized use. Parent deploys server,
runner and rebuilt client together, preserving the existing PostgreSQL row and
`WORKAGENT_STATE_DIR`. Keep the current `WORKAGENT_ACCOUNTING_MODE=openrouter`;
bindings record `openrouter:configured-provider-limits`, with no numerical subcap.
This path has no inference and leaves provider/legacy financial history untouched.

Files are immutable bounded JSON revisions under
`WORKAGENT_STATE_DIR/owned-sources/<server-derived-owner-hash>/<content-hash>.json`.
The authenticated API accepts only opaque source IDs, never paths/URLs/commands.
Maximum UTF-8 size is 64 KiB; at most 1,000 top-level scalar fields; string values at
most 20,000 characters. Files/directories reject symlinks; bytes are hash-verified on
read. A complete fsynced staging inode is linked before its revision is published
in PostgreSQL. Unreferenced staging files remain retained after interruption; no
cleanup is part of this change. Direct host-file changes are unsupported and produce
an unavailable/mismatched observation rather than silently becoming a revision.

Due time and source publication wake durable work. Reads happen outside the DB lock;
admission rechecks source/config/grants and commits the exact immutable observation,
command and job/event together. One pending occurrence per responsibility coalesces
missed intervals/revisions to the latest; prior versions/observations are retained.
Missing revision metadata is a visible gap. A claimed job can safely recover its
pinned observation after restart because its only effect is the same transaction's
cell commit and outcome; this makes no exactly-once external-effect claim. Human
jobs take priority and maintenance never changes the human intent/cancel revision.
Human cell edits detach the binding; only current-revision owner Relink releases
that single cell. Source failures, protected findings, pause/end/revocation and
unchanged freshness are visible; unchanged readings do not create inbox messages.

A valid source can still make the resulting workbook exceed its 4,000,000-character
serialized limit. The occurrence then completes with `validation_failed` and
`invalid_workbook`, preserving the original observation and saved sheet. The panel
shows “Last update not applied” and the inbox retains the error. Reduce sheet content
or shorten the source value, or End the responsibility; human continuation remains
available. Database/commit acknowledgement failures remain uncertain and recover from
durable state instead of being labeled a confirmed validation failure.

Additional authenticated routes (same origin and access checks as the existing API):

- `GET /api/owned-sources`: source IDs, revisions, fields and status.
- `POST /api/owned-sources`: `{commandId,name,content,synthetic:true}` creates;
  add `{sourceId,expectedRevision}` to publish a new immutable revision.
- `POST /api/owned-sources/:id/revoke`: `{commandId}`. Prior observations survive.
- `POST /api/work/:id/responsibilities`: `{commandId,sourceId,field,target,expected,
  intervalSeconds,timezone,catchUp:'latest',notifications,endAt}`. `target` has
  `sheetId,row,column` (zero-based); `expected` is from the current work GET.
  Notifications: `{threshold:0,digestMinutes:0,quiet:{start:0,end:0}}`.
- `POST /api/work/:id/responsibilities/:rid`: `{commandId,revision,action}` with
  `pause|resume|end|relink|configure`; Relink also requires current `expected`.
  Configure accepts the interval/timezone/notification/end settings above.

### Parent's synthetic live probe

Use a **new** synthetic inventory work, never the existing live demonstrations.
Record real UTC time, work ID, sheet ID/cell, source ID/hash/revision, responsibility
ID, observation ID and occurrence command ID at each readback. The statements below
are expected results, not claimed outputs. Use normal private authentication without
printing its token. All file updates go through the owned-source API/UI.

1. In the rendered UI, open a new synthetic inventory work with an existing editable
   sheet. Create `Synthetic inventory` with `{"available_units":120,"reorder_point":30}`.
   Bind `available_units` to an unused cell (for example B2), every 10 seconds, UTC,
   immediate notices/no quiet hours. If you manually populated that cell, use explicit
   Relink. GET the work and inspect the real PostgreSQL committed row: expected cell
   value 120, typed number, source revision 1, outcome `changed`, matching observation
   hash/command/job, and one inbox finding. Record the actual identities/timestamps.
2. Close **every** browser. Authenticated POST a complete revision with units 135,
   reusing the same command ID/body for a duplicate request. Record its returned
   revision/hash. Observe a queued/running occurrence and restart the private service
   during that occurrence. Verify retained observation/command identity after restart
   and eventual B2=135 (or an explicit protected decision); no extra inference/receipt
   should be produced by this path. A restart after completion does not prove the
   in-occurrence boundary. Parent must record which boundary it actually interrupted.
3. After another interval, expect `unchanged`, later `observedAt`, unchanged content
   revision and inbox count. Reopen and verify native rendering and freshness. Edit
   B2 to 999, save, close clients, publish units 150. Expect B2=999, `protected`, and a
   visible finding of 150. Relink using the latest work/config revisions; expect 150
   next occurrence while all other human cell protections and column widths survive.
4. Exercise pause before commit, publish several revisions while paused, resume,
   source revocation, end time, thresholds, timezone quiet hours and delayed digest.
   Expect no forbidden commits, explicit outcomes, recorded coalesced revision/interval
   counts and retained earlier observations. Parent should also probe transaction
   rollback and leadership/restart against real PostgreSQL and source filesystem.

`npm run test:background` contains labeled file/SQL-call fixtures and handler tests
without a listener. Browser/service/real PostgreSQL verification remains Parent's.
The first slice implements deterministic scalar bindings and interval/source-revision
triggers. Semantic proposals and external webhook/connector adapters are not added;
P06/P11's broader connected artifacts and continuing-responsibility scope is retained.
