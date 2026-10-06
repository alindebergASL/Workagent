# Private intake next-action responsibility — implementation mission

> **Historical intake mission — superseded as active product direction.**
> Its engineering slice is recorded in `INTAKE_ACCEPTANCE.md`.
> Managed-first/no-provider-call/no-redesign statements below describe earlier
> checkpoints; they are not current state or future product restrictions.
> Follow `../../docs/PRODUCT_CONTRACT.md`, `../../docs/BUILD_PLAN.md` and
> `../PRODUCT_RESET.md` for new work. Preserve historical evidence and actual
> execution constraints; no new live grant is implied.

Accepted baseline: `5f3de09a820de78e96d2d0b497080e50124d1b60`. Ref inspection found both shared development refs still there; unrelated untracked review evidence is preserved in its original worktree. New isolated implementation branch: `hermes/intake-next-action`.

## Authority and ownership

Andrew authorizes backend/runtime/integration implementation, non-default pushes, contract/documentation updates and relevant no-inference local/database/browser/CI verification. Claude's existing frontend session retains `web/` ownership. Hermes integrates. No default merge, deployment, destructive history/data changes, external customer messages or new spending. Product inference requires a new explicit bounded grant; historical Qwen access/import authority does not qualify this slice. No credentials in chat/source/evidence.

## Observable responsibility

User intent: “Handle this intake. Work out the next move, prepare it, and ask me where my judgment is needed.”

1. Durable product worker reads only explicitly permitted workspace context through scoped tools, loads the reviewed skill bundle, and prepares a useful next-action document with specific missing information and judgment needed.
2. Initial preparation and later revision produce actual durable run/artifact/proposal records. Human edits survive; revision is inspectable and acceptance binds the exact reviewed base/body.
3. Existing domain authority carries an explicitly accepted proposal into a saved revision. Bounded readback establishes the result, not model prose or HTTP success.
4. Restart and duplicate delivery recover the same responsibility without duplicate local committed work. Persist provider-attempt identity before dispatch. Unknown provider outcome remains unknown and reconciles read-only; no silent inference redispatch or claim of provider exactly-once.
5. Home, Spaces and work surface consume consistent authoritative outcomes/provenance. Prepared next action is not performed underlying work.

## Runtime selection and live gate

Managed-first candidate remains OpenAI Agents API (`environment.type=none`, narrowly scoped application functions, managed session/turn lifecycle). Official API/SDK/model/budget/retention contract research is in progress. Documentation is not account entitlement. Presence-only inspection found no Workagent/OpenAI project API credential in process variables or the known Workagent env files; local development login is not product entitlement. One concrete route and grant request will bind project/secure secret reference, actual API/model, scenario count, token/cost/call ceilings, synthetic data and trace retention. No provider calls have been made.

Implement compatible domain/attempt/outcome changes and deterministic tests while research/grant is pending; do not invent unsupported provider fields or replace managed-first silently.

## Incident-Arena application

Read https://arxiv.org/html/2610.00648v1 §3.3 and §5.2. Apply two independent gates: outcome (actual artifact/revision agrees with readback) and safety (survives interruption/repeated delivery, preserves edits, current source permission and exact approval). Agent proposes completion; task-specific deterministic checks establish machine-verifiable conditions and reject plausible false completion. Independent content review assesses usefulness separately. After required conditions hold, use bounded read-only verification and stop modifying. Waiting/unknown/unverified must remain truthful.

## Work sequence

- Backend/domain: additive migration for durable attempts and bounded grants, exact run provenance, authoritative outcome/readback; preserve existing broker/domain/outbox/fence authority. Tests first for attempt ambiguity and false-completion rejection.
- Runtime: smallest concrete managed consumer against verified official contract; no second model loop, shell tools or unrelated framework. Disable automatic mutation retries, persist attempt before side effects, enforce budget and current authority for every source/tool continuation.
- Frontend: Claude-owned focused state/provenance/decision presentation using generated contracts; preserve accessible agent, generous space and document-first mobile; no redesign.
- Verification: deterministic PostgreSQL/provider-transport contract tests clearly labeled non-live; real browser desktop/mobile, independent review, exact-SHA CI. Live scenarios only after explicit bounded grant.
- Report implementation readiness separately from live verification, exact tested SHAs, execution/usage provenance and remaining limitations.
