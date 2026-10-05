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

1. **Replying from beside the work.** The product page shows the
   conversation but sends you back to it to reply. That keeps the existing
   recovery-safe command handling.
2. **Tool inputs.** They are edited as comma-separated labels and values,
   then applied. A per-field form would be kinder.
3. **Controlled replies.** Their text is still the backend's
   controlled-transport wording.
4. **Operation choice.** Choosing CSV reconcile or Wasm is explicit; the
   agent doesn't decide.
