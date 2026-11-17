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

**Lossless formatted-unmerge checkpoint (private QA `788e9d6c5024`, not main installation):** Existing public single/horizontal/vertical exact-set unmerge now admits compressed style references only when every covered cell's resolved formatting is unchanged. Per-strip styles may differ; actual within-strip formatting changes still refuse before local mutation and at native admission/commit. Strict reference/companion checks reject forged, unused, duplicate, unresolved, content-changing or out-of-range payloads. SAME five-file review and Parent merge5SDK/10client/17pipeline, worksheets1+4+25(import overlap), restore9+16+1/types/diff passed. Restricted PG/SQLite/cookie HTTP/licensed WS/public SEND+APPLY/new backend/restart c325bce383fd passed:41nativePOST/head42,27rawattempts27refusals,1claim,max2/final0,0productcalls/jobs. Full semantic workbook and all style definitions retained. Earlier7a47529e5623 fixture remains failed: the SAME reviewer approved expecting exactly two revision increments for a merge/unmerge cycle, with all other equality checks unchanged. Exact241source/80artifact build and served entries verified. Browser20rows contain14 qualified PASS,1 explicitly superseded PASS label,4 harness corrections and1 interruption. Actual typed/cleared styles, single/strip peer unmerge with nonempty-map identity-matched ACKs, formatting/content/comment refusals without POST,390px overflow, service restart/reopen without replay, fresh mounted read-only/delete refusal, revoke403 and cold owner passed. Final d0ed5f94a0a6 epoch4/head30 retains original values11/22/33/44/55/77, refused A12:B12 geometry, secondB2=99 and H9comment; harness name-box miss committed F5=A1:B1 and was retained, not mistaken for unmerge or erased. Cold-tab draft explicitly restored from export; no crash-draft/automatic-reconnect-latency/physical-phone claim. Actual process key/model gates absent and restore defaultOFF. Main0fd532a/runtime.env/default/public unchanged. Broader native worksheet, undo/restore, capacity and two-human usability remain open. Evidence: scratch `b05-native-unmerge-style-refs-*`, browser `native-unmerge-style-refs-browser-result.json` and retained ledger.

**Previous bounded horizontal/vertical merge checkpoint (private QA `1660a04341b9`, not main installation):** Existing public native toolbar now supports one original-sheet rectangle split horizontally or vertically, <=4,096 total cells and64 strips, preserving each strip anchor. Exact complete-set unmerge remains lossless-only. Overlapping/noncontiguous/mixed/duplicate/partial sets, comments, non-anchor content and stale/raw authority bypass remain refused. Nonempty formatting-reference unmerge is still unsupported, now refused before local mutation rather than after transport; broader styled unmerge is pending. SAME five-file review passed; Parent merge4SDK/8client/13pipeline, worksheets1+4+21(import overlap), restore9+16+1/typecheck/diff passed. Real restricted PG/native SQLite/cookie HTTP/licensed WS/public SEND+APPLY, new backend and restart passed on cf6471402980:18nativePOST/head19,16rawattempts16identity-matched refusals,1claim,max2/final0,0jobs/productcalls. Public-materializer ephemeral style IDs use previously reviewed exact-reference/full-workbook/style-definition comparison. Exact241source/80artifact build and served entries verified. Browser13distinct rows retain10PASS and3HARNESS_CORRECTION: actual horizontal+vertical distinct anchors, blank exact-set unmerge by both roles, style/overlap/comment/non-anchor/65-strip refusals,390px public More-menu controls, real service restart, reader/old-epoch403/revocation/cold owner. Native-history coordinate-object assertion correction approved by SAME reviewer; original committed horizontal action was not replayed. Final DB ea527951afa6 epoch4/head18 retains four strips, A1=11/A2=22/E1=33/F1=44/A20=66/C20=55, second worksheetB2=99,1H9comment and0jobs/provider-journal. Drafts explicitly restored after cold tabs, not crash-persistence proof;390px is not physical-phone proof. Model gates/key absent from actual process and restore defaultOFF. Main/runtime.env/default/public unchanged. Evidence: scratch `b05-native-merge-variants-*`, browser `native-merge-variants-browser-checks.jsonl`. Full B05 and broader worksheet/undo/restore/styled-unmerge/capacity/reconnect/physical-phone/real-two-human usability remain open.

**Current bounded restore checkpoint (private QA `b7397ea63d9a`, not main installation):** Owner-only historical one-cell scalar Preview → explicit Confirm creates a new native revision on the original worksheet. `WORKAGENT_NATIVE_SCALAR_RESTORE=development-only` is default OFF. Structures, styles, formulas, comments/resources, other-sheet changes and whole-workbook restore remain unsupported, not silently broadened. Existing public SDK action/transport, owner/session/ACL/epoch/head fences and immutable command evidence remain authoritative; explicit unused abandonment seals even absent preparations under the admission lock, while confirmed/admitted/unknown outcomes cannot be freed or replayed. SAME full13-file review closed intent/head-refusal stranding; Parent restore9server/16client/1mountedApp, intent1/unused2, types/diff passed. Real restricted PostgreSQL/native SQLite/cookie HTTP/licensed WS plus actual client helper/action and public SEND/APPLY passed on870be763895e:8 human native POSTs,1 restore POST,head10,5 intents,1 claim,max3/final0,0 product calls. Fresh public materializers regenerate style IDs; an independently approved harness correction resolves exact references and compares the full workbook plus every style definition (changed-RGB negative control retained). Failed fixture d1aea0f001a3 remains, never replayed. Exact241-source/80-artifact build and served entries verified. Browser ledger18 rows retains12 PASS,5 harness corrections and1 reload-inspection interruption: explicit unused abandonment, three separately confirmed restores at8/11/14, lost native/settlement replies with GET-only recovery, peer-head invalidation, other-sheet refusal,390px, reader/old-epoch403/revocation and actual private-service restart/cold recovery. Final retained DB5551e2d4c364 epoch4/head14 has original A1=77/D1=22, second-sheet A1=66,1 H9 comment and6 immutable restore intents(3 committed/3 abandoned);0jobs/provider-journal rows. Drafts after cold tab replacement were explicitly restored from exports, NOT proved crash persistence. Page fetch interception covered the explicit restore action adapter only, not arbitrary normal SDK transport. Actual process has restore opt-in but no provider key or agent model gates; installed main/runtime.env/default/public unchanged. Evidence: scratch `b05-native-restore-*`, browser `native-restore-browser-checks.jsonl`. This closes only the bounded restore slice; full B05, general undo/restore, richer worksheet/merge behavior, over-capacity live refusal, unbounded reconnect timing, physical-phone and real two-human usability remain open.

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

Native agent read/propose is now qualified on private QA40938f81d768, not installed
in main. The default-off development opt-in reuses the existing DSH host, jobs,
commands, cancellation and accounting. Public pinned native reads and retained
canonical scalar proposals add no agent editing connection and never apply changes.
Mounted owner controls preserve per-command evidence across tabs and unknown replies.
Current authorized owners can inspect bounded same-principal/unit historical results
after sharing changes; original bases remain immutable and old-epoch proposals stale.
SAME Astra review closed two-tab evidence erasure, own-cancel blockage and historical
visibility. Prior375/375 serial tests passed; final affected64/64, typecheck/diff,
221-source/80-artifact build and fresh restricted PG/SQLite actual HTTP/WS/helper/
DSH-fixture restart/no-replay proof passed (48d11303aa09).

One real OpenRouter/typesafe/jev-router browser job9432da4c-aa28-49e3-9fd7-3d0b57f4c4f6
completed with3 provider receipts/$0.0035901620/no unresolved. Its A1→33 proposal
remains unapplied. Corrected-build qualification reused this result without another
paid request. Thirteen scoped browser stages pass,11 on corrected code: owner history,
reader/editor denial, focus/selection and drafts, status/disconnect, second-tab
identity retention,390px switching, peer B2=71 edit and revoke/reopen. Final head2
contains only B2=71; A1 remains empty and the original1job/3receipts are unchanged.
Actual QA process/source and served entry hashes match; runtime.env and main remain
unchanged. Cancellation/unknown-reply proof uses HTTP/DSH fixtures, not a paid browser
cancellation. Phone, automatic reconnect latency and over-capacity refusal are not
qualified. New scopes use explicit Check request status to load historical results.

Explicit native scalar proposal acceptance is now qualified on private
QA188831ef3711, not installed in main. The separate default-off acceptance gate
requires read/propose opt-in. Canonical proposal bytes pass explicit owner Preview
and Confirm through a legitimate licensed public native action connection. Current
principal/session/ACL/intent/cancellation/head checks fence the actual commit;
a native-history receipt, not optimistic UI/HTTP success, proves the outcome.
Immutable per-command evidence survives tabs, lost replies and remounts. Explicit
unused abandonment is available only before confirmation/executor admission,
including an authoritative unused origin refusal; confirmed/admitted/unknown
identities remain protected. Original proposal evidence is never rewritten.

SAME Astra review closed backend/client unused-preview recovery and current-status
wording findings. Prior backend45/45 and integrated80/80 passed; final affected
68/68 plus typecheck/diff passed. Actual restricted PG/native SQLite TCP/HTTP/WS/
helper/action qualification (d9c395c29543) reopened committed/unknown/abandoned
receipts with no POST/provider replay. Its six DSH fixture calls are not paid
inference. Exact225-source/80-artifact corrected build and served entries match.

One real OpenRouter/typesafe/jev-router browser job77ec9841-b042-454f-a20b-6b41b7fb15b9
completed with4 receipts/$0.0044754216/no unresolved. Explicit confirmation changed
A1=11→33 once at native head4, preserving peer B2=71. The actual native commit reply
was hidden; explicit GET recovered the receipt without resubmission. Fourteen
scoped browser stages pass: two-person data, preview/remount/abandon/fresh confirm,
390px apply, drafts, editor convergence, corrected-code/server restart, disconnect,
editor/reader denial and revoke/reopen. Original job/proposal/paid receipts remain
unchanged. Final epoch4/head4; old-scope acceptance identities remain retained but
are not interpreted/replayed under a new scope. Own QA tabs were retired, keeping
contexts/storage. Over-capacity refusal, automatic reconnect latency and physical
phone remain unqualified. Main, prior QA, runtime.env, default and public unchanged.

A subsequent two-human usability correction runs on private QA2530f61a4113:
reversal guidance no longer says disconnected after ONLINE. Parent reproduced the
old UI contradiction, then passed cold-connect and real offline/automatic-online
browser checks without action rearming, agent/reversal POSTs or retained-storage
changes. Native head4/A1=33/B2=71 and the paid result remain unchanged. Parent
reversal13/13, acceptance17/17, types/diff and SAME review pass; exact225-source/
80-artifact build and served entries verified. This is not a general reconnect
latency or physical-phone qualification.

Explicit native root-thread Resolve/Reopen is qualified on private QA5724f1f0a466
(port43086, fresh DBf5fae1ddcc7f), not installed in main. Owner/root-author authority
and current native member/session/epoch/head/anchor checks protect the real public
SDK mutation. Original bodies, replies and add claims remain immutable. Because
the SDK server snapshot omits resolution state, reads use exact identity-matched
native receipts; unavailable proof marks only that thread uncertain. Ordinary
future revisions do not impose a whole-unit history-age cutoff. Explicit unused
abandonment is admission-locked and retains evidence. The same abandoned root/
head/member requires a newer native head or explicitly reopened editor before a
separate new request; no automatic reconnect or replay.

SAME review closed the history-age outage and unused-preparation lockout, then a
real-transport binding-domain mismatch. Native cookie/bearer binding and browser
profile-header checks stay distinct. Parent selected62 checks passed before the
last binding fix; final server8/pipeline7/types/diff passed. Two unchanged SDK
negative characterizations remain labeled negative, not a full-SDK pass.

Fresh restricted PG/native SQLite/real cookie HTTP/licensed WS87111a4690ac passed
reopen, exact receipts,7 native POSTs/4 committed resolutions/1 unused abandon,
hidden commit and abandon replies with GET-only recovery, author/reader/epoch
fences and max2 connections/final0. No model calls. Thirteen fresh browser stages
pass: owner/peer draft and focus preservation, explicit resolve/cold-reopen, actual
busy-cell preparation and abandon, fresh-editor recovery, peer authorship, offline
convergence, same-owner third tab,390px layout, reader denial and revocation. Final
epoch4/head9,3 immutable claims and6 actions(5 admitted/1 abandoned),0 jobs/provider
journal rows; native model gates disabled. Exact225-source/80-artifact build and
served entries verified. Prior paid evidence/main/runtime.env/default/public are
unchanged. Own QA tabs retired with contexts/storage retained. Browser harness
readiness/interception corrections are recorded, not presented as product fixes.
No physical-phone, over-capacity refusal or general reconnect-latency claim.

Author-only native root/reply text editing is now qualified on private QA8b0fdd933632
(port43087, fresh DB710f7969189b), not installed in main. Explicit Edit/Save/Cancel
retains original claims and prior private body versions; exact committed native
receipts alone publish current text. Owner cannot rewrite a peer reply. Current
member/principal/ACL/epoch/head/body-version/anchor checks protect native admission.
Missing proof affects only its comment. Unchanged Save retains no identity or POST.
Explicit unused abandonment can fence an absent preparation under the admission lock;
missing GET or a409 alone never proves no effect. Admitted uncertainty is retained.
A confirmed own version advances the form only when no newer draft would be lost.

SAME independent review passed after the unchanged-Save lockout and stale-form
correction. Parent original reproduction RED→GREEN;75 selected tests and types/diff
pass, not full-SDK green. Real restricted PG/native SQLite/cookie HTTP/licensed WS
8e1c1a505615 passed restart,5 committed edits,2 unused abandonments,9 native POSTs/
head10, hidden native reply and abandon recovery without replay, refusal/delayed-
preparation fencing, author/reader/epoch protection and max2/final0 connections.
Its initial harness wrongly expected peer receipts in owner GET; actor-scoped
readback corrected the harness, with the failed fixture retained rather than reset.

Fourteen browser stages pass: unchanged Save/no identity, repeated owner edits with
fresh form basis, peer reply authorship, resolved-thread edit, actual lost prepare
and abandon replies recovered by GET, explicit new edit after settlement, unsent
drafts/offline recovery,390px layout, same-owner cold tab, reader UI/HTTP403,
navigation draft protection and revocation. Storage enumeration order and collapsed
comment details were harness corrections, not product fixes. Final epoch4/head9;
2 original claims,1 resolution and6 edit records(5 admitted/1 abandoned),0 jobs/
provider journal rows.226 source/80 artifact and served entry hashes verified.
Actual process environment has neither model gate nor provider key. Evidence
correction: the previous resolution QA had a keyless config, but its legacy launcher
injected a process key; its gates remain disabled and0 jobs/journal were reverified.
Original paid job/proposal/receipts, runtime.env/main/default/public remain unchanged.
Own tabs retired with contexts, localStorage and unsent-draft evidence retained.
No physical-phone, capacity-refusal or general reconnect-latency claim.

Explicit author-only manual comment removal is qualified on private QA26b92169d79e
(port43088, fresh DB426c7b7c1969), not installed in main. Own replies and fully
self-authored root subtrees can be previewed and confirmed. A root containing
foreign-authored replies is refused with guidance; ownership of the work does not
permit deleting a peer comment. This is a scoped policy, not shared-thread deletion
completion. Native commit validates author/subtree/body version/anchor/member/ACL/
epoch/head. Original claims, body versions and resolution evidence are retained.
Exact receipts prove removal even after membership vanishes; absence alone does not.
Unknown outcomes stay retained; unused abandonment fences late preparation.

SAME review found and closed a pending-manual observer that interrupted structural
row deletion after its first mutation and falsely marked same-target cleanup as a
manual start. Exact public command invocation identity now distinguishes these
operations. Parent unchanged real-SDK reproduction RED→GREEN;84 selected tests,
types/diff pass. Unchanged SDK negative characterizations are not full-SDK green.
Restricted PG/native SQLite/real cookie HTTP/licensed WS411be625be3c passed restart,
3 committed manual deletions/1 unused abandon/11 native POST/head12, hidden native
reply recovery after membership disappears, real row deletion during held manual
preparation with no false start, lost abandonment GET-only recovery, delayed-input
fencing and author/reader/epoch denial. Max2/final0 connections. Initial PG harness
expected a transient success notice to survive remount; exact receipt/no replay is
the corrected durable assertion, and the failed fixture remains retained.

Fifteen browser stages pass: cancel/no effects, explicit self-authored subtree and
peer-reply removal, retained history/draft baselines, genuine native row-context-menu
deletion while preparation is held, active cell input cancellation, unused abandon
with hidden reply/GET recovery, subsequent explicit deletion, offline and same-owner
cold-tab recovery after membership disappears,390px, reader denial and revocation.
Harness corrections cover committed UI readiness, a composer baseline not established
before one earlier removal, and hidden rather than disabled non-author controls.
Subsequent removals verified composer and edit drafts from asserted baselines; the
earlier missing baseline is not claimed as preservation proof. Final epoch4/head13,
one live peer-owned reader fixture,6 retained original claims,1 body edit,1 resolution,
and4 deletion records(3 admitted/1 abandoned),0 jobs/provider journal.227 source/80
artifact/served hashes verified. Actual process provider key and model gates absent.
Prior paid receipts/runtime.env/main/default/public remain unchanged. Own tabs retired
with contexts/storage/draft evidence retained; no physical-phone or latency claim.

Bounded single-worksheet native merge/unmerge is qualified on private QA097114425fd4
(port43089, retained DB953a089e8571), not installed in main. One lossless range of at
most4096 cells uses pinned public commands and the existing licensed native transport.
Content loss, overlaps, comment anchors and format-changing unmerge are refused;
merged targets remain fenced from scalar agent acceptance/reversal. Native SDK OT,
materialization and history remain authoritative. Raw row crossings are checked both
at admission and against the current merge view at commit; no parallel editor engine.

SAME review closed raw-row bypass/test-gate wiring and two real-browser findings:
valid optional reference flags were refused, and public transport compression adds an
empty styleRefMap to the unmerge companion. Only known flags and an empty plain-object
map are accepted; arbitrary style maps/content/identity/bounds bypasses remain refused.
Parent final40 selected checks plus types/diff pass. Corrected restricted PG/native
SQLite/cookie HTTP/licensed WS/restartafefeaa8662c passed with actual public compressor:
10 native POST/head11,6 raw refusals,1 retained claim,max2/final0 connections,0 model calls.
A failed PG exact-row-roundtrip assertion is retained: isolated pinned SDK tests prove
row operations rebuild merges without reference flags. SAME review approved removing
only the expected NONE=0 fields for that comparison, retaining full sheet/resources
and peer convergence; no product normalization or blanket snapshot filtering.

The browser ledger retains27 distinct rows:22 passing stages across builds,2 product
findings subsequently corrected,2 harness corrections and1 interruption. Final-build
proof includes fresh merge/peer unmerge,2106-cell roundtrip, content/overlap/comment/
variant/style refusals, offline refusal and automatic catch-up followed by peer unmerge,
390px native overflow controls, visible historical merged ranges, reader-disabled
controls, old-epoch denial and revocation. The100x26 fixture cannot exercise an
in-bounds >4096 selection; that ceiling has local test evidence, not that browser claim.
Final epoch4/head14 retains A1=11/D1=22, A1:B2 and G4:H5, one immutable H9 comment and
zero jobs/provider journal. Original refused unmerge recovery was exported and never
replayed; fresh proof used a different range. Original browser targets disappeared
for unknown reason; saved recovery/draft evidence was retained and new isolated
contexts did not import pending operations. Draft baselines were explicitly restored
after hard reload/new contexts, not passed off as crash/reload persistence. Offline
in-session draft preservation passed. Page fetch hooks do not see native SDK traffic;
browser head/readback proves committed-state continuity, not native POST attempt counts.
232 source/80 artifact/served hashes match, actual process key/model gates are absent,
and prior paid result/receipts/runtime.env/main/default/public remain unchanged.

Bounded multiple-worksheet foundation is qualified on private QA2c35ba536bbd
(port43090, retained DB6653ac6bdfab), not installed in main. Public native commands
add up to four append-only blank default-size tabs, rename uniquely, select without
mutation, and independently edit/clear scalar cells. Original-sheet comments, merges,
row tools, reversal and agent proposals stay sheet-1 scoped; other-sheet use fails
closed. Delete/reorder/duplicate/import and formula-bearing rename remain unsupported.

SAME review closed historical-base scalar admission before native OT and the public
ClearSelectionContent mutation path. Real browser testing then found the native '+'
default-size envelope and ordinary typing's own p:undefined companion were refused.
Both received narrow fixes, Parent RED-to-GREEN probes and SAME delta rereview PASS;
actual rich text, unknown undefined fields, arbitrary sheet data and unsafe clears
remain refused. Parent final worksheet22 registrations (13 worksheet-specific plus9
imported merge checks), typing1/toolbar1/clear2/OT1 probes, types/diff pass. Additional
public SDK copy/reorder refusal checks pass2 with unguarded positive controls; browser
reorder drag did not exercise that command, so it is NOT browser refusal proof.

Corrected restricted PG/native SQLite/cookie HTTP/licensed WS/restart659a1d3bc886
passes: public native SEND and receive APPLY, head13/four tabs,11 public POST and11
raw attempts including10 refusals, retained original comment, max2/final0 connections,
zero product calls. Failed fixtures remain retained without replay. Reviewer-approved
HARNESS_CORRECTIONs distinguish HTTP transport acceptance from identity-matched native
ACK/REJ and add the public APPLY step missing from the headless receiver; an isolated
SDK positive/negative control proved style loss without APPLY and exact equality with
it. Full sheet/style/head/refusal/restart assertions were not weakened.

Final-build browser proof includes fresh owner E5=77 and peer F6=88 on the added tab,
peer convergence, native single-cell clear, independent original-sheet E5=99, native
add/rename/max-four, duplicate-name/copy/delete/multi-cell-clear boundaries, 390px tab
selection without document overflow, reader-disabled add, editor fencing, revocation,
and cold-owner reload. Final epoch4/head15 retains four named tabs, original A1=11,
D1=22,E5=99 and G4:H5 merge, added-tab F6=88, one immutable H9 comment and both old
comment drafts. Browser targets were replaced after reload inspection timeouts of
unknown cause; drafts were explicitly restored from exports, NOT crash-persistence
proof. Duplicate-name dialog recovery required waiting for its close animation and
restored focus; a fresh valid rename then committed. Earlier refused typing was never
replayed. Browser proof is committed-state/readback, not native POST attempt counts.
237 source/80 artifact hashes and keyless running process verified;0 jobs/provider
journal. Installed main0fd532a/runtime.env remain untouched. Completed QA43088/43089
services are parked with all data retained.

Full B05 remains open: broader worksheet operations and richer merge variants,
conflict coverage, browser-crash draft recovery, shared-thread deletion policy,
text/object anchors, broader individual/account undo, restore-as-new-revision,
broader-than-scalar agent acceptance and physical-phone/two-human usability. Existing
human Sheet conversion and native export remain unclaimed. Next is bounded
restore-as-new-revision through public native mechanisms, preserving the full backlog.

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
