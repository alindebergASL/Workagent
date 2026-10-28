# B3.1a acceptance — real confined computation

**PASS for this backend slice only.** Base `3cc340e6efea385000acac65a3b678a8d132a6a7`, branch `hermes/b2-conversational-client`. This is a local feature increment, not a remotely published/promoted runtime, full Batch3 acceptance, or production-security certification. The accepted commit is the commit containing this record; exact commit SHA is in the Kanban handoff.

## What is implemented

Pinned fixed-package Python computation in an actual root-owned gVisor service, with immutable shared-file inputs, bounded isolated generated files, stdout/stderr/exit/resource/omission receipts, cleanup, and no application-process eval or host fallback. `compute.python` is run-bound through the existing authoritative capability gateway, budget ledger, worker staging and durable checkpoints. Generated outputs use existing blobs/exports and authenticated downloads. Additive migration057 and four canonical computation schemas leave predecessor decision schemas intact. [Backend interface and operation handoff](HANDOFF.md).

## Verified acceptance

| Proof | Actual result and scope |
|---|---|
| Current computation/publication/worker/HTTP group | **14 passed, exit0**, `closure-final-pg.log`, XML and exit receipt. Real restricted PostgreSQL and actual gVisor, not mocked successful adapter results. |
| Gateway/file-worker compatibility | **27 passed, exit0**, `closure-compat-verified.log`, XML and exit receipt. Bounded gateway, file gateway and B3.0b final worker/race group; not a whole-backend campaign. |
| Non-invoice calculation | Decimal quantities, grams/kg units, null exclusion, missing-key inner join, timezone day boundary, grouped aggregation, retained annotations. Independent Fraction oracle checks3 output rows; coverage identifies null/missing-join omissions. |
| Actual HTTP calculation download | Real loopback TCP uvicorn with bearer and required headers:200 and exact CSV hash/content;401 anonymous;404 cross-workspace. `http-calculation-verified.json`, verified against the independent Fraction oracle. SHA256 `2383bf8715a676ebc617334285d28bbf81405fdfb383e5a6df699a9f42bef222`. |
| Supplied code/tests | Real isolated execution of3 supplied normalization tests, genuine stderr unittest report and downloadable JSON result. Tests validate their assertions, not the entire user goal. |
| Source/access/download boundaries | Exact input refs, forged hash/scope rejection, safe CSV escaping, no-input valid job, unavailable service without fallback. Actual HTTP computed-output download denies revoked membership and wrong workspace; attachment/nosniff/no-store/digest headers verified. |
| Worker persistence | Current opt-in compute schema accepted by real worker; normal and restart/checkpoint paths retain one observation and do not redispatch. Provider selection is controlled synthetic transport; no paid model request. |
| Review R1 | Nonempty-input real output followed by grant revocation produces settled `cost_only` receipt with CPU usage, no output/source/input publication refs, one attempt and one retained but inaccessible export. Actual HTTP404 and service-method denial verified. Crash after output leaves reservation and no downloadable publication/no replay. |
| Review R2 | Actual service SIGKILL after nonempty-input dispatch produces `outcome_unknown`, `basis=unknown`, no observed units and one dispatch. Exact call replay returns the same receipt without resend. Reserved and settled unknown entries are retained. `finally` recovers the owned service and runs a real profile-bound readiness job. |
| Changed isolation boundary checks | Current client disconnect cancellation and service-death/restart tests passed in `closure-corrections`; the group also had a now-corrected unrelated HTTP header assertion failure. Their actual post-restart/cancel receipts are retained in `current-restart-isolation.jsonl`. |
| Unchanged isolation attacks | **19 actual retained records**, `retained-isolation-proof4.jsonl`, all matching unchanged installed profile/service bytes and verified cleanup. Cases cover network/metadata/host/proc/secrets visibility, input/root permissions, symlink/FIFO/hardlink, guest subprocess/fork/PID/setsid, RAM, single/aggregate child CPU, disk, output file/byte/stream limits, wall time, cancellation/residual state and service restart. Read limitations below, especially inode/FD evidence. |
| Current installed authority | Fresh disposable PostgreSQL, restricted role `rolsuper=false`, `rolbypassrls=false`, all57 migration checksums match current source, current compute descriptor matches immutable installation row. Historical installed databases were not migrated. |
| Canonical contracts | `npm run generate` followed by `npm run check`; canonical Python export, OpenAPI TS drift, alpha TS and TypeScript checks all passed. `contracts-final.log`. No web implementation changes. |
| Independent review | Original broad review/HOLD preserved in `independent-review.md`; **one narrow correction rereview PASS** in `correction-rereview.md` for R1/R2 and material test/export delta.35 reviewed source/evidence hash bindings read back and verified; no extra broad sandbox audit. Reviewer inspected evidence rather than rerunning attacks. |

The actual downloaded CSV (`summary.csv`):

| local_day | region | mass_kg |
|---|---|---|
|2026-10-27|North|1.650|
|2026-10-28|North|2.585|
|2026-10-28|South|0.450|

The CSV additionally retains the independently checked synthetic annotations. This is a mechanism demonstration, not customer data or a live-model usefulness claim.

## Binding and truthful limitations

- `final-source-manifest.json` pins35 changed backend/contracts/test/install files against the accepted B3.0b base. `final-verification-manifest.json` retains exact command exits, JUnit totals, attack case index and original failed/incomplete log hashes. `final-evidence-manifest.json` binds the sanitized committed evidence set.
- Final staging removed one trailing blank line from `test_compute_publication_pg.py` only. The manifest verifies the reviewed/tested bytes by reconstructing that newline and confirms identical Python AST; no executable change, adapter hash change or new DB installation was needed. The review report remains unchanged.
- Exact installed profile `69ff94d387bef41a0210653b213bdae301a9e0600a62d273d469f34385b44578`; all installed trees were read back and compared with their pins. Service/profiles/protocol/results/installation source bytes match the immutable v3 snapshot. Only the **unused installed client** differs: the current application imports the corrected client from source. Client edits did not require recopying runtime/rootfs or changing historical pins.
- This is a tested gVisor boundary, not proof against all kernel/runtime escapes, hardware side channels or denial of every host resource. Trusted local socket client and root supervisor remain part of the trust model. No arbitrary remote access or public listener was added.
- The inode workload reached **gofer FD exhaustion**, not a demonstrated inode limit. The actual receipt is retained without inventing inode-limit proof. CPU is aggregate host-cgroup use including runtime overhead; guest subprocesses remain inside confinement. Guest environment is fixed PATH/LANG/TZ plus runtime HOME, **not literally empty**. Stdlib-only finite envelope; no pandas, package installation or large dataset promise.
- Unknown settled-row `units=0` is an existing SQL storage convention with `basis=unknown`; it does not assert observed zero use or release the retained unknown reservation as known-unused capacity. No receipt resend or liability rewriting.
- Original `reviewfix.log`7PASS/6FAIL is retained: erroneous replay-exception expectation stranded the service and caused subsequent unavailable results. Exact replay correctly returns the same unknown receipt. The fixture now recovers in `finally`. `core-fourth.log` had only dots and is **not** a passing full group.
- Closure introduced only test-orchestration errors before the final passes: initial missing PYTHONPATH; incorrect stale-ref assertion (SQL strips all refs); required HTTP request header; middleware's actual no-store header; failed membership-delete fixture attempts (FK-protected, transaction rollback). The corrected revocation uses `memberships.active=false`. These failures remain indexed, not erased. A combined terminal timeout interrupted the first compatibility harness after a27PASS summary but before an exit receipt; the separately completed27PASS exit0 rerun is authoritative.
- No paid product/provider calls, new budget/model/child/turn cap increases, default merge, feature push, public exposure, historical DB maintenance, broad ownership changes or destructive cleanup. One Astra correction-review child was used in this closure; development/review model usage is outside the product ledger and not reported as a measured provider bill.

## Final runtime and successor state

Only owned `workagent-compute-b31a-v3.service` was stopped after verification: `MainPID=0`, inactive/dead, socket connection refused, no job cgroups or job directories. Its transient unit unloaded (`LoadState=not-found`); exact saved unit config and immutable root-owned proof snapshot remain. A future proof operator must recreate that owned unit from the saved exact config rather than assuming `systemctl restart` can recover an unloaded transient unit. No other units/configuration were changed. All three original API PIDs remain present with their original command lines. `runtime-final.json` records exact readback.

This is **local source plus a preserved stopped disposable proof install**, not current computation enabled in original dev runtimes. Existing `t_b7f7aa98` remains the next scoped-memory card and is released only by this card's completion. Combined computation/memory and later Claude Cloud frontend reconciliation remain subsequent work; Batch3 is not complete.
