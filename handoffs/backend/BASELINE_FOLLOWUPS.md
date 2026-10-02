# Bounded baseline follow-ups

Accepted review: `e0da95c`; integration/evidence publication: `5ae4cbb`. That PASS remains intact. This follow-up does not rerun the broad accepted suite or claim live product qualification.

## Completed: current model-draft UI assertion

Maintained evaluator commit **`5e887f1480b1b6a006c2aa8f07731d707cbb7208`**, script SHA-256 **`33bcd478b0690501ddd9aa791badc52029e9a4ccb752d8d6d2665c5877f82e0a`**. `scripts/model_draft_browser_probe.mjs` checks **Ready for review** for an unapproved ready artifact, not the historical Saved badge. The original hash-pinned model-proof archive is unchanged; its earlier probe/screenshots remain truthful historical evidence, not the current runner.

Focused actual execution:
- Reproduced the old probe's Saved-versus-Ready-for-review failure on the current UI.
- Ran the new evaluator on desktop (1440px) and mobile (390px), against the **already-retained synthetic operator-imported artifact**. No inference, import replay, fixture computation or dispatcher was started. The exact current revision, body hash and two immutable history entries were unchanged by the browser check.
- The application served production code from `5ae4cbb`; backend/contracts/web/agent/launcher bytes equal those at the evaluator commit. Only the evaluator was new. Node syntax validation and non-loopback/archive-overwrite rejection checks passed.
- Browser access is restricted to same-origin GET/HEAD; no writing or external request occurred. The probe verified explicit operator-imported provenance, protected note, fixture disclosure and no approval claim. New output is separate from historical evidence.

[Verification and hashes](followup-evidence/verification.json), [expected old failure](followup-evidence/legacy-probe-confirmed-red.log), [new exact-evaluator success](followup-evidence/exact-commit-probe-green.log), [browser result](followup-evidence/model-probe/browser.json), [desktop](followup-evidence/model-probe/reopened-model-draft.png), [mobile](followup-evidence/model-probe/reopened-model-draft-mobile.png). Copied logs redact host paths and normalize trailing whitespace. Initial evaluator-runner comparison included the response-only `observed_at` timestamp; correcting that assertion to compare persisted fields is recorded in verification metadata and is not a product mutation.

For an **already running** loopback current UI/API connected to the retained synthetic artifact, from the repository root:

```sh
WORKAGENT_WEB_ORIGIN=http://127.0.0.1:3000 node scripts/model_draft_browser_probe.mjs
```

The default evidence directory is `.local/model-proof-recheck`; override `WORKAGENT_MODEL_PROOF_OUTPUT` if needed. This evaluator does not create or import missing data. A fresh database without the original artifact will correctly fail instead of fabricating success. Use the existing local fixture launcher and retained environment when reopening; do not expose the loopback service publicly.

## Completed: RuntimePort guidance

[Upstream review](upstream/REPORT.md) now explicitly follows the later [runtime access/integration decision](RUNTIME_ACCESS_AUDIT.md#source-review-integration-decision): reuse the existing Workagent broker, context, authority and outbox; **do not build a new fixture-only receipt framework**. Add the smallest adapter with the first authorized real runtime consumer. Source pins/licensing findings remain unchanged. No runtime code, framework, provider dispatch or new feature program was introduced.

## Frontend ownership: UI-1 remains nonblocking

Claude retains “Keep for later” ownership. [Current-base handoff and focused acceptance checks](https://github.com/alindebergASL/Workagent/pull/2#issuecomment-5953182433) request collapse/resume with retained text on desktop/mobile and unchanged ambiguous-request retry behavior. No new frontend commit or response was available when this follow-up was prepared; no competing frontend edits were made. Integrate the returned compatible fix separately after checking its exact head and focused evidence. The coherent accepted baseline remains usable while this nonblocking affordance awaits its owner.

## Recommended next responsibility — not commissioned here

**A bounded private intake next-action responsibility:** the user delegates one set of selected intake records; Workagent's actual worker produces a practical next-action checklist, preserves an explicit human note/edit, handles one requested revision as a proposal, and reopens after a worker/API restart without losing the same responsibility or treating an uncertain acknowledgement as a new submission. The human explicitly accepts the proposed revision. Do not send messages, change a calendar, add a recurring scheduler, or substitute an operator-imported response for actual durable worker execution.

Keep managed-first. The exact missing prerequisites are an authorized **product project and secret reference for the managed runtime**, a confirmed model/API/SDK route, permission for the synthetic sources, a **new bounded inference/spend grant** (including allowed calls/tokens and monetary cap), and agreed trace/retention handling. Local Codex development login is not this entitlement. The earlier Qwen subscription Anthropic-compatible request (`qwen3.8-max-preview`, returned `qwen3.8-max`) proves only historical model access; its one-call allocation is consumed and it has not qualified autonomous tools/session recovery or a fallback. No new access check or inference was attempted in this mission.

Recommendation: separately authorize one managed-runtime responsibility with an initial draft and one revision, constrained to the existing synthetic sources and typed broker, with explicit budget and recovery acceptance criteria. First bind the project/secret reference and cap; do not start a new fixture abstraction or another operator-import proof while that grant is missing. If the managed route later fails a concrete required contract, assess a fallback with that evidence rather than silently changing runtime direction.
