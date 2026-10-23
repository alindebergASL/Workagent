# Changing supplier assignment — live evaluation

Verdict: **PARTIAL. Useful analysis and scheduled execution; evidence continuity failed.**
This is the completed Step 1 evaluation, not a completed product mission or a claim of competitor parity.

## Scope and method

Live private runtime `8137e18479e92114b9e6f064da1054eeb51cc77f`, product model `gpt-6.1-sol`; evaluator `gpt-6-astra`. No runtime/frontend implementation changed. Synthetic procurement only; no private customer data, web research, contact, purchases, or external business effects. No restart/revocation test or competitor trial was performed.

The evaluator supplied four source documents (requirements and three supplier quotes), requested useful editable decision work without prescribing the answer, saved a changed requirement as a human note, supplied a later signed quote amendment, requested a single delayed check-in, and closed the app. Expected arithmetic and decision criteria were frozen separately before submission, never given to WorkAgent.

Upload friction: the UI rejects more than two files. The evaluator initially missed the validation and submitted without attachments. WorkAgent correctly reported that no files were available rather than fabricating analysis. The same four verbatim sources were then packaged into two labeled text files. This was an extra human intervention, not a clean initial upload pass.

## Decisions and arithmetic

Original requirement: 80 identical stackable chairs, $12,000 all-in, delivery and assembly by 12 November 2026, at least three years' written warranty.

| Supplier | Original all-in total | Correct assessment |
| --- | ---: | --- |
| Alder | $11,360 | Lowest-cost compliant offer on supplied written terms |
| Birch | $11,240 | Two-year warranty fails; dispatch/transit and optimistic email do not establish timely completion |
| Cypress | $11,760 | Compliant alternative, $400 more than Alder |

WorkAgent calculated these correctly and recommended Alder. It explicitly retained the discrepancy between Alder's three-year formal quote and five-year undated brochure, rather than promising five years. It distinguished written planning evidence from independently verified delivery performance and identified missing model specifications and commercial details.

Human correction R2: 100 identical chairs from one supplier, $14,500 all-in, same deadline and minimum warranty, no partial deliveries or split orders. The new Birch B-10 amendment replaces the earlier warranty and delivery terms with three years and completion by 11 November, while keeping prices unchanged.

| Supplier | Revised all-in total | Correct assessment |
| --- | ---: | --- |
| Alder | $14,000 | Above 90 chairs, complete delivery is not until 20 November; fails deadline |
| Birch | $13,920 | Revised written terms meet the specified constraints; $580 budget headroom |
| Cypress | $14,700 | $200 above the firm budget |

WorkAgent correctly reversed its recommendation to Birch. It saved an unaccepted proposal with the new reasoning and full B-10 text, while retaining every original R1 block and the human correction verbatim. The original saved revision was not overwritten and the proposal was not auto-accepted.

## Scheduled follow-through: behavioral failure verified

The check-in was due `2026-10-22T17:34:44.693025Z`; the run was admitted at approximately `17:34:45Z` while the browser was away. It completed and ended `waiting_person` with no further check-in.

It bound and reread the correct human-authored saved revision. However, its actual tool receipts show:

- `read_context(attachments)` returned `[]`.
- `read_context(work_area)` returned `null`.
- Saved-work discovery exposed only the bound, accepted document revision—not the pending R2 proposal.
- Message context exposed the synthetic wake message, not the original attachment-bearing conversation messages.
- The agent could reread the saved R1 brief plus protected R2 correction, but could not directly reread B-10 or its own pending R2 proposal.

The final reply disclosed this gap and asked the user to provide B-10 again if direct source re-verification was required. It preserved the correct conditional recommendation using the recorded prior outcome. That is honest behavior, but fails the requested source-backed unattended recheck: the user had already supplied the amendment, and its full text remained retained in the pending proposal.

These receipts establish a runtime-visible context/retrieval gap, not its code-level root cause. Do not fix the test by accepting the proposal, injecting the missing text into runtime state, or weakening access checks.

## Experience and verification

- Parent read-only verifier passed its evidence assertions, including the expected continuity failure; `full_step1_product_pass=false`.
- Exact full contents of all five source documents were verified present in their respective initial model requests. This verifies supplied input, not the model's internal comprehension.
- Human note and historical assessment preservation, pending proposal state, scheduled revision binding, final wait state, and absence of external-action tool calls were checked from retained records.
- The user-facing check-in and proposal were read back. Desktop 1440px and phone 390px review surfaces had no horizontal overflow. Mobile review is readable but dense; the proposal retains the stale R1/80-chair document title and places a long R2 narrative above the complete historical assessment.
- No source/recommendation coaching was given after the initial task beyond the intended requirement correction and new source. Explicit scheduling was requested; spontaneous initiative was not demonstrated.

## Budget and retained evidence

Successor grant `workagent-continuation-20261022-13` was activated before the exercise, within the existing cumulative $100. Aggregate allocation became $78.44924, not a new allowance. Activation preserved retained state and reservations and made zero provider requests.

The exercise used 21 generation requests, including the failed-upload turn. Reservations increased by $4.34532 to $53.34320; these are conservative reservations, not billing. Historical unknown generations stayed at three. Only three generation slots remain under this grant; re-read the live ledger before further generation.

Evidence directory: `/home/ubuntu/workagent-real-assignment-evidence/`.
Key files: `expected-results-private.json`, `sources/`, `initial-analysis.json`, `human-correction.json`, `changed-request.json`, `left-app.json`, `latest.json`, `scoped-evidence.json`, `verify_evaluation.py`, `verified-results.json`, `return-chat.txt`, `proposed-R2-decision-work.txt`, `checkin-update.txt`, `proposal-desktop.png`, `proposal-phone.png`.

Conversation: `f619978f-99b7-42ea-8515-b0d42d64a099`.
Artifact: `6e3dff5a-36a7-4147-a260-13bc91f0699d`.
Human revision: `dfd85cfa-c60a-40c1-b4f4-32f211caf915`.
Pending proposal: `7f771fc7-889b-462a-9a1e-7a9c79326a5d`.
Scheduled run: `13d71f9d-40f3-48e4-959f-9dc6e9fa379d`.

## Next engineering target, not completed here

Diagnose how an ongoing responsibility can retain authorized, versioned access to supplied attachments and its own pending work without treating a proposal as accepted. Reproduce this failure before changing code, preserve revocation and human-edit boundaries, then rerun a fresh changing assignment. This is now a more concrete priority than another timing-only demonstration.

No engineering successor is active at this evaluation checkpoint. The product responsibility is waiting for a human decision; the full mission remains unfinished.
