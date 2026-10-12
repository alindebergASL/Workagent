# Corrected-build admission regression — PARTIAL / strict network HOLD

## Outcome

**The configuration/admission assertion passed; the strict zero-external-attempt assertion did not.** This is a non-live controlled-fixture regression, not a semantic-continuation PASS and not a repair of the first live attempt. Issue #13 remains open. Original review worktree, build, services, database, messages and grants were not changed or rerun.

The corrected production UI sent one ordinary artifact-page reply containing the exact saved artifact/revision/hash. Real HTTP admitted it with **202**, a fresh HTTP GET returned **200**, and PostgreSQL/Service readback retained the same target. Canonical `conversation_worker_context` bound `target_body` to the entire saved human revision, including the human note. The persisted `run_contexts.context_sha256` matched the assembled context. This proves more than a client request payload.

Provider attempts, responses steps/events/consumer uses and proposals were all **0** before and after. No model, provider transport, external API response fabrication, paid grant or project-budget change occurred. The sole local grant is synthetic-only and names an intentionally nonexistent secret file. The UI turn was claimed only to assemble canonical context; no worker/dispatcher processed it. Its retained state is `running` with an expiring/expired lease, not a completed result.

### Network qualification (reason for overall PARTIAL/HOLD)

`strace -f` covered connect/sendto/sendmsg for the controlled fixture/check and its API, Next production server, and browser descendants. Browser HTTP external-request lists were empty, and no successful external socket connection was observed. However, browser descendants made **12 IPv6 connect attempts** to `2001:4860:4860::8888:443` across browser setup/reopen attempts; **every one returned `ENETUNREACH`**, including the resumed syscall. These appear to be browser reachability probes, not provider requests. Therefore it would be false to claim *zero external connection attempts*. The narrow admission proof stands, but the requested strict network invariant is not fully satisfied. See `network-verification.json`; raw private traces are mode 0600. Build and privileged DB bootstrap are outside the trace scope; this is not host-wide monitoring.

## Candidate / build / isolated runtime

- Candidate: `dd01cd49a9b026edf8a99281d182e0554d54f4e2`
- New detached worktree: `/home/ubuntu/workagent-general-admission-review`
- BUILD_ID: `iaKQHcHGIn8V1TbkNONjy`
- Successful build command (from the new worktree's `web` directory):
  `env NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1 NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build --webpack`
- Build: optimized Next production build, webpack. TypeScript and page generation completed; `build.log` retains output.
- Public flags: natural admission `1`, API base `/api/domain`; public principal and mock control unset. `NODE_ENV` was not explicitly supplied; Next build/start use production mode.
- Runtime: `WORKAGENT_WEB_ORIGIN=http://127.0.0.1:3165`, `WORKAGENT_BACKEND_URL=http://127.0.0.1:8165`, `LOCAL_TEST_MODE=true`. Bearer remains private in the newly generated environment file.
- Python: `/home/ubuntu/workagent-flexible-work/backend/.venv/bin/python`, launched with `PYTHONPATH` and `PYTHONHOME` unset. `scripts/workagent.py.environment` provisioned/seeded the isolated DB and removed provider keys from child environments.
- New retained database: `workagent_test_4288453dfc56`, provisioned using `dev_db.py` and the exact candidate's canonical actor seed. No old database was adopted or reset.
- Dependencies: only explicitly requested symlinks to the existing `web/node_modules` and `contracts/node_modules`.
- Ports 3165/8165 were checked free before starting. Only owned process groups were stopped; final port check shows no listeners. DB and evidence retained.

## Exact identities / binding

| Field | Value |
|---|---|
| Conversation | `5c1f6bdf-f317-466a-880c-4ec0c2ebadf6` |
| Artifact | `7868ab81-6efc-4699-87bb-f8a397259762` |
| Saved human revision | `641e3cfe-b1e4-4596-ac9c-75a0577f076a` (revision 2) |
| Saved body hash | `0abaeb490efa9c9436c48b8b1b6218afb9afe5276e991e5d382524edabca6a63` |
| Persisted UI message | `16756df3-ad38-4efc-8a9b-5396914e9d6e` |
| Admitted run | `26cc71d6-88dc-498b-8cc7-19a52e7e8527` |
| Persisted context hash | `3775b5c2edaeba2f4ea7e13c2a2641ac1e19110fbd7ef3441228717926577a8f` |

Human note: “Human note (controlled fixture): keep the blue folder and Thursday review; preserve this exact saved note.”

Ordinary reply: “Please make this saved document decision-first and keep my exact human note. Controlled admission regression only; do not run a provider.”

No operation picker/structured operation was supplied for that UI reply: `operation` is null, `attachments` is empty, and `target` is exact. The document was a clearly labeled synthetic Service fixture, published through ControlledTransport, then revised via `human_save`; it was not generated live and the human-note setup was not itself a UI-edit test.

## Evidence

All helpers/evidence are under `/home/ubuntu/workagent-flexible-work/.local/general-continuation-admission/` (ignored):

- `verification.json` — final bounded result, identities, flags, assertions and limitations.
- `browser.json` — sole actual POST request/202 response, browser observations.
- `reopen.json` — read-only browser reopening and fresh HTTP GET/200; no POST.
- `saved-artifact.json`, `final-saved-artifact.json` — identical saved revision before/after; only envelope `observed_at` differs.
- `persisted-conversation-before-context.json`, `persisted-conversation-after-context.json` — authoritative stored message/run evidence.
- `selection-context.json`, `persisted-context-binding.json` — actual canonical assembled context and database binding.
- `ledger-final.json` — zero attempts, steps/events, consumer uses, proposals.
- `network-verification.json`, `*.strace` — parsed network qualification and retained raw traces.
- `ui-post-admitted-01-saved-human-document.png` — initial saved document, before reply.
- `02-ordinary-reply-admitted.png` — read-only reopened saved document and visible submitted message; UI says “Waiting for a reply.” Human note remains visible. No claim of an agent answer.
- `build.log`, `api.log`, `web.log`, `execution.log`, archived error logs — build/runtime history.
- `check.py`, `browser.mjs`, `finalize.py` — local-only helpers. **Do not rerun check.py or browser.mjs against this retained fixture**; `finalize.py` is the read-only verifier.
- `isolated.private.env` — private local DB/bearer, mode 0600; do not publish.

## Helper issues encountered and retained

1. An initial invocation used the wrong build working directory; the successful build was run from `web`, with no source change.
2. `sudo` provisioning under `strace` failed because ptrace disables privilege elevation. Provisioning was done once outside strace through the standard environment helper, then runtime tracing resumed.
3. Pre-POST helper issues (urllib Request name collision, resolver rule initially excluding localhost but not 127.0.0.1, duplicate human-note locator) were fixed only in ignored helpers. Evidence was archived; no UI POST occurred in those attempts.
4. The **one** UI POST succeeded, but an exact-text assertion failed because the recent-message accessible text includes `You:`. Its request/response was preserved; subsequent browser work was read-only, with no resend.
5. A restart port bind saw TIME_WAIT rather than a listener; the prerequisite check was adjusted for address reuse without killing any process.
6. Full artifact envelope equality incorrectly included changing `observed_at`; read-only final verification instead checked the immutable revision and all other envelope fields. No second claim or worker execution was used.
7. Strict external-attempt parsing exposed browser IPv6 probes, so the final status is explicitly PARTIAL/HOLD rather than a fabricated full PASS.

## Scope / remaining work

No tracked source changes, code fix, commit, push, merge, deploy, original live rerun or issue closure. The exact candidate's tracked diff is empty; only requested dependency symlinks and generated ignored build output exist in the new worktree. Original workspace's pre-existing untracked helper was untouched.

This narrows the original missing-target behavior to build configuration in this controlled setting. It does not establish useful model continuation, editable-proposal generation, authority/content preservation by a model, or equivalence to the original live attempt. A strict zero-attempt proof would require a separately authorized fresh fixture with stronger browser/network confinement; do not resend this retained message to obtain it.
