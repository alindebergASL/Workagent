# Workagent product contract

## Current bounded checkpoint and next boundary — 2026-10-08

The bounded adaptive checkpoint is verified at runtime implementation `0e81127`,
with Claude's `ea4e29d` generic-table correction integrated at `65e84c6`.
[Executed evidence and limitations](../handoffs/backend/ADAPTIVE_COMPLETION_CHECKPOINT.md)
separate engineering, usefulness and experience. Continuous workers recovered the
original interrupted run, preserving its response identities, saved human note,
pending approval and cumulative reservations. Run 06 failed in the evidence
harness after recovery, not in application publication; its failed evidence is retained.

[Issue #13](https://github.com/alindebergASL/Workagent/issues/13) remains **OPEN**.
This checkpoint is not flexible work creation or sandboxed HTML delivery.
The next slice is a general structured surface plus an isolated generated
HTML/CSS/scoped-JS view on the same durable work/revision/proposal/action substrate.
The earlier blanket "never generated HTML or script" restriction is superseded;
generated views still receive no ambient credentials, approval authority or
unrestricted API/network access. [Owner contract and next slice](../handoffs/backend/FLEXIBLE_WORK_OWNER_CONTRACT.md)
records the agreed direction, responsibilities, and still-undelivered wire contract.
Memory/learning #10 and portability #11 remain sequenced work, not prerequisites.


Status: active product direction after Andrew's approved course correction.
This replaces narrow product defaults; it does not certify deployed capabilities
or authorize new execution. See `RUNTIME_STATUS.md` for actual state.

## Direction and evidence boundary

Andrew's two product-direction notes are incorporated here and in
`WORK_CONTRACT.md`, `PRODUCT_ACCEPTANCE.md` and `BUILD_PLAN.md`:
- [Independent work and seamless experience](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6018834683).
- [Goal-directed agency and multi-agent coordination](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6019150121).

These are required product capabilities, not optional aspirations or a release
approval. Implemented capability and observed proof must be stated separately.
The reviewed controlled application proves work surfaces and persistence, not
independent intelligence. The initial one-operation model profile is a connection
checkpoint, not a ceiling on the general runtime or a definition of the product.

## Goal-directed agency

The work partner derives goals, priorities, dependencies and observable success
criteria from intent without a required workflow form. It pursues routine subgoals
within standing authority; changing the intended outcome, material priorities or
permissions requires the user's decision. It may notice gaps and propose useful
new goals from permitted context, never infer permission from opportunity.

It chooses a proportionate approach, uses tools, inspects actual results and
adapts its next action to observations. It verifies completion or returns a
specific decision, real blocker or reached limit. Emitting a plan or following a
human-prescribed sequence is not this behavior. Initiative and practical
creativity should produce better work, not unnecessary activity or hidden effects.

When useful, it delegates scoped subgoals to actual specialist agents through the
same runtime, supplies context and success criteria, manages dependencies,
reconciles conflicting findings and checks the combined result. The coordinator
retains outcome ownership; the user should not have to manage agent topology.
Parallelism is optional. Child permissions and shared budgets cannot expand the
parent's authority; cancellation and material human changes reach dependent work.

Ownership persists across runs and interruptions with current context, human
corrections, decisions, dependencies and useful wake/check-in conditions. A saved
conversation, pending run or permanently paused handover is not that ownership.

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

## Seamless default and continuity

The default surface presents useful editable work, meaningful progress, what
changed and a specific decision when needed. Approach, assumptions, sources,
change history and upcoming steps are available on demand. Code, raw tool calls,
traces, model usage, receipts and diagnostics sit in technical inspection.
A visible plan panel is not mandatory. Important uncertainty, incomplete work and
approval consequences remain visible in ordinary language, not hidden with logs.
Stop, redirect and takeover remain accessible where supported; unsupported
ownership must not be presented as running.

Conversation-owned work and pending decisions must be discoverable through Home
and the appropriate existing Space scope, not disappear into a chat. Read the
canonical products/proposals; do not create an assignment per chat or duplicate
business state to populate an overview. Required journey: ask naturally → useful
work → revise from saved context → leave → find the result or decision → reopen
and continue, retaining edits and drafts on desktop and phone.

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

## Current delivery sequence

The active candidate is PR #12 on `hermes/adaptive-product-integration`; PR #9
is the coordination/history entrypoint, not the latest application head. Preserve
Claude's integrated frontend and existing review environments.

The verified bounded M3 checkpoint turns an ordinary goal into useful work, encounters
an observed obstacle, changes approach, verifies a bounded requested result, and
resumes interrupted execution with human edits and effect identities preserved.
Completion evidence is distinct from approval: a verified proposed revision still
needs the person's explicit decision before replacing saved work. Unsupported or
unverified obligations remain partial/needs-validation. No required user-authored
test specification and no model-generated examples promoted into proof.

Run existing local/model workers continuously in isolated review state; manual
operator ticks are not the demonstrated user journey. General conversation,
tables and runnable tools remain supported; a narrow verified task is an honest
first completion capability, not the product's identity.

Memory/learning [#10](https://github.com/alindebergASL/Workagent/issues/10) and
portability [#11](https://github.com/alindebergASL/Workagent/issues/11) follow this
slice. Workagent owns durable work; provider persistence is optional capability,
not canonical memory. Their full backlogs are not prerequisites for M3.

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
