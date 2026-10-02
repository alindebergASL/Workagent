# Runtime access and the bounded model-backed proof

## Result

An initial presence-only check was insufficient. Owner history contains explicit permission to use the QwenCloud subscription in apps and outside the metered cap (owner messages 701540/701544). The current Workagent commission authorizes one existing-access responsibility/recovery proof. Together these supported **one synthetic, model-only subscription request**, not a change of product runtime, paid fallback, general customer-data routing, or external action.

A read-only model-list request returned HTTP 404; that was not evidence of missing entitlement. One inference request to the existing subscription's Anthropic-compatible endpoint then returned HTTP 200:

- Requested: `qwen3.8-max-preview`; returned: `qwen3.8-max`. These identifiers are recorded separately, not silently normalized.
- Provider response: `msg_f4f5db15-0d60-4174-8082-af6cd4b88904`.
- Reported usage: **751 input / 2018 output tokens**; `end_turn`; 61.272 seconds as measured by the caller.
- Request SHA-256: `da4bc712484b16e3ae61c515244cbc7b54fadac2c6a96b02d6cb660f148196ff`.
- One dispatch only, maximum 4096 output tokens, no tools, retries, provider switch, model repair, or new paid route. A create-exclusive, fsynced dispatch marker prevented redispatch. Billing was not independently inspected; token usage is not an invoice or proof of zero cost.
- Only public synthetic SG-F2/F3/F7 fixture content was sent. No original handoff archive, customer data, credentials, or hidden reasoning is in the published evidence. Provider retention/trace guarantees were not qualified for customer use.

## What actually recovered

The response was recorded durably before any import. Its JSON shape, exact protected source note, allowed source IDs, and unique-union case count were checked. The actual text proposes testing an owner/next-action check on the next eight personal cases, provides a reusable checklist, and retains uncertainty rather than claiming savings or causation.

`scripts/model_responsibility_proof.py` imports this recorded response **as an explicit operator save**, following a separately labeled deterministic baseline. It does not call a model, impersonate a live worker, change the pinned fixture execution profile, or approve a proposal. The document itself identifies its actual provider and operator-assisted provenance. The application remains in its truthful fixture product mode.

The save committed to PostgreSQL; the importer deliberately exited with status 73 before acknowledging completion. A fresh importer process replayed the exact command/base/body, returning the same revision, with two history entries (fixture baseline + one operator import), not a duplicate. After API restart, read-back preserved the exact body hash and current revision. Browser desktop/mobile reopening showed the actual generated text, the unchanged note, and **Saved**, not **Approved revision**. Provider credentials were absent from the recovery environment. The launcher now also removes ambient model API keys from fixture child environments.

This is a real **operator-assisted model-backed draft and post-commit recovery proof**. It is **not** proof of provider stream recovery, managed-session resumption, autonomous product dispatch, approved skill loading by a live agent, or owner usefulness/approval.

Evidence: `model-proof/` contains the actual request/response, consumed dispatch marker, immutable import command, unacknowledged receipt, recovery/read-back results and browser evidence. No secret values are included. The import path is evaluator-only, restricted to an explicitly configured loopback API.

Current-UI reopening uses [`scripts/model_draft_browser_probe.mjs`](../../scripts/model_draft_browser_probe.mjs), not the archived probe's historical `Saved` assertion. The current unapproved artifact badge is **Ready for review**. The maintained probe reads the retained artifact only, blocks non-loopback/writing browser requests, preserves the original archive, and writes fresh screenshots/results to `.local/model-proof-recheck` (or `WORKAGENT_MODEL_PROOF_OUTPUT`). See [focused follow-up evidence](BASELINE_FOLLOWUPS.md). This correction does not replay the import or repeat the provider request.

## Remaining managed-first access gap

The selected managed-runtime discovery route still lacks a usable product project/API secret reference and a route-specific bounded spend/trace grant. The local Codex development login is not that entitlement. No managed required-contract failure was observed, so neither Qwen model access nor this smoke proof selects a fallback SDK/framework or waives the managed-first decision.

The default app remains fixture-only; `MODE=live` stays fail-closed. Reusing this exact recorded response requires no further inference. Any additional model dispatch needs a newly bounded scope; this one-call allocation is consumed.

## Source-review integration decision

See `upstream/REPORT.md` and `upstream/pins.json`. The integrator verified both clean detached commits and the recorded manifest/license hashes. Reuse the existing Workagent bundle loader, typed broker, domain CAS and PostgreSQL outbox. Adapt upstream receipt/context vocabulary when a concrete runtime consumer is authorized. **Do not build an unused parallel receipt framework merely to exercise another fixture.** Implement the smallest adapter alongside the first qualified managed-runtime consumer; Hermes remains conditional, not selected.

The source review predates this successful Qwen check. Its statement that *managed runtime* entitlement remains unconfirmed is still true; it must not be read as saying all model access is absent. No upstream source was copied into the application, no dependency installed, and no framework executed.
