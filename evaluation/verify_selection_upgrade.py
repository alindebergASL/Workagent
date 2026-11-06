"""Real restored-copy SQL rollback/retry and historical diagnostic binding."""
import json,os,subprocess,uuid
from urllib.parse import urlsplit,urlunsplit
from amend_selection_recovery import *
from psycopg import sql

def main():
    os.umask(0o077)
    bindings=json.loads((CAMPAIGN.parent/'live-bindings.private.json').read_bytes())
    b=bindings[TRIAL];parts=urlsplit(b['migration_database_url'])
    name='workagent_test_selection_restore_'+uuid.uuid4().hex[:10]
    dump=OUT/'before076-original.dump';G.backup(parts.path[1:],dump)
    subprocess.run(['sudo','-u','postgres','createdb','-O',parts.username,name],check=True)
    with dump.open('rb') as f:subprocess.run(['sudo','-u','postgres','pg_restore','--exit-on-error','--no-owner','--no-acl','--role',parts.username,'--dbname',name],stdin=f,check=True)
    db=Database(urlunsplit(parts._replace(path='/'+name)))
    m={'migration_inventory':{p.name:digest(p.read_bytes()) for p in sorted((ROOT/'backend/migrations').glob('*.sql'))},
        'selection_recovery_binding':{'sha256':digest((OUT/'LIVE_BINDING.private.json').read_bytes())}}
    def snapshot():
        with db.transaction() as c:
            names=[r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()]
            return {n:digest(canonical(c.execute(sql.SQL('SELECT to_jsonb(t) row FROM {} t ORDER BY to_jsonb(t)::text').format(sql.Identifier(n))).fetchall())) for n in names}
    def crash():raise InterruptedError('injected transaction rollback')
    before=snapshot()
    try:apply076(db,m,crash)
    except InterruptedError:pass
    else:raise AssertionError('rollback hook not reached')
    assert snapshot()==before
    apply076(db,m);after=snapshot()
    assert all(after[n]==h for n,h in before.items() if n!='schema_migrations')
    apply076(db,m);assert snapshot()==after
    try:import_diagnostic(db,m,crash)
    except InterruptedError:pass
    else:raise AssertionError('diagnostic rollback not reached')
    assert snapshot()==after
    import_diagnostic(db,m);imported=snapshot();import_diagnostic(db,m);assert snapshot()==imported
    assert all(imported[n]==h for n,h in after.items() if n!='selection_rejection_diagnostics')
    saved,raw=saved_binding()
    runtime=urlsplit(b['database_url']).username
    with db.transaction() as c:
        c.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}').format(sql.Identifier(runtime)))
        assert c.execute('SELECT count(*) n FROM selection_rejection_diagnostics').fetchone()['n']==1
        # These are original exact descriptor pins, not a source-rebased grant.
        from workagent.capabilities.registry import adapters
        catalog=adapters()
        rows=c.execute('SELECT data FROM tool_grants').fetchall()
        checked=0
        for row in rows:
            for pin in row['data']['capabilities']:
                d=catalog[pin['id']].descriptor
                assert pin=={k:getattr(d,k) for k in pin},pin['id']
                checked+=1
    Database(urlunsplit(urlsplit(b['database_url'])._replace(path='/'+name))).check_runtime_role()
    result=dict(scope='disposable_restored_original075',database=name,source_dump_sha256=digest(dump.read_bytes()),
        rollback=True,idempotent_retry=True,diagnostic_rollback=True,diagnostic_idempotent=True,
        original_tables_preserved=len(before)-1,original_row_hashes=before,descriptor_pins_verified=checked,
        installed_mutations=0,new_provider_io=0,original_result_unchanged=True,
        migration_sha256=m['migration_inventory'][MIGRATION])
    G.exact_bytes(OUT/'RESTORED_VERIFICATION.json',(canonical(result)+'\n').encode())
    print(canonical({k:v for k,v in result.items() if k!='original_row_hashes'}))
if __name__=='__main__':main()
