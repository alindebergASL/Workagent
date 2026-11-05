"""Parent-only restricted85; real selections/SQL, synthetic transport, no recursion."""
from datetime import timedelta
from hashlib import sha256
from unittest.mock import patch
import os
import pytest
import psycopg
import test_native_retained_projection_pg as N
from test_domain import context as domain_context
from test_general_responses import worker
from test_local_rejection_settlement import journal,requests
from retained_read_visits import finish_natural_visits
from workagent import retained_results as R
from workagent.capabilities import policy,registry,implementation_releases as releases
from workagent.capabilities.models import ToolGrantV1,CapabilityPin,InputRef
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import now,new_id
from workagent.service import encoded


def restricted85():
    expected=N.fixture_route();assert expected=='workagent_test_ac0c6200e0a0'
    runtime=Database(os.environ['DATABASE_URL']);runtime.check_runtime_role()
    with runtime.transaction() as c:
        assert c.execute('SELECT current_database() db,current_user role').fetchone()==dict(db=expected,role=expected+'_runtime')
        actual={r['name']:r['checksum'] for r in c.execute('SELECT name,checksum FROM schema_migrations').fetchall()}
        expected_schema=releases.execution_identity()['dependencies']['migrations']
        assert len(actual)==85 and actual==expected_schema
    with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:
        assert c.execute("SELECT current_database() db,current_user role,rolsuper,rolbypassrls,pg_get_userbyid(d.datdba)=current_user owns_db FROM pg_roles r,pg_database d WHERE r.rolname=current_user AND d.datname=current_database()").fetchone()==dict(db=expected,role=expected+'_owner',rolsuper=False,rolbypassrls=False,owns_db=True)
    return domain_context.__wrapped__()


@pytest.fixture(scope='module')
def current_release():
    # Existing normal NEW-grant bootstrap with exact85 route and explicit local
    # test approval. No old grant, pin, source identity or expiry is changed.
    ctx=restricted85();s,p,ws,_,admin=ctx;cv,file,_=N.make(ctx);q=N.post(ctx,cv)
    ds=[registry.adapters()[n].descriptor for n in sorted(releases.TRANSITION_IDS)]
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(**{k:getattr(d,k) for k in ('id','version','schema_sha256','implementation_sha256')}) for d in ds],
        resource_selectors=[InputRef(kind='workspace_file',id=file.workspace_file_id,version=file.current.version_id,sha256=file.current.sha256)],
        effects=['read','draft','local_compute'],privacy_classes=['public','workspace_private'],egress='public_https',
        expires_at=now()+timedelta(seconds=N.SYNTHETIC_TOOL_AUTHORITY_SECONDS),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)
    policy.install(Database(admin),g,limits=dict(local_compute=100,rendering=20,extraction=20),
                   amendment_sha256=sha256(b'disposable unsupported retained read57, not activation').hexdigest())
    with s.db.transaction() as c:assert releases.readback(c,q.run)['tool_grant']==g.model_dump(mode='json')


@pytest.fixture
def context(current_release):return restricted85()


def prepare_nested(ctx,path):
    s,p,ws,_,_=ctx;q,g,human,fake,args=N.capture(ctx,path,'files_read_range')
    s.stage_general_product(**args)
    prior=journal(s,ws,q.run.id)['selection_2','tool_result']
    chosen=dict(kind='read_result',run_id=q.run.id,phase='selection_2',operation_hash=prior['binding']['operation_hash'],offset=0,limit=8192)
    fake.decisions[2]=chosen
    def reply(projected):
        result=projected['adaptive']['observations'][-1]['capability_result']['result']
        assert result=={'status':'unavailable'}
        return dict(kind='reply',text='That read receipt has no supported body; no nested content was read.')
    fake.decisions.append(reply)
    stage=s.stage_general_product;saved={}
    def intercept(cap,receipt,phase='selection'):
        if phase=='selection_3':saved.update(cap=cap,receipt=receipt,phase=phase);raise InterruptedError('nested selection settled')
        return stage(cap,receipt,phase)
    with patch.object(s,'stage_general_product',intercept),pytest.raises(InterruptedError,match='nested selection settled'):
        finish_natural_visits(ctx,worker(ctx,fake,path),q.run.id)
    return q,g,human,fake,saved,chosen


def test_unsupported_receipt_sql_parity_exact_restart_and_new_choice(context,tmp_path):
    s,p,ws,_,_=context;q,g,human,fake,args,chosen=prepare_nested(context,tmp_path)
    before=journal(s,ws,q.run.id);prepared=requests(s,ws,q.run.id);native=N.native_rows(context,q.run.id);calls=list(fake.calls)
    from workagent.general_responses import resolve_selection
    with s.db.transaction() as c:
        actor,run,cv,_,_,binding,_=resolve_selection(s,c,**args)
        assert R.material(s,c,actor,run,cv,R.ReadResult.model_validate(chosen)) is None
        assert c.execute('SELECT retained_result_material_versioned(r,%s,%s) raw FROM runs r WHERE workspace_id=%s AND id=%s',
            (encoded(chosen),R.LEGACY_PROJECTION,ws,q.run.id)).fetchone()['raw'] is None
        refs=R.references(s,c,actor,run,cv)
        assert not any(x['phase']=='selection_2' and x['operation_hash']==chosen['operation_hash'] for x in refs)
        for bad in [dict(chosen,run_id='foreign-run'),dict(chosen,operation_hash='0'*64)]:
            if bad['run_id']=='foreign-run':
                with pytest.raises(psycopg.Error),c.transaction():
                    c.execute('SELECT retained_result_material_versioned(r,%s,%s) FROM runs r WHERE workspace_id=%s AND id=%s',(encoded(bad),R.LEGACY_PROJECTION,ws,q.run.id))
            else:
                assert c.execute('SELECT retained_result_material_versioned(r,%s,%s) raw FROM runs r WHERE workspace_id=%s AND id=%s',(encoded(bad),R.LEGACY_PROJECTION,ws,q.run.id)).fetchone()['raw'] is None
        forged=dict(decision=chosen,binding=binding,projection_version=R.LEGACY_PROJECTION,result=dict(status='available',**R.page_bytes(b'FORGED_NESTED_BODY',0,8192)))
        with pytest.raises(psycopg.Error),c.transaction():
            c.execute('INSERT INTO retained_result_reads(workspace_id,run_id,phase,byte_length,data) VALUES(%s,%s,%s,%s,%s)',(ws,q.run.id,'selection_3',len(forged['result']['text'].encode('utf8')),encoded(forged)))
    staged=s.stage_general_product(**args)
    assert staged['capability_result']['result']=={'status':'unavailable'} and staged['terminal_outcome']=='continue'
    assert staged['body'] is staged['file'] is staged['output'] is None
    assert s.stage_general_product(**args)==staged and fake.calls==calls
    assert all(journal(s,ws,q.run.id)[k]==v for k,v in before.items())
    assert requests(s,ws,q.run.id)==prepared and N.native_rows(context,q.run.id)==native
    with s.db.transaction() as c:
        pages=c.execute('SELECT data,byte_length FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s AND phase=%s',(ws,q.run.id,'selection_3')).fetchall()
        assert len(pages)==1 and pages[0]['byte_length']==0 and pages[0]['data']['result']=={'status':'unavailable'}
    assert finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    assert all(journal(s,ws,q.run.id)[k]==v for k,v in before.items())
    assert N.native_rows(context,q.run.id)==native
    assert s.get_artifact(p,ws,human.id).current_revision==human.current_revision
    with s.db.transaction() as c:
        rows=c.execute("SELECT phase,kind,count(*) n FROM responses_events WHERE attempt_id=%s AND kind IN ('count_send','count_result','dispatch','identity','result','tool_result') GROUP BY phase,kind",(args['receipt'].attempt_id,)).fetchall()
        assert rows and all(row['n']==1 for row in rows)


def test_revoked_current_grant_still_denies_without_unavailable_receipt(context,tmp_path):
    s,p,ws,_,admin=context;q,g,human,fake,args,_=prepare_nested(context,tmp_path)
    before=journal(s,ws,q.run.id);native=N.native_rows(context,q.run.id);calls=list(fake.calls)
    with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
    with pytest.raises(DomainError) as denied:s.stage_general_product(**args)
    assert denied.value.code.value=='not_found_or_not_authorized'
    assert journal(s,ws,q.run.id)==before and N.native_rows(context,q.run.id)==native and fake.calls==calls
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s AND phase=%s',(ws,q.run.id,'selection_3')).fetchone()
