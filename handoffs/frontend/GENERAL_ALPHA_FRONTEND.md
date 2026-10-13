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
