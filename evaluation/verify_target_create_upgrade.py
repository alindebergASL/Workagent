"""Disposable original078 restore:079 rollback/retry and historical preservation."""
import os,subprocess,uuid,json
from urllib.parse import urlsplit,urlunsplit
import amend_target_create_rejection as T
A=T.A

def main():
 os.umask(0o077)
 b=json.loads((T.CAMPAIGN.parent/'live-bindings.private.json').read_bytes())[T.TRIAL]
 parts=urlsplit(b['migration_database_url']);name='workagent_test_target_restore_'+uuid.uuid4().hex[:10]
 dump=T.OUT/'before079-original.dump';assert T.digest(dump.read_bytes())==(T.OUT/'before079-original.sha256').read_text().strip()
 subprocess.run(['sudo','-u','postgres','createdb','-O',parts.username,name],check=True)
 with dump.open('rb') as f:subprocess.run(['sudo','-u','postgres','pg_restore','--exit-on-error','--no-owner','--no-acl','--role',parts.username,'--dbname',name],stdin=f,check=True)
 db=T.Database(urlunsplit(parts._replace(path='/'+name)))
 m={'migration_inventory':{p.name:T.digest(p.read_bytes()) for p in sorted((T.ROOT/'backend/migrations').glob('*.sql'))}}
 with db.transaction() as c:
  c.execute('SET TRANSACTION READ ONLY');before=A.tables(c);defs=A.definitions(c);resolution=A.resolution(c)['data']
 class Rollback(Exception):pass
 try:
  with db.transaction() as c:
   c.execute((T.ROOT/'backend/migrations'/T.MIGRATION).read_text());afterdefs=A.definitions(c);raise Rollback()
 except Rollback:pass
 m['sql_definitions']=dict(before=defs,after=afterdefs)
 def crash():raise Rollback()
 try:T.apply(db,m,crash)
 except Rollback:pass
 else:raise AssertionError('rollback hook not reached')
 with db.transaction() as c:assert A.tables(c)==before and A.definitions(c)==defs
 T.apply(db,m)
 with db.transaction() as c:
  after=A.tables(c);assert all(after[n]==h for n,h in before.items() if n!='schema_migrations')
 T.apply(db,m)
 with db.transaction() as c:
  assert A.tables(c)==after and A.resolution(c)['data']==resolution
  assert c.execute("SELECT data->>'status' status FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",(A.TOOL,)).fetchone()['status']=='outcome_unknown'
  assert c.execute('SELECT count(*) n FROM tool_cost_entries WHERE attempt_id=%s',(A.TOOL,)).fetchone()['n']==2
  assert not c.execute("SELECT 1 FROM tool_attempts WHERE run_id=%s AND call_id='selection_6'",(A.RUN,)).fetchone()
  from workagent.capabilities.registry import adapters
  catalog=adapters();pins=0
  for r in c.execute('SELECT data FROM tool_grants').fetchall():
   for pin in r['data']['capabilities']:
    d=catalog[pin['id']].descriptor;assert pin=={k:getattr(d,k) for k in pin};pins+=1
 result=dict(scope='disposable_restored_original078',database=name,source_dump_sha256=T.digest(dump.read_bytes()),
  migration_sha256=m['migration_inventory'][T.MIGRATION],sql_definitions=m['sql_definitions'],resolution=resolution,
  rollback=True,idempotent=True,original_tables_preserved=len(before)-1,original_table_hashes=before,
  descriptor_pins=pins,unknown_costs_and_resolution_preserved=True,installed_original_mutations=0,provider_io=0)
 T.G.exact_bytes(T.OUT/'RESTORED_VERIFICATION.json',(T.canonical(result)+'\n').encode())
 print(T.canonical({k:v for k,v in result.items() if k not in ['original_table_hashes','sql_definitions','resolution']}))
if __name__=='__main__':main()
