"""Strict schema rejection recovery: actual restricted PG, synthetic HTTP only."""
from copy import deepcopy
from hashlib import sha256
import json
import pytest
from test_domain import context
from test_gateway_rejection_feedback import prepare
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_local_rejection_settlement import journal
from test_runtime import expire

TEXT='Rejected, unexecuted text: café\nSecond line.\n'
BAD={'kind':'files_create_draft','source':{'kind':'text','content':TEXT,'sha256':'0'*64,
    'filename':'recovered.txt','mime_type':'text/plain'}}

def good(ctx):
    observation=ctx['adaptive']['observations'][-1]
    assert observation['kind']=='selection_rejection'
    assert observation['status']=='rejected_unexecuted'
    hint=observation['feedback']['generated_text']
    assert hint['content']==TEXT and hint['sha256']==sha256(TEXT.encode()).hexdigest()
    d=deepcopy(BAD);d['source']['sha256']=hint['sha256']
    return d

def test_worker_strict_rejection_restart_new_selection_no_duplicate(context,tmp_path):
    s,p,ws,_,_=context;cv,q,g=prepare(context)
    fake=AlphaProvider([BAD,good,{'kind':'reply','text':'A new validated draft is saved.'}])
    def hook(name):
        if name=='after_selection_rejection':raise InterruptedError('observation retained')
    with pytest.raises(InterruptedError):
        finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    before=journal(s,ws,q.run.id)
    assert before['selection','result']['state']=='malformed'
    assert ('selection','tool_result') not in before
    assert not s.get_conversation(p,ws,cv.id).artifact_ids
    expire(context,q.run.id)
    result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='ready'
    after=journal(s,ws,q.run.id)
    assert all(after[k]==v for k,v in before.items())
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==1
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['n']==1
        checkpoints=c.execute('SELECT data FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchall()
        assert checkpoints and all(r['data']['waiting']!='unknown' and r['data']['next_safe_action']!='reconcile' for r in checkpoints)
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==calls

def test_exhausted_actual_phases_partial_schema_not_budget(context,tmp_path):
    s,p,ws,_,_=context;cv,q,g=prepare(context)
    fake=AlphaProvider([BAD]*3)
    result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='partial' and result.stop_reason=='step_limit'
    assert any('schema' in reason.lower() for reason in result.unresolved)
    events=journal(s,ws,q.run.id)
    assert events['selection_3','selection_rejection']['terminal_outcome']=='step_limit'
    assert not any(k[1]=='tool_result' for k in events)
    assert not s.get_conversation(p,ws,cv.id).artifact_ids
    calls=list(fake.calls)
    with s.db.transaction() as c:
        cp=c.execute("SELECT data FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s AND phase='final'",(ws,q.run.id)).fetchone()['data']
        assert cp['waiting']!='unknown' and cp['next_safe_action']!='reconcile'
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert fake.calls==calls
