"""Parent-run serial restricted PG controls. Never run against study/original stores.

Existing disposable migration fixture only. Synthetic authority is NEW; historical
installations/pins remain untouched. MockTransport makes no socket/provider calls.
"""
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit
import json
import os
import re
import pytest
import psycopg

from test_domain import context as domain_context
from test_workspace_files_pg import make, text
from test_conversations import post
from test_general_responses import worker, target
from test_general_alpha_runtime import activate, AlphaProvider
from test_gateway_target_rejection import material
from retained_read_visits import finish_natural_visits
from test_local_rejection_settlement import journal
from test_retained_read_gateway_pg import native_rows
from workagent.adaptive import contract
from test_memory_full_tools import config
from workagent.capabilities import registry, policy, implementation_releases as releases
from workagent.capabilities.models import ToolGrantV1, CapabilityPin, InputRef
from workagent.capabilities.broker import CapabilityBroker
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import new_id, now
from workagent.service import digest, encoded
from workagent import retained_results as retained

BASE=Path(__file__).resolve().parents[2]/'.local/batch3/b35c/retained-read-recovery'
PREDECESSOR='ba36e608ad757c58bc0a765a59b61de7f7803c2a9b8c5ffb795a2285334bd316'
AMENDMENT=sha256(b'disposable native retained projection fixture, not activation').hexdigest()
# NEW synthetic grants only: two45-minute runs plus finite claim/setup headroom.
SYNTHETIC_TOOL_AUTHORITY_SECONDS=2*60*60


def fixture_route():
    """Explicit fresh synthetic route; never adopt originals or the old06 fixture."""
    expected=os.environ['WORKAGENT_NATIVE_PROJECTION_TEST_DATABASE']
    assert re.fullmatch(r'workagent_test_[0-9a-f]{12}',expected),'exact generated disposable name required'
    inventory=BASE/'ORIGINAL_AFTER_IMPLEMENTATION_09.json'
    assert sha256(inventory.read_bytes()).hexdigest()=='e72d89678eaebed7b9b0867124c144ef9d75fc9813a81d85888f51243c8f87c8','original store inventory drift'
    original=json.loads(inventory.read_text())
    original_databases={store['identity']['database'] for store in original['stores'].values()}
    assert len(original_databases)==12
    assert expected not in original_databases|{'workagent_test_c0742ca73b11'},'original/old fixture forbidden'
    a=urlsplit(os.environ['DATABASE_URL']);b=urlsplit(os.environ['MIGRATION_DATABASE_URL'])
    assert a.scheme==b.scheme=='postgresql' and not (a.query or b.query or a.fragment or b.fragment)
    assert a.path==b.path=='/'+expected
    assert a.hostname==b.hostname and a.hostname in ('127.0.0.1','localhost')
    assert (a.port or 5432)==(b.port or 5432)
    assert a.username==expected+'_runtime' and b.username==expected+'_owner'
    return expected


def restricted_context():
    expected=fixture_route()
    runtime=Database(os.environ['DATABASE_URL']);runtime.check_runtime_role()
    with runtime.transaction() as c:
        assert c.execute('SELECT current_database() db,current_user role').fetchone()==dict(db=expected,role=expected+'_runtime')
        journal={row['name']:row['checksum'] for row in c.execute('SELECT name,checksum FROM schema_migrations').fetchall()}
        current={p.name:sha256(p.read_bytes()).hexdigest() for p in (Path(__file__).resolve().parents[1]/'migrations').glob('*.sql')}
        assert len(journal)==84 and journal==current,'exact combined50 schema required before seed'
    with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:
        role=c.execute("SELECT current_database() db,current_user role,rolsuper,rolbypassrls,pg_get_userbyid(d.datdba)=current_user owns_db FROM pg_roles r,pg_database d WHERE r.rolname=current_user AND d.datname=current_database()").fetchone()
        assert role==dict(db=expected,role=expected+'_owner',rolsuper=False,rolbypassrls=False,owns_db=True)
    return domain_context.__wrapped__()


def legacy_grant(ctx,names,*,before_grant=None):
    """Fresh authority with actual old installed descriptors, not old grant edits."""
    s,p,ws,_,admin=ctx;cv,file,_=make(ctx);q=post(ctx,cv)
    if before_grant is not None:before_grant(q)
    before=json.loads((BASE/'classification-01/BEFORE.json').read_text())['descriptors']
    owner=Database(admin)
    with owner.transaction() as c:
        descriptors=[]
        for name in names:
            d=before[name]
            c.execute('INSERT INTO capability_installations(id,version,descriptor) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',
                (name,d['version'],encoded(d)))
            d=c.execute('SELECT descriptor FROM capability_installations WHERE id=%s AND version=%s',(name,d['version'])).fetchone()['descriptor']
            assert releases.compatible(d,registry.adapters()[name].descriptor.model_dump(mode='json'))
            descriptors.append(d)
        g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
            capabilities=[CapabilityPin(**{k:d[k] for k in ('id','version','schema_sha256','implementation_sha256')}) for d in descriptors],
            resource_selectors=[InputRef(kind='workspace_file',id=file.workspace_file_id,version=file.current.version_id,sha256=file.current.sha256)],
            effects=['read','draft','local_compute'],privacy_classes=['public','workspace_private'],egress='public_https',
            expires_at=now()+timedelta(seconds=SYNTHETIC_TOOL_AUTHORITY_SECONDS),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)
        c.execute('INSERT INTO tool_budget_accounts(id,workspace_id,principal_id,limits) VALUES(%s,%s,%s,%s)',
            (g.budget_account_id,ws,p.id,encoded(dict(local_compute=100,rendering=20,extraction=20))))
        c.execute('INSERT INTO tool_grants(id,workspace_id,run_id,data) VALUES(%s,%s,%s,%s)',(g.id,ws,q.run.id,encoded(g)))
    return g,q,file


@pytest.fixture(scope='session')
def approved_disposable_release():
    # A genuinely NEW current grant bootstraps the release. No predecessor grant
    # or synthetic historical pin is required for current/empty-store admission.
    ctx=restricted_context();s,p,ws,_,admin=ctx;cv,file,_=make(ctx);q=post(ctx,cv)
    ds=[registry.adapters()[n].descriptor for n in sorted(releases.TRANSITION_IDS)]
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=[InputRef(kind='workspace_file',id=file.workspace_file_id,version=file.current.version_id,sha256=file.current.sha256)],
        effects=['read','draft','local_compute'],privacy_classes=['public','workspace_private'],egress='public_https',
        expires_at=now()+timedelta(seconds=SYNTHETIC_TOOL_AUTHORITY_SECONDS),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)
    owner=Database(admin);limits=dict(local_compute=100,rendering=20,extraction=20)
    for _ in range(2):policy.install(owner,g,limits=limits,amendment_sha256=AMENDMENT)
    with s.db.transaction() as c:
        rows=c.execute('SELECT predecessor_source_sha256 FROM tool_grant_implementation_bindings WHERE grant_id=%s',(g.id,)).fetchall()
        assert len(rows)==12 and all(row['predecessor_source_sha256'] is None for row in rows)
        assert releases.readback(c,q.run)['tool_grant']==g.model_dump(mode='json')
    return g.id


@pytest.fixture
def context(approved_disposable_release):return restricted_context()


def install(ctx,cv,q,pg,ref):
    names=['files.list','files.read_range','files.create_draft','files.propose_patch','files.compare','artifacts.export']
    ds=[registry.adapters()[n].descriptor for n in names]
    g=ToolGrantV1(id=new_id(),workspace_id=ctx[2],principal_id=ctx[1].id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=[ref],effects=['read','draft','local_compute'],privacy_classes=['workspace_private'],egress='none',
        expires_at=now()+timedelta(seconds=SYNTHETIC_TOOL_AUTHORITY_SECONDS),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)
    policy.install(Database(ctx[4]),g,limits={'local_compute':100,'rendering':20},provider_grant_id=pg.id)
    return g


def capture(ctx,path,kind='files_propose_patch',*,untargeted=False):
    s,p,ws,_,_=ctx;cv,file,_=make(ctx)
    human=s.get_artifact(p,ws,file.workspace_file_id)
    instructions,schema=contract(SimpleNamespace(**config('off')['responses']))
    with patch('test_general_alpha_runtime.POLICY',instructions),patch('test_general_alpha_runtime.DECISION_SCHEMA',schema):
        pg=activate(ctx,cv,continuity_version='sustained-v1',max_steps=4,memory_recall='off')
    q=post(ctx,cv,'Inspect the exact retained receipt; preserve human content.',
        target=None if untargeted or kind=='files_create_draft' else target(human))
    ref=InputRef(kind='workspace_file',id=file.workspace_file_id,version=file.current.version_id,sha256=file.current.sha256)
    grant=install(ctx,cv,q,pg,ref)
    args={
        'files_list':dict(kind=kind,after=None,limit=10),
        'files_read_range':dict(kind=kind,ref=file.current.model_dump(mode='json'),offset=0,limit=8192),
        'files_create_draft':dict(kind=kind,source=text('Synthetic new draft').model_dump(mode='json')),
        'files_propose_patch':dict(kind=kind,ref=file.current.model_dump(mode='json'),content='Synthetic pending change',sha256=sha256(b'Synthetic pending change').hexdigest(),reason='For review'),
        'files_compare':dict(kind=kind,left=file.current.model_dump(mode='json'),right=file.current.model_dump(mode='json')),
        'artifacts_export':dict(kind=kind,input_ref=ref.model_dump(mode='json'),format='txt'),
    }[kind]
    def select(projected):
        prior=journal(s,ws,q.run.id)['selection','tool_result']
        assert prior['decision']==args
        return dict(kind='read_result',run_id=q.run.id,phase='selection',operation_hash=prior['binding']['operation_hash'],offset=0,limit=8192)
    def final(projected):
        obs=projected['adaptive']['observations'][-1]
        assert obs['capability_result']['result']['status']=='available'
        assert json.loads(obs['capability_result']['result']['text'])['status_semantics']=='historical_receipt'
        return dict(kind='reply',text='Observed the exact historical receipt. Human content is unchanged; a pending proposal is not accepted.')
    fake=AlphaProvider([args,select,final]);saved={};stage=s.stage_general_product
    def intercept(cap,receipt,phase='selection'):
        if phase=='selection_2':saved.update(cap=cap,receipt=receipt,phase=phase);raise InterruptedError('retained selection ready')
        return stage(cap,receipt,phase)
    with patch.object(s,'stage_general_product',intercept),pytest.raises(InterruptedError,match='retained selection ready'):
        finish_natural_visits(ctx,worker(ctx,fake,path),q.run.id)
    return q,grant,human,fake,saved


@pytest.mark.parametrize('kind',retained.NATIVE_KINDS)
def test_native_matrix_exact_page_restart_and_synthetic_final(context,tmp_path,kind):
    s,p,ws,_,_=context;q,g,human,fake,args=capture(context,tmp_path,kind)
    old=journal(s,ws,q.run.id);native=native_rows(context,q.run.id);materials=material(context);calls=list(fake.calls)
    staged=s.stage_general_product(**args)
    with s.db.transaction() as c:
        from workagent.general_responses import resolve_selection
        actor,run,cv,d,*_=resolve_selection(s,c,**args)
        raw=retained.material(s,c,actor,run,cv,d,projection=retained.NATIVE_PROJECTION)
        sql=c.execute('SELECT retained_result_material_versioned(r,%s,%s) body FROM runs r WHERE workspace_id=%s AND id=%s',
            (encoded(d),retained.NATIVE_PROJECTION,ws,q.run.id)).fetchone()['body']
        assert bytes(sql)==raw
        row=c.execute('SELECT data FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
        assert row['projection_version']==retained.NATIVE_PROJECTION
        assert row['result']==staged['capability_result']['result']
        assert row['result']['body_sha256']==sha256(raw).hexdigest()
        retained.revalidate_reads(s,c,actor,run,cv)
        assert c.execute('SELECT count(*) n FROM tool_attempt_implementation_bindings b JOIN tool_attempts a ON a.id=b.attempt_id WHERE a.run_id=%s',(q.run.id,)).fetchone()['n']==1
    envelope=json.loads(raw);assert envelope['receipt']['capability']==kind
    if kind=='files_propose_patch':
        assert set(envelope['receipt']['result'])=={'proposal_id','workspace_file_id','base','proposed_sha256','status'}
        assert envelope['receipt']['result']['status']=='pending'
    assert s.stage_general_product(**args)==staged and fake.calls==calls
    assert finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    done=list(fake.calls);assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready' and fake.calls==done
    assert all(journal(s,ws,q.run.id)[k]==v for k,v in old.items())
    assert native_rows(context,q.run.id)==native and material(context)==materials
    assert s.get_artifact(p,ws,human.id).current_revision==human.current_revision
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['n']==1


@pytest.mark.parametrize('damage',['tool_revoke','provider_revoke','reduction','stale_fence','wrong_receipt','access','disabled_release'])
def test_current_denials_no_progress(context,tmp_path,damage):
    s,p,ws,_,admin=context;q,g,human,fake,args=capture(context,tmp_path)
    events=journal(s,ws,q.run.id);native=native_rows(context,q.run.id);before=material(context);calls=list(fake.calls)
    # Owner changes below are isolated in a rollback transaction on the SAME
    # runtime connection only where policy is SQL; revoke is never reactivated.
    if damage=='stale_fence':args['cap']=replace(args['cap'],fence=args['cap'].fence+1)
    elif damage=='wrong_receipt':args['receipt']=replace(args['receipt'],request_hash='0'*64)
    elif damage=='disabled_release':
        # Global release disable is rollback-only; no other fixture is affected.
        with Database(admin).transaction() as c:
            with pytest.raises(Rollback):
                with c.transaction():
                    c.execute('UPDATE capability_implementation_releases SET enabled=false WHERE release_sha256=(SELECT release_sha256 FROM tool_grant_implementation_bindings WHERE grant_id=%s LIMIT 1)',(g.id,))
                    assert not c.execute('SELECT tool_run_available(%s,%s) ok',(ws,q.run.id)).fetchone()['ok']
                    raise Rollback()
        return
    else:
        with Database(admin).transaction() as c:
            if damage=='tool_revoke':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
            elif damage=='provider_revoke':c.execute('UPDATE provider_grants SET active=false WHERE id=(SELECT grant_id FROM provider_attempts WHERE run_id=%s)',(q.run.id,))
            elif damage=='access':c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
            else:c.execute('INSERT INTO tool_scope_reductions(grant_id,selector) VALUES(%s,%s)',(g.id,encoded(g.resource_selectors[0])))
    with pytest.raises((DomainError,psycopg.Error)):s.stage_general_product(**args)
    assert journal(s,ws,q.run.id)==events and native_rows(context,q.run.id)==native
    assert material(context)==before and fake.calls==calls


class Rollback(Exception):pass


def test_release_install_idempotency_partial_disable_source_and_runtime_forgery(context):
    s,_,ws,_,admin=context;g,q,_=legacy_grant(context,['files.list','files.read_range'])
    owner=Database(admin);identity=releases.execution_identity()
    with owner.transaction() as c:
        before=c.execute('SELECT data FROM tool_grants WHERE id=%s',(g.id,)).fetchone()['data']
        account=c.execute('SELECT to_jsonb(b) v FROM tool_budget_accounts b WHERE id=%s',(g.budget_account_id,)).fetchone()['v']
        with pytest.raises(Rollback):
            with c.transaction():
                row=c.execute('SELECT * FROM tool_grants WHERE id=%s',(g.id,)).fetchone()
                releases._binding(c,row,registry.adapters()['files.list'].descriptor.model_dump(mode='json'),identity,AMENDMENT,PREDECESSOR)
                assert not c.execute('SELECT tool_run_available(%s,%s) ok',(ws,q.run.id)).fetchone()['ok']
                raise Rollback()
    for _ in range(2):releases.install_transition(owner,[g.id],amendment_sha256=AMENDMENT,predecessor_source_sha256=PREDECESSOR)
    with s.db.transaction() as c:
        assert c.execute('SELECT data FROM tool_grants WHERE id=%s',(g.id,)).fetchone()['data']==before
        assert c.execute('SELECT to_jsonb(b) v FROM tool_budget_accounts b WHERE id=%s',(g.budget_account_id,)).fetchone()['v']==account
        rows=c.execute('SELECT * FROM tool_grant_implementation_bindings WHERE grant_id=%s',(g.id,)).fetchall();assert len(rows)==2
        for source,consumer in [('0'*64,identity['consumer_sha256']),(identity['source_sha256'],'0'*64)]:
            assert c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',(g.id,'files.list',source,consumer)).fetchone()['d'] is None
        for table in ['capability_implementation_releases','tool_grant_implementation_bindings','tool_attempt_implementation_bindings']:
            with pytest.raises(psycopg.Error),c.transaction():c.execute(f'DELETE FROM {table} WHERE false')
        with pytest.raises(psycopg.Error),c.transaction():
            c.execute('INSERT INTO tool_grant_implementation_bindings SELECT * FROM tool_grant_implementation_bindings LIMIT 1')
    # A failed all-grant install rolls back all identities, not a partial grant.
    h,_,_=legacy_grant(context,['files.list','files.read_range'])
    with pytest.raises(ValueError):releases.install_transition(owner,[h.id,'zz-nonexistent'],amendment_sha256=AMENDMENT,predecessor_source_sha256=PREDECESSOR)
    with s.db.transaction() as c:assert not c.execute('SELECT 1 FROM tool_grant_implementation_bindings WHERE grant_id=%s',(h.id,)).fetchone()


def test_restricted_read_forgery_binding_and_immutable_observation(context,tmp_path):
    s,p,ws,_,_=context;q,g,human,fake,args=capture(context,tmp_path)
    from workagent.general_responses import resolve_selection
    with s.db.transaction() as c:
        actor,r,cv,d,_,binding,_=resolve_selection(s,c,**args)
        raw=retained.material(s,c,actor,r,cv,d,projection=retained.NATIVE_PROJECTION)
        good=dict(decision=d.model_dump(mode='json'),binding=binding,projection_version=retained.NATIVE_PROJECTION,
            result={'status':'available',**retained.page_bytes(raw,0,8192)})
        for damage in ['operation_hash','phase','source_run','binding','text','body_hash','version','status']:
            bad=deepcopy(good)
            if damage=='operation_hash':bad['decision']['operation_hash']='0'*64
            elif damage=='phase':bad['decision']['phase']='selection_8'
            elif damage=='source_run':bad['decision']['run_id']='foreign-run'
            elif damage=='binding':bad['binding']['selection_response_id']='foreign-response'
            elif damage=='text':bad['result']['text']='forged retained output'
            elif damage=='body_hash':bad['result']['body_sha256']='0'*64
            elif damage=='version':bad['projection_version']='legacy-v1'
            else:bad['result']={'status':'unavailable'}
            with pytest.raises(psycopg.Error),c.transaction():
                c.execute('INSERT INTO retained_result_reads(workspace_id,run_id,phase,byte_length,data) VALUES(%s,%s,%s,%s,%s)',
                    (ws,q.run.id,'selection_2',len(bad['result'].get('text','').encode()),encoded(bad)))
        for field,value in [('status','outcome_unknown'),('output_sha256','0'*64),('attempt_id','foreign'),('implementation_sha256','0'*64)]:
            with pytest.raises(psycopg.Error),c.transaction():
                c.execute("UPDATE tool_attempt_events SET data=jsonb_set(data,%s,%s) WHERE attempt_id=(SELECT id FROM tool_attempts WHERE run_id=%s) AND kind='observation'",
                    ([field],encoded(value),q.run.id))
        assert not c.execute('SELECT 1 FROM retained_result_reads WHERE run_id=%s',(q.run.id,)).fetchone()
    assert s.stage_general_product(**args)['capability_result']['result']==good['result']


@pytest.mark.parametrize('sent',[False,True])
def test_old_reserved_or_unobserved_dispatch_never_rebound_or_resent(context,sent):
    from test_workspace_file_gateway_pg import call
    from traceback import extract_tb
    s,p,ws,_,admin=context;claimed=[]
    def claim_before_grant(q):
        with s.db.transaction() as c:
            assert not c.execute('SELECT 1 FROM tool_grants WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
        claimed.append(s.claim_run(p,ws,q.run.id))
    g,q,file=legacy_grant(context,['files.read_range'],before_grant=claim_before_grant)
    cap,=claimed
    # Installing the old grant does NOT make it acceptable to the current
    # Python descriptor guard. Only the historical SQL path below is exercised.
    with s.db.transaction() as c:
        with pytest.raises(DomainError) as denied:policy.require_run_tools(c,q.run)
        assert denied.value.code.value=='not_found_or_not_authorized'
        assert any(frame.name=='resolve_descriptors' and Path(frame.filename).name=='boundary_policy.py'
                   for frame in extract_tb(denied.value.__traceback__))
    request=call(cap,q,'files.read_range',dict(kind='files_read_range',ref=file.current.model_dump(mode='json'),offset=0,limit=8192),g.resource_selectors)
    # An ordinary historical SQL reservation under its actual installed pin.
    # No adapter executes; a dispatched-without-observation attempt is genuinely
    # unresolved and its reserved cost remains retained across the transition.
    with s.db.transaction() as c:
        aid=c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) id',
            (ws,q.run.id,cap.fence,digest(cap.secret),encoded(request),digest('test-receipt'))).fetchone()['id']
        stored=c.execute('SELECT descriptor FROM tool_attempts WHERE id=%s',(aid,)).fetchone()['descriptor']
        pin=g.capabilities[0].model_dump(mode='json')
        assert {key:stored[key] for key in pin}==pin
        assert stored==c.execute('SELECT descriptor FROM capability_installations WHERE id=%s AND version=%s',
                                (pin['id'],pin['version'])).fetchone()['descriptor']
        assert stored['implementation_sha256']!=registry.adapters()[pin['id']].descriptor.implementation_sha256
        assert not c.execute('SELECT 1 FROM tool_attempt_implementation_bindings WHERE attempt_id=%s',(aid,)).fetchone()
        if sent:assert c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) sent',(aid,cap.fence,digest(cap.secret),'test-receipt')).fetchone()['sent']
        assert [r['kind'] for r in c.execute('SELECT kind FROM tool_attempt_events WHERE attempt_id=%s ORDER BY kind',(aid,)).fetchall()]==(['dispatch'] if sent else [])
    before=native_rows(context,q.run.id)
    releases.install_transition(Database(admin),[g.id],amendment_sha256=AMENDMENT,predecessor_source_sha256=PREDECESSOR)
    # No registry/adapter bypass: the real broker must fail before invoke.
    with pytest.raises((DomainError,psycopg.Error)):CapabilityBroker(s,cap).call(request)
    with s.db.transaction() as c:
        with pytest.raises(psycopg.Error),c.transaction():
            c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s)',(aid,cap.fence,digest(cap.secret),'test-receipt'))
        assert not c.execute('SELECT 1 FROM tool_attempt_implementation_bindings WHERE attempt_id=%s',(aid,)).fetchone()
    assert native_rows(context,q.run.id)==before


def test_revalidation_after_revocation_preserves_existing_page(context,tmp_path):
    s,p,ws,_,admin=context;q,g,_,_,args=capture(context,tmp_path)
    s.stage_general_product(**args)
    with s.db.transaction() as c:
        from workagent.general_responses import resolve_selection
        actor,r,cv,*_=resolve_selection(s,c,**args)
        pages=c.execute('SELECT to_jsonb(t) v FROM retained_result_reads t WHERE run_id=%s',(q.run.id,)).fetchall()
    with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
    with s.db.transaction() as c:
        with pytest.raises(DomainError):retained.revalidate_reads(s,c,actor,r,cv)
        assert c.execute('SELECT to_jsonb(t) v FROM retained_result_reads t WHERE run_id=%s',(q.run.id,)).fetchall()==pages


def test_owner_binding_nonimplementation_forgery_and_immutability(context):
    s,_,ws,_,admin=context;g,q,_=legacy_grant(context,['files.list'])
    identity=releases.execution_identity();owner=Database(admin)
    for field,value in [('schema_sha256','0'*64),('effects',['read','draft']),('cost_profile',{}),('id','research.search')]:
        d=deepcopy(registry.adapters()['files.list'].descriptor.model_dump(mode='json'));d[field]=value
        with pytest.raises(ValueError),owner.transaction() as c:
            row=c.execute('SELECT * FROM tool_grants WHERE id=%s',(g.id,)).fetchone()
            releases._binding(c,row,d,identity,AMENDMENT,PREDECESSOR)
    releases.install_transition(owner,[g.id],amendment_sha256=AMENDMENT,predecessor_source_sha256=PREDECESSOR)
    with owner.transaction() as c:
        b=c.execute('SELECT * FROM tool_grant_implementation_bindings WHERE grant_id=%s',(g.id,)).fetchone()
        for field,value in [('predecessor_pin',{}),('predecessor_installation_sha256','0'*64),('source_sha256','0'*64),('consumer_sha256','0'*64),('grant_id','missing')]:
            forged={k:v for k,v in b.items() if k!='binding_id'};forged[field]=value;forged['binding_id']=digest(forged)
            with pytest.raises(psycopg.Error),c.transaction():
                c.execute('INSERT INTO tool_grant_implementation_bindings SELECT * FROM jsonb_populate_record(NULL::tool_grant_implementation_bindings,%s)',(encoded(forged),))
        with pytest.raises(psycopg.Error),c.transaction():
            c.execute('UPDATE tool_grant_implementation_bindings SET amendment_sha256=%s WHERE binding_id=%s',('0'*64,b['binding_id']))


def test_source_grant_revoked_between_read_and_publication(context,tmp_path):
    s,p,ws,_,admin=context;q,source_grant,human,fake,args=capture(context,tmp_path/'source')
    s.stage_general_product(**args)
    assert finish_natural_visits(context,worker(context,fake,tmp_path/'source'),q.run.id).state=='ready'
    prior=journal(s,ws,q.run.id)['selection','tool_result']
    cv=s.get_conversation(p,ws,q.conversation.id).conversation
    with s.db.transaction() as c:
        gid=c.execute('SELECT data->>\'grant_id\' id FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['id']
    following=post(context,cv,'Read that exact pending receipt, without accepting its proposal.',target=target(human))
    current_grant=install(context,cv,following,SimpleNamespace(id=gid),source_grant.resource_selectors[0])
    choice=dict(kind='read_result',run_id=q.run.id,phase='selection',operation_hash=prior['binding']['operation_hash'],offset=0,limit=8192)
    provider=AlphaProvider([choice,dict(kind='reply',text='Historical receipt only.')]);saved={};stage=s.stage_general_product
    def stop(cap,receipt,phase='selection'):
        saved.update(cap=cap,receipt=receipt,phase=phase);raise InterruptedError('new consuming selection')
    with patch.object(s,'stage_general_product',stop),pytest.raises(InterruptedError,match='new consuming selection'):
        finish_natural_visits(context,worker(context,provider,tmp_path/'consumer'),following.run.id)
    stage(**saved)
    with s.db.transaction() as c:
        from workagent.general_responses import resolve_selection
        actor,r,scope,*_=resolve_selection(s,c,**saved)
        assert c.execute('SELECT native_retained_reads_authorized(%s,%s) ok',(ws,r.id)).fetchone()['ok']
        pages=c.execute('SELECT to_jsonb(rr) v FROM retained_result_reads rr WHERE run_id=%s',(r.id,)).fetchall()
    with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(source_grant.id,))
    with s.db.transaction() as c:
        assert c.execute('SELECT active FROM tool_grants WHERE id=%s',(current_grant.id,)).fetchone()['active']
        assert not c.execute('SELECT native_retained_reads_authorized(%s,%s) ok',(ws,r.id)).fetchone()['ok']
        with pytest.raises(psycopg.Error),c.transaction():
            c.execute('SELECT require_general_publication_authority(rr) FROM runs rr WHERE workspace_id=%s AND id=%s',(ws,r.id))
        with pytest.raises(DomainError):retained.revalidate_reads(s,c,actor,r,scope)
        assert c.execute('SELECT to_jsonb(rr) v FROM retained_result_reads rr WHERE run_id=%s',(r.id,)).fetchall()==pages


@pytest.mark.parametrize('kind',['078','079'])
def test_current_rejection_under_exact_release(context,tmp_path,kind):
    # Exercise unchanged current rejection writers and SQL guards, not historical
    #078 resolution installation or replay of a native unknown attempt.
    from test_file_input_rejection import prepare as prepare_bad
    from test_target_create_rejection import prepare as prepare_target
    from test_general_alpha_runtime import AlphaProvider
    if kind=='078':
        cv,q,g,human,bad,_=prepare_bad(context)
        fake=AlphaProvider([bad]);event='file_input_rejection';boundary='after_file_input_rejection'
    else:
        cv,q,g,human,_,fake=prepare_target(context)
        event='tool_result';boundary='after_tool_result'
    before=material(context)
    def hook(name):
        if name==boundary:raise InterruptedError('exact current rejection')
    with pytest.raises(InterruptedError,match='exact current rejection'):
        finish_natural_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    events=journal(context[0],context[2],q.run.id)
    assert ('selection',event) in events and material(context)==before
    assert context[0].get_artifact(context[1],context[2],human.id).current_revision==human.current_revision
    with context[0].db.transaction() as c:
        installed=c.execute('SELECT data FROM tool_grants WHERE id=%s',(g.id,)).fetchone()['data']
        assert c.execute('SELECT count(*) n FROM tool_grant_implementation_bindings WHERE grant_id=%s',(g.id,)).fetchone()['n']==len(installed['capabilities'])
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()
        assert not c.execute('SELECT 1 FROM tool_cost_entries ce JOIN tool_attempts t ON t.id=ce.attempt_id WHERE t.run_id=%s',(q.run.id,)).fetchone()


def test_074_output_consumption_rechecks_release(context,tmp_path):
    s,p,ws,_,admin=context;q,g,human,fake,args=capture(context,tmp_path,'files_create_draft')
    with s.db.transaction() as c:
        rows=c.execute('SELECT * FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchall()
        assert len(rows)==1 and rows[0]['capability_id']=='files.create_draft'
        aid=rows[0]['id']
        refs=c.execute('SELECT tool_effective_resources(%s,%s) refs',(ws,q.run.id)).fetchone()['refs']
        created=[ref for ref in refs if ref['id']==aid];assert len(created)==2
        descriptor=registry.adapters()['files.read_range']
        from workagent.capabilities.models import ToolCallV1
        ref=next(ref for ref in created if ref['kind']=='workspace_file')
        choice=dict(kind='files_read_range',ref=dict(workspace_file_id=ref['id'],version_id=ref['version'],sha256=ref['sha256']),offset=0,limit=8192)
        scope=s.get_conversation(p,ws,q.conversation.id).conversation
        call=ToolCallV1(call_id='read-output-proof',capability_id=descriptor.descriptor.id,capability_version=descriptor.descriptor.version,
            arguments=choice,input_refs=[InputRef.model_validate(ref)],expected_work_version=scope.work_version)
        policy.authorize(s,c,args['cap'],call,descriptor)
    with Database(admin).transaction() as c:
        with pytest.raises(Rollback):
            with c.transaction():
                c.execute('UPDATE capability_implementation_releases SET enabled=false WHERE release_sha256=(SELECT release_sha256 FROM tool_attempt_implementation_bindings WHERE attempt_id=%s)',(aid,))
                assert c.execute('SELECT tool_run_output_resources(%s,%s) refs',(ws,q.run.id)).fetchone()['refs']==[]
                assert c.execute('SELECT tool_attempt_descriptor(%s) d',(aid,)).fetchone()['d'] is None
                raise Rollback()
    assert journal(s,ws,q.run.id)['selection','tool_result']['status']=='reply'
    with s.db.transaction() as c:
        native=c.execute("SELECT data FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",(aid,)).fetchone()['data']
        assert native['status']=='observed' and native['output']['capability']=='files_create_draft'


def test_complete_release_record_coexists_and_forgery_denies(context):
    # No grant selects these alternate records; the test rolls all rows back.
    # An unchanged descriptor can identify multiple exact immutable source records.
    owner=Database(context[4])
    with owner.transaction() as c:
        saved=c.execute('SELECT * FROM capability_implementation_releases ORDER BY release_sha256 LIMIT 1').fetchone()
        assert saved['descriptor_sha256']==digest(saved['descriptor'])
        with pytest.raises(Rollback):
            with c.transaction():
                alternate=deepcopy(saved)
                alternate['dependency_inventory']['product']['test-only-future.py']='f'*64
                alternate['source_sha256']=digest(alternate['dependency_inventory']['product'])
                record={k:alternate[k] for k in ('descriptor_sha256','descriptor','dependency_inventory','source_sha256','consumer_sha256')}
                alternate['release_sha256']=digest(record)
                assert alternate['release_sha256']!=saved['release_sha256']
                c.execute('INSERT INTO capability_implementation_releases SELECT * FROM jsonb_populate_record(NULL::capability_implementation_releases,%s)',(encoded(alternate),))
                assert c.execute('SELECT count(*) n FROM capability_implementation_releases WHERE descriptor_sha256=%s',(saved['descriptor_sha256'],)).fetchone()['n']>=2
                for key in ['descriptor_sha256','source_sha256']:
                    wrong=deepcopy(alternate);wrong[key]='0'*64
                    wrong['release_sha256']=digest({k:wrong[k] for k in record})
                    with pytest.raises(psycopg.Error),c.transaction():
                        c.execute('INSERT INTO capability_implementation_releases SELECT * FROM jsonb_populate_record(NULL::capability_implementation_releases,%s)',(encoded(wrong),))
                raise Rollback()


@pytest.mark.parametrize('mutation',['revoke','reduce'])
def test_native_read_publication_visibility_follows_source_authority(context,tmp_path,mutation):
    """Actual A range -> B retained read + native draft/proposal + publication.

    No research or memory fixture hides a missing native edge. Human base and all
    immutable evidence stay intact after restricting only A's tool authority.
    """
    from workagent.service import Service
    from workagent.general_worker import GeneralWorker
    s,p,ws,_,admin=context
    a,source_grant,human,source_provider,args=capture(context,tmp_path/'a','files_read_range',untargeted=True)
    s.stage_general_product(**args)
    assert finish_natural_visits(context,worker(context,source_provider,tmp_path/'a'),a.run.id).state=='ready'
    first=journal(s,ws,a.run.id)['selection','tool_result']
    with s.db.transaction() as c:
        cfg=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,a.run.id)).fetchone()['data']
        assert c.execute('SELECT research_run_dependencies_visible(%s,%s) ok',(ws,a.run.id)).fetchone()['ok']
        assert c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,a.run.id)).fetchone()['data'].get('memory_manifest',[])==[]
    cv=s.get_conversation(p,ws,a.conversation.id).conversation
    b=post(context,cv,'Read the prior receipt, then prepare a separate draft and a reviewable patch.',target=None)
    consuming_grant=install(context,cv,b,SimpleNamespace(id=cfg['grant_id']),source_grant.resource_selectors[0])
    marker='NATIVE_DERIVED_VISIBILITY_CANARY'
    ref=source_grant.resource_selectors[0]
    provider=AlphaProvider([
        dict(kind='read_result',run_id=a.run.id,phase='selection',operation_hash=first['binding']['operation_hash'],offset=0,limit=8192),
        dict(kind='files_create_draft',source=text(marker).model_dump(mode='json')),
        dict(kind='files_propose_patch',ref=dict(workspace_file_id=ref.id,version_id=ref.version,sha256=ref.sha256),
             content=marker,sha256=sha256(marker.encode()).hexdigest(),reason='Review only'),
        dict(kind='reply',text=marker)],explanation=marker)
    assert finish_natural_visits(context,worker(context,provider,tmp_path/'b'),b.run.id).state=='ready'
    entries=journal(s,ws,b.run.id)
    created=entries['selection_2','tool_result']['capability_result']['result']
    proposal=entries['selection_3','tool_result']['capability_result']['result']
    fid=created['workspace_file_id'];version=created['current']['version_id'];file_hash=created['current']['sha256'];pid=proposal['proposal_id']
    assert marker in s.get_conversation(p,ws,cv.id).model_dump_json()
    assert s.read_workspace_file(p,ws,fid,version,file_hash).text==marker
    assert pid in {x.id for x in s.proposals(p,ws,human.id).items}
    with s.db.transaction() as c:
        assert c.execute('SELECT memory_revision_visible(%s,%s,%s) ok',(ws,fid,version)).fetchone()['ok']
        assert c.execute('SELECT memory_proposal_visible(%s,%s) ok',(ws,pid)).fetchone()['ok']
        rows=c.execute('SELECT to_jsonb(rr) v FROM retained_result_reads rr WHERE run_id IN (%s,%s) ORDER BY to_jsonb(rr)::text',(a.run.id,b.run.id)).fetchall()
    before=material(context);native_before={rid:native_rows(context,rid) for rid in (a.run.id,b.run.id)}
    events_before={rid:journal(s,ws,rid) for rid in (a.run.id,b.run.id)}
    if mutation=='revoke':
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(source_grant.id,))
    else:policy.restrict_resources(Database(admin),source_grant.id,[ref])
    s=Service(s.db)
    assert marker not in s.get_conversation(p,ws,cv.id).model_dump_json()
    assert marker not in s.list_conversations(p,ws).model_dump_json()
    assert pid not in {x.id for x in s.proposals(p,ws,human.id).items}
    with pytest.raises(DomainError):s.read_workspace_file(p,ws,fid,version,file_hash)
    assert fid not in {x.workspace_file_id for x in s.list_workspace_files(p,ws,cv.id).items}
    assert s.get_artifact(p,ws,human.id).current_revision==human.current_revision
    with s.db.transaction() as c:
        assert c.execute('SELECT active FROM tool_grants WHERE id=%s',(consuming_grant.id,)).fetchone()['active']
        assert not c.execute('SELECT research_run_dependencies_visible(%s,%s) ok',(ws,b.run.id)).fetchone()['ok']
        assert not c.execute('SELECT memory_revision_visible(%s,%s,%s) ok',(ws,fid,version)).fetchone()['ok']
        assert not c.execute('SELECT memory_proposal_visible(%s,%s) ok',(ws,pid)).fetchone()['ok']
        assert c.execute('SELECT memory_revision_visible(%s,%s,%s) ok',(ws,human.id,human.current_revision_id)).fetchone()['ok']
        assert c.execute('SELECT to_jsonb(rr) v FROM retained_result_reads rr WHERE run_id IN (%s,%s) ORDER BY to_jsonb(rr)::text',(a.run.id,b.run.id)).fetchall()==rows
    # Ordinary fresh context must not regain B's hidden material through messages
    # or saved work. It need not make another provider request to prove filtering.
    current=s.get_conversation(p,ws,cv.id).conversation
    fresh=post(context,current,'Inspect the still-authorized human file.')
    install(context,current,fresh,SimpleNamespace(id=cfg['grant_id']),ref)
    w=GeneralWorker.__new__(GeneralWorker);w.service=s
    cap=w._claim_responses_run(p,ws,fresh.run.id)
    projected=s.conversation_worker_context(cap)
    assert marker not in json.dumps(projected,ensure_ascii=False,default=str)
    assert material(context)==before
    assert all(native_rows(context,rid)==native_before[rid] and journal(s,ws,rid)==events_before[rid] for rid in native_before)


def test_same_run_native_read_visibility_terminates(context,tmp_path):
    # Native creation produces its own referenced revision; the read's source and
    # revision-producer edges both point back to this run. UNION must terminate.
    s,p,ws,_,_=context;q,g,human,fake,args=capture(context,tmp_path,'files_create_draft')
    staged=s.stage_general_product(**args)
    assert s.stage_general_product(**args)==staged
    with s.db.transaction() as c:
        assert c.execute('SELECT research_run_dependencies_visible(%s,%s) ok',(ws,q.run.id)).fetchone()['ok']
        assert c.execute('SELECT native_retained_reads_authorized(%s,%s) ok',(ws,q.run.id)).fetchone()['ok']
        assert c.execute('SELECT count(*) n FROM retained_result_reads WHERE run_id=%s',(q.run.id,)).fetchone()['n']==1
        created=journal(s,ws,q.run.id)['selection','tool_result']['capability_result']['result']
        assert c.execute('SELECT memory_revision_visible(%s,%s,%s) ok',(ws,created['workspace_file_id'],created['current']['version_id'])).fetchone()['ok']
    assert s.get_artifact(p,ws,human.id).current_revision==human.current_revision
