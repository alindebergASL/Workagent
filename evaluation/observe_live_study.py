"""Resume one acknowledged live execute receipt, never repeat ingress/unknown send.

Uses the unchanged isolated application worker and its original durable request
state. Fresh output directories preserve the failed visit. No lease SQL surgery,
new grant, certificate, study store, or replacement run. Terminal bridge receipt
is filled only from exact existing run readback after ordinary worker continuation.
"""
import argparse
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import sqlite3
import sys
import time
import uuid
from unittest.mock import patch
from network_harness import jail as reviewed_jail

from install_recipient_funding import mapping, install_gate, OUT
from study_controller import canonical, digest, Hold
from study_diagnostic import ProductAdapter
from study_transport import require_live_release
import study_application as A


def select_pending(bridge, controller, trial):
    rows=controller.execute("SELECT * FROM operations WHERE trial=? AND operation='execute' AND state IN ('sending','unknown')",(trial,)).fetchall()
    if len(rows)!=1:raise Hold('unique_pending_controller_execute_required')
    operation=rows[0]
    old=bridge.execute("SELECT key,payload,state,result FROM receipts WHERE key=?",(operation['key'],)).fetchone()
    if not old or old['state']!='sending' or old['result'] is not None or old['payload']!=operation['payload']:
        raise Hold('exact_pending_bridge_required')
    payload=json.loads(old['payload'])
    assert payload['trajectory']['id']==trial and payload['episode']==operation['episode']
    assert old['key']==digest(canonical([trial,operation['episode'],'execute',digest(old['payload'])]))
    return dict(old),payload


def durable_jail(inputs, placeholder, product, *, expected, durable):
    assert placeholder==expected and placeholder.is_dir() and not placeholder.is_symlink()
    assert durable.is_dir() and not durable.is_symlink() and durable==durable.resolve()
    return reviewed_jail(inputs,durable,product)


def pending_safety(service,state):
    """Unknown external I/O is never an invitation to repeat it."""
    with service.db.transaction() as c:
        rows=c.execute('''SELECT e.phase,e.kind,e.data FROM responses_events e
          JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s''',(state['current_run'],)).fetchall()
    phases={}
    for row in rows:phases.setdefault(row['phase'],{}).setdefault(row['kind'],[]).append(row['data'])
    for phase,events in phases.items():
        if 'count_send' in events and 'count_result' not in events:
            raise Hold('unknown_count_requires_reconciliation:'+phase)
        if 'dispatch' in events and 'result' not in events:
            if len(events.get('identity',[]))!=1 or not events['identity'][0].get('response_id'):
                raise Hold('unknown_create_requires_reconciliation:'+phase)
    return {phase:{kind:len(values) for kind,values in events.items()} for phase,events in phases.items()}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trajectory',required=True)
    parser.add_argument('--credential-file',type=Path,required=True)
    args=parser.parse_args()
    require_live_release()
    plans,bindings=mapping();binding=bindings[args.trajectory]
    assert args.credential_file.stat().st_mode & 0o077 == 0
    assert 'file:'+str(args.credential_file.resolve())==binding['grant']['responses']['secret_reference']
    credential=args.credential_file.read_text().strip()
    assert credential and not any(c.isspace() for c in credential)
    root=OUT/'campaign';slot=root/args.trajectory
    with (root/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        # Cold adapter validates immutable application/environment/source/mapping.
        adapter=ProductAdapter(root,None,live_bindings=bindings,credential=credential)
        try:
            controller=sqlite3.connect('file:'+str(root/'controller.sqlite')+'?mode=ro',uri=True)
            controller.row_factory=sqlite3.Row
            try:old,payload=select_pending(adapter.db,controller,args.trajectory)
            finally:controller.close()
            state=json.loads((slot/'application.json').read_text())
            assert state['mode']=='official_api' and state['blind_id']==args.trajectory
            assert state['variant'] in ('B1','M1'), 'baseline_host_import_recovery_unreviewed'
            assert state['current_run']==payload['admitted']['run_id'] and state['episode']==payload['episode']
            assert state['environment']==adapter.environment
            install_gate(plans[args.trajectory],binding)
            service,principal,_=A.context(slot,state)
            initial=pending_safety(service,state)
            directory=slot/('observation-'+uuid.uuid4().hex);directory.mkdir(mode=0o700)
            # Saved phase secrets and response IDs stay in the ORIGINAL state dir.
            (directory/'connection.json').symlink_to((slot/'connection.json').resolve())
            durable=(slot/'worker-state').resolve()
            assert not (slot/'worker-state').is_symlink() and durable.is_dir()
            before=(slot/'application.json').read_bytes()
            (directory/'application-before.json').write_bytes(before)
            (directory/'bridge-before.json').write_text(canonical(old)+'\n')
            visited=[]
            for p in sorted(slot.rglob('worker-*.stdout')):
                if p.parent.name != 'episode-'+str(state['episode']):
                    continue
                # Prior interrupted observer visits remain in the effort evidence.
                visited.append(json.loads(p.read_text()))
            deadline=time.monotonic()+1100
            attempts=0
            while True:
                pending_safety(service,state)
                run=service.get_run(principal,state['workspace'],state['current_run'])
                if run.state in ('ready','partial'):
                    value=dict(status=run.state,run_id=run.id,visits=visited,unresolved=run.unresolved)
                    break
                assert run.state in ('queued','running','waiting'), 'non_resumable_run_state'
                if time.monotonic()>=deadline:raise Hold('observation_visit_deadline; exact receipt preserved')
                # Let existing lease expire naturally; never mutate its timestamp.
                expiry=getattr(run,'lease_expires_at',None)
                if expiry:
                    seconds=(expiry-datetime.now(timezone.utc)).total_seconds()
                    if seconds>0:time.sleep(min(seconds+0.1,35))
                visit=directory/('visit-'+str(attempts));visit.mkdir()
                (visit/'connection.json').symlink_to((slot/'connection.json').resolve())
                attempts+=1
                state['_credential']=credential
                try:
                    # A real placeholder is created by unchanged A.execute; only
                    # the explicit, validated state argument is routed to the
                    # ORIGINAL real durable directory by the unchanged jail.
                    with patch.object(A,'jail',lambda inputs,placeholder,product:durable_jail(
                        inputs,placeholder,product,expected=visit/'worker-state',durable=durable)):
                        result=A.execute(visit,state,payload)
                except Hold as exc:
                    if str(exc)!='installed_run_pending_observation:'+state['current_run']:raise
                finally:
                    state.pop('_credential',None)
                    for p in sorted((visit/('episode-'+str(state['episode']))).glob('worker-*.stdout')):
                        visited.append(json.loads(p.read_text()))
                # Next iteration checks receipts before any further worker visit.
            state['visits']=visited
            # Do not overwrite a concurrent update or accept substituted identity.
            assert (slot/'application.json').read_bytes()==before
            temporary=directory/'application-after.json';temporary.write_text(canonical(state)+'\n')
            import os
            new=slot/'application.recovered';new.write_bytes(temporary.read_bytes());os.replace(new,slot/'application.json')
            result={'key':old['key'],'state':'complete','payload_sha256':digest(old['payload']),'value':value}
            with adapter.db:
                changed=adapter.db.execute("UPDATE receipts SET state='complete',result=? WHERE key=? AND payload=? AND state='sending' AND result IS NULL",(canonical(result),old['key'],old['payload'])).rowcount
                assert changed==1,'bridge_changed_during_observation'
            assert json.loads(adapter.db.execute('SELECT result FROM receipts WHERE key=?',(old['key'],)).fetchone()['result'])==result
            record=dict(status='observed_terminal_existing_run',run_id=state['current_run'],episode=state['episode'],
              initial_phases=initial,final_phases=pending_safety(service,state),visits=len(visited),attempts=attempts,
              result=result,evidence=str(directory.relative_to(OUT)),new_ingress=0,new_grants=0,new_certificates=0)
            (directory/'OBSERVED.json').write_text(canonical(record)+'\n')
            print(canonical({k:v for k,v in record.items() if k!='result'}))
        finally:adapter.close()

if __name__=='__main__':main()
