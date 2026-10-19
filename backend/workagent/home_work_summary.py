"""Body-free, bounded Home projection over canonical conversation-owned work.

Authorization mirrors _conversation + _revision/_proposal dependencies. This is
not a completion/acceptance projection and never invokes per-item detail readers.
"""
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field

from .errors import DomainError
from .model_base import Id, Model


class HomePendingProposal(Model):
    proposal_id: Id
    base_revision_id: Id
    base_work_version: Annotated[int, Field(ge=1)]
    status: Literal['pending'] = 'pending'
    fresh: bool
    created_at: AwareDatetime


class HomeConversationWork(Model):
    workspace_id: Id
    conversation_id: Id
    conversation_title: Annotated[str, Field(min_length=1, max_length=240)]
    conversation_state: Literal['open', 'cancelled']
    conversation_work_version: Annotated[int, Field(ge=1)]
    conversation_updated_at: AwareDatetime
    artifact_id: Id
    title: Annotated[str, Field(min_length=1, max_length=240)]
    kind: Literal['table', 'tool', 'file', 'document', 'structured_table', 'custom_view']
    revision_id: Id
    revision_number: Annotated[int, Field(ge=1)]
    author_id: Id
    author_kind: Literal['human', 'worker']
    updated_at: AwareDatetime
    decision: HomePendingProposal | None = None


class HomeConversationWorkPage(Model):
    items: list[HomeConversationWork] = Field(max_length=100)
    next_cursor: Id | None = None
    has_more: bool


# Use canonical JSON selected_source_refs, not only the denormalized index.
# Missing sources/grants fail closed. Old source versions remain readable just
# as in _source(check_version=False). No source content is selected.
_QUERY = """
SELECT a.workspace_id, a.conversation_id, a.id AS artifact_id,
       cv.data->>'title' AS conversation_title,
       cv.data->>'state' AS conversation_state,
       (cv.data->>'work_version')::bigint AS conversation_work_version,
       COALESCE((SELECT (m.data->>'created_at')::timestamptz
                 FROM conversation_messages m
                 WHERE m.workspace_id=cv.workspace_id AND m.conversation_id=cv.id
                 ORDER BY m.sequence DESC LIMIT 1),
                (cv.data->>'created_at')::timestamptz) AS conversation_updated_at,
       r.data->'body'->>'title' AS title,
       CASE WHEN r.data->'body' ? 'kind' THEN r.data->'body'->>'kind'
            WHEN r.data->'body' ? 'blocks' THEN 'document' END AS kind,
       a.current_revision_id AS revision_id, r.revision_number,
       r.data->>'author_id' AS author_id, r.data->>'author_kind' AS author_kind,
       (r.data->>'created_at')::timestamptz AS updated_at,
       pending.proposal_id, pending.base_revision_id,
       pending.base_work_version, pending.created_at AS proposal_created_at
FROM artifacts a
JOIN conversations cv ON cv.workspace_id=a.workspace_id AND cv.id=a.conversation_id
JOIN revisions r ON r.workspace_id=a.workspace_id AND r.artifact_id=a.id
                 AND r.id=a.current_revision_id
LEFT JOIN LATERAL (
    SELECT pr.id AS proposal_id, pr.base_revision_id,
           (pr.data->>'base_work_version')::bigint AS base_work_version,
           (pr.data->>'created_at')::timestamptz AS created_at
    FROM proposals pr
    WHERE pr.workspace_id=a.workspace_id AND pr.artifact_id=a.id
      AND pr.data->>'status'='pending'
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(pr.data->'source_dependencies') dep
          WHERE NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(cv.data->'selected_source_refs') ref
              WHERE ref->>'source_id'=dep->>'source_id'))
    ORDER BY (pr.data->>'created_at')::timestamptz DESC, pr.id DESC
    LIMIT 1
) pending ON true
WHERE a.workspace_id=%s AND a.id>%s AND a.assignment_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(cv.data->'selected_source_refs') ref
      LEFT JOIN sources src ON src.workspace_id=cv.workspace_id AND src.id=ref->>'source_id'
      LEFT JOIN source_access g ON g.workspace_id=cv.workspace_id
          AND g.source_id=ref->>'source_id' AND g.principal_id=%s
      WHERE src.id IS NULL OR g.active IS DISTINCT FROM true
          OR (src.data->>'available')::boolean IS DISTINCT FROM true)
  AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.data->'source_dependencies') dep
      WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(cv.data->'selected_source_refs') ref
          WHERE ref->>'source_id'=dep->>'source_id'))
  AND (r.data->'body'->>'kind' IN ('table','tool','file','structured_table','custom_view')
       OR (NOT (r.data->'body' ? 'kind') AND r.data->'body' ? 'blocks'))
ORDER BY a.id
LIMIT %s
"""


def read(service, principal, workspace_id, cursor=None, limit=100):
    """Three SQL statements: two scope checks and one bounded projection.

    Stable artifact-ID keyset pagination, not attention order. The caller may
    sort all collected pages for attention. Each call is a fresh read, not a
    cross-request snapshot; has_more is based on an authorized lookahead row.
    """
    if not 1 <= limit <= 100:
        raise DomainError('validation_error', fields=['limit'])
    with service.db.transaction() as c:
        service._scope(c, principal, workspace_id)
        rows = c.execute(_QUERY, (workspace_id, cursor or '', principal.id, limit + 1)).fetchall()
    items = []
    for row in rows[:limit]:
        proposal_id = row.pop('proposal_id')
        base_revision_id = row.pop('base_revision_id')
        base_work_version = row.pop('base_work_version')
        created_at = row.pop('proposal_created_at')
        decision = HomePendingProposal(
            proposal_id=proposal_id, base_revision_id=base_revision_id,
            base_work_version=base_work_version, created_at=created_at,
            fresh=base_revision_id == row['revision_id'],
        ) if proposal_id else None
        items.append(HomeConversationWork(**row, decision=decision))
    has_more = len(rows) > limit
    return HomeConversationWorkPage(items=items, has_more=has_more,
        next_cursor=items[-1].artifact_id if has_more else None)
