# Overnight integrator status — batch1 handoff

Status: CONTINUE. Useful implementation delivered; no parity or mission-complete claim.
Started2026-10-15T04:41:18Z; batch limit90min. Sole integrator, isolated branch
`hermes/overnight-intelligent-work`; original live review checkout/data/build untouched.
No `web/` authored by integrator. Owner ancestry through `bb82644` integrated.
Owner later `3b38d55` fetched but NOT integrated/reviewed; inspect next batch.

## Delivered

Backend `ce7c4d7`: bounded, scoped read_saved_work for omitted current revisions on
ordinary untargeted follow-up, read-receipt gated edit admission, pending-only CAS.
`f0a53e4`: independent-review fixes enforcing protected human notes and SQL receipt
identity. `5b3e339`: cross-format tests and policy clarification. SQL001–024 unchanged;
new025/026 only; no API contract regeneration needed; old grants fail closed.
Frontend owner: workspace routing, terminal-error body suppression, truthful held
scope, work cards, human document-part/note editing. Actual human note save/readback
and reload exercised on disposable controlled fixture, not old live evaluation.

## Verified / limitations

-156 focused existing backend tests passed on first implementation.
-79 retrieval/alpha/flexible tests passed after reviewer fixes.
-39 final retrieval tests pass on `5b3e339`: document/table/custom-view, revocation,
 concurrent saves, unread publication denial, bounds, restart, SQL receipt forgery,
 protected-note omission/change/rename/unprotect rejection. Suites overlap; do not sum.
-265 Vitest pass +type/lint/format/production build on exact owner `bb82644` mirror.
-7 real-service workspace-routing and15 Space Chromium cases pass.
-6 parent-controlled retention probes pass, including401/404 and keyboard/form holds.
-Desktop,320px and human-note screenshots actually viewed. Browser Use screenshot
 capture timed out; separate Playwright captures succeeded, retained and viewed.
-Full backend suite NOT newly run/green. Historical1176pass/4obsolete docguards remains
 historical. No live model/provider call this batch; all new decisions controlled.

Independent review `independent-backend-review.md` at `ce7c4d7` found two blockers;
parent reproduced/fixed/tested them. Follow-up independent review could not launch:
one-shot delegation limit2/2. Final independent reapproval remains pending.

NEW parent frontend P2: full conversation Refresh does not reread work cards when
message count unchanged. Controlled changed-title/next-read404 probes each produced
zero artifact reads and retained old preview. Not a server authz bypass. Routed to
sole owner, comment6185232681 exact readback verified. Earlier comment6184636381 also
verified. Do not create a substitute frontend writer; comment alone isn't resume.

## Evidence and runtime

Detailed report: `docs/OVERNIGHT_20261015_BATCH1.md`.
Private evidence: `.local/overnight-batch1/` (all failures retained).
Fresh tests DB env `test-v3.env`; never print values. Repo Python command from backend:
`env -u PYTHONPATH -u PYTHONHOME /home/ubuntu/workagent-adaptive-execution/.venv/bin/python`.
Browser fixture: `browser.env`, `browser-ids.json`, `browser-fixture-retry.txt`.
Build mirror: `.local/overnight-batch1/frontend-v2/web` exact owner bytes; dependency
symlinks only there, not source web/. New test API/web ports8152/3152 were stopped
and verified closed at batch exit. Original3151/8151 were verified still listening;
the original review checkout remains untouched. No new candidate preview is left running.
Original six-admission live evidence under original checkout `.local/space-evaluation-next`
remains authoritative; no human safety note saved there, no repaired replacement runs.

Read-only budget reconciliation2026-10-15T05:24:17Z: union reservations$8.97056;
exhausted successor14dispatch/14count/100read,$1.84688reserved. Authorization$40,
encumbered$24.617200,unactivated$15.382800. NEW product spend/calls0. Billing/route/
current pricing not newly reconciled. Two unknown counts remain quarantined.

## Next batch, mechanically

1. Check STOP, batch-result.json, git exact SHA/status. Fetch owner once; inspect
   any card-refresh fix and `3b38d55` before integration. Keep sole ownership.
2. Obtain ONE focused independent exact-candidate follow-up review of f0a53e4
   receipt/note fixes and owner changes; reuse unchanged review. Recheck required
   negative browser cases; no full broad review restart.
3. Establish safe fresh exact-candidate successor only after review and actual
   ledger/pricing/route reconciliation inside existing$40. Never reuse old admissions,
   repin historical hashes, resolve unknown counts, or alter original live state.
4. Run bounded held-out natural tasks/follow-ups across materially different work,
   actual human correction, preservation, resume and evolving representations.
   Keep every failure; no coaching/replacements. DirectGLM5.3 critique if safe route.
5. Finalize useful morning evidence/gaps; feature branch only, remote SHA/readback
   verification. Broad intelligent UI/initiative/memory/baseline parity remain OPEN.
