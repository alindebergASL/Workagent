# Shared frontend contract

Source of truth: `../backend/workagent/models.py` and the real FastAPI adapter.
Generated files: `openapi.json` (OpenAPI 3.1), `src/schema.d.ts`,
`tool-registry.json`, `examples.json`. Do not hand-edit them.

```sh
npm ci --ignore-scripts
npm run generate
npm run check
```

Generation expects the pinned Python environment at `../backend/.venv` (see the
backend README). `check` compares canonical exports, regenerated TypeScript and
runs `tsc --noEmit`; it does not silently rewrite drift. Both generator and client
versions are exact pins, with a separate npm lockfile.

`src/client.ts` exports `workagentClient(baseUrl, bearer, requestId)`. Import its
source from the frontend build; there is no published package or root workspace
change in this baseline. The typed client uses `openapi-fetch`, no cookies and no
automatic mutation retries. A local bearer is a private human credential, never a
public demo key or worker/model token.

Example read (header metadata is set by the helper):

```ts
const api = workagentClient("http://127.0.0.1:8000", privateLocalBearer,
  () => crypto.randomUUID());
const result = await api.GET("/v1/workspaces/{workspace_id}/assignments/{assignment_id}", {
  params: { path: { workspace_id: workspaceId, assignment_id: assignmentId },
    header: { "x-request-id": crypto.randomUUID(), "x-schema-version": "workagent/v1" } }
});
```

OpenAPI marks required headers explicitly, so generated call-site types require
those header parameters even though the helper also sets defaults. Mutations carry
`schema_version`, `request_id` and stable `command_id` in their body. Keep command
IDs stable for transport replay; change them for new intent. Treat a 202 response
as queued work with a pollable run, not a finished artifact.

The stateful frontend mock is the **isolated PostgreSQL-backed fixture-mode API**
documented in `../backend/README.md`, not an invented response server. It preserves
state/CAS/replay/conflicts across process restart. Run its explicit fixture worker
to advance a queued run. `examples.json` is labeled illustrative data and cannot
be cited as execution evidence.

Human save/accept routes are HTTP app operations, deliberately absent from the
reviewed model-facing `tool-registry.json`. That registry is schema/annotation
output; the parent broker must bind operations to an authorized assignment/run
capability. It is not a generic authority grant or an MCP server.
