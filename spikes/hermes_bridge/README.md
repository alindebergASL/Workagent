# Bounded Hermes → Workagent broker spike

No inference, provider/account access, production configuration changes, or approved runtime bundle changes. The provider is an **in-memory HTTPX MockTransport**, not a live endpoint. This is a pinned-source experiment, **not an installable production Hermes SDK integration**.

## Run

From the repository root, on Linux with PostgreSQL 16 binaries at `/usr/lib/postgresql/16/bin`, `libseccomp.so.2`, Python 3.12, and `uv`:

```sh
# Package downloads only. Isolated install HOME/cache; no host config is sourced.
env -i HOME="$PWD/spikes/hermes_bridge/.install-home" PATH=/usr/bin:/bin \
  UV_CACHE_DIR="$PWD/spikes/hermes_bridge/.uv-cache" \
  /home/ubuntu/.local/bin/uv venv --python /usr/bin/python3 spikes/hermes_bridge/.venv
env -i HOME="$PWD/spikes/hermes_bridge/.install-home" PATH=/usr/bin:/bin \
  UV_CACHE_DIR="$PWD/spikes/hermes_bridge/.uv-cache" \
  /home/ubuntu/.local/bin/uv pip install --python spikes/hermes_bridge/.venv/bin/python \
  -r spikes/hermes_bridge/requirements.lock

/usr/bin/python3 spikes/hermes_bridge/run.py
# Shorter iteration: same 10 bridge cases + 3 Responses traces, not regressions:
/usr/bin/python3 spikes/hermes_bridge/run.py --quick
```

The default detached source is `/home/ubuntu/workagent-upstream-review/hermes-agent`; override with `--upstream /absolute/clean/checkout`. The runner refuses a dirty checkout or any HEAD other than `f97608f178d1ffeca59860195ab7da295f7c8e5f`. It imports directly from that checkout without modifying it or installing it into the host. `requirements.lock` freezes the **51 observed spike distributions**, not the full upstream `uv.lock`. Backend tests use this combined spike environment (Pydantic 2.13.4), not the backend's own Pydantic 2.11.5 lock.

Each invocation creates `.runs/<supervisor-pid>/`, a private HOME/HERMES_HOME and a **new PostgreSQL cluster** with no TCP listener. It creates separate database-owner and non-owner runtime roles and applies unchanged Workagent migrations. Only actor-fixture sources are seeded. The supervisor stops that exact cluster in `finally`, verifies its PID file is gone, and never connects to a host database. No sudo or existing database env is used. Per-process runtime files stay ignored; evidence is explicitly copied to `evidence/` after a successful run. Default watchdog: 540 seconds. Interrupted supervisor processes should be checked for their own `.runs/<pid>/pgdata/postmaster.pid` before discarding the directory.

## What actually runs

- `run.py`: stdlib supervisor, clean environment allowlist, pin/clean-tree check, new disposable cluster, bounded child, captured stdout/stderr.
- `isolation.py`: **before any upstream import**, verifies HOME/HERMES_HOME; installs seccomp denial of all non-UNIX socket creation and execve/execveat; Python audit restrictions for subprocesses, file reads/writes and Python UNIX connection targets. Only the disposable PostgreSQL UNIX target is permitted by the audit hook. System library reads remain allowed. This is **not a hostile-native-code sandbox**: native filesystem access and AF_UNIX operations are not fully mediated by Python audit hooks.
- Before `run_agent` import: disables dotenv loading, built-in tool discovery and plugin discovery through three pinned process-local function replacements. The isolated config disables progressive tool search and compression. Memory/context files/background review/trajectory persistence are disabled via actual constructor switches. No host profile is edited.
- `adapter.py`: upstream `AIAgent` subclass replaces **only client construction** with real OpenAI SDK clients backed by deterministic HTTPX SSE/JSON responses. The upstream conversation loop, transport normalization, tool routing, registry dispatch and interrupt logic remain unchanged. A registered `get_assignment` tool validates the real Workagent DTO and calls the **real Broker**, bound to a real capability. No model-selected principal, raw SQL, save, accept, or arbitrary execution callback is exposed.
- `probe.py`: checks source-free dialogue, zero-tool hallucination denial, typed broker round trip, history resume, unknown-tool/type/foreign-scope denial, bounded iterations, current-authority revocation, and hard stop. Profiling records actual calls into pinned upstream loop and dispatch functions.
- `compare.py`: runs the actual current Responses worker/transport/broker/ledger with its repository synthetic provider. Captures two-phase generation, exact-source-set rejection, unknown-tool rejection, readback and replay behavior.
- Existing tests: `test_responses_transport.py`, `test_responses_worker.py`, `test_responses_recovery.py`, `test_responses_review_fixes.py`; **one cross-process subprocess test is explicitly deselected**, because subprocess execution is forbidden in the child. No test files are changed and no skip is presented as a pass.

## Evidence and boundaries

`evidence/hermes_results.json` contains full controlled request/message traces and callback outcomes. `responses_comparison.json` contains real worker outcomes, controlled wire requests, ledger and artifact readback. `responses_tests.xml` enumerates regression test outcomes. `environment.json` records actual installed versions and upstream source hashes. `stdout.txt` records the final invocation output. These are wiring/safety results, **not usefulness, latency, cost or live model evidence**; token numbers in fixtures are fabricated test inputs, not measurements.

The bridge binds an existing assignment-scoped read broker in a disposable database. It does **not** add Hermes as an accepted Workagent runtime, bind a new source-free general conversation domain, publish artifacts, use a grant for inference, or implement durable cross-process Hermes resume. Passing returned history to a fresh agent proves replay consumption only; the loop is not an effect-idempotency authority. Keep Workagent command identities, fences, budgets, reconciliation and commit readback authoritative.

See the [adoption report](../../handoffs/backend/HARNESS_ADOPTION.md) for the decision and blockers.
