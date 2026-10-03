# B2/B3 local capability kernels — not integrated acceptance

These pure capabilities are prepared for the general worker's scoped broker. They do not admit runs, confer authority, generate model answers, publish artifacts or accept human decisions. Domain/worker wiring and independent review are pending; these results alone do not close B2/B3.

## Operations

`workagent.local_operations.reconcile_csv` reads explicitly supplied CSV bytes. Required columns: `id,quantity,unit_price,reported_total`; other text columns survive. Decimal arithmetic computes additive `calculated_total`, `difference`, `check` columns and exports actual corrected CSV. Original reported values are retained, not silently rewritten. Stable duplicate IDs, malformed/ambiguous rows, missing numbers, non-finite/scientific notation and spreadsheet-formula cells are rejected rather than invented. This bounded profile supports nonnegative quantities/prices and explicit HALF_UP/HALF_EVEN rounding; other CSV semantics are unsupported, not generalized from the sample.

Observed synthetic input `fixtures/general-work/invoices.csv`: discrepancy row B; reported sum 78.40; calculated sum 77.40; B's calculated total 37.50 versus reported 38.50. Human notes survive recalculation. This is actual calculation, not model usefulness evidence.

## Runnable tool

`workagent.wasm_tool.run_wasm_tool` compiles and executes supplied WebAssembly text with **wasmtime 49.0.0**. The generated work product can be a portable `.wat` file with a named pure integer function and a human-facing input form. This is not an unrestricted host shell/Python executor.

- No WASI, host callbacks or imports of any kind are linked; therefore no filesystem/network/process capability is offered to guest code.
- Explicit 16,000-byte code, 8 bounded integer arguments, 50,000 fuel, 1 MiB guest memory, table/instance/memory counts and exact i64 function signature limits.
- Threads, memory64 and multiple memories disabled; missing/wrong-version engine fails closed, never falls back to host execution.
- Input/code hashes and observed scalar result are returned. An execution result is not generic proof that the business goal was met; the worker must apply a goal-specific readback and current authority at commit.

Observed actual executions: `invoice-total.wat` with `[3,1250]` returned **3750** integer cents; the changed requirement adding shipping, `invoice-total-with-shipping.wat` with `[3,1250,500]`, returned **4250**. Guest code is fixture-authored controlled input here, not live model-generated code. Failed imports/WASI, infinite function/start loops, oversized memory, wrong types/entrypoint and wrong engine version were rejected.

This runtime was chosen instead of silently falling back to a weak host-process sandbox: unprivileged namespace creation was denied and Docker unavailable. Landlock/seccomp discovery did not itself establish a reviewed generic sandbox. The Wasm boundary is limited to import-free pure tools; broader code execution remains unsupported.

## Reproduce

Install the optional pinned engine in the chosen isolated development environment:

```sh
uv pip install --python /path/to/isolated/python --require-hashes -r backend/requirements-local-tools.txt
PYTHONPATH=backend /path/to/isolated/python -m unittest discover -s backend/tests -p test_local_work_capabilities.py -v
```

Nine focused tests passed after the initial missing-module RED. No provider calls or credential reads. Full domain/worker/integration tests are pending.

Dependency: [wasmtime Python 49.0.0](https://pypi.org/project/wasmtime/49.0.0/), **Apache-2.0 WITH LLVM-exception** according to distribution metadata. The requirements file pins hashes for the 12 published distribution artifacts. Engine binaries/source are not vendored here; retain upstream license/notices if later redistributed. This is a pin/license observation, not a full transitive security audit.

## Next integration

Route authorized CSV/tool bytes through these capabilities from the same worker, bind observations to immutable product/input versions, recheck revocation/fences before commit, and expose typed products through the agreed additive API. Preserve concurrent human edits, use exact proposals for material revisions, and never mistake these pure helpers for a second model/tool loop.
