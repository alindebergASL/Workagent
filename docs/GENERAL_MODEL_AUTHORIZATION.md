# Andrew's general-model testing authorization

## Source statement (verbatim)

Received from Andrew Lindeberg in the existing Telegram conversation:

> OK, for this Proposed execution ceiling:
> - 8 generations, 8 token-count requests, 80 same-ID retrievals.
> - Aggregate 160,000 input / 65,536 output tokens.
> - $2 maximum reservation; 30-minute expiry.
> - Synthetic data only; no external tools, automatic acceptance or generation retries.
> - Explicit acknowledgment of Responses store:true retention.
>
> I approve $20 and no expiration. Keep this going until we use $20 and I can reapprove. Lets not slow the project down when this amount is not that much. This will help with testing

## Current clarification — continue within the cumulative $20

Andrew subsequently clarified in the same working conversation:

> what blocked this, The next behavioral checkpoint is an obstacle causing Workagent to change its next action and verify the outcome.
>
> The original four-turn/eight-generation allowance is exhausted; no counters were reset. Estimated usage cost was $0.075265, not confirmed billing. No default merge or deployment.
>
> I authorized up to $20

And then:

> Hermes, you have more automony than this, you narrowly scoped yourself and this is holding up progression

This clarification supersedes Hermes's restrictive interpretation below: the
four-turn/eight-generation profile was the initial connection checkpoint, not a
project-wide halt. Continue implementation, verification and reasonable synthetic
model tests within **one cumulative $20 budget, without calendar expiry**. Select
bounded per-run limits proportionate to the behavior being tested; do not ask for
another routine checkpoint approval merely because the initial profile completed.

Retain the original immutable grant and all charges/reservations. Subsequent
profiles/grants must share remaining project budget, not each receive $20. Enforce
worst-case reservations before provider I/O; reconcile known usage conservatively,
retain unknown liabilities and never double-count or silently refund them.
Cross-grant budget enforcement and immutable historical carryforward are now
implemented in the PR #12 baseline. The initial exhausted grant is not reused;
subsequent bounded grants share the retained project ledger and one $20 ceiling.

The synthetic-only scope, official provider/model route and acknowledged retention
remain. No new private data, external business actions, automatic human approval,
default-branch merge or deployment is authorized. Missing behavior calls for
continued development, not a fabricated demonstration. Technical checkpoints are
progress reports, not additional permission gates. The initial one-operation
profile is not the architectural ceiling.

## Current continuation instruction — October 8

Andrew's direct continuation explicitly states:

> You already have authority for routine development, fixes, testing, publication and compatible non-default integration. Reasonable bounded synthetic model tests remain authorized on the recorded route within ONE cumulative $20 budget. Preserve historical usage, reservations and unknown liabilities; the initial four-turn/eight-generation checkpoint is not a project-wide stop. Preserve protected databases and the saved review environment. Default-branch merge, deployment, new paid routes and broader private-data access remain outside this instruction.

This is continued authority, not another $20 allocation. Per-run profiles remain
bounded; operator admission/setup is distinct from a demonstrated journey that
progresses with continuous workers and no per-turn intervention. Routine findings
do not require a new checkpoint approval. Unknown provider sends are not safe
retries merely because budget remains.

## Historical initial-checkpoint interpretation (superseded above)

- Proposed $2 monetary ceiling is replaced with **$20 cumulative maximum** for this Workagent model-testing authorization. This is a ceiling, not a spending target. Stop before additional reservations could exceed it and request reapproval; no automatic refill, batch reset or restart reset.
- Proposed30-minute grant expiry is removed: **no calendar expiry**. The grant remains explicitly revocable. Worker leases/fences/timeouts still expire normally; no-expiry spend authority is not an infinite execution lease.
- Other listed limits remain: at most8 generations,8 token-count submissions,80 same-ID retrievals; aggregate160,000 input/65,536 output tokens, per-generation20,000 input/8,192 output. Do not silently raise or reset these limits to use the full$20. If an independent cap is reached first, stop/report before further live calls.
- Synthetic data only, no external tools/business effects, automatic acceptance or generation retries. The provider connection itself is the authorized external route; shell/network tools are not enabled for the model.
- Responses `store:true` retention is acknowledged by the quoted approval. Exact request/receipt material remains private; published evidence is sanitized.
- Concrete proposed route remains official OpenAI Responses API, `gpt-6.1-sol`, medium reasoning, default tier; fresh availability/account/pricing verification is a prerequisite, not permission for a different model or route. Fail closed if unavailable or if conservative reservation pricing cannot be verified; do not silently fall back.
- Initial agreed usefulness work remains two new synthetic conversations/four natural-language turns in GENERAL_MODEL_SLICE.md: CSV initial+saved-revision rounding/notes, generated calculator with no supplied WAT+shipping revision. Preserve the currently running hands-on examples untouched.

## Implementation and activation

Continue the bounded same-GeneralWorker implementation and deterministic authority/recovery proof. No new provider calls are needed for development. Runtime activation must bind this source authorization to one durable grant ID, concrete principal/workspace, immutable profile/request policy, permitted conversations/context and the above counters. Dollar/call/token/retrieval reservations must be enforced in both application and DB and survive restarts. Do not mutate accepted historical grants/bundles/migrations or relax their expiry.

The source approval is effective, but **this file is not itself an active runtime grant or evidence of any spending**. Activate only after the implementation candidate is reviewed, deterministic gates pass, the exact model/account/pricing is verified and the cumulative ledger is initialized without resetting any existing spend. Failed/unknown sends retain their reservations; billing and conservative reservations are reported separately.

Default-branch merge, deployment, private-context access and broader capability work remain unapproved. Local/review/development branches are separate from the frozenf68efe5 hands-on runtime.
