# Frontend: CSV and tool products, result-first, beside the conversation

Base: Hermes' integration candidate `hermes/general-products-integration`
at `20664ba`. It includes backend `8ef4aab`, my `e30ed03`, and Hermes'
first products UI. My branch fast-forwarded onto it.

| Commit | Contents |
| --- | --- |
| `f45aad6` | Scripts honour `PLAYWRIGHT_CHROMIUM_PATH` |
| `75f7a6e` | Result-first presentation |
| `16bceb3` | Plain turn states |

Only `web/` and `handoffs/frontend/` change. The contract is
`handoffs/backend/GENERAL_PRODUCTS_CONTRACT.md`, which I acknowledge as
implemented.

## What changed for the person

Hermes' logic is kept as is:
- exact-base saves and proposal acceptance;
- replayed pending commands and draft persistence;
- the `current_revision` + `current_scope` verification rule;
- i64 values shown verbatim.

What changed is presentation:

- **The result leads.** A table opens with what the reconciliation found:
  "Row B is reported at 38.50 but calculates to 37.50", the reported and
  calculated totals, and the rows that are off. A tool opens with
  "Returns 4250" and its labelled inputs. Values come from the saved rows and
  the observation record, never recomputed in the browser.
- **One plain status:**
  - "Checked against this saved version."
  - "Your unsaved changes haven't been checked yet."
  - "This saved version hasn't been checked yet."

  It also says when a result belongs to the proposed or an earlier version.
  Bindings, scope, formula, engine and the exact record sit under "How this
  was checked".
- **The table shows every column.**
  - Plain headers.
  - Calculated columns are read-only, and struck through once edits make them
    stale.
  - The discrepancy row is highlighted.
  - Rounding has readable names.
  - Phones get a sideways-scroll cue.
- **One decision at a time.**
  - A pending proposal leads, with its own headline and "Apply proposed
    version".
  - One primary action at a time: "Save my edits", or "Recalculate saved
    rows" / "Run saved tool".
  - Download and "Check for updates" are quiet links.
- **The conversation sits beside the work.** It shows recent messages, tags
  this work, and gives the current turn's state and a way back to reply.
  Phones get Work / Conversation, with both panes mounted.
- **The thread reads plainly.**
  - Turns say waiting, replying, stopped, "didn't complete" or "nothing has
    picked this up yet". The service's exact reason is under "Why" for
    failed, unavailable or unconfirmed turns.
  - Product links are calm cards, and refresh is a quiet link.

## Evidence at `16bceb3` (clean tree)

All runs used real API, web and PostgreSQL, the hash-pinned wasmtime 49.0.0,
and zero provider calls. Every database was fresh, except the checkpoint,
which uses the demo's retained one.

| Check | Result |
| --- | --- |
| `pnpm check` | PASS, 80 tests (adds result-summary tests) |
| Mock browser suite | PASS, 15/15 |
| `products-review-regressions.mjs` (fixture DOM) | PASS, 8/8 |
| Canonical demo (intake regression) | PASS |
| Fault regressions | PASS, 9/9 |
| Reset checkpoint | PASS |
| Conversation journey (lost responses, reload replay, 320 px) | PASS |
| `products-journey.mjs` on normal `serve` with the continuous controlled dispatcher | PASS, no page errors |
| `products-readback-journey.mjs` (dropped ack, reload, byte-identical retry, exact i64) | PASS |

The `products-journey.mjs` run covers:
- CSV: reported 78.40, calculated 77.40; row B reported 38.50, calculated 37.50.
- Edit, save, recalculate and apply.
- Tool returns 3750, then 4250 after the shipping change.
- A rejected host import.
- Restart and reopen.

Captures are in `evidence/products/` (desktop, 390 and 320 px).
`evidence/b1-conversation/` and `evidence/reset-cp1/` were refreshed.

## Verdicts

| Verdict | Result | Basis |
| --- | --- | --- |
| Engineering | PASS for this candidate as exercised | Checks above |
| Usefulness | NOT TESTED | An operator explicitly picks the operation and attaches synthetic fixtures; no model reasoning |
| Experience | NOT TESTED by a person | My review only |

## Remaining gaps

1. ~~**Replying from beside the work.**~~ Closed below: you can reply from the
   pane beside the product.
2. ~~**Tool inputs.**~~ Closed below: each input is now its own field.
3. **Controlled replies.** Their text is still the backend's
   controlled-transport wording.
4. **Operation choice.** Choosing CSV reconcile or Wasm is explicit; the
   agent doesn't decide.

## Reconciled with Hermes' `19e1478` at `9b6fd00`

I merged Hermes' failure-isolation and parent-verification commit; it applied
cleanly.

Hermes' compatibility edit made my conversation journey expect the service's
technical turn reason as visible text. The UI now leads with plain words and
keeps that reason under "Why", so I:
- kept Hermes' `data-state` locators and asserted the plain wording;
- updated `scripts/verify_general_integration.py` one-to-one for the
  product-page strings, and let its inline browser use the preinstalled
  Chromium.

Its outage assertion holds unchanged, because the exact reason is still in the
turn's DOM.

| Check at `9b6fd00` (clean tree, fresh databases, zero provider calls) | Result |
| --- | --- |
| `pnpm check` | PASS, 80 tests |
| Mock browser suite | PASS, 15/15 |
| `scripts/verify_general_integration.py`: products journey, readback, consumer outage → unavailable, restart and recovery of the same run, saved notes, tool 4250 and exact i64 | PASS |
| Canonical demo | PASS |
| Fault regressions | PASS, 9/9 |
| Reset checkpoint | PASS |
| Conversation journey | PASS |

## Per-field tool inputs

Tool inputs used to be two comma-separated lists plus an "Apply" step. Each
input is now its own row, with a name, a whole-number value and a Remove
button, plus "Add an input" (up to eight).

- Valid edits go straight into the draft, so "Save my edits" and "Discard my
  changes" cover them like any other edit.
- An invalid value stays on screen with its reason and never reaches the
  draft.
- Existing input names are kept; new ones get a unique `input_N`.
- On phones the name sits above its value.

Validation is the same as before: integers within ±1,000,000,000, at most
eight inputs, and names up to 120 characters. `formInputs` now delegates to
the new `fieldInputs`. The two products scripts were updated one-to-one:
- the journey fills Quantity 3, Unit price cents 1250 and Shipping cents 500
  field by field;
- the DOM regression checks that Discard resets the rows and that a
  non-integer is held back.

| Check (fresh databases, zero provider calls) | Result |
| --- | --- |
| `pnpm check` | PASS, 80 tests |
| Mock browser suite | PASS, 15/15 |
| `products-review-regressions.mjs` | PASS, 8/8 |
| `scripts/verify_general_integration.py` (products journey: tool 3750 → 4250; readback, outage, restart) | PASS |
| Conversation journey | PASS |

The refreshed tool captures (`03-tool-shipping`, `04-tool-390`,
`04-tool-320`) are in `evidence/products/`.

## Replying from beside the work

The conversation pane beside a table or tool now has its own reply box. You
can ask about the work or ask for a change without leaving it.

- **Shared send path.** The reply uses the same send code as the full
  conversation (`useConversationReply`). The draft and any unconfirmed send
  are keyed by conversation, so both places share them. A send whose
  acknowledgement was lost can only be replayed exactly, from either place.
- **Live replies.** The pane reads the conversation itself and polls only
  while a turn is waiting or replying.
- **Proposals appear without a reload.** When a turn settles, the product
  is read again.
- **Edits are kept.** Unsaved edits to the work stay as they are.
- "Open the full conversation" is now a quiet link.

The conversation page now uses the same hook, with no change in behaviour.
The conversation journey, which covers lost responses and reload replay,
still passes.

| Check (fresh databases, zero provider calls) | Result |
| --- | --- |
| `pnpm check` | PASS, 80 tests |
| Mock browser suite | PASS, 15/15 |
| `products-review-regressions.mjs` | PASS, 9/9 (adds: a reply beside the work keeps and replays the exact unconfirmed send, under the conversation's own key) |
| `scripts/verify_general_integration.py` | PASS |
| Conversation journey | PASS |

The `verify_general_integration.py` run covers the products journey. It now
replies from beside the tool, and the reply and controlled answer appear in
the pane while the URL and an unsaved notes edit stay. It also covers
readback, outage → unavailable, and restart.

The capture is `evidence/products/03b-tool-reply-beside.png`. The reply in
that run is answered by the controlled transport, not a model.

## Consumed Hermes' integration corrections at `f68efe5`

`claude/workagent-frontend-kyg51x` fast-forwarded to `f68efe5`. That is my
`43cfe3f` plus three integration corrections from Hermes in `web/`. I agree
with all three and kept them as written:

1. **A late reply can't erase a newer send.** A late completion of an earlier
   reply no longer clears a newer unconfirmed send or its draft. Clearing now
   requires the exact attempt (`usePendingCommand().clear`), including when
   storage is full.
2. **Invalid tool inputs are kept and gate actions.** Invalid tool-input text
   is now part of the saved draft, kept apart from the typed body, so it
   survives a reload. Until it is fixed or discarded, Save, Run and Apply are
   unavailable.
3. **Unchecked tables make no claim.** A table edited by hand without a
   current check no longer claims a match from its old calculated columns.
   It says "These rows haven't been checked yet."

The probe `scripts/verify_product_companion.mjs` now honours
`PLAYWRIGHT_CHROMIUM_PATH`, like the other scripts. That one-line launch
option is my only change.

| Check at `f68efe5` (fresh database, zero provider calls) | Result |
| --- | --- |
| `pnpm check` | PASS, 81 tests |
| `products-review-regressions.mjs` | PASS, 17/17 |
| Mock browser suite | PASS, 15/15 |
| `scripts/verify_general_integration.py` | PASS |
| `scripts/verify_product_companion.mjs` (320 px panes, real lost ack, exact replay across the two places you can reply, invalid input kept across reload) | PASS |
| Conversation journey | PASS |
