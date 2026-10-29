"""Post-I/O publication races use the real service, never mocked result strings."""
from dataclasses import replace
import pytest
from test_domain import context
from test_compute_gateway_pg import prepare
from workagent.capabilities import registry
from workagent.capabilities.broker import CapabilityBroker
from workagent.db import Database
from workagent.errors import DomainError
from workagent.service import Service
from test_compute_http_pg import http_api


@pytest.mark.parametrize('race',['revoke','crash'])
def test_real_output_before_settlement_is_never_late_published(context,monkeypatch,race,http_api):
    s,p,ws,_,admin=context
    _,cap,grant,q,request=prepare(context,[('input.txt','synthetic immutable input')],"open('/outputs/result.txt','w').write(open('/inputs/input.txt').read())")
    adapters=registry.adapters(); original=adapters['compute.python']; saved=[]
    def after_actual_execution(*args):
        result=original.invoke_fenced(*args)
        assert result['result']['status']=='succeeded'
        saved.extend(result['result']['outputs'])
        if race=='crash': raise SystemExit('controlled app restart after real output before receipt')
        with Database(admin).transaction() as c:
            c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(grant.id,))
        return result
    adapters['compute.python']=replace(original,invoke_fenced=after_actual_execution)
    monkeypatch.setattr(registry,'adapters',lambda:adapters)
    if race=='crash':
        with pytest.raises(SystemExit): CapabilityBroker(s,cap).call(request)
    else:
        observation=CapabilityBroker(s,cap).call(request)
        assert observation.status=='cost_only' and observation.output is None and not observation.output_refs
        assert not observation.source_refs and not observation.input_refs  # SQL strips all refs after authority loss.
        assert observation.cost.cpu_ms>0
        from compute_fixtures import retain_evidence
        retain_evidence('post-io-revoke',{'observation':observation.model_dump(mode='json'),'unpublished_export':saved[0]})
    assert len(saved)==1
    restarted=Service(s.db)
    with pytest.raises(DomainError): restarted.download_export(p,ws,saved[0]['export_id'])
    import os
    response=http_api.get(f"/v1/workspaces/{ws}/exports/{saved[0]['export_id']}/download",
        headers={'Authorization':'Bearer '+os.environ['LOCAL_BEARER_TOKEN'],
                 'X-Request-Id':'late-compute-proof','X-Schema-Version':'workagent/v1'})
    assert response.status_code==404 and b'synthetic immutable input' not in response.content
    # Restore real adapter; an unresolved dispatched call never invokes it again.
    adapters['compute.python']=original
    with pytest.raises(DomainError): CapabilityBroker(restarted,cap).call(request)
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['n']==1
        assert c.execute('SELECT count(*) n FROM artifact_exports WHERE workspace_id=%s',(ws,)).fetchone()['n']==1
        costs=c.execute('SELECT kind FROM tool_cost_entries WHERE attempt_id=(SELECT id FROM tool_attempts WHERE run_id=%s)',(q.run.id,)).fetchall()
        assert {r['kind'] for r in costs}==({'reserved'} if race=='crash' else {'reserved','settled'})
    from compute_fixtures import retain_evidence
    retain_evidence('publication-'+race,{'http_denial':response.status_code,'attempts':1,
        'retained_unpublished_exports':1,'cost_kinds':sorted(r['kind'] for r in costs),
        'nonempty_input':True,'replay_denied':True})


def test_actual_service_death_retains_unknown_budget_no_resend(context):
    import os,time,subprocess,socket
    from pathlib import Path
    from concurrent.futures import ThreadPoolExecutor
    s,p,ws,_,_=context
    _,cap,grant,q,request=prepare(context,[('input.txt','synthetic')],"import time; time.sleep(60)")
    unit=os.environ['COMPUTE_SYSTEMD_UNIT'];assert unit.startswith('workagent-compute-b31a-')
    parent=Path('/sys/fs/cgroup/system.slice')/(unit+'.service')
    from compute_fixtures import restart_owned_service, retain_evidence
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(CapabilityBroker(s,cap).call,request)
            deadline=time.monotonic()+8
            while not list(parent.glob('wa-compute-*')):
                assert time.monotonic()<deadline;time.sleep(.05)
            time.sleep(.4)
            subprocess.run(['sudo','-n','systemctl','kill','--kill-whom=all','--signal=SIGKILL',unit],check=True)
            obs=future.result(timeout=10)
        assert obs.status=='outcome_unknown' and obs.output is None
        assert obs.cost.basis=='unknown' and obs.cost.observed_units is None
        assert CapabilityBroker(Service(s.db),cap).call(request) == obs  # Replay receipt, never code.
        with s.db.transaction() as c:
            entries=c.execute('SELECT kind,basis,units FROM tool_cost_entries WHERE attempt_id=%s',(obs.attempt_id,)).fetchall()
            assert {r['kind'] for r in entries}=={'reserved','settled'}
            assert next(r['basis'] for r in entries if r['kind']=='settled')=='unknown'
            assert c.execute("SELECT count(*) n FROM tool_attempt_events WHERE attempt_id=%s AND kind='dispatch'",(obs.attempt_id,)).fetchone()['n']==1
            assert not c.execute('SELECT 1 FROM artifact_exports WHERE workspace_id=%s',(ws,)).fetchone()
        retain_evidence('lost-receipt',{'observation':obs.model_dump(mode='json'),'cost_entries':entries,'dispatch_count':1,'replay_equal':True})
    finally:
        restart_owned_service()
