# B3.5c A/B — blocked before live execution

Task `t_82b30c02`; source HEAD `b45824a00ea6b9dce855140236653fd8adb563af`; branch `hermes/b2-conversational-client`. This is a preflight checkpoint, not A/B completion or Batch3 acceptance.

## Fresh observations

Read-only reconciliation ran **2026-10-29 16:46:18–16:46:37 UTC** against 13 evidenced PostgreSQL stores, with read-only repeatable-read transactions and rollback. All **9 inherited evidence checks passed**, zero failures/errors. Reconciliation SHA256: `56d83c1002b6859c8a04e3c3b9b186efba57d0aec5c865c77ab7d650eeaa7f6b`.

- Retained allocation **$99.60596 / $100**; globally unallocated **$0.39404**.
- Three unknown-usage steps and seven unmatched-count steps retained. Deduplicated model reservations $72.17292; settled billing unknown. Neither known usage nor the difference from allocations creates available funding.
- Installed API PID875172, start ticks70011888, cwd `/home/ubuntu/workagent-candidates/general-review-20261023/backend`; active grant `workagent-continuation-20261022-15`, official `gpt-6.1-sol` route. Exact prompt/consumer bindings match installed disk source. These are disk/retained-request observations, not new response/model-version evidence.
- Installed local residual $1.03460/five generations is scoped historical authority, not a new A/B allocation. Expired campaign residuals $0.52616 and $0.52700 remain inside historical allocations, not fresh money. No pool was rebound or spent.
- Installed grant does not cover the candidate full-tool treatment. Static inspection confirms `memory/runtime.py::enabled` still recognizes only the compute-derived memory schema. SQL full-tool M1 integration/refreeze is a separate engineering prerequisite, not an owner approval requirement. No repair was started after the funding preflight failed.

## Exact funding decision needed

The unchanged preregistration requires two independent variations per family, B0/B1/M1, six episodes per trajectory: **12 trajectories / 72 episodes** for A/B. Maximums:576 generations/counts,23,040 lifetime response reads, zero cancels;50,000 input/8,192 output tokens per generation.

| Envelope | Maximum reserve |
|---|---:|
| A/B model | $119.18592 |
| A/B conservative count/read accounting | $236.16 |
| A/B total new envelope | **$355.34592** |
| Required cumulative ceiling retaining prior allocations | **$454.95188** |
| Increase over current $100 ceiling | **$354.95188** |

These are maximum reservation envelopes, **not forecast provider fees or billing**. Count/read reserves are an adjustable accounting policy, not asserted provider charges. Even removing those reserves leaves the model-only envelope unaffordable. One full single-variant trajectory has a $29.61216 envelope and is also unfunded; it would not complete this card.

**Owner question:** authorize a cumulative ceiling of $454.95188 for the existing A/B maximum envelope, retaining all prior liabilities, or direct a smaller amended evaluation budget/design. No increase is inferred and no money is allocated by this checkpoint. A reduced design must be preregistered before calls; it cannot silently replace the existing A/B acceptance scope.

## Denominators, attempts and missing evidence

- Live execution: **0/12 trajectories and 0/72 episodes started/completed**. All planned live results are missing because preflight blocked them, not observed product refusals or task failures.
- Product provider count/generation/read/cancel requests: **0**. New allocations/reservations: **0**. No model-powered judge or paid search.
- No real A/B outputs/downloads, blind ratings, latency, active user effort, recall-review burden, observed returned model versions, or fresh desktop/phone/native journeys. No superiority or usefulness claim. Predecessor synthetic custody receipts remain synthetic, not live results.
- One collector invocation and one verification run succeeded. An initial `execute_code` convenience read was refused by unattended-mode tool policy before execution; ordinary permitted file tools were used instead. No product attempt resulted. Static type warnings in the local refresh wrapper do not change its successful execution; no product code was modified.
- Development model GPT-6-Astra/openai-codex; development-tool billing is outside the product ledger and unreconciled, not claimed free.

## Evidence and resume

Raw sanitized collector/verifier files are retained under `.local/batch3/b35c/preflight/ledger/`; wrapper `.local/batch3/b35c/preflight/refresh.py`. Command: `PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python .local/batch3/b35c/preflight/refresh.py` exited0, collector0/verifier0. The wrapper intentionally refuses reuse of its output directory; a future refresh must use a new directory. Public-pricing receipts are reused with their original timestamps/hashes, not claimed freshly fetched.

Before resuming: reread current authority and ledger; implement and independently review matched full-tool SQL B1/M1 treatment; enforce live-worker oracle isolation; freeze fresh real materials/source/prompt/schema and amended preregistration; install compatible finite grant/admission accounting only within actual authority; then execute the full mixed-order A/B scope and blind scoring. Funding alone does not satisfy these engineering/evaluation prerequisites.

No installed services/data were changed, no deployment/publication/default merge, no cleanup, no oracle copy into product, and no independent review campaign was started. Pre-existing untracked `contracts/pnpm-lock.yaml` is untouched. Existing successor C/D `t_9cfa8070` remains dependency-waiting; it is not active and is not released by this blocker. B3.5c remains incomplete and stops pending the explicit funding/design decision.
