# B3.4b — one independent initial risk review

**Disposition: fix one P1 and two P2 findings before calling this slice complete. No P0 found.**

Reviewed working changes against `4ad2ff75514b0bfb713b2b5f04a232f596643e83`, the repository authority/product documents, `docs/BATCH_3_DISPATCH_20261028.md`, and the Batch 3 appendix's authority, accounting, compute, delegation, memory and evaluation constraints. This is one review, not a second implementation owner or acceptance certificate.

## Findings

### R1 — P1: parent verification can be bypassed through an existing output-producing capability

**Locations:** `backend/migrations/068_bounded_delegation.sql:6–9,86–97`; supporting path `backend/workagent/capabilities/compute_adapters.py:148–178,181–192` and `backend/migrations/057_compute_python.sql:27–43`.

The new assimilation checks enumerate file draft/patch/export capabilities and selected decision kinds, but omit `compute.python` / `compute_python`. That capability is not merely an internal calculation: successful sandbox output files are inserted into `generated_blobs` and `artifact_exports` and returned as downloadable manifests. Its export trigger rechecks ordinary compute authority, and download authorization checks the settled compute observation and declared compute inputs; neither checks `delegation_reviewed`.

Consequently, in a normally authorized run containing both delegation and compute, the parent can receive a proposed child result, skip `verify_delegate`, then embed the result in compute code that writes `/outputs/comparison.txt`. A downloadable synthesized result is produced although the same content through `files.create_draft` is rejected. This is an assimilation-policy bypass, not a sandbox escape or automatic human acceptance. The stage-level list also omits other artifact-producing decisions (`run_wasm`, `reconcile_csv`), so the protection should not depend on one small list of operation names.

**Bounded fix:** enforce the same current child-disposition/verification condition at output-producing boundaries, including compute export creation and relevant product publication. Adding compute to both current lists closes the immediate route, but also cover non-capability artifact operations; do not indiscriminately block source reads, verifier execution or safe diagnostic termination. Keep the check under the existing workspace fence.

**Parent regression:** grant delegation plus compute; retain an unverified child; attempt a compute-generated download containing its result. Assert no export is created or downloadable before verification, then prove it succeeds after exact-hash verification. Exercise ordinary artifact-producing decision paths too. The current positive test (`test_delegation_pg.py:92–119`) covers only `files.create_draft`, not these alternate sinks. This finding is established by the code path; I did not execute the PG/export scenario under this review's no-write scope.

### R2 — P2: a rejected proposal permanently prevents ordinary useful assimilation in that run

**Locations:** `backend/migrations/068_bounded_delegation.sql:74–84,89–93`; `backend/workagent/capabilities/delegation.py:195–203`; test coverage `backend/tests/test_delegation_pg.py:129–138`.

`delegation_reviewed` requires a successful verifier for **every** observed proposal. A failed verifier cannot resolve the proposal, and there is no parent-owned reject/discard disposition. After detecting an incorrect child answer, independently recomputing the answer or launching a corrected second child cannot restore draft/reply publication: the original immutable bad proposal still lacks a passing verification. With two children, one incorrect independent result also prevents publishing the correctly verified child's useful partial result. This incentivizes false passing checks and undermines optional delegation/recovery.

**Bounded fix:** add an immutable parent rejection/discard disposition bound to child attempt and output hash, or make assimilation bind an explicit reviewed dependency set while preventing rejected/unreviewed content from being admitted. Discard must not imply success, acceptance, refund, or memory eligibility. Preserve a safe diagnostic stop path.

**Parent regression:** first proposal fails an actual check; parent discards that exact proposal; corrected/verified sibling or parent-only result can be retained, while rejected evidence remains visible as rejected and cannot qualify as verified evidence or memory. Existing failure testing only asserts the blocked state, not recovery from it.

### R3 — P2: valid numeric JSON can silently become a different proposal

**Locations:** `backend/workagent/capabilities/delegation.py:187–194,204–207`; serialization at `backend/workagent/capabilities/broker.py:49–54`.

The stdout parser rejects literal NaN/Infinity through `parse_constant`, but JSON exponent overflow takes another path. `json.loads('{"value":1e999}', parse_constant=...)` returns Python infinity. `ChildOutput.model_dump(mode='json')` then silently converts that value to `null`. The retained proposal is marked `proposal` even though it differs from the executed output. The verifier receives the altered value, and the retained `ExecutionEvidence` does not contain stdout to disclose the alteration.

**Executed read-only reproduction with the repository venv:**

```text
numeric_overflow_original {'value': inf} retained {'value': None}
```

**Bounded fix:** reject non-finite numeric values during parsing (including nested exponent overflow), or use a bounded exact-number representation with explicitly defined serialization. Do not silently normalize unsupported JSON into another proposal. Regression-test nested positive/negative overflow and ordinary finite numeric results. Duplicate-key rejection using the existing protocol parser helper would also make this boundary less ambiguous.

## Other assessed boundaries and limitations

- **Source / processor / action intersection:** the adapter constructs a fixed local processor ref; broker policy enforces grant pins/effects/selectors; Python and SQL map exact immutable child input refs through compute/file authorization and check reductions. The child receives explicit files plus generated task metadata, not ambient conversation/memory. I found no additional concrete escalation path in these checks.
- **No credentials / acceptance / nesting:** there is no new credential-bearing runtime or child broker endpoint. Existing pinned no-network gVisor is reused. Read-only schema probes confirmed rejection of `token`, `accept`, `delegate`, `effects` and `processor` argument additions. Actual isolation/cancellation remains for parent process evidence; schema rejection alone is not an isolation test.
- **Shared reservations / concurrency / unknowns:** launches use existing workspace/shared-budget serialization and nonrefundable reservation entries. The insert trigger caps total child attempts at two. Explicit unknown child observations block novel launches; identical replay cannot dispatch twice. Tests cover shared-capacity competition and explicit unknown replay. No DB execution was performed by this reviewer.
- **Restart nuance to verify in parent evidence:** the crash-without-observation guard blocks changed launches only after a fence change (`068:52–56`); same-fence in-flight distinct children are intentionally allowed. The crash test recreates `Service` but retains the old capability and tests identical arguments only (`test_delegation_pg.py:183–191`). Prove the actual process-recovery path rotates the fence before scheduling a changed/new child. I have not classified an unproven ordinary recovery path as another finding.
- **Revocation/cancel fences:** current authorization is polled during sandbox execution and rechecked at settlement; dependency visibility follows child input and processor authority for retained consumers. Tests name cancel, grant revoke, generation, lease and source reduction. Parent still needs real late-return/readback evidence, especially after a successful child/verifier pair.
- **Verification strength:** exact attempt/output hash binding and a separate executed parent program are real mechanisms. An arbitrary program printing `{"passed":true,"checks":["claimed check"]}` is still accepted; the mechanism cannot establish substantive inspection or independently correct assertions. The implementation truthfully says parent-supplied checks are not independent goal truth. Do not market that as a trusted independent oracle or as proof the human's goal was met.
- **Memory:** the child has no memory API; direct child tool evidence is excluded from procedure admission, while verifier evidence still goes through the preexisting human-reviewed lifecycle. I found no added direct child-to-active-memory route. This does not prove semantic procedure usefulness or prevent humans from copying arbitrary text.
- **Scope verdict:** this is a defensible **optional deterministic delegated-analysis primitive**, using narrower per-child immutable inputs, bounded work, proposal receipts and parent checking in the existing runtime. It is not an autonomous specialist/LLM worker, and the tests alone do not show improvement over ordinary compute or single-worker execution. Do not claim full B3.4 learning/delegation usefulness, paid multi-agent benefit, or client acceptance. Parent PG/process/client evidence remains necessary.

## Verification and reviewed source identity

Performed source/diff inspection and read-only Python schema/serialization probes only. The generated delegation schema hash is `d3212561fb15f38b24550d16cd79b5302a7a5af70afa7c2cf1dfac6053d4896c`, matching migration 068's admitted hash. No provider call, service operation, database write/migration, source edit, card, profile/config change, or unrelated lockfile modification was performed. The report is the only file I created.

Working files changed concurrently during the review; findings/line numbers above use the final reads identified here, not an assertion that the workspace was frozen:

```text
829de398dc1b756df13c859be0f0464af96a5361f193b931470d0d01065c39bd  backend/workagent/capabilities/delegation.py
38b6d17bbd5fbd75c1a0a23fc811048cfa7bb18e2d2950fe611f9b8eac1e817d  backend/workagent/capabilities/delegation_composition.py
1e995458385ca88cdd08fd37b86f0ddd3572d754e8e6bdff73651a286c762930  backend/migrations/068_bounded_delegation.sql
1cd6bc772eac3e03a873d5fd1d9f50b52a3786b656b9af48eb3f8bd00ce0bdbf  backend/tests/test_delegation_pg.py
```
