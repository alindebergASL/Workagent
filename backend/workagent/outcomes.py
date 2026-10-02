"""One bounded, read-only outcome projection for all responsibility surfaces.

Saved records + immutable publication bindings, never completion prose/run.state,
prove preparation. Approval proves ONLY an exact document revision, not its tasks.
"""
from .models import (ArtifactBinding, OutcomeCheck, ResponsibilityOutcome, RunOutcome,
                     Run, Revision, Proposal, OutcomeQuestion, ProviderGrant, now)
from .errors import DomainError
from .provider_attempts import attempt_row
from .service import digest


def acknowledge(c,ws,run_id):
    dispatch=c.execute('''UPDATE run_dispatches SET acknowledged_at=now()
        WHERE workspace_id=%s AND run_id=%s AND acknowledged_at IS NULL RETURNING outbox_id''',
        (ws,run_id)).fetchone()
    if dispatch:
        c.execute('''UPDATE outbox SET consumed_at=now() WHERE id=%s AND consumed_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM run_dispatches WHERE outbox_id=%s AND acknowledged_at IS NULL)''',
            (dispatch['outbox_id'],dispatch['outbox_id']))
        c.execute("UPDATE outbox SET consumed_at=now() WHERE workspace_id=%s AND object_id=%s AND operation IN ('claim_run','complete_run') AND consumed_at IS NULL",(ws,run_id))


def verify_document(c,assignment,run):
    """Internal historical verifier: no source materialization or continuation.

    Caller must either authorize the human projection or hold an authenticated
    receipt capability and return only a boolean ACK, never this data.
    """
    ws=assignment.workspace_id
    result=RunOutcome(run_id=run.id,execution=run.execution,state='unverified',unresolved=run.unresolved)
    attempt=attempt_row(c,ws,run.id)
    result.attempt_state=attempt.state if attempt else None
    if attempt and attempt.state in ('dispatched','outcome_unknown'):
        # Dispatch is potentially executed, even if a timeout/crash wasn't recorded.
        result.state='outcome_unknown'
        return result
    receipt=c.execute('SELECT data FROM run_publications WHERE workspace_id=%s AND run_id=%s',(ws,run.id)).fetchone()
    if not receipt:
        result.state=('waiting' if attempt or run.state=='cancelled' else
                      'preparing' if run.state in ('queued','running') else 'unverified')
        result.checks=[OutcomeCheck(name='publication_binding',status='unverified')]
        return result
    bindings=[ArtifactBinding.model_validate(x) for x in receipt['data']['artifacts']]
    checks={}
    def check(name,passed):
        checks[name]=checks.get(name,True) and bool(passed)
    check('publication_binding',1<=len(bindings)<=10 and (run.kind=='initial' or len(bindings)==1))
    states=[]
    saved_hashes=[]
    for binding in bindings:
        artifact=c.execute('SELECT * FROM artifacts WHERE workspace_id=%s AND id=%s AND assignment_id=%s',
                           (ws,binding.artifact_id,assignment.id)).fetchone()
        check('publication_binding',artifact and binding.artifact_id in assignment.artifact_ids)
        if not artifact:
            continue
        if binding.proposal_id:
            row=c.execute('SELECT * FROM proposals WHERE workspace_id=%s AND id=%s',(ws,binding.proposal_id)).fetchone()
            check('publication_binding',row is not None and run.kind=='revision' and
                  binding.proposal_id==run.proposal_id and binding.artifact_id==run.artifact_id and
                  binding.base_revision_id==run.base_revision_id)
            if not row:
                continue
            proposal=Proposal.model_validate(row['data'])
            check('publication_binding',proposal.id==binding.proposal_id and proposal.assignment_id==assignment.id and
                  proposal.workspace_id==ws and proposal.artifact_id==binding.artifact_id and
                  row['artifact_id']==binding.artifact_id and row['base_revision_id']==binding.base_revision_id)
            check('saved_body',digest(proposal.body)==proposal.body_hash==binding.body_hash)
            check('exact_base',proposal.base_revision_id==binding.base_revision_id)
            saved_hashes.append(digest(proposal.body))
            if proposal.status=='accepted':
                revrow=c.execute('SELECT data FROM revisions WHERE workspace_id=%s AND artifact_id=%s AND id=%s',
                                 (ws,binding.artifact_id,proposal.accepted_revision_id)).fetchone()
                check('saved_body',revrow is not None)
                if revrow:
                    revision=Revision.model_validate(revrow['data'])
                    check('saved_body',revision.id==proposal.accepted_revision_id and
                          revision.artifact_id==binding.artifact_id and revision.author_kind=='human' and
                          digest(revision.body)==revision.body_hash==proposal.body_hash and revision.body==proposal.body)
                    check('exact_base',revision.parent_revision_id==proposal.base_revision_id)
                    binding.revision_id=revision.id
                current=artifact['current_revision_id']==proposal.accepted_revision_id
                check('current_revision',current)
                states.append('readback_verified' if current else 'approved')
            elif proposal.status=='pending':
                current=artifact['current_revision_id']==proposal.base_revision_id
                states.append('decision_required' if current else 'decision_stale')
                result.question=OutcomeQuestion(
                    prompt='Approve this exact document proposal against its base revision?' if current else
                           'The base changed. Request a new proposal against the current revision?',
                    artifact_id=binding.artifact_id,proposal_id=proposal.id,base_revision_id=proposal.base_revision_id)
            else:
                states.append('waiting')
        else:
            check('publication_binding',run.kind=='initial' and binding.revision_id is not None)
            row=c.execute('SELECT data FROM revisions WHERE workspace_id=%s AND artifact_id=%s AND id=%s',
                          (ws,binding.artifact_id,binding.revision_id)).fetchone()
            check('saved_body',row is not None)
            if row:
                revision=Revision.model_validate(row['data'])
                check('saved_body',revision.id==binding.revision_id and revision.artifact_id==binding.artifact_id and
                      revision.author_kind=='worker' and revision.author_id==run.principal_id and
                      digest(revision.body)==revision.body_hash==binding.body_hash)
                saved_hashes.append(digest(revision.body))
            states.append('prepared')
    if run.profile=='openai-agents-v1':
        check('provider_result',attempt and attempt.result and attempt.state in ('responded','reconciled') and
              attempt.result_hash==digest(attempt.result) and saved_hashes==[digest(b) for b in attempt.result.bodies])
    result.artifacts=bindings
    result.checks=[OutcomeCheck(name=name,status='passed' if passed else 'failed') for name,passed in checks.items()]
    # Historical approved bytes can remain true after a later human edit, but never
    # claim the old revision is current or that readback passed for that revision.
    outcome_ok=all(v for k,v in checks.items() if k not in ('authority','current_revision'))
    result.outcome_gate='passed' if outcome_ok else 'failed'
    if outcome_ok and states:
        result.state=states[-1]
    else:
        result.question=None
    return result


# Server-owned, bounded explanations; never use provider prose as authority.
EXPLANATIONS = {
    'paused': ('This assignment is paused.', 'Resume only after resolving pending attempt evidence.'),
    'cancelled': ('This run or assignment was cancelled.', 'Retain any incurred receipt; do not send or publish this run.'),
    'grant_revoked': ('The run grant was revoked.', 'Reconcile existing evidence; obtain a new grant for new work, not a resend.'),
    'grant_expired': ('The run grant expired.', 'Reconcile existing evidence; obtain a new grant for new work, not a resend.'),
    'source_changed': ('The pinned source authority or content changed.', 'Review current authorized sources before admitting new work.'),
    'runtime_unavailable': ('The pinned runtime is unavailable.', 'Ask the operator to restore the reviewed runtime; do not substitute another runtime.'),
    'consumer_unavailable': ('No inference transport is installed in this checkpoint.', 'Wait for a separately reviewed consumer and explicit execution grant; do not send.'),
    'lease_expired': ('The execution lease expired.', 'Use the fenced recovery path; an existing attempt never authorizes a resend.'),
    'prepared_attempt': ('An unsent attempt is prepared, but has no dispatch receipt.', 'The bound consumer may abandon the unsent attempt; never reclaim it as another send.'),
    'provider_outcome_unknown': ('A dispatch may have executed; its result is unknown.', 'Retain a matching receipt through the bound consumer; never resend or classify a timeout as unsent.'),
    'publication_pending': ('A receipt is retained but no document publication is verified.', 'Publish only the stored result under current authority and a valid fenced lease, then reconcile.'),
    'unsent_abandoned': ('The prepared attempt was terminally abandoned before dispatch.', 'No send occurred. Explicitly admit new work under current authority if still needed.'),
    'unresolved_items': ('The document is saved, but this run has unresolved items.', 'Review the unresolved items; prepared documents do not mean the underlying task was performed.'),
    'decision_required': ('An exact document proposal needs a human decision.', 'Review the bound proposal and approve only against its exact base revision.'),
    'decision_stale': ('The proposal base is no longer current.', 'Preserve the current human edit and request a new proposal; do not rebase old approval implicitly.'),
}


def continuation_blocker(service,c,p,assignment,run):
    """Current availability, independent of truth about historical document bytes."""
    if assignment.state in ('paused','cancelled'):
        return assignment.state
    if run.state=='cancelled':
        return 'cancelled'
    generation=c.execute('SELECT access_generation FROM workspaces WHERE id=%s',(assignment.workspace_id,)).fetchone()['access_generation']
    if generation!=run.access_generation:
        return 'source_changed'
    for ref in assignment.selected_source_refs:
        source=service._source(c,p,assignment.workspace_id,ref)
        if source['data']['external_version']!=ref.external_version:
            return 'source_changed'
    context=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                      (run.workspace_id,run.id)).fetchone()
    if context:
        for source in context['data']['source_manifest']:
            row=c.execute('SELECT content FROM sources WHERE workspace_id=%s AND id=%s',
                          (run.workspace_id,source['id'])).fetchone()
            if not row or digest(row['content'])!=source['sha256']:
                return 'source_changed'
    if run.profile=='openai-agents-v1':
        from . import provider_attempts
        config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                         (run.workspace_id,run.id)).fetchone()
        if not config:
            return 'runtime_unavailable'
        row=c.execute('SELECT data,active FROM provider_grants WHERE id=%s',(config['data'].get('grant_id'),)).fetchone()
        if not row or not row['active']:
            return 'grant_revoked'
        if ProviderGrant.model_validate(row['data']).expires_at<=provider_attempts.now():
            return 'grant_expired'
    try:
        service._runtime_pins(c,run)
    except DomainError:
        return 'runtime_unavailable'
    return None


def verify_run(service,c,p,assignment,run):
    # Authorization happens before materialization in each public caller. Read-only
    # history remains true even when continuation is unavailable, paused or expired.
    result=verify_document(c,assignment,run)
    blocker=continuation_blocker(service,c,p,assignment,run)
    result.safety_gate='failed' if blocker else 'passed'
    result.checks.append(OutcomeCheck(name='authority',status=result.safety_gate))
    result.continuation_available=blocker is None and run.state in ('queued','running')
    if result.attempt_state=='failed':
        blocker='unsent_abandoned'
        result.continuation_available=False
    elif result.attempt_state in ('dispatched','outcome_unknown'):
        blocker=blocker or 'provider_outcome_unknown'
        result.continuation_available=False
    elif result.outcome_gate=='passed':
        blocker=blocker or (result.state if result.state in ('decision_required','decision_stale') else
                            'unresolved_items' if result.unresolved else None)
    elif not blocker:
        if result.attempt_state=='prepared':
            blocker='prepared_attempt'
            result.continuation_available=False
        elif result.attempt_state=='responded':
            blocker='publication_pending'
        elif run.profile=='openai-agents-v1':
            blocker='consumer_unavailable'
            result.continuation_available=False
        elif run.state=='running' and (not run.lease_expires_at or run.lease_expires_at<=now()):
            blocker='lease_expired'
            result.continuation_available=False
    if blocker:
        result.blocker=blocker
        result.reason,result.next_action=EXPLANATIONS[blocker]
        if result.outcome_gate!='passed' and result.state!='outcome_unknown':
            result.state='waiting'
    return result


def project_assignment(service,c,p,assignment):
    rows=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND assignment_id=%s',(assignment.workspace_id,assignment.id)).fetchall()
    runs={r['data']['id']:Run.model_validate(r['data']) for r in rows}
    assignment.responsibility=ResponsibilityOutcome(
        latest_run_id=assignment.run_ids[-1] if assignment.run_ids else None,
        runs=[verify_run(service,c,p,assignment,runs[rid]) for rid in assignment.run_ids if rid in runs])
    return assignment
