"""Remaining exact projection and metadata-only SQL closure controls."""
from unittest.mock import patch
from types import SimpleNamespace
import pytest
import psycopg
from test_domain import context,cmd,raises
from test_conversations import conversation,post
from test_memory_pg import remember
from test_memory_parent_worker import activated
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker,target
from test_adaptive_execution import finish_safe_visits
from workagent.db import Database
from workagent.memory.models import MemoryCAS,CorrectMemory,MemorySource
from workagent.models import HumanSave


@pytest.mark.parametrize('mutation',['forget','correct','revoke'])
def test_supported_proposal_download_exact_observation_and_page_metadata(context,tmp_path,mutation):
    from test_general_products import csvop
    from workagent.general_worker import GeneralWorker,ControlledTransport
    from workagent.service import Service
    s,p,ws,refs,admin=context;cv=conversation(context)
    seed=post(context,cv,'Seed synthetic CSV',operation=csvop())
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,seed.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    from workagent.product_models import TableBody
    a=next(a for aid in detail.artifact_ids if isinstance((a:=s.get_artifact(p,ws,aid)).current_revision.body,TableBody))
    a=s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=a.current_revision.body))
    original=a.current_revision
    root,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])]);activated(context,cv)
    q=post(context,detail.conversation,'Reconcile saved CSV',target=target(a))
    fake=AlphaProvider([{'kind':'reconcile_csv','attachment':None,'target':target(a).model_dump(mode='json'),'rounding':'ROUND_HALF_EVEN'},{'kind':'reply','text':'Done'}])
    finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    proposal=s.proposals(p,ws,a.id).items[0]
    assert s.download_product(p,ws,a.id,proposal_id=proposal.id).content
    with s.db.transaction() as c:
        oid=c.execute('SELECT id FROM product_observations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['id']
    assert s.get_product_observation(p,ws,oid)
    if mutation=='forget':s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    elif mutation=='correct':s.correct_memory(p,ws,root.memory_id,cmd(CorrectMemory,expected_revision_id=root.revision_id,content='Corrected preference'))
    else:
        with Database(admin).transaction() as c:c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    s=Service(s.db)
    raises('not_found_or_not_authorized',lambda:s.download_product(p,ws,a.id,proposal_id=proposal.id))
    raises('not_found_or_not_authorized',lambda:s.get_product_observation(p,ws,oid))
    page=s.proposals(p,ws,a.id,limit=1);assert page.items==[] and page.next_cursor is None
    with s.db.transaction() as c:
        row,owner=s._artifact(c,p,ws,a.id)
        assert s._latest_review_candidate(c,p,ws,row,owner) is None
        with pytest.raises(Exception):s._proposal(c,p,ws,proposal.id)
    assert s.get_artifact(p,ws,a.id).current_revision==original


@pytest.mark.parametrize('boundary',['count_send','dispatch','publication','retained_metadata'])
def test_metadata_only_valid_sql_egress_before_and_denied_after_reduction(context,tmp_path,monkeypatch,boundary):
    from test_github_pg import G,response,discover,install,execute,reduce
    from test_research_pg import finish
    from test_standing_admission import standing_grant
    from workagent.provider_attempts import configure_grant
    from workagent.capabilities.github_composition import POLICY,SCHEMA
    from workagent.responses_ledger import Ledger,MAX_INPUT_TOKENS,RESERVED_INPUT,RESERVED_OUTPUT,RESERVED_COST
    s,p,ws,_,admin=context;cv=conversation(context);req=discover()
    monkeypatch.setattr(G,'fetch',lambda request:response([{'number':1,'title':'Metadata only revocable canary'}]))
    cap,g,q=install(context,cv,[req]);execute(s,cap,q,req);cv=finish(context,cap,cv)
    with patch('test_alpha_budget.POLICY',POLICY),patch('test_alpha_budget.DECISION_SCHEMA',SCHEMA):pg=standing_grant(context,continuity_version='sustained-v1',max_steps=4)
    configure_grant(Database(admin),pg);q2=post(context,s.get_conversation(p,ws,cv.id).conversation,'Use metadata')
    retained=boundary=='retained_metadata'
    next_decision={'kind':'reply','text':'Never dispatched after reduction'}
    if retained:
        ancestor=q2
        finish_safe_visits(context,worker(context,AlphaProvider([{'kind':'reply','text':'Metadata only ancestor'}]),tmp_path/'ancestor'),ancestor.run.id)
        with s.db.transaction() as c:
            assert not c.execute('SELECT 1 FROM tool_attempts WHERE workspace_id=%s AND run_id=%s',(ws,ancestor.run.id)).fetchone()
            cp=c.execute("SELECT checkpoint_hash FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s AND phase='selection'",(ws,ancestor.run.id)).fetchone()
        next_decision=dict(kind='read_result',run_id=ancestor.run.id,phase='selection',operation_hash=cp['checkpoint_hash'],offset=0,limit=8192)
        q2=post(context,s.get_conversation(p,ws,cv.id).conversation,'Read retained metadata only result')
        boundary='count_send'
    captured={};original=Ledger.reserve_operation
    def pause(self,request,kind,cap,**kwargs):
        if kind==boundary and (not retained or request.phase=='selection_2'):
            captured.update(ledger=self,request=request,cap=cap);raise SystemExit('At exact next egress')
        return original(self,request,kind,cap,**kwargs)
    monkeypatch.setattr(Ledger,'reserve_operation',pause)
    fake=AlphaProvider([next_decision])
    w=worker(context,fake,tmp_path)
    if boundary=='publication':
        def stop_publication(name):
            if name=='before_publication':raise SystemExit('At exact publication boundary')
        w.phases.hook=stop_publication
    with pytest.raises(SystemExit):finish_safe_visits(context,w,q2.run.id)
    if boundary=='publication':
        with s.db.transaction() as c:
            c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',(ws,q2.run.id))
        reduce(context,g)
        with pytest.raises(psycopg.Error,match='research dependency'),s.db.transaction() as c:
            c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',(ws,q2.run.id))
        assert s.get_conversation(p,ws,cv.id).messages[-1].author_kind=='human'
        return
    data={'input_token_limit':MAX_INPUT_TOKENS} if boundary=='count_send' else {'reserved_input_tokens':RESERVED_INPUT,'reserved_output_tokens':RESERVED_OUTPUT,'reserved_cost_usd':str(RESERVED_COST),'billed_cost_usd':None}
    ledger=captured['ledger'];phase=captured['request'].phase
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE workspace_id=%s AND run_id=%s',(ws,q2.run.id)).fetchone()
        if retained:assert c.execute('SELECT 1 FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',(ws,q2.run.id)).fetchone()
        assert c.execute('SELECT research_run_dependencies_visible(%s,%s) ok',(ws,q2.run.id)).fetchone()['ok']
        with c.transaction(force_rollback=True):ledger.event(c,phase,boundary,data)
    reduce(context,g)
    with s.db.transaction() as c:
        assert not c.execute('SELECT research_run_dependencies_visible(%s,%s) ok',(ws,q2.run.id)).fetchone()['ok']
        with pytest.raises(psycopg.Error,match='research dependency'),c.transaction():ledger.event(c,phase,boundary,data)
    assert len(fake.contexts)==(1 if retained else 0)
