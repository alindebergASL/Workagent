"""Offline successor58 controls. No DB, provider, original publication or worker."""
from contextlib import contextmanager,nullcontext
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace as NS
import pytest
import amend_retained_unavailable as S

ROOT=Path(__file__).resolve().parents[1]
HERE=ROOT/'.local/batch3/b35c/retained-read-recovery/implementation-58'


def code():
    names=['evaluation/study_source_amendment.py','evaluation/amend_retained_unavailable.py','contracts/capability-registry-v2.json']
    names += ['backend/workagent/'+n for n in S.identity(ROOT)['dependencies']['product']]
    names += ['backend/migrations/'+n for n in S.identity(ROOT)['dependencies']['migrations']]
    return dict(files={n:S.digest((ROOT/n).read_bytes()) for n in names})


def test_exact_real_transform_funding_origin_and_frozen_source():
    old=json.loads((HERE/'predecessor/activation56.CANDIDATE.json').read_text());before=deepcopy(old)
    m=S.transform(ROOT,HERE/'not-published',old,code())
    assert old==before and m['successor']==old['successor'] and m['file_input_continuation']==old['file_input_continuation']
    assert m['execution_sources']['B0']==old['execution_sources']['B0']
    assert set(m['release_transition']['product_delta'])=={'retained_results.py'}
    assert len(m['migration_inventory'])==85 and {k:v for k,v in m['migration_inventory'].items() if k!=S.MIGRATION}==old['migration_inventory']
    assert all(m['migration_additions'][k]==v for k,v in old['migration_additions'].items())
    assert m['binding_name']!=old['binding_name'] and m['release_transition']['same_run']==S.RUN
    assert S.identity(ROOT)['source_sha256']==S.SOURCE


@pytest.mark.parametrize('damage',[None,'history','release_rewrite','binding_rewrite','journal','tables'])
def test_additive_history_preservation(damage):
    old={n:dict(rows=1,row_hashes=['old'],sha256='old') for n in S.ADDITIVE|{'public.native','public.responses_events'}}
    old['public.schema_migrations']=dict(rows=84,row_hashes=['old']*84,sha256='old')
    new=deepcopy(old)
    for n in S.ADDITIVE:new[n]=dict(rows=old[n]['rows']+1,row_hashes=old[n]['row_hashes']+['new'],sha256='new')
    if damage=='history':new['public.native']['row_hashes']=['reclassified']
    if damage=='release_rewrite':new['public.capability_implementation_releases']['row_hashes']=['new','new']
    if damage=='binding_rewrite':new['public.tool_grant_implementation_bindings']['row_hashes']=['new','new']
    if damage=='journal':new['public.schema_migrations']['row_hashes']=['new']*85
    if damage=='tables':new['public.extra']={}
    if damage:
        with pytest.raises(S.A.InstallError):S.preserved(old,new)
    else:S.preserved(old,new)


@pytest.mark.parametrize('crash',[None,'application','manifest','approval'])
def test_actual_ordered_publication_resume_preserves_pending_state(tmp_path,crash):
    paths=[tmp_path/n for n in ('application','manifest','approval')]
    app,manifest,approval=paths;old_app=b'{"pending":"exact"}\n';old=b'prior';new=b'successor';after=b'{"pending":"exact","source":"new"}\n'
    app.write_bytes(old_app);manifest.write_bytes(old);approval.write_text(S.digest(old)+'\n')
    private=tmp_path/'worker-state';private.write_bytes(b'exact saved capability never renewed')
    def hook(phase):
        if phase==crash:raise InterruptedError('publication stopped')
    args=(app,manifest,approval,S.digest(old_app),S.digest(old),new,after)
    if crash:
        with pytest.raises(InterruptedError):S.A.publish_files(*args,hook=hook)
    else:S.A.publish_files(*args,hook=hook)
    S.A.publish_files(*args);S.A.publish_files(*args)
    assert app.read_bytes()==after and manifest.read_bytes()==new and approval.read_text().strip()==S.digest(new)
    assert private.read_bytes()==b'exact saved capability never renewed'


def test_publication_refuses_foreign_partial_state(tmp_path):
    app,manifest,approval=[tmp_path/n for n in ('application','manifest','approval')]
    app.write_bytes(b'old');manifest.write_bytes(b'unrelated');approval.write_text('old')
    with pytest.raises(S.A.InstallError,match='unrecognized_publication_state'):
        S.A.publish_files(app,manifest,approval,S.digest(b'old'),S.digest(b'prior'),b'new',b'after')
    assert app.read_bytes()==b'old' and manifest.read_bytes()==b'unrelated'


@pytest.mark.parametrize('last_denied',[False,True])
def test_whole_installer_all_target_preflight_precedes_backup_and_mutation(tmp_path,monkeypatch,last_denied):
    from workagent import db
    import study_source_amendment as AM
    out=tmp_path/'out';out.mkdir();active=tmp_path/'active';active.write_bytes(b'prior');approval=tmp_path/'approval';approval.write_text(S.digest(b'prior'))
    monkeypatch.setattr(AM,'MANIFEST',active);monkeypatch.setattr(AM,'APPROVAL',approval);monkeypatch.setattr(S,'PRIOR',S.digest(b'prior'))
    targets=[dict(blind_id=str(n),database='test'+str(n)) for n in range(12)]
    m=dict(release_transition=dict(campaign_state={'unchanged':True},targets=targets));events=[]
    monkeypatch.setattr(S,'load',lambda *a:(b'candidate',m,{str(n):{} for n in range(12)}))
    monkeypatch.setattr(S,'proof',lambda *a:None);monkeypatch.setattr(S.A,'campaign_lock',lambda *a:nullcontext())
    monkeypatch.setattr(S.A,'campaign_state',lambda *a:{'unchanged':True})
    def readback(*a,allow_old=False):
        for n in range(12):
            events.append(('preflight',n))
            if last_denied and n==11:raise S.A.InstallError('current_predecessor_tools_denied')
        return {str(n):84 if allow_old else 85 for n in range(12)}
    monkeypatch.setattr(S,'readback',readback)
    def backups(*a):
        events.append(('backup',12));(out/'backups').mkdir();(out/'backups/exact').write_bytes(b'backup')
    monkeypatch.setattr(S,'backup_all',backups)
    monkeypatch.setattr(S,'bindings',lambda *a:{str(n):dict(migration_database_url='not-a-real-dsn') for n in range(12)})
    monkeypatch.setattr(db,'Database',lambda *a:NS(transaction=lambda:nullcontext(object())))
    monkeypatch.setattr(S,'apply',lambda c,m,t,b:events.append(('mutation',t['blind_id'])))
    if last_denied:
        with pytest.raises(S.A.InstallError,match='current_predecessor_tools_denied'):S.install(tmp_path,out,tmp_path/'review')
        assert len(events)==12 and not (out/'backups').exists() and not (out/'INSTALLED.json').exists()
    else:
        S.install(tmp_path,out,tmp_path/'review')
        assert events[:12]==[('preflight',n) for n in range(12)] and events[12]==('backup',12)
        assert sum(e[0]=='mutation' for e in events)==12 and (out/'INSTALLED.json').exists()
    assert active.read_bytes()==b'prior' and approval.read_text()==S.digest(b'prior')


def test_085_allowlist_only_and_catalog_identity(monkeypatch):
    import study_source_amendment as AM
    from study_controller import Hold
    m=dict(migration_additions={'/product/migrations/'+S.MIGRATION:'backend/migrations/'+S.MIGRATION},files={'backend/migrations/'+S.MIGRATION:'exact'})
    monkeypatch.setattr(AM,'load',lambda:m)
    assert AM.environment(dict(files={}))['files']=={'/product/migrations/'+S.MIGRATION:'exact'}
    m['migration_additions']['/product/migrations/086_fake.sql']='backend/migrations/086_fake.sql'
    with pytest.raises(Hold):AM.environment(dict(files={}))
    assert S.identity(ROOT)['consumer_sha256']==S.CONSUMER


@pytest.mark.parametrize('fail_binding',[False,True])
def test_actual_apply_atomic_boundary_idempotency_and_rollback(monkeypatch,fail_binding):
    from workagent import db
    from workagent.capabilities import implementation_releases as R
    class C:
        def __init__(self):
            self.info=NS(dsn='offline-bound-connection')
            self.value=dict(level=84,functions={'f':'old'},tables={n:dict(rows=0,row_hashes=[],sha256='empty') for n in S.ADDITIVE|{'public.native'}})
            self.value['tables']['public.schema_migrations']=dict(rows=84,row_hashes=['old']*84,sha256='old')
        @contextmanager
        def transaction(self,force_rollback=False):
            before=deepcopy(self.value)
            try:yield self
            except BaseException:self.value=before;raise
            finally:
                if force_rollback:self.value=before
        def execute(self,*a):assert a[0]=='SELECT pg_advisory_xact_lock(17402111)'
    c=C();before=deepcopy(c.value);base=dict(tables=deepcopy(before['tables']),acl=[])
    monkeypatch.setattr(S.A,'role',lambda *a,**kw:None);monkeypatch.setattr(S.A,'grant_ids',lambda c:['g'])
    monkeypatch.setattr(S,'schema',lambda c,m:c.value['level']);monkeypatch.setattr(S,'acl',lambda c:[])
    monkeypatch.setattr(S.A,'snapshot',lambda c:deepcopy(c.value['tables']));monkeypatch.setattr(S.A,'functions',lambda c:c.value['functions'])
    monkeypatch.setattr(S,'predecessor_available',lambda *a:None);monkeypatch.setattr(S,'identity',lambda *a:{'frozen':True})
    monkeypatch.setattr(S.A,'runtime_acl_readback',lambda *a:None)
    def migrate(*a):
        assert a==('offline-bound-connection',)
        if c.value['level']==84:
            c.value['level']=85;c.value['functions']={'f':'new'}
            c.value['tables']['public.schema_migrations']=dict(rows=85,row_hashes=['old']*84+['085'],sha256='new')
    def bind(*a,**kw):
        assert kw==dict(amendment_sha256='exact-amendment',predecessor_source_sha256=S.OLD_SOURCE)
        if fail_binding:raise S.A.InstallError('binding_denied')
        for n in S.ADDITIVE-{'public.schema_migrations'}:c.value['tables'][n]=dict(rows=1,row_hashes=['exact_new_row'],sha256='new')
        return {'frozen':True}
    monkeypatch.setattr(db,'migrate',migrate);monkeypatch.setattr(R,'install_transition',bind)
    monkeypatch.setattr(S,'release_readback',lambda c,*a:all(c.value['tables'][n]['rows']==1 for n in S.ADDITIVE-{'public.schema_migrations'}))
    m=dict(_root=str(ROOT),_amendment='exact-amendment',sql_definitions=dict(before={'f':'old'},after={'f':'new'}));t=dict(grant_ids=['g'])
    if fail_binding:
        with pytest.raises(S.A.InstallError,match='binding_denied'),c.transaction():S.apply(c,m,t,base)
    else:
        with c.transaction(force_rollback=True):
            S.apply(c,m,t,base);first=deepcopy(c.value);S.apply(c,m,t,base);assert c.value==first
    assert c.value==before


@pytest.mark.parametrize('damage',[None,'unavailable','schema'])
def test_predecessor_effective_binding_not_birth_pin_override(monkeypatch,damage):
    from workagent.capabilities.registry import adapters
    d=adapters()['context.read'].descriptor.model_dump(mode='json');old=deepcopy(d);old['implementation_sha256']='a'*64
    if damage=='schema':old['schema_sha256']='b'*64
    class C:
        def execute(self,sql,args):
            if sql.startswith('SELECT * FROM tool_grants'):value=dict(workspace_id='w',run_id='r',data=dict(capabilities=[dict(id='context.read')]))
            elif sql.startswith('SELECT tool_implementation_descriptor'):
                assert args==('g','context.read',S.OLD_SOURCE,S.OLD_CONSUMER);value={'d':old}
            else:
                assert sql.startswith('SELECT tool_run_available');value={'ok':damage!='unavailable'}
            return NS(fetchone=lambda:value)
    monkeypatch.setattr(S.A,'grant_ids',lambda c:['g'])
    if damage:
        with pytest.raises(S.A.InstallError):S.predecessor_available(C(),['g'])
    else:S.predecessor_available(C(),['g'])


@pytest.mark.parametrize('damage',[None,'candidate','trial','function_map'])
def test_exact_installed84_trial_catalog(damage):
    candidate=(HERE/'predecessor/activation56.CANDIDATE.json').read_bytes()
    trial=(ROOT/S.PRIOR_TRIAL).read_bytes()
    if damage=='candidate':candidate+=b' '
    if damage=='trial':trial+=b' '
    if damage=='function_map':
        changed=json.loads(trial);changed['functions_after'][S.FUNCTION]='0'*64
        trial=S.canonical(changed).encode()
    if damage:
        with pytest.raises(S.A.InstallError,match='activated56_(candidate|trial)_drift'):
            S.predecessor_functions(candidate,trial)
    else:
        functions=S.predecessor_functions(candidate,trial)
        assert len(functions)==237 and functions==json.loads(trial)['functions_after']
        assert functions!=json.loads(candidate)['sql_definitions']['after']


@pytest.mark.parametrize('damage',[False,True])
def test_load_requires_exact_installed84_before_map(tmp_path,monkeypatch,damage):
    candidate=(HERE/'predecessor/activation56.CANDIDATE.json').read_bytes();prior=json.loads(candidate)
    trial=(ROOT/S.PRIOR_TRIAL).read_bytes();functions=S.predecessor_functions(candidate,trial)
    if damage:functions=dict(functions,**{S.FUNCTION:'0'*64})
    m=dict(files={},successor=prior['successor'],file_input_continuation=prior['file_input_continuation'],
        sql_definitions=dict(before=functions),release_transition=dict(predecessor_trial=S.PRIOR_TRIAL,
        predecessor_trial_sha256=S.PRIOR_TRIAL_SHA,baseline_sha256=S.digest(S.canonical({}))))
    (tmp_path/'PREDECESSOR.json').write_bytes(candidate);(tmp_path/'PREDECESSOR_TRIAL.json').write_bytes(trial)
    (tmp_path/'CANDIDATE.json').write_text(S.canonical(m));(tmp_path/'BASELINE.json').write_text('{}')
    monkeypatch.setattr(S,'identity',lambda root:None)
    if damage:
        with pytest.raises(S.A.InstallError,match='activated56_functions_drift'):S.load(ROOT,tmp_path)
    else:assert S.load(ROOT,tmp_path)[1]['sql_definitions']['before']==functions
