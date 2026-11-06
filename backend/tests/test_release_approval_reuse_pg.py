"""Parent serial restricted PG: actual policy.install new-run lifecycle, no I/O."""
from datetime import timedelta
import pytest
from test_native_retained_projection_pg import restricted_context
from test_workspace_files_pg import make
from test_conversations import post
from workagent.capabilities import implementation_releases as R,registry,policy
from workagent.capabilities.models import ToolGrantV1,CapabilityPin,InputRef
from workagent.db import Database
from workagent.models import now,new_id

@pytest.fixture
def context():return restricted_context()


def new_grant(ctx,names=('files.list','files.read_range')):
    _,p,ws,_,_=ctx;cv,file,_=make(ctx);q=post(ctx,cv)
    ds=[registry.adapters()[n].descriptor for n in names]
    return ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=[InputRef(kind='workspace_file',id=file.workspace_file_id,version=file.current.version_id,sha256=file.current.sha256)],
        effects=['read'],privacy_classes=['public','workspace_private'],egress='none',
        expires_at=now()+timedelta(hours=2),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)


def rows(c,ids):
    return {table:c.execute(f'SELECT to_jsonb(t) v FROM {table} t WHERE '+('id' if table=='tool_grants' else 'grant_id')+'=ANY(%s) ORDER BY '+('id' if table=='tool_grants' else 'binding_id'),(ids,)).fetchall()
            for table in ('tool_grants','tool_grant_implementation_bindings')}


def test_actual_install_reuses_one_of_multiple_complete_current_approvals(context):
    owner=Database(context[4]);a=new_grant(context);b=new_grant(context);g=new_grant(context);limits={'local_compute':100}
    policy.install(owner,a,limits=limits,amendment_sha256='0'*64)
    policy.install(owner,b,limits=limits,amendment_sha256='f'*64)
    with owner.transaction() as c:before=rows(c,[a.id,b.id])
    assert policy.install(owner,g,limits=limits)==g
    assert policy.install(owner,g,limits=limits)==g
    with context[0].db.transaction() as c:
        assert rows(c,[a.id,b.id])==before
        bindings=c.execute('SELECT * FROM tool_grant_implementation_bindings WHERE grant_id=%s',(g.id,)).fetchall()
        assert len(bindings)==2 and {r['amendment_sha256'] for r in bindings}=={'0'*64}
        assert all(r['predecessor_source_sha256'] is None for r in bindings)
        actual=policy.grant(c,g.workspace_id,g.run_id)
        assert actual==g and actual.resource_selectors!=a.resource_selectors and actual.resource_selectors!=b.resource_selectors
        identity=R.execution_identity()
        for pin in g.capabilities:
            assert c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',(g.id,pin.id,identity['source_sha256'],identity['consumer_sha256'])).fetchone()['d']==registry.adapters()[pin.id].descriptor.model_dump(mode='json')


class Rollback(Exception):pass


def test_actual_install_disabled_current_release_cannot_authorize_new_grant(context):
    from contextlib import contextmanager
    owner=Database(context[4]);a=new_grant(context);g=new_grant(context);limits={'local_compute':100}
    policy.install(owner,a,limits=limits,amendment_sha256='0'*64)
    d=registry.adapters()['files.read_range'].descriptor.model_dump(mode='json');rid=R.release_id(d,R.execution_identity())
    with owner.transaction() as c:
        # Disposable transaction only, no persistent revocation or reactivation.
        with pytest.raises(Rollback),c.transaction():
            c.execute('UPDATE capability_implementation_releases SET enabled=false WHERE release_sha256=%s',(rid,))
            class BoundDB:
                @contextmanager
                def transaction(self):
                    with c.transaction():yield c
            # This exact restored fixture retains the genuinely older installed descriptor.
            assert c.execute('SELECT descriptor FROM capability_installations WHERE id=%s AND version=%s',(d['id'],d['version'])).fetchone()['descriptor']!=d
            with pytest.raises(ValueError,match='installation drift; install a new version'):
                policy.install(BoundDB(),g,limits=limits)
            assert c.execute('SELECT 1 FROM tool_grants WHERE id=%s',(g.id,)).fetchone() is None
            assert c.execute('SELECT 1 FROM tool_budget_accounts WHERE id=%s',(g.budget_account_id,)).fetchone() is None
            raise Rollback()
        assert c.execute('SELECT enabled FROM capability_implementation_releases WHERE release_sha256=%s',(rid,)).fetchone()['enabled']


@pytest.mark.parametrize('donor_state',['inactive','expired'])
def test_actual_install_historical_provenance_needs_no_donor_renewal(context,donor_state):
    import time
    # Separate intended sets keep this proof distinct from the two earlier controls.
    names=('files.list','files.compare' if donor_state=='inactive' else 'context.read')
    owner=Database(context[4]);a=new_grant(context,names);g=new_grant(context,names);limits={'local_compute':100}
    if donor_state=='expired':a=a.model_copy(update={'expires_at':now()+timedelta(seconds=30)})
    policy.install(owner,a,limits=limits,amendment_sha256='0'*64)
    with owner.transaction() as c:
        if donor_state=='inactive':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(a.id,))
        else:
            remaining=c.execute("SELECT greatest(0,extract(epoch FROM ((data->>'expires_at')::timestamptz-clock_timestamp()))) seconds FROM tool_grants WHERE id=%s",(a.id,)).fetchone()['seconds']
    if donor_state=='expired':
        assert 0<=remaining<=30
        time.sleep(float(remaining)+0.1) # natural fixture expiry, no DB/worker clock changes
    with owner.transaction() as c:
        assert c.execute("SELECT NOT active OR (data->>'expires_at')::timestamptz<=clock_timestamp() unavailable FROM tool_grants WHERE id=%s",(a.id,)).fetchone()['unavailable']
        before=rows(c,[a.id])
    assert policy.install(owner,g,limits=limits)==g
    assert policy.install(owner,g,limits=limits)==g
    with owner.transaction() as c:
        assert rows(c,[a.id])==before
        bindings=c.execute('SELECT amendment_sha256 FROM tool_grant_implementation_bindings WHERE grant_id=%s',(g.id,)).fetchall()
        assert len(bindings)==len(names) and {r['amendment_sha256'] for r in bindings}=={'0'*64}
        identity=R.execution_identity();ids=[R.release_id(registry.adapters()[n].descriptor.model_dump(mode='json'),identity) for n in names]
        donors=c.execute("""SELECT g.id,NOT g.active OR (g.data->>'expires_at')::timestamptz<=clock_timestamp() unavailable
            FROM tool_grants g JOIN tool_grant_implementation_bindings b ON b.grant_id=g.id
            WHERE b.release_sha256=ANY(%s) AND b.amendment_sha256=%s AND g.id<>%s
            GROUP BY g.id HAVING count(DISTINCT b.release_sha256)=%s""",(ids,'0'*64,g.id,len(ids))).fetchall()
        assert donors and all(d['unavailable'] for d in donors),'proof must not borrow live donor evidence'
        assert policy.grant(c,g.workspace_id,g.run_id)==g
        assert g.resource_selectors!=a.resource_selectors
        # This NEW test grant can now be revoked; keeps repeated proof meaningful
        # without reviving any donor or modifying its immutable records.
        c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))


@pytest.mark.parametrize('target_state',['expired','revoked'])
def test_actual_install_target_authority_still_required(context,target_state):
    owner=Database(context[4]);a=new_grant(context);g=new_grant(context);limits={'local_compute':100}
    policy.install(owner,a,limits=limits,amendment_sha256='0'*64)
    if target_state=='expired':
        g=g.model_copy(update={'expires_at':now()-timedelta(seconds=1)})
        with pytest.raises(ValueError,match='exact current run-derived grant required'):policy.install(owner,g,limits=limits)
        with owner.transaction() as c:
            assert c.execute('SELECT 1 FROM tool_grants WHERE id=%s',(g.id,)).fetchone() is None
            assert c.execute('SELECT 1 FROM tool_budget_accounts WHERE id=%s',(g.budget_account_id,)).fetchone() is None
    else:
        policy.install(owner,g,limits=limits)
        with owner.transaction() as c:
            c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,));before=rows(c,[g.id])
        with pytest.raises(ValueError,match='immutable grant readback mismatch'):policy.install(owner,g,limits=limits)
        with owner.transaction() as c:assert rows(c,[g.id])==before
