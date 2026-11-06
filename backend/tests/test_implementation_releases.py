"""Offline exact-identity and persisted-projection controls; no PG or network."""
from copy import deepcopy
from hashlib import sha256
from inspect import signature
from types import SimpleNamespace
from unittest.mock import patch
import json
from pathlib import Path
import pytest
from workagent.capabilities import implementation_releases as releases, registry
from workagent import retained_results as retained
from workagent.errors import DomainError
from workagent.service import digest

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'.local/batch3/b35c/retained-read-recovery'


def test_closed_compatible_catalog_and_honest_hashes():
    old=json.loads((BASE/'classification-01/BEFORE.json').read_text())['descriptors']
    live={k:a.descriptor.model_dump(mode='json') for k,a in registry.adapters().items()}
    assert len(old)==len(live)==23 and len(releases.TRANSITION_IDS)==12
    for k,d in live.items():
        assert old[k]['implementation_sha256']!=d['implementation_sha256']
        if k in {'artifacts.export', 'artifacts.export.office'}:
            # Named exports broaden their output schema. Never classify these as
            # an implementation-only upgrade of an installed historical pin.
            assert old[k]['schema_sha256']!=d['schema_sha256']
            assert old[k]['output_schema']!=d['output_schema']
            assert {x:v for x,v in old[k].items() if x not in {'implementation_sha256','schema_sha256','output_schema'}}=={x:v for x,v in d.items() if x not in {'implementation_sha256','schema_sha256','output_schema'}}
            assert not releases.compatible(old[k],d)
        else:
            assert {x:v for x,v in old[k].items() if x!='implementation_sha256'}=={x:v for x,v in d.items() if x!='implementation_sha256'}
            assert releases.compatible(old[k],d)==(k in releases.TRANSITION_IDS)


@pytest.mark.parametrize('field',['schema_sha256','version','effects','resource_kinds','cost_profile',
    'timeout_ms','result_byte_limit','execution_profile','input_schema','output_schema','id'])
def test_no_authority_or_contract_compatibility(field):
    old=registry.adapters()['files.read_range'].descriptor.model_dump(mode='json');new=deepcopy(old)
    new[field]=['forged'] if isinstance(new[field],list) else {'forged':True} if isinstance(new[field],dict) else 'forged'
    assert not releases.compatible(old,new)


def test_computed_identity_and_dependency_closure():
    assert not signature(releases.execution_identity).parameters
    identity=releases.execution_identity()
    assert identity['source_sha256']==digest(identity['dependencies']['product'])
    assert identity['dependencies']['product']['capabilities/implementation_releases.py']==sha256(
        (ROOT/'backend/workagent/capabilities/implementation_releases.py').read_bytes()).hexdigest()
    assert all(n in identity['dependencies']['migrations'] for n in
        ['080_builtin_operation_classification.sql','081_capability_implementation_releases.sql','082_native_retained_result_projection.sql'])
    with pytest.raises(TypeError):releases.execution_identity(source_sha256='0'*64)


class Cursor:
    def __init__(self,rows):self.rows=iter(rows);self.calls=[]
    def execute(self,sql,args=None):self.calls.append((sql,args));self.row=next(self.rows);return self
    def fetchone(self):return self.row
    def fetchall(self):return self.row


def test_reserve_uses_run_identity_and_computed_release():
    d=registry.adapters()['files.read_range'].descriptor
    c=Cursor([{'id':'g'}, {'exists':1}, {'d':d.model_dump(mode='json')}, {'id':'attempt'}])
    identity={'source_sha256':'1'*64,'consumer_sha256':'2'*64}
    cap=SimpleNamespace(workspace_id='w',run_id='r',fence=4,secret='private-test-value')
    with patch.object(releases,'execution_identity',return_value=identity):
        assert releases.reserve(c,cap,{'call':'exact'},'3'*64,d)=='attempt'
    assert c.calls[0][1]==('w','r')
    assert 'reserve_tool_call_v2' in c.calls[-1][0]
    assert c.calls[-1][1][-2:]==('1'*64,'2'*64)


@pytest.mark.parametrize('version',[None,retained.LEGACY_PROJECTION,retained.NATIVE_PROJECTION])
@pytest.mark.parametrize('available',[False,True])
def test_retry_and_revalidation_choose_saved_version_before_material(version,available):
    d=retained.ReadResult(kind='read_result',run_id='source',phase='selection',operation_hash='a'*64,offset=0,limit=8192)
    raw=b'old exact material' if available else None
    result={'status':'unavailable'} if raw is None else {'status':'available',**retained.page_bytes(raw,0,8192)}
    data={'decision':d.model_dump(mode='json'),'binding':{'exact':1},'result':result}
    if version is not None:data['projection_version']=version
    run=SimpleNamespace(workspace_id='w',id='r')
    with patch.object(retained,'projection_version',side_effect=AssertionError('must not select new semantics on retry')), \
         patch.object(retained,'material',return_value=raw) as material:
        c=Cursor([{'data':data}])
        assert retained.read(None,c,None,run,None,d,'selection_2',{'exact':1})['result']==result
        assert material.call_args.kwargs=={'projection':version or retained.LEGACY_PROJECTION}
        c=Cursor([[{'data':data}]])
        retained.revalidate_reads(None,c,None,run,None)
        assert material.call_args.kwargs=={'projection':version or retained.LEGACY_PROJECTION}


@pytest.mark.parametrize('pages,used,raw',[(8,0,b'a'),(7,32768,b'a')])
def test_shared_limits_preserved(pages,used,raw):
    d=retained.ReadResult(kind='read_result',run_id='s',phase='selection',operation_hash='a'*64,offset=0,limit=8192)
    c=Cursor([None,{'pages':pages,'bytes':used}])
    with patch.object(retained,'projection_version',return_value=retained.NATIVE_PROJECTION),patch.object(retained,'material',return_value=raw):
        with pytest.raises(DomainError,match='budget_exhausted'):
            retained.read(None,c,None,SimpleNamespace(workspace_id='w',id='r'),None,d,'selection_2',{})
    assert not any('INSERT' in sql for sql,_ in c.calls)


@pytest.mark.parametrize('field,value',[('implementation_sha256','0'*64),('timeout_ms',1),('effects',['read','draft'])])
def test_resolver_never_accepts_compatible_looking_return_as_live_descriptor(field,value):
    descriptor=registry.adapters()['files.read_range'].descriptor
    wrong=descriptor.model_dump(mode='json');wrong[field]=value
    c=Cursor([{'id':'g'},{'exists':1},{'d':wrong}])
    identity={'source_sha256':'1'*64,'consumer_sha256':'2'*64}
    with patch.object(releases,'execution_identity',return_value=identity),pytest.raises(DomainError):
        releases.resolve_for_run(c,SimpleNamespace(workspace_id='w',id='r'),descriptor)
    assert c.calls[-1][1]==('g','files.read_range','1'*64,'2'*64)


@pytest.mark.parametrize('component',['source','consumer','migrations'])
def test_complete_release_key_distinguishes_unchanged_descriptor(component):
    d=registry.adapters()['files.list'].descriptor.model_dump(mode='json')
    a=dict(source_sha256=digest({'a.py':'a'*64}),consumer_sha256='b'*64,
        dependencies={'product':{'a.py':'a'*64},'migrations':{'081.sql':'c'*64}})
    b=deepcopy(a)
    if component=='source':
        b['dependencies']['product']['new.py']='d'*64
        b['source_sha256']=digest(b['dependencies']['product'])
    elif component=='consumer':b['consumer_sha256']='e'*64
    else:b['dependencies']['migrations']['082.sql']='f'*64
    assert releases.release_record(d,a)['descriptor_sha256']==releases.release_record(d,b)['descriptor_sha256']==digest(d)
    assert releases.release_id(d,a)!=releases.release_id(d,b)
    assert releases.release_id(d,a)==digest(releases.release_record(d,a))


def test_initial_release_has_no_fabricated_predecessor_or_prior_grant():
    d=registry.adapters()['files.list'].descriptor.model_dump(mode='json')
    g={'id':'new-grant','data':{'capabilities':[{'id':d['id']}]}}
    c=Cursor([g,[]]);identity={'source_sha256':'a'*64,'consumer_sha256':'b'*64,'dependencies':{}}
    with patch.object(releases,'execution_identity',return_value=identity),patch.object(releases,'_binding') as bind:
        releases.bind_new_grant(c,g['id'],amendment_sha256='c'*64)
    bind.assert_called_once_with(c,g,d,identity,'c'*64,None)


def test_readback_resolves_actual_live_descriptor_before_returning_identity():
    d=registry.adapters()['files.list'].descriptor
    g={'active':True,'data':{'capabilities':[{'id':d.id,'implementation_sha256':'old-pin'}]}}
    run=SimpleNamespace(workspace_id='w',id='r');c=Cursor([g]);identity={'actual':'loaded'}
    with patch.object(releases,'resolve_for_run') as resolve,patch.object(releases,'execution_identity',return_value=identity):
        result=releases.readback(c,run)
    resolve.assert_called_once_with(c,run,d)
    assert result==dict(tool_grant=g['data'],descriptors={d.id:d.model_dump(mode='json')},execution_identity=identity)
    with patch.object(releases,'resolve_for_run',side_effect=DomainError('not_found_or_not_authorized')),pytest.raises(DomainError):
        releases.readback(Cursor([g]),run)


@pytest.mark.parametrize('damage',[None,'receipt_drift','expired'])
def test_actual_existing_receipt_bootstrap_keeps_old_pins(tmp_path,monkeypatch,damage):
    from contextlib import contextmanager
    from datetime import timedelta
    import live_tool_authority as bootstrap
    from workagent.capabilities.models import ToolGrantV1,CapabilityPin
    from workagent.models import now
    from workagent.capabilities import policy
    descriptors=[registry.adapters()[name].descriptor for name in bootstrap.CAPABILITIES]
    g=ToolGrantV1(id='old-g',workspace_id='w',principal_id='p',run_id='r',scope_id='cv',
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,
            implementation_sha256='0'*64) for d in descriptors],resource_selectors=[],
        effects=['read','draft','local_compute'],privacy_classes=['public','workspace_private'],egress='public_https',
        expires_at=now()+timedelta(hours=-1 if damage=='expired' else 1),access_generation=1,budget_account_id='account')
    actual=g.model_dump(mode='json')
    if damage=='receipt_drift':actual={**actual,'budget_account_id':'different-account'}
    class DB:
        @contextmanager
        def transaction(self):yield Cursor([{'data':actual,'active':True}])
    db=DB();run=SimpleNamespace(id='r',workspace_id='w',principal_id='p',conversation_id='cv',access_generation=1)
    service=SimpleNamespace(db=db,get_run=lambda *args:run)
    monkeypatch.setattr(bootstrap,'ROOT',tmp_path)
    monkeypatch.setattr(bootstrap,'Database',lambda _:db)
    monkeypatch.setattr(bootstrap,'Service',lambda _:service)
    inputs=tmp_path/'.local/batch3/b35c/preparation/public-inputs/fixture';inputs.mkdir(parents=True)
    receipts=tmp_path/'receipts';receipts.mkdir();path=receipts/'r.json';path.write_text(g.model_dump_json())
    raw=path.read_bytes();pg={'id':'pg','responses':{'conversation_ids':['cv']}}
    binding=dict(blind_id='blind',grant=pg,workspaces=['w'],database_url='unused',migration_database_url='unused',principal='p')
    state=dict(variant='M1',blind_id='blind',mode='official_api',workspace='w',current_run='r',conversation='cv',
        episode=1,active_grant=pg,inputs=str(inputs),input_files={})
    with patch.object(policy,'install',side_effect=AssertionError('must not reinstall historical grant')), \
         patch.object(policy,'grant',return_value=g),patch.object(policy,'require_run_tools') as require, \
         patch.object(releases,'readback',return_value={'tool_grant':g.model_dump(mode='json')}) as readback:
        if damage:
            with pytest.raises(AssertionError):bootstrap.install(binding,state,receipts)
            readback.assert_not_called()
        else:
            assert bootstrap.install(binding,state,receipts)==g.model_dump(mode='json')
            require.assert_called_once();readback.assert_called_once()
    assert path.read_bytes()==raw and all(pin.implementation_sha256=='0'*64 for pin in g.capabilities)
