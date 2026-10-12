# Native editable continuation — reviewable result

## Outcome

**The bounded live continuation journey passed:** an ordinary goal produced useful editable work; the operator made a human edit; a natural follow-up proposed a revision of that same canonical work; the operator inspected and accepted it through trusted UI controls; the accepted revision and complete human-edited block survived reopening and service restart.

This is not universal agent reliability, completed-event validation, or Andrew's product sign-off. Both model runs retain `partial/needs_validation`; turn projections retain `failed`. Accepting a revision does not certify the entire goal. The earlier misconfigured attempt remains **PARTIAL/HOLD** in its original evidence directory.

## Exact identity and changes

- Live-tested application: `4186d337a5d3b225fc257dda02b9d18bb10ab63e`.
- Development-branch closeout: `fee03449b5d62c30224877851402867dcdb5c6d8`; only `docs/RUNTIME_STATUS.md` differs from the live-tested commit.
- New implementation: `scripts/verify_native_admission.py` and `scripts/verify_native_target.mjs`, an executable production-build/native-target preflight. It rejects the disabled build before admission; the positive control verifies the actual admitted message, exact target, complete saved body and canonical context hash without a model transport.
- Backend, web, contracts and migrations are unchanged from `dd01cd49a9b026edf8a99281d182e0554d54f4e2`. Reused prior full gates are **792 backend / 170 frontend tests** plus type/lint/format/build, not relabeled as new executions.
- Claude-owned shell work `dff730277c75e789bdc3b242f295e8270f7e7cf6` remains integrated. No competing frontend changes. The bounded reviewer found an existing P2 in `TurnProgress.tsx`: an empty set of model-example checks is described as failed checks. A concrete narrow correction was sent to an isolated Claude CLI worktree; the invocation failed with **“OAuth session expired and could not be refreshed.”** No frontend edit resulted. The handoff and failure receipt are retained; a GitHub comment is not counted as waking Claude.
- Production bundle `iaKQHcHGIn8V1TbkNONjy`, built with `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1` and `/api/domain`. Reused because executable app code is identical; no claim of a new build for documentation changes.
- Exact live-head CI: [38285714764](https://github.com/alindebergASL/Workagent/actions/runs/38285714764). The evidence package records the closeout-head CI separately.

## What actually happened

The initial goal concerned a synthetic volunteer orientation. It supplied times, available people and unresolved access needs, not an artifact type, expected answer or output. The **native homepage composer** created a new empty conversation. Its initial message request was briefly paused while the canonical operator seams attached that empty ID to the new bounded grant; the untouched native request was then admitted. No response, output or conversation content was fabricated or seeded.

The live agent chose a document containing a running order, readiness checklist, open decisions and preserved context. Through its ordinary editor, the operator appended:

> Human note: keep the east entrance and its approach clear for step-free access.

The full human-context block, including its new line break, and all other blocks were verified against the saved revision. The artifact-page conversation surface then received the natural follow-up that Mateo must leave at 15:00, while protecting the opening briefing and final 15 minutes.

This time, the native request contained the exact artifact, human revision and body hash. The agent produced **one pending proposal for the same document**. It retained the human-edited block exactly, added a clear historical/current-availability distinction, and explained the real feasibility constraint: 40 minutes after the briefing cannot fit two 25-minute tours with Mateo. A suitably qualified replacement guide is a decision to confirm, not an invented commitment.

The operator opened **See the proposed version**, inspected its change explanation and note, and clicked **Apply proposed version** in the phone layout. HTTP 200 and canonical readback confirmed acceptance. No second artifact or read-only view substituted for the requested revision.

### Before / after / restart identities

- Conversation: `cf457e1d-0590-4dea-9287-279413eefa9c`.
- Canonical artifact: `54f1ff77-d3c1-43f1-8416-69338e415089` throughout.
- Initial revision: `a2f6dd42-ab3a-40b6-ab81-43d4ede155d1`.
- Human-saved revision: `5393b8b7-1bff-45e3-8ef5-4f24e94efe3b`, hash `f2b6848c19c22731cf29a03f70accdd4639f243b6fbec7d61f96016b15fa5823`.
- Accepted proposal: `aced3518-25c1-4cd7-a152-efa2c56ab2b7`.
- Accepted revision: `cd06942f-1a32-409a-b186-13900632970c`, hash `aae632c58fe85550e12acb53419254dece7c841d5d1fb4026792a2775f71a41a`.

Home → Conversations → the actual conversation → work succeeded before restart. API and web processes were then stopped and restarted. Fresh browser contexts at **1440, 390 and 320px** repeated that navigation and verified the complete accepted body, exact human note, absent pending-acceptance button and visible ordinary reply surface. No horizontal overflow, page errors or write requests occurred during the restart verification. The model consumer stayed stopped.

## Separate verdicts and limits

- **Engineering — bounded continuation PASS:** exact-target admission, canonical proposal/acceptance, human-edit preservation and durable restart demonstrated. New regression negative/positive controls and 29 helper tests passed. Prior unchanged app gates reused. Independent review accompanies the evidence; it is not another exhaustive architecture review.
- **Usefulness — contained PASS:** a proportionate run sheet and meaningful change/decision explanation, without a prescribed artifact sequence. The remaining staffing, access, date and route decisions are explicit; accepting the plan does not resolve them.
- **Experience — usable, P2 open; not cleared:** actual desktop/phone paths support ordinary editing, proposal review/acceptance, finding the result and continuing. However, expanded **How this ran** falsely says “Model examples did not pass” for `checks: []`. Missing validation is not demonstrated failure. The frontend owner should show “No model examples were checked” (or omit that sentence), with an empty/passing/failing presentation regression. Claude execution is blocked by expired OAuth; restoring that owner session is the concrete remaining boundary. No additional live model allowance is needed for this correction. Long documents also require substantial scrolling; no visual-direction redesign or polish expansion was undertaken.

This proves one fresh document continuation and one meaningful human edit. Earlier calculator breadth remains explicitly controlled replay; this mission did not spend extra model calls on breadth. No additional live failure/replacement occurred. The browser-harness read during navigation briefly encountered a null document body; it performed no write and was corrected by waiting for the page, not by resending a model request.

## Model use and remaining authority

Previously approved official `gpt-6.1-sol` route, same consumer hash `75e487d7c1dd53ba50c15515fa92793ad2edf22dd259f3ec99841019a5653c12`. New grant `workagent-continuation-native-02` was scoped to one fresh conversation, **two runs**, and **at most two selection steps per run**. All prior grants/history, carry, reservations and unresolved liabilities were preserved via append-only snapshot checks and canonical predecessor revoke/readback.

Actual new usage: **two turns, four generation dispatches** (one selection plus one final per turn), four count operations and 36 reads. Reported token deltas: 43,694 input / 4,962 output. New reservation: **$0.52768**; cumulative **$5.93640/$20**, including unchanged **$3.42992 carry**. These are conservative reservations, not billing. Monetary headroom is **$14.06360**, but **no additional live-run allowance remains**. The earlier criteria count-only unknown is still unresolved; no new unresolved provider operation was found. Consumer stopped; no provider restart during persistence checks.

## Andrew's working review location

[Open the accepted work](http://127.0.0.1:3166/conversations/cf457e1d-0590-4dea-9287-279413eefa9c/artifacts/54f1ff77-d3c1-43f1-8416-69338e415089)

**Availability:** host-loopback development review only, not a public URL or deployment. API/web are left running after verified restart. From another computer, use SSH access to this agent host and a local port forward: `ssh -N -L 3166:127.0.0.1:3166 <your-existing-SSH-target-for-this-agent-host>`. Then open the link locally. No new SSH identity, credential or public exposure is assumed. Saved state remains in PostgreSQL if those review processes stop.

Short walkthrough:
1. Open **Conversations**, choose the volunteer-orientation conversation, then its run sheet.
2. Read the revised opening and **What changes** paragraph. Note the unconfirmed replacement-guide decision and protected times.
3. Scroll to the human-context block: the east-entrance reminder is still there, with an adjacent explanation that Mateo's latest availability supersedes the historical context.
4. Open **Saved history** to inspect revisions. The proposal is already accepted under this synthetic-test authorization; no Apply button should remain.
5. On phone, use **Work / Conversation** to switch between the result and its ordinary reply surface. Human editing is available; further model execution is stopped and requires a specific additional allowance.

No default-branch merge or deployment. #13 stays open for broader unmet requirements and Andrew's product/experience judgment. The concrete continuation blocker from the earlier misconfigured proof is now resolved by new live evidence—not by rewriting the old result.
