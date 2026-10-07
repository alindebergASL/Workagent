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
- Initial integration full run:588 passed/2failed, NOT acceptance. One stale pure-summary fake lacked the new carry query; corrected. The other exposed why consumer bytes must not change during a full run (operator readback was edited while the run was active). The subsequent clean integration invocation passed **592 tests**; that result covers the earlier integration candidate, not later transport corrections.

## Live model checkpoint

Completed bounded live checkpoint on 2026-10-07 using official `gpt-6.1-sol`, synthetic context only and acknowledged `store:true`. Implementation candidate: `ad9c9b8825f1b47f9c763ad3f93fca2f40bb9060`; consumer SHA256: `e0bf29e549a6f34b858d1a6df34215f756cfdbe66358cc3bf1f11008695d5969`. No provider fallback, automatic regeneration, external business actions, or model-granted approval.

### Provider recovery and independent review

The first live result could not be parsed because persisted responses omitted encrypted reasoning content. An initial retrieval-option correction exposed an actual HTTP400: `Encrypted content cannot be requested for persisted responses`. That GET option was removed. Stored continuations now preserve complete original provider reasoning items; stateless parsing still requires ciphertext. The stored relaxation requires full originating-request policy validation, not an unchecked `store:true` claim.

Direct Z.AI `glm-5.3` review returned PASS after follow-up. The original create-time `store:true` plus `include` behavior was verified against original immutable accepted identities and exact request hashes, without new generation. Five tampered-request regressions were observed failing before the validation correction and passing afterward; **168 focused tests passed**. The review retains one nonblocking future-policy caveat: if storage ever becomes per-phase/configurable, rebind continuation storage semantics explicitly; current fixed policy pins storage for every phase. All four reviewed file hashes matched the integration candidate before live use.

User-approved recovery installed the existing owner-only, immutable, exact-consumer successor approval. It recovered the second checkpoint's already-created selection response; no replacement grant, new human turn, reset, rewritten receipt, or selection regeneration. Database readback shows exactly one dispatch per phase: `selection`, `selection_2`, `final`. The first checkpoint's failed receipt and reservation remain retained.

### Engineering and useful-result evidence

- The prompted first approach was the straightforward factorial formula. Actual Wasmtime execution returned `-3` for `(60,30)` and failed four of the eight supplied acceptance cases. This was an intentional stress case, not spontaneous task discovery.
- After receiving local failure feedback, the live model changed its implementation to a symmetry-reduced multiplicative recurrence. The operation hash changed, all eight supplied checks passed, and a tool plus exact WAT file were published.
- The exact saved code SHA256 is `e4ee01db3c6fd27d82a101da061a762207a862ab3c06c49369badd94deb653b0`. Independent Python `math.comb` comparison passed **1,891/1,891** integer pairs in `0 <= k <= n <= 60`, executing each pair through the real Wasmtime capability. This is exhaustive evidence for that finite numerical domain only.
- The private supplied-check specification remains absent from model request context. Model-proposed tests remain separately labeled. Saved run state stays `partial`, adaptive outcome `needs_validation`, and verification `satisfied=false`; the independent external oracle did not mutate these into general goal completion.
- **109 web tests**, typecheck, lint and format check passed again. Canonical contract export check passed. Exact-candidate full backend regression: **602 passed, zero failures/errors/skips**, on fresh `workagent_test_c60f08733e41`; receipt `.local/stored-final-corrected.xml`. One dependency deprecation warning remains. The first invocation from the repository root failed import collection before tests ran; the corrected package-root invocation is the complete clean run. Consumer bytes stayed frozen throughout; earlier full runs are not substituted for this result.

### Actual live browser experience

Real browser readback reached the published live tool and displayed `118264581564861424` for `(60,30)`. Desktop,390px and320px checks passed before and after restarting the isolated3120/8120 services. Download bytes exactly matched the persisted code, the artifact revision stayed unchanged, and the browser recorded no mutation requests, external requests or page errors. Conversation presentation said “Result saved — needs review,” “Supplied checks passed — those cases only,” and “Changed approach after a failed check once.” This browser read/download check did not submit an additional model turn or rerun through the input form; broader input execution is established by the independent capability oracle above.

**Visible limitation:** the existing broker's generic title is “Invoice total tool” even though this artifact is a combinations calculator. Numerical usefulness and truthful conversation feedback are demonstrated, but this is not a claim of finished product labeling/polish. No unrelated UX expansion was made during the frozen regression run.

### Budget and retained evidence

Cumulative worst-case reservations are **$2.110720 of the shared$20 ceiling**, including **$1.583040** carried historical liabilities and both live checkpoints. This is NOT confirmed provider billing. The completed recovered turn has no unknown usage steps. Protected historical source grants, run counts, dispatch counts and reservations were re-read as unchanged after recovery; the denied database was not touched.

Private local evidence (not checked into the repository): `.local/adaptive-live-02/stored-recovery/` contains successor approval, before/after status, immutable response bindings, full case-by-case oracle output, artifact readbacks, exact WAT downloads, screenshots, browser request reports and traces. `.local/stored-reasoning-glm53-followup.json` binds the reviewed file hashes. `.local/source-budget-post-recovery.json` records read-only historical source verification. The existing3000/8000 demo is unchanged; no merge, push, or deployment is claimed.

## Tool-label follow-up

Removed invoice-specific defaults from the general Wasm tool path. New titles derive from the validated entrypoint (`choose tool`); generated-file and tool downloads use matching `tool-choose.wat` names, including the browser's actual download action. Existing saved titles and immutable file bodies are not rewritten; revisions retain the saved title. No schema change, migration or product-model generation was needed.

Four name regressions failed before the correction. Verification: **64 focused backend tests**, **608 full backend tests** on fresh `workagent_test_2d42f29082e7`, **112 web tests**, typecheck/lint/format, production build and contract check passed. Direct Z.AI `glm-5.3` review returned PASS without findings; reviewed file hashes matched the candidate. A new controlled fixture—not live model evidence—verified the real title, actual suggested download filename and exact code bytes at1440px/320px. Private receipts: `.local/tool-labels-{focused,full}.xml`, `.local/tool-labels-review.json`, `.local/tool-labels-browser/`. Earlier live evidence above is preserved unchanged.

## Reproduce the no-provider browser checkpoint

```sh
cd web
NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1 pnpm build
cd ..
env -u PYTHONPATH backend/.venv/bin/python scripts/verify_adaptive_product.py prepare --env .local/NEW.env --output .local/NEW
env -u PYTHONPATH backend/.venv/bin/python scripts/verify_adaptive_product.py run --env .local/NEW.env --output .local/NEW
```

Preparation refuses existing fixture paths and uses unchanged `dev_db.py`; no existing database is reset. Ports3120/8120 are separate from the saved3000/8000 demo. The operator installs a narrow conversation grant after real browser conversation creation; this is not standing production authority for every new conversation.
