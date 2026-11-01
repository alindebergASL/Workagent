# Read-only funding disposition — same-card continuation

This is a diagnosis of the retained **19:21 UTC 2026-10-29 snapshot**, not a new collection, grant, refund, billing reconciliation or authority change. Source: `.local/batch3/b35c/execution/ledger/current-reconciliation.json`, SHA256 `53306d858e4c04d3eaa64e923a7a72950d44cf681eaab5061025d64d63af4673`. Calculations: `evaluation/funding_disposition.py` and `.local/batch3/b35c/preparation/funding-disposition.json`. No installed store was queried or changed for this diagnosis.

## What is policy, what is exposure?

**Permanently debiting every dispatch reservation, and carrying every historical allocation indefinitely, is the assistant's conservative engineering policy. It is not evidence that the provider charged those amounts.** The source implements an irreversible internal reservation ledger, not settlement/release accounting. Preserving immutable historical rows is necessary; making every unused historical envelope permanently unavailable is a separate policy choice. This continuation does not reverse that policy or invent released money.

| Category | Disposition |
|---|---|
| $14.7193575 | Price calculation over reported known token usage. Not a settled bill or account-wide total. |
| Three unknown generations | Retain their identities and do not resend. All three are in the primary store, under original 20,000/8,192 reservation profiles; the profile-based model liability bound is **$0.39576** total. Snapshot aggregate token/reserve ratios support this calculation; it is conditional on those original profiles, not a per-request provider settlement. |
| Seven unmatched count sends | Preserve separately. No received token-count result is known. At the later campaign's $0.01/request engineering contingency this is $0.07; that is not a provider tariff and does not establish an account-wide financial upper bound. |
| $72.17292 | Historical generation reservations across deduplicated retained lineage. Includes known and unknown generations; NOT added to known usage or allocations. The code keeps these reservations even after a result with usage arrives. |
| $99.605960 | Cumulative historical allocation lineage, including original $20 retained fully encumbered and later incremental allocations. Not cash spent. Revoked/expired entries remain historical; no released balance is represented. |
| $0.394040 | Unallocated under that policy. Not a compatible installed grant for this candidate. |
| Uncollected activity / settled billing | Account-wide completeness is explicitly false; private billing was not accessed. These unknowns remain unknown. Development/review model costs are outside the product ledger and unreconciled. No billing paperwork gate is introduced. |

Known usage plus the conditional unknown-generation bound is $15.1151175, **not** total exposure and **not** permission to spend the rest of $100. Ancillary uncertainty, still-live competing authority, retained original encumbrances and account incompleteness remain separate.

## Possible competing spend and unused authority

The snapshot is a point in time; it does not prove that no writer has subsequently spent. No fresh 13-store collection was performed.

- Primary store `workagent_test_47b87fe3b82e`: active `workagent-continuation-20261022-15`, no grant expiry, cumulative model cap $67.62068 versus shared reservations/carry $66.58608, arithmetic residual **$1.03460**. An installed API process was present in the snapshot. This is possible competing authority, not unused globally transferable money.
- `workagent_test_01598d94d17c`: active `workagent-space-next-20261015-01`, no expiry, cap $9.762080 versus local/carry $8.97056, residual **$0.791520**. Possible competing authority. Do not sum this with the primary pool: clone lineage and shared historical reservations require care.
- `workagent_test_942379a11eb1`: scheduled grant remains flagged active with null grant expiry, but its evaluation campaign expired at **2026-10-28 07:53:30 UTC**. Actual campaign guard reserves model dispatches plus $0.01 for each count/read. Retained model $5.17300 + 25 counts/55 reads = **$5.97300** held of $6.50, leaving **$0.52700** unused policy envelope. Expiry denies future sends; it does not create a reusable balance or refund. The apparent $1.327 model-only residual is not the campaign residual.
- `workagent_test_98a707f51c87`: active-flagged $20 grant expired on October26 and has zero attempts. Its nominal cap is not an additional funded $20. Do not add or transfer it.
- Revoked predecessor grants and the fully encumbered original authorization stay intact. Revocation stops new dispatch; it neither cancels existing liabilities nor emits a settlement/release event.

## Actual supported mechanism

1. **Admission/reservation:** `backend/workagent/responses_ledger.py` `summary()` and `reserve()`, plus SQL `guard_carried_budget_event`, `guard_alpha_budget_event` and `responses_budget_grants` (migrations014/019 and later amendments). An advisory-lock transaction checks existing shared reservations/carry plus the next dispatch reserve. Result retention records usage but never subtracts a committed dispatch reservation. Core SQL admits one operation at a time; it does **not require reserving all72 episodes upfront**.
2. **Immutable source/grant matching:** `general_responses.check_pins`, `provider_attempts.check_grant` and the stored run configuration. Current candidate cannot reuse an old grant merely because a number is positive.
3. **Supported rebind for NEW turns only:** `provider_attempts.configure_grant(..., predecessor_id=...)` atomically records `general_grant_continuations`, revokes the predecessor and installs an immutable successor. Migration028 requires same workspace/principal/project/route; migration033 supports standing-scope continuation within that boundary. Existing runs/attempts are never rebound; shared accounting does not reset.
4. **Cross-store carry:** migration014 retains carry, with no decrement/release operation. It is not a residual-transfer API or a cross-store concurrency coordinator.
5. **Campaign-specific admission:** retained `step4-live-continuation/scheduled/campaign-after.sql` `evaluation_gate` checks deadline, permitted grant IDs, run limits and model/count/read reservations. This is stricter than the core model ledger. Its expiry is relevant even with an active provider-grant flag.
6. **Release/refund:** none was found in these actual mechanisms. No refund was assumed, and no release table/coordinator was implemented.

## Concrete next actions and amounts — NOT authority installed now

**Prefer an existing same-store successor where its original scope is suitable.** The primary source is at migration046, not current074. To execute current tools there, the exact permission needed is: a backed-up/isolated, reviewed **046→074 installed-data upgrade**, an atomic supported successor of `workagent-continuation-20261022-15` with current candidate/policy/schema pins, and explicit ownership of that old pool while preserving all reservations, carry and unknowns. This is installed-data/grant maintenance and is forbidden in this continuation. It is not merely permission to change a JSON hash. The same-scope successor is a first-trial path, not proof that all independent A/B trajectory stores can share authority safely.

Reservation sensitivity at unchanged normal capacity:

| Work illustration (including final answer) | Model reserve | Interpretation |
|---|---:|---|
| Six generations, as exercised by the scripted complete diagnostic | $1.24152 | Requires $0.20692 beyond the primary residual; cumulative allocation would be $99.812880 if that later increment were authorized. This fits $100 arithmetically, but does not guarantee a real model finishes in six calls. No six-call live cap is proposed. |
| Eight generations | $1.65536 | Requires $0.62076 beyond the primary residual; with no release, cumulative envelope would be **$100.226720**, before ancillary contingencies. This is an illustration, not a mandatory eight-call minimum/cap. |
| Eight generations + one count and one read each | $1.81536 | Ancillary amounts use the campaign's internal policy, not confirmed tariffs. |
| Eight generations + one count and forty reads each | $4.93536 | Worst-case illustrative per-episode reservation envelope, not expected spend. A separate newly funded nontransfer envelope would need a ceiling of **$104.541320** under unchanged historical allocation policy. |

For scale only, six calls each actually using20k input/2k output would project **$0.42 model usage**, or $30.24 for72 episodes with that identical workload. This is a conditional workload estimate, not an empirical forecast. The six-call reservation is $1.24152; actual token use and reservation must not be conflated. Real attempts, recoveries and reads may differ, and no original cohort is shrunk to fit these examples.

**Concrete checkpoint decision:** either authorize the narrowly identified installed successor/upgrade path and choose a useful next-trial envelope based on its real workflow (alert before crossing $100); or retain the zero-installed-mutation rule and authorize a separate nontransfer trial envelope with the concrete additional ceiling appropriate to that workflow. If reclaiming historical envelopes instead, the operator must first authorize a precisely bounded reconciliation/release mutation; there is no existing release API to call. This report does not propose building a new accounting system, assuming a refund, silently moving a pool, allocating all72 episodes at once, or treating generic reaffirmation of $100 as missing.

No money was allocated, no paid request was sent, no stored liability was changed. The full A/B remains owned by the same execution card.
