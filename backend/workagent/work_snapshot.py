"""One repeatable-read current-state projection, using canonical execution semantics."""
from datetime import datetime, timezone

from .execution_status import classify, heartbeat
from .models import Proposal, Revision, Run, now
from .responsibility_models import ResponsibilityLifecycle
from .work_event_models import (CurrentExecution, HistoricalObservation, PendingReview,
    WorkArtifact, WorkResponsibility, WorkSnapshot)


def classify_current(run, steps, available, active_run=None, canonical_status=None, dispatch_failure=None):
    # Unknown external outcomes remain unknown even after cancellation. A ready
    # run means preparation ended, never that the user's objective is complete.
    if any(s.state in ('count_unknown', 'outcome_unknown') for s in steps):
        return 'unknown', 'unknown_external_outcome'
    state, reason = classify(run, steps, available, active_run, canonical_status, dispatch_failure)
    if state == 'working' and run.state == 'queued':
        return 'queued', reason
    if state == 'unavailable' and run.state == 'queued':
        return 'queued', reason
    return {'working':'running', 'completed':'idle', 'cancelled':'stopped',
            'unavailable':'stale', 'waiting_for_person':'waiting_person'}.get(state,state), reason


def execution(c, service, p, ws, cid, status_path):
    from .products import turn_state
    from .responses_dispatcher import general_dispatch_status
    from .responses_ledger import observations

    # Admission chronology is immutable. observed_at alone can move an old run
    # ahead of a later turn after a late receipt or cancellation.
    row = c.execute('''SELECT r.data, chronology.admitted_at,d.failure_reason,
            rc.data->>'grant_id' AS grant_id,g.active AS grant_active
        FROM runs r JOIN work_run_chronology chronology
          ON chronology.workspace_id=r.workspace_id AND chronology.run_id=r.id
        LEFT JOIN assignments a ON a.workspace_id=r.workspace_id AND a.id=r.assignment_id
        LEFT JOIN run_dispatches d ON d.workspace_id=r.workspace_id AND d.run_id=r.id
        LEFT JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id
        LEFT JOIN provider_grants g ON g.id=rc.data->>'grant_id'
        WHERE r.workspace_id=%s AND coalesce(r.conversation_id,a.conversation_id)=%s
        ORDER BY chronology.admitted_at DESC,
          (SELECT max(m.sequence) FROM conversation_messages m
           WHERE m.workspace_id=r.workspace_id AND m.run_id=r.id) DESC NULLS LAST,r.id DESC LIMIT 1''',
        (ws,cid)).fetchone()
    if not row:
        return CurrentExecution(state='idle')
    run = Run.model_validate(row['data'])
    visible = c.execute('SELECT work_reference_visible(%s,%s,%s,%s,%s,%s,%s) AS visible',
        (ws,p.id,cid,run.artifact_id,run.proposal_id,run.assignment_id,run.id)).fetchone()['visible']
    if not visible:
        # Never promote an older accessible run to current or disclose denied IDs.
        return CurrentExecution(state='unknown', reason='source_unavailable')
    attempt = c.execute('SELECT id,data FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',
                        (ws,run.id)).fetchone()
    steps = observations(c,attempt['id']) if attempt else []
    canonical = (general_dispatch_status(run,turn_state(run,c))
                 if run.profile == 'general-responses-v1' and run.state == 'partial' else None)
    h = heartbeat(status_path,ws) if status_path else None
    if h and h.get('grant_id') != row['grant_id']:
        h = None  # Another scope's worker is not this run's observed worker.
    live = bool(h and h.get('authorized') is True and h.get('status') != 'runtime_error'
                and h.get('grant_id') == row['grant_id'] and row['grant_active'])
    if live:
        from .models import ProviderGrant
        from .general_responses import validate_grant
        from .errors import DomainError
        grant_row = c.execute('SELECT data FROM provider_grants WHERE id=%s AND workspace_id=%s AND principal_id=%s',
                              (row['grant_id'],ws,p.id)).fetchone()
        if grant_row:
            try:
                validate_grant(ProviderGrant.model_validate(grant_row['data']),c)
            except DomainError:
                live = False
        else:
            live = False
    failure = row['failure_reason']
    if row['grant_active'] is False:
        failure = 'authority_unavailable'
    state, reason = classify_current(run,steps,live,h.get('run_id') if h else None,canonical,failure)
    if attempt and not steps and attempt['data']['state']=='outcome_unknown':
        state, reason = 'unknown', 'unknown_external_outcome'
    progress = c.execute('SELECT max(created_at) AS at FROM responses_events WHERE attempt_id=%s',
                         (attempt['id'],)).fetchone()['at'] if attempt else run.observed_at
    return CurrentExecution(run_id=run.id,state=state,reason=reason,phase=steps[-1].phase if steps else None,
        admitted_at=row['admitted_at'],last_progress_at=progress,worker_live=bool(h),
        worker_observed_at=datetime.fromtimestamp(h['at'],timezone.utc) if h else None,admission='admitted')


def artifacts(c, service, p, ws, cid):
    rows = c.execute('''SELECT a.id,a.current_revision_id,r.data->'body'->>'title' AS title,
        coalesce(r.data->'body'->>'kind','document') AS kind,r.data->>'body_hash' AS body_hash
        FROM artifacts a JOIN revisions r ON r.workspace_id=a.workspace_id
          AND r.artifact_id=a.id AND r.id=a.current_revision_id
        LEFT JOIN assignments job ON job.workspace_id=a.workspace_id AND job.id=a.assignment_id
        WHERE a.workspace_id=%s AND coalesce(a.conversation_id,job.conversation_id)=%s
          AND work_artifact_visible(a.workspace_id,%s,%s,a.id) ORDER BY a.id''', (ws,cid,p.id,cid)).fetchall()
    items = [WorkArtifact(**row) for row in rows]
    pending = []
    # Batch review inputs, authorized before materialization. Bodies are needed
    # for the canonical structural-removal comparison, but never leave this read.
    proposals = c.execute('''SELECT pr.data,base.data AS base_data,a.current_revision_id,
          NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pr.data->'source_dependencies') dep
            JOIN sources src ON src.workspace_id=pr.workspace_id AND src.id=dep->>'source_id'
            WHERE src.data->>'external_version' IS DISTINCT FROM dep->>'external_version') AS sources_fresh
        FROM proposals pr JOIN artifacts a ON a.workspace_id=pr.workspace_id AND a.id=pr.artifact_id
        JOIN revisions base ON base.workspace_id=pr.workspace_id AND base.artifact_id=pr.artifact_id
          AND base.id=pr.base_revision_id
        LEFT JOIN assignments job ON job.workspace_id=a.workspace_id AND job.id=a.assignment_id
        WHERE pr.workspace_id=%s AND coalesce(a.conversation_id,job.conversation_id)=%s
          AND pr.data->>'status'='pending'
          AND work_reference_visible(pr.workspace_id,%s,%s,pr.artifact_id,pr.id,NULL,NULL)
        ORDER BY pr.artifact_id,(pr.data->>'created_at')::timestamptz DESC,pr.id DESC''',
        (ws,cid,p.id,cid)).fetchall()
    latest = set()
    for row in proposals:
        proposal = Proposal.model_validate(row['data'])
        base = Revision.model_validate(row['base_data'])
        from .proposal_review import removed_content
        _, count = removed_content(base.body,proposal.body)
        same_base = proposal.base_revision_id==row['current_revision_id']
        pending.append(PendingReview(proposal_id=proposal.id,artifact_id=proposal.artifact_id,
            base_revision_id=proposal.base_revision_id,base_work_version=proposal.base_work_version,
            created_at=proposal.created_at,
            fresh=same_base and row['sources_fresh'],
            is_latest=same_base and proposal.artifact_id not in latest,removed_content_count=count))
        if same_base:
            latest.add(proposal.artifact_id)
    return items, pending


def responsibilities(c, p, ws, cid):
    rows = c.execute('''SELECT a.id,a.responsibility_lifecycle,o.observed_at
        FROM assignments a LEFT JOIN work_responsibility_observations o
          ON o.workspace_id=a.workspace_id AND o.assignment_id=a.id
        WHERE a.workspace_id=%s AND a.conversation_id=%s AND a.responsibility_lifecycle IS NOT NULL
          AND work_assignment_visible(a.workspace_id,%s,%s,a.id) ORDER BY a.id''', (ws,cid,p.id,cid)).fetchall()
    result = []
    for row in rows:
        life = ResponsibilityLifecycle.model_validate(row['responsibility_lifecycle'])
        result.append(WorkResponsibility(assignment_id=row['id'],state=life.state,
            next_action=life.next_action,next_check_in_at=life.next_check_in_at,review_required=life.review_required,
            historical_observation=HistoricalObservation(text=life.current_outcome,observed_at=row['observed_at'])))
    return result


def read(events, p, ws, cid, status_path=None):
    service = events.service
    with service.db.transaction() as c:
        c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        cv, generation = events.scope(c,p,ws,cid)
        # Same MVCC snapshot for state, visibility, projection and watermark.
        cursor = events.watermark(c,p,ws,cid,generation)
        saved, pending = artifacts(c,service,p,ws,cid)
        return WorkSnapshot(conversation_id=cid,work_version=cv.work_version,access_generation=generation,
            checked_at=now(),snapshot_cursor=cursor,execution=execution(c,service,p,ws,cid,status_path),
            responsibility=responsibilities(c,p,ws,cid),artifacts=saved,pending_proposals=pending)
