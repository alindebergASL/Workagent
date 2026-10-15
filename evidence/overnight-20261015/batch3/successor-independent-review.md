# Independent successor helper review — BLOCKED

Engineering review only. **No live-spend approval; do not activate this helper.**

Candidate: `aedc130bef067fdfb390c34a2beae768d01ebd0a` (clean at final check).

Reviewed bytes, unchanged at final check:
- `successor.py`: `dee55a31e26076d9eaa9bf3eec2eee514ff4dab4be803db12d9a8d6d312b626b`
- `test_successor.py`: `7282a001c9efaf1aa1b904e2220720a95a5a49ad7e1fa7d1b2575ee43f58808e`
- Preparation helper: `2040f1397c7eb4ce89cd18ba6f269941216a3c974b07837a7d86ddfb020efc12`

## Concrete blockers

1. **Real clone inventory cannot execute** (`successor.py:107–111`). `old.reader()` retains its original database allowlist. `inventory()` calls its `read()` for `workagent_test_47b87fe3b82e`, which is absent from that allowlist. A direct READ ONLY probe twice reproduced `AssertionError` in `read-current-paid-accounting.py:23`, before any target connection or write. This blocks real draft and all source-stability gates. Parent tests replace those gates and therefore miss it. Fix only the NEW helper's explicitly bounded reader namespace; do not modify/repin the historical reader or historical SQL.

2. **STOP is checked per worker visit, not before each paid operation** (`successor.py:260–263,293–299`). A real `GeneralWorker` + concrete `ResponsesTransport` with `httpx.MockTransport` created STOP when the first input-count response arrived. The same worker visit subsequently performed **two generation POSTs** (selection and final) and returned ready. The safety assertion fails under `--runxfail`. STOP does block the next visit, but one visit may contain multiple count/generation/read operations. A pending-response test also observes a same-visit GET after STOP. If STOP is intended to prevent further paid operations, an unbypassable pre-I/O hook/check is needed. Merely rechecking between visits does not establish that property. SQL grant revocation during count *does* block generation in the paired control.

3. **Freshness is not bound to the account observation** (`successor.py:209–218`). `review.account.checked_at` is checked, but `account.checked_at` in the hashed observation is not compared. A 30-day-old account observation, accurately hashed in the review, passes `check_package()` when the review wrapper supplies a current timestamp. The actual candidate/policy/grant/route validators were retained in this test; only unrelated source access/dependency setup was isolated. Bind evidence timestamps/content, rather than permitting the wrapper to re-date old evidence. This is a fail-closed preflight gap, not evidence that the actual account is unavailable.

## Executed tests and bounds

- Existing parent tests on newly provisioned disposable DB `workagent_test_20a1455f2a86`: **15 passed** (`parent-tests.xml`). Includes real transactional configure/install/readback, failure rollback with retained nonrefundable intent, synthetic runner, once-only behavior, and source-change denials.
- Independent gates/runner: **24 passed, 2 xfailed** (`independent-tests-v2.xml`). Actual `check_package` validates missing review, decision, package/helper/candidate/authority pins, account/pricing/engineering hashes, stale wrapper observations, wrong account/model/project, grant limits, allocation, and route freshness. Same-ID polling uses two phases, two original generation IDs, repeated GETs of those IDs, and one provider attempt; replay makes no requests.
- Independent inventory negatives: **5 passed** (`inventory-tests.xml`): new clone-only events included, copied events deduplicated, changed duplicate rejected, carry mismatch rejected, quarantined-unknown reconciliation rejected, unexpected new unknown rejected.
- Safety failures rerun without expected-failure handling: **2 failed, 1 passed** (`blocker-reproductions.xml`): stale-account relabeling and intra-visit STOP fail; mid-count grant revocation passes.
- First independent harness run had three harness expectation/key errors. Preserved in `independent-tests.xml`; corrected only reviewer tests. They are not product findings. One unrelated Starlette deprecation warning.
- No full backend suite, live transport, actual installation, grant activation, actual helper draft/install/run mode, or provider credential read. Only the newly generated disposable DB env was sourced. Source-stability readbacks use the existing credential-free sudo/READ ONLY reader. No production source or reviewed helper edits.

## Read-only actual-state verification

`readonly-probe.json` and `readonly-after.json` preserve actual inventory failure evidence. Independent readback extended the reader's allowlist **in memory for this reviewer only**, not candidate code, solely to inspect the known clone.

- Original and clone each match all **33** preparation-manifest table counts/hashes. Actual clone remains entirely inactive.
- Both unknown attempts retain exactly `['count_send']` in final phase:
  - `48a1a403-eb54-4d65-9d31-4fa3dfa7476f`
  - `14a54941-e1e5-41da-931f-7b63a1bf0b03`
- Deduplicated known all-lineage events including clone: **68 dispatch, 70 count_send, 566 read, 0 cancel**, reserved cost **8.97056**.
- Clone-local events: **42 dispatch, 44 count_send, 377 read**; local reserved cost **5.54064**, carry **3.42992**, shared total **8.97056**. Copied events are not charged twice.
- Mission encumbrance is distinct from dispatched liability. The stated prior **24.617200** plus six new slots **0.791520** would equal **25.408720**, leaving **14.591280** of 40, **only if installed**. I verified arithmetic and exact helper allocation gates, not an independent account-wide reconstruction of the prior mission authorization receipt chain. No actual package, parent-review, or installation-intent file exists at final check.
- Historical SQL019 remains unchanged; the synthetic successful installer uses fresh conversations, not renewal of old conversation grants.

## Artifacts and limits

All reviewer writes are under `.local/overnight-batch3/successor-review/`: this report, `test_independent.py`, `test_inventory.py`, `probe_readonly.py`, XML evidence, private disposable env, and pytest temporary synthetic evidence. Disposable DB retained for inspection. Never print its env file.

This review does not validate live account/pricing, model usefulness, UI, actual operational process-exclusion scanning, or live spend. Per-visit source gates have negative-test coverage, but neither STOP nor source stability is rechecked between individual provider operations within one `worker.work()` call. Fix blockers and independently re-review changed helper bytes before any activation.
