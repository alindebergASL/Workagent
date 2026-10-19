# Home conversation-work summary — backend handoff

Implemented for Claude's Home feed; no web changes in this branch.

## Request and generated types

`GET /v1/workspaces/{workspace_id}/conversation-work?limit=100&cursor={artifact_id}`

Operation ID: **`list_conversation_work`**. Same bearer, `X-Schema-Version:
workagent/v1`, and `X-Request-Id` headers as existing reads. Responses are
`Cache-Control: no-store`; absent/inaccessible workspaces return the existing 404
envelope, not an empty success. Limit is 1–100 (default 100).

Canonical Pydantic models: `backend/workagent/home_work_summary.py`.
Generated OpenAPI: `contracts/openapi.json`; generated TypeScript schemas:
`contracts/src/schema.d.ts`, exported through the existing contract client.

- `components["schemas"]["HomeConversationWorkPage"]`
- `components["schemas"]["HomeConversationWork"]`
- `components["schemas"]["HomePendingProposal"]`

Page: `{ items: HomeConversationWork[], next_cursor: string | null, has_more: boolean }`.

Each item is one **conversation-owned artifact's current saved revision**, with:

| Fields | Meaning |
|---|---|
| `workspace_id`, `conversation_id`, `artifact_id` | Canonical relational ownership and existing detail/action destinations. Assignment-owned artifacts are not included. |
| `conversation_title`, `conversation_state`, `conversation_work_version` | Saved conversation fields; state is `open` or `cancelled`, not execution or goal completion. |
| `conversation_updated_at` | Latest immutable conversation-message timestamp, or conversation creation if there are no messages. No message text is returned. |
| `title`, `kind` | Current saved body's title and kind (`table`, `tool`, `file`, `document`, `structured_table`, `custom_view`). Legacy block documents map to `document`, matching `flexibleKind`. |
| `revision_id`, `revision_number` | Current saved revision, never a proposed revision. |
| `author_id`, `author_kind` | Current saved revision's canonical author (`human` or `worker`). |
| `updated_at` | Current revision's creation time. A proposal does not change this saved-work timestamp. |
| `decision` | Null, or newest **readable pending** proposal by `(created_at DESC, id DESC)`. Accepted/dismissed proposals are excluded. |

`decision` contains `proposal_id`, `base_revision_id`, `base_work_version`,
`status: "pending"`, `created_at`, and `fresh`. `fresh` means only
`base_revision_id === revision_id`, matching existing Home logic. It is **not**
a claim that applying the proposal will succeed: access, versions and action
preconditions are rechecked by the existing mutation endpoints.

## Replacing the Home fan-out

In `web/src/lib/client/conversation-work.ts`, replace conversation listing plus
per-conversation details plus artifact/proposal reads with this one paginated
workspace read. Most workspaces need one request. Map each returned item to the
existing `ConversationWork` shape; all existing fields are already named the
same except `saved_by`, which is derived as before:

```ts
saved_by: item.author_kind === "human" ? "you" : "agent"
```

Keep the current per-workspace unreadable/stale handling and cross-workspace
attention sort. Continue to open real artifact detail to review/apply/dismiss;
this response has no bodies or replacement mutation surface. Human edits stay
current until an actual acceptance succeeds.

## Pagination and empty state

Rows are in stable **artifact ID ascending** order, NOT attention order. Fetch
`next_cursor` while `has_more`; then apply the existing attention sort. Never
call a truncated page the entire workspace or use its length as a workspace
total. If the frontend deliberately stops early, show a partial/more-work state.
`has_more` comes from one extra **authorized matching** row; at exhaustion it is
false and `next_cursor` is null. No total count is claimed.

Pagination is keyset-based, not a snapshot across requests: concurrent new
artifacts sorting behind a cursor appear on the next refresh. Proposal/revision
changes do not move an artifact's page position. Empty conversations do not
produce fake work rows. An empty readable workspace (including conversations
without artifacts) returns `items: [], has_more: false, next_cursor: null`.

## Access, privacy and scope

Same active workspace membership and source access boundaries as canonical
conversation/artifact reads, including viewers. Conversation creator ownership
is **not** a new filter: existing members can read a source-free conversation
created by another member. All joins remain workspace-scoped. The conversation
owner of the artifact is taken from the relational artifact record, not guessed
from artifact IDs embedded in messages or proposed bodies.

Missing/revoked/unavailable selected sources hide the conversation's artifacts.
Current-revision dependencies must belong to the owning conversation's selected
sources; proposal dependencies are checked likewise before picking the newest
readable pending proposal. Inaccessible proposal metadata is never returned.
No source contents, revision/proposal bodies, attachments, message previews,
provider payloads, proposal reasons, or unrelated private records are selected.
No outcome, running-state, assignment/responsibility or acceptance inference is
made. Existing Home overview/responsibility/execution APIs remain independent.

The service performs **three SQL statements** regardless of page size: existing
two workspace/membership checks, then a single bounded relational projection.
The database wrapper additionally sets its standard statement timeout. No
per-item Python detail expansion, model/provider calls, migrations or writes.

## Verification

Dedicated disposable PostgreSQL: `workagent_test_home_summary_phase2`, with
new owner/runtime roles; runtime is neither owner, superuser nor BYPASSRLS.
Never used the integration/live/document-schema-tests databases.

`tests/test_home_work_summary.py` exercises real HTTP authentication/validation,
empty state, worker/human revision authorship, retained human edits,
fresh/stale/dismissed/accepted proposals, cancelled conversation state,
workspace/membership/source/dependency isolation, canonical ownership,
deterministic pagination/timestamp tie-breaking, body exclusion, and constant
query count for 0, 1 and 101 artifacts. Dedicated suite: **6 passed**. Four
selected existing conversation/flexible-artifact lifecycle, HTTP and revocation
regressions also passed. `export_contracts.py --check`, OpenAPI TypeScript drift
check and `git diff --check` passed.

Verification limitations: the initial broader regression invocation timed out
before completion; it is not claimed as a pass. The baseline's unrelated
`alpha-decision.d.ts` already differs from its decision-schema generator (old
`DraftBlock` versus split text/checklist blocks); that file was left untouched
for parent integration. TypeScript compilation was blocked by the tool lifecycle
scanner's script-size cap, so no typecheck pass is claimed.

No contract questions block adoption. Parent integration and Claude's frontend
consumption remain separate; this branch is not a deployment or independent
review approval.
