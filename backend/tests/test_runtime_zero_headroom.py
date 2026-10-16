"""An operational successor adds no spend or inference capacity."""
from test_domain import context, cmd
from test_responsibilities import conversation
from test_responsibility_execution import activate, dispatch
from test_general_alpha_runtime import AlphaProvider
from workagent.models import PostMessage, ProviderGrant, new_id
from workagent.provider_attempts import configure_grant
from workagent.responses_ledger import summary
from workagent.db import Database



def test_successor_at_consumed_limits_preserves_history_and_cannot_infer(context,tmp_path):
    s,p,ws,_,admin=context
    cv=conversation(context);g=activate(context,cv)
    turn=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Explain this synthetic constraint.'))
    d,fake,w=dispatch(context,tmp_path,g,AlphaProvider([{'kind':'reply','text':'A bounded explanation.'}]))
    assert d.once()['results']==[{'run_id':turn.run.id,'status':'completed'}]
    with s.db.transaction() as c:
        before=summary(c,g.id,shared=True)
        binding=c.execute('SELECT data FROM run_configurations WHERE run_id=%s',(turn.run.id,)).fetchone()['data']
    b=before['request_counts'];data=g.model_dump(mode='json');data['id']=new_id()
    data['responses'].update(generation_limit=b['dispatch'],count_limit=b['count_send'],read_limit=b['read'],
        input_limit=before['reserved_input_tokens'],output_limit=before['reserved_output_tokens'],
        cost_limit_usd=before['reserved_cost_usd'])
    successor=configure_grant(Database(admin),ProviderGrant.model_validate(data),predecessor_id=g.id)
    with s.db.transaction() as c:
        assert summary(c,successor.id,shared=True)==before
        assert c.execute('SELECT data FROM run_configurations WHERE run_id=%s',(turn.run.id,)).fetchone()['data']==binding
        assert c.execute('SELECT data,active FROM provider_grants WHERE id=%s',(g.id,)).fetchone()=={'data':g.model_dump(mode='json'),'active':False}
    detail=s.get_conversation(p,ws,cv.id)
    # Admission may retain a request; that is NOT inference capacity. The real
    # worker must stop it canonically without any count, generation or read.
    blocked=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=detail.conversation.work_version,text='This must not call the provider.'))
    d2,_,_=dispatch(context,tmp_path/'successor',successor,AlphaProvider([]))
    result=d2.once()
    assert result['results']==[{'run_id':blocked.run.id,'status':'budget_limit'}]
    with s.db.transaction() as c:
        assert summary(c,successor.id,shared=True)==before
        assert c.execute('SELECT data FROM run_configurations WHERE run_id=%s',(turn.run.id,)).fetchone()['data']==binding
