# Space baseline multi-model review — 2026-10-15

Candidate reviewed: application `5854e9f2a1b2778e034ba189aba01c39cae9ccb9`;
docs-only descendant `9675daf`. This is the preserved, user-rejected baseline,
not the forthcoming Claude redesign or an accepted private alpha.

## Reviewers, subject and limits

- Astra controller: actual Chromium desktop/390/320 DOM, screenshots and computed
  accessibility tree; source/provenance reconciliation and fresh mechanical checks.
- Direct Z.AI **GLM 5.3**: DOM/evidence critique from three perspectives (returning
  nontechnical user, changing-assumption analyst, mobile keyboard/screen-reader
  user). Text-only input; no screenshots, tool execution or actual users.
- Product subject model: **gpt-6.1-sol**, historical one live turn only at this stage.
  Reviewers did not perform the user's work in the product. Inherited Astra children
  are not counted as additional models.

[Original GLM review, preserved verbatim](reviews/SPACE_BASELINE_GLM53.md).
A successful different-model baseline critique is now available. It does not close
actual-model Space testing, the integrated-candidate review or human acceptance.

## Controller verdict and adjudicated findings

1. **Experience/usefulness: not acceptable yet.** The purpose and saved content are
   visible, but current work/decisions/next useful action are not coherently surfaced.
   The screenshot's technical targeting instruction creates an avoidable split
   between conversation and work. The user's rejection governs; GLM's more generous
   interpretation of that wording does not overturn it. Moving the warning alone
   is insufficient. Claude is already implementing a dedicated contextual Space view.
2. **Agency: not established by target safety.** GLM called targeted revision a
   bounded agency pass. Controller rejects that inference: revision/hash checks
   establish a mechanical boundary, not whether the agent selects useful action,
   handles an unexpected request or carries work forward. Ordinary live probes remain.
3. **Continuity: storage mechanics bounded; behavior unproven.** Preserved history
   and exact saved revisions help. Reviewer phrase “retained incomplete critiques”
   is evaluation-process evidence, NOT product continuity. Do not credit it to the app.
4. **Ownership: boundary disclosure is not ongoing execution.** “Human saved,”
   “no external actions” and human acceptance do not prove an agent owns or executes
   a responsibility. Need canonical lifecycle/readback and actual authorized runs.
5. **Accessibility finding was partly false.** GLM inferred unlabeled links/buttons
   and select from `innerText`/`aria-label` snapshots. The controller checked Chromium's
   computed accessibility tree: all exposed link/button/combobox/textbox controls
   in this fixture had names at desktop,390,320px. The artifact select is named
   “Work to read” through its associated label. Missing `aria-label` does not mean
   missing accessible name. That finding is not an accepted defect; no label churn
   requested. Small-target/focus/navigation accessibility still needs interaction
   tests on the replacement UI. No horizontal overflow observed at390/320px.
6. **Engineering: bounded checks only.** Fresh239 frontend/32 operator tests and
   type/lint/format passed; carried backend/browser evidence is explicitly historical.
   No full current suite, new live Space result or user acceptance is inferred.

## Provider receipts and preserved failures

All attempts stayed on direct Z.AI with the configured coding-plan credential;
no OpenRouter, model downgrade, PAYG fallback or product-runtime dispatch.
Subscription billing/remaining plan quota was not independently verified, so no
zero-cost billing claim is made. These reviewer calls do not reset or refund
historical unknown reviewer liabilities or product allowances.

1. Anthropic-compatible configured endpoint, requested/returned `glm-5.3`,4096
   output cap. HTTP200; `stop_reason=max_tokens`; 7755input/4096output/0cached;
   no final review text. ID `msg_202610150910059b4aca773f664103`. Retained failure.
2. Explicit separately recorded attempt, same endpoint,8192 cap and requested low
   effort. HTTP200; `stop_reason=max_tokens`;11input/8192output/7744cache-read;
   partial final text. ID `msg_20261015091333c8d8bc9516794b5d`. Nonempty text and
   process exit0 did NOT satisfy completion. Retained partial, not silently replaced.
3. Documented direct coding-plan Chat Completions endpoint
   `https://api.z.ai/api/coding/paas/v4/chat/completions`, same model/credential,
   enabled thinking, low effort,16384 output cap; concise evidence packet.
   HTTP200, returned `glm-5.3`, `finish_reason=stop`;3171prompt/1122completion
   (9reasoning),0cached; ID `202610150917131360ddb0db864c5f`.
   Response SHA256 `1a54bcdee3b1be1de7606ac018ee00bf9e4230ee95510fd4699e41eed6170632`.
   All three perspectives, six verdicts, priorities and limitations were returned.
   This is the complete critique above, not a successful reinterpretation of1/2.

Protocol/forced-thinking reference checked: https://docs.z.ai/guides/llm/glm-5.3 .
The published model is text-only, always reasons, and documents the coding-plan
Chat Completions protocol. Anthropic-style effort behavior was not assumed equivalent.

Private raw receipts/packets/screenshots and computed AX evidence are retained in
`.local/experience-review-20261015/`; only synthetic nonsecret review text is committed.
The diagnostic servers used for inspection were stopped and ports read back closed.
Existing saved f68efe5 preview and its environment remain unchanged. No running
review service or live Space behavior is claimed by this document.
