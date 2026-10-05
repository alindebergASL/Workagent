# Frontend reset checkpoint 1

Base: Hermes' installed reset `b76eef8` (fast-forwarded, not reapplied).
Code: `1d648af` on `claude/workagent-frontend-kyg51x`. Only `web/` and this
handoff change; backend, contracts and pinned bundles are untouched.

## What a person can now do (actual service)

- **Home.** Write anything without choosing sources first.
  - **Send:** says plainly that conversation isn't connected yet. Nothing is
    sent, and the text is kept, including across a reload.
  - **Take it from here:** the explicit delegation, through the real
    `CreateAssignment`. It asks for context only because the deployed schema
    still requires one source.
  - Home shows one timely decision, then *I'm handling*, *Ready for you* and
    *Done*, all from recorded state.
- **Responsibility.** *Ownership at a glance* covers I own, Waiting on, You
  own and Done when, from recorded state only.
  - **Pause, Resume and Stop:** use the existing control endpoint, with
    compare-and-swap on the work version the person saw. An unconfirmed send
    replays its exact command. A stale version shows the current state and
    never overrides it.
- **Work beside conversation.** The document has a persistent conversation
  built only from records: the request, what was saved, each ask (the
  proposal's recorded instruction) with its outcome, and the person's own
  edits.
  - The composer is always present; the unsent text survives pane switches
    and reloads.
  - On phones the toggle reads Work / Conversation, and both panes stay
    mounted.
  - How the work was prepared is in details.
- **Foundations.** Shared spacing, type, radius, card, conversation and
  ownership rules are in `web/src/styles/foundations.css`.

## Evidence

The `evidence/reset-cp1/` captures come from `web/scripts/reset_checkpoint.py`
on the database retained by the canonical demo: real API, PostgreSQL and web,
with no dispatcher and zero provider calls. They include desktop and phone
captures and five prototype/app side-by-side images.

`result.json` records each control state read back from the API:
`queued → paused → queued → cancelled`.

| Check at `1d648af`, clean tree | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, format, unit) | PASS, 44 tests |
| Mock browser suite (desktop / phone / 320 px) | PASS, 15/15 |
| Canonical real demo, fresh DB (delegation incl. lost 202, edit, phone proposal, approval, restart reopen) | PASS |
| Fault regressions | PASS, 9/9 |
| Reset checkpoint script (above) | PASS |

## Verdicts

| Verdict | Result | Basis |
| --- | --- | --- |
| Engineering | PASS for this checkpoint's scope | Checks above; fixture compute only |
| Usefulness | NOT TESTED | No general conversation exists yet; every saved result is fixture/intake work |
| Experience | NOT TESTED by a person | My inspection only; side-by-side images are for review |

## Contract gaps (blocking real behaviour, not UI)

1. **No conversation routes.** Create, send, list and get, with an agent turn
   state (`queued | responding | replied | failed | unavailable |
   outcome_unknown`). B1 and any reply are blocked. The client switch is
   `web/src/lib/client/capabilities.ts`.
2. **`CreateAssignment` requires ≥1 source and ≥1 completion criterion.**
   - Delegation without context is impossible.
   - A neutral criterion is sent in place of the old plan/checklist one.
   - Needed: 0..n context and optional success conditions, plus
     `conversation_id`.
3. **No conversation link on assignments.** Agent turns in the thread are
   recorded outcomes, not messages.
4. **Lifecycle is only `queued | running | ready | partial | paused |
   cancelled`.**
   - Missing: waiting on a person or event, completed vs failed,
     `next_check_in`, and owned / waiting_on / person_owns.
   - Ownership lines are derived from the phase, and *Next check-in* is
     omitted.
5. **No redirect.** Steering is limited to pause, resume and cancel.
6. **Products are document-only.** The kind is inferred from the title, so
   there are no table, file or tool surfaces (B2/B3).
7. **Decisions cover document revisions only.** There is no scope,
   consequences or alternatives for other actions.
8. **No attachment or upload route.** The prototype's "+ Add" and Voice are
   not shown.

The requested shapes are on PR #5 (5964465286, 5964491675) and match Hermes'
proposed interface (5964471747). I'll wire them when the generated client
lands.

## Known UI follow-ups (mine)

- Activity and Conversations are not in navigation; there is no data source
  yet.
- The Spaces page isn't restyled yet.
- The "revision is being drafted" banner repeats the thread.
- The quick prompt is still the intake example.
