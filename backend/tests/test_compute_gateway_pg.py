"""Real gVisor requests + restricted PostgreSQL. Missing service/PG is a failure."""
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from hashlib import sha256
import csv
import io
import json
import os
from pathlib import Path
import time
import pytest
from test_domain import context, cmd
from test_conversations import conversation
from test_workspace_file_gateway_pg import install, call
from workagent.workspace_file_models import CreateWorkspaceFile, WorkingText
from workagent.capabilities.models import InputRef
from workagent.capabilities.broker import CapabilityBroker
from workagent.capabilities.compute_adapters import ComputePython, input_refs
from workagent.db import Database
from workagent.service import Service
from workagent.errors import DomainError
from workagent.models import new_id
from compute_fixtures import READINGS, STATIONS, CALCULATE, SOURCE, TESTS, TEST_DRIVER


def prepare(context, sources, code):
    s,p,ws,_,_=context;cv=conversation(context);items=[]
    for name,raw in sources:
        source=WorkingText(kind='text',filename=name.replace('.py','.txt'),mime_type='text/csv' if name.endswith('.csv') else 'text/plain',
                           content=raw,sha256=sha256(raw.encode()).hexdigest())
        saved=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,expected_work_version=cv.work_version,source=source))
        items.append({'name':name,'ref':saved.current.model_dump()})
    request=ComputePython(kind='compute_python',code=code,inputs=items)
    refs=input_refs(request)
    cap,grant,q=install(context,cv,refs,['compute.python'])
    return cv,cap,grant,q,call(cap,q,'compute.python',request.model_dump(),refs)


def execute(context,sources,code):
    cv,cap,grant,q,request=prepare(context,sources,code)
    observation=CapabilityBroker(context[0],cap).call(request)
    assert observation.status=='observed', observation.model_dump()
    assert observation.output['result']['status']=='succeeded', observation.output
    return observation,(cv,cap,grant,q,request)


def test_calculation_independent_oracle_download_restart_and_replay(context):
    s,p,ws,_,_=context
    observation,(_,cap,_,q,request)=execute(context,[('readings.csv',READINGS),('stations.csv',STATIONS)],CALCULATE)
    result=observation.output['result']
    files={f['filename']:f for f in result['outputs']};assert set(files)=={'summary.csv','coverage.json'}
    restarted=Service(s.db)
    manifest,raw=restarted.download_export(p,ws,files['summary.csv']['export_id'])
    assert sha256(raw).hexdigest()==manifest.blob.sha256==files['summary.csv']['sandbox_sha256']
    rows=list(csv.DictReader(io.StringIO(raw.decode())))
    # Independent rational arithmetic, fixed local-date boundary oracle; no call
    # to the submitted Decimal/group/join implementation.
    expected=[('2026-10-27','North',Fraction(1500,1000)*Fraction(11,10)),
              ('2026-10-28','North',(Fraction(225,100)+Fraction(1,10))*Fraction(11,10)),
              ('2026-10-28','South',Fraction(500,1000)*Fraction(9,10))]
    assert [(r['local_day'],r['region'],Fraction(r['mass_kg'])) for r in rows]==expected
    assert rows[1]['notes']=='Human annotation alpha | Decimal precision'
    assert rows[2]['notes']=='Human annotation beta'
    coverage=json.loads(restarted.download_export(p,ws,files['coverage.json']['export_id'])[1])
    assert [o['sample'] for o in coverage['omissions']]==['r3','r5']
    assert observation.cost.cpu_ms>0 and len(observation.source_refs)==2 and len(observation.output_refs)==2
    assert CapabilityBroker(restarted,cap).call(request)==observation
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['n']==1
        entries=c.execute('SELECT kind,units,basis FROM tool_cost_entries WHERE attempt_id=%s ORDER BY kind',(observation.attempt_id,)).fetchall()
        assert {e['kind'] for e in entries}=={'reserved','settled'}
    evidence=os.environ.get('COMPUTE_EVIDENCE_DIR')
    if evidence:
        dest=Path(evidence);dest.mkdir(parents=True,exist_ok=True)
        (dest/'summary.csv').write_bytes(raw)
        (dest/'calculation-observation.json').write_text(observation.model_dump_json(indent=2))
        (dest/'download-target.json').write_text(json.dumps({'workspace_id':ws,'export_id':manifest.export_id,'sha256':manifest.blob.sha256}))


def test_supplied_source_and_tests_really_execute(context):
    obs,_=execute(context,[('transform.py',SOURCE),('test_transform.py',TESTS)],TEST_DRIVER)
    assert 'Ran 3 tests' in obs.output['result']['stderr']
    s,p,ws,_,_=context
    manifest,raw=s.download_export(p,ws,obs.output['result']['outputs'][0]['export_id'])
    assert json.loads(raw)=={'tests':3,'passed':True}
    assert manifest.blob.sha256==sha256(raw).hexdigest()


def test_no_inputs_and_safe_generated_csv(context):
    obs,_=execute(context,[],"open('/outputs/safe.csv','w').write('value\\n-12.50\\n=1+1\\n')")
    s,p,ws,_,_=context
    manifest,raw=s.download_export(p,ws,obs.output['result']['outputs'][0]['export_id'])
    assert b'-12.50\n' in raw and b"'=1+1\n" in raw
    assert manifest.sandbox_sha256!=manifest.blob.sha256
    assert any('escaped' in v for v in manifest.omissions)


def test_unavailable_never_host_fallback(context,monkeypatch):
    monkeypatch.setenv('WORKAGENT_COMPUTE_SOCKET','/nonexistent-workagent-compute.sock')
    cv,cap,grant,q,request=prepare(context,[],"raise Exception('must not execute in app')")
    obs=CapabilityBroker(context[0],cap).call(request)
    assert obs.status=='observed' and obs.output['result']['status']=='unavailable'
    assert obs.output['result']['outputs']==[]


def test_forged_and_cross_scope_refs_denied(context):
    s,p,ws,_,_=context
    _,cap,_,q,request=prepare(context,[('data.txt','private synthetic input')],'print(1)')
    for bad in [request.model_copy(update={'input_refs':[]}),
                request.model_copy(update={'arguments':{**request.arguments,'inputs':[{'name':'data.txt','ref':{**request.arguments['inputs'][0]['ref'],'sha256':'0'*64}}]}})]:
        with pytest.raises(DomainError): CapabilityBroker(s,cap).call(bad)
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()


@pytest.mark.parametrize('change',['revoke','cancel','lease'])
def test_real_running_job_loses_authority_no_late_publication(context,change):
    s,p,ws,_,admin=context
    _,cap,grant,q,request=prepare(context,[],"import time; time.sleep(5); open('/outputs/late.txt','w').write('late')")
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(CapabilityBroker(s,cap).call,request)
        deadline=time.monotonic()+8
        while True:
            with Database(admin).transaction() as c:
                started=c.execute("SELECT a.id FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='dispatch' WHERE a.run_id=%s",(q.run.id,)).fetchone()
            if started: break
            assert time.monotonic()<deadline
            time.sleep(.03)
        time.sleep(.4)  # Actual gVisor process has started; no adapter mock.
        if change=='revoke':
            with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(grant.id,))
        elif change=='lease':
            from test_runtime import expire
            expire(context,q.run.id)
            Service(s.db).claim_run(p,ws,q.run.id)
        else:
            from workagent.models import CancelConversation
            s.cancel_conversation(p,ws,q.conversation.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
        obs=future.result(timeout=10)
    assert obs.status=='cost_only' and obs.output is None and obs.output_refs==[]
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM artifact_exports WHERE workspace_id=%s',(ws,)).fetchone()
        assert c.execute("SELECT count(*) AS n FROM tool_cost_entries WHERE attempt_id=%s",(started['id'],)).fetchone()['n']==2
