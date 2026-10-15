# Intelligent UI: the bar and a proposed presentation seam

Status: **proposal for agreement with Hermes. No code yet.** Hermes's standing
instruction is to hold new feature scope and send defect fixes only. This document
does not change that, and it grants no permissions, budget, merge or deployment.

## The bar (Andrew, 15 October 2026)

> This needs to be at least the same as, and better than, Muse, GPT dots and
> Grok bot. That is the bar. With a work and getting-things-done focus.

This raises the target set in `docs/PRODUCT_CONTRACT.md` ("Adaptive, intelligent
UI") and issue #15. It does not change how claims are made: #15 still requires
comparable tasks to be observed in those products before any "as good as" or
"better than" claim. Until then, parity and superiority are targets with the
verdict **NOT TESTED**.

### What the reference products do (public reporting, October 2026)

Secondary sources only. Details are to be confirmed before any comparison test.

| Product | Reported capability | Relevance |
| --- | --- | --- |
| Meta **Muse** (8 Sep) | Personal agent acting for the user: shopping, tickets, scheduling. Own cloud VM and browser, so it keeps working after the app closes. Connects email, calendar and payments. Asks before sensitive actions. | Persistent execution; approval before effects. |
| OpenAI **dots** (29 Sep) | Always-on ChatGPT agents. Each has its own computer and browser, a persistent goal, memory and connected apps (4,000+). Reachable in ChatGPT, SMS, Slack, Teams and by phone. | Durable ownership; many channels and connectors. |
| ChatGPT **Intelligent UI** (7 Oct) | Answers combine text with interactive charts, forms, calculators, diagrams and buttons. Rendered progressively from a native component library while the answer streams. OpenAI says its design judgment still needs work. | The direct reference for Workagent's adaptive UI. |
| xAI **Grok Bot** (beta, Aug) | Named, persistent "coworker" bots, each with its own computer (browser, files, terminal). 2–6 bots in a group chat, @-mention handoffs, reusable saved skills, schedules, connectors and MCP. Desktop and mobile. | Specialist coordination; reusable skills; schedules. |

### Where Workagent must match them

1. **Answer shape:** text, charts, comparisons, forms, calculators and real buttons
   in the answer itself, chosen without being asked. This is the Intelligent UI baseline.
2. **Progressive rendering** that never moves the person's place or loses input.
3. **Persistent ownership** that keeps going when the app is closed, with a clear
   approval before consequential effects. This covers Muse, dots and Grok Bot.
4. **Reach:** connectors, and channels beyond the web app (dots, Grok Bot).
5. **Specialists and reusable skills** (Grok Bot; Workagent's #10 and M4).

Items 3–5 are Hermes runtime scope and need Andrew's authority decisions
(connectors, external effects, channels). Workagent has none of 4 today and only
bounded versions of 3 and 5. These must stay visible as gaps rather than being
hidden behind UI work.

### Where Workagent should be better: work and getting things done

These are the differentiators to design and test for. Each builds on something
the product already has:

- **One authoritative work model.** What the person sees in an answer, on the
  work page and in conversation is the same saved work, at an exact version.
  Generated answers elsewhere are usually disconnected snapshots.
- **Human edits are protected.** The agent proposes; the person applies or
  dismisses. Proposals made for an outdated version are refused, never applied
  silently.
- **Real controls only.** A button exists only when a real, authorized command
  sits behind it, bound to the exact version it acts on. A lost acknowledgement
  replays the same command; unknown outcomes are said as unknown.
- **"What needs me / what are you handling".** Projects (Spaces), decisions and
  responsibilities are read from records, not inferred from chat text.
- **Meaningful completion.** Prepared, approved, delivered and achieved are kept
  distinct (#15).
- **Proportion.** A simple question gets a simple answer. Rich UI is only used
  when it saves effort, and is measured by effort saved, not by layout count.

## Gap in the current product (frontend view)

The agent can choose only four kinds of decision: a text reply, publishing saved
work (document, table or sandboxed interactive view), running a tool or
reconciling a CSV, and recording a responsibility. This leaves four gaps:

1. **No presentation contract.** There is no typed way to say "show a comparison",
   "chart this", "ask for these inputs" or "offer this action" inside a reply.
2. **Rich means saved.** Anything beyond text becomes an artifact. This conflicts
   with "temporary exploration stays lightweight".
3. **Generated code is the only route to visuals.** The sandboxed custom view
   (model-written HTML/JS) is the only way to get one. The direction says this
   must not be the only flexible path.
4. **No actions in answers.** Real controls exist only on work pages and in the
   Space pane.

## Proposed seam: reply parts (v1)

A reply may carry an ordered list of typed **parts** alongside its text. This is
a small extension of the existing `reply` decision, not a new agent, store or
registry.

- **Validation:** every part is checked server-side.
- **Fallback:** every part carries a plain-text `fallback`, which is shown for
  unknown types and in non-web channels.
- **Persistence:** parts are **temporary by default**. "Keep this" saves a part
  through the existing publish/save commands.

| Part | Content (sketch) | Notes |
| --- | --- | --- |
| `comparison` | `items[]`, `attributes[]`, cell values, optional `recommendation` with reason | A table with the recommendation highlighted. Becomes a structured table if kept. |
| `chart` | `kind` (bar, line, stacked, scatter), `series` given inline **or** bound to `ExactTarget` table fields | A bound chart reads the saved table at that version and says when it is outdated. |
| `inputs` | `fields[]` (reuses the `FormField` shape), purpose, `submit` → a new message carrying the values | For bundling the questions the agent needs answered. Values go back through the normal message command. |
| `adjustable` | `inputs[]` plus a reference to an existing tool and its revision | Recalculates through the existing tool-run command, never in client code. Results are labelled as calculated. |
| `work` | `ExactTarget`, a one-line summary | A card for saved work, with Open / Review. Shows outdated or unavailable from the current read. |
| `action` | `operation` (an existing command: apply or dismiss a proposal, run a tool, record or steer a responsibility, start a Space), its exact target, and a confirmation label | Shown only when the server marks the operation available for this person and version. Otherwise it shows the reason ("not available: …"). It uses the existing command endpoints and replay identity. |

### Who does what

- **Runtime (Hermes):**
  - extend `Reply` with optional `parts`;
  - validate types, sizes and targets;
  - for each `action`, attach a server-computed `availability`
    (available / unavailable + reason / needs confirmation), re-evaluated on read
    and never trusted from model output;
  - publish exact generated types.
- **Frontend (Claude):**
  - one accessible component per part, with consistent focus, keyboard, loading,
    error and recovery semantics;
  - progressive rendering as parts arrive, without moving the person's place or
    their drafts;
  - "Keep this";
  - text fallback for unknown types;
  - work on phone at 390 and 320 px;
  - each control calls the existing command adapters.
- **Not proposed:** a free-form generated UI language, a component registry
  framework, or client-side authoritative state. The sandboxed custom view stays
  available for justified custom experiences.

### Order (each step with failing tests first, then evidence)

1. Agree this seam and its exact payloads (documents only).
2. `comparison`, `chart` (inline data), `work` and fallback: answers that are
   easier to understand.
3. `action` with server availability: real controls in answers, both directions
   of change, stale versions, revoked permission, lost acknowledgement.
4. `inputs` and `adjustable`: forms and calculators through existing tools.
5. Comparison against the reference products on the same work tasks (#15 method),
   recording effort, corrections, navigation and successful authorized actions.
   No superiority claim without it.

## Acceptance mapping

Steps 2–5 are tested against `PRODUCT_ACCEPTANCE.md` "Adaptive, intelligent UI":
proportionate selection, real actions on one truth, stable interaction,
appropriate continuity and practical value.

The bar adds one check per reference product: a short task list each product is
known to handle, run in Workagent with the same inputs, with the verdict recorded
as parity / better / worse / NOT TESTED. A verdict counts only once the same tasks
have actually been run in that product.
