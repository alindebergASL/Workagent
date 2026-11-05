# Scoped integration review closure

Original independent review: `../controller-review/REVIEW.md`, exact reviewed HEAD
`1762d69f0b2b0d0773cb4bb8ce3a319932032df4`. Its changes-required verdict and
reproducers are preserved, not edited into a PASS.

## Corrections

- **R1:** `study_binding.environment()` authenticates the original network-13
  environment JSON by its retained SHA256, carries its interpreter/system-Python,
  dependency, migration, runtime, tokenizer and lock pins into every new worker,
  and changes only the explicit new entrypoint/module hashes. Controller and
  adapter persist this exact environment across restart; adapter validates before
  any application child effect. The application preserves it, rather than sampling
  dependencies anew each episode. Bwrap/kernel/launcher pins and file-set checks
  are retained. The application interpreter must match the frozen worker binary.
- **R2:** cold controller and application bridge compare source inventories to
  explicit immutable B0/B1/M1 anchors. B0 is accepted commit
  `26e599b3db8a61b73eeeaea4f87a1d3de0b296d9`; its103 retained files were compared
  with git bytes again. B1/M1 anchors are the already reviewed current product,
  not a newly self-certified directory. A changed candidate needs deliberate
  review/rebinding; current code cannot silently accept it on cold start.
- **R3:** official mapping preflight requires the original full12 blind identities,
  distinct within-trajectory workspaces/conversations/grants and cross-trajectory
  workspace/conversation disjointness, plus grant scope correspondence. The full
  supplied mapping digest is durable in the bridge and controller. Mapping drift
  in memory or across restart is denied before another child. Existing access and
  exact grant checks remain. This does not demand distinct accounting pools.
- **R4:** verifier requires an exact filename bijection and canonical packet equality
  with each collection receipt, including blind identity, episode, oracle hash,
  artifact/message contents, evidence level, pending judgment and null scores.
  No score or oracle content flows back into ingress.

## Independent narrow follow-up and final parent closure

One independent GPT-6-Astra/openai-codex reasoning subagent inspected only these
fixes and ran the24 initial integration controls, the release-lock control,
accepted103-file B0 comparison and retained72-packet verifier. It found R2–R4
closed at that scope, **but R1 still open**: the shared inventory omits `.pyc`, so
an added sourceless dependency module could be imported even with `-B` and an
isolated cache prefix. A disposable copied-dependency probe reproduced this;
no real dependency, implementation or historical evidence was changed by review.

Parent fixed that residual with explicit sourceless-dependency-bytecode rejection
both before application effects and in the actual jailed worker. Added host and
actual-child negative tests pass. The actual child rejects with
`sourceless_dependency_bytecode` before SQL/transport, while the valid positive
worker path is exercised separately. **This final residual closure is parent
verified, not a second independent PASS.** No further broad review was launched.

## Test history (overlapping, not additive)

- `existing-tests-01.log`:15 retained controller/transport tests pass.
- `closure-tests-01.log`:24 initial integration controls pass before the follow-up
  found the omitted bytecode control. Passing these did not establish R1 closure.
- `closure-tests-02.log`:41 tests pass after bytecode host/child corrections.
- `retained-safeguards.log`:2 old review fixtures fail,4 guards pass,5 original
  defect reproducers intentionally deselected. Both failures come from the old
  global `subprocess.run` fake also intercepting the newly validated `uname` call,
  not observed duplicate execution. Original fixtures/logs remain unchanged.
- `closure-tests-03.log`:43 tests pass after scoping those two retained child-launch
  fakes to the adapter namespace. Real environment checks still run. This includes
  all15 original controls and28 integration/retained-receipt controls. Full72-row
  protocol coverage and no-resend tests are included; these are not72 live runs.

`LIVE_EXECUTION_RELEASE=None` remains unchanged. No credential loading, paid
product calls, installed mutations, allocations, ledger scan, model/profile changes
or live readiness approval for spending is implied. Development/review tool costs
remain outside the product ledger and unreconciled.
