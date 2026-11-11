# Workagent DSH compatibility preview

A real DeepSeek Harness host and a new, independent browser client. The model
provider is **scripted**, the workshop sources are **fictional**, and the effect
connector only writes a **local fake dispatch log**. No model inference, paid
requests, external sends, or owner data are involved. This does not establish
model judgment or general agent usefulness.

## Run from the repository root

The prepared local toolchain is Node **24.22.2** and pnpm **11.28.5**. The wrapper
uses `.local/toolchain/node-v24.22.2-linux-x64/bin` and
`.local/toolchain/pnpm/node_modules/.bin`; provision those exact versions first
in a fresh checkout. Do not use the machine's older default Node.

```sh
bash apps/dsh-slice/scripts/run.sh install --frozen-lockfile
bash apps/dsh-slice/scripts/run.sh test
bash apps/dsh-slice/scripts/run.sh run verify:source
bash apps/dsh-slice/scripts/run.sh start
```

Open **http://127.0.0.1:3310**. Compare venues, change the budget ceiling, edit and
save your recommendation, close/reopen the browser, and request a check in 30
seconds. A scheduled check requires the host to be running; a retained overdue
schedule can continue when the host restarts. Stop with Ctrl-C. The parent owns
long-lived preview operation and final desktop/phone browser verification. The
current preview is running under the parent on port 3310; this follow-up does
not restart it or touch its saved state. The old owner services remain stopped.

The host binds only `127.0.0.1`; writes require the exact local Host/Origin and
JSON content type. It is an isolated single-user development preview, not an
internet-facing authentication boundary. No preview listener is left running
by the tests. Browser sign-in tokens from DSH's internal connection service are
process-local; the custom client uses only the narrow same-origin product API.

## Runtime identity

- Pinned source: `deepseek-ai/deepseek-harness`, release `0.2.2-rc.1`, commit
  `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, at `.local/upstream/dsh`.
- Execution uses published `@deepseek-ai/dsh-*` packages, all fixed to
  **0.2.2-rc.1**, through public package exports. It does not import private
  source aliases, edit upstream, or build the CLI/desktop/web graph.
- `pnpm-lock.yaml` retains exact npm artifact integrity and transitive versions.
  Its SHA256 is `19c571727c2f44da143aea89b8d09b18ce2dd47b251543ebd33bc2445396ec69`.
  Supporting resolved pins include Cordis 4.1.0, Schemastery 3.19.0, Cosmokit
  1.9.0, node-addon-system 0.1.2, Koffi 3.1.1 and TypeScript 6.0.3.
- Upstream's committed lock is unchanged (SHA256
  `aa1293f2e8d3ee82cb3cfcb0e65ba8a0ef73ab80fad4c35d7ed2f7c67b95a625`).
  This app has its own coherent published-package lock; it does not claim to
  reproduce the entire upstream monorepo dependency graph.
- Published metadata has no `gitHead`. `verify:source` compares selected
  controller, LLM dispatch, agent steering and recovery method structures with
  the pinned source and prints installed bundle hashes. Those checks pass;
  they are **selected structural comparisons, not full artifact attestation**.

`src/host.mjs` is the curated composition. `src/workagent-plugin.mjs` is the
custom Cordis plugin: it registers the scripted LlmAdapter, CSV tools, the
comparison tool using actual concurrent DSH subagents, and the fake connector.
The real release owns AgentLoop, native tool execution, JSONL persistence,
checkpoint policy, SessionController, child lifecycle and schedules. The exact
public `/typert` contract is registered with the real gateway.

The new plain HTML/CSS/JS client imports no existing Workagent or nanoMuse UI.
Its HTTP bridge exposes one responsibility, not arbitrary DSH RPCs. DSH follow
opens with a snapshot and then durable updates; **this release has no `afterSeq`
input on follow**. Reconnect rebuilds from the current snapshot. History reads
and observed cursors are retained without inventing a resume-cursor API. Page
hide closes and clears the follower; page show refreshes state and reconnects
once, preserving the active draft and its original optimistic edit version.

## State and isolation

All caches, downloads, temporary files, fixture logs and preview state are under
this worktree's `.local/dsh-slice/`. Only normal ignored `node_modules` lives next
to code. Preview state is in `preview/`; tests create isolated roots in `state/`.
The runtime/test launcher removes inherited credentials and caps Node's heap at
2048 MiB. Dependency installation retains the managed proxy/CA environment.

No telemetry, account, analytics, real-provider, shell, browser, or automatic
LLM retry plugin is mounted. Credential references always resolve absent. The
agent work directory is separate from host plugins/configuration, product
edits, inference records, effects and DSH logs. No generic filesystem tool is
exposed; the CSV tool reads only the checked-in fictional venue source.

`product/responsibility.json` holds constraint versions and human revisions.
Human text remains current across model continuation. Optimistic versions
reject stale saves. Unsubmitted browser drafts use session-scoped localStorage
and display an unsaved label, including restored drafts and server refreshes
during editing. Save/cancel returns the label to the retained human result.
A comparison is labeled current only when both child results carry the current
constraint version; steering admission alone is not labeled applied.

`inference.jsonl` records fixture acceptance identity before streaming and keeps
native replay envelopes and synthetic usage independently of session output.
Every call through the only mounted provider—including auxiliary calls—is
recorded. Actual cost is explicitly zero; this is not the owner's money ledger.
The fake connector writes unknown before dispatch; a retained unknown suppresses
repeat dispatch, even if the scripted provider asks for it again.

## Bounded decision helper

`src/decision.mjs` declares the candidate/result interfaces with JSDoc. The
comparison tool passes actual computed venue facts and original CSV row source
IDs to it, then retains its advisory result alongside the alternatives. The
scripted provider renders that decision. Mode is explicitly
`deterministic-fallback`; `jevEnabled` is false. Eligible supplied candidates
are ranked by computed cost, with source IDs and reasons. Missing evidence or
no eligible alternative produces no pick. The helper has no network dependency,
inference, authority, booking, sending or spending capability. About this preview
states that this is a connected fallback seam, **not live Jev integration**.

## Executed checks and remaining work

The focused Node tests boot real release hosts and verify:

- Controller prompt → actual CSV tool → retained result; exact replay/usage;
  cold read and follow after host restart (17 durable events in the base flow).
- Two actual child workers overlap; public user steering reaches both next
  requests. Product constraints persist before delivery and require both applied
  versions before marking the result current.
- Saved human edits, stale-write rejection, same-origin HTTP and follow snapshot.
- Persisted DSH schedule executes after restart, preserving the human edit;
  12 agent calls plus one auxiliary scripted call appear in the journal.
- An owned subprocess is killed after fake-effect dispatch and before its ack.
  Real DSH repairs `TOOL_OUTCOME_UNKNOWN`; a repeat tool request still leaves
  exactly one fake connector attempt and an unknown outcome.

The six existing focused tests and four new decision/client behavior checks
pass; no skips. The client checks execute the actual client source against a
small browser boundary fixture, covering restored/unsaved labels, save/cancel,
stale versions, page hide/show and duplicate-stream prevention. The real host
constraint test checks the retained fallback decision and CSV citations, then
changes the ceiling below both costs and verifies no pick. Changed JavaScript
syntax checks pass. The parent already reran the pinned source comparison and
original six tests successfully. No upstream/full repository suite was run.

The parent verified the running browser before these follow-up fixes: computed
$768/$712 totals, an $800→$700 constraint applied by both workers with no eligible
choice, saved Unicode edits after reload, and an unsubmitted draft restored into
the editor and retained through a real 30-second scheduled continuation. A stale
save was rejected without losing the draft; reload then save succeeded. At 390px,
document width and scroll width were both 390 and editor/buttons were usable.
The table required an internal swipe to its last column.

This follow-up fixes the misleading saved label while a draft is active and the
page-cache lifecycle gap, and adds the bounded decision helper. A small narrow
screen table-wrap adjustment is included. **Parent post-fix verification passed**:
all 10 focused tests, host restart with retained human text, honest unsaved labels
through editing/reload/cancel/save, actual back navigation, synthetic page-cache
lifecycle events preserving the draft, source-backed decision output and About
disclosure. The 390px document and table fit without horizontal overflow.
The browser's actual back navigation reloaded rather than selecting BFCache;
BFCache-hit behavior is covered by the lifecycle fixture, not claimed as a live
cache hit. Physical-phone behavior, real-provider fidelity, live Jev and useful
model judgment remain unverified.

The existing owner installation and `web/` remain untouched; the old services
stay off. Initial prompt admission and schedule-creation crashes are still not
transactional with product-state writes. Those disclosed preview gaps remain
outside this narrow follow-up. Product inference spending remains zero.
