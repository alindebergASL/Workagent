# Agent-first product integration

Base: `hermes/s0-s1-build` at `6f88a9d524d4ab7db1f800087d2f13f4ca1d130b`.
Branch: `codex/agent-first-product`. This isolated change does not replace either owner's branch.

## Implemented

- Agent-first Home uses the existing domain API for authorized sources, assignment creation, progress, and persisted outcomes. Existing stable command IDs and ambiguous-write retry behavior remain intact.
- One attention surface is derived from assignment/proposal state. A review opens the exact artifact needing a decision; completed work does not retain an in-progress call to action.
- Spaces exposes the existing personal workspace and its actual assignments. It does not invent shared-workspace creation or invitations.
- The existing saved artifact, edit, immutable revision, proposal comparison, human acceptance, history, and source flows remain connected to their existing service operations.
- Read mode places revision requests alongside the artifact on desktop. Narrow layouts open Work first and retain mounted Work / Ask for revision panes, preserving draft inputs when switching.
- Cool white/graphite/blue shell follows the approved design direction. Both light and dark appearances are supported.

## Verification

Executed here: TypeScript check, ESLint, production Next build, 12 unit tests (including state-transition and exact-review-link cases).
Not executed here: real browser/API/PostgreSQL restart journey; this executor has no PostgreSQL installation. Hermes' baseline evidence is not evidence for the changed frontend. Run the existing domain journey against this candidate on the provisioned host before acceptance. Adapt brittle heading/selectors to the new Home, without weakening assertions on saved bodies, conflict retention, source authority, or restart.

## Exact remaining work

1. Claude Code: exercise new Home → context → create → artifact edit/save → request revision → compare/accept → reopen; verify phone-width pane switching and keyboard use. Continue production UI from this source, not copied HTML mockup state.
2. Hermes: run existing real API/PostgreSQL journey against this candidate. Existing domain adapter and backend files were not changed.
3. Live runtime remains blocked on the authorized project/secret reference and bounded spend grant identified in `docs/RUNTIME_STATUS.md`. No credentials were inferred, no paid calls were made, and no fixture execution is presented as live model work. Do not send secret values through chat or commit them.
4. Once runtime access is supplied, establish one real model-backed responsibility with actual completion evidence, human revision, and same-responsibility recovery. Then add communication/calendar integrations and shared Spaces incrementally. Those capabilities are not implemented by this UI change.

The hosted Sites preview remains a separate scripted design reference. This branch is application code and is not deployed to that public Site. Preserve the loopback-only local identity until production authentication is implemented.
