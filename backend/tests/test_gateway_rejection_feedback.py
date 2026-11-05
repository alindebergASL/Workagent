"""Restricted real-PG, scripted choices. Not live model acceptance."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
import pytest
import psycopg
from test_domain import context
from test_conversations import conversation, post
from test_memory_full_tools import activated
from test_run_output_workflow import install_workflow
from test_workspace_files_pg import text
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_runtime import expire
from test_local_rejection_settlement import journal
from workagent.responses_ledger import Ledger
from workagent.errors import DomainError
from workagent.db import Database

from test_local_rejection_settlement import readiness_document
LEGACY={'kind':'publish_artifact','target':None,'body':readiness_document()}

def prepare(ctx):
    s,p,ws,_,_=ctx;cv=conversation(ctx);pg=activated(ctx,cv,'off')
    q=post(ctx,cv,'Create a useful draft with available tools.')
    g=install_workflow(ctx,cv,q,pg)
    return cv,q,g

def reject_then_allowed():
    return AlphaProvider([LEGACY,{'kind':'files_create_draft','source':text('Authorized draft').model_dump()},
        {'kind':'reply','text':'An authorized draft is retained.'}])

def test_rejected_legacy_continues_without_effect_and_survives_restart(context,tmp_path):
    s,p,ws,_,_=context;cv,q,g=prepare(context);fake=reject_then_allowed()
    def hook(name):
        if name=='after_tool_result':raise InterruptedError('retained rejection')
    with pytest.raises(InterruptedError):
        finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    events=journal(s,ws,q.run.id);rejected=events['selection','tool_result']
    assert rejected['status']=='rejected' and rejected['terminal_outcome']=='continue'
    assert rejected['decision']==LEGACY and rejected['body'] is None
    assert rejected['verification']['satisfied'] is False
    assert not s.get_conversation(p,ws,cv.id).artifact_ids
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    with s.db.transaction() as c:
        attempts=c.execute('SELECT capability_id FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchall()
        stages=c.execute("SELECT e.phase FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result'",(q.run.id,)).fetchall()
    assert [a['capability_id'] for a in attempts]==['files.create_draft']
    assert len([r for r in stages if r['phase']=='selection'])==1
    assert journal(s,ws,q.run.id)['selection','tool_result']==rejected
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==1
    contexts=[c for c in fake.contexts if c.get('adaptive',{}).get('observations')]
    assert any(c['adaptive']['observations'][0]['diagnostic']['code']=='gateway_operation_rejected' for c in contexts)
    before=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==before

@pytest.mark.parametrize('forgery',['material','observed','capability','completion','decision','binding','omitted_null'])
def test_raw_forged_rejection_denied(context,tmp_path,monkeypatch,forgery):
    s,p,ws,_,_=context;cv,q,g=prepare(context);fake=reject_then_allowed()
    original=Ledger.event
    def event(self,c,phase,kind,data):
        if kind=='tool_result' and phase=='selection':
            data=deepcopy(data)
            if forgery=='material':data['body']=LEGACY['body']
            elif forgery=='observed':data['status']='observed'
            elif forgery=='capability':data['capability_result']={'forged':True}
            elif forgery=='completion':data['terminal_outcome']='completed'
            elif forgery=='decision':data['decision']['body']['title']='Substituted'
            elif forgery=='binding':data['binding']['selection_response_id']='resp_wrong'
            elif forgery=='omitted_null':del data['file']
        return original(self,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',event)
    with pytest.raises(psycopg.Error):finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert ('selection','tool_result') not in journal(s,ws,q.run.id)
    assert not s.get_conversation(p,ws,cv.id).artifact_ids

@pytest.mark.parametrize('change',['revoke','descriptor'])
def test_replay_keeps_current_authority(context,tmp_path,change):
    s,p,ws,_,admin=context;cv,q,g=prepare(context);fake=reject_then_allowed()
    def hook(name):
        if name=='after_tool_result':raise InterruptedError('retained rejection')
    with pytest.raises(InterruptedError):finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    before=journal(s,ws,q.run.id);calls=list(fake.calls);expire(context,q.run.id)
    with Database(admin).transaction() as c:
        if change=='revoke':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
        else:c.execute("UPDATE capability_installations SET enabled=false WHERE id='files.create_draft'")
    try:
        with pytest.raises((DomainError,psycopg.Error)):
            finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
        assert journal(s,ws,q.run.id)==before and fake.calls==calls
    finally:
        if change=='descriptor':
            with Database(admin).transaction() as c:c.execute("UPDATE capability_installations SET enabled=true WHERE id='files.create_draft'")

def test_repeated_denials_terminate_without_publication(context,tmp_path):
    s,p,ws,_,_=context;cv,q,g=prepare(context);fake=AlphaProvider([LEGACY]*3)
    result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='partial'
    events=journal(s,ws,q.run.id)
    assert events['selection_3','tool_result']['terminal_outcome']=='step_limit'
    assert not s.get_conversation(p,ws,cv.id).artifact_ids
