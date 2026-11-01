"""Exact additive078→079 installation; no resolution/funding/provider changes."""
import argparse,fcntl,json,sqlite3
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
import amend_file_input_rejection as A
from study_controller import Controller,canonical,digest
from study_binding import environment
from network_harness import inventory
Database=A.Database;G=A.G;AM=A.AM;ROOT=A.ROOT;CAMPAIGN=A.CAMPAIGN;SLOT=A.SLOT;TRIAL=A.TRIAL
OUT=ROOT/'.local/batch3/b35c/target-create-recovery'
PREDECESSOR='65b3ab97a595b49d56712ca6310cff2accd569f34b134128cf6267a540e79781'
SNAPSHOT=OUT/'predecessor-fc0829e9dd3b66589369ac255b247d84fa716bd0fb4f63f5bf292e2d80a5d1b7'
MIGRATION='079_target_create_rejection.sql'
PRODUCT=['adaptive.py','general_worker.py']
FILES=['backend/workagent/'+p for p in PRODUCT]+['backend/migrations/'+MIGRATION,
 'backend/tests/test_target_create_rejection.py','evaluation/install_recipient_funding.py',
 'evaluation/study_source_amendment.py','evaluation/amend_target_create_rejection.py',
 'evaluation/verify_target_create_upgrade.py','evaluation/test_target_create_install.py']

def state(c,m):
 actual=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
 expected=[dict(name=k,checksum=v) for k,v in sorted(m['migration_inventory'].items())]
 assert expected[-1]['name']==MIGRATION and actual in (expected[:-1],expected),'exact078_or079_required'
 installed=actual==expected
 assert A.definitions(c)==m['sql_definitions']['after' if installed else 'before'],'sql_definition_drift'
 return installed

def apply(db,m,hook=lambda:None):
 with db.transaction() as c:
  c.execute('SELECT pg_advisory_xact_lock(17402111)')
  if not state(c,m):
   raw=(ROOT/'backend/migrations'/MIGRATION).read_bytes();assert digest(raw)==m['migration_inventory'][MIGRATION]
   c.execute(raw.decode());hook()
   c.execute('INSERT INTO schema_migrations(name,checksum) VALUES (%s,%s)',(MIGRATION,digest(raw)))
  assert state(c,m)

def targets(m):
 from install_recipient_funding import identity
 plans,bindings=G.exact_targets(m,source_amendment=m);assert len(plans)==12
 installed=[]
 for p in plans:
  identity(p,bindings[p['blind_id']])
  with Database(bindings[p['blind_id']]['migration_database_url']).transaction() as c:
   c.execute('SET TRANSACTION READ ONLY');A.connected(c,p);installed.append(state(c,m))
   if p['blind_id']==TRIAL:assert A.resolution(c)['data']==m['resolution']
 return plans,bindings,installed

def prepare():
 assert not (OUT/'CANDIDATE.json').exists()
 raw=AM.MANIFEST.read_bytes();assert digest(raw)==PREDECESSOR and AM.APPROVAL.read_text().strip()==PREDECESSOR
 assert (OUT/'PREDECESSOR.json').read_bytes()==raw
 previous=json.loads(raw);m=deepcopy(previous);old=inventory(SNAPSHOT);new=inventory(ROOT/'backend/workagent')
 assert digest(canonical(old))==previous['execution_sources']['B1']
 changed={p for p in set(old)|set(new) if old.get(p)!=new.get(p)};assert changed==set(PRODUCT),changed
 for p,h in previous['files'].items():
  if p not in FILES:assert digest((ROOT/p).read_bytes())==h,p
 for p in FILES:m['files'][p]=digest((ROOT/p).read_bytes())
 proof=json.loads((OUT/'RESTORED_VERIFICATION.json').read_bytes())
 assert proof['migration_sha256']==m['files']['backend/migrations/'+MIGRATION]
 m['files'][str((OUT/'RESTORED_VERIFICATION.json').relative_to(ROOT))]=digest((OUT/'RESTORED_VERIFICATION.json').read_bytes())
 m['sql_definitions']=proof['sql_definitions'];assert proof['resolution']==previous['resolution']
 m['migration_inventory'][MIGRATION]=m['files']['backend/migrations/'+MIGRATION]
 m['migration_additions']['/product/migrations/'+MIGRATION]='backend/migrations/'+MIGRATION
 m['execution_sources'].update(B1=digest(canonical(new)),M1=digest(canonical(new)))
 m['binding_name']='target-create-rejection-v1'
 m['target_create_continuation']=dict(predecessor_manifest=str((OUT/'PREDECESSOR.json').relative_to(ROOT)),
  predecessor_sha256=PREDECESSOR,historical_snapshot=str(SNAPSHOT.relative_to(ROOT)),predecessor_execution_sources=previous['execution_sources'],
  product_delta={p:dict(before=old.get(p),after=new.get(p)) for p in sorted(changed)},same_run=A.RUN,same_attempt=A.ATTEMPT,
  reason='exact material-free pre-dispatch targeted-create rejection',no_clean_original_cohort_claim=True,B0_recovery='unimplemented_denied')
 plans,bindings,installed=targets(m);assert not any(installed)
 before=(SLOT/'application.json').read_bytes();app=json.loads(before)
 assert app['source_manifest_sha256']==previous['execution_sources']['B1'] and app['collected']==1 and app['episode']==2 and app['current_run']==A.RUN
 G.exact_bytes(OUT/'application-before.json',before);m['application_before_sha256']=digest(before)
 for name in ('controller','bridge'):
  with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:
   with sqlite3.connect(OUT/(name+'.sqlite')) as target:c.backup(target)
 with G.readonly(OUT/'bridge.sqlite') as c:bridge=c.execute('SELECT value FROM admission_binding').fetchone()[0]
 with G.readonly(OUT/'controller.sqlite') as c:controller=c.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]
 with patch.object(AM,'load',lambda:m):
  env=environment();mapping=json.loads(bridge)['live_mapping_sha256']
  fresh=Controller(OUT/'fresh.sqlite',SimpleNamespace(live_mapping_sha256=mapping),mode='official_api')
  new_controller=fresh.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0];fresh.close()
  m['bindings']={k:dict(before=digest(a),after=digest(b)) for k,a,b in [('controller',controller,new_controller),('bridge',bridge,canonical(dict(environment=env,live_mapping_sha256=mapping)))]}
  assert all(m['bindings'][k]['before']==previous['bindings'][k]['before'] for k in m['bindings'])
  app.update(source_manifest_sha256=m['execution_sources']['B1'],environment=env)
  after=(canonical(app)+'\n').encode();m['application_after_sha256']=digest(after);G.exact_bytes(OUT/'application-after.json',after)
  from study_diagnostic import ProductAdapter
  adapter=ProductAdapter(OUT,None,live_bindings=bindings,credential=None);ctl=Controller(OUT/'controller.sqlite',adapter,mode='official_api');ctl.close();adapter.close()
 journals={}
 for name,table in [('controller','operations'),('bridge','receipts')]:
  with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:journals[table]=G.logical(c,table)
  with G.readonly(OUT/(name+'.sqlite')) as c:assert G.logical(c,table)==journals[table]
 m['target_create_continuation']['journals']=journals
 G.exact_bytes(OUT/'CANDIDATE.json',(canonical(m)+'\n').encode())
 print(canonical(dict(prepared=True,manifest_sha256=digest((OUT/'CANDIDATE.json').read_bytes()),files=len(m['files']),provider_io=0)))

def file_state(m,raw,installed):
 successor=digest(raw)
 actual=(digest((SLOT/'application.json').read_bytes()),digest(AM.MANIFEST.read_bytes()),AM.APPROVAL.read_text().strip())
 pristine=(m['application_before_sha256'],PREDECESSOR,PREDECESSOR)
 assert actual in [pristine,(m['application_after_sha256'],PREDECESSOR,PREDECESSOR),(m['application_after_sha256'],successor,PREDECESSOR),(m['application_after_sha256'],successor,successor)]
 assert actual==pristine or all(installed),'advanced_files_require_all079'
 assert digest((OUT/'application-after.json').read_bytes())==m['application_after_sha256']

def lineage(m):
 link=m['target_create_continuation']
 path=(ROOT/link['predecessor_manifest']).resolve();snapshot=(ROOT/link['historical_snapshot']).resolve()
 assert path==(OUT/'PREDECESSOR.json').resolve() and snapshot==SNAPSHOT.resolve()
 raw=path.read_bytes();assert digest(raw)==PREDECESSOR==link['predecessor_sha256']
 old=json.loads(raw);before=inventory(snapshot);after=inventory(ROOT/'backend/workagent')
 assert digest(canonical(before))==old['execution_sources']['B1']
 assert link['predecessor_execution_sources']==old['execution_sources']
 assert m['execution_sources']['B1']==m['execution_sources']['M1']==digest(canonical(after))
 changes={p:dict(before=before.get(p),after=after.get(p)) for p in set(before)|set(after) if before.get(p)!=after.get(p)}
 assert set(changes)==set(PRODUCT) and link['product_delta']==changes
 for key in ['successor','file_input_continuation','resolution']:assert m[key]==old[key]
 return old

def install(review):
 raw=(OUT/'CANDIDATE.json').read_bytes();m=json.loads(raw);v=json.loads(review.read_bytes())
 assert v['verdict']=='PASS' and v['manifest_sha256']==digest(raw)
 assert digest((ROOT/v['report']).read_bytes())==v['report_sha256']
 assert all(digest((ROOT/p).read_bytes())==h for p,h in m['files'].items())
 old=lineage(m)
 with (CAMPAIGN/'controller.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  plans,bindings,installed=targets(m)
  for name,table in [('controller','operations'),('bridge','receipts')]:
   with G.readonly(CAMPAIGN/(name+'.sqlite')) as c:assert G.logical(c,table)==m['target_create_continuation']['journals'][table]
  file_state(m,raw,installed)
  installed_dir=OUT/'installed';installed_dir.mkdir(exist_ok=True)
  for p in plans:
   db=Database(bindings[p['blind_id']]['migration_database_url'])
   dump=installed_dir/(p['database']+'.before079.dump');G.backup(p['database'],dump)
   fiscal=G.preserved_rows(p['database'])
   with db.transaction() as c:c.execute('SET TRANSACTION READ ONLY');before=A.tables(c)
   apply(db,m)
   with db.transaction() as c:
    c.execute('SET TRANSACTION READ ONLY');after=A.tables(c)
    assert all(after[n]==h for n,h in before.items() if n!='schema_migrations')
    if p['blind_id']==TRIAL:assert A.resolution(c)['data']==m['resolution']
   assert G.preserved_rows(p['database'])==fiscal
   G.save(installed_dir/(p['blind_id']+'.json'),dict(database=p['database'],backup_sha256=digest(dump.read_bytes()),fiscal=fiscal))
  with patch.object(A.D,'OUT',OUT),patch.object(A.D,'PREDECESSOR',PREDECESSOR):A.D.activate_files(SLOT/'application.json',raw,m)
  assert AM.load()==m
  from install_recipient_funding import mapping
  assert len(mapping()[0])==12
  G.exact_bytes(OUT/'ACTIVATED.json',(canonical(dict(manifest_sha256=digest(raw),stores=12,provider_io=0,new_certificates=0,resolution_imports=0))+'\n').encode())
 print(canonical(dict(activated=True,manifest_sha256=digest(raw))))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','install']);p.add_argument('--review',type=A.Path);a=p.parse_args()
 if a.action=='prepare':prepare()
 else:install(a.review)
