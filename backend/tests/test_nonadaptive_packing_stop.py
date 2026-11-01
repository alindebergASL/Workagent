"""Packing estimates do not stop authorized non-adaptive execution before counting."""
import pytest
from test_domain import context
from test_general_responses import setup,attach
from test_conversations import post
from workagent.responses_ledger import summary
from retained_read_visits import finish_natural_visits


@pytest.mark.parametrize('phase',['selection','final'])
def test_nonadaptive_estimate_preserves_exact_count_and_terminal_state(context,tmp_path,monkeypatch,phase):
    import workagent.request_packing as packing
    s,p,ws,_,_=context
    cv,grant,fake,q,w=setup(context,tmp_path)
    with monkeypatch.context() as patch:
        if phase=='selection':
            patch.setattr(packing,'_GROWTH_HEADROOM',50000)
        else:
            original=packing.check_final
            patch.setattr(packing,'check_final',lambda request:original(request,input_limit=2000))
        result=finish_natural_visits(context,w,q.run.id)
    assert result.state=='ready' and result.stop_reason is None
    calls=list(fake.calls)
    assert w.work(p,ws,q.run.id).state=='ready' and fake.calls==calls
    with s.db.transaction() as c:
        attempt=c.execute('SELECT id,data,abandonment_reason FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()
        steps=c.execute('SELECT phase,request_sha256,count_sha256 FROM responses_steps WHERE attempt_id=%s',(attempt['id'],)).fetchall()
        events=c.execute('SELECT phase,kind,data FROM responses_events WHERE attempt_id=%s',(attempt['id'],)).fetchall()
    assert {r['phase'] for r in steps}=={'selection','final'}
    by_key={(e['phase'],e['kind']):e['data'] for e in events}
    for step in steps:
        for kind in ('count_send','count_result','dispatch','identity','result'):
            assert (step['phase'],kind) in by_key
        assert by_key[step['phase'],'count_result']['count_sha256']==step['count_sha256']
        assert by_key[step['phase'],'result']['request_sha256']==step['request_sha256']
    assert attempt['data']['state']!='failed' and attempt['abandonment_reason'] is None
