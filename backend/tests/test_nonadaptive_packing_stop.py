"""Non-adaptive packing rejection is durable and never a running spinner."""
import pytest
from test_domain import context
from test_general_responses import setup,attach
from test_conversations import post
from workagent.responses_ledger import summary


@pytest.mark.parametrize('phase',['selection','final'])
def test_nonadaptive_packing_stop_is_terminal_and_preserves_send_state(context,tmp_path,monkeypatch,phase):
    import workagent.request_packing as packing
    s,p,ws,_,_=context
    cv,grant,fake,q,w=setup(context,tmp_path)
    with monkeypatch.context() as patch:
        if phase=='selection':
            patch.setattr(packing,'_GROWTH_HEADROOM',50000)
        else:
            original=packing.check_final
            patch.setattr(packing,'check_final',lambda request:original(request,input_limit=2000))
        result=w.work(p,ws,q.run.id)
    assert result.state=='partial' and result.stop_reason=='budget_limit'
    calls=list(fake.calls)
    assert w.work(p,ws,q.run.id).state=='partial' and fake.calls==calls
    with s.db.transaction() as c:
        attempt=c.execute('SELECT id,data,abandonment_reason FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()
        steps=c.execute('SELECT phase FROM responses_steps WHERE attempt_id=%s',(attempt['id'],)).fetchall()
        events=c.execute('SELECT kind FROM responses_events WHERE attempt_id=%s',(attempt['id'],)).fetchall()
    if phase=='selection':
        assert not calls and not steps and not events
        assert attempt['data']['state']=='failed' and attempt['abandonment_reason']=='unsent_abandoned'
        fresh=s.get_conversation(p,ws,cv.id).conversation
        queued=post(context,fresh,'A fresh bounded request.',attachments=[attach()])
        assert w.work(p,ws,queued.run.id).state=='ready'
    else:
        assert [r['phase'] for r in steps]==['selection']
        assert any(r['kind']=='result' for r in events)
        assert attempt['data']['state']!='failed' and attempt['abandonment_reason'] is None
