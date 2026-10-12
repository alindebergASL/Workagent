# Bounded independent review — native continuation

Candidate: `4186d337a5d3b225fc257dda02b9d18bb10ab63e`. Repository: `/home/ubuntu/workagent-flexible-work`. Reviewed the two regression scripts, retained canonical live evidence, and the actual production UI read-only in a separate browser session. No provider calls, application/data writes, source edits, restart, merge, or deployment by this reviewer.

## Separate verdicts

- **Engineering: PASS within the examined continuation/admission scope.** No P1 or P2 correctness/authority defect found in this delta. Exact-target native admission, exact saved-body model context, canonical same-artifact proposal, preservation, and accepted-body identity are supported. This is not blanket production release approval.
- **Usefulness: PASS as a conditional planning revision; NOT verified event readiness.** The revision solves the changed scheduling brief honestly, preserves the reminder, explains the infeasibility of fitting both tours before departure, and makes the replacement-guide decision explicit. Neither acceptance nor this review confirms staff competence, agreement, route accessibility, bookings, or operational readiness.
- **Experience: usable desktop/phone review and explicit acceptance boundary, with one P2 status-copy finding below.** The pending proposal is clearly distinguished from saved work. No automatic completion claim was observed. Phone width 390 and desktop width 1440 were inspected; phone document width was 390 (no page-level horizontal overflow in this check).

## Specific findings — P1/P2 only

### P2 — Unrun model examples are presented as failed examples

**Location:** `web/src/components/TurnProgress.tsx:93–97`; reproduced by expanding **How this ran** on this artifact's desktop conversation rail.

**Observed:** Both actual document turns say “Model examples did not pass. These are not independent checks.” Their recorded verification has `checks: []`, no supplied acceptance test, an unrecognized automatic checker (`unsupported_goal`, zero cases/rows), and shape-only `needs_validation`. The boolean `model_tests_passed: false` is rendered as failure without distinguishing “not run/not applicable.”

**Impact:** A user reviewing useful retained work is told that examples failed when there is no recorded failing example. This conflates missing validation with a demonstrated content defect and can encourage needless retries. It does not justify calling this plan verified, and it does not invalidate canonical acceptance.

**Bounded remedy:** Display “No model examples were checked” (or omit that sentence) when no examples/check results exist; reserve failure wording for recorded executed failures. Add a presentation test for these actual shape-only document turns. Existing code, not introduced by the two-script delta; no competing frontend edit made here. No P1 found.

## Verified evidence

### Change and test scope

- `git rev-parse HEAD` matched the candidate. `git diff dd01 HEAD --stat` contains only `scripts/verify_native_admission.py` (106 lines) and `scripts/verify_native_target.mjs` (48 lines); `git diff --check` passed. Both worktree scripts equal their exact committed blobs. Python AST parsing and `node --check` passed during this review.
- The Python harness creates a disposable controlled fixture, uses a synthetic grant with a nonexistent credential reference, starts only owned loopback API/web processes, and checks all five provider/proposal counters are zero. Its positive branch compares the entire saved revision against `context['target_body']`, validates the persisted context hash, and checks saved revision immutability. Its negative branch requires browser rejection and unchanged message count. The browser checks the complete artifact/revision/hash target and absence of an explicit operation before forwarding; one message request and HTTP 202 are required for the positive result.
- Existing focused evidence: `.local/native-target-negative-01/verification.json` and `browser.json` record disabled-build rejection before admission and zero attempts; `.local/native-target-positive-4186/verification.json` and `browser.json` record native-target admission, exact saved body/context hash, and zero attempts. The negative receipt identifies `dd01`, not this candidate; do not relabel it. The current positive receipt identifies `4186` and build `iaKQHcHGIn8V1TbkNONjy`. These are controlled admission regressions, explicitly **not semantic model-continuation proof**.
- Reuse is justified by the empty backend/web/contracts delta: `.local/general-continuation-backend-suite.log:1–20` records **792 passed**, with dd01 at both ends; `.local/general-continuation-web-check.log:1–48` records **170 passed**, formatting, TypeScript and production build. No exhaustive rerun was performed. CI `38285714764` success is supplied parent evidence, not independently fetched by this local/no-external-network review.
- The serving checkout `/home/ubuntu/workagent-general-admission-review` has the same candidate SHA, no backend/web/contracts diff from it, and the expected BUILD_ID. Tracked production searches in backend, web/src and contracts found none of the scenario names/reminder/mission IDs examined. Combined with the test-only delta, there is **no evidence of scenario hardcoding in production**. This is not a universal hidden-hardcoding proof.

### Live continuation and human preservation

All following paths are under `.local/general-continuation-native-02/`.

- `followup-ui-request.json` targets artifact `54f1ff77-d3c1-43f1-8416-69338e415089`, human revision `5393b8b7-1bff-45e3-8ef5-4f24e94efe3b`, hash `f2b6848c19c22731cf29a03f70accdd4639f243b6fbec7d61f96016b15fa5823`; no `operation` is supplied. Persisted human message has the identical target. Parsed actual response-step request/count payloads in `followup-settled.private.json` contain a `target_body` exactly equal to the full human-saved revision, not just metadata.
- Programmatic initial-to-human comparison found only `human-context` changed; all other original blocks remained equal. The complete protected block, including its newline and entrance note, is equal in the proposed and accepted bodies.
- `followup-ui-readback.private.json` contains canonical proposal `aced3518-25c1-4cd7-a152-efa2c56ab2b7`, pending at that observation, against precisely the human revision on the same artifact. Only one artifact exists in this conversation. No substitute generated view was used.
- The proposal protects 14:00–14:20 and 15:45–16:00, proposes Tour 2 at 15:00–15:25 only with a confirmed qualified replacement, and labels Priya's guiding role conditional. Arithmetic replay confirms 40 available minutes before Mateo leaves versus 50 required tour minutes. Original availability is retained as historical context and explicitly superseded by the added human-update block. Nothing invents confirmed replacement staff.
- Acceptance arrived during review. `accepted.json` independently compared equal to the pending proposal body and hash `aae632c58fe85550e12acb53419254dece7c841d5d1fb4026792a2775f71a41a`; proposal status is `accepted`, pointing to revision `cd06942f-1a32-409a-b186-13900632970c`, parented by the human revision. The parent reports the actual phone Apply button returned HTTP 200 and in-app reopen succeeded. This reviewer did not perform acceptance.

### Caps and ledger preservation

- Programmatic comparison of `before.private.json` with `followup-settled.private.json.snapshot` covered all **33** recorded table sets. Every historical row remains exactly present except the authorized predecessor-grant revocation; the predecessor grant differs only in `active`. Historical revisions, artifacts, runs, attempts, events, carry and original unknown evidence remain unchanged.
- Exactly two new conversation runs and two provider attempts; both runs remain `partial`, with `needs_validation` and failed turn projection, not verified completion. The original unresolved count-only entry is exactly equal before/after; no new unresolved item is reported.
- `draft-review.json`, `frozen.json`, `installed.json` and actual receipts retain max_runs 2/max_steps 2, official route, exact conversation scope, $20 cumulative limit and unchanged other limits. Starting reservation **$5.40872**, final settled reservation **$5.93640**, delta **$0.52768**, historical carry **$3.42992** unchanged. Carry is already within the reported reservation, not an extra amount to add again. These are reservations, not billed costs.

## Parent gates and review limits

- **Acceptance: verified from canonical readback**, with UI execution attributed to parent. Accepting a conditional plan is human approval of saved text, not goal verification.
- **Restart/reopen after restart: PASS from completed parent evidence, plus independent read-only UI reload.** `restart-verification.json` arrived during review and was read: API/web PIDs changed from 2902280/2902304 to 2913266/2913290, same candidate/build, consumer not restarted. Fresh contexts at 1440/390/320 report actual Home → Conversations → conversation → work navigation, exact accepted revision/human block, absent pending-accept control, visible ordinary continuation, zero horizontal overflow, no errors/writes/provider calls. `final-after-restart.summary.json` retains the accepted revision/hash, both partial runs, original unknown, no new unresolved item, and unchanged $5.93640 reservation/$3.42992 carry. The independent browser reload then displayed the conditional accepted text and exact newline-bearing reminder in ordinary editors, no Apply control, a visible reply composer, and “Saved by you. Nothing checks this automatically.” No bogus goal completion appeared. The review location is **host loopback only**, not a public deployment.
- This review used local retained snapshots rather than a fresh whole-database audit, and read-only desktop/phone browser inspection rather than another save/apply cycle. An already-open reviewer tab retained its pre-acceptance view until refresh; the later reload, not that stale tab, supports post-restart UI observations. No new paid/live attempt or external CI query was made. Full keyboard/screen-reader, broader mobile-device, adversarial/concurrent-write and all-artifact QA were outside this bounded pass.
- Untracked `scripts/verify_criteria_view.mjs` was already present in the worktree and was neither reviewed as part of this two-script delta nor modified. This report is the only repository file created by the reviewer.
