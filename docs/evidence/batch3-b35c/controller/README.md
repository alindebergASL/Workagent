# Longitudinal controller — residual implementation

This package is **scripted mechanism evidence, not live A/B, model-quality scores,
or verified desktop/phone/native usefulness**. The original 12 trajectories / 72
live episodes remain owed. Root `t_e07c8870` owns execution; `t_82b30c02` owns
publication/acceptance. Review and integration remain in the existing downstream
cards. No new graph was created.

## Additive delta

- `evaluation/study_controller.py`: consumes the retained frozen schedule; verifies
  frozen file hashes, source trees and execution files; persists exact per-operation
  payloads, states and history in SQLite with FULL synchronization. Each scheduled
  episode has ordered transition → exact ingress → execute → collect operations.
- `study_application.py`: uses actual product service commands, restricted PostgreSQL
  and the selected source tree. B0 loads the retained baseline, not candidate code
  with a label. B1/M1 use the same current source with recall off/reviewed-v1.
- `study_worker.py` and `study_transport.py`: a separate explicit transport entrypoint,
  retaining the original synthetic-only network worker unchanged. The controlled
  path forwards the strict synthetic MockTransport callback to a real loopback HTTP
  listener; it does **not** relabel that traffic official/live.
- `study_diagnostic.py`: scripted loopback server and durable application receipts.
  It drives real workers in the retained `network_harness.jail`, not a replacement
  isolation framework. Only the current episode is mounted. The evaluator/oracles,
  other episode directories, and administrator DSN are absent from the worker.
- `test_study_controller.py` and `verify_study_diagnostic.py`: targeted protocol,
  denial/restart tests and read-only examination of actual scripted run artifacts.

`network_harness.py`, `network_worker.py`, `public_ab_inputs.py`, the public/oracle
freeze, network-13 proof and existing execution receipts are reused unchanged.
The incidental old auto-triage worktree outputs are not merged.

## Longitudinal transitions

1. Create disposable synthetic scope (diagnostic mode only); initial frozen input.
2. Apply the exact supplied protected opening using `human_save`. B1/M1 propose and
   human-review the supplied project-only procedural preference through the ordinary
   memory API as a project convention. B0 retains the raw correction and protected
   edit, without inventing a memory API for the baseline.
3. Resume the same conversation/artifact in a freshly constructed worker. The
   diagnostic interrupts after a durable tool result and reconstructs another
   namespace/worker using retained state. No source-refresh or future prompt enters.
4. Admit the changed-evidence episode's exact frozen passages, retaining prior work.
5. Use a separate conversation for analogous work; B1/M1 bind its project scope to
   the original work area. No private oracle or protected paragraph is re-injected.
6. Forget the reviewed project convention through the product API, then work in a
   separate workspace/conversation. Prior artifact reads in the new scope must fail.

The diagnostic script emits intentionally non-useful documents/replies. It checks
mechanics, **not** whether a model produces good research/editorial work, proper
source citations, complete downloadable formats, or useful transfer. A project
convention diagnostic is not evidence that independently authored procedures learn
usefully. The original network-13 capture/read/export proof remains the separate
full-tool plumbing evidence.

## Reproduction (zero paid calls)

From the canonical candidate, with its existing Python environment and local
PostgreSQL provisioning permissions:

```sh
PYTHONPATH=evaluation:backend backend/.venv/bin/python -m pytest -q evaluation/test_study_controller.py
PYTHONPATH=evaluation backend/.venv/bin/python evaluation/study_diagnostic.py --output .local/batch3/b35c/<new-private-directory> --stop-after 3
PYTHONPATH=evaluation backend/.venv/bin/python evaluation/study_diagnostic.py --output .local/batch3/b35c/<same-directory>
PYTHONPATH=evaluation backend/.venv/bin/python evaluation/verify_study_diagnostic.py .local/batch3/b35c/<same-directory>
```

Use a **new directory** for changed code; a restarted controller rejects any changed
execution/source/input binding. Existing failed and unknown runs are retained, not
rewritten. Long commands should use a tracked background process because the tool
frontend has a shorter timeout than the underlying CLI. The diagnostic creates only
new `workagent_test_*` databases; no installed database is adopted/reset. It writes
synthetic fixture grants, never an actual allocation or an installed grant.

Normal provider request capacity remains 50,000 input / 8,192 output tokens. Fixture
`max_steps=8` is the existing product DTO's diagnostic setting, **not** an eight-choice
acceptance gate. The live path uses existing exact installed authority and does not
alter its limits. The controller records `partial` honestly as an unscored outcome,
not a successful useful task. Diagnostic visit bounds stop with HOLD on exhaustion;
they do not truncate outcomes into a passing score.

## Exact real switch and admission interface — LOCKED

`study_transport.LIVE_EXECUTION_RELEASE` is **None**. There is no environment/CLI
flag to override it. Both `Controller(..., mode='official_api')` and
`ProductAdapter(..., live_bindings=..., credential=...)` fail before opening a store
or accessing a database. The isolated worker and transport factory independently
check the same release lock. No provider credential was loaded in this task.

After the execution owner resolves the compatible installed-authority/funding
boundary, a separately reviewed code release and new source binding are necessary.
The existing $100 cumulative ceiling is unchanged; this is not a request for generic
budget reapproval, a new funding scheme or an implicit installed-maintenance grant.
The intended invocation is:

```python
adapter = ProductAdapter(private_directory, None,
                         live_bindings=exact_bindings_by_blind_id,
                         credential=explicitly_injected_credential)
controller = Controller(private_directory / 'controller.sqlite', adapter,
                        mode='official_api')
controller.run()
```

Each existing binding supplies `blind_id`, `database_url` (restricted runtime role,
**not migration/admin**), `principal`, two `workspaces`, original/in-scope
`conversations`, the other-project conversation `other`, and the exact existing
`grant`/`other_grant` JSON. The adapter checks membership/conversation access, active
exact grants, official transport mode and treatment. It cannot provision an installed
database, install a grant or allocate. Each new run must already have compatible
exact tool authority before B1/M1 worker execution; missing tool authority is a HOLD,
not permission for the adapter to install it.

At worker attachment, source/inputs/dependencies/entrypoints, run configuration,
grant and any tool descriptors are checked. `funded_admission()` invokes existing
product pin/grant checks. It is **not a balance or funding receipt**: the unchanged
product `Ledger.reserve_operation()` and SQL accounting gates durably authorize
**each** count/create/read before transport I/O. Insufficient reservations, unknown
prior effects, incompatible authority or revoked access remain failures. Construction
of an HTTP client does not authorize a request. There is no separate local allowance,
refund, residual transfer or prepayment requirement introduced here.

The official transport factory uses the product's concrete `ResponsesTransport`,
exact project and secret-reference binding and explicitly injected credential. It
never routes real credentials through the controlled server. The real branch has
not been sent to a provider; only its fail-closed boundary is exercised here.

## Restart and unknown outcomes

- A controller commits `sending` **before** calling the adapter. A committed receipt
  can be observed after lost acknowledgement without resending the operation.
- Restarting after clean episode boundaries reuses existing operations and artifacts.
- Any unacknowledged application/provider effect remains `sending`/`unknown`; remote
  absence is not proof of no effect. Neither controller nor bridge blindly retries.
- If an application child dies after an effect but before its bridge receipt is
  committed, automatic continuation stops. Root must reconcile the existing IDs and
  authoritative product state; this package does not fabricate a receipt or change
  accounting. This conservative unresolved state is intentional, not exactly-once
  provider delivery.
- Disposable interruption diagnostics expire a worker lease only after checking all
  count/create events have matching results. The installed path has **no** lease
  surgery; a pending installed run stops for existing observation/recovery tools.

## Independent evaluation output

`Controller.export_evaluation(new_directory)` exports one JSON packet per collected
episode with opaque blind ID, episode, actual artifact bodies/body hashes, user-visible
messages, oracle **hash only**, and evidence level. Quality/effort are null and
`judgment=pending_independent_review`. Arm/source mapping and full traces stay in the
controller store; no judge/score can flow back to product ingress. These packets are
an output interface for a later independent evaluator, not scored evidence.

Local stores and full HTTP logs include synthetic prompts, private evaluator IDs and
disposable connection state. Do not publish the whole diagnostic directory. Public
handoff files contain only the code, aggregate proof, exact hashes and this guide.

## Retained diagnostics and remaining work

Early `controller-01` through `controller-11` directories are retained engineering
attempts, not accepted results. They exposed fixture field/path/target mismatches;
`controller-09` hit the foreground tool timeout and retains an unresolved send rather
than replaying it. They do not alter old preparation receipts. Final evidence is
identified explicitly by the separate verification result and manifest.

No installed accounting/DB/grant changes, ledger recollection, paid product/judge/
search calls, allocations, model/profile-cap changes, deployment or default merge
occurred. Development model: GPT-6-Astra/openai-codex; development-tool billing is
outside the product ledger and unreconciled. Independent review belongs to the
pre-created scoped review card, not an invented PASS in this implementation handoff.
