"""Restored-original077 proof:078 transaction + historical no-effect, no network."""
import os,subprocess,uuid,json
from urllib.parse import urlsplit,urlunsplit
import amend_file_input_rejection as A
from workagent.db import Database
from psycopg import sql

def main():
    os.umask(0o077);A.OUT.mkdir(exist_ok=True)
    bindings=json.loads((A.CAMPAIGN.parent/'live-bindings.private.json').read_bytes());b=bindings[A.TRIAL]
    parts=urlsplit(b['migration_database_url']);name='workagent_test_file_restore_'+uuid.uuid4().hex[:10]
    dump=A.OUT.parent/'before078-original.dump'
    assert A.digest(dump.read_bytes())==(A.OUT.parent/'before078-original.sha256').read_text().strip()
    subprocess.run(['sudo','-u','postgres','createdb','-O',parts.username,name],check=True)
    with dump.open('rb') as f:subprocess.run(['sudo','-u','postgres','pg_restore','--exit-on-error','--no-owner','--no-acl','--role',parts.username,'--dbname',name],stdin=f,check=True)
    db=Database(urlunsplit(parts._replace(path='/'+name)))
    m={'migration_inventory':{p.name:A.digest(p.read_bytes()) for p in sorted((A.ROOT/'backend/migrations').glob('*.sql'))}}
    with db.transaction() as c:
        c.execute('SET TRANSACTION READ ONLY');before=A.tables(c);defs=A.definitions(c)
    class Rollback(Exception):pass
    try:
        with db.transaction() as c:
            c.execute((A.ROOT/'backend/migrations'/A.MIGRATION).read_text());afterdefs=A.definitions(c)
            raise Rollback()
    except Rollback:pass
    m['sql_definitions']=dict(before=defs,after=afterdefs)
    def crash():raise Rollback()
    try:A.apply(db,m,crash)
    except Rollback:pass
    else:raise AssertionError('rollback hook not reached')
    with db.transaction() as c:assert A.tables(c)==before and A.definitions(c)==defs
    A.apply(db,m)
    with db.transaction() as c:
        after=A.tables(c);assert all(after[n]==h for n,h in before.items() if n!='schema_migrations')
        m['resolution']=c.execute('SELECT file_input_no_effect_evidence(%s,%s,%s) data',(A.TOOL,A.ATTEMPT,A.PHASE)).fetchone()['data']
        assert m['resolution'] is not None
        # Source proof actually binds current and preserved historical implementation.
        proof=m['resolution']['source_proof']
        for group in ['implementation_sources','support_sources']:
            for rel,h in proof[group].items():
                assert A.digest((A.ROOT/'backend/workagent'/rel).read_bytes())==h,rel
                if not rel.startswith('../'):assert A.digest((A.SNAPSHOT/rel).read_bytes())==h,rel
    A.apply(db,m)
    with db.transaction() as c:assert A.tables(c)==after
    try:A.import_resolution(db,m,crash)
    except Rollback:pass
    else:raise AssertionError('resolution rollback not reached')
    with db.transaction() as c:assert A.tables(c)==after
    A.import_resolution(db,m)
    with db.transaction() as c:resolved=A.tables(c)
    A.import_resolution(db,m)
    with db.transaction() as c:
        assert A.tables(c)==resolved
        assert all(resolved[n]==h for n,h in after.items() if n!='file_input_no_effect_resolutions')
        assert c.execute("SELECT data->>'status' status FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",(A.TOOL,)).fetchone()['status']=='outcome_unknown'
        assert c.execute('SELECT count(*) n FROM tool_cost_entries WHERE attempt_id=%s',(A.TOOL,)).fetchone()['n']==2
        from workagent.capabilities.registry import adapters
        catalog=adapters();pins=0
        for r in c.execute('SELECT data FROM tool_grants').fetchall():
            for pin in r['data']['capabilities']:
                descriptor=catalog[pin['id']].descriptor
                assert pin=={k:getattr(descriptor,k) for k in pin};pins+=1
    result=dict(scope='disposable_restored_original077',database=name,source_dump_sha256=A.digest(dump.read_bytes()),
      migration_sha256=m['migration_inventory'][A.MIGRATION],sql_definitions=m['sql_definitions'],resolution=m['resolution'],
      rollback=True,idempotent=True,resolution_rollback=True,resolution_idempotent=True,
      original_tables_preserved=len(before)-1,original_table_hashes=before,descriptor_pins=pins,unknown_and_costs_preserved=True,
      installed_original_mutations=0,provider_io=0)
    A.G.exact_bytes(A.OUT/'RESTORED_VERIFICATION.json',(A.canonical(result)+'\n').encode())
    print(A.canonical({k:v for k,v in result.items() if k not in ['original_table_hashes','sql_definitions','resolution']}))
if __name__=='__main__':main()
