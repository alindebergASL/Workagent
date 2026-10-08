"""Explicit saved-tool reuse inside a model conversation is not inference fallback."""
import pytest
from test_domain import context,cmd,raises
from test_conversations import conversation,post
from test_general_responses import activate,Provider,worker,totals
from workagent.models import PostMessage,HumanSave
from workagent.product_models import RunWasm
from workagent.general_worker import GeneralWorker,ControlledTransport


def ready(ctx,path):
    s,p,ws,_,_=ctx
    cv=conversation(ctx);grant=activate(ctx,[cv],max_runs=1);fake=Provider()
    q=post(ctx,cv,'Build an invoice calculator.')
    worker(ctx,fake,path).work(p,ws,q.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    result=next(r for r in detail.messages[-1].result.results if r.kind=='tool')
    artifact=s.get_artifact(p,ws,result.artifact_id)
    op=RunWasm(kind='run_wasm',artifact_id=artifact.id,base_revision_id=artifact.current_revision_id,entrypoint='total',arguments=[4,1250],input_form=artifact.current_revision.body.input_form)
    return detail,grant,fake,artifact,op


def send(ctx,detail,op):
    s,p,ws,*_=ctx
    return s.post_message(p,ws,detail.conversation.id,cmd(PostMessage,expected_work_version=detail.conversation.work_version,text='Run my saved tool.',operation=op))


def test_explicit_run_of_saved_model_tool_has_no_provider_io_or_budget_reset(context,tmp_path):
    s,p,ws,_,_=context
    d,g,fake,a,op=ready(context,tmp_path);before=totals(s,g);calls=list(fake.calls)
    edited=a.current_revision.body.model_copy(update={'notes':['Human note preserved']})
    saved=s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=edited))
    op=op.model_copy(update={'base_revision_id':saved.current_revision_id})
    q=send(context,d,op)
    assert q.run.profile=='general-products-controlled-v1'
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
    after=s.get_conversation(p,ws,d.conversation.id)
    result=next(r for r in after.messages[-1].result.results if r.kind=='tool')
    observed=s.get_product_observation(p,ws,result.observation_id).observation
    assert observed.output.value==5000 and observed.model_selection is None
    assert result.proposal_id and s.get_artifact(p,ws,a.id).current_revision_id==saved.current_revision_id
    assert s.proposals(p,ws,a.id).items[0].body.notes==['Human note preserved']
    assert totals(s,g)==before and fake.calls==calls
    # Exhausted model allowance is still exhausted; explicit local work does not renew it.
    raises('budget_exhausted',lambda:post(context,after.conversation,'Generate a new calculator.'))


@pytest.mark.parametrize('case',['new_tool','replacement_code','stale_revision','revoked'])
def test_saved_tool_reuse_cannot_bypass_existing_authority(context,tmp_path,case):
    s,p,ws,_,admin=context
    d,g,_,a,op=ready(context,tmp_path)
    code='unsupported_operation'
    if case=='new_tool':op=op.model_copy(update={'artifact_id':None,'base_revision_id':None,'code':a.current_revision.body.code})
    elif case=='replacement_code':op=op.model_copy(update={'code':a.current_revision.body.code})
    elif case=='stale_revision':
        s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=a.current_revision.body))
        code='version_conflict'
    else:
        from workagent.db import Database
        from workagent.provider_attempts import revoke_grant
        revoke_grant(Database(admin),g.id);code='action_unresolved'
    before=totals(s,g)
    raises(code,lambda:send(context,d,op))
    assert totals(s,g)==before
    assert len(s.get_conversation(p,ws,d.conversation.id).runs)==1
