# B3.2a acceptance — grounded research mechanisms

**ACCEPTED for this implementation slice, not live-model usefulness, paid search, deployment, B3.2 or Batch 3 completion.** Base: `e1db70df77957de6aca842bc6f47ebb0f133008e`, feature branch `hermes/b2-conversational-client`. The final commit/remote/CI identities are recorded in the task publication receipt; this document does not pre-assert CI success.

The missing original-working-file citation consumer described in the retained `VERIFICATION_HANDOFF.md` is **closed by the newer Claude-owned consumer repair**. That handoff remains historical evidence, not the current acceptance verdict. The two previously mismatched source entries are rebound in the final `SOURCE_MANIFEST.json`; the old manifests remain under `history/`.

## Delivered behavior

- Shared broker adapters expose scoped `research.search`, public capture and exact claim/evidence references. Search snippets are discovery only, not captured evidence. Exact query/processor/URL/browser selectors require actual egress authority; a read grant alone is insufficient. The production search processor is explicitly unavailable, not replaced with invented results.
- Immutable public snapshots retain raw/extracted hashes, requested/final URL, retrieval/version metadata, extractor, coverage/omissions and exact quote ranges. Refresh creates new source versions, marks dependencies potentially stale and proposes changes without overwriting the saved human conclusion. Quote attribution is not a semantic truth judgment; unsupported claims and source disagreement are explicit.
- Existing DNS/address/TLS/redirect defenses remain. Optional fallback renders captured public HTML with pinned Chromium in an offline bwrap namespace and bounded cgroup. It has no account state, host profile, private network, navigation, mutation clicks, forms or downloads; remote assets/scripts are unavailable and incomplete coverage is disclosed. Missing confinement or pins fails closed with no host fallback.
- Restricted-PostgreSQL dependency checks cover shared observations, retained results, ledger authorization and SQL count/dispatch. Migration060 follows retained `read_result` dependencies transitively with cycle-terminating `UNION`; revoking capture A denies derived B/C access and future dispatch while preserving original receipts/accounting.
- Web and native readers expose sources, exact saved-version citations and freshness. Web canonical404 denial clears dependent claims/quotes and fences late responses. Explicit refresh rereads saved metadata, not the public web. Claude alone authored the web changes.

## Actual verification and exact bindings

`BUILD_BINDING.json` verifies **521 candidate input files**, **56 changed source files** in `SOURCE_MANIFEST.json`, **15 independent-review correction hashes**, and both final working-file browser proof records. Build ID **`f81VUigyJq5lbmurBaPTo`**, isolated `.local/batch3/b32a/candidate/web/.next`;183 non-cache build outputs are hashed. All copied web/contracts/runtime inputs match current source. Three backend test files differ in the unused candidate copy; the recorded tests executed current repository-root files, not that copy. No claim of all candidate files matching is made.

| Check | Observed result and evidence |
| --- | --- |
| Current focused research/PG/revocation/native/retrieval checks | **37 passed**, one Starlette deprecation warning; `checks/focused-08.log` |
| Tightened prepared/count SQL assertions | **2 passed**,2 deselected; subset rerun, not two extra unique tests; `checks/revocation-exact-09.log` |
| Real deterministic HTTPS + restricted PG search/fetch | **3 passed**, one warning; `checks/http-pg-01.log` |
| Earlier focused web readers/sources/races | **38 passed**; `checks/web-focused-02.log` |
| Final Claude consumer + adjacent focused web checks | **67 passed across5 files**, typecheck/lint/Prettier exit0; `checks/web-consumer-*.log`. Overlaps the earlier38; do not add the totals. |
| Canonical contracts | generation/check and final check exit0; `checks/contracts-02.log`, `checks/contracts-final-03.log` |
| Final isolated optimized web build | exit0,7/7 static pages; `checks/web-consumer-build-01.log` |
| Original working-file browser | PASS before and after owned-process restart at1440/390/320; `checks/browser-file-citations-04.log`, `checks/browser-file-citations-05-restart.log` |
| Separate mounted document consumer | PASS actual canonical404 quote clearing and explicit freshness refresh without reload; `checks/browser-document-05.log` |
| Real native PTYs | PASS100×45 and80×35, ordinary composer/edit/save/cite/changed-source proposal, exact human text reopened after restart; `pty/`, `checks/native-*-final.log` |
| Exact restart/no-repeat comparisons | PASS immutable snapshots/raw bytes, human revision, proposal and receipts; `restart-proof.json`, `records/*readback.json` |
| Reused earlier baseline checks | **85** targeted checks, **6** restricted-PG checks, **4** actual offline Chromium confinement checks; `checks/tests-01.log`, `checks/pg-03.log`, `checks/browser-isolation-01.log`. Earlier overlapping checks, not additional disjoint totals. |

The real restricted-role regression pauses the actual production worker after tool result, after preparation and after counting. With only source A revoked, B's grant remains active: both observation endpoints change200→404, snapshot/prepare/count/dispatch deny, direct restricted SQL cannot bypass the guard, and worker resumption adds no provider generation/count. Recursive retained-result dependency coverage is included. Historical tool/provider/cost rows and human revision compare equal.

## Human work and client evidence

The original browser's real `research-conclusion.txt` editor binds artifact/revision/body hash from the validated work snapshot, matching the exact saved version. Unsupported99-unit and stale10-unit claims render, both10/12-unit source versions load with exact hashes/URL/ranges/coverage, and quote offsets match. Both final browser records have only GET requests. Refresh preserves both saved and unsaved textarea content and the citation binding without navigation; all three widths have no horizontal document overflow. Parent inspected the narrow rendered claims crop, not a loading skeleton.

- Browser human UTF-8 SHA256: `f72e37e4a2e656e9dd9d6830cb089f5650f9a24c4fa4c12034cf176497d7b8bd`.
- Browser saved revision: `5f0ee19e-3b1f-4e68-b15f-ed31d54c469c`; artifact body hash: `1c69d66ee30e34106ea248e67752e6bde6f8149bd55befa27ab872c7aac34e50` (distinct from file-byte SHA).
- Native human UTF-8 SHA256: `e43a2f4dd56d853d272326fbcd06331c4a46d329d7a557fc6b2b9bc84def85c5`.
- Per main conversation, before/after restart:7 tool attempts,14 tool events,14 tool costs,75 provider events,2 source snapshots and3 completed runs. Completed-run re-entry produced **zero repeat provider calls**, not zero initial controlled calls. The proposed source update remains unaccepted.

Exact source hashes and readbacks are in the proof records and prior verification handoff. Original browser fixture02 and native/document fixture03 remain separate; no historical grants/pins were rewritten to hide incompatibility.

## Independent review and retained limitations

One Astra/high independent risk review, followed by its bounded correction closure: `REVIEW_INITIAL.md` preserves REQUEST CHANGES; `REVIEW_CLOSURE.md` gives **PASS for narrow code closure** and closes P1/P2/P3 plus the working-file mount. Reviewer inspected source/evidence, not independent runtime execution. Its only remaining condition—parent binding of the completed consumer proof and current build—is satisfied by `BUILD_BINDING.json`. No replacement reviewer or second Claude writer was launched in closure.

- The controlled local HTTPS/search/model transport is a mechanism demonstration, **not live search/model usefulness** or a blinded evaluation. `public-fetch.json` separately records an actual authorized HTTPS200 fetch of `https://example.com/`; that is not a search trial.
- No new paid product calls, route/processor, account access or allowance. Development Astra/Claude tools are separate from the product ledger; costs are not claimed as settled billing. Historical allocations, uncertain liabilities and HOLD receipts remain unchanged.
- Refresh currently collapses the citations disclosure; reopening works, with data/binding/text intact. The file editor is the accepted consumer; artifact-detail route still lacks citations. These are disclosed limitations, not silently completed UI coverage.
- No full-suite rerun, full web `ci` local rerun, installed-runtime promotion or production release claim. GitHub exact-head CI is a separate publication check.
- Original failed harness runs, failed PG attempts, review findings and unknown outcomes remain retained. `RETAINED_FAILURES.json` indexes private failure/diagnostic logs by hash; passing tests containing deliberate exception traces are not reclassified as failed tests. Provider/Cloudflare diagnostics and secrets stay private.
- Existing unrelated `contracts/pnpm-lock.yaml` is preserved/untracked. Isolated memory-link repair `d8c0bc04689d1b50698bcd4f6b141e3f2ce0d0cf` and later Cloud changes are **not integrated**; shared page/Cloud reconciliation remains explicit.

`EVIDENCE_MANIFEST.json` hashes the sanitized evidence package. Known disposable-fixture credentials and worker secrets are scanned; raw review transport diagnostics, env files, keys and private worker/session state are excluded. Owned proof-service shutdown is separately recorded in `RUNTIME_CLOSURE.json`; installed services/data are not touched. Existing successor **`t_acf5c8f0` (B3.2b)** is released only when this accepted slice's publication/CI closure finishes.
