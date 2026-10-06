# Harness adoption spike — observed decision

## Decision: KEEP the current production boundary; do not switch harnesses yet

Hermes is a **viable candidate for the next isolated general-runtime adapter**, not a selected production dependency. The actual pinned loop executed source-free dialogue and a typed call through the real Workagent broker. That is materially more reusable than rebuilding a model/tool loop. **Reject a drop-in adoption of upstream defaults**: discovery, dependency conflicts, extra summary requests, grant accounting and durable effect recovery are not solved by `AIAgent(...)`.

Keep the existing Responses path **for its existing narrow approved profile**, plus Workagent's domain/broker/ledger authority. Do not make its mandatory-source/two-phase/next-action restrictions the general product contract. No backend, frontend, shared contract, accepted bundle, host Hermes/profile, live database or deployment was changed by this spike.

## Parent verification

Parent inspected the adapter and pre-import/kernel containment, reran the 10 bridge cases and three Responses comparisons at clean spike SHA `e08156d321ae37179795ec9adaf8c1439494f1eb`, and independently parsed the original 227-case regression XML and all recorded evidence hashes. The parent quick rerun intentionally did not repeat the regression suite. [Parent verification](../../spikes/hermes_bridge/evidence/parent-verification.json) preserves the scope and observed 2-iteration/4-request accounting mismatch. No production harness adoption is approved by these passing tests.

Historical stdout's `provider_calls` and JSON's `provider_requests` refer to **HTTPX MockTransport invocations**, not network inference. The parent clarified new stdout to `controlled_sdk_invocations` and added explicit actual source SHA/dirty/source-hash provenance. The rerun made 19 controlled SDK invocations across the ten cases and **zero external inference calls**; INET/INET6 remained kernel-blocked. Historical evidence files were not overwritten to pretend those new labels existed in the earlier run.

## Scope, pins and licenses

| Component | Exact reviewed/executed pin | License and use |
|---|---|---|
| Workagent | `b76eef865b13486e045d20e2c4586b3975e6ba2c` | Existing repository code; unchanged broker, worker, migrations, fixtures and tests |
| Hermes Agent | `f97608f178d1ffeca59860195ab7da295f7c8e5f`, release `v2026.9.24`, package `0.21.5` | Root MIT, copyright 2025 Nous Research. **Actually imported/executed**, not vendored/copied into a replacement loop |
| OpenClaw | `c074824a27c96d3983043f9eeb33823cd1772d8c`, release/package `v2026.9.7` / `2026.9.7` | Root MIT, copyright 2026 OpenClaw Foundation. **Not imported or executed** |

Hermes root LICENSE SHA-256: `821556e6336796450ab852d375117b48a4887e71d255794fd6318d99982a5ab6`; upstream `uv.lock`: `5b3798f326209475abca8ef7cbf7c9406f12e687c28c0b540dfe597466f48590`. Security-guidance plugin has an Apache-2.0 exception (`plugins/security-guidance/patterns.py`, accompanying LICENSE/NOTICE); plugin discovery was disabled and this plugin was not selected. Its LICENSE hash is `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.

OpenClaw LICENSE SHA-256: `73571b25326281d369087f469842c02444fe39faaecebda4d82ed21ff3a1c29d`; `THIRD_PARTY_NOTICES.md`: `c1d1bbc550feee74853eba104e347341569cbbbe37a9f77659993ca0766277d5`. Notices include MIT Pi/pi-mono (Mario Zechner) and GitHub Octicons. These are root/source observations, not an exhaustive bundled/transitive license audit. Preserve applicable copyright/license/NOTICE material if redistributing.

Used existing detached sources from [`upstream/pins.json`](upstream/pins.json), verified exact HEAD and clean Hermes tree; no reclone or upstream source edits. Live authoritative [Python-library documentation](https://hermes-agent.nousresearch.com/docs/guides/python-library) was retrieved, then interfaces checked against the exact pin. A guessed `/docs/developer-guide/` URL returned 404; it was not treated as evidence. Documentation is mutable and is not an SDK compatibility guarantee.

## Reproduce and inspect

```sh
cd /home/ubuntu/workagent-general-harness
/usr/bin/python3 spikes/hermes_bridge/run.py
# Faster bridge + comparison only, explicitly omitting the regression suite:
/usr/bin/python3 spikes/hermes_bridge/run.py --quick
```

[Setup and containment details](../../spikes/hermes_bridge/README.md). Full run: **10 bridge assertions/cases, 3 actual Responses-worker comparison traces; 227 existing regression tests passed, 1 explicitly deselected**. The deselected `test_cross_process_predispatch_single_winner` requires subprocess execution forbidden by this sandbox; it is not a pass or a newly proven concurrency guarantee. An earlier attempt actually failed on that restriction before explicit deselection. Four unchanged test modules ran: `test_responses_transport.py`, `test_responses_worker.py`, `test_responses_recovery.py`, `test_responses_review_fixes.py`.

Versioned evidence under [`spikes/hermes_bridge/evidence/`](../../spikes/hermes_bridge/evidence/):

- `hermes_results.json`: complete deterministic provider request/message traces, broker outcomes, return envelopes, actual upstream function-call counts.
- `responses_comparison.json`: real worker outcomes, exact synthetic wire requests, persisted ledger and artifact readback, replay request counts.
- `responses_tests.xml`: per-test results; `stdout.txt`: observed run summary; `stderr.txt`: captured errors/warnings, if any.
- `environment.json`: Python/distribution versions, exact upstream module hashes; `dependency_conflict.txt`: observed incompatible Pydantic requirements.
- `manifest.json`: invocation, run location and file hashes.

No HTTP server, paid provider, API-key read, credential lookup or live usefulness trial was performed. The SDK consumes **HTTPX MockTransport responses in memory**. Fixture token values and `estimated_cost_usd` are not measured provider usage or spend.

## Observations

| Scenario | Hermes pinned loop | Current Responses path |
|---|---|---|
| Source-free dialogue | One controlled SDK request, no tools or broker callback, completed response | Current `CreateAssignment` and `ScopedRead` reject empty source lists; not a source-free conversation interface |
| Hallucinated tool with tools disabled | `get_assignment` denied; no callback despite registration in the process | Selection has exactly one forced `read_scoped_context` tool, not open-ended dialogue |
| Typed scoped read | Two requests around one actual `Broker.call('get_assignment', …)`; returned assignment ID matches DB fixture; tool result reaches second request | Two generation phases around actual `read_scoped_context`, each preceded by token count; one artifact persisted and read back |
| Unapproved tool / bad type / foreign scope | `terminal` denied before callback; strict DTO rejects integer workspace; real broker denies foreign workspace | Altered selection naming `terminal` returns `invalid_selection`, no final generation/artifact |
| Source subset | No general-source callback implemented in bridge | A proper subset of selected sources yields `DomainError(not_found_or_not_authorized)`; exact set is enforced, not merely containment |
| Authority revoked after selection starts | Admin fixture revokes source access in disposable DB before callback; current broker returns `not_found_or_not_authorized` | Existing passing regressions cover permission/grant revocation before dispatch/publication and late evidence retention |
| Iteration bound | `max_iterations=2`: **4 actual SDK requests**, 2 callbacks, returned `api_calls=2`; final text says no summary available | Normal trace has exactly 2 generation dispatches and 2 count requests recorded by the ledger; fixed two-phase path |
| Hard stop | Actual `agent.interrupt(hard_cancel=True)` during controlled provider read; one request, interrupted result, no broker effects | Passing existing recovery/review regressions; not a new cross-process interrupt equivalence claim |
| Resume/replay | Fresh AIAgent receives returned history; prior tool result included, no repeat callback when next fixture is text | Fresh ResponsesWorker reconciles completed run with **zero new requests**; malformed-selection traces also do not regenerate on immediate retry |

`get_assignment` and `read_scoped_context` are different approved domain reads; this is a loop/authority comparison, **not identical model output or equivalent task-quality evidence**.

### Real reusable interfaces, not a renamed imitation

- `run_agent.AIAgent` constructor, `agent/turn_facade.py:22` `run_conversation(..., conversation_history=...)`, and `agent/interrupt_control.py:109` interrupt interface are real upstream methods.
- `tools.registry.registry.register(...)` exposes the typed broker callback through real `model_tools.handle_function_call` → `registry.dispatch`. Profiling in the result file observes these original source functions and `agent/conversation_loop.py` executing. No copied loop, stubbed dispatcher or fake agent object is used.
- The subclass changes only `_create_openai_client` to construct real SDK clients with controlled transports. **Replacing `agent.client` alone failed**: upstream creates request-scoped clients/restores runtime snapshots, so the first attempt hit the kernel network denial and retried. This is why the pinned private construction seam is used, not presented as public client injection.
- `enabled_toolsets` alone was insufficient to expose our custom schema directly: default progressive discovery transformed it into `tool_search`, `tool_describe`, `tool_call`. The isolated config explicitly sets `tools.tool_search.enabled: off`. The adapter asserts the exact visible tool-name set at construction.
- Explicit 32K context configuration failed with a real minimum-64K constructor error. The fixture now declares 65,536 tokens; this is test configuration, not a measured provider capacity.
- `agent/chat_completion_helpers.py:2252–2322` explains the measured bound mismatch: the summary path keeps schemas for cache parity, discards returned tool calls and may make a second empty-summary attempt. No third/fourth callback occurred, but `max_iterations` and the returned `api_calls` are **not a complete provider-dispatch budget**. This does not prove all Hermes telemetry misses them; it proves Workagent cannot meter from those fields alone.

## Authority and containment actually exercised

The supervisor sets a fresh HOME, HERMES_HOME, XDG roots, working directory and explicit environment **before import/construction**. Python runs `-I -B`; no inherited provider variables or plugin autoload environment. Linux seccomp rejects all non-UNIX socket creation and execve/execveat; an audit hook limits Python open() reads/writes, subprocesses and UNIX connect targets. AF_INET and AF_INET6 denial are exercised before upstream imports. PostgreSQL uses a new socket-only cluster inside a mode-0700 run directory; runtime role is separately checked as non-owner/non-superuser/non-bypass-RLS. The cluster is stopped and PID-file absence checked after every completed invocation.

Three import-discovery functions are replaced **before `run_agent` import**: dotenv loading, built-in discovery, plugin discovery. Actual constructor flags disable memory/context files/background review/trajectories; isolated config disables compression and tool search. These are explicit experimental isolation shims, **not a claim upstream exposes a pure embedding mode**. Ancillary subprocess attempts were blocked during normal initialization/cleanup. No arbitrary terminal, file, network, skill execution, memory or plugin tool is exposed to the agent.

The real broker revalidates typed requests, assignment/workspace, capability fence/lease, runtime pins, current source access and budget state. The callback does not accept a free-form principal or mutate acceptance records. Database-owner revocation is test setup only, not a model tool. Source-free dialogue does not get a Workagent conversation record: that general interface has not landed at this base. The assignment read uses the existing fixture-profile capability in a disposable database, **not a production Hermes runtime registration**.

Containment limits: Python audit hooks are not a native hostile-code filesystem sandbox, and AF_UNIX is necessarily available for libpq. No untrusted plugins/native tools are loaded intentionally. Do not turn this into a general code-execution service without a real OS/process isolation design. The process-local registry binding also does not prove safe concurrent multi-tenant in-process embedding.

## Concrete adoption blockers

1. **General-domain seam:** source-free conversation and capability-specific work products must be mapped to the broker without inventing parallel storage or weakening current authority. This spike supplies only `get_assignment`, not a general tool surface or commit path.
2. **All-dispatch grant/accounting seam:** count/reserve/authorize every normal, retry, summary and auxiliary request before dispatch. The observed 2→4 bound mismatch makes naive `max_iterations` mapping unacceptable. Disabled compression/background review must stay disabled until similarly bound. No live grant is requested by this spike.
3. **Durable lifecycle/effects:** returned conversation history is not a transactional receipt or exactly-once effect. Map checkpoint/resume/interrupt to Workagent leases, command IDs, uncertain-attempt reconciliation, idempotency and operation-specific readback before admitting mutations. No Hermes-to-Workagent publication or crash-between-tool-effect-and-history-save test was proved.
4. **Embedding surface:** replace three import monkeypatches and a private client factory seam with a reviewed upstream/public embedding boundary or a maintained pinned wrapper. Default discovery/global registry/prompt additions/ancillary subprocess attempts are not acceptable implicit authority.
5. **Packaging conflict, observed:** upstream pins Pydantic `2.13.4`; Workagent pins `2.11.5`. Offline `uv pip compile` of both requirements failed as unsatisfiable. This spike uses a separate Python 3.12.3 venv with 51 packages and Pydantic 2.13.4. Its passing backend tests are useful compatibility evidence, **not approval to rewrite the backend lock**. Full upstream dependency install, wheel distribution and full optional-tool license/security audit were not tested. Upstream requires Python `>=3.11,<3.14`; the host default Python was 3.14.7, so it was deliberately not used.
6. **Policy/prompt and usefulness:** tool/schema wiring and canned prose cannot prove planning quality, general making/operations, correct source use, concurrent tenant isolation, live latency/cost, or end-user value. No skills discovery/loading/execution is adopted or tested. Reviewed prompts, tool descriptors and a fresh bounded live grant would be separate approvals.

No OpenClaw queue, scheduler, gateway or agent loop was borrowed. The observed durable-replay/accounting gaps already have Workagent authority components to bind; importing a second lifecycle stack would not close the demonstrated seam. One selected harness should own the loop; Workagent remains the domain and effects authority.
