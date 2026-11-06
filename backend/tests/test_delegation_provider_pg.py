"""Unknown parent-provider outcome cannot duplicate its actual child launch."""
from unittest.mock import patch
from test_domain import context
from test_conversations import conversation
from test_delegation_pg import setup
from test_delegation_worker_pg import verifier
from test_general_alpha_runtime import activate,AlphaProvider
from test_general_responses import worker
from test_runtime import expire
from workagent.capabilities.delegation_composition import POLICY,SCHEMA


def test_unknown_parent_provider_after_child_no_replay(context,tmp_path):
    s,p,ws,_,_=context;cv=conversation(context)
    with patch('test_general_alpha_runtime.POLICY',POLICY),patch('test_general_alpha_runtime.DECISION_SCHEMA',SCHEMA):
        pg=activate(context,cv,continuity_version='sustained-v1',max_steps=3)
    _,g,q,requests=setup(context,cv=cv,claim=False,provider_grant_id=pg.id)
    fake=AlphaProvider([requests[0].model_dump(),verifier(0)],lose_phase='selection_2')
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='running'
    calls=list(fake.calls);expire(context,q.run.id)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='running'
    assert fake.calls==calls
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) AS n FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND capability_id='delegation.analysis'",(ws,q.run.id)).fetchone()['n']==1
        assert not c.execute('SELECT delegation_reviewed(%s,%s) AS ok',(ws,q.run.id)).fetchone()['ok']
        assert c.execute("SELECT count(*) AS n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.phase='selection_2' AND e.kind='dispatch'",(q.run.id,)).fetchone()['n']==1
        assert not c.execute("SELECT 1 FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.phase='selection_2' AND e.kind='result'",(q.run.id,)).fetchone()
