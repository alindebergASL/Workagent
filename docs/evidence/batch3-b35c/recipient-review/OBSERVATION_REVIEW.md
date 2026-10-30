**HOLD — two concrete blockers prevent the observer from recovering the pending B1 run.**

1. **Bridge payload shape mismatch — `observe_live_study.py:60–66`.** The observer expects `{"operation": ..., "payload": ...}`. Existing `ProductAdapter.call()` stores the canonical operation payload directly; execute receipts contain `trajectory`, `episode` and `admitted`. Reading `body['operation']` therefore raises `KeyError` before recovery. Selection must bind the actual receipt format to the controller’s exact execute operation/key.

2. **Worker-state symlink rejected by unchanged jail — `observe_live_study.py:104–108`.** Each visit makes `worker-state` a symlink. `A.execute()` passes that path directly to `network_harness.jail()`, which requires `not state.is_symlink()`. Consequently, after correcting blocker 1, recovery still fails before launching the worker. Preserve the original durable directory through a supported real-path handoff without weakening the jail checks.

The seven recorded tests exercise only `pending_safety`; none covers receipt selection or the observer→application→jail path, so they miss both blockers.

The terminal receipt update uses an exact payload/state CAS. Application replacement precedes that transaction, but retains the original snapshot and changes visit evidence; this ordering alone does not establish a duplicate-send defect. Ordinary worker duplicate protections remain unchanged. **B0 recovery is unreviewed:** this entrypoint also lacks the canonical adapter’s variant-specific host import setup; a B1-only result cannot establish B0 compatibility.

The transport change reconstructs exactly to its previously reviewed hash when the release literal/comments are restored. No gate logic changed. The supplied worker stdout records `running` and `unscored_live_worker`, not a completed episode. F2 quality/72-episode acceptance remains separate.

Exact SHA256s:

```text
2e159c015c79ced6980ae3f93835d3fb83f696c9cf90017d1003663970ac4549  evaluation/observe_live_study.py
ecee4ed13c0cb8c04ef0c2052da2f7f005bda1f0c01831265675f97fa5f88e26  evaluation/test_live_observation.py
da495f7b7c638a9d190671b0053b02e74f34e79674877f113b9bf29b5502815f  evaluation/study_transport.py
ca52fe8b9243f4263ecdb2e88d2c12b2dd8640fd95ff34eda0f93197e52ac3ed  evaluation/study_application.py
e6695e5f8c542fddef46ee4c68dff15dc4211dadbaff0a8a97558b9ee24725a6  evaluation/study_diagnostic.py
d445515fa75946c9f7c04fd8f81023e0bb2ae60f1bff28df483f149037369c6b  evaluation/study_worker.py
f9e270a1148f8079728fc97df1841a3afa34d3e9b6eb4dd211e305897b916afd  .local/batch3/b35c/recipient-integration/observation-controls.log
5d23286b9bf64c0e79c1634c4ed98ebbecf1a6b341fdb18341dfa2d057088f6b  .local/batch3/b35c/live-study/campaign/d477c622c837a9cc1fb1f0be/episode-1/worker-0.stdout
```

Read-only review; no DB calls, credential access, script execution, writes or product calls. No installed/paid recovery acceptance.