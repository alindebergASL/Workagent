# General products verification — controlled B2/B3

Base: `9a8944b387efad7b895ac7de45bd1f458bb0105f`, branch `hermes/general-products`. No push, default merge, deployment, paid calls, provider SDK/harness adoption, private-context expansion or external effects. No web/parent-status/old-evidence edits. Final parent integration and independent review remain separate gates.

## Verdicts

- **Engineering:** implemented in the actual GeneralWorker/domain/CLI and HTTP-controlled consumer. Real CSV calculation and Wasmtime execution persisted typed artifacts, immutable execution observations, exact proposals and readbacks. The final fresh full suite passed; exact result is below.
- **General usefulness:** **unverified**. Transport and guest code are explicit controlled inputs. No inference/credential access/provider dispatch occurred in these journeys; deterministic results do not establish a useful general reasoning partner.
- **UI:** **pending Claude/parent integration and browser verification**. Backend HTTP + continuous dispatcher are exercised as real processes, but this work does not claim browser/product-experience acceptance.

## Actual final-code CLI execution

Disposable database: `workagent_test_d1c364d8160c`.
Workspace: `general-products-9f9dea83-4809-4c89-b5f8-4408a3d3d614`.
Private local environment path: `/home/ubuntu/.hermes/cache/scratch/general-products-final-cli.env` (credentials deliberately not included).
Full local JSON: `/home/ubuntu/workagent-general-products/.local/general-products-final/cli.json`. SHA256: `d5bcdcb6f2c81cd14587453890193bf7645de13fd5b0d2bdce9297887b28317e`. CSV conversation: `633fb349-28ff-4843-a93e-9295cae0a4b0`; tool conversation: `35347cf1-cd02-4e56-8560-498fe479276c`.

| Case | Actual run ID | Observed result |
|---|---|---|
| CSV initial | `cf9a276f-a541-4eb6-9491-05dd2d331308` | Reported **78.40**, calculated **77.40**; B is **38.50** reported vs **37.50** calculated. Typed table and exact CSV snapshot. |
| CSV changed rounding | `8666dfa7-3f82-4d94-8990-718cc0269a54` | HALF_EVEN proposal from exact human-saved base; row note and top-level human note retained; original CSV retained. Accepted through existing human proposal authority. This fixture's totals do not change under HALF_EVEN. |
| Wasm original | `3292d38a-bc01-4a16-838f-9790ee3c7a2a` | Actual `total(3,1250)` returned **3750**; import-free WAT artifact + file, input form and engine/fuel/hash readback. |
| Wasm shipping | `0e1feef4-d41d-4cc7-9300-73b462bc4bda` | Changed WAT requirement plus `[3,1250,500]` actually returned **4250**. Exact proposal accepted; human cents note retained; original code remains in immutable history. |

Every CLI prompt/continue/inspect is a separate process. Both conversations reopen with two ready runs and preserved human/assistant messages. No delegated assignment was created. Six immutable observation records cover four initial artifact/file versions and two proposed changes. The demonstration asserts exact current readback, source retention, notes, selected CSV cells, downloaded WAT bytes, actual before/after integer values, and accepted-proposal binding.

## Reproduce

Use a new environment filename; `dev_db.py` refuses overwrite. This does not touch previous intake/live data.

```sh
cd /home/ubuntu/workagent-general-products
uv venv backend/.venv --python /usr/bin/python3.12
uv pip install --python backend/.venv/bin/python --require-hashes \
  -r backend/requirements.lock -r backend/requirements-local-tools.txt
PYTHONPATH=backend backend/.venv/bin/python backend/dev_db.py \
  --env-file /home/ubuntu/.hermes/cache/scratch/general-products-reproduce.env
source /home/ubuntu/.hermes/cache/scratch/general-products-reproduce.env
PYTHONPATH=backend backend/.venv/bin/python scripts/general_products_demo.py \
  --output .local/general-products-reproduce/cli.json
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q
npm ci --ignore-scripts --prefix contracts
npm run check --prefix contracts
```

Use a separately fresh disposable environment for an authoritative full regression run rather than treating the demonstration database as pristine. Optional Wasmtime is pinned to **49.0.0** by the existing hash-locked `requirements-local-tools.txt`. Both this worktree's `.venv-products` (test interpreter) and `.venv` (standard launcher/contract scripts) were installed in isolation with Python **3.12.3**. Shared intake venv was not mutated. Run optional installation after the normal setup's dependency sync; a subsequent base-only sync can remove optional packages, which truthfully produces an unavailable tool turn rather than fallback execution.

Normal `scripts/workagent.py serve` now runs `workagent.dispatcher --general-controlled`, routing these HTTP turns to the same GeneralWorker. No hidden manual fixture-step is necessary. Legacy dispatcher routing alone is explicitly tested not to claim general leases. See contract for exact API fields and unavailable-state mapping.

## Verification scope

Final full regression result: **367 passed, 1 dependency deprecation warning, in 382.85s** on fresh `workagent_test_dd012f4ad8f6`. Command: `PYTHONPATH=backend backend/.venv-products/bin/python -m pytest backend/tests -q`. Log: `/home/ubuntu/.hermes/cache/scratch/general-products-final2-tests.log`. This includes the original suite plus 22 integrated products tests and one real predecessor-upgrade test. No tests skipped. The warning is Starlette's deprecated `anyio.abc.BlockingPortal` alias, not a failed or skipped check.

Already observed during implementation: **366 passed** on fresh `workagent_test_72ec2433b2fc`, and another **366 passed** on fresh `workagent_test_1960dbc25a59`. These are superseded by the final run after adding the predecessor-ACL upgrade regression/fix, not mislabelled as exact-final evidence.

New focused tests cover:

- CSV original reported/calculated cells, exact fixed formula/input digest, exported bytes, changed rounding, row/top-level notes, immutable originals and exact proposal acceptance.
- Wasm actual 3750/4250 returns, integer form/inputs, changed code, saved human notes, safe downloadable WAT, current/pending/historical observation binding.
- No observation inheritance after human-save, rejection of forged body execution fields/original CSV, PostgreSQL immutable evidence trigger and wrong-capability rejection.
- Concurrent command replay, committed replay without transport reinvocation, actual subprocess restart, crash after each pure kernel before commit and fenced reclaim with one publication.
- Actual original **9a B1** process creates/claims a turn; upgraded process resumes the expired lease against its persisted original context/pins.
- Revocation before execution and membership/generation/source/cancellation changes after the real kernel returns but before commit; zero artifacts/observations on denial.
- Concurrent human edit during computation, stale proposal acceptance, denied downloads/observations after revocation.
- Malicious host/WASI imports, fuel-exhausting code, spreadsheet formula inputs, missing/wrong engine, malformed CSV downloads, safe filenames/MIME/digests and strict bounded integer forms. Additional original kernel tests cover wrong signature/entrypoint, memory and start-loop limits.
- Real loopback uvicorn and continuous controlled dispatcher subprocesses: HTTP create/post advances to replied, observed Wasm result reads 3750, list previews populate. Missing consumer/expired lease projection is explicit unavailable, not a fake reply or unexplained spinner.
- **Real predecessor upgrade:** original 9a `dev_db.py` creates the database and restricted runtime role through 009; new migrator applies 010 twice; predecessor checksums remain unchanged; only SELECT/INSERT are granted on the new evidence table, never UPDATE/DELETE; actual new local execution completes using that upgraded role.
- Legacy Body canonical JSON/hash shape remains unchanged; old fixture registry bytes are hash-bound archives. Existing legacy/intake/Responses/B1 regressions remain in the full suite.

Generated contract verification: canonical Python export `--check`, regenerated TypeScript drift check and `tsc --noEmit` all passed through actual `npm run check --prefix contracts`. Generated examples are marked illustrative and are not substituted for observed results.

## Issues found and fixed

- Initial environment creation selected Python 3.14, which lacked the pinned psycopg binary wheel. Used isolated Python 3.12.3 and installed the exact hashed lockfiles; no dependency pin weakening.
- Initial generalized revision return assumed every temporary artifact row dictionary included assignment_id. Legacy regression tests caught it; fallback preserves existing assignment paths while conversation records explicitly own their artifacts.
- Test fault timestamps cast through PostgreSQL text emitted a timezone representation Pydantic rejected. Direct `to_jsonb(timestamptz)` preserves valid typed serialization; no production time binding weakened.
- Direct product-model import revealed a circular import. Factored shared primitives without changing legacy body serialization.
- Real predecessor-upgrade RED found that fresh-only provisioning omitted new evidence-table rights for existing runtime roles. Additive migration 010 now grants only new-table SELECT/INSERT to existing authorized conversation+artifact writers; the real upgrade test passed after the fix. No accepted migration, activation, experiment grant or predecessor authority table was edited.

## Remaining boundaries

Import-free bounded Wasm is not a generic host-code sandbox. File/text limits, one-turn budget and typed explicit operations are deliberate restrictions. Pure execution may repeat after a precommit crash; only publication/replay is deduplicated. No claim of exactly-once external effects. Current verified output requires both exact revision binding and current scope, not editable body text or a stale result reference. Independent parent review, integrated UI/browser evidence and real model usefulness remain outstanding.
