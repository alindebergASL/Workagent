"""Exact retained-read release: prepare, disposable trial, install, readback, publish.

Never invokes a worker or provider transport. Owner operations are explicit CLI phases.
The real implementation API computes source identity; this program never injects it.
"""
import argparse
from collections import Counter
from contextlib import contextmanager
from copy import deepcopy
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import uuid
from unittest.mock import patch
from urllib.parse import urlsplit

SOURCE='1f5806a8df2a3c41af16ba27bdb7dc316d2f04e56596d32e5d74d257f1d6be62'
CONSUMER='300262fd378e03370ce27444382c620fb4ea78b1699e8f55d2dd3be61cf20868'
PREDECESSOR='9c6ef4484e8ca944fb2c66c77fd0dcf0084670036782e19f0729af5853558b3f'
RUN='daacd79b-f1ab-4af9-a3d0-0699c2d03a45'
TRIAL='d477c622c837a9cc1fb1f0be'
MIGRATIONS=('080_builtin_operation_classification.sql','081_capability_implementation_releases.sql','082_native_retained_result_projection.sql','083_source_cohorts_file_envelope.sql','084_model_discovery_v2.sql')
NEW_TABLES={'public.capability_implementation_releases','public.tool_grant_implementation_bindings','public.tool_attempt_implementation_bindings','public.model_discovery_receipts_v2'}


class InstallError(RuntimeError):pass

def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,default=str)
def digest(v):return sha256(v if isinstance(v,bytes) else v.encode()).hexdigest()
def check(value,code):
    if not value:raise InstallError(code)
def progress(phase):print(canonical({'progress':phase}),flush=True)
def save(p,v):exact(p,(canonical(v)+'\n').encode())
def exact(p,data):
    check(not p.is_symlink(),'artifact_symlink')
    if p.exists():check(p.read_bytes()==data,'immutable_artifact_drift');return
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    fsync_dir(p.parent)
def fsync_dir(p):
    fd=os.open(p,os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def safe(root,name):
    p=root/name
    check(not Path(name).is_absolute() and '..' not in Path(name).parts,'unsafe_path')
    check(p.resolve().is_relative_to(root.resolve()) and not any(q.is_symlink() for q in (p,*p.parents) if q.is_relative_to(root)),'unsafe_path')
    return p


def verify_files(root,files):
    for name,h in files.items():check(digest(safe(root,name).read_bytes())==h,'file_drift:'+name)


def actual_identity(root):
    from workagent.capabilities import implementation_releases as R
    check(Path(R.__file__).resolve()==root/'backend/workagent/capabilities/implementation_releases.py','wrong_runtime_import')
    identity=R.execution_identity()
    check((identity['source_sha256'],identity['consumer_sha256'])==(SOURCE,CONSUMER),'execution_identity_drift')
    return identity


def snapshot(c):
    from psycopg import sql
    names=c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()
    result={}
    for item in names:
        name=item['tablename']
        rows=c.execute(sql.SQL('SELECT to_jsonb(t) row FROM {} t ORDER BY to_jsonb(t)::text').format(sql.Identifier(name))).fetchall()
        result['public.'+name]=dict(rows=len(rows),sha256=digest(canonical(rows)),row_hashes=sorted(digest(canonical(r)) for r in rows))
    return result


def summary(tables):return {n:{k:v for k,v in s.items() if k!='row_hashes'} for n,s in tables.items()}


def preserved(before,after):
    check(set(after)==set(before)|NEW_TABLES,'unexpected_table_set')
    for name,old in before.items():
        if name=='public.schema_migrations':
            check(not (Counter(old['row_hashes'])-Counter(after[name]['row_hashes'])) and after[name]['rows']==84,'journal_history_changed')
        else:check(after[name]==old,'historical_rows_changed:'+name)


def functions(c):
    return {r['name']:digest(r['body']) for r in c.execute("SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY 1").fetchall()}


def schema_state(c,m):
    rows=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    expected=[dict(name=n,checksum=h) for n,h in sorted(m['migration_inventory'].items())]
    check(len(expected)==84 and rows in (expected[:79],expected),'exact079_or084_required')
    return len(rows)


def role(c,expected,*,owner):
    row=c.execute("SELECT current_database() database,(SELECT oid::bigint FROM pg_database WHERE datname=current_database()) oid,current_user,session_user,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,pg_get_userbyid(d.datdba)=current_user owns_db FROM pg_roles r,pg_database d WHERE r.rolname=current_user AND d.datname=current_database()").fetchone()
    check(row['database']==expected['database'] and row['oid']==expected['oid'],'physical_identity_drift')
    check(row['current_user']==row['session_user']==expected['owner' if owner else 'runtime'],'role_identity_drift')
    check(not any(row[k] for k in ('rolsuper','rolbypassrls','rolcreatedb','rolcreaterole')) and row['owns_db']==owner,'unsafe_database_role')
    if not owner:check(not c.execute("SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user LIMIT 1").fetchone(),'runtime_owns_tables')
    return row


def routing(binding,expected,*,disposable=False,originals=()):
    check(not any(os.environ.get(k) for k in ('PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGPORT')),'ambient_libpq_override')
    a=urlsplit(binding['database_url']);b=urlsplit(binding['migration_database_url'])
    check(a.scheme==b.scheme=='postgresql' and a.hostname==b.hostname and a.hostname in ('127.0.0.1','localhost'),'local_explicit_dsns_required')
    check(not any((a.query,b.query,a.fragment,b.fragment)) and (a.port or 5432)==(b.port or 5432),'dsn_override')
    check(a.path==b.path=='/'+expected['database'] and a.username==expected['runtime'] and b.username==expected['owner'] and a.username!=b.username,'dsn_identity')
    check(bool(re.fullmatch('workagent_test_[a-zA-Z0-9_]+',expected['database'])),'database_name')
    if disposable:
        check(os.environ.get('WORKAGENT_TEST_DATABASE')==expected['database'] and expected['database'] not in originals,'explicit_disposable_required')


def grant_ids(c):return [r['id'] for r in c.execute('SELECT id FROM tool_grants ORDER BY id').fetchall()]


def predecessor_tools_available(c,expected_grant_ids):
    rows=c.execute('SELECT id,workspace_id,run_id FROM tool_grants ORDER BY id').fetchall()
    check([r['id'] for r in rows]==expected_grant_ids,'grant_set_drift')
    for row in rows:
        check(c.execute('SELECT tool_run_available(%s,%s) ok',(row['workspace_id'],row['run_id'])).fetchone()['ok'],'current_tools_denied')


def release_readback(c,m,gids):
    from workagent.capabilities import implementation_releases as R,registry
    identity=actual_identity(Path(m['_root']))
    rows=c.execute('SELECT * FROM tool_grant_implementation_bindings ORDER BY grant_id,capability_id').fetchall()
    expected=[]
    for gid in gids:
        g=c.execute('SELECT * FROM tool_grants WHERE id=%s',(gid,)).fetchone()
        check(g and g['active'],'inactive_existing_grant')
        for pin in g['data']['capabilities']:
            check(pin['id'] in R.TRANSITION_IDS,'unsupported_original_pin')
            d=registry.adapters()[pin['id']].descriptor.model_dump(mode='json')
            old=c.execute('SELECT descriptor FROM capability_installations WHERE id=%s AND version=%s',(pin['id'],pin['version'])).fetchone()['descriptor']
            check(pin=={k:old[k] for k in pin} and R.compatible(old,d),'historical_pin_drift')
            expected.append((gid,pin['id'],R.release_id(d,identity),pin))
        check(c.execute('SELECT tool_run_available(%s,%s) ok',(g['workspace_id'],g['run_id'])).fetchone()['ok'],'current_tools_denied')
    check(len(rows)==len(expected),'exact_release_binding_count')
    for gid,cid,rid,pin in expected:
        row=next(x for x in rows if x['grant_id']==gid and x['capability_id']==cid)
        check(row['release_sha256']==rid and row['predecessor_pin']==pin and row['amendment_sha256']==m['_amendment'] and row['predecessor_source_sha256']==m['release_transition']['predecessor_execution_sources']['B1'],'release_binding_drift')
        check(row['source_sha256']==SOURCE and row['consumer_sha256']==CONSUMER,'release_identity_drift')
        record=c.execute('SELECT * FROM capability_implementation_releases WHERE release_sha256=%s',(rid,)).fetchone()
        d=registry.adapters()[cid].descriptor.model_dump(mode='json')
        check(record and record['enabled'] and all(record[k]==v for k,v in R.release_record(d,identity).items()),'release_record_drift')
        old=c.execute('SELECT descriptor FROM capability_installations WHERE id=%s AND version=%s',(cid,pin['version'])).fetchone()['descriptor']
        body=dict(grant_id=gid,capability_id=cid,predecessor_pin=pin,predecessor_installation_sha256=digest(canonical(old)),
            predecessor_source_sha256=m['release_transition']['predecessor_execution_sources']['B1'],release_sha256=rid,
            source_sha256=SOURCE,consumer_sha256=CONSUMER,amendment_sha256=m['_amendment'])
        check(row==dict(binding_id=digest(canonical(body)),**body),'complete_binding_record_drift')
        check(c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',(gid,cid,SOURCE,CONSUMER)).fetchone()['d']==d,'runtime_descriptor_denied')
    check(c.execute('SELECT count(*) n FROM capability_implementation_releases').fetchone()['n']==len({r[2] for r in expected}),'unexpected_release_rows')
    check(c.execute('SELECT count(*) n FROM tool_attempt_implementation_bindings').fetchone()['n']==0,'historical_attempt_rebound')


class ConnectionDB:
    def __init__(self,c):self.c=c
    @contextmanager
    def transaction(self):
        with self.c.transaction():yield self.c


def runtime_acl_readback(c,target):
    """Verify ordinary081/084 grants for the actual target runtime, without repair."""
    for privilege in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'):
        allowed=c.execute('SELECT has_table_privilege(%s,%s,%s) ok',
            (target['runtime'],'public.model_discovery_receipts_v2',privilege)).fetchone()['ok']
        check(allowed==(privilege in ('SELECT','INSERT')),'discovery_receipt_runtime_acl')
    check(c.execute('SELECT has_function_privilege(%s,%s,%s) ok',
        (target['runtime'],'public.reserve_tool_call_v2(text,text,integer,text,jsonb,text,text,text)','EXECUTE')).fetchone()['ok'],
        'reservation_runtime_acl')


def apply_connection(c,m,target,before):
    from workagent.capabilities import implementation_releases as R
    root=Path(m['_root']);role(c,target,owner=True)
    c.execute('SELECT pg_advisory_xact_lock(17402111)')
    state=schema_state(c,m)
    if state==79:
        check(snapshot(c)==before,'pre_install_history_drift')
        check(functions(c)==m['release_transition']['predecessor_functions'],'predecessor_function_drift')
        for name in MIGRATIONS:
            raw=(root/'backend/migrations'/name).read_bytes()
            check(digest(raw)==m['migration_inventory'][name],'migration_file_drift')
            c.execute(raw.decode())
            c.execute('INSERT INTO schema_migrations(name,checksum) VALUES(%s,%s)',(name,digest(raw)))
    gids=grant_ids(c)
    check(gids==target['grant_ids'],'grant_set_drift')
    if gids:
        check(R.install_transition(ConnectionDB(c),gids,amendment_sha256=m['_amendment'],predecessor_source_sha256=m['release_transition']['predecessor_execution_sources']['B1'])==actual_identity(root),'install_identity_drift')
    check(schema_state(c,m)==84,'migration_install_failed')
    runtime_acl_readback(c,target)
    preserved(before,snapshot(c));release_readback(c,m,gids)


def readonly(db,fn):
    with db.transaction() as c:
        c.execute('SET TRANSACTION READ ONLY')
        return fn(c)


def fiscal(database):
    # Existing trusted local postgres READ ONLY fiscal helper; never grant access.
    from amend_gateway_recovery import preserved_rows
    return preserved_rows(database)


def sqlite_tables(path):
    with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True) as c:
        check(c.execute('PRAGMA quick_check').fetchone()[0]=='ok','sqlite_backup_corrupt')
        names=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        return {n:digest(canonical(c.execute('SELECT * FROM "'+n.replace('"','""')+'" ORDER BY 1').fetchall())) for n in names}


def campaign_state(campaign):
    result={name:sqlite_tables(campaign/(name+'.sqlite')) for name in ('controller','bridge')}
    files={}
    for p in campaign.rglob('*'):
        if p.is_file() and (p.name=='application.json' or 'worker-state' in p.parts):
            check(not p.is_symlink(),'state_symlink');files[str(p.relative_to(campaign))]=digest(p.read_bytes())
    result['files']=files
    return result


@contextmanager
def campaign_lock(campaign):
    with (campaign/'controller.lock').open('a') as f:
        fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield


def backups(campaign,out,targets):
    from amend_gateway_recovery import backup
    for t in targets:
        path=out/'backups'/(t['database']+'.before080.dump');path.parent.mkdir(exist_ok=True)
        backup(t['database'],path)
        with path.open('rb') as f:os.fsync(f.fileno())
        fsync_dir(path.parent)
    # Never touch worker state; retain exact byte copies, plus consistent SQLite.
    for name in ('controller','bridge'):
        dest=out/'backups'/(name+'.sqlite')
        source=campaign/(name+'.sqlite')
        if not dest.exists():
            temp=dest.with_name(dest.name+'.'+uuid.uuid4().hex+'.partial')
            with sqlite3.connect('file:'+str(source)+'?mode=ro',uri=True) as src:
                with sqlite3.connect(temp) as dst:src.backup(dst)
            check(sqlite_tables(temp)==sqlite_tables(source),'sqlite_backup_mismatch')
            with temp.open('rb') as f:os.fsync(f.fileno())
            os.replace(temp,dest)
        check(sqlite_tables(dest)==sqlite_tables(source),'retained_sqlite_backup_drift')
        with dest.open('rb') as f:os.fsync(f.fileno())
    for p in campaign.rglob('*'):
        if p.is_file() and (p.name=='application.json' or 'worker-state' in p.parts):
            check(not p.is_symlink(),'state_symlink');exact(out/'backups/state'/p.relative_to(campaign),p.read_bytes())
    fsync_dir(out/'backups')


def review(root,path,candidate,trial):
    v=json.loads(path.read_bytes())
    check(v['verdict']=='PASS' and v['manifest_sha256']==digest(candidate) and v['trial_sha256']==digest(trial),'exact_review_required')
    check(digest(safe(root,v['report']).read_bytes())==v['report_sha256'],'review_report_drift')


def atomic_replace(path,raw):
    temp=path.with_name(path.name+'.retained-read.next')
    exact(temp,raw);os.replace(temp,path);fsync_dir(path.parent)


def publish_files(application,manifest,approval,before_app,prior,raw,after,hook=lambda _:None):
    successor=digest(raw)
    states=[(before_app,prior,prior),(digest(after),prior,prior),(digest(after),successor,prior),(digest(after),successor,successor)]
    def state():return digest(application.read_bytes()),digest(manifest.read_bytes()),approval.read_text().strip()
    check(state() in states,'unrecognized_publication_state')
    if state()==states[0]:atomic_replace(application,after);hook('application')
    if state()==states[1]:atomic_replace(manifest,raw);hook('manifest')
    if state()==states[2]:atomic_replace(approval,(successor+'\n').encode());hook('approval')
    check(state()==states[-1],'publication_readback')


def candidate_context(m):
    # Existing installer-only seam: approved-current image is verified first.
    # This selects a proposed manifest for constructors on COPIES, never alters
    # execution_identity, grants, official request provenance or active approval.
    import study_source_amendment as AM
    return patch.object(AM,'load',lambda:m)


def prepare(root,out,code_manifest,expected_snapshot):
    from workagent.db import Database
    import study_source_amendment as AM
    from network_harness import inventory
    from study_binding import environment
    from study_controller import Controller
    from study_diagnostic import ProductAdapter
    from types import SimpleNamespace
    from install_recipient_funding import mapping,identity as funding_identity
    code=json.loads(code_manifest.read_bytes());verify_files(root,code['files']);actual_identity(root)
    check(not out.exists(),'fresh_output_required');out.mkdir(mode=0o700,parents=True)
    previous_raw=AM.MANIFEST.read_bytes();check(digest(previous_raw)==PREDECESSOR and AM.APPROVAL.read_text().strip()==PREDECESSOR,'latest_predecessor_required')
    previous=json.loads(previous_raw);expected=json.loads(expected_snapshot.read_bytes())
    check(expected['active_source_amendment_sha256']==PREDECESSOR and expected['collected']==2,'original_checkpoint_drift')
    exact(out/'PREDECESSOR.json',previous_raw);exact(out/'PREDECESSOR.approved.sha256',AM.APPROVAL.read_bytes())
    exact(out/'EXPECTED_ORIGINAL.json',expected_snapshot.read_bytes())
    oldpath=root/'.local/batch3/b35c/retained-read-recovery'/('predecessor-'+previous['execution_sources']['B1'])
    check(not oldpath.is_symlink() and not any(p.is_symlink() for p in oldpath.rglob('*')),'historical_snapshot_symlink')
    old=inventory(oldpath);new=inventory(root/'backend/workagent')
    check(digest(canonical(old))==previous['execution_sources']['B1'] and digest(canonical(new))==SOURCE,'source_snapshot_drift')
    m=deepcopy(previous);m['binding_name']='native-retained-release-v1'
    m['execution_sources'].update(B1=SOURCE,M1=SOURCE)
    m['files'].update(code['files'])
    verify_files(root,m['files'])
    m['migration_inventory']={p.name:digest(p.read_bytes()) for p in sorted((root/'backend/migrations').glob('*.sql'))}
    check(len(m['migration_inventory'])==84 and {k:v for k,v in m['migration_inventory'].items() if k not in MIGRATIONS}==previous['migration_inventory'],'exact_migration_extension')
    for name in MIGRATIONS:m['migration_additions']['/product/migrations/'+name]='backend/migrations/'+name
    m['release_transition']=dict(predecessor_manifest=str((out/'PREDECESSOR.json').relative_to(root)),predecessor_sha256=PREDECESSOR,
        historical_snapshot=str(oldpath.relative_to(root)),predecessor_execution_sources=previous['execution_sources'],
        product_delta={n:dict(before=old.get(n),after=new.get(n)) for n in sorted(set(old)|set(new)) if old.get(n)!=new.get(n)},
        predecessor_functions=previous['sql_definitions']['after'],source_sha256=SOURCE,consumer_sha256=CONSUMER,
        same_run=RUN,phase='selection_3',provider_replay=False)
    campaign=root/'.local/batch3/b35c/live-study/campaign';app=campaign/TRIAL/'application.json'
    with campaign_lock(campaign):
        state=campaign_state(campaign)
        check(state['controller']['operations']==expected['journals']['operations']['sha256'] and state['bridge']['receipts']==expected['journals']['receipts']['sha256'],'controller_receipt_drift')
        check(state['files'][TRIAL+'/application.json']==expected['applications'][TRIAL],'application_checkpoint_drift')
        before=app.read_bytes();application=json.loads(before)
        check(application['episode']==3 and application['collected']==2 and application['current_run']==RUN and application['source_manifest_sha256']==previous['execution_sources']['B1'],'original_episode_drift')
        exact(out/'application-before.json',before)
        # Copies only; the stored original binding/operations/receipts are retained.
        for name in ('controller','bridge'):
            with sqlite3.connect('file:'+str(campaign/(name+'.sqlite'))+'?mode=ro',uri=True) as src:
                with sqlite3.connect(out/(name+'.sqlite')) as dst:src.backup(dst)
        with sqlite3.connect(out/'controller.sqlite') as c:controller=c.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]
        with sqlite3.connect(out/'bridge.sqlite') as c:bridge=c.execute('SELECT value FROM admission_binding').fetchone()[0]
        with candidate_context(m):
            env=environment();mapping_hash=json.loads(bridge)['live_mapping_sha256']
            fresh=Controller(out/'fresh.sqlite',SimpleNamespace(live_mapping_sha256=mapping_hash),mode='official_api')
            fresh_value=fresh.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0];fresh.close()
            m['bindings']={k:dict(before=digest(a),after=digest(b)) for k,a,b in [('controller',controller,fresh_value),('bridge',bridge,canonical(dict(environment=env,live_mapping_sha256=mapping_hash)))]}
            check(all(m['bindings'][k]['before']==previous['bindings'][k]['before'] for k in m['bindings']),'historical_binding_drift')
            plans,bindings=mapping(source_amendment=m)
            check(len(plans)==len(bindings)==12,'exact_twelve_stores')
            adapter=ProductAdapter(out,None,live_bindings=bindings,credential=None)
            ctl=Controller(out/'controller.sqlite',adapter,mode='official_api');ctl.close();adapter.close()
        copied=campaign_state(out)
        for db in ('controller','bridge'):
            for table,h in state[db].items():
                if (db,table) not in (('controller','binding'),('bridge','admission_amendments')):
                    check(copied[db][table]==h,'copied_controller_history_changed')
        application.update(source_manifest_sha256=SOURCE,environment=env)
        after=(canonical(application)+'\n').encode();exact(out/'application-after.json',after)
        m['application_before_sha256']=digest(before);m['application_after_sha256']=digest(after)
        baseline={};targets=[];total_pins=0
        for key,plan in sorted(plans.items()):
            progress('read_only_preflight:'+key)
            b=bindings[key];x=expected['stores'][key]
            target=dict(blind_id=key,database=plan['database'],oid=plan['database_oid'],owner=urlsplit(b['migration_database_url']).username,runtime=urlsplit(b['database_url']).username)
            check(target['database']==x['identity']['database'] and target['oid']==x['identity']['oid'],'checkpoint_identity')
            routing(b,target);funding_identity(plan,b)
            readonly(Database(b['database_url']),lambda c:role(c,target,owner=False))
            with Database(b['migration_database_url']).transaction() as c:
                c.execute('SET TRANSACTION READ ONLY');role(c,target,owner=True)
                check(schema_state(c,m)==79 and functions(c)==m['release_transition']['predecessor_functions'],'original_exact079')
                tables=snapshot(c);check(summary(tables)==x['tables'],'original_tables_changed')
                target['grant_ids']=grant_ids(c)
                grants=c.execute('SELECT data,active FROM tool_grants ORDER BY id').fetchall()
                pins=[pin for row in grants for pin in row['data']['capabilities']]
                check(sorted(pins,key=canonical)==sorted(x['pins'],key=canonical) and all(g['active'] for g in grants),'original_tool_authority_drift')
                predecessor_tools_available(c,target['grant_ids'])
                total_pins+=len(pins)
                # Exact episode3 receipt state; never create, read back or replay it.
                if key==TRIAL:
                    request=c.execute('SELECT s.request_bytes,s.request_sha256,s.count_bytes,s.count_sha256 FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.run_id=%s AND s.phase=%s',(RUN,'selection_3')).fetchone()
                    check(request and len(request['request_bytes'].encode())==115779 and digest(request['request_bytes'])==request['request_sha256']=='8d45e31d7ce6cdd598d2da480abee9da00bc37856e7652158dcb2891e4b1bbcf' and digest(request['count_bytes'])==request['count_sha256'],'exact_selected_request_drift')
                    kinds=c.execute("SELECT e.kind FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.phase='selection_3' ORDER BY e.kind",(RUN,)).fetchall()
                    check([r['kind'] for r in kinds]==['count_result','count_send','dispatch','identity','read','result'],'selected_provider_history_drift')
                    check(not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s AND call_id=%s',(RUN,'selection_3')).fetchone(),'selected_native_attempt_present')
            funds=fiscal(target['database']);check(funds==x['fiscal'],'fiscal_checkpoint_drift')
            baseline[key]=dict(tables=tables,fiscal=funds);targets.append(target)
        check(total_pins==36 and len({t['oid'] for t in targets})==12,'exact_original_pin_scope')
        check(campaign_state(campaign)==state,'campaign_changed_during_preflight')
        m['release_transition'].update(targets=targets,baseline_sha256=digest(canonical(baseline)),campaign_state=state,
            expected_snapshot_sha256=digest(expected_snapshot.read_bytes()),installer_files_sha256=digest(code_manifest.read_bytes()))
        save(out/'BASELINE.json',baseline);exact(out/'INSTALLER_FILES.json',code_manifest.read_bytes())
        save(out/'CANDIDATE.json',m)
    progress('prepared_read_only_no_original_mutation')


def load_candidate(root,out):
    raw=(out/'CANDIDATE.json').read_bytes();m=json.loads(raw)
    verify_files(root,m['files']);actual_identity(root)
    check(digest((out/'PREDECESSOR.json').read_bytes())==PREDECESSOR,'predecessor_manifest_drift')
    baseline=json.loads((out/'BASELINE.json').read_bytes())
    check(digest(canonical(baseline))==m['release_transition']['baseline_sha256'],'baseline_drift')
    previous=json.loads((out/'PREDECESSOR.json').read_bytes())
    check(m['successor']==previous['successor'] and m['file_input_continuation']==previous['file_input_continuation'],'funding_history_changed')
    m['_root']=str(root);m['_amendment']=digest(raw)
    return raw,m,baseline


def original_bindings(m):
    from install_recipient_funding import mapping
    clean={k:v for k,v in m.items() if not k.startswith('_')}
    with candidate_context(clean):plans,bindings=mapping(source_amendment=clean)
    check(set(plans)=={t['blind_id'] for t in m['release_transition']['targets']},'original_mapping_drift')
    return bindings


def installed_readback(root,out,*,allow_predecessor=False):
    from workagent.db import Database
    raw,m,baseline=load_candidate(root,out);bindings=original_bindings(m);states={}
    trial=json.loads((out/'TRIAL.json').read_bytes())
    check(trial['candidate_sha256']==digest(raw) and trial['rollback_preserved'] and trial['idempotent'],'exact_trial_required')
    for t in m['release_transition']['targets']:
        progress('readback:'+t['blind_id']);b=bindings[t['blind_id']];routing(b,t)
        readonly(Database(b['database_url']),lambda c:role(c,t,owner=False))
        with Database(b['migration_database_url']).transaction() as c:
            c.execute('SET TRANSACTION READ ONLY');role(c,t,owner=True)
            level=schema_state(c,m);before=baseline[t['blind_id']]
            if level==79:
                check(allow_predecessor,'store_not_installed');check(snapshot(c)==before['tables'] and functions(c)==m['release_transition']['predecessor_functions'],'predecessor_drift')
                predecessor_tools_available(c,t['grant_ids'])
            else:
                preserved(before['tables'],snapshot(c));release_readback(c,m,t['grant_ids'])
                check(functions(c)==trial['functions_after'],'installed_function_drift')
            states[t['blind_id']]=level
        check(fiscal(t['database'])==before['fiscal'],'historical_fiscal_changed')
    return states


class RollbackTrial(Exception):pass


def trial(root,out,private_path,expected_database,trial_out):
    from workagent.db import Database
    raw,m,baseline=load_candidate(root,out)
    check(not trial_out.exists(),'fresh_trial_output_required');trial_out.mkdir(mode=0o700)
    private=json.loads(private_path.read_bytes());target=deepcopy(next(t for t in m['release_transition']['targets'] if t['blind_id']==TRIAL))
    target.update(database=expected_database,owner=urlsplit(private['migration_database_url']).username,runtime=urlsplit(private['database_url']).username)
    # Clone OID is read-only discovered then fixed for this exact transaction.
    routing(private,target,disposable=True,originals=[t['database'] for t in m['release_transition']['targets']])
    owner=Database(private['migration_database_url'])
    target['oid']=readonly(owner,lambda c:c.execute('SELECT oid::bigint oid FROM pg_database WHERE datname=current_database()').fetchone()['oid'])
    readonly(Database(private['database_url']),lambda c:role(c,target,owner=False))
    before=readonly(owner,snapshot);check(before==baseline[TRIAL]['tables'],'restored_exact_original_rows_required')
    check(readonly(owner,lambda c:schema_state(c,m))==79,'restored079_required')
    funding=fiscal(expected_database)
    with owner.transaction() as c:
        try:
            with c.transaction():
                apply_connection(c,m,target,before)
                first=snapshot(c);defs=functions(c)
                apply_connection(c,m,target,before)
                check(snapshot(c)==first and functions(c)==defs,'idempotency_failed')
                raise RollbackTrial()
        except RollbackTrial:pass
        check(snapshot(c)==before and schema_state(c,m)==79,'rollback_history_changed')
    check(readonly(owner,snapshot)==before and fiscal(expected_database)==funding,'rollback_not_durable')
    result=dict(candidate_sha256=digest(raw),database=expected_database,oid=target['oid'],rollback_preserved=True,idempotent=True,functions_after=defs,provider_io=0)
    save(trial_out/'RESULT.json',result);save(out/'TRIAL.json',result)
    progress('disposable_trial_rolled_back_no_install')


def install(root,out,review_path):
    from workagent.db import Database
    raw,m,baseline=load_candidate(root,out)
    review(root,review_path,raw,(out/'TRIAL.json').read_bytes())
    campaign=root/'.local/batch3/b35c/live-study/campaign'
    with campaign_lock(campaign):
        check(campaign_state(campaign)==m['release_transition']['campaign_state'],'campaign_drift')
        import study_source_amendment as AM
        check(digest(AM.MANIFEST.read_bytes())==PREDECESSOR and AM.APPROVAL.read_text().strip()==PREDECESSOR,'publish_state_changed_before_install')
        # All targets validated before backups or the first mutation; resume exact
        # committed stores only. Preflight never establishes a new grant.
        states=installed_readback(root,out,allow_predecessor=True)
        if not (out/'BACKUPS.json').exists():
            check(all(v==79 for v in states.values()),'missing_pre_install_backups')
            backups(campaign,out,m['release_transition']['targets'])
            save(out/'BACKUPS.json',{str(p.relative_to(out)):digest(p.read_bytes()) for p in sorted((out/'backups').rglob('*')) if p.is_file()})
        for path,h in json.loads((out/'BACKUPS.json').read_bytes()).items():check(digest(safe(out,path).read_bytes())==h,'backup_drift')
        bindings=original_bindings(m)
        for t in m['release_transition']['targets']:
            progress('install:'+t['blind_id'])
            with Database(bindings[t['blind_id']]['migration_database_url']).transaction() as c:
                apply_connection(c,m,t,baseline[t['blind_id']]['tables'])
            check(fiscal(t['database'])==baseline[t['blind_id']]['fiscal'],'fiscal_changed_after_install')
        states=installed_readback(root,out)
        check(campaign_state(campaign)==m['release_transition']['campaign_state'],'campaign_changed_during_install')
        save(out/'INSTALLED.json',dict(candidate_sha256=digest(raw),states=states,backups_sha256=digest((out/'BACKUPS.json').read_bytes()),provider_io=0))
    progress('all12_installed_source_not_published')


def publish(root,out,review_path):
    import study_source_amendment as AM
    raw,m,_=load_candidate(root,out);review(root,review_path,raw,(out/'TRIAL.json').read_bytes())
    check(json.loads((out/'INSTALLED.json').read_bytes())['candidate_sha256']==digest(raw),'installation_receipt_required')
    campaign=root/'.local/batch3/b35c/live-study/campaign';app=campaign/TRIAL/'application.json'
    with campaign_lock(campaign):
        installed_readback(root,out)
        before=m['release_transition']['campaign_state'];current=campaign_state(campaign)
        # Publication alone may have advanced application.json in a prior crash.
        allowed=deepcopy(before);allowed['files'][TRIAL+'/application.json']=m['application_after_sha256']
        check(current in (before,allowed),'campaign_or_worker_history_drift')
        after=(out/'application-after.json').read_bytes();check(digest(after)==m['application_after_sha256'],'application_after_drift')
        publish_files(app,AM.MANIFEST,AM.APPROVAL,m['application_before_sha256'],PREDECESSOR,raw,after)
        check(AM.load()=={k:v for k,v in m.items() if not k.startswith('_')},'active_amendment_readback')
        check(campaign_state(campaign)==allowed,'publication_history_changed')
        from install_recipient_funding import mapping
        check(len(mapping()[0])==12,'active_bootstrap_mapping')
        save(out/'ACTIVATED.json',dict(candidate_sha256=digest(raw),provider_io=0,new_certificates=0,new_grants=0))
    progress('published_exact_source_no_worker_started')


def independent_readback(root,out,*,allow_predecessor=False):
    import study_source_amendment as AM
    states=installed_readback(root,out,allow_predecessor=allow_predecessor)
    raw,m,_=load_candidate(root,out)
    campaign=root/'.local/batch3/b35c/live-study/campaign';app=campaign/TRIAL/'application.json'
    before=m['release_transition']['campaign_state'];after=deepcopy(before)
    after['files'][TRIAL+'/application.json']=m['application_after_sha256']
    check(campaign_state(campaign) in (before,after),'independent_campaign_history_drift')
    successor=digest(raw)
    phase=(digest(app.read_bytes()),digest(AM.MANIFEST.read_bytes()),AM.APPROVAL.read_text().strip())
    allowed=[(m['application_before_sha256'],PREDECESSOR,PREDECESSOR),
             (m['application_after_sha256'],PREDECESSOR,PREDECESSOR),
             (m['application_after_sha256'],successor,PREDECESSOR),
             (m['application_after_sha256'],successor,successor)]
    check(phase in allowed,'independent_publication_state_drift')
    check(phase==allowed[0] or all(v==84 for v in states.values()),'published_before_all_stores')
    if any(v==84 for v in states.values()):
        for name,h in json.loads((out/'BACKUPS.json').read_bytes()).items():
            check(digest(safe(out,name).read_bytes())==h,'independent_backup_drift')
    return dict(candidate_sha256=successor,states=states,campaign_preserved=True,publication_phase=allowed.index(phase),provider_io=0)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    sub=p.add_subparsers(dest='action',required=True)
    q=sub.add_parser('prepare');q.add_argument('--code-manifest',type=Path,required=True);q.add_argument('--expected-original',type=Path,required=True)
    q=sub.add_parser('trial');q.add_argument('--private',type=Path,required=True);q.add_argument('--database',required=True);q.add_argument('--trial-out',type=Path,required=True)
    for name in ('install','publish'):
        q=sub.add_parser(name);q.add_argument('--review',type=Path,required=True)
    q=sub.add_parser('readback');q.add_argument('--allow-predecessor',action='store_true');q.add_argument('--result',type=Path,required=True)
    a=p.parse_args();root=a.root.resolve();out=a.out.resolve();os.umask(0o077)
    check(out.is_relative_to(root/'.local') and not any(q.is_symlink() for q in (a.out.absolute(),*a.out.absolute().parents) if q.is_relative_to(root)),'isolated_evidence_directory_required')
    sys.path[:0]=[str(root/'backend'),str(root/'evaluation')]
    if a.action=='prepare':prepare(root,out,a.code_manifest,a.expected_original)
    elif a.action=='trial':
        check(a.trial_out.resolve().is_relative_to(root/'.local'),'isolated_trial_output_required')
        trial(root,out,a.private,a.database,a.trial_out)
    elif a.action=='install':install(root,out,a.review)
    elif a.action=='publish':publish(root,out,a.review)
    else:
        check(a.result.resolve().is_relative_to(root/'.local'),'isolated_readback_output_required')
        with campaign_lock(root/'.local/batch3/b35c/live-study/campaign'):
            save(a.result,independent_readback(root,out,allow_predecessor=a.allow_predecessor))


if __name__=='__main__':
    try:main()
    except Exception as e:
        # Never emit SQL text, private DSNs, raw records or credential-bearing repr.
        print(canonical({'failed':type(e).__name__,'sqlstate':getattr(e,'sqlstate',None),'reason':str(e) if isinstance(e,InstallError) else None}),file=sys.stderr,flush=True)
        raise SystemExit(1)
