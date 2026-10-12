# Criteria clarification — exact-candidate results and deep review

**Application:** `9a009c6467369716a5e1d0c0d6f3b83337a2da8a` ([PR #14](https://github.com/alindebergASL/Workagent/pull/14)).
**Scope:** distinguish original saved assessments from temporary filters; verify the actual desktop/phone interaction; then deep independent/MOA review. **#13 remains open; no PR/default-branch merge, deployment or human acceptance.**

## Delivered change

Generic `flexible_policy.py` guidance requires adjacent original-criteria labels, separate temporary filters/local match status, explicit unknowns and preservation of saved assessments/human work. Nine pure tests guard that guidance, not model obedience. No task-specific application route, new schema or competing frontend implementation was added. Claude's shell remains unchanged.

An actual model-created **new draft**, `8f972d05-6e03-4095-9150-0a06eac1ede1`, revision `e8ecf826-2d32-462d-b96a-babe69626bf4`, has body hash `7fc35005ed8feceadccfeac4ded0a93fbf9024f628a46647f33d50c51de50bbf`. Its table is an explicitly labeled replay of the exact retained human-edited table, not newly researched/generated facts. The original brief was supplied explicitly, not inferred from assessment prose.

At £350 the card says **Matches current filter: Yes**, beside current criteria. A separate **Saved assessment (static, original task)** block labels the original £300/70-person/step-free criteria immediately before unchanged assessment prose. The exact Marta note remains visible and unchanged. At £300 the local match changes; the saved assessment does not.

This does **not** retroactively rewrite the original artifact. Its original presentation, all saved rows/history and human notes remain preserved. The new draft is available on this host’s local review app at `http://127.0.0.1:3163/conversations/381b35eb-9451-487d-ae15-c67f12bc10c2/artifacts/8f972d05-6e03-4095-9150-0a06eac1ede1`. This is a loopback review address, not a public deployment.

## Exact-candidate verification

- **787 backend tests passed** on a newly provisioned restricted PostgreSQL database; one dependency deprecation warning. Identical SHA before/after the suite.
- [GitHub CI 38193118740](https://github.com/alindebergASL/Workagent/actions/runs/38193118740) succeeded at this exact application SHA.
- Separate exact worktree production build passed using `next build --webpack`. Earlier dependency-symlink failures are environmental setup history, not passing builds; no saved service was reset.
- Parent real production UI/API checks passed at desktop 1440 and phone 390, both budgets, exact saved notes/assessments, refresh, reload/reopen, readable fallback, no horizontal overflow, no saved mutation and unchanged original revisions.
- MOA spotted under-instrumented response counting in the first browser report. The revised verifier awaits and labels each read; the rerun confirms **ten unique HTTP-200 broker reads**, all six check groups and zero unexpected writes/errors. Both reports remain in evidence.
- Independent UX review passed desktop 1440, phone 390 and narrow phone 320 at both budgets: zero matches at £300; Willow Hall and River Centre at £350. Keyboard and direct emulated-touch scrolling reached the content. Ten separate synthetic missing-data/error/injection cases passed, including refused-read handling. Those injected browser tests are not backend authorization proofs.

## Deep review and disposition

1. **Independent authority/recovery reviewer:** examined real restricted-role DB state, immutable pins, budget guards/carry sources, first/second attempts and preserved row bytes. 46 pure/offline tests plus inert uncertainty probes passed. Authority, budget, recovery and preservation PASS; initial overall verdict FAIL for one P2 evidence defect.
2. **Independent UX/generated-code reviewer:** actual browser execution, screenshots, source inspection, exact readbacks, sandbox probes, synthetic failures and touch behavior. **PASS**, no P1/P2 blocker within this new-draft scope.
3. **Configured cross-model MOA:** DeepSeek-v4-pro and direct Z.AI GLM-5.3 references; GLM-5.3 aggregator. Returned contained **PASS**, no P1/P2 blockers, with six nonblocking findings/conditions. **One reference returned empty**; the output does not identify which, so this is partial reference coverage, not three successful independent model reviews. It is packet analysis, not its own browser/SQL execution.

### P2: incorrect freeze-action receipt

The second operational script revoked the failed-first-attempt grant, but its original `frozen.json` named the older grant and checked the wrong target flag. Independent DB inspection confirmed both predecessors were actually inactive, so the finding was inaccurate evidence, not observed authority bypass.

The incorrect receipt is preserved byte-for-byte. A separate `freeze-corrective-readback.json` identifies the actual failed-attempt grant, checks both predecessor flags and immutable data, hashes the incorrect receipt, and records unchanged cumulative accounting. The script-as-executed is privately preserved; its future-use helper now reads both predecessor flags and records the actual revoked target. No new revoke, provider call, retry or DB mutation was used for this correction.

**Independent P2 recheck: PASS.** Eight pure spy tests reproduced the archived defect and verified the corrected exact-target logic. An independent read-only PostgreSQL transaction confirmed both predecessors inactive, immutable pins/accounting preserved, and 276 pre-second-attempt rows across 28 snapshot tables unchanged. The wrong receipt remains intact beside its correction. **Final parent verdict: contained criteria-clarification PASS; no remaining P1/P2 blocker in this reviewed scope.**

## Accounting and interrupted-attempt honesty

The first presentation-generation attempt returned an official selection, then its final token-count operation remained unknown. There was **no final dispatch, retry or publication**. A supervisor timeout is not a cancellation receipt. Input size is a plausible but unproven cause; no root cause is claimed.

A separately admitted second conversation/grant omitted the bulky original-view attachment while retaining original brief/facts. Its ordinary continuous consumer obtained received selection/final official receipts and published the new draft. The first attempt and all uncertainty remain recorded; this is separate inference, not recovery of the first attempt.

The product-route ledger is **$4.88104 reserved / one $20 cap**, including **$3.42992 historical carry**. Local history is **11 dispatches** (8 original, 1 first correction, 2 second correction), **12 count operations and 106 reads**. The six carried sources were independently checked inactive; those sources have another 26 historical dispatches, so 11 is not a project-lifetime dispatch total. Zero unknown *generation usage* does not reconcile the outstanding count-only observation. Reservations are not billing. External review-model billing is not established by this product-route ledger.

## Remaining limits and next decision

- This is a new clarified draft, not a guarantee that prompt guidance fixes all future views or that the original artifact changed. It remains unaccepted/unverified product work.
- Phone cards are long/repetitive and can require nested scrolling; direct touch reached all content. Physical-device/screen-reader coverage is not claimed.
- This draft offers £300/£350 choices with fixed capacity/access criteria, rather than the old broader explorer. The old artifact is retained. No arbitrary-budget capability is claimed for the new one.
- Original criteria are embedded from this explicitly supplied brief. Rebinding to a table with different task criteria requires a newly generated draft; shape checks cannot establish semantic compatibility.
- Browser refusal/unknown tests supplement, but do not replace, historical backend authority tests. This pass exercises reload/reopen, not another all-process restart or unseen-error autonomous recovery.
- The original count-only uncertainty remains open. No new feature slice or unrequested redesign starts from these findings.

The narrow evidence recheck is complete. Andrew can now judge the clarified experience and decide acceptance. Keep #13 open unless he explicitly accepts; merge/deployment remain separate authorization.

[Allowlisted evidence and hashes](../../evidence/flexible-work-13-criteria/manifest.json) include the generated body, exact replay source, current/historical browser reports, screenshots, backend/build/CI results, all review verdicts and original/corrective receipts. Credentials and private provider payloads are excluded. The evidence branch has no backend/web/contracts/migration difference from the tested application; its documentation commit is not relabeled as the application SHA.
