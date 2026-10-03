# Workagent product contract

Status: active product direction after Andrew's approved course correction.
This replaces narrow product defaults; it does not certify deployed capabilities
or authorize new execution. See `RUNTIME_STATUS.md` for actual state.

## Product promise

Workagent is a general, persistent work partner that helps a person and their
team think, make, handle, coordinate, own and learn from work. It understands
intent, uses permitted context, creates the appropriate work surface, carries
responsibilities forward, and brings back outcomes or specific decisions.
Research and briefing support that work; they are not its identity.

Ordinary conversation is useful immediately. The user may work together with
the agent or say “Take it from here.” A task, Space, source selection or approval
form is not a prerequisite for talking. Durable ownership begins when something
needs continuing work, not on every message.

## Experience

- Home answers “What needs me?” and “What are you handling?” with timely
  decisions, meaningful progress and outcomes. Empty Home is calm, not filler.
- Conversation stays accessible beside actual work: documents, tables, files,
  runnable tools and other capability surfaces. Chat alone is insufficient;
  an intake form beside a document is insufficient too.
- Optional Spaces organize any body of work. Private/shared boundaries are
  explicit. The agent proposes a Space when useful; the user need not create
  one to begin. Membership changes and private material exposure need authority.
- “I'm handling” shows owned responsibilities, dependencies, next check-in and
  how to steer, pause, cancel or take over. A saved chat is not ownership.
- Edits, steering and permitted context persist. The agent uses human changes,
  makes material proposed changes reviewable, and never silently overwrites them.
  Memory can be inspected, corrected and forgotten; it has provenance and scope.
- Proactivity follows relevant events and commitments. Notify for useful changes
  or decisions, not each internal step. Routine work may use a standing permission;
  consequential decisions have specific approval.

## Design standard

Use the approved [prototype](https://workagent-design-preview.alindeberg.chatgpt.site)
as the visual starting point. Improve it through real behavior, clean hierarchy,
readable density and continuity. Establish shared spacing, typography, card,
navigation and responsive rules rather than polishing one screenshot.

Conversation and current work determine layout. One dominant task or decision
leads; secondary information is quiet. Cards represent distinct things the user
can understand or act on. Avoid walls of generated paragraphs, repeated
disclaimers, dashboards without meaningful data and scattered status tiles.
Use ordinary words. Revision IDs, grants, fences, receipts, provider attempts,
traces and cost accounting belong in inspectable details, not primary copy.
Show a plain explanation when uncertainty or permission affects the user.

On a phone, preserve work/conversation drafts across pane changes. Editing,
keyboard use, focus, loading, errors and recovery are part of the product.
“Better than prototype” means less effort and more reliable work; it does not
justify delaying functional proof indefinitely.

## Scope discipline

The next implementation slice is small, but common contracts must admit varied
work. A slice may disable tools; it cannot redefine every assignment as source
analysis, every output as a plan/checklist, every outcome as document approval,
or every responsibility as one initial call and one revision.

Capability and permission are separate. Keep private work, team context and
external actions scoped. Do not make the user administer the runtime to get
ordinary value. Failure preserves work, explains uncertainty and offers a next step.

Andrew's private work is the initial user context. Team-ready boundaries are
designed now; shared invitations, production authentication and connectors are
incremental capabilities, not current readiness claims. Useful exports and
portable execution matter: work should not be trapped in one chat or provider.

## Drift prevention

1. Current entrypoints replace stale product instructions, including “no redesign.”
2. General work primitives are separate from capability profiles and grants.
3. Acceptance spans different work shapes through the same worker, with independent
   engineering, usefulness and experience verdicts.
4. PRs identify the user outcome, breadth regression and remaining limitations.
5. Both owners inspect the integrated journey; Andrew judges usefulness and release.

These controls reduce drift; they cannot guarantee it. A paper contract, scripted
demo or passing backend tests cannot substitute for the actual experience.
