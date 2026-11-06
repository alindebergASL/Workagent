"""Disposable clone only, network hard-denied; trace exact retained worker."""
import json,os,shutil,subprocess,time,uuid
from urllib.parse import urlsplit,urlunsplit
from unittest.mock import patch
import amend_selection_recovery as S
from workagent.db import Database
from workagent.service import Service,Principal
from workagent.general_worker import GeneralWorker
from workagent.responses_transport import ResponsesTransport,TransportError


def main():
    os.umask(0o077)
    state=json.loads((S.SLOT/'application.json').read_bytes())
    b=json.loads((S.CAMPAIGN.parent/'live-bindings.private.json').read_bytes())[S.TRIAL]
    parts=urlsplit(b['migration_database_url']);name='workagent_test_stall_'+uuid.uuid4().hex[:10]
    root=S.OUT/('stall-'+name);root.mkdir()
    dump=root/'original.dump';S.G.backup(parts.path[1:],dump)
    subprocess.run(['sudo','-u','postgres','createdb','-O',parts.username,name],check=True)
    with dump.open('rb') as f:subprocess.run(['sudo','-u','postgres','pg_restore','--exit-on-error','--no-owner','--no-acl','--role',parts.username,'--dbname',name],stdin=f,check=True)
    # Clone-only runtime ACLs reproduce actual restricted service access.
    runtime=urlsplit(b['database_url']).username
    from psycopg import sql
    with Database(urlunsplit(parts._replace(path='/'+name))).transaction() as c:
        c.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {}').format(sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {}').format(sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO {}').format(sql.Identifier(runtime)))
    shutil.copytree(S.SLOT/'worker-state',root/'state')
    db=Database(urlunsplit(urlsplit(b['database_url'])._replace(path='/'+name)));db.check_runtime_role()
    service=Service(db);grant=b['grant']['responses']
    transport=ResponsesTransport(credential='diagnostic-invalid-no-network',project_id=grant['project_id'],credential_reference=grant['secret_reference'],enabled=True)
    worker=GeneralWorker(service,transport=transport,state=root/'state',enable_responses=True)
    trace=[]
    original_window=worker.phases._http_window
    def window(run,deadline,**kw):
        from workagent.service import now
        remaining=(run.lease_expires_at-now()).total_seconds()
        result=original_window(run,deadline,**kw)
        trace.append(dict(method='_http_window',lease_remaining=remaining,deadline_remaining=deadline-time.monotonic(),handoff=kw.get('handoff',False),result=result))
        return result
    worker.phases._http_window=window
    def deny(*a,**kw):raise AssertionError('NETWORK_HARD_DENIED')
    def wrap(obj,name):
        original=getattr(obj,name)
        def call(*a,**kw):
            start=time.monotonic()
            try:
                result=original(*a,**kw)
                trace.append(dict(method=name,phase=getattr(a[1] if name=='_step' else a[0] if a else None,'phase',None),seconds=time.monotonic()-start,result=getattr(result,'state',result if isinstance(result,(bool,type(None))) else type(result).__name__)))
                return result
            except Exception as exc:
                trace.append(dict(method=name,seconds=time.monotonic()-start,error=type(exc).__name__,code=getattr(exc,'code',None),sql_reason=getattr(getattr(exc,'diag',None),'message_primary',None)))
                raise
        setattr(obj,name,call)
    for n in ['_step','_http_ready','_reserve_http']:wrap(worker.phases,n)
    wrap(transport,'restore_count')
    try:
        started=time.monotonic()
        with patch.object(transport._client,'request',deny):
            result=worker.work(Principal(state['principal']),state['workspace'],state['current_run'])
        outcome=dict(state=result.state)
    except Exception as exc:outcome=dict(error=type(exc).__name__,code=str(getattr(exc,'code','')))
    finally:transport.close()
    report=dict(clone=name,network_calls=0,installed_mutations=0,trace=trace,outcome=outcome,total_worker_seconds=time.monotonic()-started)
    S.G.save(root/'TRACE.json',report);print(S.canonical(report))

if __name__=='__main__':main()
