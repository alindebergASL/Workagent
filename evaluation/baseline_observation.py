"""One owned B0 observation visit using the exact retained arm import tree.

Not a bridge call or ingress. Credential exists only in stdin/memory; all product
I/O remains in the unchanged baseline worker and its original durable directory.
"""
import json
import os
from pathlib import Path
import sqlite3
import sys
from unittest.mock import patch
from network_harness import REPO as ROOT,inventory
from study_controller import Hold,canonical,digest
from study_execution import run_owned,application_seconds


def require(ok,code):
    if not ok:raise Hold('baseline_observation:'+code)


def paths(slot,visit):
    from install_recipient_funding import OUT
    slot=Path(slot);visit=Path(visit)
    require(slot.parent==OUT/'campaign' and len(slot.name)==24 and all(c in '0123456789abcdef' for c in slot.name),'slot')
    require(slot==slot.resolve() and slot.is_dir(),'real_slot')
    require(visit.parent.parent==slot and visit.parent.name.startswith('observation-') and visit.name.startswith('visit-'),'visit')
    require(visit==visit.resolve() and visit.is_dir(),'real_visit')
    durable=slot/'worker-state';source=slot/'baseline'
    require(durable==durable.resolve() and durable.is_dir() and not durable.is_symlink(),'durable_state')
    require(source==source.resolve() and source.is_dir() and not source.is_symlink(),'baseline_tree')
    require(not any(p.is_symlink() or p.suffix=='.pyc' for p in source.rglob('*')),'baseline_symlink_or_bytecode')
    require((visit/'connection.json').is_symlink() and (visit/'connection.json').resolve()==slot/'connection.json','connection')
    return source,durable


def arm_source(slot,state):
    from study_binding import SOURCE_HASHES
    source=Path(slot)/'baseline';retained=ROOT/'.local/batch3/b35b/baseline/workagent'
    expected=inventory(retained);actual=inventory(source/'workagent')
    require(len(expected)==103 and actual==expected and digest(canonical(actual))==SOURCE_HASHES['B0'],'exact103_baseline')
    require(state['variant']=='B0' and state['source_manifest_sha256']==SOURCE_HASHES['B0'],'arm')
    # Baseline consumers resolve their sibling runtime files, as in ProductAdapter.call.
    for name in ('general-responses-v1.json','general-b1-v1.json','bundles.py','__init__.py'):
        p=Path(slot)/'runtime'/name
        require(not p.is_symlink() and p.is_file() and p.read_bytes()==(ROOT/'runtime'/name).read_bytes(),'runtime_dependency')
    return actual


def loaded_source(source,expected):
    import workagent
    require(Path(workagent.__file__).resolve()==source/'workagent/__init__.py','import_root')
    for name,module in tuple(sys.modules.items()):
        if name=='workagent' or name.startswith('workagent.'):
            filename=getattr(module,'__file__',None)
            if filename is None:continue
            p=Path(filename).resolve()
            require(p.is_relative_to(source/'workagent'),'foreign_loaded_module')
            relative=str(p.relative_to(source/'workagent'))
            require(relative in expected and digest(p.read_bytes())==expected[relative],'loaded_module_hash')


RECOVERY_POLICY='known-initial-provider-identity-v1'
ANCHOR_KINDS=('count_send','count_result','dispatch','identity')


def validate_anchor(anchor,state):
    """Positive eligibility from actual immutable DB rows, not a caller receipt."""
    require(set(anchor)=={'run_id','attempts','steps','events'} and len(anchor['attempts'])==len(anchor['steps'])==1,'anchor_shape')
    attempt=anchor['attempts'][0];step=anchor['steps'][0]
    events={e['kind']:e for e in anchor['events']}
    require(len(anchor['events'])==4 and set(events)==set(ANCHOR_KINDS),'anchor_events')
    require(anchor['run_id']==state['current_run'] and attempt['run_id']==state['current_run']
        and attempt['workspace_id']==state['workspace'] and attempt['grant_id']==state['active_grant']['id']
        and step['grant_id']==attempt['grant_id'] and step['attempt_id']==attempt['id'] and step['phase']=='selection','anchor_context')
    request=json.loads(step['request_bytes']);count=json.loads(step['count_bytes'])
    require(step['metadata']['attempt_id']==attempt['id'] and step['metadata']['step_id']=='selection'
        and request['metadata']==step['metadata'],'anchor_metadata')
    require(digest(step['request_bytes'])==step['request_sha256'] and digest(step['count_bytes'])==step['count_sha256'],'anchor_bytes')
    from workagent.responses_transport import COUNT_FIELDS
    require(canonical(count)==canonical({k:v for k,v in request.items() if k in COUNT_FIELDS}),'anchor_count_projection')
    for event in events.values():
        require(event['attempt_id']==attempt['id'] and event['phase']=='selection','anchor_event_binding')
    require(len({e['id'] for e in events.values()})==4,'anchor_event_ids')
    for kind in ('count_result','identity'):
        data=events[kind]['data']
        require(data['metadata']==step['metadata'] and data['request_sha256']==step['request_sha256']
            and data['provenance']['mode']==state['mode'],'anchor_request_binding')
    require(events['count_result']['data']['count_sha256']==step['count_sha256'],'anchor_count_binding')
    identity=events['identity']['data']['response_id']
    require(isinstance(identity,str) and bool(identity) and not any(c.isspace() for c in identity),'anchor_response')
    return dict(anchor,events=sorted(anchor['events'],key=lambda e:e['kind']))


def read_recovery_anchor(service,state):
    with service.db.transaction() as c:
        c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        attempts=c.execute('SELECT id,run_id,workspace_id,grant_id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s ORDER BY id',
            (state['workspace'],state['current_run'])).fetchall()
        require(len(attempts)==1,'anchor_attempt_count');attempt=attempts[0]
        steps=c.execute('SELECT attempt_id,phase,grant_id,request_bytes,request_sha256,count_bytes,count_sha256,metadata FROM responses_steps WHERE attempt_id=%s AND phase=%s',
            (attempt['id'],'selection')).fetchall()
        events=c.execute('SELECT id,attempt_id,phase,kind,data FROM responses_events WHERE attempt_id=%s AND phase=%s AND kind=ANY(%s) ORDER BY kind',
            (attempt['id'],'selection',list(ANCHOR_KINDS))).fetchall()
        grant=c.execute('SELECT data,active FROM provider_grants WHERE id=%s AND workspace_id=%s',
            (state['active_grant']['id'],state['workspace'])).fetchone()
        require(grant is not None and grant['active'] and canonical(grant['data'])==canonical(state['active_grant'])
            and grant['data']['principal_id']==state['principal'],'anchor_current_grant')
    return validate_anchor(dict(run_id=state['current_run'],attempts=attempts,steps=steps,events=events),state)


def check_credential(state,credential):
    """Authenticate stdin against the existing DB-validated private reference."""
    import hmac,stat
    reference=state['active_grant']['responses']['secret_reference']
    require(isinstance(reference,str) and reference.startswith('file:'),'credential_reference')
    path=Path(reference[5:]);require(path.is_absolute() and path.resolve()==path,'credential_path')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        info=os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and info.st_mode & 0o077==0,'credential_permissions')
        expected=stream.read().strip()
    require(hmac.compare_digest(expected,credential.encode()),'credential_mismatch')


def retain_anchor(directory,anchor,context):
    """Evidence only. Every invocation has independently proved current DB eligibility."""
    import stat
    document=dict(policy=RECOVERY_POLICY,context=context,initial=anchor)
    raw=(canonical(document)+'\n').encode();path=directory/'initial-provider-anchor.json'
    require(directory.is_dir() and directory.resolve()==directory and not path.is_symlink(),'anchor_evidence_path')
    try:fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    except FileExistsError:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as stream:
            info=os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and info.st_mode & 0o077==0,'anchor_evidence_mode')
            require(stream.read()==raw,'anchor_evidence_changed')
    else:
        with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        fd=os.open(directory,os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    return digest(raw)


def child_visit(message):
    from study_transport import require_live_release
    from study_binding import environment,validate_environment
    from study_source_amendment import load
    from observe_live_study import select_pending,pending_safety,durable_jail
    import study_application as A
    require_live_release();manifest=load();require(manifest is not None,'approved_source')
    for filename in ('baseline_observation.py','observe_live_study.py'):
        relative='evaluation/'+filename
        require(manifest['files'].get(relative)==digest((ROOT/relative).read_bytes()),'observer_binding')
    require(set(message)=={'slot','visit','application_sha256','execute_key','credential'},'input_shape')
    slot,visit=Path(message['slot']),Path(message['visit']);source,durable=paths(slot,visit)
    raw=(slot/'application.json').read_bytes();state=json.loads(raw)
    require(digest(raw)==message['application_sha256'] and state['mode']=='official_api' and state['blind_id']==slot.name,'application')
    expected=arm_source(slot,state);loaded_source(source,expected)
    current=environment();require(state['environment']==current,'environment');validate_environment(current)
    with sqlite3.connect('file:'+str(slot.parent/'bridge.sqlite')+'?mode=ro',uri=True) as b, sqlite3.connect('file:'+str(slot.parent/'controller.sqlite')+'?mode=ro',uri=True) as c:
        b.row_factory=c.row_factory=sqlite3.Row
        old,payload=select_pending(b,c,slot.name)
    require(old['key']==message['execute_key'] and payload['trajectory']['variant']=='B0'
        and payload['admitted']['run_id']==state['current_run'] and payload['episode']==state['episode'],'existing_execute')
    credential=message.pop('credential')
    require(isinstance(credential,str) and bool(credential) and not any(c.isspace() for c in credential),'credential')
    service,_,_=A.context(slot,state);loaded_source(source,expected)
    require(manifest.get('evaluator_transition',{}).get('recovery_policy')==RECOVERY_POLICY,'approved_recovery_policy')
    anchor=read_recovery_anchor(service,state)
    check_credential(state,credential)
    pending_safety(service,state)
    retain_anchor(visit.parent,anchor,dict(application_sha256=digest(raw),execute_key=old['key'],
        payload_sha256=digest(old['payload']),arm=state['variant'],source_sha256=state['source_manifest_sha256']))
    state['_credential']=credential
    try:
        with patch.object(A,'jail',lambda inputs,placeholder,product:durable_jail(inputs,placeholder,product,
                expected=visit/'worker-state',durable=durable)):
            result=A.execute(visit,state,payload)
    except Hold as exc:
        if str(exc)!='installed_run_pending_observation:'+state['current_run']:raise
        result=dict(status='pending',run_id=state['current_run'])
    finally:state.pop('_credential',None)
    loaded_source(source,expected)
    require((slot/'application.json').read_bytes()==raw,'application_changed')
    require(result['run_id']==state['current_run'] and result['status'] in ('pending','ready','partial'),'visit_result')
    return dict(status=result['status'],run_id=state['current_run'])


def visit(slot,visit,state,execute_key,credential):
    source,_=paths(slot,visit);arm_source(slot,state)
    env={'PATH':os.environ['PATH'],'HOME':os.environ['HOME'],'PYTHONPATH':str(source)+':'+str(ROOT/'evaluation')+':'+str(ROOT),
        'PYTHONDONTWRITEBYTECODE':'1'}
    message=dict(slot=str(slot),visit=str(visit),application_sha256=digest((slot/'application.json').read_bytes()),
        execute_key=execute_key,credential=credential)
    process=run_owned([str(ROOT/'backend/.venv/bin/python'),'-B','-u',str(ROOT/'evaluation/baseline_observation.py')],
        input=canonical(message),cwd=ROOT,env=env,timeout=application_seconds('official_api','execute'),evidence=visit/'baseline-observer')
    require(process.returncode==0,'visit_unknown')
    try:result=json.loads(process.stdout)
    except (ValueError,UnicodeError):raise Hold('baseline_observation:invalid_receipt_unknown') from None
    require(set(result)=={'status','run_id'} and result['status'] in ('pending','ready','partial')
        and result['run_id']==state['current_run'],'receipt_identity')
    return result


def main():
    os.umask(0o077)
    try:
        result=child_visit(json.load(sys.stdin))
    except BaseException:
        # Never render exception payloads, input, DSNs, or the credential.
        print('baseline_observation:child_failed_unknown',file=sys.stderr,flush=True)
        raise SystemExit(1) from None
    print(canonical(result),flush=True)

if __name__=='__main__':main()
