"""Exact activated59 -> bounded-phase60 successor; parent-run CLI only.

No worker/provider/funding issuance. Reuse the accepted release, backup and
publication seams; preserve every existing row except explicitly additive release
records/bindings and one migration journal entry. Prepare is read-only on originals.
"""
import argparse
from collections import Counter
from copy import deepcopy
import json
import os
from pathlib import Path
import re
import sqlite3
from types import SimpleNamespace
from urllib.parse import urlsplit
from unittest.mock import patch
import amend_retained_read as A

SOURCE='7ca0cc564129d83bccf16b02c39a00ffbeb1c78caf654960e9d0aaf5cef33fa0'
CONSUMER='c08c9d29628ef71d50582959724f37e7c61f6bba1543413f02e5af79e10c0788'
PRIOR='6eaa9bb8e0a624bf0a53de84dc549451fe3a80a8e0a2371967119337153a4826'
PRIOR_TRIAL='.local/batch3/b35c/retained-read-recovery/activation-59/TRIAL.json'
PRIOR_TRIAL_SHA='9fb0e219c22bae5ec29b0908d4cc44ce01b731c9a4826aa464262e3d3194af3b'
OLD_SOURCE='d3ac76bf6084d742877d59858ae8599809477cee9dbe37bdbd43b79dc509f274'
OLD_CONSUMER='351e2b902ddd76bf20081f1652988c2afaa2e9fb1d464f7ed19f211813538b1b'
TRIAL=A.TRIAL
RUN='65cd26f4-3e6d-4bc8-a061-d418207356ce'
MIGRATION='086_bounded_phase_stop.sql'
FUNCTION='require_run_successor(runs,jsonb)'
ADDED='bounded_phase_stop_settled(text)'
FUNCTION_BEFORE='f2cbc6c89465d3f9d509f312f419c5057e145918eca8c1ddd2b2e9a9a90a600f'
ADDITIVE={'public.schema_migrations','public.capability_implementation_releases','public.tool_grant_implementation_bindings'}
check,save,exact,digest,canonical=A.check,A.save,A.exact,A.digest,A.canonical


def predecessor_functions(candidate_raw,trial_raw):
    """Installed85 catalog from the exact reviewed59 trial, not inherited079 metadata."""
    check(digest(candidate_raw)==PRIOR,'activated59_candidate_drift')
    check(digest(trial_raw)==PRIOR_TRIAL_SHA,'activated59_trial_drift')
    trial=json.loads(trial_raw)
    check(trial['candidate_sha256']==PRIOR and trial['rollback_preserved'] is True
        and trial['idempotent'] is True and trial['provider_io']==0,'activated59_trial_binding')
    functions=trial['functions_after']
    check(len(functions)==237 and functions.get(FUNCTION,functions.get('public.'+FUNCTION))==FUNCTION_BEFORE,
        'activated59_trial_catalog')
    return functions


def identity(root):
    from workagent.capabilities import implementation_releases as R
    check(Path(R.__file__).resolve()==root/'backend/workagent/capabilities/implementation_releases.py','wrong_loaded_source')
    value=R.execution_identity()
    check((value['source_sha256'],value['consumer_sha256'])==(SOURCE,CONSUMER),'frozen60_drift')
    return value


def issuer():
    from test_accounting_correction import pg,PRIMARY
    return json.loads(pg(PRIMARY,"BEGIN READ ONLY; SELECT jsonb_build_object('adjustments',(SELECT count(*) FROM test_budget_correction.releases),'released',(SELECT sum(released_usd)::text FROM test_budget_correction.releases),'certificates',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM test_budget_correction.certificates t)); ROLLBACK;"))


def issuer_history():
    from test_accounting_correction import pg,PRIMARY
    return {name:digest(canonical(json.loads(pg(PRIMARY,
        "BEGIN READ ONLY; SELECT coalesce(jsonb_agg(row ORDER BY row::text),'[]'::jsonb) FROM "
        '(SELECT to_jsonb(t) row FROM test_budget_correction.'+name+' t) s; ROLLBACK;'))))
        for name in ('releases','certificates')}


def acl(c):
    return c.execute("SELECT 'table' kind,c.relname name,c.relowner owner,c.relacl::text acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' UNION ALL SELECT 'function',p.oid::regprocedure::text,p.proowner,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY 1,2").fetchall()


def schema(c,m):
    actual=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    expected=[dict(name=n,checksum=h) for n,h in sorted(m['migration_inventory'].items())]
    check(len(expected)==86 and actual in (expected[:85],expected),'exact85_or86_required')
    return len(actual)


def preserved(before,after):
    check(before.keys()==after.keys(),'table_set_changed')
    for name,old in before.items():
        if name in ADDITIVE:
            check(not Counter(old['row_hashes'])-Counter(after[name]['row_hashes']),'historical_row_changed:'+name)
        else:check(after[name]==old,'historical_row_changed:'+name)
    check(after['public.schema_migrations']['rows']==86,'journal_count')


def projected_functions(c,root):
    before=A.functions(c);name=next(k for k in before if k.removeprefix('public.')==FUNCTION)
    check(before[name]==FUNCTION_BEFORE and not any(k.removeprefix('public.')==ADDED for k in before),'086_predecessor_drift')
    raw=c.execute('SELECT pg_get_functiondef(%s::regprocedure) body',(FUNCTION,)).fetchone()['body']
    sql=(root/'backend/migrations'/MIGRATION).read_text()
    needle=re.search(r'needle text=\$q\$(.*?)\$q\$;',sql,re.S).group(1)
    replacement=re.search(r'EXECUTE replace\(definition,needle,\$q\$(.*?)\$q\$\)',sql,re.S).group(1)
    body=re.search(r'CREATE FUNCTION bounded_phase_stop_settled\(aid text\).*?AS \$\$(.*?)\$\$;',sql,re.S).group(1)
    check(raw.count(needle)==1,'086_splice_drift')
    # Existing function projection is exact; the NEW function is bound by its
    # source and catalog attributes, then by the actual clone's compiled hash.
    return dict(before=before,after_existing=dict(before,**{name:digest(raw.replace(needle,replacement))}),
        added=dict(signature=ADDED,body=body,language='plpgsql',volatility='s',strict=False,
            security_definer=False,leakproof=False,parallel='u',argument_names=['aid'],argument_types='25',
            result_type='boolean',argument_defaults=0,variadic=0,kind='f',
            search_path=['pg_catalog','public','pg_temp']))


def installed_functions(c,m,t,before_acl):
    actual=A.functions(c);spec=m['sql_definitions'];existing=spec['after_existing']
    added=next((k for k in actual if k.removeprefix('public.')==ADDED),None)
    check(added is not None and set(actual)==set(existing)|{added}
        and {k:v for k,v in actual.items() if k!=added}==existing,'installed_function_drift')
    row=c.execute("SELECT p.prosrc body,l.lanname language,p.provolatile volatility,p.proisstrict strict,"
        "p.prosecdef security_definer,p.proleakproof leakproof,p.proparallel parallel,p.proargnames argument_names,"
        "p.proargtypes::text argument_types,p.prorettype::regtype::text result_type,p.pronargdefaults argument_defaults,"
        "p.provariadic::bigint variadic,p.prokind kind,p.proconfig settings,pg_get_userbyid(p.proowner) owner "
        "FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=%s::regprocedure",(ADDED,)).fetchone()
    settings=row.pop('settings');owner=row.pop('owner')
    check(owner==t['owner'] and settings is not None and len(settings)==1 and settings[0].startswith('search_path='),'added_function_settings')
    row['search_path']=[x.strip() for x in settings[0].split('=',1)[1].split(',')]
    check(row=={k:v for k,v in spec['added'].items() if k!='signature'},'added_function_definition_drift')
    rights=acl(c)
    check([r for r in rights if not (r['kind']=='function' and r['name'].removeprefix('public.')==ADDED)]==before_acl,'old_acl_changed')
    grants=c.execute("SELECT x.privilege_type,x.is_grantable,x.grantee,p.proowner,x.grantor "
        "FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x "
        "WHERE p.oid=%s::regprocedure",(ADDED,)).fetchall()
    runtime=c.execute('SELECT oid::bigint oid FROM pg_roles WHERE rolname=%s',(t['runtime'],)).fetchone()['oid']
    check(grants and all(g['privilege_type']=='EXECUTE' and g['grantor']==g['proowner']
        and g['grantee'] in (0,g['proowner'],runtime)
        and (not g['is_grantable'] or g['grantee']==g['proowner']) for g in grants),'added_function_acl')
    check(c.execute("SELECT has_function_privilege(%s,%s,'EXECUTE') ok",(t['runtime'],ADDED)).fetchone()['ok'],'added_function_runtime_unavailable')
    if '_compiled_functions' in m:check(actual==m['_compiled_functions'],'compiled_trial_function_drift')
    return actual


def predecessor_available(c,gids):
    """Actual old source resolution; never resolve079/current donor in Python."""
    from workagent.capabilities import registry,implementation_releases as R
    check(A.grant_ids(c)==gids,'grant_set_drift')
    for gid in gids:
        g=c.execute('SELECT * FROM tool_grants WHERE id=%s',(gid,)).fetchone()
        for pin in g['data']['capabilities']:
            adapter=registry.adapters().get(pin['id']);check(adapter is not None,'missing_current_capability:'+pin['id'])
            old=c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',(gid,pin['id'],OLD_SOURCE,OLD_CONSUMER)).fetchone()['d']
            check(old is not None and R.compatible(old,adapter.descriptor.model_dump(mode='json')),'incompatible_effective_descriptor:'+pin['id'])
        check(c.execute('SELECT tool_run_available(%s,%s) ok',(g['workspace_id'],g['run_id'])).fetchone()['ok'],'current_predecessor_tools_denied')


def release_readback(c,m,gids,before):
    from workagent.capabilities import implementation_releases as R,registry
    current=identity(Path(m['_root']));expected=[];release_ids=set()
    for gid in gids:
        g=c.execute('SELECT * FROM tool_grants WHERE id=%s',(gid,)).fetchone()
        for pin in g['data']['capabilities']:
            cid=pin['id'];d=registry.adapters()[cid].descriptor.model_dump(mode='json');rid=R.release_id(d,current);release_ids.add(rid)
            old=c.execute('SELECT descriptor FROM capability_installations WHERE id=%s AND version=%s',(cid,pin['version'])).fetchone()['descriptor']
            body=dict(grant_id=gid,capability_id=cid,predecessor_pin=pin,predecessor_installation_sha256=digest(canonical(old)),
                predecessor_source_sha256=OLD_SOURCE,release_sha256=rid,source_sha256=SOURCE,consumer_sha256=CONSUMER,amendment_sha256=m['_amendment'])
            expected.append(dict(binding_id=digest(canonical(body)),**body))
            row=c.execute('SELECT * FROM capability_implementation_releases WHERE release_sha256=%s',(rid,)).fetchone()
            check(row and row['enabled'] and all(row[k]==v for k,v in R.release_record(d,current).items()),'current_release_record_drift')
            check(c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',(gid,cid,SOURCE,CONSUMER)).fetchone()['d']==d,'current_source_resolution_denied')
        check(c.execute('SELECT tool_run_available(%s,%s) ok',(g['workspace_id'],g['run_id'])).fetchone()['ok'],'current_tools_denied')
    rows=c.execute('SELECT * FROM tool_grant_implementation_bindings WHERE source_sha256=%s ORDER BY grant_id,capability_id',(SOURCE,)).fetchall()
    check(sorted(rows,key=canonical)==sorted(expected,key=canonical),'exact_new_binding_set')
    check(c.execute('SELECT count(*) n FROM tool_grant_implementation_bindings').fetchone()['n']==before['public.tool_grant_implementation_bindings']['rows']+len(expected),'unexpected_binding_addition')
    check(c.execute('SELECT count(*) n FROM capability_implementation_releases').fetchone()['n']==before['public.capability_implementation_releases']['rows']+len(release_ids),'unexpected_release_addition')


def apply(c,m,t,before):
    from workagent import db
    from workagent.capabilities import implementation_releases as R
    A.role(c,t,owner=True);c.execute('SELECT pg_advisory_xact_lock(17402111)')
    level=schema(c,m);check(A.grant_ids(c)==t['grant_ids'],'grant_set_drift')
    if level==85:
        check(A.snapshot(c)==before['tables'] and A.functions(c)==m['sql_definitions']['before'] and acl(c)==before['acl'],'pre_install_history_drift')
        predecessor_available(c,t['grant_ids'])
    with patch.object(db.Database,'transaction',lambda self:A.ConnectionDB(c).transaction()):db.migrate(c.info.dsn)
    if t['grant_ids']:
        check(R.install_transition(A.ConnectionDB(c),t['grant_ids'],amendment_sha256=m['_amendment'],predecessor_source_sha256=OLD_SOURCE)==identity(Path(m['_root'])),'installed_identity_drift')
    check(schema(c,m)==86,'installed_schema_drift');installed_functions(c,m,t,before['acl'])
    preserved(before['tables'],A.snapshot(c));release_readback(c,m,t['grant_ids'],before['tables']);A.runtime_acl_readback(c,t)


def transform(root,out,previous,code):
    from network_harness import inventory
    oldpath=root/'.local/batch3/b35c/retained-read-recovery/implementation-60'/('predecessor-'+OLD_SOURCE)
    check(not oldpath.is_symlink() and not any(p.is_symlink() for p in oldpath.rglob('*')),'snapshot_symlink')
    old=inventory(oldpath);new=identity(root)['dependencies']['product']
    check(len(old)==len(new)==193 and digest(canonical(old))==OLD_SOURCE,'193_file_predecessor_drift')
    delta={k:dict(before=old.get(k),after=new.get(k)) for k in old.keys()|new.keys() if old.get(k)!=new.get(k)}
    check(set(delta)=={'adaptive.py','general_worker.py','general_responses.py'},'frozen_product_delta')
    m=deepcopy(previous);m['binding_name']='bounded-phase-release-v1';m['files'].update(code['files']);A.verify_files(root,m['files'])
    m['execution_sources'].update(B1=SOURCE,M1=SOURCE)
    migrations=identity(root)['dependencies']['migrations']
    check(len(migrations)==86 and {k:v for k,v in migrations.items() if k!=MIGRATION}==previous['migration_inventory'],'exact086_extension')
    m['migration_inventory']=migrations;m['migration_additions']['/product/migrations/'+MIGRATION]='backend/migrations/'+MIGRATION
    m['release_transition']=dict(predecessor_manifest=str((out/'PREDECESSOR.json').relative_to(root)),predecessor_sha256=PRIOR,
        predecessor_trial=PRIOR_TRIAL,predecessor_trial_sha256=PRIOR_TRIAL_SHA,
        historical_snapshot=str(oldpath.relative_to(root)),predecessor_execution_sources=previous['execution_sources'],
        product_delta=delta,source_sha256=SOURCE,consumer_sha256=CONSUMER,same_run=RUN,phase='selection_8',provider_replay=False)
    return m


def bootstrap_copies(root,out,m,previous,campaign,state):
    """Existing constructors on consistent copies, preserving every old row."""
    from study_binding import environment
    from study_controller import Controller
    from study_diagnostic import ProductAdapter
    from install_recipient_funding import mapping
    for name in ('controller','bridge'):
        with sqlite3.connect('file:'+str(campaign/(name+'.sqlite'))+'?mode=ro',uri=True) as source:
            with sqlite3.connect(out/(name+'.sqlite')) as target:source.backup(target)
    with sqlite3.connect(out/'controller.sqlite') as c:controller=c.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]
    with sqlite3.connect(out/'bridge.sqlite') as c:bridge=c.execute('SELECT value FROM admission_binding').fetchone()[0]
    with A.candidate_context(m):
        env=environment();mapping_hash=json.loads(bridge)['live_mapping_sha256']
        fresh=Controller(out/'fresh.sqlite',SimpleNamespace(live_mapping_sha256=mapping_hash),mode='official_api')
        value=fresh.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0];fresh.close()
        m['bindings']={k:dict(before=digest(a),after=digest(b)) for k,a,b in [('controller',controller,value),('bridge',bridge,canonical(dict(environment=env,live_mapping_sha256=mapping_hash)))]}
        check(all(m['bindings'][k]['before']==previous['bindings'][k]['before'] for k in m['bindings']),'historical_binding_drift')
        # Cold real mapping checks the complete unchanged funding origin and
        # existing16-edge limit. It issues no certificates or reservations.
        plans,bindings=mapping(source_amendment=m);check(len(plans)==len(bindings)==12,'exact12_mapping')
        adapter=ProductAdapter(out,None,live_bindings=bindings,credential=None)
        ctl=Controller(out/'controller.sqlite',adapter,mode='official_api');ctl.close();adapter.close()
    for name in ('controller','bridge'):
        with sqlite3.connect('file:'+str(campaign/(name+'.sqlite'))+'?mode=ro',uri=True) as old, sqlite3.connect('file:'+str(out/(name+'.sqlite'))+'?mode=ro',uri=True) as new:
            tables=[r[0] for r in old.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            for table in tables:
                quoted='"'+table.replace('"','""')+'"'
                a=Counter(canonical(r) for r in old.execute('SELECT * FROM '+quoted))
                b=Counter(canonical(r) for r in new.execute('SELECT * FROM '+quoted))
                check(not a-b,'copied_historical_sqlite_row_changed')
                if (name,table) in (('controller','binding'),('bridge','admission_amendments')):
                    check(sum((b-a).values())==1,'exact_one_new_amendment')
                else:check(a==b,'copied_journal_changed')
    return env,plans,bindings


def prepare(root,out,code_path,expected_path):
    from workagent.db import Database
    import study_source_amendment as AM
    from install_recipient_funding import identity as funding_identity
    code=json.loads(code_path.read_bytes());A.verify_files(root,code['files']);identity(root)
    raw=AM.MANIFEST.read_bytes();check(digest(raw)==PRIOR and AM.APPROVAL.read_text().strip()==PRIOR,'active59_required')
    trial_raw=(root/PRIOR_TRIAL).read_bytes();installed_functions=predecessor_functions(raw,trial_raw)
    expected=json.loads(expected_path.read_bytes());check(expected['active_source_amendment_sha256']==PRIOR and expected['collected']==4,'current_original_checkpoint')
    check(not out.exists(),'fresh_output_required');out.mkdir(mode=0o700,parents=True)
    exact(out/'PREDECESSOR.json',raw);exact(out/'PREDECESSOR.approved.sha256',AM.APPROVAL.read_bytes());exact(out/'EXPECTED_ORIGINAL.json',expected_path.read_bytes())
    exact(out/'PREDECESSOR_TRIAL.json',trial_raw)
    previous=json.loads(raw);m=transform(root,out,previous,code)
    campaign=root/'.local/batch3/b35c/live-study/campaign'
    with A.campaign_lock(campaign):
        state=A.campaign_state(campaign);check(issuer()==expected['issuer'],'issuer_checkpoint_drift');issuer_before=issuer_history()
        for name,table in [('controller','operations'),('bridge','receipts')]:check(state[name][table]==expected['journals'][table]['sha256'],'pending_journal_drift')
        check({k.removesuffix('/application.json'):v for k,v in state['files'].items() if k.endswith('/application.json')}==expected['applications'],'application_set_drift')
        app=campaign/TRIAL/'application.json';before=app.read_bytes();application=json.loads(before)
        check(application['episode']==5 and application['collected']==4 and application['current_run']==RUN and application['source_manifest_sha256']==OLD_SOURCE,'episode5_identity')
        exact(out/'application-before.json',before)
        env,plans,bindings=bootstrap_copies(root,out,m,previous,campaign,state)
        application.update(source_manifest_sha256=SOURCE,environment=env);after=(canonical(application)+'\n').encode()
        exact(out/'application-after.json',after);m.update(application_before_sha256=digest(before),application_after_sha256=digest(after))
        baseline={};targets=[];pins=0
        for key,plan in sorted(plans.items()):
            A.progress('read_only85_preflight:'+key);b=bindings[key];x=expected['stores'][key]
            t=dict(blind_id=key,database=plan['database'],oid=plan['database_oid'],owner=urlsplit(b['migration_database_url']).username,runtime=urlsplit(b['database_url']).username)
            check((t['database'],t['oid'])==(x['identity']['database'],x['identity']['oid']),'physical_identity_drift')
            A.routing(b,t);funding_identity(plan,b);A.readonly(Database(b['database_url']),lambda c:A.role(c,t,owner=False))
            with Database(b['migration_database_url']).transaction() as c:
                c.execute('SET TRANSACTION READ ONLY');A.role(c,t,owner=True);check(schema(c,m)==85,'current85_required')
                defs=projected_functions(c,root)
                if targets:check(defs==m['sql_definitions'],'production_function_catalog_drift')
                else:m['sql_definitions']=defs
                check(defs['before']==installed_functions,'activated59_functions_drift')
                tables=A.snapshot(c);check(A.summary(tables)==x['tables'],'original_rows_drift')
                t['grant_ids']=A.grant_ids(c);predecessor_available(c,t['grant_ids'])
                actual=[p for row in c.execute('SELECT data FROM tool_grants ORDER BY id').fetchall() for p in row['data']['capabilities']]
                check(sorted(actual,key=canonical)==sorted(x['pins'],key=canonical),'old_pin_drift');pins+=len(actual)
                rights=acl(c)
            funds=A.fiscal(t['database']);check(funds==x['fiscal'],'recipient_fiscal_drift')
            baseline[key]=dict(tables=tables,fiscal=funds,acl=rights);targets.append(t)
        check(pins==sum(len(v['pins']) for v in expected['stores'].values())==60 and len({t['oid'] for t in targets})==12,'current60_pins_12_stores')
        check(A.campaign_state(campaign)==state and issuer()==expected['issuer'] and issuer_history()==issuer_before,'original_changed_during_prepare')
        m['release_transition'].update(targets=targets,baseline_sha256=digest(canonical(baseline)),campaign_state=state,issuer=expected['issuer'],
            issuer_history=issuer_before,
            expected_snapshot_sha256=digest(expected_path.read_bytes()),installer_files_sha256=digest(code_path.read_bytes()))
        save(out/'BASELINE.json',baseline);exact(out/'INSTALLER_FILES.json',code_path.read_bytes());save(out/'CANDIDATE.json',m)
    A.progress('prepared_no_original_mutation')


def load(root,out):
    raw=(out/'CANDIDATE.json').read_bytes();m=json.loads(raw);A.verify_files(root,m['files']);identity(root)
    previous_raw=(out/'PREDECESSOR.json').read_bytes();check(digest(previous_raw)==PRIOR,'predecessor_drift');previous=json.loads(previous_raw)
    check(m['release_transition']['predecessor_trial']==PRIOR_TRIAL
        and m['release_transition']['predecessor_trial_sha256']==PRIOR_TRIAL_SHA,'predecessor_trial_binding_drift')
    check(m['sql_definitions']['before']==predecessor_functions(previous_raw,(out/'PREDECESSOR_TRIAL.json').read_bytes()),
        'activated59_functions_drift')
    check(m['successor']==previous['successor'] and m['file_input_continuation']==previous['file_input_continuation'],'funding_origin_drift')
    baseline=json.loads((out/'BASELINE.json').read_bytes());check(digest(canonical(baseline))==m['release_transition']['baseline_sha256'],'baseline_drift')
    if (out/'TRIAL.json').exists():
        trial=json.loads((out/'TRIAL.json').read_bytes())
        check(trial['candidate_sha256']==digest(raw) and trial['rollback_preserved'] is True
            and trial['idempotent'] is True,'compiled_trial_binding_drift')
        m['_compiled_functions']=trial['functions_after']
    m.update(_root=str(root),_amendment=digest(raw));return raw,m,baseline


def bindings(m):
    from install_recipient_funding import mapping
    clean={k:v for k,v in m.items() if not k.startswith('_')}
    with A.candidate_context(clean):plans,result=mapping(source_amendment=clean)
    check(set(plans)=={t['blind_id'] for t in m['release_transition']['targets']},'mapping_set_drift');return result


def readback(root,out,*,allow_old=False):
    from workagent.db import Database
    raw,m,baseline=load(root,out);routes=bindings(m);states={}
    for t in m['release_transition']['targets']:
        A.progress('readback:'+t['blind_id']);b=routes[t['blind_id']];A.routing(b,t)
        A.readonly(Database(b['database_url']),lambda c:A.role(c,t,owner=False))
        with Database(b['migration_database_url']).transaction() as c:
            c.execute('SET TRANSACTION READ ONLY');A.role(c,t,owner=True);level=schema(c,m);before=baseline[t['blind_id']]
            if level==85:
                check(acl(c)==before['acl'],'acl_changed')
                check(allow_old and A.snapshot(c)==before['tables'] and A.functions(c)==m['sql_definitions']['before'],'predecessor_rows_or_functions_drift')
                predecessor_available(c,t['grant_ids'])
            else:
                preserved(before['tables'],A.snapshot(c));release_readback(c,m,t['grant_ids'],before['tables'])
                installed_functions(c,m,t,before['acl']);A.runtime_acl_readback(c,t)
            states[t['blind_id']]=level
        check(A.fiscal(t['database'])==before['fiscal'],'recipient_fiscal_changed')
    check(issuer()==m['release_transition']['issuer'] and issuer_history()==m['release_transition']['issuer_history'],'issuer_changed');return states


def trial(root,out,private_path,database,trial_out):
    from workagent.db import Database
    raw,m,baseline=load(root,out);check(not trial_out.exists(),'fresh_trial_out');trial_out.mkdir(mode=0o700)
    private=json.loads(private_path.read_bytes());t=deepcopy(next(t for t in m['release_transition']['targets'] if t['blind_id']==TRIAL))
    t.update(database=database,owner=urlsplit(private['migration_database_url']).username,runtime=urlsplit(private['database_url']).username)
    A.routing(private,t,disposable=True,originals=[t['database'] for t in m['release_transition']['targets']])
    owner=Database(private['migration_database_url']);t['oid']=A.readonly(owner,lambda c:c.execute('SELECT oid::bigint oid FROM pg_database WHERE datname=current_database()').fetchone()['oid'])
    A.readonly(Database(private['database_url']),lambda c:A.role(c,t,owner=False))
    before=deepcopy(baseline[TRIAL]);check(A.readonly(owner,A.snapshot)==before['tables'],'exact_current_populated_restore_required')
    # Restored ACL ownership/grantee OIDs legitimately belong to the clone roles.
    before['acl']=A.readonly(owner,acl);funds=A.fiscal(database)
    error=None;compiled=None
    try:
        with owner.transaction() as c:
            check(schema(c,m)==85 and A.functions(c)==m['sql_definitions']['before'],'exact_current85_trial')
            with c.transaction(force_rollback=True):
                apply(c,m,t,before);first=A.snapshot(c);compiled=installed_functions(c,m,t,before['acl'])
                apply(c,m,t,before)
                check(A.snapshot(c)==first and installed_functions(c,m,t,before['acl'])==compiled,'ordinary_idempotency_failed')
    except BaseException as exc:
        error=exc
    # Record preservation on failed trials too, without masking their primary
    # exception or ever treating a rollback as a successful release proof.
    preserved_error=None
    try:
        with owner.transaction() as c:
            c.execute('SET TRANSACTION READ ONLY')
            check(A.snapshot(c)==before['tables'] and schema(c,m)==85
                and A.functions(c)==m['sql_definitions']['before'] and acl(c)==before['acl'],'rollback_not_exact')
        check(A.fiscal(database)==funds,'durable_rollback_fiscal_drift')
    except BaseException as exc:
        preserved_error=exc
    save(trial_out/'PRESERVATION.json',dict(exact=preserved_error is None,trial_succeeded=error is None and preserved_error is None,
        primary_error_type=type(error).__name__ if error else None,
        preservation_error_type=type(preserved_error).__name__ if preserved_error else None))
    if error is not None:raise error
    if preserved_error is not None:raise preserved_error
    result=dict(candidate_sha256=digest(raw),database=database,oid=t['oid'],rollback_preserved=True,idempotent=True,functions_after=compiled,provider_io=0)
    save(trial_out/'RESULT.json',result);save(out/'TRIAL.json',result);A.progress('current85_populated_trial_rolled_back')


def backup_all(campaign,out,targets):
    from amend_gateway_recovery import backup
    for t in targets:
        p=out/'backups'/(t['database']+'.before086.dump');p.parent.mkdir(exist_ok=True);backup(t['database'],p)
        with p.open('rb') as f:os.fsync(f.fileno())
    for name in ('controller','bridge'):
        p=out/'backups'/(name+'.sqlite')
        if not p.exists():
            temp=p.with_suffix('.partial')
            check(not temp.exists(),'retained_partial_backup')
            with sqlite3.connect('file:'+str(campaign/(name+'.sqlite'))+'?mode=ro',uri=True) as source:
                with sqlite3.connect(temp) as target:source.backup(target)
            check(A.sqlite_tables(temp)==A.sqlite_tables(campaign/(name+'.sqlite')),'sqlite_copy_drift');os.replace(temp,p)
        check(A.sqlite_tables(p)==A.sqlite_tables(campaign/(name+'.sqlite')),'sqlite_backup_drift')
        with p.open('rb') as f:os.fsync(f.fileno())
    for p in campaign.rglob('*'):
        if p.is_file() and (p.name=='application.json' or 'worker-state' in p.parts):
            check(not p.is_symlink(),'private_state_symlink');exact(out/'backups/state'/p.relative_to(campaign),p.read_bytes())
    A.fsync_dir(out/'backups')


def proof(root,out,review_path,raw):
    trial_raw=(out/'TRIAL.json').read_bytes();result=json.loads(trial_raw)
    check(result['candidate_sha256']==digest(raw) and result['rollback_preserved'] and result['idempotent'],'exact_current_clone_proof_required')
    A.review(root,review_path,raw,trial_raw)


def install(root,out,review_path):
    from workagent.db import Database
    import study_source_amendment as AM
    raw,m,baseline=load(root,out);proof(root,out,review_path,raw);campaign=root/'.local/batch3/b35c/live-study/campaign'
    with A.campaign_lock(campaign):
        check(A.campaign_state(campaign)==m['release_transition']['campaign_state'],'pending_state_changed')
        check(digest(AM.MANIFEST.read_bytes())==PRIOR and AM.APPROVAL.read_text().strip()==PRIOR,'active59_changed')
        states=readback(root,out,allow_old=True)  # ALL12 current checks before ANY backup/mutation.
        if not (out/'BACKUPS.json').exists():
            check(all(v==85 for v in states.values()),'missing_preinstall_backups')
            backup_all(campaign,out,m['release_transition']['targets'])
            save(out/'BACKUPS.json',{str(p.relative_to(out)):digest(p.read_bytes()) for p in sorted((out/'backups').rglob('*')) if p.is_file()})
        for name,h in json.loads((out/'BACKUPS.json').read_bytes()).items():check(digest(A.safe(out,name).read_bytes())==h,'backup_drift')
        routes=bindings(m)
        for t in m['release_transition']['targets']:
            A.progress('install086:'+t['blind_id'])
            with Database(routes[t['blind_id']]['migration_database_url']).transaction() as c:apply(c,m,t,baseline[t['blind_id']])
        states=readback(root,out);check(A.campaign_state(campaign)==m['release_transition']['campaign_state'],'pending_state_changed')
        save(out/'INSTALLED.json',dict(candidate_sha256=digest(raw),states=states,backups_sha256=digest((out/'BACKUPS.json').read_bytes()),provider_io=0))


def publish(root,out,review_path):
    import study_source_amendment as AM
    raw,m,_=load(root,out);proof(root,out,review_path,raw)
    check(json.loads((out/'INSTALLED.json').read_bytes())['candidate_sha256']==digest(raw),'installed_receipt_required')
    campaign=root/'.local/batch3/b35c/live-study/campaign';app=campaign/TRIAL/'application.json'
    with A.campaign_lock(campaign):
        readback(root,out);before=m['release_transition']['campaign_state'];after=deepcopy(before)
        after['files'][TRIAL+'/application.json']=m['application_after_sha256']
        check(A.campaign_state(campaign) in (before,after),'pending_or_worker_state_changed')
        replacement=(out/'application-after.json').read_bytes();check(digest(replacement)==m['application_after_sha256'],'replacement_application_drift')
        A.publish_files(app,AM.MANIFEST,AM.APPROVAL,m['application_before_sha256'],PRIOR,raw,replacement)
        check(AM.load()=={k:v for k,v in m.items() if not k.startswith('_')},'active_manifest_drift')
        check(A.campaign_state(campaign)==after,'publication_changed_history')
        from install_recipient_funding import mapping
        check(len(mapping()[0])==12,'cold_active_mapping_failed')
        save(out/'ACTIVATED.json',dict(candidate_sha256=digest(raw),provider_io=0,new_certificates=0,new_grants=0))


def independent_readback(root,out,*,allow_old=False):
    import study_source_amendment as AM
    states=readback(root,out,allow_old=allow_old);raw,m,_=load(root,out)
    campaign=root/'.local/batch3/b35c/live-study/campaign';app=campaign/TRIAL/'application.json'
    before=m['release_transition']['campaign_state'];after=deepcopy(before)
    after['files'][TRIAL+'/application.json']=m['application_after_sha256']
    check(A.campaign_state(campaign) in (before,after),'pending_state_changed')
    successor=digest(raw)
    phases=[(m['application_before_sha256'],PRIOR,PRIOR),
        (m['application_after_sha256'],PRIOR,PRIOR),
        (m['application_after_sha256'],successor,PRIOR),
        (m['application_after_sha256'],successor,successor)]
    actual=(digest(app.read_bytes()),digest(AM.MANIFEST.read_bytes()),AM.APPROVAL.read_text().strip())
    check(actual in phases,'unknown_publication_phase')
    check(actual==phases[0] or all(v==86 for v in states.values()),'publication_before_complete_install')
    if any(v==86 for v in states.values()):
        for name,h in json.loads((out/'BACKUPS.json').read_bytes()).items():check(digest(A.safe(out,name).read_bytes())==h,'backup_drift')
    return dict(candidate_sha256=successor,states=states,publication_phase=phases.index(actual),pending_history_preserved=True,provider_io=0)


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    sub=p.add_subparsers(dest='action',required=True)
    q=sub.add_parser('prepare');q.add_argument('--code-manifest',type=Path,required=True);q.add_argument('--expected-original',type=Path,required=True)
    q=sub.add_parser('trial');q.add_argument('--private',type=Path,required=True);q.add_argument('--database',required=True);q.add_argument('--trial-out',type=Path,required=True)
    for name in ('install','publish'):sub.add_parser(name).add_argument('--review',type=Path,required=True)
    sub.add_parser('readback').add_argument('--allow-predecessor',action='store_true')
    a=p.parse_args();root=a.root.resolve();out=a.out.resolve();check(out.is_relative_to(root) and out!=root,'safe_output_required')
    if a.action=='prepare':prepare(root,out,a.code_manifest,a.expected_original)
    elif a.action=='trial':trial(root,out,a.private,a.database,a.trial_out)
    elif a.action=='install':install(root,out,a.review)
    elif a.action=='publish':publish(root,out,a.review)
    else:print(canonical(independent_readback(root,out,allow_old=a.allow_predecessor)))

if __name__=='__main__':main()
