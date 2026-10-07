# Adaptive product integration checkpoint

Candidate branch: `hermes/adaptive-product-integration`; isolated checkout. Existing hands-on demo and protected databases remain unchanged. No default-branch merge or deployment.

## Product and actual browser verification

- Preserved Claude's delivered frontend commits `9e731eb`, `d1f10be`, `f7e8871` by cherry-pick. A local Claude continuation failed OAuth refresh before editing or spending; Hermes implemented the remaining bounded UI integration.
- Conversation and work companion distinguish saved results awaiting review, model examples versus supplied human checks, retained-but-unpublished work, actual changed operations after failures, and provider uncertainty. Full evidence stays in closed details. No acceptance-check form is required for ordinary prompts.
- `pnpm check`: **109 tests pass**, typecheck/lint/format pass. Production build uses `NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1 pnpm build`.
- `scripts/verify_adaptive_product.py` + `.mjs` exercise browser → real proxy/API → PostgreSQL → GeneralWorker → real Wasmtime. Provider HTTP alone is explicitly synthetic; this is NOT live-model adaptation evidence.
- Final fixture: `workagent_test_55426e78c95e`, `.local/adaptive-browser-final.env`. Fresh14-migration database; private screenshots, traces, request assertions and readbacks: `.local/adaptive-browser-final/`.
- PASS: ordinary composer prompt; rejected executable attempt then different working implementation; tool output3750; saved human note; separate work/conversation draft persistence through mobile switch/reload; revision-bound follow-up; proposed change does not overwrite human revision; explicit acceptance; exact-byte WAT download; Home/Work reopen; process stop/restart readback;1440px/390px/320px; no horizontal overflow, browser errors, external browser requests or replayed POST on restart.
- Browser discovery fixed: dispatcher treated every partial result as a fatal rejection and exited, abandoning later human messages. It now keeps watching after confirmed published `needs_validation` only. It does NOT retry the terminal turn; unknown/invalid/cancelled/unpublished outcomes still stop.11 targeted dispatcher/readback tests passed before final gate.
- Build-configuration discovery: natural admission must be enabled at build time, otherwise exact-target follow-ups are omitted. The final verified build explicitly enables it.

## Budget continuity and review

- Read-only inventory of220 local Workagent databases identified actual project reservations: prior intake4 dispatches/$0.527680 + prior general8 dispatches/$1.055360 = **$1.583040**, not billing. Both original grants are generation- and run-limit exhausted; originals are not altered.
- The earlier$19.919920/151-dispatch figure was a **synthetic budget-exhaustion fixture**, not live spend. It must not be used as the live-project balance.
- Private source manifest `.local/source-budget-manifest.json`, SHA256 `8bb77a5fe50eae46f792b70a228f1b1d45d0c8c960adb5e27d02e4ccd459c534`; all prior liabilities retained, no refunds or manufactured provider events.
- Additive014 introduces owner-only immutable carry assertions, globally unique per source grant, positive exact amounts, project/mode-bound accounting and manifest hashes. Imports must precede provider I/O; local/source grant collisions are rejected. Application and database enforce carried+local worst-case reservations under the same advisory lock. This is NOT cross-server synchronization: the operator must reconcile and prove no further source generations.
- Direct Z.AI `glm-5.3` reviewed the changes. Accepted fixes: operator status exposes both local and shared budget; carry source is globally unique and amount positive. Initial lock inversion allegation was withdrawn after reviewing the already-existing workspace lock in `_receipt_binding`; synthetic/official budget separation is intentional and verified. Raw review rounds are preserved privately. Final direct `glm-5.3` verdict: **PASS**, no findings; all11 reviewed file hashes rechecked against this candidate. Final targeted regression: **48 passed** (carry, dispatcher, pure adaptive) on fresh `workagent_test_2fdf5386caee`.
- Initial integration full run:588 passed/2failed, NOT acceptance. One stale pure-summary fake lacked the new carry query; corrected. The other exposed why consumer bytes must not change during a full run (operator readback was edited while the run was active). Final candidate is frozen and a new full invocation is running on a fresh DB; do not combine these counts into PASS.

## Live model checkpoint

Not yet executed when this record was first written. Operator will bind one fresh persistent grant to exact reviewed consumer bytes, carry the$1.583040 manifest, verify official `gpt-6.1-sol` availability/current pricing, and allow one human turn, at most4 adaptive selections plus1 explanation. Synthetic context only; acknowledged `store:true`; no provider fallback, automatic regeneration, external business actions, or human approval by model.

The planned task deliberately starts with a factorial approach to an exact combinations calculator. The model may revise after real executable/independent-check failure. Held-out cases and expected answers are absent from model input; a separate Python `math.comb` oracle will evaluate every `(n,k)` in the promised domain if an artifact is published. Even full domain success is scoped to that numerical domain, not general goal verification.

## Reproduce the no-provider browser checkpoint

```sh
cd web
NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1 pnpm build
cd ..
env -u PYTHONPATH backend/.venv/bin/python scripts/verify_adaptive_product.py prepare --env .local/NEW.env --output .local/NEW
env -u PYTHONPATH backend/.venv/bin/python scripts/verify_adaptive_product.py run --env .local/NEW.env --output .local/NEW
```

Preparation refuses existing fixture paths and uses unchanged `dev_db.py`; no existing database is reset. Ports3120/8120 are separate from the saved3000/8000 demo. The operator installs a narrow conversation grant after real browser conversation creation; this is not standing production authority for every new conversation.
