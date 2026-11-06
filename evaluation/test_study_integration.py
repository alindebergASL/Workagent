"""Narrow R1-R4 closure; synthetic mapping and zero-provider denials only."""
import copy
import json
from pathlib import Path
import subprocess
import pytest

import study_binding as B
import study_controller as C
from study_diagnostic import ProductAdapter
from verify_study_diagnostic import verify_packets


def test_accepted_source_anchors_and_cold_rejection(tmp_path, monkeypatch):
    real = C.inventory
    sources = {v:real(C.ROOT/('.local/batch3/b35b/baseline/workagent' if v=='B0' else 'backend/workagent')) for v in B.SOURCE_HASHES}
    B.validate_sources(sources)
    def tampered(path):
        result = real(path)
        if str(path).endswith('baseline/workagent'):
            result['__init__.py'] = '0'*64
        return result
    monkeypatch.setattr(C,'inventory',tampered)
    with pytest.raises(C.Hold,match='accepted_source_drift:B0'):
        C.Controller(tmp_path/'cold.sqlite',None)


@pytest.mark.parametrize('path', ['/usr/bin/python3','/runtime/general-responses-v1.json','/product/migrations/074_run_output_resources.sql','/home/worker/.cache/workagent/o200k_base.tiktoken','/product/requirements-office.lock'])
def test_original_environment_pins_reject_host_drift(path):
    env = B.environment()
    assert path in env['files']
    env['files'][path] = '0'*64
    with pytest.raises(C.Hold,match='execution_environment_drift|application_interpreter_drift'):
        B.validate_environment(env)


def test_dependencies_reject_rebaseline():
    env = B.environment()
    env['dependencies']['nonexistent'] = '0'*64
    with pytest.raises(C.Hold,match='dependency_drift'):
        B.validate_environment(env)


def test_sourceless_dependency_bytecode_rejected(tmp_path, monkeypatch):
    env = B.environment()
    shadow = tmp_path/'backend/.venv/lib/python3.12/site-packages/typing'
    shadow.mkdir(parents=True)
    source = tmp_path/'payload.py'; source.write_text('MARKER=123\n')
    import py_compile
    py_compile.compile(str(source),cfile=str(shadow/'__init__.pyc'),doraise=True)
    monkeypatch.setattr(B,'REPO',tmp_path)
    with pytest.raises(C.Hold,match='sourceless_dependency_bytecode'):
        B.validate_environment(env)


@pytest.mark.parametrize('fault',['pin','bytecode'])
def test_actual_worker_rejects_pin_before_sql(tmp_path,fault):
    from network_harness import jail, REPO, inventory
    inputs = REPO/'.local/batch3/b35c/preparation/public-inputs/B1/episode-1'
    product = REPO/'.local/batch3/b35c/controller-12/d477c622c837a9cc1fb1f0be/product'
    state = tmp_path/'state'; state.mkdir()
    env = B.environment()
    if fault=='pin':
        env['files']['/usr/bin/python3'] = '0'*64
    cfg = dict(transport='controlled_http',source_manifest=inventory(product),input_files=inventory(inputs),execution_files=env['files'],dependencies=env['dependencies'])
    argv = jail(inputs,state,product)
    if fault=='bytecode':
        deps=tmp_path/'deps'; deps.mkdir()
        source=tmp_path/'source.py'; source.write_text('MARKER=123\n')
        import py_compile
        py_compile.compile(str(source),cfile=str(deps/'injected.pyc'),doraise=True)
        argv[argv.index('/deps')-1]=str(deps)
        cfg['dependencies']={}
    argv[argv.index(str(REPO/'evaluation/network_worker.py'))] = str(REPO/'evaluation/study_worker.py')
    at=argv.index('--')
    argv[at:at]=['--ro-bind',str(REPO/'evaluation/network_worker.py'),'/network_worker.py','--ro-bind',str(REPO/'evaluation/study_transport.py'),'/study_transport.py']
    result=subprocess.run(argv,input=json.dumps(cfg),text=True,capture_output=True,timeout=60)
    assert result.returncode==64, result.stderr
    assert json.loads(result.stdout)['reason']==('execution_file_drift' if fault=='pin' else 'sourceless_dependency_bytecode')


@pytest.mark.parametrize('name',['test_adapter_lost_ack_observes_without_second_subprocess','test_adapter_failed_child_stays_unknown_without_resend'])
def test_retained_receipt_guards_with_scoped_child_mock(tmp_path,monkeypatch,name):
    # Old review globally monkeypatches subprocess.run, now also used by uname.
    # Scope that old fake to the adapter child launch; keep real environment checks.
    import importlib.util
    from types import SimpleNamespace
    import study_diagnostic
    path=C.ROOT/'docs/evidence/batch3-b35c/controller-review/test_scoped_review.py'
    spec=importlib.util.spec_from_file_location('retained_review',path)
    assert spec is not None and spec.loader is not None
    review=importlib.util.module_from_spec(spec); spec.loader.exec_module(review)
    monkeypatch.setattr(study_diagnostic,'subprocess',SimpleNamespace(run=subprocess.run))
    getattr(review,name)(tmp_path,monkeypatch)


def bindings():
    result={}
    for t in C.load_schedule()[1]:
        key=t['blind_id']; ws=[key+'-project',key+'-other']; cvs=[key+'-original',key+'-transfer']; other=key+'-outside'
        grants=[{'id':key+str(i),'workspace_id':w,'principal_id':'synthetic','responses':{'conversation_ids':ids}} for i,(w,ids) in enumerate(zip(ws,[cvs,[other]]))]
        result[key]=dict(blind_id=key,workspaces=ws,conversations=cvs,other=other,principal='synthetic',grant=grants[0],other_grant=grants[1])
    return result


@pytest.mark.parametrize('kind',['workspace','conversation','other','cross_workspace','cross_conversation','grant'])
def test_context_aliases_rejected(kind):
    bs=bindings(); a,b=list(bs.values())[:2]
    if kind=='workspace': a['workspaces'][1]=a['workspaces'][0]
    elif kind=='conversation': a['conversations'][1]=a['conversations'][0]
    elif kind=='other': a['other']=a['conversations'][0]
    elif kind=='cross_workspace':
        b['workspaces'][0]=a['workspaces'][0]; b['grant']['workspace_id']=a['workspaces'][0]
    elif kind=='cross_conversation':
        b['conversations'][0]=a['conversations'][0]
    else: a['other_grant']['id']=a['grant']['id']
    with pytest.raises(C.Hold): B.validate_contexts(bs,C.load_schedule()[1])


def test_mapping_and_environment_bound_on_adapter_restart(tmp_path,monkeypatch):
    import study_transport
    monkeypatch.setattr(study_transport,'require_live_release',lambda:None) # in-memory admission test; never call adapter
    bs=bindings()
    a=ProductAdapter(tmp_path,None,live_bindings=bs); a.close()
    a=ProductAdapter(tmp_path,None,live_bindings=bs); a.close()
    next(iter(bs.values()))['principal']='changed'
    with pytest.raises(C.Hold): ProductAdapter(tmp_path,None,live_bindings=bs)
    bs=bindings(); first=next(iter(bs.values())); first['database_url']='synthetic-different-database'
    with pytest.raises(C.Hold,match='bridge_admission_binding_drift'):
        ProductAdapter(tmp_path,None,live_bindings=bs)


@pytest.mark.parametrize('kind',['blind_id','episode','oracle_sha256','artifacts','messages','evidence_level','judgment','duplicate','omission'])
def test_scoring_packet_substitution_rejected(tmp_path,kind):
    value=dict(blind_id='opaque',episode=1,artifacts=[{'body':'retained'}],messages=['retained'],oracle_sha256='f'*64,evidence_level='scripted')
    outcomes={('opaque',1):value}
    packet=dict(value,quality=None,effort=None,judgment='pending_independent_review')
    path=tmp_path/'opaque-1.json'; path.write_text(C.canonical(packet))
    verify_packets(tmp_path,outcomes)
    if kind=='duplicate': (tmp_path/'duplicate.json').write_text(C.canonical(packet))
    elif kind=='omission': path.unlink()
    else:
        packet[kind]=[] if kind in ('artifacts','messages') else 'substituted'
        path.write_text(C.canonical(packet))
    with pytest.raises(AssertionError): verify_packets(tmp_path,outcomes)
