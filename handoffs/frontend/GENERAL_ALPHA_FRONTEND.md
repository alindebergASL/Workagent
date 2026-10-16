# General alpha (#15): frontend, existing-contract items

Owner: Claude Code frontend session (`web/` only). These items answer the
findings in `handoffs/backend/GENERAL_ALPHA_FRONTEND_HANDOFF.md` that need no
new wire contract. All checks are provider-free; screenshots are from the
controlled transport on the real UI/API/PostgreSQL stack, not a model.

## Result links say what the records say now (finding 2)

A message's link is labelled from the work's current state, read from the
artifact and its proposals, not from when the message was written:

| State | Link | Beside it |
| --- | --- | --- |
| not read yet | Open document | nothing claimed |
| pending proposal, current base | Review proposed change to the document | |
| pending proposal, older base | Open document | "The proposed change is out of date…" |
| applied, still current | Open document | "This change was applied and is the current version." |
| applied, changed since | Open the applied version (`?revision=`) | "Applied, then changed since." + Open current document |
| dismissed | Open current document | "This proposed change was dismissed." |
| saved result, changed since | Open this version (`?revision=`) | "Changed since." + Open current document |

`?revision=<id>` on a work page shows an "earlier version" card above the
current editor. The card names the version and who it came from, and lists
each later version with its author. For a document, it also shows what
changed since. Authors come from the records. An applied proposal's
revision reads "Workagent's change, applied by you", and a later human save
reads "your edit". Saved history now uses the same labels and marks the
current version. Nothing is reset, and later human edits are never
attributed to the agent.

## Hand-over wording matches what happens (finding 3)

The conversation page's control, and Home's control when no context is
chosen, now read **Record a hand-over**. In both places, handing over only
saves a paused record. The panel says it stays paused and that nothing
happens until it is picked up. Its button reads **Save paused hand-over**.
"Take it from here" stays only where it starts real work: Home with context
chosen, which creates an assignment.

## Answer first, recorded status separate (finding 1)

A finished turn's trusted state (for example "Result saved — needs review",
"Requested result verified" or "Stopped at the step limit") is now one quiet
line under the answer. It appears on the conversation page and beside the
work. It comes from the service's recorded progress, never from the reply
text. The answer stays first and unchanged. The lost-answer text itself is
the backend fix. The frontend does not reconstruct prose.

## Checks (this commit)

- `pnpm check`: 183 unit tests, plus type, lint and format checks.
  - New: result-link states, version authors, the outcome line, and the
    none/passed/failed model examples.
- Production build.
- 28 DOM regressions; 9 sandbox regressions; 15 mock e2e tests.
- Real stack, controlled, no model calls:
  - flexible create/reopen across a restart, now asserting the
    earlier-version link and card for a human-edited document, and the
    applied-then-edited table proposal;
  - `verify_general_integration.py` (table and calculator journeys,
    outage, restart);
  - conversation journey (hand-over wording, steering, end).

## For Hermes

- `scripts/verify_adaptive_product.mjs` and
  `scripts/verify_general_model_journey.mjs` click links named
  "Open tool product" and "Open <kind> product". These labels now depend on
  state. A current saved result reads "Open tool". A pending proposal reads
  "Review proposed change to the tool". A result changed since reads
  "Open this version". I left those scripts alone because they are outside
  `web/`.
- Wire needs, when the contracts land:
  - a first-class answer field, separate from the validation text, so the
    shell can stop showing the disclaimer as the reply;
  - canonical Assignment lifecycle state and eligibility, to replace the
    paused-hand-over wording.

## Generated wire contract (`cb87f3f`)

Built on the published alpha contract. No backend or contract files were
changed.

- **`AlphaExecution | AdaptiveExecution`.**
  - The test fixtures are now typed to the exact runtime they model, with no
    casts.
  - `answered` is a finished reply. It gets no "verified" or "completed" line.
    "How this ran" says: "Answered directly. This is a reply, not a verified
    result or a completed task."
  - A step that used a capability names it and its version, as a read and
    not a permission.
- **`TurnState.explanation`.**
  - A direct answer (`answered`) shows `message.text` exactly, even when an
    explanation exists.
  - Otherwise, when a retained explanation exists and differs from the
    recorded message, the explanation is shown as the answer. The recorded
    message stays one click away under "The message as recorded", including
    its execution status, and is labelled as the model's retained explanation,
    not a verification.
  - Nothing is parsed or stripped from `message.text`.
  - Earlier-version links and author labels are unchanged.
- **Responsibility.**
  - When `GET …/responsibility` returns a record, the assignment page shows
    its state, current outcome, next action, wait, blocker, changed
    dependencies, check-in time and review flags.
  - While `execution_status` is `not_admitted`, the page says: "Recorded only.
    I can't work on this on my own yet, so nothing runs in the background."
  - A queued review reads "queued … it hasn't run".
  - Steering uses `POST …/responsibility/control` (pause, resume, stop and
    take back), compare-and-swap on `assignment.work_version`. Stop and take
    back need confirmation, and an unconfirmed send retries the same command.
  - The older steering on the page hides when a responsibility exists, so
    there is one set of controls.
  - No timers and no invented running state. Activation and update are runtime
    commands and are not offered as UI.

Checks on this commit:

- `pnpm check`: 190 unit tests (alpha answer/explanation/capability,
  responsibility view), plus type, lint and format checks.
- Production build.
- 28 DOM regressions; 9 sandbox regressions; 15 mock e2e tests.
- Real stack, controlled, no model calls:
  - flexible create/reopen;
  - `verify_general_integration.py`;
  - conversation journey;
  - new `responsibility-journey.mjs`: hand-over through the UI, activation
    through the generated route, then read, pause, resume and take back in the
    UI, at 1440 and 390px with no overflow, ending with
    `provider_execution_queued: false`.

Not covered by these checks: live model output. Direct-answer and
retained-explanation rendering is covered by unit tests, not a live run.

## Review corrections F1–F5 (comment 6137032304), against the published contract

Hermes provided a contract snapshot patch (SHA-256 `90b0d973…3fba45`). I
verified that the hash matches and that it applies to `55e2924`. Applying it
locally was blocked in this session because it edits Hermes-owned contract
files, so everything below compiles against the published contract at
`cb87f3f`. Items that need the new types wait for the canonical revision.

**Done:**

- **F4: absence versus errors.**
  - The responsibility read now has explicit states: loading, absent,
    ready (or stale), denied and unknown.
  - Only `unsupported_operation` counts as absence. A denied, failed or
    still-loading read never falls back to the older steering or to "I own"
    or "Waiting on" claims.
  - The panel beside the work handles a terminal authorization failure by
    replacing its opening snapshot and removing the conversation and the
    reply box. A recoverable failure keeps a labelled snapshot and holds
    sending.
- **F3: refresh.**
  - Re-reads are read-only: every 4s while open, every 15s while a
    conversation's assignment has no responsibility yet, and never once it
    is closed or denied. They stop when the route changes.
  - The read starts only after the assignment is known, which fixes a race
    that skipped the absent-state poll.
  - A visible "Check again" re-reads both the assignment and the
    responsibility. "Read at …" or a stale notice says what is shown.
- **F5: control recovery.**
  - An unconfirmed control is stored in the tab-scoped pending-command
    journal, so it survives a reload.
  - Until it is resolved, the only option is retrying that exact command;
    no other control can replace it.
  - The service's acknowledgement is kept separate from a successful
    re-read. If the re-read fails, the page shows the reply, labelled as
    "not re-read yet", and steering waits.
  - A CAS conflict is never rebased and resent. Its message says whether the
    current state was actually re-read.
- **F2 (contract-independent part):**
  - On an assignment that has a responsibility, the older ownership prose
    and steering are suppressed, and the status line points to the panel.
  - Lists and the conversation's hand-over link no longer claim "can't
    carry work forward". They say "Handed over" and "Open it to see where it
    stands".
  - Execution wording is keyed by the generated `execution_status`
    (`not_admitted`: "Not admitted to run…"), so every status the contract
    adds must be worded before it compiles.
  - Stopped and taken-back states say no one holds it any more.

**Waiting for the canonical contract:** F1 (the `system` author, runtime
origin and `responsibility_origin` on messages and turns), and F2's
queued, running, settled and blocked wording plus a link to the run.

**Checks:**

- `pnpm check`: 190 unit tests, plus type, lint and format checks.
- Production build.
- 29 DOM regressions, including the stale and revoked panel beside the
  work; 9 sandbox regressions; 15 mock e2e tests.
- Real stack, controlled, no model calls:
  - flexible create/reopen;
  - `verify_general_integration.py`;
  - conversation journey;
  - responsibility journey;
  - new `responsibility-recovery.mjs` (14 cases): confirmed absence;
    denied, unauthenticated, transport and delayed reads with no fallback;
    activation appearing on an open page; pause and resume made elsewhere
    appearing without a reload; a stale read holding steering and then
    recovering; a lost acknowledgement surviving a reload, with the retry
    sending the same `command_id`, operation and version once; a confirmed
    command with a failed re-read; CAS conflicts with a successful and a
    failed re-read, each sent once; a dismissed confirmation sending
    nothing; take-back; reads stopping when the route changes.

## F1 and F2 on the canonical contract (`hermes/general-alpha-backend-15` `11def03`)

The branch is merged into the owner branch, and no contract file was
edited.

- **F1: runtime requests.**
  - `author_kind: system` maps to a `runtime` author, and
    `responsibility_origin` is kept on messages and turns.
  - The full thread and the panel beside the work both render it as a
    "Continuation request from a hand-over", marked "Asked by Workagent …,
    not by you". It links to the hand-over and shows its wake and version
    under "Request details". It is never shown as "You".
  - Each turn is anchored to the message that started its run, human or
    system. Its queued, responding, failed, unavailable, unknown or
    cancelled state and its reason show under its own request, never under
    an unrelated human message.
  - The panel beside the work marks the latest turn as a "Hand-over
    continuation".
- **F2: execution.**
  - Every `execution_status` is worded so it claims no more than the
    record: queued is not started, running is not done, settled still
    needs review and is not accepted or the goal done, and blocked means
    some work may have happened. Adding a status is a compile error until
    it is worded.
  - A bound `run_id` links to `/conversations/{id}#run-{run}`, which
    anchors on the request that started that run.
  - A readiness review is worded separately from execution ("That isn't a
    run").

**Checks on this commit:**

- `pnpm check`: 201 unit tests (new: continuation mapping for every turn
  state, runtime rendering, execution wording), plus type, lint and format
  checks.
- Production build.
- 30 DOM regressions (new: a runtime continuation beside the work);
  9 sandbox regressions; 15 mock e2e tests.
- Real stack, controlled, no model calls, fresh database through SQL022:
  - flexible create/reopen;
  - `verify_general_integration.py`;
  - conversation journey;
  - responsibility journey;
  - `responsibility-recovery.mjs`, 16 cases. The two new ones inject
    runtime requests into real reads for all seven turn states, and all
    five execution statuses, each with its run link.

**Limits:** the runtime requests and execution statuses in those browser
cases are injected into real API responses. No actual continuation run was
admitted or executed here.

## Residual review findings R1–R3 (comment 6149849176, against `9ef4d7b`)

Narrow corrections; no new store, loop, backend or contract change.

- **R1: a stale "none here" is not absence.** If a re-read fails after
  the service said there was no responsibility, `useResponsibility` now
  reports `unknown` with the time of that last read, not `absent`. The
  older Stop/"nothing has been admitted" wording and steering stay hidden
  until a fresh read says "none" again. The notice reads: "When last read
  at …, nothing was recorded as holding this, but it can't be checked
  again right now and may have changed. Steering waits until it can be
  read." Re-reads keep going on their bounded backoff, and "Check again"
  is offered. Screenshot: `evidence/general-alpha-15/stale-absence-1280.png`.
- **R2: sending is held at admission, not just on the button.**
  `useConversationReply` takes `held` and returns `canSend`. `send()`
  refuses while held, so the button, Ctrl+Enter, Cmd+Enter and a form
  submission all behave the same. The pane beside the work holds sending
  while it can't re-read the conversation, has lost access, or the
  conversation has ended. The draft is kept. An unconfirmed send keeps its
  exact command and is replayed only after the pane reconnects.
- **R3: each request beside the work keeps its own outcome.** An
  unresolved turn (failed, unknown outcome, unavailable, stopped, no reply,
  waiting) shows under the request that started it, with "Why" and the
  service's reason where one is given. This matches the full conversation.
  A later turn no longer removes it, and it is never shown twice. A latest
  turn with no request to anchor to still shows at the end. An unresolved
  turn whose request has scrolled out of the pane gets a line linking to
  `/conversations/{id}#run-{run}`.

**RED → GREEN.** Each new regression was run against the `9ef4d7b` source
first and failed there:

- R2: one send was admitted while stale.
- R3: no failed state under the runtime request.
- R1: the real stack kept showing absence after the failed re-read.

They pass on this commit.

**Checks on this commit:**

- 201 unit tests; type, lint, format and `git diff --check`.
- Production builds (domain and mock).
- 32 mounted DOM regressions, including these new ones:
  - zero sends from Ctrl+Enter, Cmd+Enter and form submission while
    stale, then one deliberate send after reconnecting;
  - an unconfirmed send held while stale and then replayed with the same
    `command_id`;
  - failed and outcome-unknown continuations keeping their own state and
    reason after a later turn, with a link once out of view.
- 9 sandbox regressions; 15 mock e2e tests.
- Real stack, controlled, no model calls:
  - `responsibility-recovery.mjs`, now 18 cases. The new ones go from
    absent to a failed re-read and then recover to absent, and to ready
    after an activation made meanwhile;
  - responsibility journey; conversation journey;
  - `verify_general_integration.py`; flexible create/reopen; products
    journey.

**Limits:** the failed re-reads in the R1 cases are network faults injected
in the browser against a real API. The R2 and R3 cases use fixture
transport. No actual continuation run was executed here.

## Attachments in existing conversations (comment 6153671353)

Files can now go with a reply in an existing conversation, both on the full
conversation page and in the pane beside the work. Before, only the first
message from Home could carry them. This uses the **current published
contract** (`AttachmentInput`: `.csv` or `.txt`, `text/csv` or
`text/plain`, at most two files, 200000 UTF-8 bytes in total, no NUL). It
is not end-to-end complete: the code and text file types Hermes is adding
wait on the next published attachment contract, and the frontend has no
rule of its own for them.

- **One shared controller.** `useConversationReply` (`attach`) holds the
  files with the draft. They are stored per conversation in the tab and
  shared by the full thread and the pane beside the work.
  - Choosing, checking (the existing `readAttachment` and
    `attachmentsProblem`) and removing files all happen in the
    controller.
  - Files are locked while a send is in flight or unconfirmed. An
    unconfirmed send freezes its exact words, files and target, and is
    replayed exactly, including after a reload.
  - Files are cleared only when the confirmed send matches them.
- **Held means held.** The existing hold (stale, revoked, ended) and the
  keyboard checks apply to file sends too.
- **Target and files together.** Beside the work, the files go with the
  exact saved target; that send used to hard-code `attachments: []`. The
  full conversation page sends them with `target: null`.
- **What was sent.** A person's message in the thread and in the pane lists
  the files the service recorded, by name and size, with the SHA-256 on
  hover. The content is never shown or interpreted.
- **Readable names.** Long names keep their extension, here and in the Home
  composer, so `….csv` and `….txt` stay distinguishable.
- **Byte order mark:** superseded below. The published contract keeps the
  BOM.

**Checks on this commit:**

- 201 unit tests (BOM cases added); type, lint, format and
  `git diff --check`.
- Domain and mock production builds.
- 35 mounted DOM regressions. The new ones are below. They fail on
  `c34920c`, where the pane has no file picker.
  - The pane beside the work, covering: refusing a bad name; adding and
    removing files; the two-file limit; keeping files with the draft when
    the pane is reopened; holding a stale send by Ctrl+Enter and
    Cmd+Enter; the exact attachments and target in the payload; files
    frozen while a send is unconfirmed, then replayed with an identical
    payload after the saved version moves on; clearing on confirmation
    with no stored files left; and a sent message listing names and
    sizes, never content.
  - The conversation's own reply sends files with `target: null` and
    clears them on confirmation.
  - At 390px with the app's stylesheets, two long names fit with no
    sideways scroll. Screenshot:
    `evidence/general-alpha-15/reply-files-390.png`.
- An existing stale-send test was racing React's re-render; it now waits
  for the stale notice before submitting.
- 9 sandbox regressions; 15 mock e2e tests.
- Real stack, controlled, no model calls:
  - conversation journey and products journey;
  - `responsibility-recovery.mjs` (18 cases);
  - flexible create/reopen.

**Limits:**

- The real backend refuses attachments on a conversation without a scoped
  model grant (`unsupported_operation`), so no real-stack send with files
  was made here. The file cases use fixture transport.
- Responsibility creation (`record_responsibility`) is a backend gap, as
  Hermes noted. Nothing in the frontend infers or activates a
  responsibility.

## Published attachment contract integrated (`f0a0dd8`, comment 6153938304)

Merged `hermes/alpha-text-attachments` (`f0a0dd8`). The frontend now reads
`contracts/message-attachments.json` for every attachment check, with no
separate frontend rule.

- **Shared reader.** `readAttachment`, `filenameProblem`, `attachmentMime`
  and `attachmentsProblem` (in `lib/contract/natural.ts`) take everything
  from the descriptor: the pattern and 85-character limit, the extensions,
  the per-file and total bytes, the count, the CSV versus other MIME
  types, and the forbidden characters.
  - The file picker's `ATTACH_ACCEPT` is built from the extensions. It is a
    hint only; the service checks every file again.
  - The same reader is used by the Home composer, the conversation's reply
    and the pane beside the work.
- **Exact bytes.** Files are decoded with `fatal: true, ignoreBOM: true`
  (`preserve_bom`). A BOM, CRLF line endings and every other byte are kept,
  so the hash and byte length the service records describe the file's own
  bytes. This reverses the BOM-dropping behaviour of `44c86a0`. A file
  that is only a BOM is now admitted, matching the backend.
- **Shared vectors.** `web/test/fixtures/attachment-vectors.json` holds 23
  generic synthetic cases: dotted basenames, paths, a leading dot, an empty
  dot segment, spaces, tab, upper-case extensions, unsupported types, 85
  and 86 characters, empty, NUL, invalid UTF-8, other control bytes,
  BOM+CRLF and inert HTML/script content. The same file is checked in
  three places, which agree on every verdict, MIME type and exact byte:
  - Node: `test/attachment-vectors.test.ts`;
  - Chromium: the DOM regressions;
  - the backend's own `AttachmentInput`: `web/scripts/attachment-parity.py`.

**Checks on this commit:**

- 224 unit tests (23 new vector cases); type, lint, format and
  `git diff --check`.
- Domain and mock production builds.
- 36 DOM regressions, including the vectors in Chromium.
- Backend parity script: 23 of 23 agree.
- 9 sandbox regressions; 15 mock e2e tests.
- Real stack on the merged tree, controlled, no model calls:
  - conversation, products, flexible create/reopen;
  - `verify_general_integration.py`;
  - 18 recovery cases.
- Hermes's `test_text_attachments.py`: 38 of 38 pass.

**Intermittent backend test (reported to Hermes, not changed here):**
`test_text_attachment_journey.py` sometimes gets a 422
`unsupported_operation` on the targeted reply. Hermes's exact `f0a0dd8`
tree does the same; the backend files are byte-identical. It failed about
1 in 6 repeated runs on one fresh database, and it also passed on both
trees.

## Two decisions from Andrew: unlinked pane replies and full-conversation holds

**1. Replies beside the work that can't name their saved version.** When
the build doesn't offer exact targets (natural admission off: the
controlled setup and the older released backend), the pane no longer sends
such a reply silently.

- A plain notice explains what isn't available: the reply can't be linked
  to this saved version, and files can't be attached here. It says the
  draft is kept, and points to sending it as a general message or
  continuing in the full conversation. No flag name is shown.
- Enter, Ctrl/Cmd+Enter and form submission send nothing. Only the
  explicit "Send without linking this version" button sends, as a general
  message. Andrew chose this over holding replies completely, so pane
  replies still work in those setups by deliberate choice.
- An unconfirmed send replays exactly through "Retry the same message".
- The capability gate itself is unchanged.

**2. The full conversation holds sending while it can't confirm its current
state** (reconnecting, no confirmed read yet, or ended), matching the pane.

- The reply's admission check (`held`) covers the button, Ctrl+Enter,
  Cmd+Enter and form submission. The local-operation composer's Run
  button is held too.
- Drafting and attaching continue, and the notice says the draft (and
  files, where offered) are kept.
- Reconnecting sends nothing by itself.
- An unconfirmed send keeps its exact command for a deliberate replay.
- Recording a hand-over is a separate write and is not held by this
  change.

**RED → GREEN.**

- `web/scripts/conversation-hold.mjs` (real stack, injected read failures
  and a lost acknowledgement) failed on `0db61e7`: Send stayed enabled
  while disconnected.
- The pane DOM regression failed on `0db61e7`: there was no unlinked
  notice.

Both pass now. Screenshots:
`evidence/general-alpha-15/conversation-hold-stale.png` and
`pane-unlinked-reply.png`.

**Checks on this commit:**

- 224 unit tests; type, lint, format and `git diff --check`.
- Domain and mock production builds.
- 36 DOM regressions. They now include the unlinked pane reply, and
  attaching while held followed by one release send.
- 9 sandbox regressions; 15 mock e2e tests.
- Real stack, controlled, no model calls:
  - `conversation-hold.mjs` (3 cases): no send by any path while stale,
    with drafting continuing; nothing sent on reconnect, then one
    deliberate send; an unconfirmed send held while stale and replayed
    with the same `command_id` and version.
  - conversation journey; products journey, which now uses the explicit
    unlinked send;
  - 18 recovery cases; flexible create/reopen;
    `verify_general_integration.py`.

**For Hermes:** `scripts/verify_product_companion.mjs` clicks "Send" in the
pane on a build without exact targets. That send now needs the explicit
"Send without linking this version" button. The script is Hermes-owned, so
I haven't changed it.

## Responsibility recording integrated (comment 6158398270)

Merged `hermes/responsibility-recording-checkpoint` (`9a0c0d1`, merge
`28fb06a`). Two Hermes-owned conflicts (`backend/export_contracts.py` and
`backend/tests/test_text_attachment_journey.py`) were resolved to Hermes's
side. Everything outside `web/` and `handoffs/frontend/` is byte-identical
to `9a0c0d1`, and `web/` started from `90ba73b`. The five seam findings:

1. **Receipt kept and shown.** `turnProgress` keeps
   `TurnState.responsibility_recording`. `recordedResponsibilities()` reads
   it together with each step's `mutation_result`, giving one entry per
   assignment, never anything read from reply text.
   `RecordingReceipts` (in `TurnProgress.tsx`) shows each one as a link
   named by the work's current goal. The full thread and the pane beside
   the work share it. It appears under the reply, or under the request
   when no reply or explanation arrived. The receipt is historical: it
   says what the work was recorded as and points to the work for where it
   stands now.
2. **A recording is not a calculation.** `hasProductOutput()` tells actual
   product output (output or body) apart from a recording-only step.
   - A recording-only turn reads "Responsibility recorded", saying the
     outcome isn't verified and nothing runs for it.
   - It is never "calculated" or "not saved as work". "How this ran" lists
     the recording and its version.
   - Mixed turns keep the product result's own presentation, and the
     receipt still says the outcome isn't verified.
3. **Home and Spaces follow the canonical lifecycle.**
   - `useHolds()` (in `lib/client/responsibility.ts`) does one bounded
     read (at most 20 items), read-only, scoped to the workspace and
     aborted on change. It reads conversation-backed rows: their
     responsibility, or their assignment when the service reports none.
   - A failed re-read keeps a stale responsibility (labelled as such), or
     reports an earlier "none" as unknown; it never becomes current
     absence.
   - `holdStatus()` and `holdGroup()` (in `lib/hold-view.ts`) give the same
     words and groups everywhere.
   - On Home, a needs-the-person state (waiting for a person, blocked,
     review, or a settled run) goes to Ready for you. Active or paused goes
     to a new "Responsibilities I'm holding" group, below Ready for you;
     held is not running. Taken back or stopped goes to Stopped.
   - Denied reads show "Not available"; unreadable ones show "Couldn't
     check". The coarse assignment `paused` no longer decides any of this.
4. **The work page reads the current record.** The title, request,
   criteria and Ownership "Done when" come from
   `ResponsibilityDetail.assignment` when it could be read.
   - The empty state says "No documents or files are attached to it yet.
     The responsibility itself is saved".
   - With no run, it says "No run is recorded for it." instead of guessing
     where the work came from.
   - Controls stay on the panel's current read, compare-and-swap version
     and confirmation.
5. **Meaningful links.** The conversation's Handed over rows are named by
   their current goal and carry the shared status. Recorded ones also link
   to the turn that recorded them (`#run-{run}`). No artifact is invented.

**Tests (deterministic):**

- 234 unit tests. The 10 new ones run on a real recording-only `TurnState`
  dumped from the backend (`test/fixtures/recording-turn.json`). They
  cover:
  - receipt and step preservation, a missing receipt, and two
    obligations;
  - recording-only, failed or never-arrived explanation, and mixed
    output;
  - every `holdStatus` and `holdGroup` state, including stale, denied,
    unknown and absent.
- 37 DOM regressions; the new one covers receipts beside the work under
  the reply and under the request.
- The harness mock gained `rawAssignment` and `API_MODE`. The shared reader
  gets the fixture transport through its relative imports.

**Real UI, API and PostgreSQL** (`web/scripts/responsibility-recording-journey.mjs`,
9 cases):

- **Fixture.** `web/scripts/rr_fixture.py` records responsibilities
  beforehand through the real Service, PostgreSQL and `GeneralWorker`,
  using the backend tests' synthetic provider transport. No live model is
  called, so this proves mechanics and presentation, not agency. It
  records:
  - two obligations: one waiting for a person, one active;
  - one whose final explanation count fails;
  - one in another person's workspace.
- **Cases covered:**
  - Home grouping and wording, with no other-workspace leak;
  - the conversation receipt link, turn wording and recorded-in link,
    plus keyboard focus and Enter;
  - the work page reading the current record;
  - take-back through the existing control: the current record changes
    everywhere, while the API and UI receipt stay `waiting_person` at the
    original work version;
  - a pause made elsewhere showing on Home;
  - the receipt under the request when no explanation arrived;
  - unknown and denied reads;
  - the other workspace's work returning 404 and never being shown.
- No horizontal scroll at 390 and 320px, and no duplicate element IDs.
  Screenshots are in `evidence/responsibility-recording/`.

**Other checks on this commit:**

- Type, lint, format and `git diff --check`; domain and mock production
  builds; 9 sandbox regressions; 15 mock e2e tests.
- Real stack:
  - `conversation-hold.mjs` (3 cases); conversation journey (now expects
    goal-named hand-over rows); products journey; responsibility journey;
  - 18 recovery cases (its route-change check now leaves to the
    conversations list, because Home has its own bounded read);
  - flexible create/reopen; `verify_general_integration.py`.
- Backend on the merged tree (fresh PostgreSQL through SQL024): 107
  responsibility-action, authority, review-regression and attachment
  tests pass, and `test_text_attachment_journey.py` passed 6 of 6
  repeats.

**Limits:**

- No live model decisions. The recordings come from scripted synthetic
  decisions, so usefulness and agency are NOT TESTED here.
- No screen-reader pass beyond role, name and keyboard checks.
- The multi-model and multi-persona QA gate is Hermes's next step.

## A coherent project Space (comment 6181993717, `SPACE-DELIVERY.md`)

Integrated `hermes/spaces-continuity-checkpoint` by fast-forward to `9675daf`
and acknowledged it in #9 (comment 6182032666). Everything outside `web/` and
`handoffs/frontend/` is byte-identical to `9675daf`.

**What a person sees on `/spaces/{workspace}/work/{conversation}`**
(`web/src/components/SpaceView.tsx`, logic in `web/src/lib/space-view.ts`):

- **What it's for.** Kind ("Project" / "Ongoing workflow"), name and purpose,
  editable by the person ("Edit name and purpose"). The save is a
  compare-and-swap on the version where editing began. A refused save keeps the
  typed text, re-reads the project and says so. A save whose outcome is unknown is
  only replayed exactly. The draft survives reloads. When Workagent named the
  project, one quiet line says so ("Change it if it isn't right"); no "Agent
  identified" or "Human saved" chips.
- **Next.** One next step, then anything else that needs the person, all from
  saved records:
  - proposals waiting for review, from the proposal records;
  - responsibilities by their current lifecycle via `useHolds`, never the
    recording receipt. Active is "held, nothing runs"; a responsibility marked
    for review says "Needs your review before it continues";
  - the latest request's turn: waiting, replying, not picked up, outcome unknown.
    A failed turn is "didn't complete" only when it kept no result.

  While work is still being read it says "Checking…", never "get started".
  Unreadable work is said plainly. No invented progress or promise.
- **Work in this project.** Each piece by its own title and kind, when it last
  changed and by whom, and whether a change waits for review. Selecting one
  (button, `aria-pressed`, keyboard; never pre-selected) shows its saved version read-only through
  `ProductView` / `ReadOnly`, with its real controls a step away ("Open to edit",
  "Review and edit"). A waiting change is summarised from the two saved bodies
  ("It adds a row: Catering."), never from the proposal's model or system reason
  text. A proposal made for an earlier version is called outdated, never
  offered to apply. The selection is in the URL (`?work=`), so reload and Back
  keep it.
- **One conversation beside it.** `WorkSurface` and `ConversationPeek` in a new
  compact mode: fewer messages, each reply's recorded outcome folded under
  "Details", reply box kept in view.
  - The reply is about the work the person selected, at its exact saved
    version (`artifact_id`, `revision_id`, `body_hash`), shown as
    "About: Budget". With nothing selected it is "About: the whole project".
  - "Ask about the whole project instead" clears it, and the reply then carries
    `target: null`.
  - The person never chooses between "general chat" and "exact refinement".
  - An unconfirmed send shows, and replays, exactly what it was about even if
    the selection has since moved (`pendingTarget` from the reply controller).
  - Builds without exact targets keep the explicit "Send without linking this
    version" protection.
  - While the project itself can't be re-read, sending is held by button, keys
    and submit (`held` from the page), drafting continues, and reconnecting
    sends nothing.
- **Phone.** Work first; Work/Conversation switch keeps drafts. "Ask about
  this" opens the reply box about that work and focuses it.
- **Elsewhere.**
  - Spaces lists "Projects and workflows", then "Workspaces".
  - A project's conversation shows "Part of <name> · Open the project".
  - An ordinary conversation offers "Keep as a project".
  - A work page in a project goes back to the project.
  - Home's lede no longer says "Check each current record before continuing".
- **Demonstration label.** `NEXT_PUBLIC_WORKAGENT_DEMO_MODE=1` shows, on every page,
  "Demonstration. The projects and work shown here are made-up examples…". It
  is off by default and never inferred from content.

**Following Hermes's notes (comments 6182056809 and 6182165171):**

- The flag is `NEXT_PUBLIC_WORKAGENT_DEMO_MODE=1`; the earlier name
  `NEXT_PUBLIC_WORKAGENT_DEMO=1` also works. It labels example input data,
  not whether a model was live; per-turn provenance tags are unchanged.
- **Nothing is chosen for the person.** The work a reply is about is only ever
  the work they picked (`?work=`). With nothing picked, the page says "Choose
  one to read it here and to ask about it", and a reply is about the whole
  project (`target: null`). No first-returned or most-recent default.
- **Outdated proposals are not offered as changes to apply.** A pending
  proposal whose base isn't the current saved version reads "made for an
  earlier version, so it can't be applied as is", with an "Outdated proposal"
  badge. This is the same rule as the work page's own `outdated`.
- **Work is re-read from its own records every 20 s while the page is open.** A
  save or acceptance elsewhere can move it on without changing the
  conversation. It is also re-read after a send, on a settled turn and on
  "Refresh".
- **Every button and button-styled link on the page measures at least 24 px**,
  checked in layout. No accessible names were changed for their own sake;
  names, focus and keyboard are exercised in the journey.

**Bugs found and fixed while verifying on the real service:**

1. The Space's status went stale after a send. Only the pane re-read; it now
   refreshes the page too.
2. Send stayed enabled in the pane while the project couldn't be re-read. The
   pane reads a different endpoint; the page's read state now holds it.
3. After a refused name/purpose save, the next deliberate save was refused
   again. The form now follows the re-read version.
4. "Next" said "get started" while work was still loading.
5. A responsibility marked for review read "carry forward".
6. A proposal's system reason ("Model-selected local result…") was shown as if
   it described the change.
7. Phone focus for "Ask about this" was lost on the pane switch.
8. The 320px "Next" button didn't wrap.
9. A textarea nested in its label had an accessible name that included its
   value.
10. A save made before the post-refusal re-read landed was refused again
    (found by Hermes; see above).

**Found by Hermes on integrated `70b4d8c` (comment 6182492982), fixed:**

- **The bug.** After a refused name/purpose save, the form re-read the project
  in the background. If the person cancelled, reopened and saved before that
  read landed, the save went out against the version already refused, and was
  refused again (409 → 409).
- **The fix.** Saving is now held ("Checking what changed before you can save
  again…") until the project has been re-read, across cancel and reopen. The
  next save is then checked against the version re-read. Typed text is kept.
  An unknown outcome is still only replayed exactly. Nothing is resent and
  versions are never ignored.
- **The regression** (case 9) holds the re-read open, then cancels, reopens and
  tries to save early. Without the fix it fails on the second 409; with it,
  saves are `[409, 200]`.

**From Hermes's integrated review (`docs/SPACE_INTEGRATION_REVIEW.md`), fixed:**

- **P1, a restored draft lost its starting version.**
  - The bug: the name/purpose draft kept only its values, so a draft started
    at v1, reloaded after a change made elsewhere (v2), saved against v2 and
    overwrote that change unseen.
  - The fix: the draft now persists the version it started from, and a save
    is checked against that, even after a reload. The base moves only once a
    refused save has been re-read (a `rebase` the form accepts only if issued
    after it opened). Exact replay of an unknown save is unchanged.
  - The regression: case 9 now makes the change elsewhere *before* the
    reload. Without the fix no conflict appears (the change is overwritten);
    with it, 409 → hold → re-read → one deliberate save.
- **P2, preview silently became the reply target.** Fixed in `30f53d6`:
  nothing is pre-selected.
- **P2, a file became an invalid exact target.**
  - The service's `exact_target` accepts tables, tools and self-describing
    work, not `FileBody`; `canAskAbout()` mirrors that.
  - A selected file is still shown and opens normally. There is no
    "Ask about this" for it, and a reply stays about the project, with
    "A reply can't point at a saved file like “…”, so it goes to the project;
    name the file in your message."
  - The regression is a real-React boundary case (the file has no target; a
    table targets its exact version and hash), which fails on the previous
    code. Plus a unit test. The worker can't publish files, so there is no
    real-service file case.

**From Hermes's focused re-review of `48272f3` (comment 6182957865), fixed:**

- **The bug.** When a background refresh changed the project's list of work
  (a different list re-reads all work from scratch) while that re-read was
  slow, a person's chosen work briefly resolved to nothing. The reply box
  then said "the whole project", and Ctrl+Enter sent `target: null`.
- **The fix.** A choice (`?work=`) stays the person's while its work is
  re-read. It is shown as last read, and sending is paused by button, keys
  and submit: "Checking the work you chose before sending. Your draft is
  kept." (`ConversationPeek` `paused`). If the chosen work is really gone,
  the box says so, and the person chooses again or picks the whole project.
  Missing or reloading data never reads as the whole project.
- **The regression** (new case 5). A refresh returns the same work in a new
  order while work reads are held; Ctrl+Enter is pressed. It fails on the
  previous code (a send went out); it passes now (nothing sent, still about
  the chosen work, which is then sent with its exact version in the next
  case).

**Hermes-owned scripts I changed because they test this UI** (selectors
only; their checks keep the same intent):

- `web/scripts/space-journey.mjs`, run by `backend/space_fixture.py launch`.
  It passed end to end on a fresh database (real HTTP command replay, browser,
  terminal client and PTY), plus an optional `PLAYWRIGHT_CHROMIUM_PATH`.
- `web/scripts/review-boundary.mjs`. The `SpaceWork` case is now a `SpaceView`
  case: an idle project doesn't reread, and a refresh or new scope rereads,
  bounded. 12/12 pass.

**Evidence (real UI, API and PostgreSQL)** — `web/scripts/space-experience.mjs`,
13 cases, on example projects written beforehand by the real worker with the
synthetic provider transport (`web/scripts/space_demo_fixture.py`):

- a two-day workshop with a plan, a budget, a proposed catering change, a
  remote-seat proposal outdated by the person's own edit, and a venue
  follow-up waiting on a person;
- a monthly newsletter workflow;
- a plain question answered without a project.

No live model was called. Screenshots are in `evidence/spaces/`. The cases:

1. Spaces lists both projects by purpose and kind; the plain chat isn't listed;
   the demonstration label shows.
2. The Space opens on its purpose and "A change to “Budget” is waiting for your
   review", with the venue follow-up waiting for a person. No internal wording
   (checked against a list including grant, schema, fixture, Model-selected,
   "general Space chat"). Nothing is pre-selected and a reply is about the
   whole project. The plan's outdated proposal is labelled, not offered to
   apply. No control is smaller than 24 px.
3. Keyboard selects work, focus lands on its heading, and the reply is about it.
4. A typed reply and the selection survive a reload.
5. A send carries the exact saved version, and the waiting turn shows as
   underway.
6. "Whole project": Ctrl+Enter sends with `target: null`.
7. A lost acknowledgement replays the same `command_id` and target after the
   selection moved.
8. A dropped read holds sending by button and keys; reconnecting sends nothing.
9. Name and purpose: the draft survives a reload, a stale save is refused with
   the text kept, then the save reads back with origin `human`.
10. Applying the proposal through the work page's own control updates the
    Space: the review is gone and the next step moves on to the outdated
    proposal.
11. Phone 390 and 320 have no horizontal scroll; switching panes keeps the
    draft; "Ask about this" focuses the reply about that work.
12. A plain question shows its answer and "Keep as a project"; an ordinary chat
    or unknown id at a project URL says "This project isn't available to you";
    a project's chat links back to it.

**Other checks on this commit:**

- 256 unit tests; type, lint, format and `git diff --check`.
- Production builds: natural-admission demo, default domain and mock.
- 37 DOM regressions, 12 boundary regressions, 9 sandbox regressions and 15
  mock e2e tests.
- Real stack:
  - `backend/space_fixture.py launch`, with the API, browser, terminal client
    and PTY on a fresh database;
  - `conversation-hold.mjs` (3 cases);
  - the conversation journey, whose Home intro check now expects
    "Here’s where your work stands." (from Hermes's change);
  - the products, responsibility and responsibility-recording (9) journeys;
  - the 18 recovery cases;
  - flexible create/reopen;
  - `verify_general_integration.py`.

**Observed backend behaviour, for Hermes.** Any new message in a project's
conversation moves its responsibilities to `active` with
`review_required: true` ("Review changed saved context…"). That includes a
responsibility waiting on an outside person, for a message unrelated to it. The
UI now says it needs review, but the lifecycle change looks broader than
intended. Your call.

**Limits:**

- Mechanics and presentation only. With scripted decisions, agency,
  usefulness and the probes' "useful work" are NOT TESTED.
- No screen-reader pass beyond role, name, focus and keyboard checks.
- A Space doesn't poll while idle. Changes made in another tab show on
  "Refresh", reload or any turn activity.
- Multi-model and persona QA and live evaluation remain Hermes's.

## Work opens in its own workspace (comment 6183261490)

**Defect.** Conversation, work and hand-over pages read the first personal
workspace the server listed, whatever workspace they were reached from. When a
person has more than one personal workspace (the retained database has older
ones plus the new "Personal work"), authorized work in the later one showed as
"isn’t available". Fixtures with a single workspace hid this.

**Fix (frontend only; no new provider authority, data store or scope):**

- A record page's address names its workspace: `?workspace=<id>` on
  `/conversations/…` and `/assignments/…` (`web/src/lib/scope.ts`). Every link
  and navigation into one carries it. That includes:
  - rows on Home, Spaces and Activity;
  - project pages, the side pane and result links;
  - hand-over receipts and back links;
  - the editors' earlier-version links;
  - the composer's navigation after a send.

  Each link uses the record's own `workspace_id` where the record has one;
  otherwise it uses the workspace of the page it's on.
- A record page resolves the named workspace against the list this person can
  open (`ScopedRecord`, `useScopedWorkspace`). It never falls back to another
  workspace:
  - a workspace not on that list is not available, and nothing is read from it;
  - an unreadable list is shown as unreadable;
  - an address that names no workspace keeps its earlier meaning, the default.
- Drawers, time zones and back links follow the page's workspace. "Back" leads
  to the agent home for the default workspace and to its own Space otherwise.
- Unconfirmed commands were already keyed by workspace and conversation. A lost
  acknowledgement in the second workspace now replays the same `command_id`
  there after a reload.
- Old memberships and authorization are unchanged and nothing is hidden. No
  fixture ID or list order is relied on.

**Regression.** `space_demo_fixture.py` now also writes a second personal
workspace, `personal-work` ("Personal work"). The same person owns it and it is
listed after `local-workspace`. It holds a project with saved work, a hand-over
and a plain chat. `web/scripts/workspace-routing.mjs` covers 6 cases on the
real UI, API and PostgreSQL. It records the workspace of every record request:

1. the rail leads to "Personal work"; its work opens there and stays there on
   reload;
2. the hand-over opens there, and back leads to it;
3. the chat opens there, and a lost send replays its exact command there after
   a reload;
4. from the project page, its work, full conversation and hand-over all open
   there;
5. an unopenable or unknown workspace is not available and reads nothing, and
   unscoped addresses still mean the default;
6. a shared link opens at 390px.

RED on `b41973e`: links carry no workspace. Following them reads
`local-workspace`, gets 404 and shows "This item isn’t available to you". GREEN
with this change.

## Review fixes on the Space selection (comment 6184537730)

1. **Chosen work that becomes unavailable.** When re-reading the project's work
   is refused (`not_found_or_not_authorized` or `unauthenticated`), the view no
   longer shows the last-read body, "Open to edit" or "Ask about this", and no
   longer says "Checking…" indefinitely.
   - It now says the chosen work isn't available to you.
   - The reply is paused and says the same.
   - The choice (`?work=`) and the draft are kept.
   - A temporary read failure still shows the work as last read.
2. **Scope wording follows the selection.** While a chosen work is being checked,
   is missing or is unavailable, neither the work list, the reply hint nor "About"
   says the message is about the whole project. That wording appears only when
   nothing is chosen, or after "Ask about the whole project instead".

Regressions (real React in Chromium, `review-boundary.mjs`, 2 new cases):
- RED on `5685b10`: the last-read work stays on screen after the refusal, and
  the hint says "about the project as a whole" during a pending choice.
- GREEN: 15/15.

### Links name their workspace before the list loads (comment 6184636381, P2 3)

`useScopedHref` resolved the page's workspace through the loaded list of
workspaces, so until that list arrived, "Open to edit" on a project page pointed
to an address with no workspace. A workspace the route already names
(`InWorkspace`, and a record page's `?workspace=` while it is being checked) now
scopes links at once. Reads still wait for the workspace to be confirmed.

Regression: `workspace-routing.mjs` case 5 holds the real `/v1/workspaces`
response and checks the project page's links while it is held.
- RED on `e39d0d7`: `/conversations/<c>/artifacts/<a>` with no workspace.
- GREEN: `?workspace=personal-work`.
- `workspace-routing` 7/7 and `space-experience` 13/13 on fresh real-stack
  fixtures; review-boundary 15/15; 37 DOM regressions; 265 unit tests.

## Work-first answers (first slice of coherent work-first interaction)

Asked in 6184636381: let the machinery recede while permission, uncertainty,
the next useful action and outcomes stay truthful. No contract change.

- **Answers show what they made.** Each result in the full conversation is a
  card with:
  - the work's title and kind;
  - a few lines of the work itself (document parts, the first table rows, a
    file's opening lines);
  - what is waiting ("Proposed: it adds a row: Catering");
  - one next step, which keeps the existing link labels ("Review proposed
    change to the table", "Open this version").

  The preview comes from the artifact the page already reads for result
  state, so there are no extra requests.
- **Earlier mentions are one line.** Only the latest answer that shows a piece
  of work previews it. Older ones say "Changed since" with links to that version
  and to the current one: a preview there would show today's version, not
  theirs.
- **Routine status is short.** "Result saved — needs review" becomes "Not
  checked yet: look it over before relying on it" on the card, and verified
  results say what was checked. The responsibility receipt line replaces
  "Responsibility recorded. At recording…". Stopped, blocked, needs-input and
  unconfirmed outcomes still show in full.
- **One Details per answer.** "The message as recorded", the routine outcome
  and how the turn ran are now under a single "Details". The side pane does
  the same. Test and synthetic tags stay visible.

Regression: `space-experience.mjs` case 13, desktop and 390 px. It checks:
- the latest card previews the work;
- earlier ones are brief;
- the status line appears only on the latest card;
- the routine notices are folded away;
- each answer has exactly one Details;
- nothing overflows at 390 px.

RED on `9c6cf08` (no cards). GREEN 14/14, routing 7/7.

## Documents read as documents; a person can add their own note

Hermes reported that a human safety note was never saved because the ordinary
editor path was inaccessible. In the frontend that was literal: the document
editor could only change text that already existed. There was no way to add a
paragraph, a checklist item or a note, or to remove one. The contract's
`protected_note` block kind was never offered.

- **Add and remove parts.** At the foot of an agent-made document, "Add"
  offers Paragraph, Checklist item and **Your note** (`protected_note`). A new
  part takes the cursor. Each part has a remove button: visible on hover or
  focus, always on touch screens, and labelled with its text. An empty part
  blocks saving with "Write something in each part, or remove the empty one,
  before saving."
- **Notes are visibly the person's own** in both reading and editing: a
  "Your note" label and a marked edge. The backend treats `protected_note` as a
  block kind only, so the UI makes no protection claim beyond the existing one:
  agent changes arrive as proposals the person applies.
- **Documents read like documents.** Parts are edited in place. An edit box
  shows its border only on hover and focus, and focus keeps the visible
  outline. The verification card for documents is a single line. "Discard my
  changes" appears only when there is something to discard.
- Drafts, exact replay, proposals and the saved-version check are unchanged.

Regression: `space-experience.mjs` case 13. On the agent's Workshop plan, it
adds a paragraph and removes it, adds "Your note", types, saves, reads back
through the API (exactly one `protected_note` with the text, no temporary
part, `author_kind: human`), reloads and finds the note labelled. RED on
`0471c53` (no way to add). GREEN 15/15; DOM regressions 37/37.

## The chosen work opens once, in place

The project page showed the chosen work twice: as its list entry, then again as
a separate panel below the list with the same title. It now opens under its own
entry, as one card.
- The entry (`aria-pressed`, `aria-controls="space-selected"`) is the
  heading, and the opened content is labelled by it.
- Focus stays on the entry the person chose, as in an expanding list. Before,
  it jumped to a second heading further down.
- While the work list is being re-read and the choice is shown as last read,
  that content still stands on its own, as before.
- The selection, the draft, the exact target and pausing while a choice is
  checked are unchanged.

Regression: `space-experience.mjs` case 3 checks:
- the entry stays focused and controls the opened content;
- that content sits inside the entry's own list item;
- there is no separate panel and no second "Workshop plan" heading.

RED on `bb82644`: focus moved to the separate panel's heading. GREEN 15/15,
routing 7/7, review-boundary 15/15.

### Card freshness on refresh (comment 6185232681)

"Refresh conversation" re-read only the conversation. The cards' work reads
are keyed by the message count, so an artifact that changed or became
unreadable without a new message kept its old preview. The button now re-reads
both. Each card also says how its last re-read went:
- **unavailable** (a terminal refusal): nothing of the work is shown, and the
  card says it isn't available to you now;
- **unconfirmed** (the re-read failed): the card says it couldn't re-check and
  shows the work as last read.

Regression: `space-experience.mjs` case 14, on the real service with the
budget's artifact read intercepted and no new message. It checks, in turn:
1. a changed title shows after Refresh;
2. a 404 removes the preview and says unavailable;
3. a read that recovers shows the work again;
4. a failed read says couldn't re-check and keeps the last read;
5. the draft is kept throughout.

RED on `3b38d55` (old preview kept). GREEN 16/16, routing 7/7.

### Per-work read outcomes on refresh (comment 6185505696)

A refusal for one card's work and a failed read for a sibling's (work or
proposals) rejected the whole read, so the old map stayed: both cards said
"unconfirmed" and the refused work stayed visible. `useResultStates` now
returns each work's own outcome:
- `current`, with the fresh read;
- `unavailable`, on a terminal refusal: nothing of it is kept, not even the
  previous read;
- `unconfirmed`, on any other failure: the previous read, said so.

One work's failure never decides another's.

Regression: `space-experience.mjs` case 14. A 404 for the budget is paired
first with a failed plan read, then with a failed plan proposals read. Each
time the budget shows nothing of itself and says unavailable, the plan stays
as last read and says so, and both recover on the next refresh. RED on
`fa54552`. GREEN 16/16, routing 7/7.

## A project's work, together: views run in place (comment 6185672218)

This is the first bounded increment toward a context-sensitive working surface
across materially different tasks. It is composed only from what the agent
already chooses (documents, tables, interactive views) and the existing
canonical bindings and trusted Ask/Review/Edit paths. No schema change.

- **An interactive view runs on the project page.** It uses the same sandbox
  and broker as on its own page and reads only its exact bindings. Its local
  interactions are the person's own and save nothing. Pointing it at newer
  versions saves, so that, its readable version and its source stay on its
  own page; on the project page it says "Open the view to point it at the
  latest saved versions".
- **Related work is one click away, in place.** A view says what it reads; a
  table or document says which views read it. Each is a button that selects
  that work on the same page.
- **A second, materially different demo project.** "Supplier choice", an
  investigation in "Personal work", is made by the real worker (synthetic
  transport) and holds:
  - an evidence table of three quotes;
  - a comparison view bound to it, with a weighting slider (price against
    speed) that re-ranks locally;
  - a findings document with an open checklist item.

  It sits beside the event-plan project ("Autumn workshop").

Regression: `space-experience.mjs` case 16, on the real service. It checks:
- the view in place reads the saved quotes (a revision shown inside the frame)
  and re-ranks for both weightings with no POST;
- "Reads" selects the evidence table in place, which says it's used by the
  comparison;
- after a human save of a quote through the API and a Refresh, the view says
  it is behind and where to update it, with no update button here;
- the page fits 390 px.

RED on `a5a87c8` (the view showed as text only). GREEN 17/17, routing 7/7,
37 DOM regressions, review-boundary 15/15.

## Interactive view at 320px after a resize (batch 2 limitation, comment 6186378720)

Batch 2 captured an empty supplier view at 320px straight after a resize. Re-run
on the real stack: no product defect. The frame keeps its document and data through
the resize: same element, no reload, content present. It is painted as soon as it is
on screen, whether opened fresh at 320 or resized there.

The empty box came from the capture. Chromium does not paint a cross-origin
(opaque-origin `srcdoc`) frame that is below the fold, and a full-page screenshot
does not scroll to it.
- Negative control, 320×700 after a resize: the frame's top was at 953 px. A
  full-page capture clipped to the frame was 0.0% dark pixels.
- After scrolling it into view, an element capture was 6.0%.

`space-experience.mjs` (the investigation case) now covers this at 390 and 320 after
a resize from desktop. In each, it:
- scrolls the view into view;
- requires it to be at least 90% in the viewport, with its content;
- weighs the comparison by keyboard (End → Quayside Press, Home → Lark & Co);
- requires painted pixels in the frame's own capture (more than 1% dark);
- requires no page overflow;
- saves a viewport screenshot (`09-investigation-view-{390,320}.png`).

Adjusting the view still sends nothing. Captures of interactive views should scroll
the frame into view, or use an element screenshot, before they are judged.

## Space loader: a refusal of a piece of work wins at once, for that work alone (comment 6186762851)

**P2.** The project page read each piece of work as `Promise.all` over pairs of
`Promise.all`. A fast transport failure, on the same piece of work or a sibling,
rejected the whole read before a slower 401 or 404 arrived. The list was then
kept as last read, so the chosen view's frame kept running and Send stayed
enabled after a known refusal.

`SpaceView` now reads each piece of work as an `allSettled` pair. The rules:
- **Refusal recorded at once.** Every read is watched. A refusal from the latest
  read generation (not aborted) is recorded straight away for that piece of
  work, keyed `${ws}:${aid}`, without waiting for any other read.
- **Refused work leaves the list.** It disappears and a note says some work
  isn't available. If it was the chosen one:
  - its body, frame and controls are unmounted;
  - the choice stays in the address and the draft is kept;
  - sending waits, with a "not available" pause, by button and by keys.
- **Recovery.** Only a later published complete read of that piece of work ends
  the refusal.
- **Ordinary failures.** An ordinary failure on its own still keeps the list as
  last read, and says so.
- **Other work.** When some other piece of work is refused, the chosen view keeps
  running.

**P3.** In `FlexibleWork`, a view whose code pins the version it was made for now
gives the explanation for that ("ask for an updated view") first, in place too.
"Open the view to point it at the latest saved versions" is shown only for a view
that can actually be repointed, and nothing is offered when the bound work is
missing.

**Regressions.**
- `space-experience.mjs` has a new real-stack case on the supplier comparison,
  running in place. It covers:
  - 401 and 404;
  - either of the chosen view's two reads refused, with the other failing first
    or after;
  - another piece of work's read failing first;
  - a read that never answers, from the same piece of work or another, with the
    refusal required within 2 s;
  - releasing a held read as a failure, which changes nothing;
  - recovery after each;
  - another piece of work refused, where the chosen view keeps running and Send
    stays enabled;
  - a plain failure, shown as last read.

  RED with the old loader: `chosen-unavailable` never appeared.
- `products-review-regressions.mjs` mounts `InPlaceView` with a pinned view and
  with a repointable one. RED with the old ordering: `view-pinned` was not shown.

**Results.** GREEN on a fresh fixture:
- workspace-routing 7/7;
- space-experience 18/18;
- 265 unit tests;
- 37 DOM regressions;
- review-boundary 15/15;
- type, lint and format checks.

## What a view in place reads is named once; a wider conversation beside wide work (batch 3 experience notes)

These address Hermes's batch-3 note: "repeated provenance/read links and visible
version IDs remain experience limitations", and "desktop still has a narrow
conversation column".

**What the view reads, named once.** In place on a project page, the view's trust
line no longer repeats the names and links of what it reads; the "Reads …" line
above it already names them, with links that open them in place. The trust line
now only says whether that is current:
- "reads the current saved version";
- "what it reads changed since this view was made";
- "something it reads isn't available".

The view's own page is unchanged.

**No version ID.** The demonstration supplier view (fixture-authored content) says
"Using the saved quotes." instead of showing a revision ID.

**Wider conversation.** Beside a table or view at 1100 px and wider, the
conversation column gets `minmax(300px, 0.8fr)` instead of `minmax(260px, 0.62fr)`,
about 330 px instead of 270 px at 1440 px; the work keeps most of the width. Other
two-pane pages use `minmax(280px, 1fr) minmax(0, 1.8fr)`.

**Tests.** `space-experience.mjs` checks the in-place trust line states currency
without repeating "Supplier evidence". GREEN 25/25 on a fresh fixture: routing 7
plus experience 18. Also passing: 265 unit tests, 37 DOM regressions,
review-boundary 15/15, type, lint and format checks.

## A kept note says who added it (comment 6188739191)

Hermes reported that a protected note created by the model, quoting the person's
constraints, was labelled "Your note", the same as a correction the person wrote
themselves. Blocks carry no author in the contract, so the frontend derives one
from the saved history.

**How the author is found.** `noteAuthors(current, history)` follows parent
revisions back for as long as the note is present with the same ID and the same
text. The note's author is `author_kind` of the earliest revision in that run. If
the run leaves the history that was read, the author is unknown.

**Labels.**
- "Your note": added by a person.
- "Note from Workagent": added by the worker.
- "Note": author unknown, for example in the Space's inline read, which doesn't
  read history.

**Where it applies.**
- In the editor, a note the person adds or rewords in the draft is theirs.
- In the saved-history list, each version is labelled from its own parents.
- In a proposal, a new or reworded note is Workagent's; an unchanged one keeps its
  saved author.
- Nothing about this is saved: `note_by` is for display only, and `savedBody`
  never sends it.

**Tests.**
- Unit tests in `test/note-authors.test.ts`: first saver, a worker keeping a
  person's note, rewording, a truncated history, and display only.
- The fixture's "Findings so far" now includes a note kept by Workagent.
- In `space-experience.mjs`, the work page shows "Note from Workagent" and never
  "Your note", and the Space inline shows "Note". The person's own note still
  reads back as "Your note".

**Results.**
- RED with the old labels: "Your note" was received.
- GREEN on a fresh fixture: routing 7 plus experience 18.
- Also passing: 270 unit tests, 37 DOM regressions, review-boundary 15/15, type,
  lint and format checks.

## Trusted controls beside a view: change what it reads, and the view reads it (comment 6197276516)

This milestone is about real interaction: a change made through a trusted control
persists, survives reopening, and reaches the conversation through the same work.
A temporary filter is not enough.

**What the person sees.** On a project page, a custom view running in place now has
a "Change <table>" section beside it for each structured table it reads. The section
uses the existing governed table editor in values-only mode:
- typed inputs;
- read-only fields stay locked;
- invalid values are kept as typed and never saved;
- no rows can be added or removed, and there is no notes box.

Small tables open ready to edit; larger ones open on request, or whenever they hold
a change.

**"Save and update the view".** This runs two steps:
1. A human save of the table: CAS on the draft's base, with the exact command
   journaled in the draft's `pending` and replayed by "Try saving again".
2. Unless the view's code pins its versions, a human save of the view with that
   binding moved to the new table revision. The command is journaled under
   `workagent:view-rebind:…` and replayed by "Update the view again" after a lost
   acknowledgement.

The frame is keyed by the view's revision, so a new version is a new frame. It
re-reads through the existing version-bound `read_binding`. The generated frame gets
no new authority.

**Drafts.** Drafts use the same storage key as the work's own page, so a change
survives switching selection, reloading or leaving the page. A draft the person
hasn't touched follows a newer saved version.

**Reply target.** The Space's reply target is the view's exact current revision, so
the conversation sees what the person changed.

**Other outcomes:**
- **Pinned view:** the button says "Save my change", and the page says the view needs
  an updated version. Nothing is rebound.
- **Partial result:** if the table saved but the view update was refused, the page
  says exactly that.
- **Stale draft:** if the table was saved elsewhere since the draft started, the save
  is refused (409), the draft is kept, and "Discard my change" shows the saved
  values.

**In-place rebind.** When what a view reads has moved on (a human edit, or a change
made elsewhere), the same section offers "Use the latest saved versions" in place,
with the same journaling. The in-place notice no longer sends the person to another
page. Pinned views still say they need a new view.

**Frame height.** The frame now measures its content's own height rather than the
page's scroll height. The scroll height is never less than the frame, so a frame made
taller once could never shrink. This has no failing-first test: the tall frame was
seen once on desktop but didn't reproduce in later runs. A new check requires the
frame to fit its content (under 360 px) at full width after the phone-width resizes;
it passes with the old measurement too, so it guards the change rather than proving
it.

**Fixture.** The "Supplier choice" project gets a saved "Priorities" table (weight on
price, %), published by its own synthetic run. The comparison reads both tables. Its
slider is now "Try another weighting (not saved)", and it starts from the saved
priority.

**Real-stack regression** (`space-experience.mjs`, a new case):
- the change survives switching work;
- a lost acknowledgement on the view update is replayed with the same `command_id`
  and body;
- the view reads 100% → "Best fit: Quayside Press";
- the readback shows a human table revision, and the view's binding is that revision;
- after reopening, it is still Quayside, the control shows 100, and the reply is
  about the view's new revision;
- a change made elsewhere is refused (409) with the draft kept, then discarded;
- in-place "Use the latest saved versions" then reads 70%;
- 390 px has no overflow.

The investigation case now repoints the view at the edited quotes in place and reads
€480.

**Results:**
- GREEN on a fresh fixture: routing 7 plus experience 19.
- Also passing: 270 unit tests, 37 DOM regressions, review-boundary 15/15, type,
  lint and format checks.
- Full gate, including the sandbox's 9 checks, and mock e2e 15/15.

## Truthful execution status from `GET /execution` (comment 6198057395, contract 10741ac)

Merged Hermes's `10741ac` with no web conflicts. Wired the generated `ExecutionStatus`/`RunExecution`
into the existing experience, alongside the canonical turn and work readback. There is no
client-side ledger: each page reads `/execution` once, and re-reads it every 15 s and on focus.

**Pending turns** (states `queued`, `responding` or `unavailable`), in the full conversation and
the side pane, take their run's state from the check.

| Run state from `/execution` | What the turn shows |
| --- | --- |
| `unavailable` (or a missing or stale heartbeat) | "Workagent isn't running right now. Your message is kept…". This replaces any "Replying…". |
| `blocked` | One plain reason per failure category (for example, "reached the limit it's allowed for this"). This also replaces the in-progress wording. |
| `awaiting_provider` | "Waiting for the model's answer.", added to the in-progress wording. |
| `recovering` | "Picking this up again after an interruption.", added to the in-progress wording. |
| `working`, `completed`, `idle` | Nothing added; the canonical turn state stays in charge. |

**The Space standing** never says "Workagent is replying" while the check says nothing is running
the latest message.

**The workspace line** (`data-testid="execution-line"`, `data-execution`) appears on the full
conversation and the Space.

| Status | Line |
| --- | --- |
| `unavailable` | Not running; you can read and edit, and new requests wait. |
| `blocked` without capacity | Can't take on new work here right now. |
| `working`, `awaiting_provider`, `recovering` | Working on a request. |
| A failed check | "Couldn't check whether Workagent is running." Not running, not stopped. |
| Ready, including `waiting_for_person` | Silent. |

**Unaffected by the check.** It never disables reading, editing, choosing work or asking. A wait
for human review doesn't block anything. A completed run is never turned into an objective-success
claim. Mock mode doesn't read `/execution`.

**Tests**
- Unit (`test/execution-view.test.ts`):
  - a missing heartbeat reads as not running, never working;
  - blocked shows its category;
  - awaiting the provider and recovering are additive;
  - working, completed and other runs are left alone;
  - the workspace line covers silent, not running, blocked, a failed check, and another run being
    blocked.
- Real stack, a new `space-experience.mjs` case:
  - With no worker, the real `/execution` reads `unavailable`. The waiting turn and the standing
    say so, and never "Replying…".
  - Routed statuses then show the turn's text for `awaiting_provider`, `recovering` and
    `blocked/authority_or_budget`; the draft and chosen work stay put through each re-read.
  - With `waiting_for_person`, the line is silent and Send is enabled.
  - When the check fails, the page says "Couldn't check"; after recovery it reads `unavailable`.
  - The full conversation shows the same.
- `conversation-journey.mjs` now expects the truthful not-running text for its worker-less queued
  turns.

**Results**
- RED with the previous presentation: the standing read "Your latest message is waiting for
  Workagent." and said nothing about Workagent not running.
- GREEN:
  - routing 7 and Space 20;
  - 279 unit tests and 37 DOM regressions;
  - review-boundary 15/15, plus type, lint and format;
  - the full gate, including the conversation journey and general integration;
  - mock e2e 15/15.

## Editor reliability: unsaved work asks before the tab closes

**What the audit found.** The work page keeps unsaved edits in this tab's `sessionStorage`. That
storage survives moving around and reloading within the tab, but not closing it. Until now, closing
or leaving the tab dropped an unsaved edit without asking. The older assignment page already asked;
the main work page and the new view-input controls did not.

**What changed.** A shared `useLeaveGuard(active)` hook (`lib/client/leave-guard.ts`) registers
`beforeunload` while the tab holds something that exists nowhere else. Three places use it:
- the work editor, while it has an unsaved edit or an unconfirmed save, accept or dismiss;
- each table control beside a view, while it has a change or an unconfirmed save;
- the view's own update, while an unconfirmed rebind is waiting.

With nothing unsaved, the tab closes without asking.

**Regression** (a new real-stack case in its own browser context):
- An unsaved paragraph on a work page triggers exactly one `beforeunload`. The dialog is dismissed
  and the tab stays open.
- An unsaved change beside a view asks as well.
- After discarding, the tab closes without asking.

**Results.**
- RED with the previous editor: "an unsaved edit asks before closing", actual `false`.
- GREEN: routing 7 and Space 21, 279 unit tests, 37 DOM regressions, review-boundary 15/15, the
  full gate with 0 failures, and mock e2e 15/15.

## A document proposal says exactly what it changes in the person's version

This prepares Hermes's next verification (comment 6200425047): reviewing a proposal against the
current version, where that version is the person's own.

**The gap.** On the flexible work page, a proposal for a document showed only the whole proposed
version, folded away. It didn't show what would change against the saved version, or that applying
it replaces the person's own edit. Table proposals already got a change summary, and the legacy
assignment page already had a document diff.

**The fix.** A non-outdated document proposal now shows three things:
- **A summary line**, for example "Adds or rewrites 2 parts; takes out or replaces 1 part" (or that
  it reads the same).
- **A note when the saved version is the person's own** (`author_kind: human`): applying the
  proposal replaces the parts marked as only in their version.
- **The exact changes, side by side.** It uses the existing `DocDiff` in compare tone ("Only in the
  proposal" / "Only in your saved version"), with unchanged runs condensed. Kept notes keep who
  added them.

The full proposed version stays one click away. Outdated proposals keep their existing explanation.

**Fixture.** The person corrects "Findings so far". Workagent then proposes a change to that
corrected version:
- one paragraph is rewritten;
- a checklist item is added;
- the kept note is preserved exactly.

This is a live, non-outdated proposal against a human revision. It adds one synthetic run in
`personal-work`, which now has 8 of its 10.

**Regression.** In `space-experience.mjs`, the findings work page shows:
- the summary line;
- the "your own edit" note;
- the added Northprint text and the Friday item as only in the proposal;
- the replaced paragraph as only in the saved version;
- the person's untouched correction absent from the diff;
- Apply enabled.

**Results.**
- RED with the previous page: no summary line ("proposal-changes" not found).
- GREEN:
  - routing 7 and Space 21;
  - 279 unit tests, 37 DOM regressions and review-boundary 15/15;
  - the full gate with 0 failures;
  - mock e2e 15/15.

## A table proposal lists each value it changes and marks the person's own

This covers Hermes's live case: a supply-plan table where a person corrected a price, followed by a
request for a revised plan.

**Before.** A table proposal on the work page showed only counts, for example "2 values changed".
It didn't say which values, or whether any of them was one the person had set.

**Now.** A non-outdated table proposal also shows:
- **Each changed value.** The format is "Row · Field (unit): saved → **proposed**", up to 12 values,
  then "…and N more".
- **Which values are the person's own.** These come first and are marked "(your value)". A short
  line says how many of the person's own values it changes and that applying it replaces them.

**How a value's author is found.** `cellAuthors(current, history)` walks the version history back
through each version's parent while the cell keeps its current value. The value's author is the
`author_kind` of the earliest version in that run. If the history that was read doesn't go back far
enough, the author is unknown and nothing is marked. `cellChanges` covers rows that both versions
have; added and removed rows stay in the summary counts.

**Tests**
- **Unit** (`test/cell-authors.test.ts`): who first saved a value, a truncated history, the
  per-value change list, and added rows.
- **DOM regression** (`products-review-regressions.mjs`): a worker version, then a human hire-cost
  correction, then a proposal that changes it and the travel time. The page lists both values, the
  person's correction first and marked, plus the "replaces it" line.

**Results**
- RED with the previous page: `proposal-replaces-yours` not found.
- GREEN:
  - 283 unit tests;
  - 38 DOM regressions;
  - review-boundary 15/15;
  - routing 7 + Space 21 on the real stack;
  - full gate with 0 failures;
  - mock e2e 15/15.

## Navigation: going back to the project keeps the chosen work

Editor and navigation audit, second fix.

**What was wrong.** On a project's work page, "← <project>" returned to the project with nothing
chosen, so the person lost their place. The browser's Back button kept it, but the page's own link
did not.

**Fix.** The link now carries `?work=<artifact>`. The project opens with that work chosen and shown
in place.

**Regression.** In `space-experience.mjs`, review the budget change, apply it, then follow the back
link. The URL carries `work=<budget>`, and the budget entry is `aria-pressed`.

**Results.**
- RED with the old link: `work` was `null`.
- GREEN:
  - routing 7 + Space 21;
  - 283 unit tests;
  - 38 DOM regressions;
  - review-boundary 15/15;
  - full gate with 0 failures;
  - mock e2e 15/15.

## Sends that the service won't answer: plain refusal, draft kept

Hermes asked (6202177917) for a check of error presentation for ungranted legacy conversations.

**What was wrong.** Since f83090e, managed HTTP refuses a turn in a conversation that has no
scoped activation: `422 unsupported_operation`, unless `WORKAGENT_FIXTURE_MODE=true`. The web
showed the service's generic text, "Operation cannot proceed. Review current state and authority
before retrying." This happened on the full conversation, in the pane beside the work, and on Home.
On Home it also offered a "Try again" that could never succeed. A conversation whose activation was
revoked accepted typing and a send, then failed with "The result is not verified."

**Fix.**
- `describeSendError(err, activation)` gives send-specific copy from the conversation's
  `model_activation`, which is now carried into the view model:
  - not turned on: "Workagent isn’t set up to answer here yet". Nothing was sent, the message is
    kept, and it can be sent once answers are turned on;
  - turned off: "Answers are turned off for this conversation";
  - an unresolved earlier request: "An earlier request here hasn’t been resolved".

  Every other error keeps the general copy.
- `ErrorNotice` takes the mapping via `describe`. The full conversation, the pane and Home use it.
  Home drops "Try again" for this refusal, and a second send reuses the conversation already
  made: no new one.
- `model_activation === "revoked"` holds every send path before anything is typed: the button,
  Ctrl/Cmd+Enter, form submit and saved-code runs. A plain notice explains it, and drafts and
  files stay. "Disabled" can't be decided before sending, because fixture mode admits controlled
  turns, so it is reported only on refusal.

**Regression.** `web/scripts/conversation-refusal.mjs` runs against the real UI, API and
PostgreSQL with the service's default admission, so the 422s are real. It covers four cases:
- Home: the refusal is shown and there is no futile retry.
- The full conversation: the refusal is shown.
- The pane beside a project: the refusal is shown.
- A turned-off activation: the only injected part is the conversation read's
  `model_activation`.

In every case it asserts that the draft is kept, no raw service text appears, and nothing else
was sent.

## Selection phases past the fourth

f83090e raised the response steps to `selection_8`. The "Trying another approach" check ordered
phases from a fixed list of four, so a retry at the fifth to eighth phase was never shown. Phases
are now ordered by their number. Unit regression in `test/adaptive-presentation.test.ts`.

## From a model view to the trusted editor of what it reads

Hermes asked for a check of source-work links from model views to trusted editors.
- **In place, on the project page:** "Reads …" selects the source work there.
- **On the view's own page:** each source links to its own work page, which is the trusted
  editor. That page's back link returns to the project with the source chosen. A view's bindings
  are always in its own conversation (`flexible_work._view_bindings`), so the link's conversation
  is right.
- **Fix:** a source that can't be read now was still a link that led to "not available". It is
  now named, not linked.

**Regression.** A new `space-experience.mjs` case covers it:
- the source's read is refused (404 injected);
- the view's own page names it without a link;
- the other source links to its editor (an editable table);
- back returns with that source `aria-pressed`.

**Results for the three fixes above.**
- RED:
  - Home showed "Operation cannot proceed. Review current state and authority before
    retrying." with "Try again";
  - the phase unit test failed: no retry shown at `selection_5`;
  - the view's unreadable source had one link where 0 were expected.
- GREEN:
  - refusal 4/4 + routing 7 + Space 22 on the real stack;
  - 289 unit tests;
  - 38 DOM regressions;
  - full gate with 0 failures;
  - mock e2e 15/15.
- Gate note: since f83090e the legacy controlled journeys run ungranted turns. They need
  `WORKAGENT_FIXTURE_MODE=true`, now set explicitly in the local gate. This includes
  `scripts/verify_general_integration.py`.

## Long text in a table reads whole where it's edited

Hermes finding 6202897574 (1).

**What was wrong.** A one-column table of long steps put each step in a two-line textarea capped at
320px wide, while the work pane stayed mostly empty. Every step had to be scrolled inside its cell.
Each step's accessible name was also its own text, so its name changed as the person typed.

**Fix.**
- Long-text columns (`data-long`) take the table's width.
- The textarea grows with its text, and with its width on resize. It stays one value: Enter
  doesn't add a line.
- On a phone the step goes under its label, across the card.
- The cell that names its row is labelled by position ("Row 2 Step").
- Saving is unchanged and explicit, as is human-field tracking.
- Read-only tables use the same widths.
- The headline says "1 column", not "1 columns".

**Regression.**
- The Space fixture gains an "If the sign-up laptop goes offline" table: one text column with
  three long steps.
- A new `space-experience.mjs` case checks the following:
  - at 1280px, no step hides any text inside its cell, and each uses at least 60% of the table;
  - an edited step grows, saves through "Save my edits" and comes back whole;
  - at 390px, no step scrolls inside and the page doesn't scroll sideways.
- RED with the old table: "a step scrolls inside its cell: 35px hidden".

## A stopped request isn't offered as something to ask again

Hermes finding 6202897574 (2).

**What was wrong.** When a response couldn't be used, or its outcome was unknown, the page said
"Inspect it before asking again", and the normal composer stayed beside it as if re-asking were the
way out. For a quarantined attempt that's wrong: it is kept as it is and isn't resent.

**Fix.** The stopped turn now says what stopped:
- "This request stopped: its answer couldn’t be used";
- or "This request stopped: whether it went through is unknown".

It also says that it won't be retried or sent again on its own, that anything already saved,
including your edits, is unchanged, and that this isn't a completed result.

The composer beside a stopped request says: "The stopped request isn’t sent again. A new message
starts a new request." The same wording is used for an unconfirmed outcome in the pane and on the
project page. A send refused for an unresolved earlier request reads "An earlier request here
hasn’t been resolved", with no promise of progress. There is no retry button.

**Regression.**
- Unit tests: no "ask again", "try again" or "retry it" wording; "stopped" plus no automatic
  retry plus edits unchanged, for both stop kinds; and `lastStopped` holds only for the latest
  turn.
- RED: both stop kinds failed on the old copy.

**Results for both fixes.**
- real stack: routing 7 + Space 23 + refusal 4;
- 292 unit tests;
- 38 DOM regressions;
- full gate with 0 failures;
- mock e2e 15/15.

## A table's notes read whole too

Follow-up to Hermes 6203726958, which said "Notes still scroll inside their field".

**Fix.** The notes box ("Notes (one per line)") is as tall as its notes, using the same fit as long
step cells, and refits on width changes.

**Regression.** The long-steps case types five notes, then checks that nothing scrolls inside the
box, that save and reopen keep them, and that they reopen whole.

**Results.**
- RED with the old box: "notes scroll inside their box".
- GREEN:
  - routing 7 + Space 23 + refusal 4;
  - 292 unit tests;
  - 38 DOM regressions.

## A wide table stays inside the work pane

Hermes 6203855351 reported a live six-column lending-desk table at 1440px with page-level sideways
scroll, and the Notes column (and the row controls) off-screen.

**Causes.**
1. The visually hidden "Row actions" heading (`.sr-only`, `position: absolute`) had no containing
   block inside the table's scroll region. It escaped the region's `overflow: auto` and widened the
   whole page.
2. Six columns with 160px text inputs plus a 16rem long column outgrew the 819px pane. The
   rightmost columns, including each row's Remove, sat off-screen with no cue on desktop.

**Fix.**
- The table region is the containing block (`position: relative`), so nothing in it widens the
  page.
- The row-actions column sticks to the right edge, so every row's Remove stays in view. On a phone
  it stays in the card as before.
- "Scroll sideways for more columns →" shows whenever the region is actually wider inside than it
  shows, measured as it resizes, not only on narrow screens.
- In tables of four or more columns with a long column, short text needs less room (7rem inputs)
  and the long column 13rem. At 1440 the six-column table's Notes now reads whole in view.
- Explicit save and human-field tracking are unchanged.

**Regression.**
- The fixture adds a "Studio kit" workspace with its own synthetic grant, so no other project's
  runs are used. Its "Open day kit" project holds the six-column "Lending desk" table, whose
  "Repair bag" note is long.
- A new `space-experience.mjs` case checks that:
  - at 1440 the page doesn't scroll sideways;
  - each row's Remove is inside the visible table;
  - the cue shows exactly when the table overflows;
  - the long note can be brought into view, edited, saved and reopened;
  - the project page doesn't scroll sideways either;
  - nor does the page at 390.
- The Spaces project count is now 5.
- Separately, the "change beside a view asks before closing" case now clicks the field (the browser
  only asks after a user gesture since load) and waits for the unsaved state before closing. It
  failed once on an earlier run, then passed 3/3.

**Results.**
- RED with the old table: "the page scrolls sideways at 1440".
- GREEN:
  - routing 7 + Space 24 + refusal 4;
  - 292 unit tests;
  - 38 DOM regressions;
  - full gate with 0 failures;
  - mock e2e 15/15.

## Wide tables: long fields on their own line, short values whole

Follow-up to Hermes 6204636720, which noted "narrow desktop field inputs".

**What was wrong.** After `104beac`, short text inputs in wide tables were a fixed 7rem, so a value
like "Gallery front room" was cut off. Widening them pushed the long Notes column back under the
sticky row controls.

**Fix.**
- In tables of four or more columns with a long-text field, the long field goes on its own
  full-width line under each row's short fields.
  - On desktop it is named there by its label. On a phone it joins its row's card.
  - Every column then fits the work pane at 1440, with no sideways scroll and no cue.
- Short text boxes are as wide as their column's longest value (10–32 characters), the same on
  every row.
- A read-only long value keeps an accessible label; an editable box already carries its name.
- Explicit save and human-field tracking are unchanged.

**Regression.**
- In the `space-experience.mjs` wide-table case, at 1440:
  - no short value is cut off;
  - no column is out of view and there is no cue;
  - each row's note is fully in view and scrolls nothing inside.
- The fixture's "Display stand" borrower is now "Gallery front room".
- In `products-review-regressions.mjs`, long fields in many-column tables are expected as labelled
  lines under each row, not as column headers.

**Results.**
- RED with `104beac`: "short values are cut off in their boxes: Gallery front room".
- GREEN:
  - routing 7 + Space 24 + refusal 4;
  - 292 unit tests;
  - 38 DOM regressions;
  - full gate with 0 failures;
  - mock e2e 15/15.

## Editor audit: an unsaved edit keeps its save in view

Editor and navigation audit, third fix.

**What was wrong.** "Save my edits" and "Discard my changes" appear only once there's an edit, below
the whole table (or document) and its notes. On a phone, or in any long piece of work, an edit near
the top left them off-screen, with nothing in view saying the change wasn't kept.

**Fix.** While anything is unsaved, the action row sticks to the bottom of the screen. It shows
"Your changes are not saved yet.", "Save my edits" and "Discard my changes". Nothing else about
saving changes: it stays explicit, and discarding still returns to the saved version.

**Regression.** The long-steps case, at 390, edits the first step and asserts that "Save my edits"
is inside the viewport and that the bar says the changes aren't saved. It then discards, and the
save goes away.

**Results.**
- RED with the old layout: "the save is out of view after an edit at the top".
- GREEN:
  - routing 7 + Space 24 + refusal 4;
  - 292 unit tests;
  - 38 DOM regressions;
  - full gate with 0 failures;
  - mock e2e 15/15.

## Editor audit: Ctrl/Cmd+S saves unsaved edits

Editor and navigation audit, fourth fix.

**What was wrong.** In the trusted editor, Ctrl/Cmd+S opened the browser's "Save page" dialog. It
didn't save the person's edits.

**Fix.**
- While anything is unsaved, Ctrl/Cmd+S runs the same explicit save as "Save my edits".
- It respects the same holds: no save while locked, stale, pending or invalid.
- The button advertises the shortcut through `aria-keyshortcuts` and its title.

**Regression.** The long-steps case, at 390, edits the first step, presses Control+S, sees "Your
edits are saved.", reloads, and finds the edit kept.

**Results.**
- RED on the previous build: no "Your edits are saved." after Control+S.
- GREEN:
  - routing 7 + Space 24 + refusal 4;
  - 292 unit tests;
  - 38 DOM regressions;
  - full gate with 0 failures;
  - mock e2e 15/15.

## Editor audit: undo a removal; drafts always match their work

Editor and navigation audit, fifth fix, plus a root-caused intermittent DOM failure.

**Undo a removal.** Removing a table row, or a part of a document, was instant and could only be
reversed by "Discard my changes", which also dropped every other unsaved edit.
- Removing now shows "Removed “…”. Undo".
- One click puts the row or part back where it was. For a row, that includes any values typed into
  it that weren't valid yet.
- If nothing else changed, nothing is left unsaved.
- Regression: a new `space-experience.mjs` case removes the middle row of the lending table, and a
  part of the workshop plan, and undoes each. The order is restored and no save is pending.
- RED on the previous build: no undo offered.
- The "Temporary line" check in the leave-guard case now asserts the part is gone from the
  document. Only the undo offer names it.

**Drafts always match their work.** `products-review-regressions.mjs` failed intermittently (34/38,
in about 3 of 4 runs, on the previous commit too). The cause was `TableEditor` crashing on "reading
'some' of undefined". The harness reuses one artifact id, so the editor could keep a document draft
while being shown a table without remounting. Drafts were only checked for kind on first load.
- `FlexibleEditor` now re-reads its draft whenever the draft isn't for this kind of work, before
  anything renders with it, falling back to the saved version.
- This also guards against a mismatched or corrupt stored draft.
- After the fix: 6/6 consecutive runs at 38/38.

**Results.**
- GREEN:
  - routing 7 + Space 25 + refusal 4;
  - 292 unit tests;
  - 38 DOM regressions (6/6 runs);
  - full gate with 0 failures;
  - mock e2e 15/15.

## Capabilities a step used, in plain words

Following Hermes `d802155` (`inspect_json`), integrated by fast-forward. The turn details said
"Used inspect_json (version 1)", an internal identifier.
- Known capabilities now read in plain words: "Looked inside the attached JSON file", "Searched your
  earlier work", "Read your saved work", and so on.
- An unfamiliar one reads as words ("Used summarise notes").
- The trailing "This reads information; it isn’t a permission or an action." is unchanged.
- `.json` attachments were already accepted, because the web reads the generated attachment
  contract's extensions.
- Unit regression in `test/adaptive-presentation.test.ts`. RED: the internal names were shown.
- GREEN: 293 unit tests; 38 DOM regressions; full gate (on the merged `d802155` backend) with 0
  failures; mock e2e 15/15.

## One piece of work, with what belongs to it (View · Source · Changes)

This is the first implementation step recommended in the concepts handoff (#9, 6205830752; gallery
`ceac131`). It is frontend only and uses data the web already reads.

**What changed.**
- The chosen work on a project page now has tabs, but only when it has more than one facet:
  - **View** for a view, or **Saved version** for other work;
  - **Source** / **Sources**, the saved work a view reads, each read-only and with "Open to
    edit" going to its trusted editor;
  - **Changes · n**, the proposals waiting on this work or on what it reads.
- Plain work with nothing it reads and nothing proposed stays a single surface.
- The tablist follows the ARIA pattern: arrow keys, Home and End, roving focus.
- Every panel stays mounted (hidden when not chosen), so a view, its trusted inputs and their drafts
  keep their state. The chosen tab returns after a reload.
- The status line gains "See the change". A change to something a view reads is named as such.
- A proposal that changes one table value reads **Saved → Proposed** ("Lantern · Loan (days):
  Saved 3 → Proposed 2"). The same applies on the work page.
- "(your value)" and "It changes a value you set yourself" come from history, fetched only for a
  table change.
- Applying stays explicit, on the work's own page ("Review and decide"). The Changes tab says the
  saved version stays until the change is applied.

**Fixture.** The kit workspace's lending table gains one single-value proposal: the lantern's loan,
3 → 2 days.

**Regression.** A new `space-experience.mjs` case checks:
- tabs and Saved → Proposed on the kit project;
- keyboard movement and focus;
- the tab choice persisting across a reload;
- no sideways scroll at 390 or 320;
- "Review and decide" leading to the same comparison on the work page;
- the comparison view's Sources tab, with only the chosen panel shown, and a trusted-input draft
  that survives switching tabs, then is discarded;
- no tabs for the plain workshop plan.

**Results.**
- RED on the previous build: no tabs.
- GREEN:
  - routing 7 + Space 26 + refusal 4;
  - 293 unit tests;
  - 38 DOM regressions;
  - full gate with 0 failures;
  - mock e2e 15/15.

## A proposal leads with the decision (Hermes 6206756267)

**Problem.** A pending proposal on a work page rendered its full old/new comparison before the
decision. On a phone, Apply and Keep sat several screens down, and a proposal that renamed the work
(the 12-minute version) wasn't named until the person read the diff. The saved heading correctly
stayed on the saved title.

**Change** (`FlexibleWork.tsx`, `products.css`). The card now reads, in order:
- "A proposed version is ready", or the outdated status;
- **Proposed: <new name>** when the proposal renames the work;
- the proposal's reason;
- a one-line change summary ("Renames it …; adds or rewrites 2 parts; takes out or replaces 1
  part"), plus the note about the person's own edits when it applies;
- the governed **Apply proposed version / Keep my current version** controls;
- **Compare in full**, folded: the paragraph diff, and table cell changes when there are more than
  three (three or fewer stay inline as Saved → Proposed);
- "See the proposed version", folded, as before.

Proposal id and base-revision fencing, the outdated rule and explicit apply are unchanged. No
contract change.

**Fixture.** The findings proposal now renames the document to "Findings so far: the 10-day option".

**Regression** (`space-experience.mjs`, findings case, 390×844):
- the full comparison follows Apply in the card and starts folded;
- Apply sits within 700px of the card's top;
- the proposed name is shown and the saved h1 keeps the saved title;
- opening "Compare in full" shows the same diff assertions as before.

**Results.**
- RED on the previous card: the comparison came before Apply.
- GREEN:
  - routing 7 + Space 26;
  - 293 unit tests;
  - 38 DOM regressions;
  - lint and typecheck clean;
  - full gate at `f4f3da5` with 0 failures (same as baseline);
  - mock e2e 15/15.

## Home: "Since you left" (concept 02)

**Problem.** A returning person had to scan every group on Home to find what moved while they were
away.

**Change** (`app/page.tsx`, `lib/since-you-left.ts`, `lib/client/since-marker.ts`,
`agent-first.css`). Home opens with a short list, newest first, of at most four entries:
- "A proposed version of “…” is waiting for you" (a current proposal only);
- "Workagent saved a new version of “…”".

Each entry opens the exact work. Left out:
- the person's own saves;
- proposals made for an earlier version;
- the decision already shown in full in the card below.

Nothing says a proposal is accepted or work is finished.

**Marker (until backend dependency A exists).**
- Kept on this device as the newest service timestamp Home showed (`workagent:seen:<ws>`), so it
  doesn't depend on the device clock.
- A first visit says nothing.
- Each tab fixes its starting point (`workagent:since:<ws>`), so a reload keeps the list.
- "Got it" clears it.
- When the service records what a person has seen, this hook is the one place to switch over.

**Regression** (`space-experience.mjs`, new case). The marker is set back to before the fixture's
work was made, standing in for an earlier visit. The case checks:
- a first visit is empty;
- an earlier marker lists the fixture's work, each entry's wording, link and row status;
- the decision shown in full isn't repeated;
- a reload keeps the list, and an entry opens its work;
- 390px fits;
- "Got it" clears it in this tab and a new one.

Unit tests cover selection and the marker comparison.

**Results.**
- RED without the change: no marker.
- GREEN:
  - routing 7 + Space 27;
  - 298 unit tests;
  - 38 DOM regressions;
  - full gate at `f4c4992` with 0 failures (same as baseline);
  - mock e2e 15/15.

## What each responsibility waits on or does next (concept 02, "I'm handling")

**Problem.** These surfaces said only that a responsibility was held ("Nothing runs for it right
now. Outcome not verified."), not what it is about:
- Home's "I'm handling" / "Ready for you" rows;
- a conversation's hand-overs;
- a project's standing card.

**Change** (`hold-view.ts`, `WorkRow.tsx`, the conversation page, `space-view.ts`). Each now leads
with one line from its current lifecycle record:
- its wait reason;
- else its blocker;
- else "Something it depends on has changed since it was recorded.";
- else "Next: <next_action>".

When review is required, the review comes first and no next step is shown. Closed
responsibilities show none. Run status and "Outcome not verified" are unchanged. No contract change.

**Regression.** The responsibility-recording journey checks:
- the waiting row reads "The venue has not replied." on Home and in the conversation;
- the held row reads "Next: Draft the first rota.".

Unit tests cover the wait, blocker, changed-dependency, review-first and closed cases.

**Results.**
- RED without the change: no line.
- GREEN:
  - responsibility journey 9/9;
  - routing 7 + Space 27;
  - 299 unit tests;
  - 38 DOM regressions;
  - full gate at `47e1dff` with 0 failures (same as baseline);
  - mock e2e 15/15.

**Not done yet.** Steering beside each responsibility on Home. Pause, resume and take back stay on
the work page, where their journaled controls are.

## Home: one line of what needs you, the entry first, recent work, and steering (concept 02)

**Problem.** Concept 02 opens with a one-line orientation, the request box, then what changed,
what is being handled (with steering beside each item) and where to pick up. Home instead opened
with a generic line, put the decision card above the request box, and its rows only opened the
work.

**Change.**
- **Greeting line** (`since-you-left.ts` `homeSummary`). Counted from current records only:
  - what needs the person: the decision shown, fresh proposals, and responsibilities whose current
    record needs them;
  - what Workagent saved since they left.

  For example: "One thing needs you. Workagent saved a new version of one piece of work since you
  left." It never says done or accepted, and falls back to the previous line when there is
  nothing to count. Coarse assignment states are never counted, so review-boundary R3 is still
  respected.
- **Order.** The request box comes straight after the greeting.
- **Pick up where you left off** (`recentWork`). The three most recently changed pieces of work,
  each opening it.
- **Steer beside each held responsibility** (`WorkRow.tsx`). Responsibilities that came from a
  conversation and aren't closed get two controls:
  - **Steer** opens the conversation with the reply box focused. Nothing is sent and any draft is
    kept.
  - **Pause or stop…** (or **Resume or stop…** when paused) opens its page at the in-view
    controls, under the existing compare-and-swap, confirmation and exact-replay rules. There is
    no new write path.
  - Taken-back and stopped responsibilities show neither.

**Regressions.**
- Space-experience Home case:
  - the greeting names what was saved since the earlier visit, and stops after "Got it";
  - the entry comes before what changed;
  - pick-up links open work.
- Responsibility journey:
  - both steering controls appear beside the waiting and held rows;
  - Steer lands focused in the reply box with no message sent;
  - "Pause or stop…" lands on the controls, in view;
  - after taking a responsibility back, no steering is offered.

**Results.**
- RED on each without its change.
- GREEN:
  - routing 7 + Space 27;
  - responsibility journey 9/9;
  - 301 unit tests;
  - 38 DOM regressions;
  - full gates at `61f9050` and `03130d3` with 0 failures (the only difference is the renamed case
    title);
  - mock e2e 15/15.

## Proposal review: what changed, item by item (concept 04)

**Problem.** Concept 04 names each change above the full comparison. The card gave only counts
("adds or rewrites 2 parts").

**Change** (`proposal-changes.ts`, `FlexibleWork.tsx`). Under the count line, the card lists up to
four changes in reading order, quoting the proposed text:
- "Rewrites a part as “…”";
- "Adds “…”";
- "Takes out “…”";
- "Marks “…” done" / "not done".

Any remaining changes are counted, with a pointer to the full comparison. Items come from the diff
of the two saved bodies, never from the proposer's account of itself.

**Your notes.** When the saved version has notes the person added, the card says whether the
proposal keeps them word for word, or how many it would change. A note Workagent added is never
counted as theirs.

**Regression** (space-experience findings proposal):
- the two items quote the rewritten and the added part;
- there is no "your notes" line for Workagent's note;
- Apply stays within one phone screen.

Unit tests cover rewrites, additions, removals, check/uncheck and note counting.

**Results.**
- RED on the previous card: no items.
- GREEN:
  - routing 7 + Space 27;
  - 305 unit tests;
  - 38 DOM regressions;
  - full gate at `1fe3abe` with 0 failures (same as baseline);
  - mock e2e 15/15.

**Still open from concept 04.**
- "Ask for a change" on the review page.
- A pinned Apply/Keep bar on phones (less needed now the card fits one screen).
- A bottom tab bar on phones.
- Written change descriptions ("Added a clear return-time step") need Hermes (B).

## Home reads work from every space the person can open (Hermes 6208780916)

**Problem.** Home read conversation-owned work only from the default personal workspace. With
several workspaces, these all missed work elsewhere:
- "Since you left";
- "Pick up where you left off";
- decisions;
- "Made in your conversations".

On a retained multi-workspace database, Home showed an older fixture workspace.

**Change** (`conversation-work.ts` `loadHomeWork`/`useHomeWork`, `app/page.tsx`).
- Home reads the work of each workspace the server lists for this person and joins it, decisions
  first.
- Each item keeps its own workspace, so its links open it there.
- No scope is bypassed, and there is no active-workspace selector.
- A workspace the caller can't see is left out. One that can't be read is counted, and Home says so
  rather than showing it as empty. The read fails only when no workspace can be read.
- "Since you left" uses Home's own device marker, `workagent:seen:home`.
- New requests still start in the personal workspace.

**Not yet across spaces.** Home's responsibility rows still come from the personal workspace's
overview.

**Regression.** Space-experience Home case: Home opened for the local workspace shows the
studio-kit lending table, linking into studio-kit. Unit tests cover joining, hidden versus
unreadable workspaces, and total failure. The review-boundary stub gains the new export.

**Results.**
- RED without the change: absent.
- GREEN:
  - routing 7 + Space 27;
  - review-boundary 15/15;
  - 308 unit tests;
  - 38 DOM regressions;
  - full gate at `78c2087` with 0 failures (same as baseline);
  - mock e2e 15/15.

## Home's responsibilities come from every space too

**Problem.** After `78c2087`, Home's conversation work spanned every space, but its handed-over
work still came from the personal workspace alone. That covered "I'm handling", "Ready for you",
held responsibilities and the attention card.

**Change** (`overview.ts` `useHomeOverview`, `responsibility.ts` `useHoldsIn`, `app/page.tsx`).
- Home reads each workspace's assignments and joins them, newest change first.
- A workspace that can't be read is counted, using the same "couldn't be read just now" line. The
  read fails only when no workspace can be read.
- Each responsibility is read in the workspace that holds it. `useHolds(ws, ids)` is now a thin
  call into `useHoldsIn`, so its stale/unknown rules are unchanged for every other list.
- New requests still start in the personal workspace.

**Regression** (space-experience Home case). Home opened for the local workspace shows the
hand-over held in personal-work, linking into it, with its current record read. The
review-boundary fixture's assignment gains the `workspace_id` that real summaries carry.

**Results.**
- RED without the change: absent.
- GREEN:
  - routing 7 + Space 27;
  - responsibility journey 9/9;
  - review-boundary 15/15;
  - 308 unit tests;
  - 38 DOM regressions;
  - full gate at `e7d1f12` with 0 failures (same as baseline);
  - mock e2e 15/15.

## Proposal review: ask for a different change (concept 04)

**Problem.** Concept 04 puts "Ask for a change…" right beside Apply/Keep. Asking for something else
meant finding the Conversation switch and its reply box.

**Change** (`FlexibleWork.tsx`, the work page). The proposal card has "Ask for a different change"
after Apply and Keep. It:
- brings the conversation beside the work forward (on a phone, it switches panes);
- puts the cursor in the reply box, which is already about this work's saved version.

Nothing is sent. The saved version and the proposal stay as they are until the person decides.

**Regression** (findings proposal at 390×844):
- the button opens the conversation pane with the reply box focused;
- no POST is made;
- switching back shows the proposal's Apply control.

**Results.**
- RED without the change: no button.
- GREEN:
  - routing 7 + Space 27;
  - 308 unit tests;
  - 38 DOM regressions;
  - full gate at `a2394fa` with 0 failures (same as baseline);
  - mock e2e 15/15.

**Deferred: a bottom tab bar on phones.** On phones, several controls already stick to the bottom
of the screen:
- the unsaved-changes bar;
- table row controls;
- the reply box beside the work.

A fixed tab bar would overlap them and the keyboard, which concept 04 itself warns against. The top
tabs fit at 320 and 390. Revisit with a layout that reserves space for both.

## Home: the conversation-work feed says its own state (Codex 6219198814)

**Problem.** Home handled only the handed-over work's error and reconnecting state. The work
conversations made is a separate read:
- when it failed at first, Home silently left that work out, including any proposal waiting on it,
  while handed-over work looked complete;
- when a re-read failed, Home kept showing proposals as if they were current.

**Change** (`app/page.tsx`). That feed now says its own state, whatever the other read does:
- **First read failed:** "Work from your conversations couldn't be read. It isn't shown here,
  including any proposal waiting for you. Nothing was changed." with **Try again**.
- **A re-read failed:** "Couldn't re-check work from your conversations. It's shown as last read,
  so a proposal may have changed since."

The handed-over work's existing notices are unchanged.

**Regression** (space-experience). The conversation list is failed in the browser while
assignments are still served:
- the error shows while handed-over work is still listed;
- Try again reads the work;
- a failed re-read keeps the work, labelled as last read, at 390px too;
- recovery clears the label.

**Results.**
- RED without the change: no error shown.
- GREEN:
  - routing 7 + Space 28;
  - review-boundary 15/15;
  - 308 unit tests;
  - 38 DOM regressions;
  - full gate at `4dbeffe` with 0 failures (same as baseline);
  - mock e2e 15/15.
