# Parent integration: controlled general work, not a CSV product reset

## Candidate lineage and authority

This report accompanies the published non-default integration candidate on PR #9. The full current SHA is pinned in the PR handoff, not a self-referential SHA inside its own commit.

Preserved/reused, not reconstructed:
- Backend `8ef4aabd53540d804ea580db8b1c9297f8508012`.
- Reviewed product integration `092c9c4392083c742df3326ec6f418019de49372` (descendant of that backend and parent6924a80).
- Latest compatible published Claude delivery `e30ed034a70e3c3cebb3c6c327b329e299be2b82` merged without conflicts at `20664ba912a0252069a963fa060afd39a92825a0`.
- Runtime failure-isolation/merged verification code at `4664e744c7fbb4922fc1646ca9dcbdbb9da27219`. Report/contract wording, synthetic evidence and a test-helper Fetch `ok` property fix follow; application/backend/contracts are identical to that runtime commit.

No reset reapplication, alternate frontend, new harness, schema/profile mutation or new model loop. Claude retains frontend ownership. Parent compatibility changes to Claude's browser script assert the service's authoritative queued/cancelled reason rather than superseded local wording; no redesign or second product-surface implementation was commissioned.

Authorization permits publication/integration of non-default development branches. No new Workagent inference, provider SDK/key lookup, spending, private context, external business effects, default-branch merge or deployment occurred.

## Published contracts and owner coordination

First checkpoint: [PR #9 comment5998325623](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-5998325623), read back byte-for-byte after publication. Both backend8ef4aab and actual reviewed092c9c4 refs were published and remote-SHA verified. The comment links exact generated OpenAPI, TypeScript, examples and explicit local registry, plus reproducible CLI/browser cases.

The older **B1 ACK is present**, [5964941294](https://github.com/alindebergASL/Workagent/pull/5#issuecomment-5964941294); earlier “no ACK/no real frontend” claims are superseded. **B2/B3 exact-contract acknowledgment is still pending** as of this report's final PR read. Posting does not restart an idle Claude session and is not an ACK.

Generated contracts distinguish legacy Body and typed table/file/tool bodies, authorized typed PostMessage operations, immutable execution observations, proposals/revisions, safe downloads and explicit turn outcomes. Wasm `ObservationReadback.observation.output.value` is an exact decimal **string** in JSON; stored/internal integers and legacy body hashes remain unchanged. UI must not convert it to Number. Contract prose is corrected to match the generated schema.

## Personally rerun on the merged runtime

- **403 backend tests passed**, no skips, one existing Starlette deprecation warning, **469.90s**, fresh PostgreSQL `workagent_test_12ee13643bca`. Log `/home/ubuntu/.hermes/cache/scratch/workagent-parent-4664-tests.log`. Covers legacy/B1, additive upgrade, B2/B3 permissions, immutable bindings, malicious tools, crash/restart/replay/revocation/conflict and new failure isolation.
- **75 frontend tests**, TypeScript, ESLint, formatting, production build: passed on merged frontend (unchanged by subsequent runtime-only correction).
- **15 mock Playwright regressions**, desktop/390/320: passed with explicit `/api/mock` build. Evidence goes to `.local/parent-integration/mock`; existing owner evidence was not overwritten. Real-mode build restored afterward. Mock tests are labelled UI regression, not execution proof.
- **8 fixture DOM regressions**: passed, including attachment races, reload-safe exact payload, late old responses unable to erase newer retry state, saved-vs-pending observation, same-base discard and initial unavailable. Explicit fixture transport, no execution claim.
- Generated Python JSON/OpenAPI, TypeScript drift and contract typecheck: passed.
- **Real B1 UI/API/PostgreSQL** rerun after runtime fix using Claude's journey: source-free entry, steering, CAS, lost-response/reload/replay, paused handover, Activity, cancellation. `.local/parent-integration/4664-b1/result.json`. This deterministic stepping test intentionally disables the continuous consumer; the product/recovery tests below independently prove automatic advancement.
- **Real CSV first, then tool**: normal local Stack with API/web/continuous controlled Dispatcher (same GeneralWorker), no manual tick. Edit/save/export/reopen, original data/human notes, proposal acceptance, stale second-tab CAS, forms, observed results, shipping requirement change, desktop/phone and malicious import rejection passed.
- **Actual lost acknowledgment**: browser admitted operation, dropped successful HTTP response, reloaded and retried exact bytes; no duplicate operation/product. Large signed result `9007199254740993` renders exactly. Unchanged saved-tool rerun shows pending output separately while saved verification stays valid.
- **Actual consumer outage and process restart**: stop continuous consumer while API/web remain available; queued turn becomes explicit unavailable after bounded wait, zero fabricated replies. Restart web/API/Dispatcher, observe the same run complete, then reopen saved CSV notes, saved tool4250 and exact large-i64 observations in a fresh browser context. No new run required for recovery.
- **Actual multi-process CLI**: prompt/continue/inspect through same worker/domain, CSV and Wasm changed requirements and preserved notes passed; no delegated assignments. `.local/parent-integration/4664-cli.json`.

Fresh product/recovery database: `workagent_test_f0632d54bc21`, recorded in `/home/ubuntu/.hermes/cache/scratch/workagent-parent-browser.log`. Fixture evidence records exact IDs and digest bindings. All content is synthetic.

## Actual observations and portable evidence

[Machine-readable observations](evidence/general-parent/observations.json) lists runs and SHA256 digests of full local evidence. Representative cases:
- CSV initial `718b0339-2dac-4e20-9167-9ba2ae472240`, changed rounding `0d0a0108-bd8f-4e3f-b532-1447b3616110`: reported78.40 vs calculated77.40; row B calculated37.50; saved human row/top notes and original cells retained. HALF_EVEN does not change this fixture's totals.
- Tool initial `49360b2d-02d6-41ce-9ebe-eb4e3bbdbc67` returns3750; shipping `6f6b39e2-2327-4c42-a32b-36a45df5be1c` returns4250 from saved code and inputs `[3,1250,500]`. WAT download is byte-equal to fixture, note retained.
- Malicious import `523084f1-5404-40ce-a596-40f1d81303f7`: failed projection with `imports forbidden`, no fabricated successful output.
- Exact-i64/retry `dff52c43-ff07-4cf7-974c-01b460c6ad50`, pending rerun `bd7736df-229b-49b6-a524-e3163706f6eb`.
- Consumer-outage/recovered same run `2adba0a4-cd3d-4313-97f1-cfd80d18d414`.
- CLI changed CSV `3b3e8835-6092-47e2-8b0b-878486f55159`; CLI shipping `1cbae0a3-aea9-43c8-803a-55775ad60289`.

Published screenshots: [table](evidence/general-parent/table-desktop.png), [table320](evidence/general-parent/table-320.png), [shipping tool](evidence/general-parent/tool-shipping-desktop.png), [consumer unavailable](evidence/general-parent/consumer-unavailable.png). These are actual app captures, not prototype/mock screenshots.

## Narrow runtime correction

Unexpected ordinary transport/validation errors after claim previously escaped the GeneralWorker and could abort the batch. The worker now attempts one bounded fixed-reason failure publication via existing authority. It rechecks context/capability, never publishes exception contents, preserves already committed success/failure on lost ACK, and defers if authoritative recovery is unavailable. SystemExit/KeyboardInterrupt retain crash semantics. Direct GeneralWorker and continuous Dispatcher both advance the next healthy independent turn. No scheduler/framework was added. Publication still requires current scope/fence; revoked/cancelled/stale authority cannot commit failure or success.

## Reproduction

Use installed backend venv plus optional hash-pinned `requirements-local-tools.txt` (Wasmtime49), and build real-mode web. From repository root:

```sh
pnpm --dir web check
pnpm --dir web build
npm run check --prefix contracts
python3 scripts/verify_general_integration.py \
  --env .local/fresh-parent-verification.env \
  --output .local/fresh-parent-verification
```

Use a new env path for a fresh disposable PostgreSQL fixture; existing work is never reset. This command owns and stops its local test servers, runs CSV before tool, verifies lost-response recovery, disables the consumer to observe unavailable, then restarts all processes and reads the same saved work. The environment file contains local credentials and must not be published. For the historical B1 stepping journey, start `Stack(worker=False)` and run `web/scripts/conversation-journey.mjs`; it deliberately invokes controlled batches. Never use that as proof of automatic advancement.

## Verdicts and remaining gaps

- **Engineering: PASS for controlled integrated B1–B3 and tested recovery boundaries.** Work is wired and observed, not only visually inspected. Full general-agent/ongoing responsibility capability is not claimed.
- **Usefulness: NOT TESTED with a model or Andrew.** Explicit operator choice, attached supplied WAT and wiring replies prove machinery, not autonomous reasoning or tool creation. CSV/shipping are breadth tests, not Workagent's identity.
- **Experience: functional desktop/phone journeys PASS; full product/prototype and human acceptance NOT TESTED.** Actual captures show readable contained tables and working controls. Remaining owner work: product pages link back to conversation rather than show persistent companion conversation; tool authoring is code/comma-separated-input oriented; primary copy exposes runtime terminology. No claim of “better than prototype.” Claude/Andrew inspection remains pending, not another backend permission gate.
- B4–B7 ongoing ownership/coordination/memory remain unqualified beyond the explicitly exercised historical/domain/recovery cases; explicit handover remains paused unsupported, never falsely autonomous.
- No live adapter is enabled for this general controlled profile. Any proposed model-backed usefulness test needs a specific supported route/model, synthetic/permitted data, calls/tokens/cost/expiry and trace posture; the old exhausted grant remains closed. Do not treat this report as authorization or silently fall back to live.
