# General Responses backend contract — implementation handoff

Status: **backend contract implemented, disabled by default; synthetic-only verification, no live model/account verified or activated by this owner**. Existing controlled profiles and intake remain available. One operation per turn is this checkpoint, not the product ceiling. Adaptive within-task continuation, actual specialist delegation and persistent responsibility ownership remain required, not implemented by this profile.

## Admission contract

`POST /v1/workspaces/{workspace_id}/conversations/{conversation_id}/messages` retains the existing command envelope. Opt-in is server-owned (an active scoped `general-responses-v1` grant); neither client nor model selects a grant or expands its scope. Do not send `operation` on this path.

Initial CSV:
```json
{"schema_version":"workagent/v1","request_id":"request-csv-1","command_id":"command-csv-1","expected_work_version":1,"text":"Reconcile this invoice CSV. Keep original values and notes; show discrepancies and give me a downloadable result.","attachments":[{"filename":"invoices.csv","mime_type":"text/csv","content":"id,quantity,unit_price,reported_total\nA,1,10,10\n"}],"target":null}
```
Attachment content is bounded UTF-8 inline text, not a path. Server assigns immutable `ref`, `byte_length`, and `sha256`; caller cannot supply them. CSV decisions reference that exact attachment/hash, never replacement CSV bytes. This bounded synthetic profile admits only source-free conversations named in its grant; selected-source conversations remain on their existing authorized controlled/intake paths, not an implicit private-context model grant.

Revision (use exact current artifact readback; placeholders are not valid hashes):
```json
{"schema_version":"workagent/v1","request_id":"request-revision-1","command_id":"command-revision-1","expected_work_version":3,"text":"Recalculate my saved table using round-half-even. Preserve my edits and propose the change.","attachments":[],"target":{"artifact_id":"artifact-id","revision_id":"revision-id","body_hash":"<exact 64-character lowercase SHA-256 from readback>"}}
```
Initial tool: same envelope, `attachments: []`, `target: null`, text “Build a small local invoice-total calculator with quantity and unit price in cents. Test quantity3 and price1250.” No supplied WAT or operator selection. Tool revision carries exact target and text requesting shipping; model generates bounded import-free WAT.

## Profiles and UI requirements

- `general-controlled-v1`: existing controlled conversation; retained default.
- `general-products-controlled-v1`: existing explicit human-operation controls; retain, visibly controlled.
- `general-responses-v1`: new explicit server activation only, revocable no-calendar-expiry grant, at most **four cumulative admitted turns** across its scoped conversations, and cumulative $20 /8 generation /8 count /80 retrieve /160000 input /65536 output ceilings; leases still expire. Application and serialized SQL admission both enforce the turn cap, including cancelled turns. Not active merely because a browser submits an attachment.
- `openai-responses-v1`: historical intake profile unchanged in authority/limits.

Composer: prompt + bounded attachment, no required operator choice. Companion sends exact current revision/body hash. Render provider pending/unknown without “send another turn to retry”; unknown sends are not regenerated. Distinguish synthetic/live model-selection receipts from trusted local execution observations. Model prose never establishes execution, permission or acceptance. Human revisions remain pending proposals; retain explicit accept/reject and notes/history.

## Exact Home / Spaces read recipe (no new business state)

The existing paginated routes support all required canonical joins; no assignment per chat, new product table or invented Space mapping is required. Read with current authenticated workspace scope and follow **every** `next_cursor`:

1. `GET /v1/workspaces/{workspace_id}/conversations` → `items[]` (`id`, `title`, `updated_at`, `last_message_preview`, `execution_profile`, `model_activation`).
2. `GET /v1/workspaces/{workspace_id}/conversations/{conversation_id}` → `artifact_ids[]`, `assignment_ids[]`, `messages[]`, `turns[]`, `runs[]`. `artifact_ids` are actual conversation-owned artifacts, not conversation-message heuristics. Empty `assignment_ids` means no delegated responsibility; do not manufacture “I'm handling” from a conversation or run.
3. For each artifact ID, `GET /v1/workspaces/{workspace_id}/artifacts/{artifact_id}` → `id`, `workspace_id`, `conversation_id`, `assignment_id:null`, `current_revision_id`, `current_revision:{id,body,body_hash,author_kind,created_at,...}`. Use this current saved revision (including human changes), not the older body in a message/observation.
4. `GET /v1/workspaces/{workspace_id}/artifacts/{artifact_id}/proposals` → paginated `items[]`. Pending decisions are only `status:"pending"`. Compare `base_revision_id` with the artifact's `current_revision_id`: unequal means stale, not acceptable and not rebased. Keep it reviewable/dismissible; acceptance is always explicit. Dismiss with the actual current revision ID. `status:"accepted"`/`"dismissed"` is not a pending decision.
5. For genuine execution evidence, follow message `result.results[]` product entries to `GET /v1/workspaces/{workspace_id}/observations/{observation_id}`. `binding_state` is `current_revision`, `pending_proposal` or `historical`; never present historical output as an observation of a newly human-edited current body. Wasm `output.value` is an exact decimal **string** in HTTP. `evidence_origin:"local_tool"` and `model_selection` are separate from the assistant's synthetic/live model receipt.

These reads are scoped individually; omit unavailable/403/404 objects and discard cached workspace data after scope loss. Multi-request joins are not a transaction: re-read the artifact before a decision and handle authoritative `version_conflict` / `decision_stale` without retrying acceptance. Direct conversation detail is appropriate for conversation work; Home may aggregate the above authorized pages and deduplicate by `(workspace_id,artifact_id)` and `(workspace_id,proposal_id)`.

**Spaces:** if the client presents an authorized workspace as a Space, join exactly on `workspace_id`. There is no additional canonical `space_id` or conversation-to-finer-Space membership relation. Never infer associations from matching titles, browser-local groupings or source overlap; do not relabel each conversation as a Space. All conversation/product/proposal reads above remain in the actual authorized workspace.

## Exact pending / recovery read contract

`ConversationDetail.turns[]` is keyed by `run_id`, also present on the admitted human message and `runs[]`:

- `profile`: `general-responses-v1` for this path.
- `state`: `queued`, `responding`, `replied`, `failed`, `unavailable`, `cancelled` (the shared enum also retains `outcome_unknown`; this profile represents uncertainty as `unavailable` plus the next field).
- `provider_observation`: `not_observed`, `pending`, `received`, `outcome_unknown`, `invalid`. Never turn a stored run/model name into a claim that a model responded. `received` can accompany a rejected local tool (`state:failed`), not just success.
- `evidence_origin`: `unverified` until publication, then `synthetic_provider_receipt` or `live_provider_receipt`. Controlled paths remain explicitly `controlled_transport`.
- `reason`: server explanation, suitable for uncertainty/details, not a completion claim.
- `response_steps[]`: at most two, `phase:selection|final`, `state:prepared|count_unknown|counted|outcome_unknown|accepted|received|invalid`, nullable `response_id`, reported input/output tokens, reserved cost, conservatively calculated cost, nullable billed cost. `accepted` means durable provider response identity, not accepted human work.
- `retained_local_result`: nullable **read-only journal projection**. If present: `status:reply|observed|rejected`, `published:boolean`, `binding:{attempt_id,selection_request_sha256,selection_response_id,decision_sha256,operation_hash,base_hash}`, nullable `body:TableBody|ToolBody`, `output:CSVObservation|WasmObservationResponse`, `reason`. Wasm `value` is again a decimal string. `status:observed,published:false` exposes the retained local calculation when explanation is pending/invalid/unknown; it is not yet an artifact/proposal, not accepted work, and must not be rendered as a current saved product. Retained historical body stays inspectable across restart; current human work is still the canonical artifact read. No mutation API accepts a retained local result.

Recovery uses the **same run/attempt/private state directory**. A known response ID is retrieved rather than regenerated. A lost response ID or uncertain count stays unresolved with reservations retained; neither new turn nor replacement count/generation is an automatic recovery. After a staged local result is durably recorded, restart uses it without executing the local kernel again. Before staging, only pure bounded local calculation may repeat. Cancellation/revocation/current edits prevent subsequent provider I/O and publication, without deleting retained evidence or refunding committed reservations. General execution rechecks the exact admitted target and context before each count, generation or retrieval, including immediately after reservation and before I/O. Receipts arriving from already dispatched I/O still use write-only retention. The frontend may poll scoped conversation detail; it must not launch replacement work to make a spinner disappear.

### Limits, decisions and transport replay

- At most two attachments, aggregate 200000 UTF-8 bytes; nonempty `.csv`/`text/csv` or `.txt`/`text/plain`, filename regex `^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(csv|txt)$`; NUL rejected. No paths, arbitrary upload URLs or client-supplied receipt/hash fields.
- POST returns **202** `{conversation,message,run}`. Read the conversation again for current `work_version`; completion does not equal proposal acceptance.
- Preserve the entire original payload, `command_id` and `expected_work_version` only for replay of the same ambiguous transport attempt. New intent / changed attachments / changed target / editing after a definite refusal requires a new command ID. Do not silently replace the payload of an uncertain command. Old commands without attachment/target remain replay-compatible.
- Wrong current revision/hash fails `version_conflict`; wrong conversation/workspace ownership is concealed as `not_found_or_not_authorized`; malformed closed input fails validation (HTTP422). Error JSON is a top-level `ErrorEnvelope` with `code`, not `{error:{code}}`.
- `POST /v1/workspaces/{workspace_id}/artifacts/{artifact_id}/save` uses `HumanSave {schema_version,request_id,command_id,expected_current_revision_id,body}`; it saves a new human revision, not a tool run.
- `POST /v1/workspaces/{workspace_id}/proposals/{proposal_id}/accept` uses the command envelope plus `expected_current_revision_id`. A base/current mismatch returns HTTP409 `version_conflict` even if the caller supplied the newest revision; it does not rebase the proposal.
- `POST /v1/workspaces/{workspace_id}/proposals/{proposal_id}/dismiss` uses the same expected current revision plus `resolution:"keep_current"|"dismiss"`. This preserves current human work and ends the decision.

## Operator activation / status / serving (not a browser task)

General-profile admission and provider-operation reservations require PostgreSQL
READ COMMITTED (the runtime default). SQL rejects snapshot isolation modes rather
than allow stale snapshots to evade cumulative admission/budget checks. This does
not restrict write-only retention of receipts from already dispatched requests;
historical intake policy remains unchanged.

Run from `backend/` with its pinned Python dependencies. Retain the existing controlled API/dispatcher startup; nothing defaults to live. The API entrypoint is `python -m workagent` (loopback8000). Model work is the existing `GeneralWorker`, explicitly enabled by the existing Responses dispatcher, not a parallel provider script.

1. Create **two source-free conversations** in the existing authorized synthetic workspace (API `POST .../conversations`, or `python -m workagent.prompt_cli --general-responses --workspace "$WS" create`). Record their IDs before preparing authority; the bounded grant cannot silently add conversations or reset by changing IDs.
2. The parent/operator verifies official route/account/model/current conservative prices. A route JSON has `grant_id`, `runtime:{profile:"general-responses-v1",model:"gpt-6.1-sol",product_project_id,secure_secret_reference:"file:/absolute/owner-only-key-file"}` and `verification:{checked_at:<timezone-aware ISO timestamp within24h>,model:"gpt-6.1-sol",official_origin:"https://api.openai.com",account_available:true,model_available:true,synthetic_context_confirmed:true,service_tier:"default",store_acknowledged:true,input_usd_per_million:<verified numeric string>,output_usd_per_million:<verified numeric string>,authorization_sha256:"d7f676d970ef2c6d56c39fe961114d00140279b99ba72649177c41de159093c9"}`. This record is explicit operator evidence, **not automatic discovery**. Never invent successful availability booleans or use an unverified model/account. Conservative reservations remain $2.50 input/$10 output per million (no discount),20000 input/8192 output per generation. The parent handles the already-authorized live gate; this is not a request for renewed spending permission.
3. Draft exact current consumer/schema/policy pins (no DB, key access or activation):
   ```sh
   python general_grant_draft.py --authority-record "$ROUTE" --workspace "$WS" \
     --principal "$LOCAL_PRINCIPAL_ID" --conversation "$CSV_CONVERSATION" \
     --conversation "$TOOL_CONVERSATION" --out .local/general-grant.json
   ```
   Output is exclusive-create0600, `max_runs:4`, `expires_at:null`; no replacement/reset on restart. Code changes invalidate pins; freeze/review the candidate before installation. Do not install another authorization to recover old work.
4. Explicit owner installation (requires `MIGRATION_DATABASE_URL` separately from restricted `DATABASE_URL`, `LOCAL_TEST_MODE=true`; never publish either):
   ```sh
   python -m workagent.responses_dispatcher --general-responses --workspace "$WS" \
     --grant-id "$GRANT" --authority-record "$ROUTE" --state-dir "$PRIVATE_STATE" \
     --install-grant .local/general-grant.json
   ```
   This verifies DB readback and returns `operator_grant_installed`; it does not read the provider key or generate.
5. Read cumulative local status without route file, provider credential or network:
   ```sh
   python -m workagent.responses_dispatcher --general-responses --workspace "$WS" --grant-id "$GRANT" --status
   ```
   Returns `active`, profile/mode, scoped conversation IDs, `budget` with request counts, reserved/reported input/output and conservative costs, and per-turn phase states. No counters reset per batch/restart.
6. Serve the existing outbox, or replace `--serve` with `--once` for one bounded pass:
   ```sh
   python -m workagent.responses_dispatcher --general-responses --workspace "$WS" \
     --grant-id "$GRANT" --authority-record "$ROUTE" --state-dir "$PRIVATE_STATE" --serve
   ```
   `--serve` checks revocation/route freshness on each pass and **stops on the first incomplete/unknown/invalid/denied result**, rather than retrying generations. It only waits for new work when the preceding batch completed. Preserve the owner-only private state directory. Stop the process normally; a process restart never renews authority or budget. Existing provider-operation guards recheck authority before sends and commit. General recovery is the same `--once`/worker; the historical intake `--reconcile-run`/successor commands are intentionally not accepted for this profile.
7. Revoke with the existing owner operation, then read `--status` again:
   ```sh
   python -c 'import os; from workagent.db import Database; from workagent.provider_attempts import revoke_grant; print(revoke_grant(Database(os.environ["MIGRATION_DATABASE_URL"]),os.environ["GRANT"]))'
   ```
   `GRANT` must be exported. Revocation retains reservations and receipts; no automatic replacement grant.

Prompt CLI admission is `python -m workagent.prompt_cli --general-responses --workspace "$WS" continue "$CID" "$TEXT" [--attach invoices.csv] [--target-artifact "$AID" --target-revision "$RID" --target-body-hash "$HASH"]`. It uses the same domain admission, never selects an operation or calls a provider directly. Persist the returned IDs and use `inspect "$CID"`/`cancel "$CID"` in the same explicit mode. Human editable targets come from current artifact readback.

## Verification and remaining boundary

Deterministic verification uses real isolated PostgreSQL, restricted runtime credentials, real loopback Uvicorn HTTP, subprocess prompt CLI, actual CSV arithmetic and Wasmtime; only provider Responses/count/retrieve HTTP is synthetic (`httpx.MockTransport`). Test-selected WAT/decisions are fixture wiring evidence, not model ability. Both four-turn paths keep corrections/notes, expose unaccepted proposals, paginate Home joins, mark stale decisions, restart without duplicate effects, and retain exact i64 output. Synthetic provider receipts are never labelled live.

Generated Python/OpenAPI/TypeScript contract checks passed with `backend/export_contracts.py --check`, `contracts/check-drift.mjs`, and `tsc --noEmit`. Final focused run (general Responses, authority/HTTP/CLI, real predecessor upgrade, historical recovery): **69 passed**. Full-suite sweep: **440 passed, one historical operator-adapter signature regression**; corrected by retaining the old intake authority invocation, then the entire historical recovery module and new general suites passed in that69-test final run. JUnit aggregation across runs covers447 unique testcases, all with passing latest results; this is not a claim of a single post-fix full-suite run. Logs/XML are retained under `.local/general-responses-full.*` and `.local/general-final.*`.

Frontend/browser integration and real-model usefulness remain **NOT TESTED** by this backend owner. Claude owns all `web/` work. Parent-owned root direction documents are read from770f669 and not edited here; no default merge, deployment, live key access, provider network or spend occurred.
