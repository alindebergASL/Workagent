# B3.1b interface and successor handoff

Read [ACCEPTANCE.md](ACCEPTANCE.md) first. This is the reviewed, mechanism-tested typed-memory increment on base `6f5897974b3e50024d46ecf09a053e969ab2cd03`, not installed runtime state. Exact changed bytes are in `source-manifest.json`; final commit belongs to the task transition/Git history. No default merge or new PR was created by closure.

## Canonical contract

- Migration `backend/migrations/058_typed_memory.sql` adds owner/workspace-scoped items, revisions, scope bindings, usage and non-content tombstones, guarded append/CAS/erasure functions. Only fresh disposable fixture databases were migrated. Do not edit already-applied journals, rewrite historical requests or substitute a historical installation pin.
- `contracts/memory-v1.json` exports `MemoryRevisionV1`, receipt/inspection/page, all human commands, binding and usage DTOs. OpenAPI and `contracts/src/schema.d.ts` are generated. Wire kinds: `fact`, `preference`, `project_convention`, `episode`, `procedure`. Scopes: `task`, `work_area`, `user` (owner within this workspace). Statuses: candidate/active/contested/superseded/expired/forgotten.
- Existing command envelope: `schema_version`, `request_id`, `command_id`; mutations of an existing item require `expected_revision_id`. Scope binding requires conversation `expected_work_version`. A stale command is409; do not rebase or resend as a new command automatically.
- Mutation receipt is **only** `{memory_id, revision_id, status}`. Read back the exact item; distinguish receipt acceptance, readback verification, access denial and network ambiguity. Never cache forgotten payload in command results. Replaying the same command returns the same content-free receipt.
- Ordinary explicit remember can activate a fact/preference/convention/episode. All procedures and all inferred proposals are candidates. Human review accept/dispute/reject is explicit; agent runtime has no accept/promote/memory-write tools. No automatic conversation backfill or autonomous inference extractor is installed.

## HTTP surface

Authenticated existing local API/command envelopes, workspace root `/v1/workspaces/{workspace_id}`:

| Method/path | Semantics |
|---|---|
| GET `/memory?conversation_id=...` | Eligible active+contested recall; optional `query`, `kind`, `status`, `subject_key`, `predicate_key`. `status=candidate` is the separate review queue. |
| GET `/memory/{memory_id}` | Current plus **currently authorized** historical revisions. A successful current inspection does not imply all previously visible history remains authorized. |
| POST `/memory/remember`, `/memory/candidates` | Human explicit statement or proposed inference;201 receipt. |
| POST `/memory/{id}/review` | Accept/dispute/reject under pinned CAS. |
| POST `/memory/{id}/correct` | Permanent supersession or explicit finite temporary interval with fallback. Existing source dependencies cannot silently be removed. |
| POST `/memory/{id}/narrow`, `/expire`, `/forget` | Explicit scope narrowing, whole-item retirement, or semantic payload erasure/tombstone; never promotion. |
| POST `/memory/scope-bindings`; GET `/memory/scope-bindings/{conversation_id}` | Explicit conversation→work-area link and exact readback. No same-user implicit project inheritance. |
| GET `/runs/{run_id}/memory-usage` | Authorized entries bound to run/request/attempt/phase/request SHA256; content-free identities and why. Source/forget reauthorization can remove entries from current readback. |

Reviewing a temporary exception preserves its base and time interval. Nested temporary exceptions, narrowing a temporary exception, and reject-only-exception transitions are intentionally refused. A permanent correction after an exception restores the base validity interval. Independent conflicting facts remain visibly contested; retrieval does not pick the newest.

## Runtime integration, not a new agent architecture

`memory/runtime.py` extends the existing computation decision schema via `GatewayMemoryDecision`. Opt-in requires sustained-v1 continuity and **this schema's exact SHA256**. Canonical schema bytes are in `contracts/gateway-memory-decision.schema.json`; calculate from canonical runtime material when installing, rather than copying an old pin. Existing file/computation schemas retain their previous identities, checked by unit tests. The generated capability registry implementation digests changed because bound service source changed—successors must provision compatible **isolated** installations, not mutate historical receipts.

Retrieval is owner/scope/source-eligible before lexical ranking, conflicts, snippets or omission. At most12 items and6,000 excerpt characters. Frozen `memory_context` + `memory_manifest` enter the existing packing/worker path; exact identities are revalidated before request/send/publication. Changed/forgotten memory invalidates unsent context rather than silently rebuilding an already-prepared request. Usage stores only identities/hashes/reasons and exact actual request bindings.

No live model was exercised. `harness/capture_later.py` runs the actual production worker with a controlled transport and then authenticates real usage GETs. Its synthetic grant retirement is restricted to terminal runs in the disposable proof; it does not reset historical cost/unknown liabilities. Do not use that fixture helper to operate live grants.

## Client behavior that must be preserved

Web is integrated inside conversation Memory details; native inside Files→Memory. No mandatory dashboard.

- Forget receipt immediately purges semantic display and forms, fences older list/inspection reads, and masks late payloads even before/after failed verification.
- Denied exact read clears payload and controls; temporary network trouble remains uncertain, not a fabricated access denial.
- Correction draft captures its **original** expected revision. A later refresh cannot silently rebase it. Explicit reconciliation is required.
- Submitted form stays locked through send and readback; success only clears its submitted version.
- Native Refresh reauthorizes selected exact item and **every retained historical revision ID**. Missing any old authorized history clears selection/forms/details/usage, even if current remains permitted. Bounded-list absence alone is not deletion. Explicit Inspect reloads the permitted current/history. Authorized refresh preserves unsent correction/CAS.
- `Used in the latest answer` is rendered from matching request-context usage entries, not a causal attribution/quality metric.

## Forget boundary

Forget erases semantic payload in all revisions and installs key/source-fingerprint tombstones for prior scopes; re-extraction is suppressed. Future context/usage readbacks honor current authorization. It cannot unsend previous requests or delete source documents, exported/user-saved outputs or historical outgoing receipts. There is no vector index/cache in this slice. Full descendant invalidation, restore-time tombstone replay/backup guarantees and wider procedural learning are B3.5a+, not established by this card.

## Exact retained proof and safe resumption

Remote `/home/ubuntu/workagent/proofs/b31b-recovery-tb7f7aa98` retains candidate, own backend venv/web dependencies, real production `.next` build and fresh restricted fixture. Private `regression-fixed.env` remains there; never copy it or private HOME. Existing approved EC2 is10.0.14.244; acquire a normal bounded idle lease before any successor test service. Heavy builds/browser/PG remain remote while local disk is98% full.

Closure verified original lease142c018d-f7b1-4e9e-8a72-4a39aabb81df released, acquired normal leasead1b09e6-316b-4e1f-82c3-2bc6cbad3e82 and released/read it back empty. `receipts/runtime-final.json` confirms owned API8895/web8898 stopped, ports18231/13231 refused, installed API917/web918 and PG/timer active. Check process/cwd/ports before any reuse. Original local services and untracked contracts lock were not modified.

Harness copies are in `harness/`. To reproduce their historical invocation, place them in the candidate's recorded paths (`.local/batch3/b31b/*.py`, root browser*.mjs) and follow actual command receipts; they are evidence fixtures, not product entrypoints. Set `WORKAGENT_OPERATOR_URL=http://127.0.0.1:18231`, normalized absolute isolated HOME/TMPDIR and `PYTHONPATH=backend:backend/tests:.local/batch3/b31b`; browser uses the existing `/home/ubuntu/.cache/ms-playwright`. Secrets are sourced locally on the EC2. No credentials in documents/commands. Startup scripts operate only candidate loopback18231/13231.

Canonical check qualification: `npm run check` failed only at copied contracts `.bin/tsc`; canonical/drift/alpha checks passed, and direct `node node_modules/typescript/lib/tsc.js --noEmit` passed separately. Do not repeat a broad verification campaign or claim the wrapper passed. Existing final review PASS is reusable unless material source changes.

## Existing successor and ownership

`t_5a57eb56` is the pre-created B3.1c combined computation/reviewed-memory journey; no new graph was made. At pre-completion readback it was `todo`, waiting only for this card. Completing this slice releases dependency gating; this does **not** prove the dispatcher has started a worker. The lifecycle handoff reports the actual read-back successor state.

B3.1c owns ordinary conversation→real confined calculation→download→human annotation and reviewed lesson→restart→later changed assignment, negative transfer and no-memory control. Reuse accepted B3.1a sandbox evidence and this memory evidence, not whole-suite repetitions. Current compute adapter descriptor differs from predecessor's historical install; reconcile owned isolated source/install pins honestly. No computation regression/journey was executed on this memory finishing card.

Hermes owns backend/native/integration; primary Claude Cloud owner retains web. The bounded local Opus5.5 repair is integrated, but later Cloud `88bf984`/`4f75f5d`/`5c66c3bf9ac7f001b59cbd64be6dd5d21830e512` work was not blindly merged here. Preserve and reconcile exact overlap before later integration. Feature publication is authorized standing work but was not required to release this local-only slice; no default merge, runtime promotion, private connector or paid product calls occurred.
