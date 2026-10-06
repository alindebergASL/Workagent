# Current runtime status and execution boundary

## Candidate actually available for review

**Application SHA: `f68efe5c81e4865f9e1547e03b4af7b62c4303a0`.** All three exact-head GitHub workflows passed after infrastructure-only runner retries; no workflow bypass or source change was needed. See [PR9 final handoff](https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6001879175).

The existing private EC2 review stack is live on16.148.68.248, loopback web3000/API8000, with the retained `.local/parent-quota-final.env` database. Both preserved CSV and shipping examples are open in the host browser and have been read back through the actual API, including CSV/WAT downloads. [Working access, startup/restart and walkthrough](EXPERIENCE_REVIEW.md). A saved database alone is not the access claim: the processes and responses were checked.

## Implemented and verified

- Source-free durable conversation and general prompt/continue/inspect/cancel CLI through GeneralWorker and the normal dispatcher.
- Typed CSV table/file products, safe export and exact local arithmetic; import-free integer Wasmtime tools with bounded execution and observed readbacks.
- Broker/domain authorization at execution and commit, immutable revision/proposal binding, human edits, exact replay, fences, truthful unavailable/failure and same-run restart recovery.
- Integrated real Next.js/FastAPI/PostgreSQL experience: CSV edit/save/recalculate/export/reopen; per-field shipping inputs; conversation beside work; phone panes; reply/draft/retry preservation.
- Current personally rerun evidence:81 frontend tests,17 focused DOM cases,15 mock browser cases,72 relevant PostgreSQL cases and actual controlled product/recovery journeys. Prior full403 backend result is reused by unchanged backend/contracts/runtime bytes, not relabeled as a fresh full-suite run.

CSV and shipping are breadth tests of the same general work product path. They are not its identity or evidence for unrestricted/general autonomy. Explicit delegation remains paused/unsupported, not secretly handled in the background.

## Missing real-model implementation—not just permission

`backend/workagent/general_worker.py` explicitly rejects any transport that is not `ControlledTransport` with controlled mode. The ordinary response is deterministic text. The product path derives from an explicitly supplied typed operation; the controlled transport selects that already-chosen operation. User-authored natural-language requests do not currently cause model-selected tool execution or tool-code generation/revision.

The existing live `responses_transport.py` / `responses_worker.py` and provider-attempt authority belong to the historical intake profile. They are useful reusable components, not an already-connected general product runtime. Granting calls or setting a key would not remove the gap.

The next **proposed** implementation is a bounded live transport/tool-selection path inside the same GeneralWorker/dispatcher/domain. It must accept natural-language messages and authorized bounded context, expose only authorized tool schemas, validate model-selected arguments through the existing broker, feed back actual results, and preserve attempt/replay/fence/budget authority. No direct-provider demo script, operator-selected action masquerading as selection, parallel business state or new harness research. See [minimal implementation and bounded test proposal](GENERAL_MODEL_SLICE.md).

## Historical live evidence retained

The synthetic intake Responses initial/revision experiment used `gpt-6.1-sol`; [INTAKE_ACCEPTANCE.md](../handoffs/backend/INTAKE_ACCEPTANCE.md) records its exact evidence and limitations. Four generation submissions exhausted that grant. It is expired and will not be reused. That historical success does not prove present model entitlement, general action selection, code generation or usefulness.

The harness comparison is complete: [HARNESS_ADOPTION.md](../handoffs/backend/HARNESS_ADOPTION.md) retains Workagent authority and does not adopt a new production Hermes/OpenClaw stack. Do not restart that research to connect one bounded model route.

## Verdicts and boundaries

- **Engineering PASS:** controlled B1–B3 integrated paths and documented recovery boundaries.
- **Experience:** actual desktop/phone interactions verified; Andrew's hands-on acceptance remains pending.
- **Usefulness NOT TESTED:** no real model has selected/generalized these product actions through this worker.

Default local startup stays controlled and strips model keys. Live implementation/testing has not occurred; the proposed implementation and a separately bounded live run need the agreed scope/authorization. No new Workagent inference/spend, private-context access, external business effects, default merge or deployment. Accepted bundles, old Body hashes, pins and expired grants remain unchanged. B4–B7 broader ongoing ownership/coordination/memory remain outside this slice.
