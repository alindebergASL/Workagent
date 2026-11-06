"""Sole-writer serial PG regression lane. NOT run by the pure correction lane.

Requires a fresh explicitly bound disposable DB through exact 084, including the
083 source-cohort guards and numbered discovery migration. No auto-migration, no
provider sockets: AlphaProvider uses the existing in-process MockTransport.
All authority is new synthetic fixture authority; never use an original store.
"""
from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch
import os
import pytest
import psycopg
from psycopg import sql
from test_domain import context as base_context, fixture_database_urls, cmd
from test_conversations import conversation, post
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker
from retained_read_visits import finish_natural_visits
from test_local_rejection_settlement import journal
from workagent import model_discovery as md
from workagent.adaptive import contract
from workagent.discovery_composition import SCHEMA
from workagent.models import new_id, now, GeneralAlphaResponsesBinding
from workagent.db import Database
from workagent.service import encoded, digest
from workagent.provider_attempts import configure_grant, revoke_grant
from workagent.capabilities import policy, registry
from workagent.capabilities.models import ToolGrantV1, CapabilityPin


@pytest.fixture
def context():
    runtime, owner = fixture_database_urls(os.environ)  # before any DB I/O
    with Database(runtime).transaction() as c:
        migrations = {r['name']:r['checksum'] for r in c.execute('SELECT name,checksum FROM public.schema_migrations').fetchall()}
        expected = {p.name:sha256(p.read_bytes()).hexdigest() for p in (Path(__file__).parents[1]/'migrations').glob('*.sql')}
        assert migrations == expected and len(expected) == 84
        assert c.execute("SELECT to_regprocedure('public.model_discovery_page_v2(text,text,jsonb,jsonb)') IS NOT NULL ok").fetchone()['ok']
    return base_context.__wrapped__()


def authority(ctx, cv, mode='off', sources=()):
    instructions, schema = contract(NS(continuity_version='sustained-v1',memory_recall=mode,
                                      scope_tool_sha256=sha256(SCHEMA.material).hexdigest()))
    def configure(db, grant):
        return configure_grant(db,grant,context_conversation_ids=list(sources) or None)
    with patch('test_general_alpha_runtime.POLICY',instructions), patch('test_general_alpha_runtime.DECISION_SCHEMA',schema), patch('test_general_alpha_runtime.configure_grant',configure):
        return activate(ctx,cv,continuity_version='sustained-v1',memory_recall=mode,max_steps=4)


def tool_authority(ctx, cv, q, pg, names=('files.read_range',)):
    s,p,ws,_,admin=ctx
    adapters=registry.adapters()
    descriptors=[adapters[name].descriptor for name in names]
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in descriptors],
        resource_selectors=[],effects=['read'],privacy_classes=['workspace_private'],egress='none',
        expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),g,limits={'local_compute':4},provider_grant_id=pg.id)
    return g


class BeforeStage(Exception): pass


def capture(ctx,path,*,sources=None,cv=None,pg=None,decision=None,decisions=None,source_text=None):
    """Produce real selection/receipt/stage payloads with a rolled-back receipt.

    No fabricated selection, request, binding, scope or alpha metadata. The real
    receipt INSERT guard runs in a force-rollback savepoint as a positive control.
    Receipt and stage use separate production transactions; aborting only the
    stage transaction would leave a committed receipt and invalidate negatives.
    """
    s,p,ws,_,_=ctx
    if sources is None:
        sources=[]
        for suffix in ('one','two'):
            other=conversation(ctx);post(ctx,other,(source_text if source_text is not None else 'x'*260+' needle ')+suffix)
            sources.append(other.id)
    cv=cv or conversation(ctx);pg=pg or authority(ctx,cv,sources=sources)
    cv=s.get_conversation(p,ws,cv.id).conversation
    q=post(ctx,cv,'Inspect authorized context without changing it')
    tool_authority(ctx,cv,q,pg)
    decision=decision or dict(kind='search_work_context_page',query='needle',cursor=None,limit=6)
    fake=AlphaProvider(decisions or [decision,dict(kind='reply',text='Context inspected, not a verified outcome.')])
    saved={};original=md.execute
    from workagent.responses_ledger import Ledger
    event=Ledger.event
    def execute(*args,**kwargs):
        c=args[1]
        with c.transaction(force_rollback=True):
            result=original(*args,**kwargs)
            saved['receipt']=dict(c.execute('SELECT * FROM public.model_discovery_receipts_v2 WHERE workspace_id=%s AND run_id=%s AND phase=%s',(ws,q.run.id,'selection')).fetchone())
        return result
    def intercept(self,c,phase,kind,data):
        if phase=='selection' and kind=='tool_result':
            saved['stage']=deepcopy(data);saved['attempt']=self.receipt.attempt_id
            raise BeforeStage()
        return event(self,c,phase,kind,data)
    with patch.object(md,'execute',execute),patch.object(Ledger,'event',intercept),pytest.raises(BeforeStage):
        finish_natural_visits(ctx,worker(ctx,fake,path),q.run.id)
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM public.model_discovery_receipts_v2 WHERE run_id=%s',(q.run.id,)).fetchone()
    return NS(ctx=ctx,q=q,cv=cv,pg=pg,fake=fake,**saved)


def receipt_insert(c,row,schema='public'):
    fields=('id','workspace_id','run_id','phase','decision','binding','scope','position','result')
    c.execute(sql.SQL('INSERT INTO {}.model_discovery_receipts_v2 ({}) VALUES ({})').format(
        sql.Identifier(schema),sql.SQL(',').join(map(sql.Identifier,fields)),sql.SQL(',').join(sql.Placeholder() for _ in fields)),
        tuple(encoded(row[k]) if k in fields[4:] else row[k] for k in fields))


def stage_insert(c,f):
    c.execute('INSERT INTO public.responses_events(id,attempt_id,phase,kind,data) VALUES(%s,%s,%s,%s,%s)',
              (new_id(),f.attempt,'selection','tool_result',encoded(f.stage)))


def retained_capture(ctx,path):
    s,p,ws,_,_=ctx
    cv=conversation(ctx);pg=authority(ctx,cv)
    q=post(ctx,cv,'Retain exact message context');tool_authority(ctx,cv,q,pg,('context.read',))
    fake=AlphaProvider([dict(kind='read_context',section='messages'),dict(kind='reply',text='Read local context.')])
    assert finish_natural_visits(ctx,worker(ctx,fake,path/'producer'),q.run.id).state=='ready'
    return capture(ctx,path/'consumer',cv=cv,pg=pg,sources=[],decision=dict(kind='discover_retained_references',cursor=None,limit=12))


@pytest.mark.parametrize('family',['work','retained'])
@pytest.mark.parametrize('damage',['empty','omit','duplicate','order','wrong_query_excerpt','offset','position','continuation'])
def test_direct_malformed_receipt_rejected_and_exact_control(context,tmp_path,damage,family):
    f=capture(context,tmp_path) if family=='work' else retained_capture(context,tmp_path)
    row=deepcopy(f.receipt);items=row['result']['items'];assert len(items)>=2
    if damage=='empty':row['result']['items']=[]
    elif damage=='omit':row['result']['items']=items[1:]
    elif damage=='duplicate':row['result']['items']=[items[0],items[0]]
    elif damage=='order':row['result']['items']=list(reversed(items))
    elif damage in ('wrong_query_excerpt','offset'):
        item=items[0]
        if family=='retained':item['body_bytes']+=1
        elif damage=='wrong_query_excerpt':
            # Real text/hash/source, but the excerpt omits the literal query.
            item['excerpt_start']=0;item['excerpt']='x'*60;item['truncated']=True
        else:
            # Real matching bytes, but not the prescribed first-match offset.
            item['excerpt_start']+=1;item['excerpt']=item['excerpt'][1:]
    elif damage=='position':row['position']=None
    else:row['result']['has_more']=True;row['result']['next_cursor']=str(row['id'])
    with pytest.raises(psycopg.errors.RaiseException,match='independently derived'),context[0].db.transaction() as c:
        receipt_insert(c,row)
    with context[0].db.transaction() as c:
        receipt_insert(c,f.receipt);stage_insert(c,f)
        assert c.execute('SELECT result FROM public.model_discovery_receipts_v2 WHERE id=%s',(f.receipt['id'],)).fetchone()['result']==f.receipt['result']


@pytest.mark.parametrize('text,query',[
    ('😀é'*150+'Needle ß İ'+' tail'*500,'Needle ß İ'),
    ('NEEDLE '+'x'*250+'needle exact','needle exact'),
    ('literal [.*] not a regex','[.*]'),
    ('contains needle but not the phrase','needle absent'),
])
def test_sql_and_python_exact_literal_page_agree(context,tmp_path,text,query):
    f=capture(context,tmp_path,source_text=text,decision=dict(kind='search_work_context_page',query=query,cursor=None,limit=6))
    with context[0].db.transaction() as c:
        expected=c.execute('SELECT public.model_discovery_page_v2(%s,%s,%s,%s) page',
            (context[2],f.q.run.id,encoded(f.receipt['decision']),'null')).fetchone()['page']
        assert expected['items']==f.receipt['result']['items']
        assert expected['position']==f.receipt['position']
        receipt_insert(c,f.receipt);stage_insert(c,f)


@pytest.mark.parametrize('path',['pg_temp,public,pg_catalog','public,pg_catalog'])
@pytest.mark.parametrize('warm',[False,True])
def test_runtime_temp_shadow_cannot_supply_receipt_or_authority(context,tmp_path,path,warm):
    f=capture(context,tmp_path);s=context[0]
    with s.db.transaction() as c:
        role=c.execute("SELECT current_user role,has_database_privilege(current_user,current_database(),'TEMP') temp,has_schema_privilege(current_user,'public','CREATE') create_public").fetchone()
        assert role['temp'] and not role['create_public']
        if warm:
            c.prepare_threshold=0
            c.execute("SET LOCAL plan_cache_mode='force_generic_plan'")
            c.execute('SELECT public.model_discovery_scope_v2(%s,%s)',(context[2],f.q.run.id)).fetchone()
            # Warm the actual stage trigger's plans too; the expected rejection
            # rolls back only this savepoint, not the fresh runtime connection.
            with pytest.raises(psycopg.errors.RaiseException,match='exact discovery receipt'),c.transaction():stage_insert(c,f)
        for table in ('model_discovery_receipts_v2','runs','run_configurations','responses_events','provider_attempts','conversations','conversation_messages','artifacts','revisions','tool_grants','general_context_scopes','tool_scope_reductions','workspaces'):
            c.execute(sql.SQL('CREATE TEMP TABLE {} (LIKE public.{} INCLUDING DEFAULTS)').format(sql.Identifier(table),sql.Identifier(table)))
        receipt_insert(c,f.receipt,'pg_temp')
        c.execute(sql.SQL('SET LOCAL search_path TO '+path))  # closed parametrized constants
        assert c.execute('SELECT public.model_discovery_scope_v2(%s,%s) scope',(context[2],f.q.run.id)).fetchone()['scope']==f.receipt['scope']
        # Scope/authority shadowing is proved above with every empty TEMP decoy
        # present. Isolate the receipt-shadow attack next: unchanged baseline
        # triggers use unqualified runs%ROWTYPE and cannot operate with a TEMP
        # runs composite type. Do not modify/disable those production guards or
        # misattribute their early denial to the new receipt-specific guard.
        # Drop only this connection's test-created authority decoys; retain the
        # forged TEMP receipt for both the exact negative and positive control.
        for table in ('runs','run_configurations','responses_events','provider_attempts','conversations','conversation_messages','artifacts','revisions','tool_grants','general_context_scopes','tool_scope_reductions','workspaces'):
            c.execute(sql.SQL('DROP TABLE pg_temp.{}').format(sql.Identifier(table)))
        with pytest.raises(psycopg.errors.RaiseException,match='exact discovery receipt'),c.transaction():stage_insert(c,f)
        assert not c.execute('SELECT 1 FROM public.model_discovery_receipts_v2 WHERE id=%s',(f.receipt['id'],)).fetchone()
        # Same hostile connection, permanent validated receipt restores success.
        receipt_insert(c,f.receipt);stage_insert(c,f)


def test_helper_paths_and_runtime_receipt_acl(context):
    with context[0].db.transaction() as c:
        rows=c.execute("SELECT proname,proconfig,prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (proname LIKE '%model_discovery%v2' OR proname LIKE 'require_discovery_%v2')").fetchall()
        assert len(rows)>=12
        for row in rows:
            assert any(v.replace(' ','')=='search_path=pg_catalog,public,pg_temp' for v in row['proconfig'])
            assert not row['prosecdef']
        assert c.execute("SELECT has_table_privilege(current_user,'public.model_discovery_receipts_v2','SELECT,INSERT') ok").fetchone()['ok']
        assert not c.execute("SELECT has_table_privilege(current_user,'public.model_discovery_receipts_v2','TRUNCATE') ok").fetchone()['ok']


@pytest.mark.parametrize('mode',['off','reviewed-v1'])
def test_new_authority_memory_treatment_roundtrip_python_admission_sql(context,mode):
    cv=conversation(context);pg=authority(context,cv,mode)
    binding=pg.responses.model_dump(mode='json')
    assert GeneralAlphaResponsesBinding.model_validate(binding).model_dump(mode='json')==binding
    assert binding['memory_recall']==mode
    q=post(context,cv,'New explicit treatment authority')
    with context[0].db.transaction() as c:
        c.execute('SELECT public.require_alpha_budget_binding(%s)',(encoded(binding),))
        saved=c.execute('SELECT data FROM public.run_configurations WHERE workspace_id=%s AND run_id=%s',(context[2],q.run.id)).fetchone()['data']
        assert saved['responses']['memory_recall']==mode
        for change in ({'scope_tool_sha256':'0'*64},{'continuity_version':None},{'memory_recall':'automatic'}):
            bad={**binding,**change}
            with pytest.raises(ValueError):GeneralAlphaResponsesBinding.model_validate(bad)
            with pytest.raises(psycopg.Error),c.transaction():c.execute('SELECT public.require_alpha_budget_binding(%s)',(encoded(bad),))


def test_saved_revision_A_to_B_self_cycle_to_C_revocation(context,tmp_path):
    from workagent.memory.models import RememberMemory, MemoryCAS
    from workagent.errors import DomainError
    s,p,ws,_,admin=context
    memory=s.remember_memory(p,ws,cmd(RememberMemory,kind='preference',scope_kind='user',scope_id=p.id,
        subject_key='writing',predicate_key='headings',content='Use concise headings'))
    acv=conversation(context);apg=authority(context,acv,'reviewed-v1')
    # Producer uses the existing legacy publish_artifact path without a native
    # tool grant. Installing an unrelated files.read_range gateway grant correctly
    # rejects that legacy operation; it cannot manufacture a saved revision.
    aq=post(context,acv,'Produce a saved document')
    body={'title':'Evidence','blocks':[{'block_id':'one','kind':'paragraph','text':'needle saved producer evidence','checked':None}]}
    afake=AlphaProvider([dict(kind='publish_artifact',target=None,body=body),dict(kind='reply',text='Saved a draft.')])
    assert finish_natural_visits(context,worker(context,afake,tmp_path/'A'),aq.run.id).state=='ready'
    detail=s.get_conversation(p,ws,acv.id);artifact=s.get_artifact(p,ws,detail.artifact_ids[0]);revision=artifact.current_revision_id
    revoke_grant(Database(admin),apg.id)
    def self_read(projected):
        stage=journal(s,ws,b.q.run.id)['selection','tool_result']
        return dict(kind='read_result',run_id=b.q.run.id,phase='selection',operation_hash=stage['binding']['operation_hash'],offset=0,limit=8192)
    search=dict(kind='search_work_context_page',query='needle',cursor=None,limit=6)
    b=capture(context,tmp_path/'B',sources=[acv.id],decisions=[search,self_read,dict(kind='reply',text='Read the saved evidence.')])
    assert any(x['source']['revision_id']==revision for x in b.receipt['result']['items'])
    assert finish_natural_visits(context,worker(context,b.fake,tmp_path/'B'),b.q.run.id).state=='ready'
    stage=journal(s,ws,b.q.run.id)['selection','tool_result']
    read=dict(kind='read_result',run_id=b.q.run.id,phase='selection',operation_hash=stage['binding']['operation_hash'],offset=0,limit=8192)
    ccv=s.get_conversation(p,ws,b.cv.id).conversation;cq=post(context,ccv,'Read the prior search evidence')
    tool_authority(context,ccv,cq,b.pg)
    cfake=AlphaProvider([read,dict(kind='reply',text='Read prior evidence.')])
    assert finish_natural_visits(context,worker(context,cfake,tmp_path/'C'),cq.run.id).state=='ready'
    with s.db.transaction() as c:
        c.execute("SET LOCAL statement_timeout='3s'")
        for rid in (aq.run.id,b.q.run.id,cq.run.id):
            assert c.execute('SELECT public.research_run_dependencies_visible(%s,%s) ok',(ws,rid)).fetchone()['ok']
    before=artifact.current_revision.model_dump(mode='json')
    s.forget_memory(p,ws,memory.memory_id,cmd(MemoryCAS,expected_revision_id=memory.revision_id))
    with s.db.transaction() as c:
        c.execute("SET LOCAL statement_timeout='3s'")
        assert not c.execute('SELECT public.memory_revision_visible(%s,%s,%s) ok',(ws,artifact.id,revision)).fetchone()['ok']
        for rid in (b.q.run.id,cq.run.id):
            assert not c.execute('SELECT public.research_run_dependencies_visible(%s,%s) ok',(ws,rid)).fetchone()['ok']
        assert not c.execute('SELECT public.model_discovery_work_current_v2(%s,%s) ok',(ws,b.q.run.id)).fetchone()['ok']
        hit=next(x for x in b.receipt['result']['items'] if x['source']['revision_id']==revision)
        with pytest.raises(psycopg.Error),c.transaction():
            c.execute('SELECT public.require_discovery_work_item_v2(r,%s,%s) FROM public.runs r WHERE workspace_id=%s AND id=%s',(encoded(hit),'needle',ws,b.q.run.id))
        with pytest.raises(psycopg.Error),c.transaction():
            c.execute("SELECT public.retained_result_material_versioned(r,%s,'legacy-v1') FROM public.runs r WHERE workspace_id=%s AND id=%s",(encoded(read),ws,cq.run.id))
        assert c.execute('SELECT data FROM public.revisions WHERE workspace_id=%s AND artifact_id=%s AND id=%s',(ws,artifact.id,revision)).fetchone()['data']==before
