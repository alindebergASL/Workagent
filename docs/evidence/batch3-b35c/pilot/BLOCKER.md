# Conditional pilot stopped — authority handoff not proven

## Result

**TECHNICAL BLOCKER, with the original full-study funding `needs_input` unchanged.** The existing source grant-continuation API can revoke an old grant and lower its successor's cap, but that is not a durable, destination-exclusive transfer of allocation. The selected pilot remains zero-paid. No live grant was changed to test this hypothesis.

This does not ask the owner to approve routine re-scoping or repeat the SQL-memory repair. The repair at `8fff438e6705d1d86b3057b93cc92e4d904918ea` is unchanged; its six source hashes were verified. Its27 focused tests and independent review remain the engineering checkpoint, not newly rerun evidence.

## Fresh source observations

One read-only13-store reconciliation at2026-10-29 17:42:27–17:42:48UTC retained **99.60596USD** allocated and **0.39404USD** unallocated. Three unknown usages and seven unmatched counts remain reserved. Allocation is not settled billing; billing remains unknown.

The targeted admission snapshot at17:43UTC found:

- Installed schema ends at046; active grant `workagent-continuation-20261022-15`, cost ceiling67.62068USD, local reserved plus carried liability66.58608USD, nominal inside-pool remainder1.03460USD.
-13 running,3 queued and54 ready run rows; no unexpired leases. There are19 dispatched attempt rows. These are local retained states, **not** proof that every external request has completed. No provider was queried and no unresolved request was resent.
- The installed runtime still uses its historical consumer/schema, not the repaired full-tool SQL-memory treatment. Candidate publication is not runtime installation.

A final single-store read-only check compares authority, immutable grant hashes, lineage, migrations, carry, per-grant and aggregate event accounting, and exact unknown-step identities against the first snapshot. All nine comparisons pass (`final-readonly.json`). This is not a second broad13-store campaign and does not claim byte-identical comparison of every historical event payload.

## Executed disposable counterexample

`probe_transfer.py` provisioned **one new synthetic-only disposable PostgreSQL database**, applied the exact captured046 migration prefix and compared seven available source function definitions by SHA256. All seven match. It then exercised the actual `configure_grant` API and restricted-role readbacks:

1. A normal successor atomically revokes its predecessor, leaves original immutable JSON intact, and installs a no-send grant with zero generation/count/read/token caps. Its illustrative monetary ceiling is66.59300USD, the original67.62068 minus selected1.02768. This is fixture math, not a live debit.
2. Direct reactivation of the revoked predecessor is rejected.
3. **The next normal successor is nevertheless accepted with the original67.62068 ceiling and nonzero call limits.** No outgoing transfer, destination or previously exported amount is consulted. The full1.02768 reduction can therefore be reopened through ordinary grant installation. This behavior is valid for the existing adjustable-grant API; it is not a malicious-runtime bypass. It makes a lower-cap grant plus a reusable receipt insufficient as a durable financial transfer.
4. The current full-tool memory binding is rejected by the source046 validator (`exact typed alpha budget binding required`). The failed transition rolls back and preserves the preceding grant.

The report contains **12 verified assertions:7 definition matches and5 admission/rollback observations**. An assertion marking the reproduced counterexample as true is **not a safe-handoff PASS**: `safe_handoff_proven=false`. No historical installed data was copied into a spendable test store. Fixture authority was synthetic, with a non-key secret reference; no real provider request was possible through these probes.

An initial harness import typo failed before provisioning; its log is retained. A final-readback harness initially expected an unretained raw-event list; this failed read-only, was corrected to the collector's actual aggregate/unknown identity contract, and the successful rerun is separately retained. No failed receipt was overwritten.

## Why the available shortcuts were rejected

- **Same source store:** current073 full-tool/memory behavior is not installed. Applying its migration chain to the retained source is installed-data migration, not merely installing a compatible grant; this continuation does not authorize it.
- **Separate current-schema store:** source revocation plus an independently installed destination allowance is not sufficient. Existing grant lineage does not durably debit outgoing capacity or bind a unique destination. `responses_budget_grants()` sees only its own database. `responses_budget_carry` imports liabilities, not transferable funding; its source uniqueness is local and its manifest is an operator assertion, not verified source ownership.
- **New shared coordinator:** potentially a valid engineering solution, **not disproven in general by these tests**. However, it must govern source regrant, destination activation/consumption and crash/restart/ambiguous outcomes together, not only wrap the new pilot's sends. No such complete integration was implemented or verified here. A file receipt or destination-only ledger would not close the reproduced source-regrant gap. We did not invent an installed-maintenance exemption or call an untested coordinator safe.

One independent read-only feasibility analysis inspected the accounting seam and identified the missing durable, destination-exclusive transfer consumption and future-grant preservation. This was not another review of the unchanged SQL-memory repair, nor approval of new financial-admission code. No such product code was installed.

## Remaining realistic options

1. **Continue engineering the same selected pilot** only with a complete shared coordinator/exclusive grant-installation path, or equivalent atomic source debit plus destination binding. Prove competing source/destination sends, future source successors, duplicate destination/replay, stranded/ambiguous activation, historical unknown retention and exact money/call caps in disposable tests; obtain the required narrow review before installation. Ordinary compatible runtime/grant work remains authorized. If the implementation requires installed-data migration/maintenance, stop for that specific authorization rather than disguising it as a grant transition. No further owner approval is needed merely to keep the selected scope.
2. **Explicitly authorize a narrowly specified installed migration** if choosing a source-enforced debit or same-store modern treatment. This would be a new maintenance decision, not something performed or presumed here. It would still require safety proof, exact residual/call reconciliation, small-token engineering and held-out preregistration; it would not fund the full study.
3. **Defer the pilot and retain the current technical checkpoint.** Full A/B remains unfunded/incomplete. Published `../engineering/FUNDING_OPTIONS.md` remains the full-study menu:142.80192USD maximum reservation envelope with unchanged sample/caps and smaller ancillary contingency;77.16096 or57.87072USD lean envelopes additionally require token/read-policy engineering and a prospective amendment. None is selected, allocated or activated by this report. The original355.34592USD envelope is also a reservation maximum, not a required bill.

This continuation does not select a larger option or request a ceiling increase. No source liability or unknown is refunded. No new allocation is made, including from the0.39404 globally unallocated amount.

## Honest completion boundary

- Pilot0/2 episodes; full A/B0/12 trajectories and0/72 episodes. No outputs, blind scores, effort/usefulness claims, actual download, native/desktop/phone journey or provider-measured request size.
- Zero provider generation/count/read/cancel, paid judge/search, live grant mutation, installed migration, new allocation, new graph/card, default merge or deployment.
- No owned proof service was started; none needed stopping. Unrelated services and the source dispatcher were left alone. The one new disposable DB and chmod600 fixture environment are retained locally; no installed cleanup was attempted.
- Main model/profile/retry caps unchanged. Development and feasibility model: GPT-6-Astra/openai-codex; development-tool billing is outside the product ledger and unreconciled.
- Task `t_82b30c02` remains incomplete/needs_input; original full-study hold remains. Existing C/D successor `t_9cfa8070` is not released. Publication of this evidence does not make the pilot or full study accepted.

`MANIFEST.json` binds evidence and source hashes. Publication commit/remote/CI readbacks are recorded separately in the task/PR receipt, avoiding a self-referential commit claim.
