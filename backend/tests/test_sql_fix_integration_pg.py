"""SOLE-WRITER SERIAL PG CANDIDATE -- not executed by the isolated author.
Copy into backend/tests after applying/numbering the proposal in a DISPOSABLE tree.
Uses existing guarded test_domain context; no provider/network transport is used.
Do not import the native-projection module's hard-coded 82-migration fixture.
"""
from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
import pytest
import psycopg
from test_domain import context
from test_workspace_files_pg import make, text
from test_conversations import post
from workagent.models import new_id, now
from workagent.db import Database
from workagent.service import digest, encoded
from workagent.capabilities import registry, implementation_releases as releases
from workagent.capabilities.models import ToolGrantV1,CapabilityPin,ToolCallV1,InputRef
from workagent.capabilities.broker import CapabilityBroker

AMENDMENT=sha256(b'isolated disposable SQL repair fixture; not production authority').hexdigest()
PREDECESSOR=sha256(b'synthetic predecessor').hexdigest()
NAMES=['files.list','files.read_range','files.create_draft','files.propose_patch']


def setup(ctx,*,expired=False,intermediate=False):
    s,p,ws,_,admin=ctx;cv,file,_=make(ctx);q=post(ctx,cv);cap=s.claim_run(p,ws,q.run.id)
    current={n:registry.adapters()[n].descriptor.model_dump(mode='json') for n in NAMES}
    owner=Database(admin)
    with owner.transaction() as c:
        pins=[]
        for n,d in current.items():
            c.execute('INSERT INTO capability_installations(id,version,descriptor) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',(n,d['version'],encoded(d)))
            installed=c.execute('SELECT descriptor FROM capability_installations WHERE id=%s AND version=%s',(n,d['version'])).fetchone()['descriptor']
            assert releases.compatible(installed,d)
            pinned={**installed,'implementation_sha256':intermediate[n] if isinstance(intermediate,dict) else sha256(('birth-'+q.run.id+n).encode()).hexdigest()} if intermediate else installed
            pins.append(CapabilityPin(**{k:pinned[k] for k in ('id','version','schema_sha256','implementation_sha256')}))
        ref=InputRef(kind='workspace_file',id=file.workspace_file_id,version=file.current.version_id,sha256=file.current.sha256)
        g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,capabilities=pins,
            resource_selectors=[ref],effects=['read','draft','local_compute'],privacy_classes=['public','workspace_private'],egress='none',
            expires_at=now()+timedelta(hours=-1 if expired else 1),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)
        c.execute('INSERT INTO tool_budget_accounts(id,workspace_id,principal_id,limits) VALUES(%s,%s,%s,%s)',
            (g.budget_account_id,ws,p.id,encoded({'local_compute':100,'rendering':20,'extraction':20})))
        c.execute('INSERT INTO tool_grants(id,workspace_id,run_id,data) VALUES(%s,%s,%s,%s)',(g.id,ws,q.run.id,encoded(g)))
    b=releases.execution_identity();a=deepcopy(b)
    a['dependencies']['product']['synthetic-test-only-identity']=sha256(g.id.encode()).hexdigest()
    a['source_sha256']=digest(a['dependencies']['product']);a['consumer_sha256']=sha256(('consumer-'+g.id).encode()).hexdigest()
    ad={n:{**deepcopy(d),'implementation_sha256':next(p.implementation_sha256 for p in pins if p.id==n) if intermediate else sha256(('old-'+g.id+n).encode()).hexdigest()} for n,d in current.items()}
    return dict(s=s,p=p,ws=ws,owner=owner,g=g,q=q,cap=cap,file=file,ref=ref,A=a,B=b,ad=ad,bd=current)


def bind(x,label,names=NAMES,*,mixed=None):
    with x['owner'].transaction() as c:
        g=c.execute('SELECT * FROM tool_grants WHERE id=%s',(x['g'].id,)).fetchone()
        for i,n in enumerate(names):
            identity=deepcopy(x[label]);amendment=AMENDMENT;predecessor=PREDECESSOR
            if mixed=='consumer' and i==1:identity['consumer_sha256']='c'*64
            if mixed=='amendment' and i==1:amendment='d'*64
            if mixed=='predecessor' and i==1:predecessor='e'*64
            releases._binding(c,g,x['ad' if label=='A' else 'bd'][n],identity,amendment,predecessor)


def resolve(c,x,cid,label=None,consumer=None):
    i=x[label] if label else None
    return c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',
        (x['g'].id,cid,i['source_sha256'] if i else None,consumer if consumer else i['consumer_sha256'] if i else None)).fetchone()['d']


def saved(c,x):
    return dict(grant=c.execute('SELECT to_jsonb(g) v FROM tool_grants g WHERE id=%s',(x['g'].id,)).fetchone()['v'],
        account=c.execute('SELECT to_jsonb(b) v FROM tool_budget_accounts b WHERE id=%s',(x['g'].budget_account_id,)).fetchone()['v'],
        attempts=c.execute('SELECT to_jsonb(a) v FROM tool_attempts a WHERE grant_id=%s ORDER BY id',(x['g'].id,)).fetchall(),
        events=c.execute('SELECT to_jsonb(e) v FROM tool_attempt_events e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.grant_id=%s ORDER BY e.attempt_id,e.kind',(x['g'].id,)).fetchall(),
        costs=c.execute('SELECT to_jsonb(e) v FROM tool_cost_entries e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.grant_id=%s ORDER BY e.attempt_id,e.kind',(x['g'].id,)).fetchall())


def list_call(x):
    return ToolCallV1(call_id=new_id(),capability_id='files.list',capability_version='1',arguments={'kind':'files_list','after':None,'limit':10},input_refs=[],expected_work_version=x['q'].conversation.work_version)


def reserve(c,x,call,label=None,secret='exact-receipt'):
    params=(x['ws'],x['q'].run.id,x['cap'].fence,digest(x['cap'].secret),encoded(call),digest(secret))
    if label:
        params+=x[label]['source_sha256'],x[label]['consumer_sha256']
        sql='SELECT reserve_tool_call_v2(%s,%s,%s,%s,%s,%s,%s,%s) id'
    else:sql='SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) id'
    return c.execute(sql,params).fetchone()['id']


def test_two_retained_sources_and_immutable_old_attempts(context):
    x=setup(context)
    with x['s'].db.transaction() as c:
        old=reserve(c,x,list_call(x));before=saved(c,x)
    bind(x,'A')
    with x['s'].db.transaction() as c:
        call=list_call(x);aid=reserve(c,x,call,'A')
        old_a=c.execute('SELECT to_jsonb(b) v FROM tool_attempt_implementation_bindings b WHERE attempt_id=%s',(aid,)).fetchone()['v']
        assert resolve(c,x,'files.list','A')==x['ad']['files.list']
    bind(x,'B')
    with x['s'].db.transaction() as c:
        after=saved(c,x)
        assert after['grant']==before['grant'] and after['account']==before['account']
        assert all(row in after['attempts'] for row in before['attempts'])
        assert c.execute('SELECT to_jsonb(b) v FROM tool_attempt_implementation_bindings b WHERE attempt_id=%s',(aid,)).fetchone()['v']==old_a
        for label in ('A','B'):assert resolve(c,x,'files.list',label)==x['ad' if label=='A' else 'bd']['files.list']
        assert resolve(c,x,'files.list') is None
        assert resolve(c,x,'files.list','B',consumer='0'*64) is None
        assert c.execute('SELECT tool_run_available(%s,%s) ok',(x['ws'],x['q'].run.id)).fetchone()['ok']
        assert not c.execute('SELECT tool_attempt_implementation_authorized(%s) ok',(old,)).fetchone()['ok']
        assert not c.execute('SELECT tool_attempt_implementation_authorized(%s,%s,%s) ok',
            (aid,x['B']['source_sha256'],x['B']['consumer_sha256'])).fetchone()['ok']
        # Original source binding can still identify bytes, never rebind old receipt.
        assert c.execute('SELECT tool_attempt_implementation_authorized(%s) ok',(aid,)).fetchone()['ok']
        args=(aid,x['cap'].fence,digest(x['cap'].secret))
        assert not c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) sent',(*args,'wrong')).fetchone()['sent']
        assert c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) sent',(*args,'exact-receipt')).fetchone()['sent']
        assert not c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) sent',(*args,'exact-receipt')).fetchone()['sent']
        # Dispatched without observation is unresolved/unknown: neither a new
        # cohort nor repeated old receipt permits a second dispatch or reservation.
        count=c.execute('SELECT count(*) n FROM tool_cost_entries WHERE attempt_id=%s',(aid,)).fetchone()['n']
        assert reserve(c,x,call,'B')==aid
        assert c.execute('SELECT count(*) n FROM tool_cost_entries WHERE attempt_id=%s',(aid,)).fetchone()['n']==count
        with pytest.raises(psycopg.Error),c.transaction():reserve(c,x,list_call(x))
        for table in ('capability_implementation_releases','tool_grant_implementation_bindings','tool_attempt_implementation_bindings'):
            with pytest.raises(psycopg.Error),c.transaction():c.execute(f'DELETE FROM {table} WHERE false')


@pytest.mark.parametrize('damage',['partial','disabled','consumer','amendment','predecessor'])
def test_bad_source_cannot_borrow_good_cohort(context,damage):
    x=setup(context);bind(x,'A')
    bind(x,'B',names=NAMES[:-1] if damage=='partial' else NAMES,mixed=damage)
    if damage=='disabled':
        with x['owner'].transaction() as c:
            # Unique release per test grant would avoid cross-test disable. Roll
            # back this global release toggle below, never leave it disabled.
            with pytest.raises(Rollback),c.transaction():
                c.execute('UPDATE capability_implementation_releases SET enabled=false WHERE release_sha256=(SELECT release_sha256 FROM tool_grant_implementation_bindings WHERE grant_id=%s AND capability_id=%s AND source_sha256=%s)',(x['g'].id,NAMES[-1],x['B']['source_sha256']))
                assert resolve(c,x,'files.list','B') is None
                assert resolve(c,x,'files.list','A')==x['ad']['files.list']
                raise Rollback()
    else:
        with x['s'].db.transaction() as c:
            assert resolve(c,x,'files.list','B') is None
            assert resolve(c,x,'files.list','A')==x['ad']['files.list']
            assert resolve(c,x,'files.list') is None
            with pytest.raises(psycopg.Error),c.transaction():reserve(c,x,list_call(x),'B')


class Rollback(Exception):pass


@pytest.mark.parametrize('damage',['access','revoke','installed_disable','expired','fence','receipt'])
def test_current_authority_fences_survive(context,damage):
    x=setup(context,expired=damage=='expired');bind(x,'A');bind(x,'B')
    if damage=='expired':
        with x['s'].db.transaction() as c:
            assert resolve(c,x,'files.list','B') is None
            with pytest.raises(psycopg.Error),c.transaction():reserve(c,x,list_call(x),'B')
        return
    with x['owner'].transaction() as c:
        with pytest.raises(Rollback),c.transaction():
            before=saved(c,x)
            if damage=='access':c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(x['ws'],))
            elif damage=='revoke':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(x['g'].id,))
            elif damage=='installed_disable':c.execute("UPDATE capability_installations SET enabled=false WHERE id='files.list' AND version='1'")
            elif damage=='fence':
                from dataclasses import replace
                x['cap']=replace(x['cap'],fence=x['cap'].fence+1)
            else:
                aid=reserve(c,x,list_call(x),'B')
                assert not c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) sent',(aid,x['cap'].fence,digest(x['cap'].secret),'wrong')).fetchone()['sent']
                raise Rollback()
            with pytest.raises(psycopg.Error),c.transaction():reserve(c,x,list_call(x),'B')
            assert saved(c,x)['attempts']==before['attempts'] and saved(c,x)['costs']==before['costs']
            raise Rollback()


@pytest.mark.parametrize('kind',['create','patch'])
@pytest.mark.parametrize('char',['"','\\','\t','😀'])
def test_real_file_broker_max_valid_content_once(context,kind,char):
    x=setup(context);bind(x,'A');bind(x,'B')
    content=char*(200000//len(char.encode()));raw=content.encode()
    if kind=='create':
        cid='files.create_draft';args={'kind':'files_create_draft','source':text(content).model_dump()};refs=[]
    else:
        cid='files.propose_patch';args={'kind':'files_propose_patch','ref':x['file'].current.model_dump(),
            'content':content,'sha256':sha256(raw).hexdigest(),'reason':'\x01'*10000};refs=[x['ref']]
    request=ToolCallV1(call_id=new_id(),capability_id=cid,capability_version='1',arguments=args,input_refs=refs,expected_work_version=x['q'].conversation.work_version)
    with x['s'].db.transaction() as c:
        row=c.execute('SELECT octet_length(%s::jsonb::text) n,tool_call_payload_size_allowed(%s::jsonb) ok',(encoded(request),encoded(request))).fetchone()
        assert row['ok']
        if char!='😀':assert row['n']>262144
    broker=CapabilityBroker(x['s'],x['cap']);obs=broker.call(request)
    assert obs.status=='observed' and broker.call(request)==obs
    with x['s'].db.transaction() as c:
        assert c.execute('SELECT source_sha256 FROM tool_attempt_implementation_bindings WHERE attempt_id=%s',(obs.attempt_id,)).fetchone()['source_sha256']==x['B']['source_sha256']
        assert c.execute("SELECT count(*) n FROM tool_attempt_events WHERE attempt_id=%s AND kind='dispatch'",(obs.attempt_id,)).fetchone()['n']==1
        assert c.execute("SELECT count(*) n FROM tool_cost_entries WHERE attempt_id=%s AND kind='reserved'",(obs.attempt_id,)).fetchone()['n']==1
    assert x['s'].get_artifact(x['p'],x['ws'],x['file'].workspace_file_id).current_revision_id==x['file'].current.version_id


def test_actual_jsonb_upper_envelope_and_bad_metadata(context):
    s,_,_,_,_=context
    # Declared patch DTO permits controls and 200000 code points. This tests the
    # SQL transport helper only, not permission to apply semantically invalid text.
    p=dict(capability_id='files.propose_patch',capability_version='1',arguments=dict(kind='files_propose_patch',content='\x01'*200000,reason='\x01'*10000))
    with s.db.transaction() as c:
        row=c.execute('SELECT octet_length(%s::jsonb::text) n,tool_call_payload_size_allowed(%s::jsonb) ok',(encoded(p),encoded(p))).fetchone()
        assert row['ok'] and 1260000<row['n']<=262144+6*200000+6*10000
        for bad in [{**p,'extra':'x'*262144},{**p,'capability_version':'2'},{**p,'capability_id':'research.capture'},
                    {**p,'arguments':{**p['arguments'],'content':'"'*200001}},
                    {**p,'arguments':{**p['arguments'],'reason':'x'*10001}}]:
            assert not c.execute('SELECT tool_call_payload_size_allowed(%s::jsonb) ok',(encoded(bad),)).fetchone()['ok']


def test_guarded_bad_predecessor_hash_cannot_be_inserted(context):
    x=setup(context);bind(x,'A')
    with x['owner'].transaction() as c:
        row=c.execute('SELECT to_jsonb(b) v FROM tool_grant_implementation_bindings b WHERE grant_id=%s ORDER BY capability_id LIMIT 1',(x['g'].id,)).fetchone()['v']
        row['predecessor_installation_sha256']='0'*64
        row['binding_id']=digest({k:v for k,v in row.items() if k!='binding_id'})
        with pytest.raises(psycopg.errors.RaiseException,match='exact schema-preserving implementation binding required'),c.transaction():
            c.execute('INSERT INTO tool_grant_implementation_bindings SELECT * FROM jsonb_populate_record(NULL::tool_grant_implementation_bindings,%s)',(encoded(row),))


@pytest.mark.parametrize('mutation',['installation_update','installation_delete','binding_update','binding_delete'])
def test_owner_immutable_descriptor_and_binding_guards(context,mutation):
    x=setup(context);bind(x,'A')
    with x['owner'].transaction() as c:
        before=saved(c,x)
        with pytest.raises(psycopg.errors.RaiseException),c.transaction():
            if mutation=='installation_update':c.execute("UPDATE capability_installations SET descriptor=jsonb_set(descriptor,'{description}','\"forged\"') WHERE id='files.list' AND version='1'")
            elif mutation=='installation_delete':c.execute("DELETE FROM capability_installations WHERE id='files.list' AND version='1'")
            elif mutation=='binding_update':c.execute("UPDATE tool_grant_implementation_bindings SET predecessor_installation_sha256=%s WHERE grant_id=%s",('0'*64,x['g'].id))
            else:c.execute('DELETE FROM tool_grant_implementation_bindings WHERE grant_id=%s',(x['g'].id,))
        assert saved(c,x)==before


@pytest.mark.parametrize('damage',[None,'missing','wrong_source','partial','disabled','other_grant','wrong_pin','bad_installation_hash'])
def test_intermediate_pin_successor_requires_exact_complete_predecessor(context,damage):
    x=setup(context,intermediate=True)
    other=setup(context,intermediate={p.id:p.implementation_sha256 for p in x['g'].capabilities}) if damage=='other_grant' else None
    # Birth association: pin == intermediate release, immutable stored grant.
    with x['owner'].transaction() as c:
        g=c.execute('SELECT * FROM tool_grants WHERE id=%s',(x['g'].id,)).fetchone()
        if damage!='missing':
            for n in (NAMES[:-1] if damage=='partial' else NAMES):
                releases._binding(c,g,x['ad'][n],x['A'],AMENDMENT,None)
        before=saved(c,x)
        prior=c.execute('SELECT to_jsonb(b) v FROM tool_grant_implementation_bindings b WHERE grant_id=%s ORDER BY capability_id',(g['id'],)).fetchall()
        source=x['A']['source_sha256']
        if damage=='wrong_source':source='0'*64
        with pytest.raises(Rollback),c.transaction():
            if damage=='disabled':
                c.execute('UPDATE capability_implementation_releases SET enabled=false WHERE release_sha256=%s',(releases.release_id(x['ad'][NAMES[-1]],x['A']),))
            if damage=='other_grant':
                g=c.execute('SELECT * FROM tool_grants WHERE id=%s',(other['g'].id,)).fetchone()
            def insert():
                if damage=='other_grant':
                    # A real unrelated grant cannot borrow x's predecessor cohort.
                    releases._binding(c,g,x['bd'][NAMES[0]],x['B'],AMENDMENT,source)
                elif damage in ('wrong_pin','bad_installation_hash'):
                    n=NAMES[0];d=x['bd'][n];identity=x['B'];rid=releases.release_id(d,identity)
                    c.execute('INSERT INTO capability_implementation_releases (release_sha256,descriptor_sha256,descriptor,dependency_inventory,source_sha256,consumer_sha256,capability_id,capability_version,schema_sha256,implementation_sha256) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                        (rid,digest(d),encoded(d),encoded(identity['dependencies']),identity['source_sha256'],identity['consumer_sha256'],d['id'],d['version'],d['schema_sha256'],d['implementation_sha256']))
                    old=next(row['v'] for row in prior if row['v']['capability_id']==n)
                    body={k:v for k,v in old.items() if k!='binding_id'}
                    body.update(release_sha256=rid,source_sha256=identity['source_sha256'],consumer_sha256=identity['consumer_sha256'],predecessor_source_sha256=source)
                    if damage=='wrong_pin':body['predecessor_pin']={**body['predecessor_pin'],'implementation_sha256':'0'*64}
                    else:body['predecessor_installation_sha256']='0'*64
                    body['binding_id']=digest(body)
                    c.execute('INSERT INTO tool_grant_implementation_bindings SELECT * FROM jsonb_populate_record(NULL::tool_grant_implementation_bindings,%s)',(encoded(body),))
                else:
                    for n in NAMES:releases._binding(c,g,x['bd'][n],x['B'],AMENDMENT,source)
            if damage:
                with pytest.raises(psycopg.errors.RaiseException,match='exact schema-preserving implementation binding required'),c.transaction():insert()
            else:
                insert();insert() # exact idempotent retry, old cohort unchanged
                for n in NAMES:assert resolve(c,x,n,'B')==x['bd'][n]
                assert resolve(c,x,NAMES[0]) is None
            assert saved(c,x)==before
            assert all(row in c.execute('SELECT to_jsonb(b) v FROM tool_grant_implementation_bindings b WHERE grant_id=%s',(x['g'].id,)).fetchall() for row in prior)
            raise Rollback()


@pytest.mark.parametrize('bad_immediate_predecessor',[False,True])
def test_three_distinct_sources_follow_immediate_predecessor(context,bad_immediate_predecessor):
    x=setup(context,intermediate=True)
    successor=deepcopy(x['B'])
    successor['dependencies']['product']['synthetic-third-source']=sha256(x['g'].id.encode()).hexdigest()
    successor['source_sha256']=digest(successor['dependencies']['product'])
    successor['consumer_sha256']=sha256(('third-consumer-'+x['g'].id).encode()).hexdigest()
    descriptors={n:{**x['bd'][n],'implementation_sha256':sha256(('third-'+x['g'].id+n).encode()).hexdigest()} for n in NAMES}
    assert len({x['A']['source_sha256'],x['B']['source_sha256'],successor['source_sha256']})==3
    for n in NAMES:assert len({x['ad'][n]['implementation_sha256'],x['bd'][n]['implementation_sha256'],descriptors[n]['implementation_sha256']})==3
    with x['owner'].transaction() as c:
        g=c.execute('SELECT * FROM tool_grants WHERE id=%s',(x['g'].id,)).fetchone()
        for n in NAMES:releases._binding(c,g,x['ad'][n],x['A'],AMENDMENT,None)
        for n in NAMES:releases._binding(c,g,x['bd'][n],x['B'],AMENDMENT,x['A']['source_sha256'])
        before=saved(c,x)
        bindings=c.execute('SELECT to_jsonb(b) v FROM tool_grant_implementation_bindings b WHERE grant_id=%s ORDER BY source_sha256,capability_id',(g['id'],)).fetchall()
        prior_releases=c.execute('SELECT to_jsonb(r) v FROM capability_implementation_releases r WHERE release_sha256 IN (SELECT release_sha256 FROM tool_grant_implementation_bindings WHERE grant_id=%s)',(g['id'],)).fetchall()
        source='0'*64 if bad_immediate_predecessor else x['B']['source_sha256']
        with pytest.raises(Rollback),c.transaction():
            def insert():
                for n in NAMES:releases._binding(c,g,descriptors[n],successor,AMENDMENT,source)
            if bad_immediate_predecessor:
                with pytest.raises(psycopg.errors.RaiseException,match='exact schema-preserving implementation binding required'),c.transaction():insert()
            else:
                insert();insert()
                for n in NAMES:
                    assert resolve(c,x,n,'A')==x['ad'][n]
                    assert resolve(c,x,n,'B')==x['bd'][n]
                    assert c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',(g['id'],n,successor['source_sha256'],successor['consumer_sha256'])).fetchone()['d']==descriptors[n]
                assert resolve(c,x,NAMES[0]) is None
            assert saved(c,x)==before
            after=c.execute('SELECT to_jsonb(b) v FROM tool_grant_implementation_bindings b WHERE grant_id=%s',(g['id'],)).fetchall()
            assert all(row in after for row in bindings)
            for row in prior_releases:
                assert c.execute('SELECT to_jsonb(r) v FROM capability_implementation_releases r WHERE release_sha256=%s',(row['v']['release_sha256'],)).fetchone()==row
            raise Rollback()
