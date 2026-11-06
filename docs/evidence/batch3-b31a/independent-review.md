# B3.1a final independent risk review

**Verdict: HOLD B3.1a acceptance for two concrete receipt/accounting defects below.** No host escape or unauthorized generated-file download was found in the reviewed paths. This is not a claim of overall task or Batch 3 completion.

Reviewed at 2026-10-28T18:49:52Z against uncommitted work on HEAD `3cc340e6efea385000acac65a3b678a8d132a6a7`. Read the tracked diff, all new sandbox modules, installer/unit, compute adapters/composition, migration 057 and predecessor guards, compute tests, actual proof3/proof4 artifacts and retained logs. Inspected the running v3 service and its installation. Only read-only PostgreSQL statements were used. **No compute jobs, service changes/restarts, source edits, board edits, or paid calls were made by this reviewer.** The only repository write is this report.

## Findings requiring correction

### R1 — P2: post-I/O authority loss with nonempty inputs prevents cost-only settlement

Locations: `backend/workagent/capabilities/broker.py:84-96`; `backend/migrations/057_compute_python.sql:59-62`.

For an observed compute result, the broker appends `call.input_refs` to the observation's `input_refs`. If the immediately preceding settlement authorization then raises `DomainError`, the broker changes status to `cost_only` and clears output, but leaves the appended input refs. Migration 057's exact settlement binding accepts the appended refs **only when the submitted observation status is `observed`**. With `cost_only`, it expects the single run-scope ref. Therefore the ordinary revoke/lease/work-version race after an actual computation with source files raises `exact observation binding required` instead of retaining the write-only cost receipt.

Verification without writes/jobs:

- Loaded the real proof4 calculation receipt, which has one scope ref and two file refs; applied the broker's exact cost-only model update. Actual input-ref count: **3**; SQL-required count: **1**; equality: **false**.
- Read `pg_get_functiondef('settle_tool_call(text,text,jsonb)')` from the fresh final proof database; it contains that exact status-dependent condition.
- Evaluated its `IS DISTINCT FROM` predicate with the real attempt's call and receipt in a **READ ONLY** transaction: **true (binding rejected)**.

This does not unlock downloads: unmatched/unsettled exports remain denied, and the reservation is retained. It does lose the required settled cost/accounting record and turns a controlled stale-result path into a database error. Existing post-I/O publication tests use `inputs=[]`, so cannot catch it.

Required correction: make broker and SQL agree on the binding of a downgraded observation, while retaining exact checks and letting the SQL guard strip unauthorized result/source refs. Add a real post-I/O revoke test with at least one exact shared-file input; assert cost-only settlement, both cost entries, no downloadable late output, and no replay. The parent can do this after its active run; this reviewer did not interfere with it.

### R2 — P2: lost post-submission receipts are mislabeled as observed unavailability

Locations: `backend/workagent/sandbox/client.py:32-56`; `backend/workagent/capabilities/compute_adapters.py:138-142`; `backend/workagent/capabilities/broker.py:47-87`.

`SandboxUnavailable` covers both a service that was never reached and failures **after sending the code**: response timeout, EOF/disconnection, invalid receipt/profile, and transport errors. The adapter catches all of them and returns the same ordinary `ComputeUnavailable` output. The broker consequently settles it as `status='observed'`, `observed_units=1`, `basis='estimated'`, and replaces CPU accounting with zero because the short unavailable result has no resources.

A service death or connection loss after execution starts has no validated execution/cleanup receipt; it is an **unknown execution outcome**, not an observed unavailable execution. The existing actual restart test demonstrates the client-side `SandboxUnavailable` path, but there is no broker/PG assertion that this path remains unknown. The existing unavailable gateway test exercises only an absent socket.

Required correction: distinguish definitely-not-submitted unavailability from possibly-submitted/receipt-lost execution. Propagate the latter into the broker's `outcome_unknown` path (or an equally explicit retained unknown status), preserving the reservation, unknown accounting and no automatic resend. Verify a dropped receipt after dispatch does not become an observed zero-CPU result. The exact same call ID already cannot execute twice; this finding does **not** allege that this existing duplicate-call fence is absent.

## Verified protective boundaries

- `/run/workagent-compute-b31a-v3` and its installed runtime/code/rootfs are root-owned and non-writable by group/other. Ran the installed `secure()`/`manifest()` inspection read-only: exact manifest match, including owners, modes and symlink targets. Checked **1 runsc entry, 7 sidecar entries, 6037 rootfs entries, 8 service-tree entries**. All seven source Python modules match their installed copies.
- Runtime/rootfs tree hashes match `runtime-lock.json`; pinned service profile is `69ff94d387bef41a0210653b213bdae301a9e0600a62d273d469f34385b44578`, gVisor `release-20261026.0`, image `python@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c`. The previous uid1000-owned installation is not the reviewed target.
- Actual systemd unit is active, root-run, private mount namespace, delegated supervisor cgroup, `KillMode=control-group`, MemoryMax 805306368, swap 0, TasksMax 256, CPUQuota 100%, UMask 0077. Socket is uid1000-owned mode 0600 under a root-owned directory. No service operation was performed.
- Fixed argv uses network none, directfs false, systrap, no host UDS/FIFO, finite gofer FD cap and enforced pinned sidecars. Guest uid/gid 65534, no capabilities, readonly image/inputs, bounded writable storage, process/resource limits and whole-cgroup cleanup are present. Runtime subprocesses receive `env={}`. **Guest environment is not literally empty**: it has fixed PATH/LANG/TZ and observed runtime-added HOME; evidence shows no inherited tested host secrets.
- Shared-file authorization binds exact file/version/hash, run conversation, grant selectors and target/responsibility scope. PostgreSQL reserve/dispatch/publication/settlement repeat current-authority and exact-pin checks. Current fresh proof database's installed compute descriptor exactly matches current source.
- Computation exports use existing `generated_blobs`/`artifact_exports`, not editable workspace drafts. Authenticated download checks current document/source access and an exact matching settled **observed** manifest before reading and hashing bytes. Crash/unsettled/cost-only rows cannot download simply by guessing an export ID.
- Selection schema hash computes to `b9f18beb013a8cd3f102959bf15a9fa290fbee43281077edc6e71abc547e5d61`, exactly the migration's opt-in hash. The prior proof database's pin-drift rejection is appropriate fail-closed behavior, not a reason to weaken pins.

## Evidence status and limits

- Retained `gateway-second.log`: **12 passed**, before the latest typed output refinement; not represented as a current full-suite pass.
- `proof3/isolation.jsonl`: **18 records**. It retains the first parallel CPU case that succeeded after consuming only 4,136,859 host CPU microseconds; that does not demonstrate a 5-second limit bypass. The failed early readiness probe is retained in `core-third.log`.
- `proof4/isolation.jsonl`: **19 records** at inspection. Sequential and repeated-parallel CPU cases stop at `cpu_limit` with 5,061,526 and 5,026,447 microseconds respectively. Includes a successful `after-service-restart` result. Resource/path/network/secret/read-only/output-link/fork/cancellation cases have actual service receipts; inode workload truthfully reports gofer FD exhaustion rather than asserting an unobserved inode limit.
- Real proof4 calculation receipt is `observed/succeeded`, retains two exact source refs and two generated exports, and has nonzero reported sandbox CPU. The independently checked Decimal/group/join/timezone/null calculation and supplied test execution are covered by the inspected tests, not claims of arbitrary user-goal correctness.
- `core-fourth.log` still contained only progress dots at final inspection. **No completed full proof4 test summary was observed by this reviewer.** Parent owns completion and acceptance evidence.
- No new attack workload was run; isolation conclusions use retained actual receipts, installed-tree verification and code review. R1 was independently reproduced as a live read-only PostgreSQL binding-predicate mismatch; R2 is a deterministic inspected exception-to-receipt path, not a claimed new live crash experiment.

## Reviewed critical source hashes

- `backend/workagent/capabilities/broker.py`: `1376503b7acc9a8a97757a8e9bd798888509ed8e4db24eb9c79ddcaf920911e0`
- `backend/workagent/capabilities/compute_adapters.py`: `edd7732dafeb29ec614a26ca5d6b5cccc388c3e59d1ca3e9af85b026c87e6241`
- `backend/workagent/sandbox/client.py`: `2fb3a584389e6a3416273933a2dd1b73ae1264b7d9a8a7dc17ce257b7803cc93`
- `backend/migrations/057_compute_python.sql`: `8e71d510ae5aa40396335ca7d082a8605e2f2311f3e615fecd779f9438d1b6cb`

Later fixes need focused regression execution and updated evidence; this review does not certify source changed after these hashes.
