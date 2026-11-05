"""Independent scoped review probes; no database provisioning or provider I/O.

The reproducer tests assert observed defects, not the desired fixed behavior.
All mutations are test-local; original evidence and execution lock stay unchanged.
"""
from pathlib import Path
from types import SimpleNamespace
import copy
import json
import shutil
import subprocess
import sys

import pytest

import study_application as app
import study_controller as sc
import study_diagnostic as sd
import study_transport as st
from test_study_controller import DurablePeer
from verify_study_diagnostic import verify

ROOT = sc.ROOT


@pytest.fixture(autouse=True)
def forbid_network(monkeypatch):
    import socket
    def denied(*args, **kwargs):
        raise AssertionError('review probe must not use network')
    monkeypatch.setattr(socket.socket, 'connect', denied)
    monkeypatch.setattr(socket.socket, 'connect_ex', denied)


def shadow_controller_root(tmp_path):
    """Exact frozen inputs are read from original paths; only source roots change."""
    shadow = tmp_path/'shadow'
    shadow.mkdir()
    (shadow/'evaluation').mkdir()
    for source in (ROOT/'evaluation').glob('*.py'):
        shutil.copyfile(source, shadow/'evaluation'/source.name)
    (shadow/'backend').symlink_to(ROOT/'backend', target_is_directory=True)
    freeze = json.loads((sc.PREP/'evaluator/FREEZE.json').read_text())
    for item in freeze['files']:
        dest = shadow/item['path']
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT/item['path'], dest)
    baseline = shadow/'.local/batch3/b35b/baseline/workagent'
    baseline.mkdir(parents=True)
    (baseline/'__init__.py').write_text('# WRONG baseline, not retained accepted B0\n')
    return shadow


def test_reproducer_cold_controller_accepts_unanchored_b0(tmp_path, monkeypatch):
    # Run the real frozen input/schedule validators against byte-preserved copies.
    monkeypatch.setattr(sc, 'ROOT', shadow_controller_root(tmp_path))
    peer = DurablePeer()
    c = sc.Controller(tmp_path/'cold.sqlite', peer)
    try:
        assert set(c.sources['B0']) == {'__init__.py'}
        c.run(stop_after=1)
        assert peer.calls[0][1] == 'open_trajectory'
        # A fresh controller stores the current tree as truth, not accepted B0.
        assert c.db.execute('SELECT count(*) FROM binding').fetchone()[0] == 1
    finally:
        c.close()


def test_reproducer_runtime_mount_drift_survives_controller_restart(tmp_path, monkeypatch):
    shadow = shadow_controller_root(tmp_path)
    runtime = shadow/'runtime'
    runtime.mkdir()
    policy = runtime/'general-responses-v1.json'
    policy.write_text('{"version":"before"}')
    monkeypatch.setattr(sc, 'ROOT', shadow)
    c = sc.Controller(tmp_path/'state.sqlite', DurablePeer())
    before = c.db.execute('SELECT value FROM binding').fetchone()[0]
    c.close()
    policy.write_text('{"version":"CHANGED"}')
    c = sc.Controller(tmp_path/'state.sqlite', DurablePeer())
    try:
        assert c.db.execute('SELECT value FROM binding').fetchone()[0] == before
        assert 'general-responses-v1.json' not in json.loads(before)['execution']
    finally:
        c.close()


def test_reproducer_worker_cfg_omits_retained_environment_pins(tmp_path, monkeypatch):
    """Capture actual execute() payload immediately before any subprocess/SQL."""
    cfg_row = {'data': {'fixture': 'configuration'}}
    class Cursor:
        def execute(self, *args): return self
        def fetchone(self): return cfg_row
        def __enter__(self): return self
        def __exit__(self, *args): pass
    service = SimpleNamespace(db=SimpleNamespace(transaction=Cursor))
    monkeypatch.setattr(app, 'context', lambda *_: (service, SimpleNamespace(id='test'), {'DATABASE_URL':'postgresql://unused@127.0.0.1:5432/workagent_test_unused'}))
    product = tmp_path/'product'
    product.mkdir()
    (product/'__init__.py').write_text('# inert fixture\n')
    state = {'episode':1, 'variant':'B0', 'source_manifest_sha256':sc.digest(sc.canonical(app.inventory(product))),
             'mode':'controlled_http', 'controlled_origin':'http://127.0.0.1:45678',
             'workspace':'test', 'current_run':'test', 'active_grant':{'id':'test'},
             'input_files':{}, 'inputs':str(tmp_path)}
    monkeypatch.setattr(app, 'jail', lambda *_: [str(ROOT/'evaluation/network_worker.py'),'--'])
    captured = {}
    class StopBeforeLaunch(Exception): pass
    def capture(argv, **kwargs):
        captured.update(json.loads(kwargs['input']))
        raise StopBeforeLaunch
    monkeypatch.setattr(app.subprocess, 'run', capture)
    with pytest.raises(StopBeforeLaunch):
        app.execute(tmp_path, state, {})
    assert set(captured['execution_files']) == {'/worker.py','/network_worker.py','/study_transport.py'}
    assert not any(p.startswith(('/runtime/', '/usr/', '/product/migrations/', '/home/worker/')) for p in captured['execution_files'])
    assert captured['dependencies'] == app.inventory(app.DEPS)


def test_reproducer_open_live_scope_accepts_identical_project_and_conversation(tmp_path, monkeypatch):
    """Simulated post-release branch; all authority/DB access is in-memory fake.

    Does NOT activate the real lock or obtain credentials, grants or database access.
    """
    from workagent import service as service_module, db as db_module
    bindings = {'blind_id':'a'*24, 'database_url':'not-a-real-database', 'principal':'test',
                'workspaces':['same-workspace','same-workspace'],
                'conversations':['same-conversation']*3, 'other':'same-conversation',
                'grant':{'id':'same-grant','responses':{'transport_mode':'official_api','memory_recall':'off'}}}
    bindings['other_grant'] = bindings['grant']
    class Cursor:
        def execute(self, *args): return self
        def fetchone(self): return {'data':bindings['grant'],'active':True}
        def __enter__(self): return self
        def __exit__(self, *args): pass
    seen = []
    fake_db = SimpleNamespace(check_runtime_role=lambda:None, transaction=Cursor)
    fake_service = SimpleNamespace(db=fake_db, get_conversation=lambda *args:seen.append(args))
    monkeypatch.setattr(service_module, 'Service', lambda _:fake_service)
    monkeypatch.setattr(db_module, 'Database', lambda _:fake_db)
    monkeypatch.setattr(st, 'require_live_release', lambda:None)
    source_hash = sc.digest(sc.canonical(app.inventory(ROOT/'backend/workagent')))
    payload = {'blind_id':'a'*24,'variant':'B1','source_manifest_sha256':source_hash,'mode':'official_api','memory_recall':'off'}
    state, result = app.open_trajectory(tmp_path, payload, bindings)
    assert state['workspaces'][0] == state['workspaces'][1]
    assert state['conversations'][0] == state['other']
    assert len(seen) == 4
    assert result['id'] == payload['blind_id']


def test_reproducer_export_packet_tamper_passes_retained_verifier(tmp_path):
    retained = ROOT/'.local/batch3/b35c/controller-12'
    # Copy evidence database, do not open original read-write or change any receipts.
    shutil.copyfile(retained/'controller.sqlite', tmp_path/'controller.sqlite')
    (tmp_path/'http-calls.jsonl').symlink_to(retained/'http-calls.jsonl')
    shutil.copytree(retained/'evaluation-packets', tmp_path/'evaluation-packets')
    target = sorted((tmp_path/'evaluation-packets').glob('*.json'))[0]
    packet = json.loads(target.read_text())
    packet.update(blind_id='wrong-identity', episode=999, artifacts=[], messages=[], oracle_sha256='0'*64)
    target.write_text(sc.canonical(packet))
    result = verify(tmp_path)
    assert result['status'] == 'PASS'
    assert result['blinded_unscored_packets'] == 72


def test_adapter_lost_ack_observes_without_second_subprocess(tmp_path, monkeypatch):
    calls=[]
    def fake_process(*args, **kwargs):
        calls.append(kwargs['input'])
        return SimpleNamespace(returncode=0,stdout='{"diagnostic":true}',stderr='')
    monkeypatch.setattr(sd.subprocess, 'run', fake_process)
    payload={'blind_id':'a'*24,'variant':'B1'}
    adapter=sd.ProductAdapter(tmp_path,'http://127.0.0.1:1')
    adapter.drop_ack=True
    with pytest.raises(ConnectionError): adapter.call('stable-key','open_trajectory',payload)
    adapter.close()
    adapter=sd.ProductAdapter(tmp_path,'http://127.0.0.1:1')
    try:
        assert adapter.observe('stable-key')['state']=='complete'
        assert adapter.call('stable-key','open_trajectory',payload)['state']=='complete'
        assert len(calls)==1
    finally: adapter.close()


def test_adapter_failed_child_stays_unknown_without_resend(tmp_path, monkeypatch):
    calls=[]
    def fake_process(*args, **kwargs):
        calls.append(True)
        return SimpleNamespace(returncode=1,stdout='',stderr='injected child failure')
    monkeypatch.setattr(sd.subprocess, 'run', fake_process)
    payload={'blind_id':'a'*24,'variant':'B1'}
    adapter=sd.ProductAdapter(tmp_path,'http://127.0.0.1:1')
    with pytest.raises(sc.Hold,match='application_operation_unknown'):
        adapter.call('stable-key','open_trajectory',payload)
    adapter.close()
    adapter=sd.ProductAdapter(tmp_path,'http://127.0.0.1:1')
    try:
        assert adapter.call('stable-key','open_trajectory',payload)['state']=='unknown'
        assert len(calls)==1
    finally: adapter.close()


def test_actual_worker_official_mode_denied_before_source_or_db():
    p=subprocess.run([str(ROOT/'backend/.venv/bin/python'),'-B',str(ROOT/'evaluation/study_worker.py')],
                     input='{"transport":"official_api"}',text=True,capture_output=True,
                     env={'PATH':'/usr/bin:/bin','PYTHONPATH':str(ROOT/'evaluation')},timeout=20)
    assert p.returncode != 0
    assert 'paid_execution_unreleased_t_e07c8870' in p.stderr
    assert 'source_manifest' not in p.stderr
    assert st.LIVE_EXECUTION_RELEASE is None


@pytest.mark.parametrize('kind',['credential','grant','transport'])
def test_controlled_transport_rejects_ambiguous_authority(kind):
    cfg={'transport':'controlled_http','controlled_origin':'http://127.0.0.1:1',
         'grant':{'responses':{'transport_mode':'synthetic'}}}
    credential=None
    if kind=='credential': credential='dummy-not-a-secret'
    elif kind=='grant': cfg['grant']['responses']['transport_mode']='official_api'
    else: cfg['transport']='unknown'
    with pytest.raises(RuntimeError): st.attach_transport(None,cfg,credential=credential)
