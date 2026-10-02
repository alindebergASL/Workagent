# Workagent web (S1 frontend)

Lives in `web/` with its own manifest and lockfile; the repository root is Hermes-owned.

Work Home, Assignment and Artifact for the private workspace. Next.js 16, React 19,
TypeScript, no UI framework; plain CSS with design tokens in `src/styles/globals.css`.

## Run

```bash
cd web
pnpm install
pnpm dev              # http://127.0.0.1:3000 against the built-in mock service
```

Production-style run (what the tests and demo use):

```bash
cd web && pnpm build && pnpm start
```

## Modes

| Variable                          | Default               | Meaning                                                                                                                 |
| --------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_WORKAGENT_API_BASE`  | `/api/mock`           | Base URL of the API. Point it at Hermes's service to leave mock mode; the UI then labels nothing as demonstration data. |
| `NEXT_PUBLIC_WORKAGENT_PRINCIPAL` | `alex`                | Provisional test identity sent as `x-workagent-principal` until the real session boundary exists.                       |
| `WORKAGENT_MOCK_STATE_DIR`        | `web/.workagent-mock` | Where the mock keeps its JSON state file (gitignored).                                                                  |
| `WORKAGENT_MOCK_STAGE_MS`         | `2500`                | Mock run stage duration (queued → working stages → ready).                                                              |
| `WORKAGENT_MOCK_PROPOSAL_MS`      | `20000`               | Delay before a requested agent revision completes in the mock.                                                          |
| `WORKAGENT_MOCK_CONTROL`          | `1`                   | Set `0` to refuse the `/_control/*` test hooks.                                                                         |

The mock (`src/lib/mock`) is a frontend stand-in with server-side state inside the
Next process. It implements the semantics the UI depends on (scoped lookups,
indistinguishable `not_found_or_not_authorized`, scoped command IDs and
`command_conflict`, compare-and-swap saves with `version_conflict`, proposals
that keep both bodies) but it is not durable persistence and proves nothing
about Hermes's backend, PostgreSQL or the runtime.

## Contract

`src/lib/contract/types.ts` is a PROVISIONAL mirror of Step 4 `CONTRACTS.md`.
`src/lib/client/api.ts` is the only module that talks HTTP; swap it for the
generated client when Hermes publishes it. Routes the UI uses today:

| Method   | Path                                                    | Purpose                                                              |
| -------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| GET      | `/workspaces`                                           | authorized workspaces                                                |
| GET      | `/workspaces/{ws}/sources`                              | selectable sources (current access only)                             |
| GET/POST | `/workspaces/{ws}/assignments`                          | list / `create_assignment` (202 with assignment, work revision, run) |
| GET      | `/workspaces/{ws}/assignments/{id}`                     | assignment with artifacts, activity, recommendation                  |
| GET      | `/workspaces/{ws}/assignments/{id}/sources`             | source details and which results use them                            |
| GET      | `/workspaces/{ws}/artifacts/{id}?revision_id=`          | current (or historical) body; accepted pointer never moves on a read |
| GET      | `/workspaces/{ws}/artifacts/{id}/history`               | revisions and proposals                                              |
| POST     | `/workspaces/{ws}/artifacts/{id}/revisions`             | human save with `expected_current_revision_id` (CAS)                 |
| POST     | `/workspaces/{ws}/artifacts/{id}/request-revision`      | agent proposal from `base_revision_id`                               |
| POST     | `/workspaces/{ws}/artifacts/{id}/proposals/{pid}/accept | decline`                                                             | explicit decision with `expected_current_revision_id` |

Error envelope: `{ error: { code, message, request_id, next_action?, details? } }`;
`version_conflict` details carry `current_revision_id`, `current_revision` and the retained `proposal`.

## Check

```bash
cd web
pnpm check                                    # tsc, eslint, prettier, vitest
pnpm build && PLAYWRIGHT_CHROMIUM_PATH=<chrome> pnpm test:e2e   # desktop 1440, mobile 390, narrow 320
pnpm demo:s1                                  # build, journey, confirmed process restart, reopen, report.json
```

Playwright 1.62 expects its own Chromium; set `PLAYWRIGHT_CHROMIUM_PATH` to a
preinstalled binary or run `pnpm exec playwright install chromium` once.
Evidence lands in `handoffs/frontend/evidence/` (screenshots per viewport,
`journey-ids.json`, `report.json`).

## Layout

- `src/app` routes: `/`, `/assignments/[id]`, `/assignments/[id]/artifacts/[artifactId]`, `/api/mock/[...path]`
- `src/components` shell, document body (read/edit/diff), drawers, status primitives
- `src/lib/client` HTTP adapter, polling hook with reconnect, workspace context
- `src/lib/mock` stand-in service, fixture loader, deterministic worker
- reads `../fixtures/actor/solo-v0.1/initial_records.json` (Hermes-owned canonical actor input; permitted initial records only)
