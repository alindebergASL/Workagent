# Frontend B1: real source-free conversation

Base: Hermes' B1 candidate `9a8944b`, merged without conflicts (`05c1f65`).

| Commit | Contents | Evidence run |
| --- | --- | --- |
| `793ad09` | UI code | Canonical demo and conversation journey |
| `c2f3096` | Checkpoint script only; app code identical to `793ad09` | Checkpoint |

Only `web/` and `handoffs/frontend/` change. The UI uses the generated
client fields in `handoffs/backend/GENERAL_CONVERSATION_CONTRACT.md`.

## What a person can do (actual API and PostgreSQL)

- **Talk from Home without choosing anything.** **Send** is two commands:
  1. Create the conversation, titled from the first message.
  2. Send the message, compare-and-swap on the version just returned.

  Each command is frozen and replayed exactly if its outcome is uncertain.
  The Home draft is cleared only after the message is admitted.
- **See each turn as it actually stands.** The state comes from the
  persisted run:

  | Run state | UI state |
  | --- | --- |
  | queued | Waiting for a reply |
  | running | Replying… |
  | ready, with a recorded assistant message | Replied |
  | ready, without an assistant message | No reply was recorded |
  | cancelled | Stopped before a reply (the message is kept) |

  - Queued is never shown as success.
  - A controlled-transport reply carries a **Test reply** label. The
    explanation is in "About these replies".
- **Continue and steer.**
  - Follow-ups use the version the person saw.
  - A stale version keeps the text and writes nothing.
  - Sending while a turn is unfinished says plainly that it replaces that
    reply; the backend stops that turn.
  - Drafts survive a reload.
- **Hand over explicitly.** *Take it from here* asks what to carry forward
  and *Done when*, then records the paused, linked assignment.
  - It reads **Handed over · not started**.
  - It offers Stop, never Resume, and links back to its conversation.
  - It is never listed under *I'm handling*.
  - From Home without context, *Take it from here* starts the conversation
    and opens this step.
- **End a conversation.** Ending keeps its history. There is also a
  Conversations list and a nav entry.
- **Mock mode.** The mock service has no conversation, so it still says it
  can't reply. Intake work with chosen context is unchanged.

## Evidence

| Check | Commit | Result |
| --- | --- | --- |
| `pnpm check` | `793ad09` | PASS, 48 tests (includes the turn mapping on the generated example) |
| Mock browser suite (desktop / phone / 320 px) | `793ad09` | PASS, 15/15 |
| Canonical real demo, fresh DB (intake regressions on the merged backend) | `793ad09` | PASS |
| Fault regressions | `793ad09` | PASS, 9/9 |
| `web/scripts/conversation_evidence.py`, fresh DB | `793ad09` | PASS |
| `web/scripts/reset_checkpoint.py`, on the demo DB | `c2f3096` | PASS |

`conversation_evidence.py` drives the UI and advances turns only through
`workagent.general_worker --controlled`. It made four batches, each with 1
completed, 0 deferred and 0 denied, and zero provider calls. Its recorded run
states are `ready, cancelled, ready`. Captures are in
`evidence/b1-conversation/`; the refreshed checkpoint captures are in
`evidence/reset-cp1/`.

## Verdicts

| Verdict | Result | Basis |
| --- | --- | --- |
| Engineering | PASS for B1 wiring | Checks above; controlled transport only |
| Usefulness | NOT TESTED | Replies are wiring receipts, not a model's answer |
| Experience | NOT TESTED by a person | My inspection only |

## Gaps

1. **Turns don't advance on their own locally.** No local server advances
   turns automatically, so a turn waits until the controlled batch runs. The
   UI shows *Waiting for a reply*, which is accurate.
2. **No unavailable or failed turn projection.** Hermes has listed this as in
   progress. Until it lands, a turn that can never run would read as waiting.
3. **No list previews.** The list shows the title (taken from the first
   message), its state and the start time.
4. **Delegation only records.** It can't start, resume or check in, and
   *Done when* is required.
5. **Context is fixed at creation.** Context chosen on Home is sent when the
   conversation is created. There is no way to add context later.
6. **No B2/B3 products yet.** There are no table, file or tool products,
   downloads, edits or runs.

## Follow-ups at `494a97c` (frontend only, no new backend)

- **Activity.** Work and conversations grouped by day, each showing its
  latest recorded change. With no event-history route, it doesn't invent
  intermediate steps, and the page says so.
- **Starters.** "Think something through" and "Take something off my plate"
  only begin the message. The intake example stays as a quieter option.
- **Spaces.** The Space uses the same column as Home, with Work /
  Conversations / Context tabs. Record IDs are in details.
- **Quieter drafting cue.** The full-width "revision is being drafted" banner
  is now a quiet status in the document's header bar. Phones still see it
  after a send.
- **Honest Home lede.** Home no longer invites resuming a recorded hand-over.
- **Phone nav.** All four destinations stay on one line down to 320 px.
- **Mock e2e race fixed.** Unrouting just as the next page fired its first
  read left that read unanswered about 1 run in 8. Handlers now stay
  installed and pass through: 12/12 repeats, then the full suite twice.

| Check at `494a97c` | Result |
| --- | --- |
| `pnpm check` | PASS, 52 tests |
| Mock browser suite | PASS, 15/15 |
| Canonical demo (fresh DB) | PASS |
| Fault regressions | PASS, 9/9 |
| Conversation journey (fresh DB; now also starters, Activity, Space conversations, 320 px) | PASS |
| Reset checkpoint | PASS |

Evidence images in `evidence/b1-conversation/` and `evidence/reset-cp1/` were
refreshed from these runs.
