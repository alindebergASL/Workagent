"""Real restricted PostgreSQL recovery for in-scope inadmissible model edits."""
import pytest
from test_domain import context,cmd,raises
from test_conversations import post
from test_flexible_work import table,publish,DraftProvider
from test_general_responses import worker,target,totals,activate as general_activate
from test_adaptive_execution import activate as adaptive_activate
from workagent.models import HumanSave
from workagent.service import Service


def setup(ctx,adaptive=True):
    s,p,ws,_,_=ctx
    body=table();body['fields'][1]['editable']=False
    cv,_,art=publish(ctx,body)
    grant=adaptive_activate(ctx,cv) if adaptive else general_activate(ctx,[cv])
    q=post(ctx,cv,'Propose an allowed improvement, preserve my saved work.',target=target(art))
    return art,grant,q


def draft(art,repair):
    def select(ctx):
        body=art.current_revision.body.model_dump(mode='json')
        observations=ctx.get('adaptive',{}).get('observations',[])
        if observations and repair:
            assert observations[-1]['status']=='rejected'
            assert observations[-1]['diagnostic']['code']=='artifact_edit_rejected'
            body['rows'][0]['cells'][0]['value']='Better Oak'
        else:
            body['rows'][0]['cells'][1]['value']='99.0'
        return body
    return select


@pytest.mark.parametrize('adaptive,repair',[(True,True),(True,False)])
def test_readonly_model_edit_is_retained_rejection_then_recovery_or_terminal(context,tmp_path,adaptive,repair):
    s,p,ws,_,_=context
    art,grant,q=setup(context,adaptive)
    fake=DraftProvider(draft(art,repair),adaptive)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,q.run.conversation_id)
    with s.db.transaction() as c:
        retained=c.execute("SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result' ORDER BY e.phase",(q.run.id,)).fetchall()
        acknowledged=c.execute('SELECT acknowledged_at FROM run_dispatches WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
    assert retained[0]['data']['status']=='rejected'
    assert retained[0]['data']['body'] is None and retained[0]['data']['output'] is None
    assert retained[0]['data']['diagnostic']['code']=='artifact_edit_rejected'
    assert 'read-only' in retained[0]['data']['reason']
    assert acknowledged['acknowledged_at'] is not None
    assert s.get_artifact(p,ws,art.id).current_revision==art.current_revision
    proposals=s.proposals(p,ws,art.id).items
    if repair:
        assert len(retained)==2 and len(proposals)==1 and proposals[0].status=='pending'
        assert proposals[0].body.rows[0].cells[0].value=='Better Oak'
        assert proposals[0].body.rows[0].cells[1].value=='12.5'
        assert detail.turns[-1].adaptive.outcome=='needs_validation'
        assert not detail.turns[-1].adaptive.steps[-1].verification.satisfied
    else:
        assert not proposals and len(retained)==(4 if adaptive else 1)
        assert all(r['data']['status']=='rejected' for r in retained)
        if adaptive: assert detail.turns[-1].adaptive.outcome=='step_limit'
        assert 'read-only' in detail.messages[-1].text
    before=totals(s,grant)['request_counts']['dispatch']
    assert before==len(retained)+1
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert totals(s,grant)['request_counts']['dispatch']==before
    assert Service(s.db).get_conversation(p,ws,q.run.conversation_id)==detail


def test_retained_edit_rejection_resumes_without_reselecting(context,tmp_path):
    s,p,ws,_,_=context
    art,grant,q=setup(context)
    fake=DraftProvider(draft(art,True),True)
    crashed=[]
    def hook(point):
        if point=='after_tool_result' and not crashed:
            crashed.append(point);raise RuntimeError('synthetic interruption after edit rejection')
    with pytest.raises(RuntimeError,match='synthetic interruption'):
        worker(context,fake,tmp_path,hook=hook).work(p,ws,q.run.id)
    assert totals(s,grant)['request_counts']['dispatch']==1
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert totals(s,grant)['request_counts']['dispatch']==3
    assert len(s.proposals(p,ws,art.id).items)==1
    assert s.get_artifact(p,ws,art.id).current_revision==art.current_revision


@pytest.mark.parametrize('boundary',['stale','revoked'])
def test_edit_rejection_does_not_turn_lost_authority_into_recovery(context,tmp_path,monkeypatch,boundary):
    from workagent.db import Database
    from workagent.errors import DomainError
    s,p,ws,_,admin=context
    art,grant,q=setup(context)
    fake=DraftProvider(draft(art,True),True)
    original=s._calculate_product
    changed=[]
    def calculate(operation,base):
        if not changed:
            changed.append(boundary)
            if boundary=='stale':
                body=art.current_revision.body.model_copy(deep=True);body.title='Human newer edit'
                s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
            else:
                with Database(admin).transaction() as c:
                    c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
        return original(operation,base)
    monkeypatch.setattr(s,'_calculate_product',calculate)
    with pytest.raises(DomainError) as denied:
        worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert denied.value.code.value in ('source_changed','version_conflict','not_found_or_not_authorized')
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result'",(q.run.id,)).fetchone()['n']==0
        assert c.execute('SELECT count(*) n FROM proposals WHERE workspace_id=%s AND artifact_id=%s',(ws,art.id)).fetchone()['n']==0
    assert totals(s,grant)['request_counts']['dispatch']==1
    with pytest.raises(DomainError):
        worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert totals(s,grant)['request_counts']['dispatch']==1


def test_historical_nonadaptive_readonly_edit_stays_fail_closed(context,tmp_path):
    from workagent.errors import DomainError
    s,p,ws,_,_=context
    art,grant,q=setup(context,False)
    with pytest.raises(DomainError) as denied:
        worker(context,DraftProvider(draft(art,False),False),tmp_path).work(p,ws,q.run.id)
    assert denied.value.code.value=='unsupported_operation'
    assert not s.proposals(p,ws,art.id).items
    assert s.get_artifact(p,ws,art.id).current_revision==art.current_revision


def test_publication_rechecks_readonly_edit_even_if_stage_is_forged(context,tmp_path,monkeypatch):
    from workagent.flexible_models import DraftObservation
    from workagent.errors import DomainError
    s,p,ws,_,_=context
    art,grant,q=setup(context)
    fake=DraftProvider(draft(art,False),True)
    monkeypatch.setattr(s,'_calculate_product',lambda operation,base:(operation.body,None,DraftObservation()))
    with pytest.raises(DomainError) as denied:
        worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert denied.value.code.value=='unsupported_operation'
    assert not s.proposals(p,ws,art.id).items
    assert s.get_artifact(p,ws,art.id).current_revision==art.current_revision
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM product_observations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['n']==0
