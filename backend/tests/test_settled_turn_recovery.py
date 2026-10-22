"""Human steering fences an interrupted, fully observed turn without replay."""
import httpx
import pytest
from test_domain import context,cmd,raises
from test_conversations import post
from test_general_alpha_runtime import launch,AlphaProvider
from test_general_responses import worker,totals
from test_responsibility_action import record
from test_cancelled_unsent_admission import journal
from test_adaptive_execution import finish_safe_visits
from workagent.responsibility_models import ControlResponsibility
from workagent.general_responses import has_unresolved_attempt
from workagent.responses_ledger import Ledger


@pytest.mark.parametrize('boundary',['settled','prepared_step','unknown_count','unknown_generation','unapplied_result'])
def test_new_human_turn_only_supersedes_fully_observed_effects(context,tmp_path,monkeypatch,boundary):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[record,{'kind':'discover_capabilities'},{'kind':'reply','text':'Old reply.'}])
    w.phases.transport._client.timeout=httpx.Timeout(.1)
    completed=[]
    def crash():raise RuntimeError('controlled interruption')
    def hook(name):
        if name=='after_tool_result':
            completed.append(name)
            if boundary=='settled':crash()
        if boundary=='unknown_generation' and name=='after_predispatch' and completed:crash()
    w.phases.hook=hook
    with monkeypatch.context() as patch:
        if boundary=='prepared_step':
            original=Ledger.prepare
            def prepare(self,request,*args,**kw):
                result=original(self,request,*args,**kw)
                if request.metadata.step_id=='selection_2':crash()
                return result
            patch.setattr(Ledger,'prepare',prepare)
        elif boundary=='unknown_count':
            original=w.transport.count
            def count(request,*args,**kw):
                if request.metadata.step_id=='selection_2':crash()
                return original(request,*args,**kw)
            patch.setattr(w.transport,'count',count)
        elif boundary=='unapplied_result':
            original=s.stage_general_product
            def stage(cap,receipt,phase='selection'):
                if phase=='selection_2':crash()
                return original(cap,receipt,phase)
            patch.setattr(s,'stage_general_product',stage)
        with pytest.raises(RuntimeError,match='controlled interruption'):
            finish_safe_visits(context,w,q.run.id)
    aid=s.get_conversation(p,ws,cv.id).assignment_ids[0]
    a=s.get_responsibility(p,ws,aid)
    s.control_responsibility(p,ws,aid,cmd(ControlResponsibility,expected_work_version=a.assignment.work_version,operation='pause'))
    before=journal(s,ws,q.run.id);budget=totals(s,g);calls=list(fake.calls)
    with s.db.transaction() as c:
        assert has_unresolved_attempt(c,ws,cv.id)  # No automatic bypass of a live run.
    cv=s.get_conversation(p,ws,cv.id).conversation
    if boundary not in ('settled','prepared_step'):
        raises('action_unresolved',lambda:post(context,cv,'Keep my saved work; answer a new question.'))
        assert journal(s,ws,q.run.id)==before and totals(s,g)==budget and fake.calls==calls
        assert s.get_run(p,ws,q.run.id).state=='running'
        return
    new=post(context,cv,'Keep the paused handover and answer a new question.')
    assert new.run.id!=q.run.id and s.get_run(p,ws,q.run.id).state=='cancelled'
    assert journal(s,ws,q.run.id)==before and totals(s,g)==budget and fake.calls==calls
    assert s.get_conversation(p,ws,cv.id).assignment_ids==[aid]
    assert s.get_responsibility(p,ws,aid).lifecycle.state=='paused'
    # A stale worker cannot resume the old tool chain after human supersession.
    w.work(p,ws,q.run.id)
    assert fake.calls==calls and journal(s,ws,q.run.id)==before
    newfake=AlphaProvider([{'kind':'reply','text':'Fresh answer, no duplicate handover.'}])
    resumed=worker(context,newfake,tmp_path);resumed.phases.transport._client.timeout=httpx.Timeout(.1)
    assert finish_safe_visits(context,resumed,new.run.id).state=='ready'
    assert s.get_conversation(p,ws,cv.id).assignment_ids==[aid]
    assert journal(s,ws,q.run.id)==before
    assert totals(s,g)['unknown_usage_steps']==0
