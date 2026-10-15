"""Known target-denied selections are not pending model work or new capacity."""

import pytest
from test_domain import context
from test_conversations import conversation,post
from test_responsibilities import product
from test_general_alpha_runtime import activate,AlphaProvider
from test_general_responses import worker,target,totals
from workagent.execution_status import read
from workagent.responses_dispatcher import ResponsesDispatcher


@pytest.mark.parametrize('mismatch',['missing','different'])
@pytest.mark.parametrize('kind',['publish_artifact','run_wasm'])
def test_explicit_target_denial_is_quarantined_without_replaying(context,tmp_path,monkeypatch,mismatch,kind):
    s,p,ws,_,_=context;cv=conversation(context);artifact,_=product(context,cv)
    cv=s.get_conversation(p,ws,cv.id).conversation;g=activate(context,cv)
    exact=target(artifact)
    selected=None if mismatch=='missing' else {**exact.model_dump(),'body_hash':'0'*64}
    body={'title':'Synthetic companion','blocks':[{'block_id':'b','kind':'paragraph','text':'A new draft, not an edit.','checked':None}]}
    decision={'kind':kind,'target':selected}
    if kind=='publish_artifact':decision['body']=body
    else:decision.update(code='(module (func (export "main") (result i64) i64.const 1))',entrypoint='main',arguments=[],input_form=[])
    fake=AlphaProvider([decision])
    q=post(context,cv,'Make a different presentation without changing the selected work.',target=exact)
    w=worker(context,fake,tmp_path);path=tmp_path/'execution.json'
    dispatcher=ResponsesDispatcher(w,workspace=ws,grant_id=g.id,status_path=path)
    dispatcher.once()
    detail=s.get_conversation(p,ws,cv.id);turn=next(t for t in detail.turns if t.run_id==q.run.id)
    assert turn.provider_observation=='invalid' and turn.state=='unavailable'
    status=read(s,p,ws,str(path));observed=next(r for r in status.runs if r.run_id==q.run.id)
    assert observed.state=='blocked' and observed.failure_category=='invalid_response'
    assert not status.can_advance_authorized_work
    before=totals(s,g);calls=list(fake.calls)
    with s.db.transaction() as c:
        events=c.execute('SELECT e.* FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.id',(q.run.id,)).fetchall()
        # The received parse result stays function_call: this is read-only policy
        # classification, not a rewritten receipt or a settlement of failed work.
        assert next(e['data']['state'] for e in events if e['kind']=='result')=='function_call'
    def forbidden(*args,**kwargs):raise AssertionError('quarantined work must not be visited again')
    monkeypatch.setattr(w,'work',forbidden)
    result=dispatcher.once()
    assert any(r['run_id']==q.run.id and r['status']=='invalid_response' for r in result['results'])
    assert fake.calls==calls and totals(s,g)==before
    assert s.get_artifact(p,ws,artifact.id).current_revision_id==artifact.current_revision_id
    with s.db.transaction() as c:
        assert c.execute('SELECT e.* FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.id',(q.run.id,)).fetchall()==events
