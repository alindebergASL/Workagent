# General products contract (B2/B3)

Additive to `GENERAL_CONVERSATION_CONTRACT.md`. Canonical schemas are Python/OpenAPI/generated TypeScript; `contracts/examples.json` is illustrative, not execution evidence. Backend/runtime/contracts only; no web edits.

## Conversation admission and state

Creation remains two commands: `POST /v1/workspaces/{ws}/conversations`, then `POST /v1/workspaces/{ws}/conversations/{cid}/messages`. Each mutation requires request/schema/command metadata; preserve command ID and expected version for replay. Message response is HTTP 202 `MessageQueued`, not a completion claim. Poll the existing conversation GET.

`ConversationDetail` adds:

- `artifact_ids`: products owned directly by this conversation; no implicit assignment.
- `turns`: ordered projections `{run_id,state,reason,evidence_origin:"controlled_transport",provider_observation:"not_observed"}` derived from canonical runs (no second state ledger).
- `conversation.updated_at` and `conversation.last_message_preview`: derived from the last immutable message. List items expose these too. List cursor order remains ID order; clients may sort fetched items by the supplied timestamp.

| Canonical run | Turn projection | Meaning |
|---|---|---|
| queued, at most 10 seconds since last observation | queued | Awaiting controlled consumer; no response observed. |
| queued, over 10 seconds without claim | unavailable | No consumer claim observed; check/start local worker. This is an observation of absence, not an assertion that a provider ran. |
| running with valid lease | responding | Controlled consumer holds a bounded lease. |
| running with expired lease | unavailable | Consumer lease expired; restart/retry pure local computation. |
| ready | replied | Persisted assistant result exists. A proposed change is not yet accepted. |
| partial | failed, or unavailable for missing/wrong engine | Exact `unresolved` reason; no fake assistant completion. |
| cancelled | cancelled | Cancelled/superseded; preserved historical messages. |

The **current turn is the last `turns` entry**; earlier entries describe historical turns and must not keep the current composer spinning. `outcome_unknown` is reserved in the schema; this pure local profile does not use external-effect uncertainty. Reasons are safe text, not raw exception stacks or credentials. All states retain controlled provenance. Delegation still creates a paused unsupported responsibility, not pretend autonomous handling.

## Typed operator attachment

`PostMessage` adds optional `operation`; null preserves source-free B1. The same `GeneralWorker` executes CLI and HTTP-admitted turns. Explicit selection is intentional: this is controlled wiring/capability engineering, not general model reasoning.

```json
{
  "schema_version":"workagent/v1", "request_id":"request-1", "command_id":"command-1",
  "expected_work_version":1, "text":"Reconcile these rows; preserve their original values",
  "operation":{
    "kind":"reconcile_csv",
    "input_csv":"id,quantity,unit_price,reported_total,note\nA,2,19.95,39.90,Keep my wording\nB,3,12.50,38.50,Await credit\n",
    "rounding":"ROUND_HALF_UP"
  }
}
```

```json
{
  "schema_version":"workagent/v1", "request_id":"request-2", "command_id":"command-2",
  "expected_work_version":1, "text":"Run this integer-cents invoice tool",
  "operation":{
    "kind":"run_wasm",
    "code":"(module (func (export \"total\") (param i64 i64) (result i64) local.get 0 local.get 1 i64.mul))",
    "entrypoint":"total", "arguments":[3,1250],
    "input_form":[{"name":"quantity","label":"Quantity"},{"name":"unit_price_cents","label":"Unit price cents"}]
  }
}
```

To revise/re-run, set both `artifact_id` and exact `base_revision_id`. `reconcile_csv` then forbids `input_csv`: it recalculates **saved editable rows**, removing only its three reserved derived columns. Original CSV bytes remain retained separately in `source_csv` and initial immutable message/revision. Human row notes, other original columns and top-level `notes` survive. Both HALF_UP and HALF_EVEN are supported; no generalized spreadsheet formulas inferred.

For `run_wasm`, omit `code` to re-run saved code or provide replacement WAT for a changed requirement. Always explicitly submit entrypoint, arguments and corresponding uniquely named form fields. Fields have fixed `type:"integer"`, minimum -1000000000 and maximum 1000000000. Form/arguments lengths must match, at most eight. Changed shipping fixture uses `[3,1250,500]`; it is actual replacement code, not a prose assertion.

Initial operations publish two product references: editable table/tool plus immutable-versioned snapshot CSV/WAT file. Revisions publish one pending proposal reference; no automatic acceptance and no overwrite. Download the accepted table/tool itself to export its current saved version. An old sibling file remains a historical snapshot of its own exact bytes, not an automatically updated view of the edited table/tool.

## Results and bodies

`TurnResult.results` contains a text result plus `ProductResult` references:

```json
{"kind":"tool","artifact_id":"artifact-id","revision_id":"revision-id","proposal_id":null,"observation_id":"observation-id"}
```

A proposal has `revision_id:null`, non-null `proposal_id`. Artifact ownership is `assignment_id:null, conversation_id:<cid>` for direct conversation work. Existing artifact/history/proposals/human-save/accept-proposal routes and CAS are reused. Conversation work-version advances on messages/delegation/cancellation; artifact revisions have their own existing CAS.

`Revision.body`, `Proposal.body` and `HumanSave.body` are a union:

- Legacy `Body`: **unchanged** `{title,blocks}`; no `kind` or new defaults added. Historical canonical body serialization/digests remain unchanged. Classify documents by `blocks`/absence of typed `kind`.
- `TableBody`: `kind:"table"`, `title`, `source_csv`, `rounding`, `columns`, `rows`, `notes`. Rectangular bounded data. Saved row values/notes are editable; derived cells become unverified drafts after human editing. Recalculation always replaces calculated_total/difference/check using the saved raw row fields.
- `ToolBody`: `kind:"tool"`, `title`, `code`, `entrypoint`, `arguments`, `input_form`, `notes`. Import-free WAT, not Python/shell. Code is a portable work product; form changes do not execute implicitly.
- `FileBody`: `kind:"file"`, `title`, `filename`, `mime_type`, `content`, `content_sha256`. SHA256 of exact UTF-8 bytes is validated. Content is at most 200000 bytes; filenames are safe basenames with `.csv`, `.wat`, `.txt` and matching fixed MIME. Spreadsheet formula injection is rejected. No URLs, external upload/fetch or arbitrary server paths.

Human-save never accepts execution/provenance fields. For conversation products it also rejects body-kind changes and changes to the table's retained `source_csv`; edit saved raw rows/notes instead. Use `POST .../artifacts/{aid}/human-save` with exact `expected_current_revision_id`, then a new conversation operation targeting that returned revision. Use existing `POST .../proposals/{pid}/accept` for exact proposed bytes. Concurrent changes fail CAS; the worker cannot accept proposals. Legacy `request-revision` is assignment-profile-specific; conversation products return unsupported there and use typed message steering instead.

## Trusted observations and downloads

`GET /v1/workspaces/{ws}/observations/{id}` returns:

- `observation`: immutable ID, workspace/conversation/run/artifact IDs, exact published revision or proposal/base IDs, canonical `body_hash`, typed `operation_hash`, access-generation and `evidence_origin:"controlled_transport"`.
- CSV output: exact input SHA256, fixed formula, rounding, discrepancy IDs, reported/calculated sums and source-preservation result. Initial input hash is attachment bytes; recalculation hash is the canonical CSV projection of saved raw rows. The exact base revision binds those rows.
- Wasm output: exact code SHA256 and input SHA256 (canonical JSON of entrypoint/arguments), actual integer return, arguments/entrypoint, `engine:"wasmtime-49.0.0"`, observed execution flag and fuel/memory/import limits/readback.
- `binding_state`: `current_revision`, `pending_proposal`, or `historical`.
- `current_scope`: current generation and selected-source manifest/version match. Revoked access denies the read entirely.

Revision `source_dependencies` denotes inherited selected-context visibility scope, not a claim that those source texts were used in the arithmetic/tool. Actual derivation is solely the exact attached CSV/WAT or bound saved base/arguments; the selected-source manifest is rechecked for authorization.

Only show a **current verified result** when the binding is `current_revision` and `current_scope:true`. Pending proposal output is execution evidence for those proposed bytes, not for the current saved code. Human-saving even identical bytes creates a new revision and makes the old execution binding historical. Accepted proposal binding becomes current only for the exact accepted body/revision. Never infer verification from editable rows, notes, messages, matching title or a stale observation ID.

`GET /v1/workspaces/{ws}/artifacts/{aid}/download?revision_id=<optional>` returns exact saved file bytes; table/tool bodies can also be exported. It reuses artifact/source authorization, with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and `X-Content-SHA256`. No execution occurs on download. Human-edited table values are unverified until recalculated, even if exported successfully.

## Broker/runtime and ordinary local start

New profile file `runtime/general-products-v1.json` (`general-products-controlled-v1`) is distinct from untouched accepted `runtime/general-b1-v1.json`. `contracts/general-tool-registry.json` explicitly exposes only `reconcile_csv` and `run_wasm`. Controlled transport selects a registered tool name; the broker resolves all arguments from the immutable human-authorized message/exact saved base, not arbitrary transport arguments. It checks authorization, selected-source hashes, generation, cancellation, fence, lease, profile and budget **before execution and again before atomic publication**.

Same runs/dispatch outbox/commands/artifacts/revisions/proposals; only trusted append-only `product_observations` is new evidence storage. Pure kernel execution can repeat after a precommit crash; there are no external effects and no exactly-once execution claim. Publication is atomic and delivery replay reads the persisted result without executing again. Legacy B1 in-flight hashes have an exact compatibility path, tested from original 9a code in another process. Old registry bytes are archived/hash-bound for old fixture runs.

`python3 scripts/workagent.py serve` starts the existing dispatcher with explicit `--general-controlled`; it routes general runs to the same `GeneralWorker` and never lets the legacy fixture handler claim them. Standalone bounded sweep:

```sh
PYTHONPATH=backend /path/to/python -m workagent.general_worker --controlled --workspace <ws>
# Continuous local consumer used by normal serve:
PYTHONPATH=backend /path/to/python -m workagent.dispatcher --general-controlled
```

Install the **optional pinned** tool engine into the environment used by the server/worker:

```sh
uv pip install --python /path/to/python --require-hashes -r backend/requirements-local-tools.txt
```

Wasmtime 49.0.0 only; import-free i64 parameters/result, no WASI/host imports, 16000-byte WAT, 50000 fuel, 1 MiB guest memory, bounded tables/instances. No missing-engine fallback. Missing engine yields a terminal unavailable turn. No SDK, Hermes harness, inference, provider credentials, network capability or live fallback added. Broader code execution and usefulness remain unverified.

CLI uses the same admission/worker:

```sh
PYTHONPATH=backend /path/to/python -m workagent.prompt_cli --controlled --workspace <ws> \
  prompt 'Reconcile invoices' --operator reconcile_csv --attach fixtures/general-work/invoices.csv
PYTHONPATH=backend /path/to/python -m workagent.prompt_cli --controlled --workspace <ws> \
  prompt 'Run invoice total' --operator run_wasm --attach fixtures/general-work/invoice-total.wat \
  --arg 3 --arg 1250 --field quantity:Quantity --field 'price:Unit price cents'
```

`continue`, `inspect`, `cancel`, and explicit `delegate` remain. `--attach` is an explicit bounded local file read by the operator CLI; the server receives inline bytes only. Reproducible multi-process changed-requirement demonstration: `scripts/general_products_demo.py`; see verification document for actual run IDs and limits.
