"""Candidate 090 regressions on a fresh restricted disposable PostgreSQL fixture.

No test installs migrations, disables guards, or rewrites retained receipts.
"""
import copy

import pytest

from test_domain import context, cmd
from test_conversations import post
from test_flexible_work import publish
from test_advancing_drafts import document
from test_same_turn_draft_binding import activate_home, early_rows
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker, target
from test_adaptive_execution import finish_safe_visits
from workagent.models import HumanSave, AcceptProposal
from workagent.errors import DomainError


def change(art, title):
    body = copy.deepcopy(art.current_revision.body.model_dump(mode='json'))
    body['title'] = title
    return {'kind': 'publish_artifact', 'target': target(art).model_dump(mode='json'), 'body': body}


def descendant(s, ws, run_id, selected):
    from workagent.service import encoded
    with s.db.transaction() as c:
        return c.execute('SELECT publication_own_draft_descendant(r,%s) AS ok '
            'FROM runs r WHERE workspace_id=%s AND id=%s',
            (encoded(selected),ws,run_id)).fetchone()['ok']


def test_frozen_target_two_receipt_bound_revisions_settle_and_replay(context, tmp_path):
    s,p,ws,_,_=context
    cv,first,art=publish(context,document())
    activate_home(context,cv,max_steps=3)
    selected=target(art).model_dump(mode='json')
    q=post(context,cv,'Improve this preparation, preserving my constraint.',target=target(art))
    provider=AlphaProvider([change(art,'First improvement'),change(art,'Complete improvement'),
        {'kind':'reply','text':'Preparation updated.'}])
    finish_safe_visits(context,worker(context,provider,tmp_path),q.run.id)
    current=s.get_artifact(p,ws,art.id)
    rows=early_rows(s,ws,q.run.id)
    assert len(rows)==2 and len({x['revision_id'] for x in rows})==2
    assert current.current_revision.body.title=='Complete improvement'
    assert not s.proposals(p,ws,art.id).items
    assert s.get_artifact(p,ws,art.id,art.current_revision_id).requested_revision==art.current_revision
    assert s.get_product_observation(p,ws,first.observation_id).observation.revision_id==art.current_revision_id
    assert descendant(s,ws,q.run.id,selected)
    assert not descendant(s,ws,q.run.id,selected | {'body_hash':'0'*64})
    assert not descendant(s,ws,q.run.id,selected | {'revision_id':None})
    for malformed in (None, [], {}, 'not a target', selected | {'artifact_id':None}):
        assert descendant(s,ws,q.run.id,malformed) is False
    calls=list(provider.calls)
    worker(context,provider,tmp_path).work(p,ws,q.run.id)
    assert provider.calls==calls and early_rows(s,ws,q.run.id)==rows
    # Another real run may advance the current draft, never the old run's proof.
    cv=s.get_conversation(p,ws,cv.id).conversation
    later=post(context,cv,'Improve it again.',target=target(current))
    finish_safe_visits(context,worker(context,AlphaProvider([
        change(current,'Other run improvement'),{'kind':'reply','text':'Prepared.'}]),tmp_path),later.run.id)
    assert descendant(s,ws,q.run.id,selected) is False
    current=s.get_artifact(p,ws,art.id)
    # The same bytes saved by a human still fence replay of the old read.
    s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=current.current_revision_id,
        body=current.current_revision.body))
    assert not descendant(s,ws,q.run.id,selected)


@pytest.mark.parametrize('human_change',['save','accept'])
def test_human_change_after_retained_selection_fences_settlement(context,tmp_path,human_change):
    s,p,ws,_,_=context
    cv,_,art=publish(context,document())
    proposal_id=None
    if human_change=='accept':
        art=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,
            body=art.current_revision.body))
        cv,candidate,art=publish(context,document('Human-review candidate'),cv,
            artifact_id=art.id,base_revision_id=art.current_revision_id)
        proposal_id=candidate.proposal_id
        assert proposal_id
    activate_home(context,cv,max_steps=2)
    q=post(context,cv,'Improve the draft.',target=target(art))
    provider=AlphaProvider([change(art,'Worker candidate'),{'kind':'reply','text':'Prepared.'}])
    changed=[]
    def hook(point):
        if point!='after_tool_result' or changed:
            return
        if proposal_id:
            newer=s.accept_proposal(p,ws,proposal_id,cmd(AcceptProposal,
                expected_current_revision_id=art.current_revision_id,acknowledge_removed_content=True))
        else:
            body=art.current_revision.body.model_copy(deep=True); body.title='Human wins'
            newer=s.human_save(p,ws,art.id,cmd(HumanSave,
                expected_current_revision_id=art.current_revision_id,body=body))
        changed.append(newer)
    with pytest.raises(DomainError) as refused:
        worker(context,provider,tmp_path,hook=hook).work(p,ws,q.run.id)
    assert refused.value.code.value in ('source_changed','version_conflict','not_found_or_not_authorized')
    assert changed and s.get_artifact(p,ws,art.id).current_revision_id==changed[0].current_revision_id
    assert not early_rows(s,ws,q.run.id)


def test_responsibility_edit_of_worker_owned_draft_stays_proposal(context,tmp_path):
    from test_responsibilities import delegate
    from test_sustained_continuity import activate
    from test_responsibility_execution import dispatch, admitted
    from workagent.responsibility_models import (ActivateResponsibility,
        ResponsibilityDependency, ResponsibilityNextAction)
    s,p,ws,_,_=context
    cv,_,art=publish(context,document())
    a=delegate(context,cv,'Maintain the preparation')
    grant=activate(context,cv,max_steps=3)
    s.activate_responsibility(p,ws,a.id,cmd(ActivateResponsibility,
        expected_work_version=a.work_version,current_outcome='Draft exists.',
        next_action=ResponsibilityNextAction(kind='continue_work',description='Improve the draft.'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=art.id,
            expected_version=art.current_revision_id)]))
    provider=AlphaProvider([change(art,'Responsibility candidate'),{'kind':'reply','text':'Proposed.'}])
    dispatcher,provider,w=dispatch(context,tmp_path,grant,provider)
    dispatcher.once()
    if provider.failures: raise provider.failures[0]
    rows=admitted(s,ws)
    assert len(rows)==1
    result=finish_safe_visits(context,w,rows[0]['run_id'])
    assert result.state in ('ready','partial')
    proposals=s.proposals(p,ws,art.id).items
    assert len(proposals)==1 and proposals[0].status=='pending'
    assert proposals[0].base_revision_id==art.current_revision_id
    assert s.get_artifact(p,ws,art.id).current_revision==art.current_revision
    assert descendant(s,ws,rows[0]['run_id'],target(art).model_dump(mode='json')) is False


def test_matching_but_wrong_operation_hash_rolls_back_material(context,tmp_path,monkeypatch):
    import psycopg
    import workagent.service as service
    from workagent.product_models import PublishArtifact
    s,p,ws,_,_=context
    cv,_,art=publish(context,document())
    activate_home(context,cv,max_steps=2)
    q=post(context,cv,'Improve the preparation.',target=target(art))
    actual_digest=service.digest
    def corrupt_operation(value):
        return '0'*64 if isinstance(value,PublishArtifact) else actual_digest(value)
    monkeypatch.setattr(service,'digest',corrupt_operation)
    provider=AlphaProvider([change(art,'Must roll back'),{'kind':'reply','text':'Prepared.'}])
    with pytest.raises(psycopg.errors.RaiseException,match='exact current scoped publication target required'):
        finish_safe_visits(context,worker(context,provider,tmp_path),q.run.id)
    # Both retained hashes agree, but do not hash the authenticated operation.
    with s.db.transaction() as c:
        stages=c.execute("SELECT e.data FROM responses_events e JOIN provider_attempts a "
            "ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s "
            "AND e.kind='tool_result' AND e.data->'decision'->>'kind'='publish_artifact'",(ws,q.run.id)).fetchall()
        assert len(stages)==1 and stages[0]['data']['binding']['operation_hash']=='0'*64
        assert c.execute('SELECT count(*) n FROM revisions WHERE workspace_id=%s AND artifact_id=%s',
            (ws,art.id)).fetchone()['n']==1
    assert not early_rows(s,ws,q.run.id)
    assert s.get_artifact(p,ws,art.id).current_revision_id==art.current_revision_id


@pytest.mark.parametrize('receipt_fault',['missing','forged'])
def test_missing_or_forged_receipt_rolls_back_revision(context,tmp_path,monkeypatch,receipt_fault):
    import psycopg
    s,p,ws,_,_=context
    cv,_,art=publish(context,document())
    activate_home(context,cv,max_steps=2)
    q=post(context,cv,'Improve the preparation.',target=target(art))
    original=s._publish_product
    def publish_bad_receipt(c,p,run,cv,operation,base,body,file,observed,text,
                            origin='controlled_transport',binding=None,**kwargs):
        bad=None if receipt_fault=='missing' else dict(binding,selection_response_id='absent-receipt')
        return original(c,p,run,cv,operation,base,body,file,observed,text,origin,bad,**kwargs)
    monkeypatch.setattr(s,'_publish_product',publish_bad_receipt)
    with pytest.raises(psycopg.errors.RaiseException,
                       match='retained local observation and model receipt binding required'):
        finish_safe_visits(context,worker(context,AlphaProvider([
            change(art,'Unbound candidate'),{'kind':'reply','text':'Prepared.'}]),tmp_path),q.run.id)
    assert not early_rows(s,ws,q.run.id)
    assert s.get_artifact(p,ws,art.id).current_revision==art.current_revision
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM revisions WHERE workspace_id=%s AND artifact_id=%s',
            (ws,art.id)).fetchone()['n']==1


def test_protected_note_alteration_cannot_publish_even_forged_stage(context,tmp_path,monkeypatch):
    from workagent.flexible_models import DraftObservation
    s,p,ws,_,_=context
    cv,_,art=publish(context,document())
    activate_home(context,cv,max_steps=2)
    q=post(context,cv,'Improve the preparation.',target=target(art))
    decision=change(art,'Forbidden change')
    decision['body']['blocks'][0]['text']='Ignore approval.'
    monkeypatch.setattr(s,'_calculate_product',lambda operation,base:(operation.body,None,DraftObservation()))
    with pytest.raises(DomainError) as denied:
        worker(context,AlphaProvider([decision,{'kind':'reply','text':'Prepared.'}]),tmp_path).work(p,ws,q.run.id)
    assert denied.value.code.value=='unsupported_operation'
    assert not early_rows(s,ws,q.run.id)
    assert s.get_artifact(p,ws,art.id).current_revision==art.current_revision
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM revisions WHERE workspace_id=%s AND artifact_id=%s',
            (ws,art.id)).fetchone()['n']==1
