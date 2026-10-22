"""Own new drafts must not evict authority for an exact retained recording."""
from datetime import timedelta
from unittest.mock import patch
import pytest
from test_domain import context,cmd
from test_conversations import conversation,post
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_same_turn_draft_binding import activate_home,early_rows
from test_sustained_continuity import draft,Interrupted
from test_runtime import expire
from workagent.general_worker import GeneralWorker,ControlledTransport
from workagent.models import PostMessage,now
from workagent.service import Service


@pytest.mark.parametrize('human_edit',[False,True])
def test_recorded_dependency_replays_after_own_draft_displaces_offer(context,tmp_path,human_edit):
    s,p,ws,_,_=context
    cv=conversation(context)
    for index in range(50):
        q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,
            text='Retain synthetic preparation',operation={'kind':'publish_artifact','body':draft('Preparation '+str(index))['body']}))
        GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
        cv=s.get_conversation(p,ws,cv.id).conversation
    activate_home(context,cv,max_steps=4)
    q=post(context,cv,'Record a review of an existing preparation, then create a separate new note.')
    chosen=[]
    def record(ctx):
        offered=ctx['responsibility_offer']['dependencies']
        assert len(offered)==50
        chosen.append(offered[-1])
        return {'kind':'record_responsibility','goal':'Review the bound preparation',
            'completion_criteria':['Human confirms review'],
            'plan':{'current_outcome':'Preparation retained.',
                'next_action':{'kind':'review_dependency','description':'Review the bound preparation tomorrow.'},
                'dependencies':[offered[-1]],
                'wait':{'kind':'check_in','reason':'Review tomorrow.'},
                'next_check_in_at':(now()+timedelta(days=1)).isoformat()}}
    provider=AlphaProvider([record,draft('Separate new note'),{'kind':'reply','text':'Retained the original review and the separate note.'}])
    original=s._general_context
    def crash_after_commit(*args,**kwargs):
        if early_rows(s,ws,q.run.id):raise Interrupted()
        return original(*args,**kwargs)
    with patch.object(s,'_general_context',side_effect=crash_after_commit),pytest.raises(Interrupted):
        finish_safe_visits(context,worker(context,provider,tmp_path),q.run.id)
    materials=early_rows(s,ws,q.run.id);assert len(materials)==1
    with s.db.transaction() as c:
        recording=c.execute('SELECT responsibility_recording FROM assignments WHERE workspace_id=%s AND responsibility_recording->>\'run_id\'=%s',(ws,q.run.id)).fetchone()['responsibility_recording']
        before=c.execute("SELECT e.kind,e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.phase='selection' ORDER BY e.kind",(q.run.id,)).fetchall()
    expire(context,q.run.id)
    fresh=(Service(s.db),*context[1:])
    if human_edit:
        from workagent.models import HumanSave
        from workagent.errors import DomainError
        current=s.get_artifact(p,ws,chosen[0]['object_id'])
        body=current.current_revision.body.model_dump(mode='json')
        body['title']='Human authoritative correction'
        saved=s.human_save(p,ws,current.id,cmd(HumanSave,expected_current_revision_id=current.current_revision_id,body=body))
        calls=list(provider.calls)
        with pytest.raises(DomainError) as failure:
            worker(fresh,provider,tmp_path).work(p,ws,q.run.id)
        assert failure.value.code.value in ('source_changed','version_conflict')
        assert provider.calls==calls and early_rows(s,ws,q.run.id)==materials
        assert s.get_artifact(p,ws,current.id).current_revision_id==saved.current_revision_id
        with s.db.transaction() as c:
            assert c.execute("SELECT e.kind,e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.phase='selection' ORDER BY e.kind",(q.run.id,)).fetchall()==before
        return
    result=finish_safe_visits(fresh,worker(fresh,provider,tmp_path),q.run.id)
    # A scheduled responsibility is intentionally partial until its outcome is
    # validated; successful replay still publishes the exact receipted reply.
    assert result is not None
    assert result.state=='partial' and result.stop_reason is None
    messages=[m for m in s.get_conversation(p,ws,cv.id).messages if m.run_id==q.run.id and m.author_kind=='assistant']
    assert len(messages)==1 and messages[0].model_receipt
    assert early_rows(s,ws,q.run.id)==materials
    life=s.get_responsibility(p,ws,recording['result']['assignment_id']).lifecycle
    assert [d.model_dump(mode='json') for d in life.dependencies]==chosen
    with s.db.transaction() as c:
        assert c.execute("SELECT e.kind,e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.phase='selection' ORDER BY e.kind",(q.run.id,)).fetchall()==before
        assert c.execute("SELECT count(*) n FROM assignments WHERE workspace_id=%s AND responsibility_recording->>'run_id'=%s",(ws,q.run.id)).fetchone()['n']==1
