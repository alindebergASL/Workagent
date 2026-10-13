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
