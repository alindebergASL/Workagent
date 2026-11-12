# B01 / independent B02 checkpoint

Concrete implementation, **not a completed B01**. The UI uses native Univer Sheets;
production persistence is PostgreSQL, with a single owner and a single runner. There
is no memory-only production fallback. Financial access fails closed until Parent
connects the existing issuer. No fixture mode is exposed by the product server.

Parent installed ordinary online pnpm dependencies and supplied the workspace/lockfile.
Install reported `ERR_PNPM_IGNORED_BUILDS` for esbuild, koffi and protobufjs; scripts
remain blocked. Existing prebuilt packages suffice for the actual DSH fixture,
client typecheck and production build, all now passing without script approval.
Native Univer values/formulas also survive file-fixture save/reopen. This is headless
SDK proof; browser interaction, live PostgreSQL and paid integration remain pending.
The earlier HTTP fixture listener was refused with `listen EPERM`; this continuation
did not retry it. No product-model call, database access or service operation ran.

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
npm run build
```

Use pnpm 11.28.5 and the retained `pnpm-workspace.yaml` / `pnpm-lock.yaml`; Parent owns
installs and lock changes. Stop on installation policy refusals; do not approve or
bypass blocked scripts. Do not reuse external node_modules. The direct
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

For actual inference only after financial reconciliation: `OPENROUTER_API_KEY`,
`WORKAGENT_ISSUER_SOCKET`, and optional `WORKAGENT_MODEL` (default
`typesafe/jev-router`). No call occurs on merely opening work. Missing issuer or key
blocks a requested turn visibly while the sheet can still be edited and saved.

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

## Implemented certificate-funded accounting; live qualification pending

The [accounting contract and Parent-only setup](../../backend/workagent/workspace_accounting_README.md)
describe the implemented PostgreSQL adapter, migration and Unix socket service.
Their source exists; installation, restricted-role/socket behavior, certificate
funding and live inference remain unverified. Parent's PostgreSQL file-read refusal
still blocks schema setup pending owner clearance; these instructions do not permit
an alternate access path or retry.

Node uses HTTP over `WORKAGENT_ISSUER_SOCKET`, with acknowledgements after commit:

- `POST /workspace-accounting/v1/policy` `{}` → `{policy,policyHash}` negotiates the
  certificate-bound v2 pricing policy before building the outgoing request.
- `POST /workspace-accounting/v1/status` `{}` reports funding, settled cost, held
  liability and reported amounts separately; verified invoice cost remains null.
- `POST /workspace-accounting/v1/reserve`: `{sessionId,requestId,requestHash,route,
  purpose:'conversation',maxOutputTokens,requestBytes,requestBody,policyHash}` →
  `{durable:true,reservationId,requestHash,route,policyHash}` after durable reservation.
  `requestBody` is the exact once-serialized outgoing JSON string; its UTF-8 byte
  count and SHA-256 must match. The adapter validates that body against the bound
  policy, and the transport sends the identical string after dispatch.
- `POST /workspace-accounting/v1/dispatch`: `{reservationId,requestHash}` →
  `{dispatched:true}` only for fresh one-use dispatch authority. A repeated dispatch
  must refuse; acknowledgement loss retains an unknown liability.
- `POST /workspace-accounting/v1/retain`: `{reservationId,requestHash,outcome:
  'received'|'unknown'|'not_dispatched'|'reconciled',terminal,responseId?,resolvedModel?,
  usage?,replayState?,generation?}` → `{retained:true,...}` with settlement/liability
  metadata. Immutable receipt retention and eligible monetary settlement are atomic.

Parent imports one exact issuer certificate bound to the target database/cluster,
nonce and policy. Its full amount stays allocated under the existing cumulative
$275 authority; local settlement never refunds or reissues central funding. The
default Jev policy reserves one million input and one million completion/reasoning
tokens at its hard price caps ($6 temporary envelope at the default caps), even
though output is limited to 4096 tokens. Router tiers/preferences are not dollar caps.

A terminal response with valid finite nonnegative `usage.cost` within its envelope
can settle to that provider-reported cost, rounded up to microUSD. Unknown attempts
retain liability; absent/invalid terminal costs, overruns and conflicting evidence
freeze further dispatch as specified in the linked contract. Definitive
`not_dispatched` settles to zero only with no dispatch or prior uncertainty. Explicit
exact-generation reconciliation uses a retained response ID and raw generation
record through `/retain`; it never resends inference. No certificate or funding has
been issued for this implementation, and provider-reported cost is not invoice proof.

The provider retains session identity, resolved model, native tool IDs, raw SSE frames,
reasoning details and usage, and blocks tool completion until receipt retention. It
has no retry and caps a turn at 12 model calls / 4096 output tokens each; these are
resource bounds, not financial caps. Children, compaction, session sharing, feedback,
search, log contribution and Decisions API are not loaded. Decisions remains disabled;
no endpoint/payload has been invented. Aborted/disconnected calls remain unknown.

Immediate remaining verification: browser formula/value save/reopen with a human
correction, active-cell refresh recovery, switching and concurrent agent updates;
qualify transactions against disposable PostgreSQL and the implemented accounting
adapter/socket with certificate funding; then Parent's bounded paid unfamiliar-input journey. Restart marks an active
job interrupted when execution may have begun; B02 live/browser proof and B03 responsibilities are not
complete. No physical-phone, multi-user, server installation or acceptance claim is made.


## B02 recovery and independent dispatch

The service retains one PostgreSQL leadership lock and runs two worker slots. Claims
exclude another active job for the same work. New intent supersedes queued older
intent and interrupts only older live handles; unrelated work has separate native
sessions, accepted context and source lists. Shutdown stops claiming, cancels native
activity and drains job settlement before releasing leadership.

Jobs persist `admitted`, `session_ready`, `prompt_accepted`, `execution_started` and
`completed` phases, fixed session IDs, accepted context and native request-step IDs
(`sessionId:step:sequence`). These step IDs do not replace financial request hashes,
provider IDs, one-use dispatch or immutable receipts. No financial contract changed.
Public DSH persistence reads reconcile existing native logs before create/resume.
Session creation and pending inbox acceptance each cross a public flush barrier.
The public API has no wake-only inbox operation: after the durable execution marker,
the same pending message ID moves through `followup`. Any crash beyond that marker
is conservatively interrupted, even if no provider call ultimately happened. Native
request/history evidence also prohibits automatic replay. Explicit new continuation
is a new intent/session; it does not retry the old uncertain request. Completed
messages recover without duplicate contributions. No retained runtime data is deleted.

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
In the B02 child checkout the production build stopped on `EROFS` writing Vite's
temporary config through read-only `node_modules/.vite-temp`; no retry or workaround
was attempted. Build remains STOPPED pending owner clearance; neither child nor
Parent may retry or reroute the denied write, including through a different config
loader/path, permission change, dependency location or symlink. Parent has notified
the owner and retains final browser verification responsibility.
