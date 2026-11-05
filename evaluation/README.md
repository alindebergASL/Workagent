# Held-out evaluation custody harness

This directory is **offline-only evaluation tooling**, not application runtime code and not a paid worker. It deliberately refuses `--mode live` before reading credentials or starting a child. No model responses, task solutions, user usefulness ratings or statistical superiority are synthesized.

## Current artifacts

- Controlling preparation report: `docs/evidence/batch3-b35b/ACCEPTANCE.md`.
- Preregistration plus pre-live amendment: `PREREGISTRATION.md`, `AMENDMENT_01.md` in that evidence directory.
- Current evaluator-only root: `/home/ubuntu/workagent-evaluator-b35b-v2` (0700). It contains `fixtures/`, `oracles/`, `trajectories/`, `scoring/`, generator/seed, immutable freeze/runtime lock and execution records. Never copy this root into an app search corpus, tool workspace, prompt, DB, public artifact or repository. V1 is retained separately as historical failed/qualified evidence.
- Exact B0 export: `.local/batch3/b35b/baseline/workagent`, from accepted26e599b3. Current product backend remains914043a; no product code/migration changed on this card.
- `harness.py`: manifest/source/runtime admission, exact input staging, unique state per variant and isolated request-capture children. Every episode starts a fresh process and reopens its own trajectory store.
- `transport_probe.py`: real product `build_tool_selection` request construction and filesystem/process/network probes. SQLite is harness continuity, not product PostgreSQL recall. The receipt is not a solved assignment.
- `compute_probe.py`: a separately operated real pinned gVisor service probe. No oracle bytes are passed to the compute input; the job attempts forbidden oracle paths and host network access.
- `scoring.py`: opaque output packets, exact oracle/criterion binding, manual verdict validation and descriptive effort arithmetic. It cannot dispatch a model judge or decide superiority.
- `runtime_binding.py`: executable/dependency/generator/source lock and drift rejection. Existing frozen bytes, not re-created ZIP timestamps, are canonical replay material.
- `materialize_matrix.py`, `verify_results.py`: complete literal criteria and content-free attempt/manifest reports; refuse overwriting existing published outputs.

## Verified commands

```sh
python3 -B evaluation/test_harness.py
python3 -B evaluation/harness.py \
  --root /home/ubuntu/workagent-evaluator-b35b-v2 \
  --output /home/ubuntu/workagent-evaluator-b35b-v2/execution-records/<NEW-attempt-id>
python3 -B evaluation/verify_results.py
```

The target must be new. Never rerun a collector over old attempts. A refusal or timeout is evidence, not an excuse to rename/rewrite an unknown request. The offline runtime lock includes the exact interpreter; use the recorded controller executable or refreeze explicitly before any new trial. Dependency drift fails closed. The bound venv must not be concurrently modified.

The real compute probe requires inspecting/recreating only the recorded owned transient unit from `docs/evidence/batch3-b31a/HANDOFF.md`; do not install or start an arbitrary host-shell fallback. Stop owned proof processes and verify the unit inactive/MainPID0 afterward.

## Live handoff—not implemented here

The successor must re-read current ledger and grants, establish a bounded affordable authority envelope without resetting historical allocations, resolve the full-tool M1 SQL recall selector mismatch, freeze real paired task/source bytes and exact prompt/provider/tool versions, then use the actual confined application worker. The larger current-tool schema does not itself enable typed-memory SQL projection. The offline M1 channel is a design/isolation probe, not proof otherwise.

Use one independent blind scorer for future live artifacts; freeze outputs and oracle criteria before scoring, bind scores before revealing variant labels, retain all failures, and count setup/recall review and repeated repairs as human effort. Public/synthetic connector evidence does not authorize or substitute for the conditional private pilot. See the136-row matrix for every outstanding live/safety/correction requirement.
