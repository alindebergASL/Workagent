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

## Effective authority and conservative interpretation

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
