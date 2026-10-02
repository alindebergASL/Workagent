"""One bounded, read-only outcome projection for all responsibility surfaces.

Saved records + immutable publication bindings, never completion prose/run.state,
prove preparation. Approval proves ONLY an exact document revision, not its tasks.
"""
from .models import (ArtifactBinding, OutcomeCheck, ResponsibilityOutcome, RunOutcome,
                     Run, Revision, Proposal)
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


def verify_run(service,c,p,assignment,run):
    ws=assignment.workspace_id
    result=RunOutcome(run_id=run.id,execution=run.execution,state='unverified')
    attempt=attempt_row(c,ws,run.id)
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
    check('authority',assignment.state not in ('paused','cancelled'))
    generation=c.execute('SELECT access_generation FROM workspaces WHERE id=%s',(ws,)).fetchone()['access_generation']
    check('authority',generation==run.access_generation)
    for ref in assignment.selected_source_refs:
        source=service._source(c,p,ws,ref)
        check('authority',source['data']['external_version']==ref.external_version)
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
                states.append('decision_required' if artifact['current_revision_id']==proposal.base_revision_id else 'decision_stale')
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
    result.safety_gate='passed' if checks.get('authority') else 'failed'
    if outcome_ok and result.safety_gate=='passed' and states:
        result.state=states[-1]
    return result


def project_assignment(service,c,p,assignment):
    rows=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND assignment_id=%s',(assignment.workspace_id,assignment.id)).fetchall()
    runs={r['data']['id']:Run.model_validate(r['data']) for r in rows}
    assignment.responsibility=ResponsibilityOutcome(
        latest_run_id=assignment.run_ids[-1] if assignment.run_ids else None,
        runs=[verify_run(service,c,p,assignment,runs[rid]) for rid in assignment.run_ids if rid in runs])
    return assignment
