# Flexible work + sandboxed custom view backend contract (Workagent #13)

Status: backend slice implemented and tested against a newly provisioned restricted PostgreSQL database. Existing sandbox host is preserved, **not modified or wired by this change**. No live provider calls, paid proof, browser proof, production migration, deployment, or #13 closure is claimed. Renderer/wiring remains with the existing frontend owner.

## Canonical contracts and storage

- `contracts/openapi.json` and generated `contracts/src/schema.d.ts` define the API. Python export also produces `general-decision.schema.json`, `adaptive-decision.schema.json`, and `general-tool-registry.json`.
- Durable state remains in existing artifacts, immutable revisions, pending proposals, revision history, messages, observations, and response receipts. No custom-view database or DOM-state store is introduced.
- Historical `TableBody` (`kind: "table"`) **still means invoice reconciliation**. It and `reconcile_csv`, Wasm execution, historical document shapes and receipts retain their meaning.
- New `StructuredTableBody`: `kind: "structured_table"`, `version: "structured-table/v1"`.
- New `CustomViewBody`: `kind: "custom_view"`, `version: "custom-view/v1"`.
- Existing documents/checklists: `{title, blocks}` with **no `kind`**. General model selection now admits them through `publish_artifact`. They are reported as `ProductResult.kind: "document"`.
- New operation and model decision: `publish_artifact`. Model-selection `target` is null for creation or must equal the human's exact current-message target. Direct controlled operation uses existing `artifact_id` + `base_revision_id`. No task-name routing or new goal-recognition grammar.
- Pinned historical runtime manifest files are untouched. Effective product/general profiles explicitly add `publish_artifact`; their implementation/consumer pins and generated profile reflect that extension. Existing grants are **not edited** and cannot silently use a changed pinned consumer. Historical receipts remain readable.

## General table: shape and editing rules

```json
{
  "kind": "structured_table",
  "version": "structured-table/v1",
  "title": "Plant trials",
  "fields": [
    {"key":"plant","label":"Plant","type":"text","editable":true,"unit":null,"scale":null,"enum":null},
    {"key":"height","label":"Height","type":"decimal","editable":true,"unit":"cm","scale":1,"enum":null}
  ],
  "rows": [
    {"row_id":"oak","cells":[{"field_key":"plant","value":"Oak"},{"field_key":"height","value":"12.5"}]}
  ],
  "notes": []
}
```

`fields[].key` and `rows[].row_id` are unique stable identities, not display positions. Each row has exactly one cell per declared field; use JSON null for missing data. Cells are an array of `{field_key,value}`, not an open dictionary, so the model-selection schema stays closed without a JSON-schema interpreter.

Types: `text` (<=2,000 characters), `integer` (strict JSON integer, safe JS integer range), `decimal` (bounded signed decimal **string**, no exponent, <=15 integral digits, explicit scale 0..6), `boolean` (strict JSON boolean), `enum` (one of the explicitly declared unique choices). Units are numeric-only. Decimal requires scale; other types prohibit scale. Enum requires 1..30 unique choices; other types prohibit enum.

Surviving field keys cannot change type/unit/scale/enum/editability. Rename labels freely; use a new key for different semantics. Read-only fields cannot be removed; existing read-only cells and their row identities cannot be changed/deleted. Editable cells/rows can be edited or removed, and rows/fields can be added subject to shape validation. Ordinary human saves create CAS revisions; generated replacements always create proposals. No formula execution, inferred verification, or invoice-only column constraints.

## Custom view shape

This example uses illustrative IDs/hash. Replace `artifact_id`, `revision_id`, `body_hash` and `access_generation` with **actual current saved values**, not these placeholders. `bindings` may target only a saved document or structured table in the **same conversation and workspace**. They may not target another view, invoice executor, arbitrary URL, external source, or caller-selected entity.

```json
{
  "kind": "custom_view",
  "version": "custom-view/v1",
  "title": "Plant height chart",
  "source": {
    "html": "<h1>Plant heights</h1><button id=\"refresh\">Read saved measurements</button><pre id=\"values\"></pre>",
    "css": "h1 { color: green; }",
    "js": "// Use the existing host action bridge for the named refresh handler; no credentials or fetch."
  },
  "fallback": "Oak measured 12.5 cm. This is draft research data, not independently verified.",
  "access_generation": 1,
  "bindings": [{"name":"trials","artifact_id":"actual-artifact-id","revision_id":"actual-revision-id","body_hash":"0000000000000000000000000000000000000000000000000000000000000000"}],
  "actions": [{
    "name":"refresh",
    "kind":"read_binding",
    "binding":"trials",
    "payload_schema":{"type":"object","properties":{},"additionalProperties":false}
  }]
}
```

Source is stored **as inert untrusted text** and never executed, evaluated, installed, or fetched by the backend. The backend is not an HTML sanitizer. Pass `source` only to the existing `SandboxedView` opaque-origin iframe with its no-network CSP/MessageChannel. Never inject it into the trusted document. Render `fallback` as plain readable text outside the sandbox (also when scripts are disabled, bindings stale or errors occur). DOM edits are ephemeral, never durable state.

General model context includes current `access_generation` and at most 20 `bindable_artifacts` (exact IDs/hash/title for same-conversation saved documents/tables). Model DTOs require all fields, including nullable metadata and normally-defaulted arrays; API DTOs can supply documented defaults. The separate explicit provider DTOs inherit validation/bounds and do not rewrite FrozenSchema or weaken closed-schema enforcement.

## Narrow action broker

**POST** `/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/view-actions`

`artifact_id` in the route is the custom-view artifact, not a data target. Existing Principal authentication is required. No new auth/token mechanism is added. Trusted shell constructs the complete request from the currently displayed durable view revision; the iframe supplies only its declared action name and `{}` payload through the existing sandbox bridge.

```json
{
  "schema_version":"workagent/v1",
  "request_id":"refresh-1",
  "view_revision_id":"actual-view-revision-id",
  "view_body_hash":"0000000000000000000000000000000000000000000000000000000000000000",
  "access_generation":1,
  "action":"refresh",
  "payload":{}
}
```

Successful `ViewActionResponse`:

```json
{
  "view_revision_id":"actual-view-revision-id",
  "access_generation":1,
  "binding":"trials",
  "artifact_id":"actual-artifact-id",
  "revision_id":"actual-revision-id",
  "body_hash":"0000000000000000000000000000000000000000000000000000000000000000",
  "body":{
    "title":"Example saved document",
    "blocks":[{"block_id":"summary","kind":"paragraph","text":"Saved body, not live network data.","checked":null}]
  }
}
```

This is a **real exact-bound read/refresh**, not a pretend UI event. It returns the existing saved body and its exact identity/hash. It does not silently follow a replacement revision: if a binding's current revision changes, rebind through a trusted human save or model proposal, then review/accept that new view. All declared bindings are checked on every action, not just the selected one. There is no unrestricted `get`, arbitrary target parameter, write/save/approve/provider/network action, generic JSON schema, or custom code execution endpoint.

Action names: `^[a-z][a-z0-9_.-]{0,63}$`. Only `kind: "read_binding"` is admitted. Its payload schema is exactly `{type:"object",properties:{},additionalProperties:false}`. Extra payload fields (including IDs), missing/nonobject payloads, or extra request keys are rejected. The backend derives the target exclusively from stored bindings/actions, rechecks active membership/source access, current access generation, open conversation, current view revision/hash and **every bound current artifact revision/hash** in one transaction. Workspace/membership shared locks serialize this read against sanctioned writes/revocations; normal changes use existing workspace write locks and revision CAS.

Errors: unauthenticated 401; absent/foreign/revoked/stale-view/stale-binding/generation mismatch 404 `not_found_or_not_authorized` with no replacement IDs; undeclared actions/unsupported kinds and malformed requests 422. Existing source-version failures can return their normal 409 source error. Do not display a failed read as an updated chart. Public exposure/rate enforcement beyond the existing authenticated local app is not claimed.

## Host wiring (frontend owner)

1. Detect documents via `blocks`; detect new table/view via `kind`. Do not reinterpret old `kind: "table"` or remove its invoice UI.
2. Render structured table headers/units/types from `fields`, and locate each cell by `field_key`; preserve row/field IDs when saving.
3. For a custom view, show fallback and unverified/draft provenance in the trusted shell. Pass its inert `source` to the already-delivered sandbox host.
4. Build **only** handlers from durable `body.actions`. For a `read_binding` handler send the request above, using the shell's exact view revision/hash/generation. Return only the bounded plain JSON response to the iframe. Do not provide a workspace client/bearer or allow iframe fields to replace route/revision/target values. Keep the host's existing trusted-shell approval behavior; no approval permission is conveyed by the backend declaration.
5. Use `{}` for initial host data, or exact broker-authorized reads keyed by binding name. Do not inject newer/cross-scope data through bootstrap props to bypass stale binding rejection. Source, bindings and action changes remount/reinitialize the sandbox; never reuse a revoked channel as authority.
6. Trusted shell editing uses existing human-save/proposal controls. Do not wire DOM updates to automatic durable saves or approvals.

## Exact limits (smaller than the existing host ceilings)

| Material | Backend limit |
|---|---:|
| Aggregate source `html` + `css` + `js` | 48,000 UTF-8 bytes |
| Source fields | `html` nonempty, each <=48,000 characters; css/js may be empty |
| Custom view serialized JSON body / published document draft body | 96,000 UTF-8 bytes |
| Readable fallback | non-whitespace, <=12,000 characters |
| Structured table serialized JSON body | 48,000 UTF-8 bytes |
| Table fields / rows | 24 / 200 |
| Custom view bindings / actions | 4 / 8 |
| All bound document/table bodies as keyed JSON | 48,000 UTF-8 bytes total |
| One broker JSON response | 60,000 UTF-8 bytes |
| Existing HTTP POST body ceiling | unchanged 256,000 bytes |

JSON-size checks use compact JSON, UTF-8, unescaped Unicode. These bounds fit the existing host source 512KB/data 1MB/message 64KB ceilings without raising unrelated requests. Existing host limits of 30 actions/minute and 4 inflight remain its responsibility; this backend read slice does not add a second rate-limit table. No generic framework is introduced.

## Create/save/revise/propose/reopen

- Controlled path: normal `PostMessage` on a controlled product conversation with `operation: {"kind":"publish_artifact","body":<one body>,"artifact_id":null,"base_revision_id":null}`. Existing controlled worker persists one draft artifact (no redundant download-file artifact).
- General model path: ordinary message (no operation); closed `publish_artifact` decision admitted by existing general or adaptive response consumer. Existing final receipt remains required. Synthetic transport tests exercise the actual admission/selection/staging/publication path, not live inference.
- Read/reopen: existing `GET /artifacts/{id}` and requested-revision query/history.
- Human edit: existing `POST /artifacts/{id}/save` with `expected_current_revision_id` and full `body`; one CAS winner, immutable history.
- Model revision: ordinary general message carrying `target:{artifact_id,revision_id,body_hash}`; selection target must match exactly. Controlled operation uses `artifact_id`/`base_revision_id`. Result is a pending proposal, never a silent save or acceptance. Existing `/proposals/{id}/accept` checks the exact current base again.
- View creation/saving/proposal/acceptance rechecks current scope/generation/bindings. Stale bindings require explicit refresh/review, not automatic substitution.

Every draft gets `DraftObservation` (`kind:"artifact_draft"`, `validation:"shape_only"`, `goal_status:"needs_validation"`, `generated_code_executed:false`). Runs remain `partial`; adaptive outcome is `needs_validation`, never `completed` from creation. Generated “verified” prose remains in the immutable provider receipt but is **not** published as trusted status; the retained limitation is displayed instead. Independent acceptance/CSV verification is unchanged and does not treat arbitrary draft content as evidence.

## Migration and validation evidence

New checksum-journal migration: `backend/migrations/016_flexible_work.sql`. Old migrations are untouched. It adds inert-view scope/binding checks and exact unverified-draft stage checks, and narrowly extends existing observation/message/reconciliation guards to publish the new draft/retained limitation. It does not weaken unrelated authority gates or grant runtime authority-table writes. No new tables or runtime grants are required.

Fresh current test database: `workagent_test_3e3f1379a3dc`; secret env file `.local/flexible-backend-v5.env` (never commit/copy contents). Earlier disposable attempts are retained, not adopted/reset. Do not migrate/reuse milestone databases.

- Red baseline: 2 failures (missing DTO/admission), including real fresh-DB operation admission.
- Pre-migration red tests exposed the missing SQL guard and adaptive draft rejection.
- Focused slice: **16 passed**, including authenticated HTTP broker, malformed/undeclared/foreign/stale/revoked checks, generation recheck after regrant, concurrent CAS, readonly fields, restart/history/proposals/acceptance, six general/adaptive document/table/view publication cases, and actual restricted-SQL rejection of forged executed evidence.
- Final focused + migration/receipt/isolation regression gate: **36 passed** (`.local/flexible-backend-final-regressions.log`). It includes the complete 16-test slice, new-migration repeat/upgrade preservation and a subprocess that forbids provider imports/key reads.
- Earlier targeted general/product/adaptive gate: **69 passed**; separate adaptive-authority/budget guard file: **9 passed** on disposable `workagent_test_f7a58a4c3649` before the final provider-independent policy-import relocation.
- A full-suite attempt reached **182 passed** before identifying old tests' latest-migration assertion (`015` rather than new `016`); those assertions were updated without changing historical checks. A subsequent run exposed a controlled-only provider-import regression; policy text was moved into provider-independent `flexible_policy.py`, and the guarded subprocess now passes. Interrupted/mixed-version runs are not claimed as full passes.
- Full exact-commit backend gate is still a parent/integration gate unless its final log reports completion. A fresh full run can be handed to the parent with its process handle; do not edit pinned backend bytes while it runs.
- Python export `--check`, generated TypeScript drift check and contracts `tsc --noEmit` pass. All four JSON examples above validate against their canonical strict DTOs. No web build or browser result is claimed here.

Reproduce without printing DSNs/tokens:

```sh
cd /home/ubuntu/workagent-flexible-work/backend
set -a; source ../.local/flexible-backend-v5.env; set +a
env -u PYTHONPATH /home/ubuntu/workagent-adaptive-integration/backend/.venv/bin/python -m pytest tests/test_flexible_work.py -q
env -u PYTHONPATH /home/ubuntu/workagent-adaptive-integration/backend/.venv/bin/python export_contracts.py --check
cd ../contracts
node check-drift.mjs
./node_modules/.bin/tsc --noEmit
```

Limitations: no frontend wiring in this backend change; no live inference or paid validation; no universal-browser sandbox claim (existing host evidence is Chromium only); only exact-bound read actions, no iframe-initiated writes; existing UI owner must implement rendering/handlers/error/fallback integration and parent must run final exact-head/browser gates. This is not #13 closure.
