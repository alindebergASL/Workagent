"""Restricted PG + actual worker, controlled provider only: derived source revocation."""
import secrets
from datetime import timedelta
from unittest.mock import patch
import pytest
import psycopg
from fastapi.testclient import TestClient
from test_domain import context
from test_conversations import post
from test_workspace_files_pg import make
from test_research_pg import capture_request, material
from test_standing_admission import standing_grant
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_runtime import expire
from workagent.api import Settings, create_app
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import new_id, now
from workagent.provider_attempts import configure_grant
from workagent.capabilities import registry, policy, research_adapters as R
from workagent.capabilities.models import ToolGrantV1, CapabilityPin
from workagent.capabilities.research_composition import POLICY, SCHEMA
from workagent.responses_ledger import Ledger, RESERVED_INPUT, RESERVED_OUTPUT, RESERVED_COST
from workagent.service import encoded


def grant(ctx, q, requests):
    s,p,ws,_,admin=ctx
    ds=[registry.adapters()[n].descriptor for n in dict.fromkeys(R.IDS[r.kind] for r in requests)]
    refs=list({r.model_dump_json():r for req in requests for r in R.input_refs(req)}.values())
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=q.conversation.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=refs,effects=['read'],privacy_classes=['public','workspace_private'],egress='public_https',
        expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),g,limits={'search':20,'extraction':20})
    return g


def records(s,ws):
    with s.db.transaction() as c:
        return {table:c.execute(f'SELECT to_jsonb(t) AS row FROM {table} t WHERE '+where+' ORDER BY to_jsonb(t)::text', (ws,)).fetchall()
            for table,where,order in [('tool_attempt_events','attempt_id IN (SELECT id FROM tool_attempts WHERE workspace_id=%s)','id'),
              ('tool_cost_entries','attempt_id IN (SELECT id FROM tool_attempts WHERE workspace_id=%s)','id'),
              ('responses_events','attempt_id IN (SELECT id FROM provider_attempts WHERE workspace_id=%s)','id')]}


def setup_runs(ctx,tmp_path,monkeypatch,*,document=False):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1')
    from workagent import public_retrieval
    monkeypatch.setattr(public_retrieval,'fetch_public_source',lambda url,**kw:material(url,'Revocable unique source quotation.'))
    s,p,ws,_,admin=ctx
    if document:
        from test_work_area_context import saved
        cv,art=saved(ctx);artifact_id=art.id
    else:
        cv,file,_=make(ctx,'Human conclusion must remain.');artifact_id=file.workspace_file_id
    with patch('test_alpha_budget.POLICY',POLICY),patch('test_alpha_budget.DECISION_SCHEMA',SCHEMA):
        pg=standing_grant(ctx,continuity_version='sustained-v1',max_steps=4)
    configure_grant(Database(admin),pg)
    cv=s.get_conversation(p,ws,cv.id).conversation
    req=capture_request();a=post(ctx,cv,'Capture the public evidence.');ga=grant(ctx,a,[req])
    fake=AlphaProvider([req.model_dump(),dict(kind='reply',text='Captured synthetic source.')])
    assert finish_safe_visits(ctx,worker(ctx,fake,tmp_path/'a'),a.run.id).state=='ready'
    with s.db.transaction() as c:
        snap=c.execute('SELECT data FROM source_snapshots WHERE workspace_id=%s',(ws,)).fetchone()['data']
    art=s.get_artifact(p,ws,artifact_id);text=snap['locator']['text']
    cite=R.ResearchCite(kind='research_cite',artifact_id=art.id,revision_id=art.current_revision_id,body_hash=art.current_revision.body_hash,
        claim='Attribution only',evidence=[dict(workspace_file_id=snap['workspace_file_id'],snapshot_id=snap['snapshot_id'],
        text_sha256=snap['extraction_sha256'],start=0,end=len(text),quote=text,relation='supports')])
    return cv,ga,cite,art,text


@pytest.mark.parametrize('boundary',['after_tool_result','prepared','counted'])
def test_capture_a_cite_b_revoke_a_blocks_observations_and_next_send(context,tmp_path,monkeypatch,boundary):
    s,p,ws,_,admin=context;cv,ga,cite,art,text=setup_runs(context,tmp_path,monkeypatch)
    cv=s.get_conversation(p,ws,cv.id).conversation
    b=post(context,cv,'Cite the retained source, then explain.');gb=grant(context,b,[cite])
    fake=AlphaProvider([cite.model_dump(),dict(kind='reply',text='Never sent after revocation.')]);saved={}
    original=Ledger.prepare
    def prepare(self,request,cap):
        original(self,request,cap)
        if request.phase=='selection_2':
            saved.update(ledger=self,request=request,cap=cap)
            if boundary=='prepared':raise SystemExit('controlled prepared boundary')
    monkeypatch.setattr(Ledger,'prepare',prepare)
    def hook(point):
        if point=='after_tool_result' and boundary=='after_tool_result':raise SystemExit('controlled retained boundary')
        if point=='after_count' and boundary=='counted' and saved:raise SystemExit('controlled counted boundary')
    with pytest.raises(SystemExit):worker(context,fake,tmp_path/'b',hook=hook).work(p,ws,b.run.id)
    with s.db.transaction() as c:
        aid=c.execute("SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s",(ws,b.run.id)).fetchone()['id']
    token=secrets.token_urlsafe(32);headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()}
    paths=[f'/v1/workspaces/{ws}/runs/{b.run.id}/tool-attempts',f'/v1/workspaces/{ws}/tool-attempts/{aid}']
    with TestClient(create_app(Settings(s.db.dsn,True,token,p.id))) as http:
        for path in paths:
            response=http.get(path,headers=headers);assert response.status_code==200 and text in response.text
        before=records(s,ws);calls=list(fake.calls)
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(ga.id,))
        with s.db.transaction() as c:
            assert c.execute('SELECT active FROM tool_grants WHERE id=%s',(gb.id,)).fetchone()['active']
        for path in paths:
            response=http.get(path,headers=headers);assert response.status_code==404 and text not in response.text
        if saved:
            ledger,request,cap=[saved[k] for k in ('ledger','request','cap')]
            for op in (lambda:ledger.snapshot(request.phase,cap),lambda:ledger.prepare(request,cap),
                       lambda:ledger.reserve_operation(request,'count_send',cap),lambda:ledger.reserve_operation(request,'dispatch',cap)):
                with pytest.raises(DomainError,match='not_found_or_not_authorized'):op()
            # Direct restricted SQL cannot bypass the same provider-egress guard.
            direct = [('count_send',{'input_token_limit':50000})] if boundary=='prepared' else [('dispatch',dict(reserved_input_tokens=RESERVED_INPUT,
                    reserved_output_tokens=RESERVED_OUTPUT,reserved_cost_usd=str(RESERVED_COST),billed_cost_usd=None))]
            for kind,data in direct:
                with pytest.raises(psycopg.Error,match='research dependency no longer visible'):
                    with s.db.transaction() as c:ledger.event(c,request.phase,kind,data)
        assert records(s,ws)==before, 'Denied reads/sends must not erase immutable receipts or costs'
        expire(context,b.run.id)
        try:worker(context,fake,tmp_path/'b').work(p,ws,b.run.id)
        except DomainError:pass
        assert fake.calls==calls, 'No count or generation after source revoke'
        assert s.get_artifact(p,ws,art.id).current_revision==art.current_revision
        with s.db.transaction() as c:
            from workagent.research import authorize_run_dependencies
            with pytest.raises(DomainError):authorize_run_dependencies(c,ws,b.run.id)


def test_read_result_transitive_checkpoint_dependency_denied_after_revoke(context,tmp_path,monkeypatch):
    s,p,ws,_,admin=context;cv,ga,cite,art,text=setup_runs(context,tmp_path,monkeypatch,document=True)
    cv=s.get_conversation(p,ws,cv.id).conversation;b=post(context,cv,'Cite exact source.');gb=grant(context,b,[cite])
    fake=AlphaProvider([cite.model_dump(),dict(kind='reply',text='Citation retained.')])
    assert finish_safe_visits(context,worker(context,fake,tmp_path/'b'),b.run.id).state=='ready'
    with s.db.transaction() as c:
        row=c.execute("SELECT phase,checkpoint_hash FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s AND phase='selection'",(ws,b.run.id)).fetchone()
    decision=dict(kind='read_result',run_id=b.run.id,phase=row['phase'],operation_hash=row['checkpoint_hash'],offset=0,limit=8192)
    cv=s.get_conversation(p,ws,cv.id).conversation;q=post(context,cv,'Read the retained citation, then explain.')
    copied=AlphaProvider([decision,dict(kind='reply',text='Must not send copied revoked quote.')]);saved={};original=Ledger.prepare
    def prepare(self,request,cap):
        original(self,request,cap)
        if request.phase=='selection_2':saved.update(ledger=self,request=request,cap=cap);raise SystemExit('prepared after read_result')
    monkeypatch.setattr(Ledger,'prepare',prepare)
    with pytest.raises(SystemExit):worker(context,copied,tmp_path/'copy').work(p,ws,q.run.id)
    with s.db.transaction() as c:
        reads=c.execute('SELECT data FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchall()
        assert len(reads)==1 and 'tool_result_sha256' in str(reads[0]['data'])
        assert c.execute('SELECT research_run_dependencies_visible(%s,%s) ok',(ws,q.run.id)).fetchone()['ok']
    calls=list(copied.calls);before=records(s,ws)
    with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(ga.id,))
    with s.db.transaction() as c:
        assert c.execute('SELECT active FROM tool_grants WHERE id=%s',(gb.id,)).fetchone()['active']
        assert not c.execute('SELECT research_run_dependencies_visible(%s,%s) ok',(ws,q.run.id)).fetchone()['ok']
    ledger,request,cap=[saved[k] for k in ('ledger','request','cap')]
    for op in (lambda:ledger.snapshot(request.phase,cap),lambda:ledger.reserve_operation(request,'count_send',cap),lambda:ledger.reserve_operation(request,'dispatch',cap)):
        with pytest.raises(DomainError,match='not_found_or_not_authorized'):op()
    assert records(s,ws)==before
    expire(context,q.run.id)
    try:worker(context,copied,tmp_path/'copy').work(p,ws,q.run.id)
    except DomainError:pass
    assert copied.calls==calls
