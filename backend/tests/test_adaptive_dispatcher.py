"""A saved partial result must not kill the watcher for the NEXT human command."""
from types import SimpleNamespace
import pytest
from test_domain import context
from test_conversations import post
from test_adaptive_execution import setup
from workagent.responses_dispatcher import ResponsesDispatcher, serve, general_dispatch_status


def test_two_human_turns_after_needs_review(context,tmp_path,monkeypatch):
    s,p,ws,_,_=context
    cv,grant,fake,queued,worker=setup(context,tmp_path)
    dispatcher=ResponsesDispatcher(worker,workspace=ws,grant_id=grant.id)
    polls=[]
    def pause(_):
        polls.append(True)
        if len(polls)==1:
            d=s.get_conversation(p,ws,cv.id)
            assert len(d.messages)==2 and d.turns[0].retained_local_result.published
            assert d.runs[0].state=='partial'
            post(context,d.conversation,'Build another total calculator. Check it locally.')
        else:
            raise StopIteration
    monkeypatch.setattr('time.sleep',pause)
    with pytest.raises(StopIteration):serve(dispatcher,lambda:None,0.1)
    d=s.get_conversation(p,ws,cv.id)
    assert len(d.messages)==4 and len(d.runs)==2
    assert all(t.adaptive.outcome=='needs_validation' for t in d.turns)
    assert all(t.retained_local_result.published for t in d.turns)
    assert len(fake.contexts)==6


@pytest.mark.parametrize('override,expected',[
    ({},'result_needs_review'),
    ({'provider_observation':'outcome_unknown'},'outcome_unknown'),
    ({'provider_observation':'invalid'},'invalid_response'),
    ({'state':'cancelled'},'cancelled'),
    ({'outcome':'budget_limit'},'local_tool_rejected'),
    ({'published':False},'local_tool_rejected'),
    ({'local_status':'rejected'},'local_tool_rejected'),
    ({'receipt_state':'accepted'},'local_tool_rejected'),
    ({'adaptive':False},'local_tool_rejected'),
])
def test_only_confirmed_partial_publication_keeps_watcher(override,expected):
    run=SimpleNamespace(state=override.get('state','partial'))
    observation=SimpleNamespace(provider_observation=override.get('provider_observation','received'),
        adaptive=SimpleNamespace(outcome=override.get('outcome','needs_validation')) if override.get('adaptive',True) else None,
        retained_local_result=SimpleNamespace(status=override.get('local_status','observed'),published=override.get('published',True)),
        response_steps=[SimpleNamespace(state=override.get('receipt_state','received'))])
    assert general_dispatch_status(run,observation)==expected


def test_operator_status_separates_local_and_shared_carry(context):
    from test_conversations import conversation
    from test_adaptive_execution import activate
    from workagent.db import Database
    from workagent.budget_carryforward import install_carry
    from workagent.responses_dispatcher import general_status
    s,p,ws,_,admin=context
    install_carry(Database(admin),project_id='proj_'+ws,transport_mode='synthetic',
        source_database='earlier_synthetic_database',source_grant_id='earlier-'+ws,
        source_manifest_sha256='a'*64,reserved_cost_usd='1.583040')
    grant=activate(context,conversation(context))
    actual=general_status(s.db,ws,grant.id)
    assert actual['budget']['reserved_cost_usd']=='0'
    assert actual['shared_budget']['reserved_cost_usd']=='1.583040'
    assert actual['shared_budget']['carried_reserved_cost_usd']=='1.583040'
