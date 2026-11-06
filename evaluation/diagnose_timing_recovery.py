"""Launch a single no-HTTP cold probe on an existing disposable fixture only.

Clone CLI never provisions, copies funding, reads original stores, or changes ACLs.
Use TIMING_CLONE_DATABASE_URL for the already retained restricted clone role.
"""
from hashlib import sha256
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from urllib.parse import urlsplit
from uuid import uuid4
from network_harness import REPO, inventory, jail, digest
from study_application import stage_execution_source
from study_controller import canonical

OUT = REPO/'.local/batch3/b35c/timing-recovery/diagnosis-01'
CAPTURE = REPO/'.local/batch3/b35c/timing-recovery/ORIGINAL_EPISODE3.private.json'
ORIGINAL_HASH = '8d45e31d7ce6cdd598d2da480abee9da00bc37856e7652158dcb2891e4b1bbcf'
ORIGINAL_RUN = 'daacd79b-f1ab-4af9-a3d0-0699c2d03a45'
CLONE = 'workagent_test_stall_77db950a56'


def save(path, value):
    with path.open('x') as f:
        json.dump(value, f, sort_keys=True, indent=2, default=str)
        f.write('\n')


def capture():
    value = json.loads(CAPTURE.read_bytes())
    pending = next(r for r in value['steps'] if r['phase']=='selection_3')
    raw = pending['request_bytes'].encode()
    assert len(raw)==115779 and sha256(raw).hexdigest()==ORIGINAL_HASH
    assert value['run']['id']==ORIGINAL_RUN
    assert sorted(e['kind'] for e in value['events'] if e['phase']=='selection_3')==['count_result','count_send']
    return value, pending


def cold(service, principal, ws, rid, root, state, *, mode, origin=None,
         execution='rollback',fault='none'):
    """One actual bwrap process; no retry if the window fails to fit."""
    parts = urlsplit(service.db.dsn)
    assert parts.hostname in ('127.0.0.1','localhost') and parts.path.startswith('/workagent_test_')
    assert mode in ('synthetic','clone')
    assert execution in ('rollback','controlled_recovery')
    assert execution=='rollback' or mode=='synthetic'
    if mode=='clone':
        assert parts.path=='/'+CLONE and rid==ORIGINAL_RUN
    service.db.check_runtime_role()
    with service.db.transaction() as c:
        c.execute('SET TRANSACTION READ ONLY')
        rc = c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchone()['data']
        grant = c.execute('SELECT data FROM provider_grants WHERE id=%s',(rc['grant_id'],)).fetchone()['data']
        tool = c.execute('SELECT data FROM tool_grants WHERE run_id=%s',(rid,)).fetchone()['data']
        row = c.execute("SELECT s.* FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.run_id=%s AND s.phase='selection_3'",(rid,)).fetchone()
    assert grant['responses']['transport_mode']==('synthetic' if mode=='synthetic' else 'official_api')
    assert sha256(row['request_bytes'].encode()).hexdigest()==row['request_sha256']
    inputs = root/'inputs'
    inputs.mkdir()
    # Preserve the ORIGINAL bytes as a diagnostic-only input. They are never
    # substituted into the fresh authority arm's saved request or SQL history.
    _, original = capture()
    (inputs/'original-selection-3.json').write_bytes(original['request_bytes'].encode())
    (inputs/'fixture-selection-3.json').write_bytes(row['request_bytes'].encode())
    if mode=='clone':
        assert row['request_bytes']==original['request_bytes']
    source = REPO/'backend/workagent'
    product = stage_execution_source(root,source,sha256(canonical(inventory(source)).encode()).hexdigest())
    files = {'/worker.py':REPO/'evaluation/timing_recovery_probe.py',
        '/study_worker.py':REPO/'evaluation/study_worker.py',
        '/network_worker.py':REPO/'evaluation/network_worker.py',
        '/study_transport.py':REPO/'evaluation/study_transport.py'}
    from workagent.capabilities import registry
    ports = [parts.port or 5432]
    if origin:
        assert urlsplit(origin).hostname=='127.0.0.1' and urlsplit(origin).scheme=='http'
        ports.append(urlsplit(origin).port)
    assert 443 not in ports
    cfg = dict(transport='controlled_http' if mode=='synthetic' else 'official_api',
        dsn=str(service.db.dsn),workspace=ws,principal=principal,run_id=rid,
        grant_id=grant['id'],grant=grant,tool_grant=tool,run_configuration=rc,
        descriptors={p['id']:registry.adapters()[p['id']].descriptor.model_dump(mode='json') for p in tool['capabilities']},
        source_manifest=inventory(product),input_files=inventory(inputs),
        dependencies=inventory(REPO/'backend/.venv/lib/python3.12/site-packages'),
        execution_files={**{k:digest(v) for k,v in files.items()},'/usr/bin/python3':digest(Path('/usr/bin/python3').resolve())},
        allowed_tcp_ports=ports,forbidden_listener_port=1,probe_mode=mode,probe_phase='selection_3',
        probe_execution=execution,probe_fault=fault,
        probe_request_sha256=row['request_sha256'],probe_request_bytes=len(row['request_bytes'].encode()))
    if origin:
        cfg['controlled_origin']=origin
    argv = jail(inputs,state,product)
    argv[argv.index(str(REPO/'evaluation/network_worker.py'))] = str(files['/worker.py'])
    at = argv.index('--')
    argv[at:at] = [arg for name,path in files.items() if name!='/worker.py' for arg in ('--ro-bind',str(path),name)]
    start = time.monotonic()
    # Config/DSN is stdin only; never retained in logs or command arguments.
    try:
        result = subprocess.run(argv,input=json.dumps(cfg),text=True,capture_output=True,timeout=240)
    except subprocess.TimeoutExpired:
        save(root/'cold-timeout.json',dict(timeout_seconds=240,provider_io=0))
        raise RuntimeError('cold probe timeout; no raw subprocess config retained') from None
    (root/'cold.stdout').write_text(result.stdout)
    (root/'cold.stderr').write_text(result.stderr)
    lines = [json.loads(line)['timing_recovery'] for line in result.stderr.splitlines() if line.startswith('{"timing_recovery":')]
    report = dict(returncode=result.returncode, wall_seconds=time.monotonic()-start,
        trace=lines[-1] if lines else None, mode=mode, exact_original_request=mode=='clone',
        original_sha256=ORIGINAL_HASH,request_sha256=row['request_sha256'],request_bytes=cfg['probe_request_bytes'],
        source_manifest_sha256=sha256(canonical(cfg['source_manifest']).encode()).hexdigest(),
        provider_io=0,dispatch_commit_requested=execution=='controlled_recovery',
        controlled_http_permitted=execution=='controlled_recovery',synthetic_fixture_is_original_timing_proof=False)
    save(root/'TRACE.json',report)
    return report


def native_history(service,ws):
    """Immutable native unknown/cost/resolution rows, including preceding runs."""
    with service.db.transaction() as c:
        c.execute('SET TRANSACTION READ ONLY')
        queries={
            'attempts':'SELECT to_jsonb(t) v FROM tool_attempts t WHERE workspace_id=%s ORDER BY id',
            'events':'SELECT to_jsonb(e) v FROM tool_attempt_events e JOIN tool_attempts t ON t.id=e.attempt_id WHERE t.workspace_id=%s ORDER BY e.attempt_id,e.kind',
            'costs':'SELECT to_jsonb(e) v FROM tool_cost_entries e JOIN tool_attempts t ON t.id=e.attempt_id WHERE t.workspace_id=%s ORDER BY to_jsonb(e)::text',
            'resolutions':'SELECT to_jsonb(e) v FROM file_input_no_effect_resolutions e JOIN tool_attempts t ON t.id=e.tool_attempt_id WHERE t.workspace_id=%s ORDER BY t.id'}
        return {key:sha256(json.dumps(c.execute(sql,(ws,)).fetchall(),sort_keys=True,default=str).encode()).hexdigest()
            for key,sql in queries.items()}


def clone(out=OUT):
    # Explicit known clone only; no DSN discovery, retargeting, owner connection,
    # ACL changes, backup/restore, grant install, or source amendments.
    from workagent.db import Database
    from workagent.service import Service, Principal
    import sys
    sys.path.insert(0,str(REPO/'backend/tests'))
    from test_final_resume import snapshot, wait_natural_expiry
    from test_gateway_target_rejection import material
    from types import SimpleNamespace
    dsn = os.environ['TIMING_CLONE_DATABASE_URL']
    assert urlsplit(dsn).path=='/'+CLONE
    service = Service(Database(dsn))
    service.db.check_runtime_role()
    original, _ = capture()
    with service.db.transaction() as c:
        c.execute('SET TRANSACTION READ ONLY')
        run = c.execute('SELECT data FROM runs WHERE id=%s',(ORIGINAL_RUN,)).fetchone()['data']
    ws = run['workspace_id']
    with service.db.transaction() as c:
        c.execute('SET TRANSACTION READ ONLY')
        config = c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,ORIGINAL_RUN)).fetchone()['data']
        grant = c.execute('SELECT data FROM provider_grants WHERE id=%s',(config['grant_id'],)).fetchone()['data']
    root = out/('clone-'+uuid4().hex[:12]);root.mkdir()
    prior = REPO/'.local/batch3/b35c/target-create-closure'/('stall-'+CLONE)/'state'
    shutil.copytree(prior,root/'state')
    ctx = (service,Principal(grant['principal_id']),ws,[],None)
    before = snapshot(ctx,ORIGINAL_RUN); before_material=material(ctx)
    before_native=native_history(service,ws)
    assert [{k:r[k] for k in ('phase','request_bytes','request_sha256','count_bytes','count_sha256')} for r in before['steps']]==[
        {k:r[k] for k in ('phase','request_bytes','request_sha256','count_bytes','count_sha256')} for r in original['steps']]
    wait_natural_expiry(ctx,SimpleNamespace(run=SimpleNamespace(id=ORIGINAL_RUN)))
    report = cold(service,grant['principal_id'],ws,ORIGINAL_RUN,root,root/'state',mode='clone')
    assert snapshot(ctx,ORIGINAL_RUN)==before and material(ctx)==before_material
    assert native_history(service,ws)==before_native
    assert report['trace'], 'cold setup failed; see retained sanitized logs'
    assert not any(e['event']=='forbidden_io_or_rebuild' for e in report['trace']['events'])
    denied = any(e.get('reason')=='funding_scope_mismatch' for e in report['trace']['events'])
    save(root/'ASSESSMENT.json',dict(copied_funding_denial_observed=denied,immutable_history_preserved=True,
        prior_unknown_cost_resolution_preserved=True,native_history=before_native,
        request_bytes_exact=True,provider_io=0,scope='exact cold clone; never proof of original paid authority'))
    assert denied, 'clone did not reach funding guard on this visit; do not retry optimistically'
    print(json.dumps(dict(artifact=str(root),copied_funding_denial_observed=denied)))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clone',action='store_true',required=True)
    parser.add_argument('--implementation',action='store_true')
    args=parser.parse_args()
    os.umask(0o077)
    clone(REPO/'.local/batch3/b35c/timing-recovery/implementation-01' if args.implementation else OUT)
