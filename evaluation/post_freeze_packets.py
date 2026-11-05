"""Future-only partial collection and explicit operational review receipts.

Does not import or modify a frozen campaign. Caller supplies an ordinary Service
and authorized human principal. No provider I/O, replay, auto-accept or scoring.
"""
from workagent.errors import DomainError
from workagent.service import digest
from workagent.general_responses import terminal_failure_bound,known_input_rejection_is_settled
from workagent.file_input_rejection import tools_unresolved


def require_observed(step,events):
    if terminal_failure_bound(step,events):return
    if not events:return  # Unsent prepared bytes are not an external effect.
    if 'count_send' in events and 'count_result' not in events:raise DomainError('action_unresolved')
    if 'dispatch' not in events:
        if set(events)<= {'count_send','count_result'}:return
        raise DomainError('action_unresolved')
    result=events.get('result',{});identity=events.get('identity',{})
    if (result.get('state') not in ('completed','function_call')
        or not identity.get('response_id') or result.get('response_id')!=identity['response_id']
        or any(item.get('request_sha256')!=step['request_sha256'] or item.get('metadata')!=step['metadata']
               for item in (result,identity,events.get('count_result',{})))
        or events.get('count_result',{}).get('count_sha256')!=step['count_sha256']
        or {'problem','corrected_readback','cancel'} & events.keys()):
        raise DomainError('action_unresolved')


def collect_packet(service,principal,workspace,run_id):
    run=service.get_run(principal,workspace,run_id)
    if run.state not in ('ready','partial'):raise DomainError('action_unresolved')
    with service.db.transaction() as c:
        service._scope(c,principal,workspace)
        if tools_unresolved(c,workspace,run_id) or c.execute("SELECT 1 FROM tool_attempts t WHERE workspace_id=%s AND run_id=%s AND NOT EXISTS(SELECT 1 FROM tool_attempt_events e WHERE e.attempt_id=t.id AND e.kind='observation')",(workspace,run_id)).fetchone():
            raise DomainError('action_unresolved')
        steps=c.execute('SELECT s.* FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s',(workspace,run_id)).fetchall()
        proven_counts={row['attempt_id'] for row in steps if known_input_rejection_is_settled(c,row['attempt_id'])}
        for step in steps:
            events={r['kind']:r['data'] for r in c.execute("SELECT kind,data FROM responses_events WHERE attempt_id=%s AND phase=%s AND kind<>'read'",(step['attempt_id'],step['phase']))}
            if step['attempt_id'] not in proven_counts:require_observed(step,events)
    detail=service.get_conversation(principal,workspace,run.conversation_id)
    artifacts=[];downloads=[];proposals=[];produced=[]
    for aid in detail.artifact_ids:
        artifact=service.get_artifact(principal,workspace,aid)
        artifacts.append(artifact.model_dump(mode='json'))
        # IDs/provenance only from SQL; bodies always pass ordinary API reads.
        # Current human revisions are context, never falsely credited to this run.
        with service.db.transaction() as c:
            service._scope(c,principal,workspace)
            rows=c.execute('SELECT id FROM revisions WHERE workspace_id=%s AND artifact_id=%s AND producer_run_id=%s ORDER BY revision_number',
                (workspace,aid,run_id)).fetchall()
        for row in rows:
            saved=service.get_artifact(principal,workspace,aid,row['id']).requested_revision
            produced.append(dict(artifact_id=aid,revision_id=saved.id,body_hash=saved.body_hash,producer_run_id=run_id))
        cursor=None
        while True:
            page=service.proposals(principal,workspace,aid,cursor=cursor,limit=100)
            proposals.extend(x.model_dump(mode='json') for x in page.items)
            cursor=page.next_cursor
            if cursor is None:break
        try:
            file=service.download_product(principal,workspace,aid)
        except DomainError as exc:
            if exc.code.value!='unsupported_operation':raise
        else:downloads.append(dict(artifact_id=aid,filename=file.filename,mime_type=file.mime_type,content=file.content,sha256=__import__('hashlib').sha256(file.content.encode()).hexdigest()))
    return dict(run_id=run.id,state=run.state,stop_reason=run.stop_reason,explanatory_unresolved=run.unresolved,
        external_unknown=False,artifacts=artifacts,downloads=downloads,proposals=proposals,
        artifacts_scope='authorized conversation current state; not attributed wholesale to this run',
        run_produced_revisions=produced,
        message_records=[m.model_dump(mode='json') for m in detail.messages if m.run_id==run.id],scoring='unscored')


def review_proposal(service,principal,workspace,proposal_id,*,current_revision_id,base_revision_id,body_hash,
                    decision,justification,command,protected_text):
    """Parent explicitly chooses accept or retain-current. Ordinary CAS owns it."""
    from workagent.models import AcceptProposal,DismissProposal
    if decision not in ('accept','retain-current') or not justification.strip():raise DomainError('validation_error')
    with service.db.transaction() as c:
        service._scope(c,principal,workspace)
        proposal,_,_=service._proposal(c,principal,workspace,proposal_id)
    art=service.get_artifact(principal,workspace,proposal.artifact_id)
    accepted_retry=(decision=='accept' and proposal.status=='accepted'
        and proposal.accepted_revision_id==art.current_revision_id
        and art.current_revision.body_hash==body_hash and current_revision_id==base_revision_id)
    if (proposal.base_revision_id!=base_revision_id or proposal.body_hash!=body_hash
        or (art.current_revision_id!=current_revision_id and not accepted_retry)
        or command.expected_current_revision_id!=current_revision_id):
        raise DomainError('version_conflict')
    # On an accepted retry, the ordinary command ledger must prove the SAME
    # command/payload. A fresh command against an accepted proposal still denies.
    before=art.current_revision.body_hash
    def protected(body):
        text=getattr(body,'content','') or '\n'.join(b.text for b in getattr(body,'blocks',[]))
        return all(p in text for p in protected_text)
    if not protected(art.current_revision.body):raise DomainError('validation_error')
    if decision=='accept':
        if not isinstance(command,AcceptProposal) or not protected(proposal.body):raise DomainError('validation_error')
        # Required whole-file removals/older-proposal acknowledgment stays in
        # the ordinary product API, never silently supplied by this adapter.
        service.accept_proposal(principal,workspace,proposal_id,command)
    else:
        if not isinstance(command,DismissProposal) or command.resolution!='keep_current':raise DomainError('validation_error')
        service.dismiss_proposal(principal,workspace,proposal_id,command)
    current=service.get_artifact(principal,workspace,proposal.artifact_id)
    expected=body_hash if decision=='accept' else before
    if current.current_revision.body_hash!=expected or not protected(current.current_revision.body):raise DomainError('source_changed')
    return dict(proposal_id=proposal_id,artifact_id=proposal.artifact_id,base_revision_id=base_revision_id,
        proposed_body_hash=body_hash,current_revision_id=current.current_revision_id,current_body_hash=expected,
        decision=decision,justification=justification,command_id=command.command_id,human_time_measured=False)


def require_reviewed_transition(service,principal,workspace,artifact_id,receipts):
    """Call immediately before a future dependent transition; no frozen adapter."""
    art=service.get_artifact(principal,workspace,artifact_id)
    checked=set();cursor=None
    while True:
        page=service.proposals(principal,workspace,artifact_id,cursor=cursor,limit=100)
        for proposal in page.items:
            if proposal.status=='pending':raise DomainError('review_required',proposal_id=proposal.id,fields=['explicit_operational_review'])
            # Prior resolved history is not a new review obligation. The current
            # accepted revision/current-base decisions do require exact receipts.
            relevant=(proposal.base_revision_id==art.current_revision_id or proposal.accepted_revision_id==art.current_revision_id or proposal.id in receipts)
            if not relevant:continue
            if proposal.id not in receipts:raise DomainError('review_required',proposal_id=proposal.id,fields=['review_receipt'])
            receipt=receipts[proposal.id]
            if receipt.get('decision') not in ('accept','retain-current') or receipt.get('proposal_id')!=proposal.id:
                raise DomainError('source_changed')
            expected='accepted' if receipt['decision']=='accept' else 'dismissed'
            if (proposal.artifact_id!=artifact_id or proposal.status!=expected or receipt['proposed_body_hash']!=proposal.body_hash
                or receipt['base_revision_id']!=proposal.base_revision_id or receipt['artifact_id']!=artifact_id
                or receipt['current_revision_id']!=art.current_revision_id or receipt['current_body_hash']!=art.current_revision.body_hash
                or not receipt['justification'].strip()):raise DomainError('source_changed')
            checked.add(proposal.id)
        cursor=page.next_cursor
        if cursor is None:break
    # Enumeration is authorized and paginated. A supplied receipt cannot be
    # silently dropped because its proposal is missing, hidden or elsewhere.
    if set(receipts)!=checked:raise DomainError('source_changed')
    return dict(artifact_id=artifact_id,revision_id=art.current_revision_id,body_hash=art.current_revision.body_hash)
