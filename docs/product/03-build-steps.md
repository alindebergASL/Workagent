# Workagent build steps

**Version:** 1.1 · 12 November 2026 · canonical repository direction

**Status:** B01 is activated by owner START, followed by B02 and B03 as prerequisites permit. STATUS records actual implementation and checks; activation is not completion.

**Goal:** Implement the complete [P01–P16 blueprint](01-product-blueprint.md) using the [technical architecture](02-architectural-plan.md).

## Execution and file conventions

The first useful outcome is a real unfamiliar-input DSH/model result in one native sheet **or** document, direct human correction, a visible proposal where appropriate, and useful continuation. B01 includes only dependencies of that path. B02 adds steering/restart and independent work; B03 keeps a result current with all clients closed. Broad office/data-suite completion follows these outcomes.

Codex/Astra owns frontend and backend and is initially the sole integration writer.
Claude availability is no longer a dependency. Parent Hermes owns commits/publication,
test-server setup, accounting reconciliation, live issuer operations, paid calls and
final browser verification. Delegated coding/review workers, not Parent, do not commit/push, operate services, SSH,
access databases/credentials, issue paid calls, delete retained data, change profile
skills or spawn agents. One writer per stream; preserve concurrent work.


Within the activated increments, continue reversible implementation, targeted checks, integration and feature-branch publication without consent at each unit, review, commit or restart. Use changed-behavior checks and at most one useful independent risk review. Skills can supply compatible techniques without activating mandatory fresh-agent, two-stage/per-task review, clean-commit-every-task or full-suite-every-edit cascades. Higher-priority/tool safeguards remain. Profile maintenance is separate; repository prose does not claim to change effective profile files.

Read [development direction](../DEVELOPMENT_AUTHORITY.md), [model spending](../GENERAL_MODEL_AUTHORIZATION.md) and [STATUS](../../STATUS.md). Preserve stopped owner services, the alpha financial authority, historical receipts/allocations/unknown liabilities and the rc1 slice. Pre-pivot application data is disposable with no migration/compatibility requirement; no deletion is part of this run. Start fresh state and protect new human work. Product-model inputs remain synthetic-only until scope and handling are reconciled. Read actual provider limits and usage before paid use under the owner's fresh rebuild authority. The legacy $275 campaign is historical, not the new cap; preserve its records and do not issue new legacy certificates for rebuild funding. Do not invent a numeric allowance beyond the configured provider limits. Parent owns actual accounting and paid proof; delegated coding/review workers make no paid call or installed accounting change. Development-agent use is separate.

New paid providers, SDK purchases, private accounts, external business effects, installed-data maintenance, destructive cleanup, default merge and public deployment retain their genuine authority requirements. Follow development direction's scoped failure-handling rule: preserve explicit denials/security boundaries, diagnose and correct reversible setup within existing authority, and escalate only the affected action when needed. Delete only owned regenerable output. A Workagent test server is a deliberately isolated product environment, never the operator Hermes host/profile. No operator-home mounts or credential-file reuse.

Source baseline is `0ceb9818eb5278b54c37b3cf72c1fec2a8325b1d`. B01 starts from `bbd9631afd34fa915233f6f4f32428635b5dc6b4`; paths below become real only as consumed. STATUS records which exist and what passed. Use a small workspace root/shared contract only where immediately consumed. Do not create empty packages, an all-package scaffold or a generic root toolchain first. Start with the client, service, DSH runner and their necessary shared types; extract packages when a real consumer, ownership or trust boundary warrants it. Paths may be adjusted coherently as code establishes those boundaries.

File shorthand below is relative to these concrete targets: server = `apps/workagent-server/`, runner = `apps/workagent-runner/`, client = `apps/workagent-client/`, artifact = `packages/workagent-artifacts/`, broker = `packages/workagent-broker/`, and app host = `packages/workagent-app-host/`. Keep B01 modules beside their first consumer; extract to these package locations only when used. Each named test lives with the implementation it exercises.

Use the actual package-local toolchain and focused scripts established with each implementation. For example, after the relevant package and script exist, `pnpm --dir apps/workagent-server exec vitest run tests/command-admission.test.ts` or the client equivalent can run a named test. Use only scripts actually present in the checkout. Database checks use explicit disposable data; browser checks use an explicit test URL and synthetic identities. Keep logs/screenshots in `.local/` or CI, not new evidence files. Attach targeted CI to new-client/runtime paths when code exists; current legacy frontend CI does not cover them. The retired $100 boundary checker is historical tooling, not a prerequisite or financial authority.

## First useful private work

### B01 — Real model → editable artifact → human correction → continuation

**Scope:** P01, initial P02 or P04, P05, enabled P13, foundational P16. **Dependencies:** implementation scope, usable existing accounting/grant route, small identity/source boundary, one legitimate native editor and isolation for any enabled tool. No previous infrastructure packets, owner acceptance, physical phone, two-human suite, whole passkey product or full browser takeover are prerequisites.

**Files to create as consumed:**

- `apps/workagent-runner/src/{host,provider,session-binding}.ts` for one coherent public DSH composition.
- `apps/workagent-server/src/{identity,commands,outbox,events,sources,artifacts,proposals}.ts` and `migrations/0001_workspace.sql` for the minimal owner/work/source/artifact state in a fresh database.
- `apps/workagent-server/src/editors/{univer,mutation-authority,revision-feed}.ts` for the first sheet or document adapter.
- `apps/workagent-client/src/{App,Conversation,WorkArea}.tsx` and `src/artifacts/{NativeEditor,ChangeProposal}.tsx` for conversation beside actual direct editing.
- `backend/workagent/workspace_accounting_bridge.py` and a consumed model-broker module for the qualified seam; shared command/revision types only where client/service/runner use them.
- If parsing or computation is enabled, the smallest needed isolated worker under `services/workagent-execution/` and its scoped broker; do not scaffold the final tool fleet.

**Implement as one vertical unit, with coherent backend/editor interfaces under the initial sole writer:**

1. Qualify the smallest accounting/provider path early. Inspect `backend/workagent/{responses_ledger,provider_attempts,responses_io,responses_recovery}.py` and existing tests before defining signatures. They are coupled to old run/profile/schema semantics. Adapt only authorization, reservation, stable dispatch identity, usage/settlement and uncertain-liability handling in disposable data. Do not import legacy task selection, schemas, dispatcher, scheduler or runtime to make DSH fit; do not introduce another financial authority. A needed installed schema/grant change is a precise activation dependency to prepare and report, not something to bypass.
2. Use public DSH APIs with one coherent published 0.2.2-rc.1 package set. Preserve provider identity, tool IDs, attachments and opaque replay fields. Disable session sharing, feedback/log contribution and unintended paid search/default routes. Account for every enabled inference path, including retries, children, compaction and auxiliary calls; keep unaccounted paths disabled. Do not detour into rc2 qualification or mix prereleases. Product inference uses OpenRouter `typesafe/jev-router`; `typesafe/jev-1.14` is a separate Decisions API, not a chat model. No silent direct-TypeSafe calls, classifier framework or probabilistic permission gates.
3. Establish a small authenticated workspace identity, source ownership/grants, stable command IDs, separate content/intent/grant revisions and atomic command/outbox admission. Secure transport and suitable authenticated access are required for any enabled remote use; passkeys specifically are not required before the private proof. Preserve originals/provenance and limit sources to permitted synthetic inputs.
4. Qualify **one** genuine native sheet or document: create, directly edit, select, save and reopen with human and agent contributions. Match editor/headless/server SDK versions. Evaluation allows three editing connections (agents count), ten exports/month, watermarks and restricted modules. Diagnose those license limits separately from bugs; do not purchase or evade limits. Reject/restrict an adapter that loses content, permits unauthorized access or cannot protect commits. Keep a safe working editor path and scope the blocker; do not begin framework shopping or substitute generated HTML for native editing.
5. Serialize relevant read-set, intent, grant and cancellation preconditions with the authoritative mutation commit, including transformed operations. A preflight-only CAS followed by OT submission is insufficient. If serialization cannot be enforced, keep agent changes uncommitted as visible proposals; accepting a proposal requires safe commit validation too. Detecting a human overwrite after it happens is not protection.
6. Confirm saved revisions at the authoritative editor. For enabled propagation, prove either a shared content/outbox transaction or durable revision/snapshot catch-up with retention, gap/reset, ordered cursor and idempotent replay, including deletion and revocation handling. Process-local callbacks are only wakeups. If catch-up is unproven, disclose that limitation and retain safe save/reopen/proposal work without claiming durable automatic propagation.
7. Use the approved model through the qualified ledger path as soon as these actual prerequisites pass. Read live accounting, check existing grant/data/purpose authority and use the smallest permitted real-model check. An unfamiliar synthetic task must produce an editable result without fixture-specific code. Let a person correct it, have the agent continue from that correction or present a protected proposal, then save/reopen. Keep truthful failures and usage; no long fake-provider-only phase or paid evaluation campaign.

**Changed-behavior checks:** Create focused `tests/{command-admission,source-access,editor-commit}.test.ts`, runner `tests/provider-contract.test.ts`, `backend/tests/test_workspace_accounting_bridge.py` and client `e2e/delegate-edit-continue.spec.ts` with their implementations. Check duplicate/conflicting command IDs and rollback, access denial, reservation/unknown-liability retention, and a human edit committed **between** agent read/preflight and attempted mutation. Assert it cannot be overwritten. Exercise native save/reopen and actual correction/continuation in the browser. Use fixtures for bounded failure cases, followed by the real authorized path; report those evidence types separately.

**Outcome:** A useful native editable result and protected continuation on unfamiliar input. The ledger seam may block paid dispatch; the editor seam may block direct agent mutation. Those blocks do not prohibit independent authorized work. Owner usefulness feedback remains necessary to claim acceptance, not to start B02's technical work.

### B02 — Steering, cancellation, restart and independently scoped work

**Scope:** P01/P05/P16 and secure phone continuity. **Depends on:** B01 command/session identities, saved artifact and permission model; not owner acceptance of B01.

**Files:** runner `src/{dispatch,recovery,projection,cancellation}.ts`; server `src/events.ts`; client `src/{ReturnHome,Conversation}.tsx`, `src/lib/product-stream.ts`; runner `tests/dispatch-recovery.test.ts`; server `tests/event-resume.test.ts`; client `e2e/concurrent-steering.spec.ts`.

1. Persist work/session/request bindings; recover after admission, ambiguous native session creation and accepted prompt persistence before creating another execution. Use public durability barriers; do not invent DSH replay arguments.
2. Steer intent and advance cancellation epochs without discarding contributions. Reconcile in-flight effects truthfully; unknown effects are never blindly resent. Preserve immutable receipts and distinguish requested cancellation from stopped work.
3. Add authorized product replay with snapshot-reset on an expired cursor. Preserve unsent input and drafts through updates, reconnect and restart. Keep the composer usable while work runs.
4. Start unrelated work with separate context, sources and authority. Return to both outcomes without leakage or duplicate effects.
5. Provide authenticated encrypted remote access under actual service/access authority using a suitable existing mechanism. Make focused phone reading/editing/steering usable. Obtain physical-phone evidence when available; emulated layout is a separate claim and its incompleteness does not hold other units.

**Verify:** Targeted crash/replay, stale-intent/cancel and context-isolation checks; browser start → steer → second task → human edit → restart → return. Record actual phone testing separately. No full multi-human or partner suite is required here.

### B03 — Keep one useful result current with every client closed

**Scope:** Initial P06/P11. **Depends on:** B02 durable command/recovery, one B01 artifact and proven durable source/revision observation. Does not depend on complete sheets/boards/decks, remote connectors, dashboards, certification or sharing.

**Files:** server `src/{responsibilities,scheduler,notifications}.ts`, `migrations/0002_responsibilities.sql`, `tests/responsibilities.test.ts`; artifact `src/{bindings,observations}.ts` in the module that consumes them; client `e2e/background-maintenance.spec.ts`.

1. Store scope, actions, timezone/catch-up policy, budget reference, triggers, last observation, notification preferences and end/pause conditions. PostgreSQL due rows/validated webhooks admit occurrences atomically into the existing command/outbox path, with deduplication.
2. Start with an owned synthetic file or already authorized source. Maintain one deterministic value or propose a semantic change. Preserve manual overrides until explicit relinking and show new findings.
3. Close every client, change the source, restart the service during an occurrence and return to an updated result or clear decision. Use durable server capability, not a browser-only tool.
4. Handle unchanged observations quietly; update freshness without chatter. Add thresholds, quiet hours, digests and pause/resume/end behavior. Recheck grants before every occurrence and retain uncertain effects.

**Verify:** Duplicate occurrence/webhook, restart, catch-up, revoke/pause during work, changed/no-change and end-condition cases; actual backend progress while all browser clients are closed. No claim of exactly-once external execution. This is the first persistence outcome before suite expansion.

## Expand shared native work

### B04 — Complete sheets and practical document/file exchange

**Scope:** P02/P04. **Depends on:** the relevant native editor from B01; add the other editor when ready. B03 delivery order does not impose owner acceptance as a gate.

**Files:** artifact `src/{sheet-features,document,exchange}.ts`, `tests/{sheet-features,exchange-roundtrip}.test.ts`; client `src/artifacts/{SheetEditor,DocumentEditor}.tsx`, `e2e/sheet-editing.spec.ts`; isolated conversion workers only as needed.

Implement tabs/cross-tab formulas, formatting/conditional formatting, dropdowns, checkboxes, charts, range/selection-aware requests and blank/paste flows. Add CSV/XLSX import/export and Word/PDF/Markdown exchange, retaining originals and disclosing losses. Add authorized Google Sheets import and Google Docs delivery when their account/API scopes exist. Reopen exports and inspect formulas, values, layout, charts and comments, not merely file existence.

**Verify:** Focused native edits and round-trips, realistic populated 100,000-cell/formula workloads, keyboard/phone interactions and meaningful performance/resource observations. Record supported and unsupported formula families. The November 12 competitor's unenumerated 144-function catalogue cannot establish exact formula parity. Account unavailability blocks only the relevant Google flow.

Increment42 is privately installed and verified at `ddb852c4`: `5Quarters`
adds the seventeenth XLSX icon family. First-party full/three-quarter/half/
quarter/empty SVGs replace both native registries before canvas caches or picker
previews; native IDs, authored controls, thresholds and history remain unchanged.
Parent verified installed native pixels, authoring/manager thumbnails, edit/
Undo, real file download/reimport, cold reopen, refusals and a fresh read-only
provider-receipted model answer. Focused/core checks, independent review,
restricted namespace/PostgreSQL qualification and the exact-source build passed;
STATUS records precise counts and retained failures. Existing mixed/custom/
no-icon/x14, ambiguous-percent, precision, formula and tied-band refusals remain.
LibreOffice source/export parity is separate evidence, not native/Excel parity.
Google account/API scope and physical-phone proof remain open. Increment43 is
privately live and verified at0d016cfb32480f06ee808c7224cbdf6f337876aa/196 blobs:
identity/save first, mounted collapsible creation/exchange tools, native panes
before chart details and retained compact disclosures. Independent Astra review
PASS; Parent686 Node checks/typecheck/diff and exact101-source/80-artifact build
passed. Twelve isolated compiled-browser stages and thirteen installed-browser
stages passed; installed390px no-chart sheet canvas367px high and document406px,
with360/390/430/1440 containment, actual typing/title/messages/CSV preview retained,
explicit saves and cold reopen. Existing chart controls and collapsed error notices
remain reachable. Two new QA works only;55prior works/108jobs/7financial tables
unchanged,0new model calls,0active jobs, exact runtime.env. Backend/contract/runner
unchanged; prior restrictedPG evidence reused, not rerun. Physical phone remains
unverified: browser emulation is not phone proof. Full product scope is unchanged.

### B05 — Two-human collaboration, presence, comments and history

**Scope:** P05, collaboration portions of P03/P08. **Depends on:** B01 safe commit/revision authority for the chosen artifact, not complete file exchange.

**Files:** server `src/collaboration.ts`; artifact `src/{comments,history,anchors}.ts`, `tests/history.test.ts`; client `e2e/collaboration.spec.ts`.

Enforce current ACLs on reads and submissions, not only room entry. Support identifiable cursors/selections, teammate following, anchored comments, individual undo and restore-as-new-revision. Transform anchors through row/text/object changes so citations do not silently move. Reconnect must converge without erasing accepted edits or hiding stale agent proposals.

**Verify:** Two human identities and an agent, reconnect, row insertion, revoke mid-session, overlapping/disjoint edits, individual undo and restore history. Diagnose the three-connection evaluation limit, including agents, before calling a connection refusal a bug; no limit bypass. Two-human evidence is required for this claim, not B01.

Native qualification slice (not installed in the normal app): `native:qualification` is a
separate, opt-in consumer of `native-collaboration.mjs` and `NativeCollaborationEditor`.
One synthetic Sheet/two configured Workagent principals; only cell mutations and row
insert/remove are admitted. Legacy snapshots, model writes, export and other lifecycle
paths are unavailable. Native content lives only in the SDK adapter; Workspace owns ACLs.

The Workspace transaction row lock encloses the SDK `commitChangeset` continuation
(actual SQLite CAS). Before native dedup, Workspace durably binds the unchanged SID
to its authenticated principal, unit and storage pair. Reconnect/restart/regrant retain
these bindings; missing legacy ownership refuses rather than adopting history. SID
strings are bounded to 128 ASCII identifier characters and 4096 retained bindings;
exhaustion refuses new identities without evicting old ones. SDK reqId dedup, ACKs and
operation identities are unchanged; no second operation-outcome ledger exists.

Each HTTP/WS delivery enqueue independently takes the same Workspace lock. The pinned
1.4.0 Node transport calls `socket.send` synchronously inside its Promise executor;
the promise settles on write completion. Only enqueue runs under the lock; completion
is awaited outside it, with immediate rejection handling and a 10-second close timeout.
This composition is specific to that transport contract, not arbitrary async sends.
`Workspace.share` uses the same lock. A revocation that wins the lock rejects an
admitted edit; a commit already holding it precedes revocation. Session access revisions
fence downgrade/regrant. Bytes already enqueued before revocation cannot be recalled.
No cross-database atomic propagation, failover or safe agent-commit claim is made.

Startup validates all configuration before writes. Parent must explicitly provision a
NEW private root and empty synthetic Workspace pair. The marker binds owner, unit,
actual PG database identity, a random pair ID, canonical paths and root/file device/inode
identities; Workspace retains the same marker and SID ownership namespace. The root and
files must belong to the service UID with private permissions, no links/hardlinks or
unknown files. The writable SDK constructor follows these checks. Ready pairs never
reseed a missing unit. Partial provisioning is retained for Parent diagnosis, not
silently adopted. Existing evidence files without markers are intentionally refused.
The dedicated 0700 root and exclusive process leadership assume no concurrent trusted
same-UID filesystem replacement; this is not protection from a privileged host actor.

Parent commands (not run by the repair writer; Parent's generated lock stays unchanged):
```bash
npm run test:native-collaboration
npm run typecheck
# Parent builds remotely; the normal-workspace successor below changes the App.
# For the SDK check, /ABS/PARENT must exist and /ABS/PARENT/NEW must NOT exist:
WORKAGENT_NATIVE_SDK_CHECK=fresh-synthetic-only WORKAGENT_NATIVE_SDK_SQLITE=/ABS/PARENT/NEW/content.sqlite node apps/workagent-server/tests/native-collaboration-sdk.mjs
# Use a NEW isolated PG database named workagent_native_<suffix>, apply
# apps/workagent-server/migrations/0001_workspace.sql, set WORKAGENT_DATABASE_URL
# and WORKAGENT_OWNER_ID, then provision its empty Workspace:
WORKAGENT_DISPOSABLE_SCHEMA=workagent_b01 npm run provision
# Set existing-style WORKAGENT_AUTH_TOKEN, WORKAGENT_ORIGIN and exactly one
# WORKAGENT_SYNTHETIC_ACCOUNTS_JSON peer. Also set all of:
# WORKAGENT_NATIVE_DATABASE_NAME=<actual new database name>
# WORKAGENT_NATIVE_ROOT=/ABS/PARENT/NEW-PG-PAIR (must not yet exist)
# WORKAGENT_NATIVE_SQLITE=/ABS/PARENT/NEW-PG-PAIR/content.sqlite
# WORKAGENT_NATIVE_QUALIFICATION=synthetic-only
WORKAGENT_NATIVE_PROVISION=new-owned-pair npm run native:provision
npm run native:qualification
```
Post-repair qualification: the same independent reviewer closed all three findings.
Parent passed 117 affected Node tests (zero failures/skips), typecheck and diff checks.
Fresh actual SDK 1.4.0/SQLite plus restricted PostgreSQL verified SID-poison refusal,
legitimate retry/restart/regrant, real row-lock contention, revocation-before-commit,
foreign/unmarked/symlink/wrong-pair refusals without writable construction or changes
to PG/owned/foreign SQLite, and PG revocation before a controlled send promise flushed.
The controlled-backpressure probe is not a claim about kernel TCP-buffer saturation.

Eight distinct two-context browser stages passed against the real native service:
load, bidirectional cell convergence, lost-ACK SDK retry (three identical SID/reqId
submissions, one native commit), offline E5 edit transformed to E6 across a peer row
insertion, exact native snapshot after process restart, live editor→read fencing,
fresh read-only pointer-edit refusal, and revocation denying session/snapshot reads.
The initial ACK-recording hook incorrectly read responseText for responseType=json;
that harness error is retained. The ACK and WS echo were actually withheld, and the
SDK recovered the same operation without Parent replay. This is not error-free fault
instrumentation. No model calls, homegrown OT, licensing edits or watermark removal.
The unchanged UI reused its qualified build after compiled-input/dependency/lock checks;
80 deployed artifact hashes matched. Qualification services stopped; paired stores and
browser state retained. The installed normal application remains unchanged.

The SDK-only command above uses a fake Workspace store, not PG or browser proof.
Parent's separate fresh-PG/browser runs supply that foundation evidence.

Normal-workspace successor (candidate, not installed or independently approved):
`WORKAGENT_NATIVE_WORKSPACE=synthetic-only` enables explicit **New collaborative sheet
(development)** in the normal App. Absent flag keeps legacy creation/routing. Use a NEW
isolated PG Workspace and a NEW owned SQLite root, with the settings above, plus the
normal `WORKAGENT_STATE_DIR` and an explicit port/origin. Do not reuse or adopt the
qualification pair or installed data. Use `umask 077` for SDK sidecar privacy. Set the workspace flag for both commands:
```bash
WORKAGENT_NATIVE_WORKSPACE=synthetic-only WORKAGENT_NATIVE_PROVISION=new-owned-pair npm run native:provision
# Parent remote build required: npm run build (normal App changed).
WORKAGENT_NATIVE_WORKSPACE=synthetic-only npm start
```
The marker purpose distinguishes normal workspace storage from standalone qualification.
Provisioning starts with no native works. Explicit creation reserves a stable work/unit
ID in Workspace before SDK creation; exact command retry can finish a reserved creation
without replacing an existing native unit. Startup only checks retained units. A
cross-store failure may leave a visible `creating` reservation until that same explicit
command is retried; there is no atomic PG+SQLite transaction or automatic replay.
Normal work metadata has no workbook or content revision mirror. Only the explicit HTTP
work-open route admits native metadata; legacy get/save/model/proposal/exchange paths
refuse it. Sharing uses Workspace.share and invalidates native sessions. HTTP and WS
routes bind one authenticated principal/unit/access epoch, and retained SID bindings
for this new mode also bind the epoch. The unchanged native SID/reqId still own dedup.
The SDK public cache interface is scoped by binding/principal/unit/access epoch;
older pending operations stay retained without loading into a regrant. Normal navigation
refuses active cell input, unacknowledged work or conflicts, flushes cache before disposal,
and preserves legacy editor/composer drafts. Hidden exchange forms stay mounted.

Writer checks for this successor: `npm run test:native-collaboration` (24 pure tests),
typecheck, and the actual-App orchestration suite (125 passed, zero failures/skips).
The latter unexpectedly includes one temporary loopback HTTP fixture: running it
exceeded the writer's pure-only boundary; it exited, no actual DB was opened. The first
new HTTP test used string chunks rather than Node buffers and failed (3 pass/1 fail);
the corrected in-memory handler suite passes 4/4. Parent subsequently verified actual
SDK 1.4.0/SQLite multiunit behavior and restricted PG/SQLite on the fresh pair
`workagent_native_test_1ff4029aeffe`: two units, concurrent create idempotency,
cross-work/unshared-peer refusals, one commit plus dedup, isolation, exact restart and
no retry reseed (36 source hashes; `b05-native-workspace-pg-result.json`). Parent's
182-source/80-artifact build passed in 38.816s with a 4GB heap. These are Parent's
reported checks, not writer executions. Normal-App browser qualification remains open.

Targeted UI correction after the same reviewer's HOLD2: App checks pending legacy
input and saves after the native-session fetch and again after the departure await.
The collaboration child is keyed by principal, binding, unit and access epoch; a new
session gets fresh hooks only after the existing canLeave/close/cache-drain path.
Blocked state is not reset in place within the same session. Three App test loaders
now explicitly handle the collaboration component; legacy fixtures reject rendering it.
Repository regressions reproduced pending-document loss (1 failure), stale blocked
state through App's actual keyed-child lifecycle (4 failures), and all 9 legacy loader
failures. An initial lifecycle fixture needed its fake clearInterval wired before the
stale-state red assertions; that was a harness correction, not a product fix.
After repair: 14 mobile/Google/lifecycle tests, 15 selected App/navigation tests,
5 App-header loader tests and 24 pure native/cache tests pass (58, zero failures/skips),
plus typecheck. No full csv-app suite, listeners, databases or build in this correction.
Backend/storage/SID/cache protocol unchanged; retained Parent reds remain untouched.
Parent must rebuild the changed normal UI and qualify pending clipboard navigation,
revoked A → authorized B and regrant transitions, legacy drafts, and the full normal-App
two-principal flow. Exact backend hashes can reuse Parent's proof above. Reviewer
closure is pending; this is not self-approval or complete B05 acceptance.

Presence checkpoint after Parent's qualified `ae3133d` cursor/workspace foundation:
the native editor observes the existing session and `MemberService.getRoom(unitID).members$`
to show authenticated names, this tab and other sessions of the same account. Disconnect,
conflict, access fencing and disposal clear the roster; no additional session or send.
Native cursor/selection rendering remains unchanged. Writer checks: 3 actual SDK
membership-service tests with inert session status, 19 App/work-area fixture tests,
8 existing cursor tests and typecheck pass. The first membership run was 2 pass/1 fail
because the fixture subscribed before creating its room. Subsequent independent review
proved ONLINE-before-room can occur in production too; the initial fixture adjustment
was not sufficient qualification. Corrected live closure is recorded below.

Ordinary-editor isolation correction: importing the collaboration facade globally made
ordinary FUniver factories demand CollaborationController. The native consumer now uses
public DataLoaderService.loadUnit → CollaborationController.readyForCollab and entity
status$/changesetResend$/conflict$ subscriptions, scoped to its unit/instance. The roster
uses MemberService directly. Actual SDK factory regression reproduced the failure and
now passes for ordinary document/sheet edits after native imports and injected native
service setup; no legacy collaboration plugins or vendor patches. Correction checks:
2 isolation/service-wiring, 20 App/work-area, 3 membership, 8 cursor and 3 selected
navigation tests pass (36 total, zero failures/skips), typecheck/diff pass. The first
post-fix factory fixture lacked the render plugin used by production Sheets; adding
that fixture dependency resolved its separate render-manager error. Parent cold and
native→legacy browser/clipboard checks subsequently passed as recorded below; this is
not a main-service installation claim.

Roster lifecycle correction: 1.4.0 retains the member map and emits ONLINE before
merging JOIN members. The view waits for actual room creation and removes the previous
join's members through public MemberService APIs before that native merge. A pre-load
observer of the existing CollaborationSessionService.socket$ reconciles departures
against successful, current-source, same-unit JOIN lists with the authenticated self.
It covers reconnects completed before entity/UI readiness, creates no socket/session,
and sends nothing. Both reviewer cases reproduced RED with real MemberService;
real CollaborationSession plus inert message sources exercise the SDK JOIN/enter/leave
ordering. Final writer checks: 7 presence, 7 selected component, 8 cursor and 2 isolation
tests pass (24, zero failures/skips), typecheck/diff pass. Those were inert-source checks;
no runtime operation was performed by the writer.

Parent closure: the same reviewer additionally reproduced a malformed-JOIN exception.
Full-container/member-array validation now ignores invalid responses without partial
pruning; actual RED/GREEN regression and SAME-reviewer PASS close that P2. Final serial
affected gates: 267 passed, zero failures/skips, typecheck/diff passed. Guarded build
f44cc7d492d1 verifies 188 source and 80 artifact hashes and serves private QA only.
Ten browser stages pass: initial named owner/reader presence, same-account live tabs,
offline clearing and peer departure, rejoin without stale peer/self, peer return/narrow
wrapping, tab departure/cursor delivery, revoke/epoch clearing, read regrant/root draft,
queued-cursor disconnect, and ordinary document/sheet editing with retained drafts.
Native C/B snapshots remain unchanged; original pending work remains untouched. Earlier
ordinary-editor clipboard checks are retained. Old read-only fixture retirement and
expired synthetic-cookie renewal are harness corrections, not product fixes. The
shutdown fixture twice hit its unchanged startup watchdog; isolated reruns and the
complete serial gate passed. Main installation/default merge/public deployment remain
separate; full B05 is not closed.

Follow/unfollow qualified on private QA e091eac30eb7, not installed in main: each current non-self member (including another tab of
the same account) has explicit Follow/Stop controls. The loaded session's public
event$ supplies UPDATE_CURSOR; deserializeRangeWithSheet decodes the worksheet ID
and bounded coordinates. RefRangeService.watchRange tracks native structure;
ScrollToRangeOperation is the only movement command (viewport, never selection).
Local input/scroll interaction stops intent. Active edits, pending operations,
composition/clipboard input and a different worksheet pause instead of forcing
commits or changing sheets. Disconnect, departure, revoke and full-session disposal
clear intent; reconnect never restores it. A fresh Follow waits for a new cursor.
Structural movement/deletion invalidates the position and requires explicit restart;
cursors have no revision, so arbitrary reordered cursor/changeset correctness is not
claimed. No transport, content writer, native session or global collaboration facade
is added. Focused writer checks: six follow SDK tests and eight selected real-App
component tests, plus eight presence, eight cursor and two facade-isolation
regressions (32 passed, zero failures/skips), final typecheck and diff check;
these use inert session/command/DOM fixtures, not browser transport proof. Clipboard correction: generic host paste
only stops follow intent (including worksheet-name input). A native-instance public
ICommandService DI facade counts PasteCommand/SheetPasteShortKeyCommand promises
until settlement, including false, cancellation and rejection; overlapping pastes
remain busy until all settle. Other commands delegate unchanged. No timer or forced
input completion is used; clipboard facade reads/events are not needed for this guard.
The App non-sheet paste regression reproduced RED, then passed; seven follow tests
include real Injector/CommandService lifecycle checks with inert paste handlers.
Parent closure: SAME reviewer PASS; 275 serial affected tests, zero failures/skips,
typecheck/diff pass. Guarded build e091eac30eb7 verifies 190 source/80 artifact hashes.
Eighteen browser stages pass, including live Name-box paste regression, reader and
same-account following, explicit stop, active edit/browser IME preservation, actual sheet
paste and held actual Clipboard.read, independent third-tab row insert/delete with
conservative pause/restart, disconnect/departure/revocation without auto-resume,
390px controls, cross-work isolation and ordinary-editor typing/draft retention.
The previous clipboard defect and invalid out-of-bounds Name-box test are retained,
not counted as passes. Only fresh synthetic fixtures changed; original native C/B and
pending work are untouched. Final native connections zero; drafts preserved.
Merge and additional worksheets remain disabled by current qualification permissions;
no live proof for those paths is claimed. Full-row positions pause as unavailable.
Browser IME uses CDP, not a physical keyboard. Revisionless ordering limits remain.

Immutable cell comments/replies are qualified on private QA dccf0b193314, not
installed in main. Public thread-comment commands and sheet resource anchors are
paired with an instance-scoped external body data source. PostgreSQL prewrites are
immutable, principal/epoch/request bound and private until native committed
membership publishes them. Current ACL/head fences protect reads and commits;
normal structural deletion cascades the thread, while incomplete batches refuse.
Only known precommit policy faults map to definitive SDK rejection; native-head
races and unknown database outcomes retain their actual retry semantics. Own-request
history receipts distinguish committed-then-removed from unknown, without publishing
private bodies, guessing from absence/idle, or resubmitting. Drafts survive refusal,
queued newer input, removal, navigation guards and access changes; recovery is explicit.

Parent closure: SAME reviewer PASS; 39 focused and 308 serial affected tests passed,
zero failures/skips, typecheck/diff. Positive comment tests are in
`test:native-collaboration`; the original SDK capability probes retain intentional
missing-body/canonicalization negatives outside that green gate. Guarded build
verifies 198 sources/80 artifacts. Actual restricted PostgreSQL plus fresh native
SQLite and production HTTP handlers passed create/reply/anchor/delete/refusal,
closed-pool/new-backend exact claim reread, native reopen, unpublished-body privacy
and committed-removed receipts. An in-memory canonical-store probe alone was not
counted as PostgreSQL durability.

Nineteen corrected-build browser stages pass: distinct-principal root/reply,
reader visibility and HTTP403 without mutation, native H9→H10 movement, root/reply
structural deletion, cold hydration, unsent navigation guard, 390px containment,
actual commit then peer deletion before delayed confirmation reads, explicit
recovery without replay, full private-server restart, revoke/regrant, post-regrant
explicit creation, cross-work isolation, ordinary document/sheet real typing and
authoritative save readback, and safe retirement. Original C/B and prior pending
work were untouched; all new native connections ended at zero. The existing root
draft was restored exactly after undoing only a known harness-appended suffix.
Collapsed-panel text, cold readiness and offscreen native-menu targeting corrections
remain in evidence, not extra passes. Restart was observed offline beyond124s before
automatic convergence without another comment POST: SDK exponential backoff exists,
but exact cause/latency bound is unqualified. 390px is not physical-phone proof.
No product inference, default merge, main installation or public deployment.

Native undo containment and read-only history are qualified on private QA
93b0f49252a7, not installed in main. Actual SDK collaboration/service probes and
SAME independent review found that owner11 → peer22 → owner Undo clears both
clients and native head; Redo restores11. The intentional overlap RED stays outside
ordinary green gates. Unrestricted native undo/redo remains HOLD. A scoped public
before-command interceptor uses the actual undo/redo stack target to cancel native
sheet undo before synchronous/asynchronous mutation, without clearing stacks or
blocking embedded text/ordinary editors. This is client containment, not server
security, a native SDK repair or completed safe individual undo.

The consumed native-history panel uses existing authoritative changesets and
historical native materialization, current ACL/epoch checks before reading and at
synchronous response enqueue, bounded25-revision pages and read-only text previews
(up to4 sheets/50 cells each/500 characters per value). It never replaces the live
workbook, restores, creates revisions, invokes a model or reveals resources,
comment bodies, private prewrites or native request identities. Initial revision1
and committed revision previews are explicit. Late unit/epoch responses are fenced.

Closure: SAME reviewer implementation PASS; Parent35 focused/318 serial tests all
pass with no failures/skips, typecheck/diff; guarded204-source/80-artifact build.
Actual restricted PostgreSQL + native SQLite verify historical11/22 values and
exact history/preview after closed-pool/native reopen, reader GET-only, stale epoch
and revoke-during-read403 without native revision changes. A stale pre-edit comments
checkpoint in the first qualification harness was corrected; the failed log/pair
remain, and the corrected run used a fresh pair rather than reseeding.

Sixteen scoped browser stages pass on that build: native keyboard/toolbar Undo
preserves newer peer22; embedded text alpha→undo-empty→redo-alpha; historical11
preview while live22/head remain exact; comment draft/navigation,390px,cold reload,
reader access, delayed real response after revoke, explicit regrant/read, work
isolation, ordinary document/sheet typing/undo/redo/save/readback and retirement.
Original C/B and old root drafts remain unchanged; all new native sockets end at0.
Native redo has no available entry after blocked undo: active redo-stack refusal
is actual SDK proof, not browser proof. Native composer is hidden; retained
composer coverage is App tests only.390px is not a physical phone. Harness focus,
access-epoch, fetch-capture/readiness corrections remain in evidence, not extra
passes. No product inference, default merge, main installation or public deployment.

Explicit scalar operation reversal is now qualified on private QA26f8d832e5a9,
not installed in main. Preview/Confirm reverses only the current session's latest
acknowledged one-cell scalar operation, using a distinct legitimate licensed action
connection and server commit-time principal/intent/epoch/head fences. Standard
native Undo/Redo remains contained. This is not general account undo, arbitrary
batch/formula reversal or whole-artifact restore-as-new-revision. Retained unknown
identities reserve their original target and recover by explicit GET only, never
replay. Explicit abandonment applies only to an unused preview whose executor was
never admitted; disconnected/admitted or uncertain submissions cannot be abandoned.

SAME Astra review closed retained-target bypass and unused-preview lockout. Parent
348/348 serial tests, typecheck, production cookie-authenticated HTTP/WS and actual
client helper/action-adapter probes pass. Restricted PostgreSQL + native SQLite
reopen preserved committed/unknown/abandoned receipts, identities and content with
no resubmission. Exact-source build contains217 sources/80 artifacts. An unchanged
shutdown watchdog failed once; isolated3/3 and the full unchanged rerun passed.
Resource contention is a hypothesis, not an established root cause.

Seventeen scoped browser stages pass: both humans/native head converge after
reversal; cell input and comment drafts survive; abandon/new-operation recovery,
hidden response/cold remount GET-only, peer revision invalidation/commit race,
disconnect/server-restart receipt recovery, reader/revoke/regrant, contained native
Undo/Redo,390px preview/confirm, ordinary sheet undo/redo/save and retirement.
Protected C/B/root drafts and unknown identities remain; new native sockets end
at0. At most3 editing connections were used; over-capacity refusal was not live
exercised. Automatic human reconnect latency remains unbounded.390px emulation is
not physical-phone evidence. No product inference, main installation, default
merge or public deployment.

Full B05 remains open: expanded native surface and conflict coverage, durable
browser-crash recovery, richer comment editing/resolution and text/object anchors,
broader individual/account undo and whole-artifact restore-as-new-revision, safe
agent proposals and two-human usability. Next is the bounded agent proposal
integration; native reversal does not by itself qualify agent authority or stale
proposal protection. No existing human Sheet conversion or native export/model
bridge is claimed.

### B06 — Boards, editable decks and multilingual dictation

**Scope:** P03/P04/P16. **Depends on:** native editor/asset/selection boundaries and B05 for collaborative claims. Dictation depends on a legitimate input engine and microphone permission, not narration or partner agreements.

**Files:** client `src/artifacts/{BoardEditor,DeckEditor}.tsx`; artifact `src/{board,deck,board-png}.ts`, `tests/board-export.test.ts`; `services/workagent-execution/voice/input.ts`; client `e2e/board-deck.spec.ts`.

Implement shapes, connectors, groups/sections, text, themes, owners/dates, flows, sketch capture, region-aware help, following and annotations. Safely handle images/playable video. Add list/inspector alternatives, slide objects, presentation mode, PNG board export and editable PowerPoint/PDF deck exports. Support source-linked values and Google Slides delivery when authorized. Board-to-document/deck conversion retains explicit lineage and editability.

**Verify:** Direct manipulation, selection, annotations, export/reopen/media playback and accessible keyboard/phone paths. Test dictation in supported languages and mark unqualified languages explicitly; the complete November 12 competitor language catalogue is unknown in the supplied reference. Basic board dictation and phone editing belong here, not solely in the final reach unit. TTS is not a speech-input engine.

### B07 — Connected artifacts and shared design

**Scope:** P06/P08 across P02–P04/P07/P14 as those artifacts exist. **Depends on:** B03 binding foundation and the particular source/target adapters, not every suite feature.

**Files:** artifact `src/{bindings,propagation,design-system,publication-manifest}.ts`, `tests/bindings.test.ts`; client `e2e/connected-work.spec.ts`.

Extend live values, maintained interpretations and snapshots across board, sheet, dataset, chart, document, deck and video. Reject unsupported cycles; preserve manual overrides until relinking. Process durable changes idempotently with ordered cursor/reset and deletion/revocation semantics. Expose partial/stale outputs. Pin a consistent source/artifact manifest when outputs must agree; do not claim cross-artifact global atomicity. Apply fonts, colors, chart conventions and layouts while preserving deliberate local overrides.

**Verify:** Change an input with pending human/agent work; check propagation, proposals, overridden targets, source revocation, gap recovery and consistent publication/render manifests. Add each new artifact adapter's actual cases as introduced.

## Expand connected capabilities on their actual dependencies

These units follow the early useful/continuing-work outcomes. They can proceed independently where their stated interfaces exist. No whole-milestone acceptance, absent partner credential or unfinished unrelated adapter is a blanket dependency.

### B08 — Isolated files, computation, retrieval, browser and takeover

**Scope:** P13. **Depends on:** B01 identity/broker accounting and enabled tool scope. Minimal isolation already accompanies each B01 tool; this unit expands breadth.

**Files:** `services/workagent-execution/{Containerfile,worker.ts}`; broker `src/{files,execution,browser}.ts`, `tests/{isolation,takeover}.test.ts`; server `src/{uploads,takeover}.ts`; client browser controls.

Retain owned uploads, scoped work volumes and resource/time limits. Run untrusted parsers/code/local MCP in real isolation without host sockets, operator-home mounts, ambient credentials or trusted DB access. Keep browser profile/cookies separate from shell tools. Grant takeover through an exclusive short-lived lease that pauses observation and actions during sensitive login; interrupted takeover must not silently restore control. Unsupported consequential browser actions require human final submission. Do not run an rc2 in-host Office parser on untrusted files inside the trusted runner.

**Verify:** Actual isolation/descendant-grant denial, upload path scope, disposable browser takeover, interrupted login and explicit release. No private login or external commitment is implied by tool qualification.

### B09 — Local analysis and the first authorized remote query

**Scope:** P07. **Depends on:** scoped source identity and B08 isolation for enabled parsing/computation, not complete shared editing, B10 certification or partner coverage.

**Files:** broker `src/query.ts`, `src/connectors/contract.ts`, `tests/query-authority.test.ts`; `services/workagent-execution/analysis/duckdb.ts`; one adapter from B12 for which access is actually authorized.

Use restricted DuckDB workers for owned files with unused filesystem/network/extension access disabled. Execute remote queries under source-native permissions with bounded results, parameters, cancellation and time/resource limits. Preserve query, principal, source version, transformations and freshness. SQL parsing is validation, not the access boundary.

**Verify:** Local-file query, absent credentials, denied scope, cancellation and provenance; then one specifically authorized synthetic-data integration and revocation. Without an account, continue local analysis and report that adapter incomplete. One connector proves no other connector.

### B10 — Dashboards, stories, metric governance and bounded sharing

**Scope:** P07/P08. **Depends on:** B09 datasets/query authority; relevant B07 bindings. Certification is not required for ordinary analysis.

**Files:** artifact `src/{dashboard,story,metrics}.ts`; server `src/publications.ts`, `tests/publication-access.test.ts`; client `src/artifacts/{Dashboard,DataStory}.tsx`, `e2e/data-work.spec.ts`.

Implement editable titles/captions/charts/filters/drill-downs, ECharts with accessible tables, source/query inspectors and data stories/scrollytelling. Keep editorial wording and source revisions. Only an authorized human applies a certified metric designation; definition changes invalidate it, relevant schema/source changes mark it stale, and uncertified analysis remains usable. Add private/team/external publications with bounded live queries, allowed parameters/columns, expiry and audience. Cache keys include tenant and authority/policy, not only SQL. Revocation blocks future access/refresh; downloaded copies cannot be recalled.

**Verify:** Viewer cannot borrow creator credentials or widen queries, scope-specific cache isolation, revoked refresh, certification invalidation and uncertified ordinary query/chart use. Sharing externally remains subject to actual authority.

### B11 — Scoped memory, learned methods and bounded JeV

**Scope:** P12/P16. **Depends on:** B01 workspace/source scope and qualified accounting for enabled model use; not dashboards, full responsibilities or partner coverage.

**Files:** server `src/{memory,methods}.ts`, `tests/memory.test.ts`; broker `src/decision.ts`, `tests/decision.test.ts`.

Store inspectable source-backed facts/preferences and correction history, with Markdown representations and a rebuildable index initially. Distinguish explicit instructions from inferences. Support remember/correct/forget and stop retrieval of revoked material, without claiming erasure from receipts or provider records. Promote useful methods as inspectable guidance, never untrusted policy. Use bounded specialists only where helpful, with parent ownership and shared spend.

Add a genuine JeV Choice-style ranking/advisory integration for a useful decision when authorized. Invalid/unavailable results fall back deterministically. Mandatory actions, refusals and urgent thresholds do not wait for advisory judgment; JeV cannot grant permissions or certify metrics. No authorized account/route means JeV remains unactivated while core work/memory proceeds.

**Verify:** Conversational remember → correct → stop using, scope/revocation, method authority limits, invalid/unavailable decision fallback and, only with actual route/spend authority, a genuine bounded JeV call. Offline ranking is not proof of that integration.

### B12 — Complete named source and semantic adapters

**Scope:** P07/P08. **Depends on:** B09 connector contract; B10 for certified-definition labels, not ordinary definition import.

**Files:** broker `src/connectors/{redshift,bigquery,clickhouse,databricks,snowflake,salesforce}.ts` with corresponding `tests/connectors/*.test.ts`; artifact `src/metrics/{dbt,looker,cube,git}.ts` and `tests/metrics/*.test.ts`.

Complete **Redshift, BigQuery, ClickHouse, Databricks, Snowflake and Salesforce** individually. Support each native query/API, schema discovery, parameters/errors, permissions, bounded results, cancellation and provenance; Salesforce is not merely a SQL driver. Import **dbt, Looker, Cube and Git-backed** definitions with version/semantic provenance. Import does not confer semantic equivalence or certification authority.

**Verify:** Per-source contract checks followed by specifically authorized synthetic integration and revocation; definition/version change and certification invalidation where applicable. Shared mocks do not prove live providers. Missing accounts leave only those adapters incomplete; full named coverage remains committed scope.

### B13 — Standard interactive MCP Apps host

**Scope:** P09. **Depends on:** workspace identity, client shell and scoped broker capability contracts; not the entire remote-data suite.

**Files:** `packages/workagent-app-host/src/{bridge,resources,capabilities,view-tools}.ts`, `tests/host.test.ts`; client `src/apps/AppView.tsx`, `e2e/mcp-app.spec.ts`. Extract this package when the host has actual consumers.

Discover `_meta.ui.resourceUri`, fetch resources, negotiate capabilities and bridge standard JSON-RPC with exact origin/source validation in a separate-origin host. Support direct opening, inline/panel/full-screen interaction and synchronized pins. Treat `ui/update-model-context` as untrusted context, not instruction/authority. Namespace view tools and remove them on close; background work needs durable server capabilities.

**Verify:** Resource lifecycle, origin denial, cross-workspace isolation, actual supported app interaction, tool removal and a closed-client responsibility independent of the vanished view. MCP Apps is a protocol, not partner accounts or universal embedded-editor permission.

### B14 — Generated apps, partner embedding and destination delivery

**Scope:** P09/P10/P15. **Depends on:** B13 host/identity/storage capabilities and the particular source artifact, not complete B12 accounts.

**Files:** app host `src/{generated-storage,embedded-auth}.ts`, `tests/generated-app.test.ts`; broker `src/destinations/contract.ts`; individual `src/destinations/<slug>.ts` and `tests/destinations/<slug>.test.ts`; client `e2e/partner-delivery.spec.ts`.

Implement useful generated calculators, explorers, trackers and interfaces in a restricted host, with distinct personal/shared storage and scoped data/actions. Sharing must not share creator connections or model budget. Native sheets/boards remain native. Embedded full editors require partner-supported framing/authentication/session exchange; never expose sign-in tokens to models or infer website login from a connector token.

Complete destination-specific mappings and receipts for **Airtable, Asana, monday.com, Smartsheet; Lucid, Miro, Zoho Vani; Amplitude, Mixpanel, Omni, PostHog and Sigma**. Extend **Google Sheets, Google Docs and Google Slides** flows from B04/B06, not duplicate them. Qualify supported full-editor integrations such as **Adobe, Atlassian, Box and Notion** individually. Represent unsupported operations and field loss honestly; some flows use links/partner interaction rather than native object creation. Do not invent APIs or silently substitute destinations.

**Verify:** Storage/capability/creator-budget isolation, exact action scope, mappings/loss reports, receipts and duplicate/unknown-effect handling. Live external writes need their real authority; dry-run mapping stays labeled unverified delivery. Missing partner support does not stop native work, but prevents claiming full parity.

### B15 — Narrated video and design propagation

**Scope:** P08/P14. **Depends on:** revision-bound scenes/assets from relevant B07/B10 artifacts and isolated rendering, not all external adapters.

**Files:** artifact `src/video-scenes.ts`, `tests/video-scenes.test.ts`; `services/workagent-execution/media/{render,narration,captions}.ts`; client `e2e/narrated-brief.spec.ts`.

Build editable scene manifests with chart/text/source revisions, narration, captions, timing and assets. Qualify local Kokoro narration and FFmpeg/rendering, actual language/voice quality, codec/asset licensing and resources. These are candidates, not installed or licensed claims. Serialize heavy jobs initially based on real capacity. Regenerate an affected scene after a claim/chart edit; pin consistent manifests and propagate design tokens while preserving local overrides.

**Verify:** Actual exported media playback, intelligible audio/captions, changed-scene regeneration, revision coherence and resource limits. A filename is not a playable video; speech output does not prove dictation coverage.

### B16 — Voice/messaging entrances and explicit device grants

**Scope:** P12/P13/P16. **Depends on:** established identity, storage, work continuity and authority semantics, not acceptance of the full suite or partner agreements. Earlier units retain basic phone use and board dictation.

**Files:** server `src/channels/{voice,messaging,device-grants}.ts`, `tests/channel-continuity.test.ts`; `services/workagent-execution/device/bridge.ts`.

Bind richer voice/messaging channels to the same work/memory scope and notification preferences. Grant a chosen device folder/action explicitly; never mount the operator's home. Support revocation/offline behavior, cross-device handoff and portable work/source/binding exports without credentials. Preserve meaning through approved model-route changes; new paid routes still need authority.

**Verify:** Real authorized channel/device journeys, identity binding, desktop → phone/device → desktop edits, revoked folder access and no duplicate effects. Physical-phone claims need physical testing; unavailable devices block dependent checks only.

### B17 — Connected outcome and preservation of new work

**Scope:** Integrated P01–P16 behavior as delivered, with explicit remaining coverage. **Depends on:** only the components exercised by the journey; it is not an approval gate for later engineering.

**Files:** client `e2e/connected-project.spec.ts`; focused saved-work recovery tests for the new product.

Exercise unfamiliar brief → board/budget → analysis → document/deck/video → maintained result, using available authorized components. Change a source with all clients closed, preserve human overrides and share only the permitted result. Report missing formula families, languages, named integrations and platform behavior in normal delivery status; do not create a new matrix or parity claim.

Preserve new human/generated contributions and retained financial references. No
pre-pivot application migration or compatibility is required; do not delete retained
data in this run or alter historical financial outcomes. Do not change stopped services
for a demonstration.

**Verify:** The relevant integrated journey and saved new-work recovery. Obtain owner
feedback when available; maintainer checks are not acceptance. Missing feedback does
not halt independent implementation. No paid comparative study is implied.


### B18 — Broader hosting, coherent restore and handover

**Scope:** P13/P16 deployment. **Depends on:** actual expanded-hosting authority, per-owner isolation and suitable license/procurement terms before admitting unrelated tenants. This is not a single-owner global prerequisite.

**Files:** scoped deployment files under `services/workagent-execution/owner-vm/`; server `tests/restore.test.ts`; extend existing operational documentation when operations are authorized.

Provide per-owner VM isolation, retain broker boundaries and measure actual host capacity/concurrency. The November 12 Business license reference does not automatically cover multiple collaboration/conversion instances, domains, load balancing or failover; resolve entitlement for the intended topology without unauthorized purchase or license-limit bypass. Containers alone do not make a VM isolation claim.

Back up and restore an isolated copy of product metadata, Office content, DSH sessions, immutable blobs, grants and accounting references. Keep revocations effective and ambiguous effects unreplayed. Verify actual running version, enabled behavior, access and recovery procedure before handover. No default merge or public launch follows from this unit without its own authority.

**Verify:** Isolated restore/recovery, revoked access after restore, unknown-effect preservation and authorized deployment rehearsal. Do not test by resetting installed data.

## Delivery reporting

A unit is complete when its concrete behavior exists and the relevant checks establish it. User-visible readiness additionally needs the corresponding real journey; full scope is incomplete while required named capabilities remain missing. Neither tests nor a published branch establish owner acceptance, installation or full parity.

Report briefly what can now be done, what ran, where it is actually available, remaining limits and the active next increment or genuine stopped-work reason. Surface ownership, authorization, license and technical blockers distinctly and promptly. Continue independent authorized work. No new review chain, study, full-suite-per-document loop or repeated plan pass is needed.

**Active implementation unit: B01**, integrating accounting-backed OpenRouter/DSH and native editing. B02 resilience and B03 background usefulness follow as their prerequisites permit. Parent performs actual paid integration after financial reconciliation; no fixture substitutes for that proof.
