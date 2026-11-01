"""Offline63 isolation and publication checks. No PG/provider or original writes."""
from copy import deepcopy
import json,os,subprocess,sys
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch
import pytest
import baseline_observation as O
import amend_baseline_observer as S
from study_controller import Hold

ROOT=O.ROOT
HERE=ROOT/'.local/batch3/b35c/retained-read-recovery/implementation-65'
SLOT=ROOT/'.local/batch3/b35c/live-study/campaign/463c609152d7e50e36e7277b'

def code():return dict(files={n:S.digest((ROOT/n).read_bytes()) for n in S.CHANGED|S.ADDED})

def test_exact_source_only_composition():
    old=json.loads((HERE/'predecessor/activation64.CANDIDATE.json').read_text());before=deepcopy(old)
    m=S.compose(ROOT,HERE/'not-published',old,code())
    assert old==before
    for key in old.keys()-{'files','binding_name','bindings','evaluator_transition'}:assert m[key]==old[key],key
    assert m['migration_inventory']==old['migration_inventory'] and len(m['migration_inventory'])==86
    assert m['binding_name']!=old['binding_name']

@pytest.mark.parametrize('damage',['extra','missing','wronghash'])
def test_code_inventory_denial(damage):
    old=json.loads((HERE/'predecessor/activation64.CANDIDATE.json').read_text());c=code()
    if damage=='extra':c['files']['evaluation/study_application.py']=S.digest((ROOT/'evaluation/study_application.py').read_bytes())
    elif damage=='missing':c['files'].pop('evaluation/baseline_observation.py')
    else:c['files']['evaluation/baseline_observation.py']='0'*64
    with pytest.raises((AssertionError,RuntimeError)):S.compose(ROOT,HERE/'not-published',old,c)


def test_real_cold_baseline_imports_no_connections():
    # Actual selected-arm interpreter, same path layout as ProductAdapter.call.
    program='''import json,socket,psycopg
from unittest.mock import patch
from pathlib import Path
import baseline_observation as O

def forbidden(*a,**kw):raise AssertionError('connection forbidden')
with patch.object(psycopg,'connect',forbidden),patch.object(socket.socket,'connect',forbidden):
 import workagent.service,workagent.general_worker,workagent.general_responses
 slot=Path(SLOT)
 state=json.loads((slot/'application.json').read_text())
 expected=O.arm_source(slot,state)
 O.loaded_source(slot/'baseline',expected)
 print(json.dumps(dict(files=len(expected),source=O.digest(O.canonical(expected)),connections=0)))
'''.replace('Path(SLOT)','Path('+repr(str(SLOT))+')')
    env={'PATH':os.environ['PATH'],'HOME':os.environ['HOME'],'PYTHONDONTWRITEBYTECODE':'1',
        'PYTHONPATH':str(SLOT/'baseline')+':'+str(ROOT/'evaluation')+':'+str(ROOT)}
    p=subprocess.run([str(ROOT/'backend/.venv/bin/python'),'-B','-c',program],env=env,cwd=ROOT,text=True,capture_output=True,timeout=60)
    assert p.returncode==0,p.stderr
    result=json.loads(p.stdout);assert result['files']==103 and result['connections']==0


def test_wrong_arm_and_import_root_denied():
    state=json.loads((SLOT/'application.json').read_text());state['variant']='B1'
    with pytest.raises(Hold,match=':arm'):O.arm_source(SLOT,state)
    import workagent
    with pytest.raises(Hold,match='import_root'):O.loaded_source(SLOT/'baseline',{})


def test_invalid_durable_and_visit_paths(tmp_path,monkeypatch):
    import install_recipient_funding as F
    monkeypatch.setattr(F,'OUT',tmp_path)
    slot=tmp_path/'campaign'/('a'*24);slot.mkdir(parents=True)
    visit=slot/'observation-test'/'visit-0';visit.mkdir(parents=True)
    (slot/'baseline').mkdir();(slot/'connection.json').write_text('{}')
    (visit/'connection.json').symlink_to(slot/'connection.json')
    real=tmp_path/'real';real.mkdir();(slot/'worker-state').symlink_to(real)
    with pytest.raises(Hold,match='durable_state'):O.paths(slot,visit)
    (slot/'worker-state').unlink();(slot/'worker-state').mkdir()
    assert O.paths(slot,visit)==(slot/'baseline',slot/'worker-state')
    with pytest.raises(Hold,match='visit'):O.paths(slot,tmp_path)


def test_owned_visit_stdin_only_and_exact_identity(tmp_path,monkeypatch):
    state=dict(current_run='run');(tmp_path/'application.json').write_text('{}')
    monkeypatch.setattr(O,'paths',lambda *a:(tmp_path/'baseline',tmp_path/'state'))
    monkeypatch.setattr(O,'arm_source',lambda *a:{})
    calls=[]
    def owned(argv,**kw):
        calls.append((argv,kw));assert 'secret-canary' not in repr((argv,kw['env']))
        assert json.loads(kw['input'])['credential']=='secret-canary'
        assert kw['env']['PYTHONPATH'].split(':')[0]==str(tmp_path/'baseline')
        return NS(returncode=0,stdout=json.dumps(dict(status='pending',run_id='run')))
    monkeypatch.setattr(O,'run_owned',owned)
    assert O.visit(tmp_path,tmp_path/'visit',state,'same-key','secret-canary')['status']=='pending'
    assert len(calls)==1 and json.loads(calls[0][1]['input'])['execute_key']=='same-key'
    monkeypatch.setattr(O,'run_owned',lambda *a,**kw:NS(returncode=0,stdout='{"status":"pending","run_id":"other"}'))
    with pytest.raises(Hold,match='receipt_identity'):O.visit(tmp_path,tmp_path/'visit',state,'same-key','secret-canary')


def test_child_error_redaction(monkeypatch,capsys):
    from io import StringIO
    monkeypatch.setattr(sys,'stdin',StringIO('{"credential":"secret-canary"}'))
    monkeypatch.setattr(O,'child_visit',lambda *a:(_ for _ in ()).throw(ValueError('secret-canary private material')))
    with pytest.raises(SystemExit) as e:O.main()
    assert e.value.code==1
    out=capsys.readouterr();assert out.out=='' and out.err=='baseline_observation:child_failed_unknown\n'


def test_observer_routes_only_b0_and_binds_both_helpers():
    import ast
    source=(ROOT/'evaluation/observe_live_study.py').read_text();tree=ast.parse(source)
    branch=next(n for n in ast.walk(tree) if isinstance(n,ast.If) and ast.unparse(n.test)=="state['variant'] == 'B0'")
    assert 'baseline_visit' in ast.unparse(branch.body) and 'A.execute' not in ast.unparse(branch.body)
    assert 'A.execute(visit, state, payload)' in ast.unparse(branch.orelse)
    controller=(ROOT/'evaluation/study_controller.py').read_text()
    assert "'observe_live_study.py','baseline_observation.py'" in controller
    assert 'ProductAdapter.call' not in (ROOT/'evaluation/baseline_observation.py').read_text().split('def child_visit',1)[1]

def synthetic_anchor(tmp_path,suffix='one'):
    from workagent.responses_transport import COUNT_FIELDS
    credential=tmp_path/('credential-'+suffix);credential.write_text('secret-canary');credential.chmod(0o600)
    grant=dict(id='grant-'+suffix,principal_id='principal-'+suffix,workspace_id='workspace-'+suffix,
        responses=dict(secret_reference='file:'+str(credential)))
    attempt=dict(id='attempt-'+suffix,run_id='run-'+suffix,workspace_id=grant['workspace_id'],grant_id=grant['id'])
    meta=dict(attempt_id=attempt['id'],request_id='request-'+suffix,step_id='selection')
    request=dict(model='gpt-6.1-sol',instructions='Synthetic unit input',input=[dict(role='user',content='Synthetic')],metadata=meta,tools=[])
    raw=O.canonical(request);count=O.canonical({k:v for k,v in request.items() if k in COUNT_FIELDS})
    step=dict(attempt_id=attempt['id'],phase='selection',grant_id=grant['id'],metadata=meta,
        request_bytes=raw,request_sha256=O.digest(raw),count_bytes=count,count_sha256=O.digest(count))
    identity=dict(metadata=meta,request_sha256=step['request_sha256'],provenance=dict(mode='official_api',origin='unit'))
    data={'count_send':dict(input_token_limit=50000),'count_result':dict(identity,count_sha256=step['count_sha256'],input_tokens=10),
        'dispatch':dict(reserved_input_tokens=50000,reserved_output_tokens=8192),'identity':dict(identity,response_id='resp_unit_'+suffix)}
    events=[dict(id='event-'+suffix+'-'+k,attempt_id=attempt['id'],phase='selection',kind=k,data=v) for k,v in data.items()]
    anchor=dict(run_id=attempt['run_id'],attempts=[attempt],steps=[step],events=events)
    state=dict(mode='official_api',variant='B0',current_run=attempt['run_id'],workspace=grant['workspace_id'],principal=grant['principal_id'],
        active_grant=grant,source_manifest_sha256='unit-baseline',episode=1,environment={})
    return anchor,state


@pytest.mark.parametrize('damage',[None,'new_run','settled','restart','empty','count_only','no_identity','missing_step','request','count','metadata',
    'identity','event_data','cross_run','other_attempt','manifest','host_anchor','symlink','credential','revoked','late_unknown'])
def test_actual_child_generic_known_identity_before_execute(tmp_path,monkeypatch,damage):
    import sqlite3
    from contextlib import contextmanager
    import study_application as A,study_source_amendment as AM,study_binding as SB,study_transport as ST
    anchor,state=synthetic_anchor(tmp_path,'another' if damage=='new_run' else 'one');rows=deepcopy(anchor);run=anchor['run_id']
    slot=tmp_path/'campaign'/('a'*24);slot.mkdir(parents=True)
    visit=slot/'observation-test'/'visit-0';visit.mkdir(parents=True)
    state['blind_id']=slot.name
    raw=O.canonical(state).encode();(slot/'application.json').write_bytes(raw)
    payload=O.canonical(dict(trajectory=dict(id=slot.name,variant='B0'),episode=1,admitted=dict(run_id=run)))
    key=O.digest(O.canonical([slot.name,1,'execute',O.digest(payload)]))
    with sqlite3.connect(slot.parent/'bridge.sqlite') as b,sqlite3.connect(slot.parent/'controller.sqlite') as c:
        b.execute('CREATE TABLE receipts(key,payload,state,result)');b.execute('INSERT INTO receipts VALUES (?,?,?,NULL)',(key,payload,'sending'))
        c.execute('CREATE TABLE operations(key,trial,episode,operation,payload,state,result)')
        c.execute('INSERT INTO operations VALUES (?,?,?,?,?,?,NULL)',(key,slot.name,1,'execute',payload,'unknown'))
    manifest=dict(files={n:O.digest((ROOT/n).read_bytes()) for n in ('evaluation/baseline_observation.py','evaluation/observe_live_study.py')},
        evaluator_transition=dict(recovery_policy=O.RECOVERY_POLICY))
    context=dict(application_sha256=O.digest(raw),execute_key=key,payload_sha256=O.digest(payload),arm='B0',source_sha256=state['source_manifest_sha256'])
    if damage in ('identity','event_data','restart'):
        O.retain_anchor(visit.parent,O.validate_anchor(deepcopy(anchor),state),context)
    if damage=='empty':rows['events']=[]
    elif damage=='count_only':rows['events']=[e for e in rows['events'] if e['kind'].startswith('count_')]
    elif damage=='no_identity':rows['events']=[e for e in rows['events'] if e['kind']!='identity']
    elif damage=='missing_step':rows['steps']=[]
    elif damage in ('request','count'):rows['steps'][0][damage+'_bytes']+=' '
    elif damage=='metadata':rows['steps'][0]['metadata']['request_id']='other'
    elif damage=='identity':next(e for e in rows['events'] if e['kind']=='identity')['data']['response_id']='resp_changed'
    elif damage=='event_data':next(e for e in rows['events'] if e['kind']=='dispatch')['data']['reserved_output_tokens']=4096
    elif damage=='cross_run':rows['attempts'][0]['run_id']='other'
    elif damage=='other_attempt':rows['attempts'].append(dict(rows['attempts'][0],id='other'))
    elif damage=='manifest':manifest['evaluator_transition']['recovery_policy']='arbitrary'
    elif damage=='host_anchor':(visit.parent/'initial-provider-anchor.json').write_text('{"host_says_safe":true}')
    elif damage=='symlink':(visit.parent/'initial-provider-anchor.json').symlink_to(slot/'application.json')
    elif damage=='settled':
        rows['events'].extend([dict(phase='selection',kind='result',data={'state':'function_call'}),
            dict(phase='selection_2',kind='count_send',data={}),dict(phase='selection_2',kind='count_result',data={})])
    elif damage=='late_unknown':rows['events'].append(dict(phase='selection_2',kind='dispatch',data={}))
    class DB:
        @contextmanager
        def transaction(self):yield self
        def execute(self,sql,args=None):
            if sql.startswith('SET TRANSACTION'):self.result=[]
            elif sql.startswith('SELECT id,run_id,workspace_id'):self.result=rows['attempts']
            elif sql.startswith('SELECT attempt_id,phase,grant_id'):self.result=rows['steps']
            elif sql.startswith('SELECT id,attempt_id,phase,kind,data'):
                self.result=sorted([e for e in rows['events'] if e['phase']=='selection' and e['kind'] in O.ANCHOR_KINDS],key=lambda e:e['kind'])
            elif sql.startswith('SELECT data,active'):self.result=[dict(data=state['active_grant'],active=damage!='revoked')]
            elif 'SELECT e.phase,e.kind,e.data' in sql:self.result=rows['events']
            else:raise AssertionError('unexpected query')
            return self
        def fetchall(self):return deepcopy(self.result)
        def fetchone(self):return deepcopy(self.result[0])
    monkeypatch.setattr(ST,'require_live_release',lambda:None);monkeypatch.setattr(AM,'load',lambda:manifest)
    monkeypatch.setattr(O,'paths',lambda *a:(slot/'baseline',slot/'worker-state'))
    monkeypatch.setattr(O,'arm_source',lambda *a:{});monkeypatch.setattr(O,'loaded_source',lambda *a:None)
    monkeypatch.setattr(SB,'environment',lambda:{});monkeypatch.setattr(SB,'validate_environment',lambda *a:None)
    monkeypatch.setattr(A,'context',lambda *a:(NS(db=DB()),None,None))
    called=[]
    def execute(directory,current,actual):
        called.append(actual);assert current['_credential']=='secret-canary' and actual==json.loads(payload)
        raise Hold('installed_run_pending_observation:'+run)
    monkeypatch.setattr(A,'execute',execute)
    message=dict(slot=str(slot),visit=str(visit),application_sha256=O.digest(raw),execute_key=key,
        credential='substituted' if damage=='credential' else 'secret-canary')
    if damage not in (None,'new_run','settled','restart'):
        with pytest.raises(Hold):O.child_visit(message)
        assert called==[]
    else:
        assert O.child_visit(deepcopy(message))==dict(status='pending',run_id=run)
        captured=(visit.parent/'initial-provider-anchor.json').read_bytes()
        assert b'secret-canary' not in captured and b'credential-' not in captured
        if damage=='restart':
            assert O.child_visit(deepcopy(message))==dict(status='pending',run_id=run)
            assert (visit.parent/'initial-provider-anchor.json').read_bytes()==captured
        assert len(called)==(2 if damage=='restart' else 1)
    assert (slot/'application.json').read_bytes()==raw
    with sqlite3.connect(slot.parent/'bridge.sqlite') as b:
        assert b.execute('SELECT state,result FROM receipts').fetchall()==[('sending',None)]


@pytest.mark.parametrize('interrupt',[False,True])
def test_source_publication_preserves_pending_rows_and_restarts(tmp_path,monkeypatch,interrupt):
    import sqlite3
    import study_source_amendment as AM,install_recipient_funding as F
    root=tmp_path;out=root/'candidate';out.mkdir()
    campaign=root/'.local/batch3/b35c/live-study/campaign';campaign.mkdir(parents=True)
    for n in ('controller','bridge'):
        with sqlite3.connect(campaign/(n+'.sqlite')) as c:
            c.execute('CREATE TABLE receipts(payload,state)');c.execute('INSERT INTO receipts VALUES (?,?)',('exact-existing-id','unknown'))
    for trial in ('a','b'):
        slot=campaign/trial;slot.mkdir();(slot/'application.json').write_text('{"retained":true}')
        (slot/'worker-state').mkdir();(slot/'worker-state/secret.json').write_text('genuine-private-state')
    before=S.A.campaign_state(campaign)
    manifest=root/'SOURCE.json';approval=root/'APPROVED';manifest.write_text('predecessor');prior=S.digest(manifest.read_bytes());approval.write_text(prior+'\n')
    m=dict(evaluator_transition=dict(campaign_state=before));raw=S.canonical(m).encode()
    monkeypatch.setattr(S,'PRIOR',prior);monkeypatch.setattr(S,'load',lambda *a:(raw,m))
    monkeypatch.setattr(AM,'MANIFEST',manifest);monkeypatch.setattr(AM,'APPROVAL',approval)
    monkeypatch.setattr(AM,'load',lambda:json.loads(manifest.read_bytes()))
    monkeypatch.setattr(F,'mapping',lambda:({str(i):{} for i in range(12)},{}))
    trial=dict(candidate_sha256=S.digest(raw),all_prior_rows_preserved=True,product_unchanged=True,environment_unchanged=True,pg_calls=0,provider_io=0)
    S.save(out/'TRIAL.json',trial)
    report=root/'review.txt';report.write_text('Exact offline test review')
    review=root/'review.json';S.save(review,dict(verdict='PASS',manifest_sha256=S.digest(raw),trial_sha256=S.digest((out/'TRIAL.json').read_bytes()),report='review.txt',report_sha256=S.digest(report.read_bytes())))
    original=S.A.atomic_replace;stopped=[]
    def atomic(path,data):
        original(path,data)
        if interrupt and path==manifest and not stopped:stopped.append(True);raise InterruptedError('publication retained')
    monkeypatch.setattr(S.A,'atomic_replace',atomic)
    if interrupt:
        with pytest.raises(InterruptedError):S.publish(root,out,review)
        assert S.state(root,out)==1 and S.A.campaign_state(campaign)==before
    S.publish(root,out,review);S.publish(root,out,review)
    assert S.state(root,out)==2 and S.A.campaign_state(campaign)==before
    assert json.loads((out/'ACTIVATED.json').read_text())['sql_install'] is False
    (campaign/'a/worker-state/secret.json').write_text('changed')
    with pytest.raises(RuntimeError,match='pending_state_changed'):S.publish(root,out,review)

@pytest.mark.parametrize('arm',['B0','B1','M1'])
def test_actual_parent_observer_same_bridge_closure_no_repeat(tmp_path,monkeypatch,capsys,arm):
    import sqlite3
    import observe_live_study as V
    root=tmp_path/'campaign';slot=root/('a'*24);slot.mkdir(parents=True)
    (slot/'worker-state').mkdir();(slot/'connection.json').write_text('{}')
    state=dict(mode='official_api',blind_id=slot.name,variant=arm,current_run='exact-run',episode=1,workspace='ws',environment={})
    (slot/'application.json').write_text(O.canonical(state))
    payload=O.canonical(dict(trajectory=dict(id=slot.name,variant=arm),episode=1,admitted=dict(run_id='exact-run')))
    key=O.digest(O.canonical([slot.name,1,'execute',O.digest(payload)]))
    bridge=sqlite3.connect(root/'bridge.sqlite');bridge.row_factory=sqlite3.Row
    bridge.execute('CREATE TABLE receipts(key,payload,state,result)');bridge.execute('INSERT INTO receipts VALUES (?,?,?,NULL)',(key,payload,'sending'));bridge.commit()
    with sqlite3.connect(root/'controller.sqlite') as c:
        c.execute('CREATE TABLE operations(key,trial,episode,operation,payload,state,result)');c.execute('INSERT INTO operations VALUES (?,?,?,?,?,?,NULL)',(key,slot.name,1,'execute',payload,'unknown'))
    credential=tmp_path/'credential';credential.write_text('secret-canary');credential.chmod(0o600)
    monkeypatch.setattr(V,'OUT',tmp_path);monkeypatch.setattr(V,'require_live_release',lambda:None)
    monkeypatch.setattr(V,'mapping',lambda:({slot.name:{}},{slot.name:dict(grant=dict(responses=dict(secret_reference='file:'+str(credential))))}))
    monkeypatch.setattr(V,'install_gate',lambda *a:None)
    monkeypatch.setattr(V,'ProductAdapter',lambda *a,**kw:NS(db=bridge,environment={},close=lambda:None))
    done=[];calls=[]
    service=NS(get_run=lambda *a:NS(state='ready' if done else 'running',id='exact-run',unresolved=[],lease_expires_at=None))
    monkeypatch.setattr(V.A,'context',lambda *a:(service,None,None));monkeypatch.setattr(V,'pending_safety',lambda *a:{'selection':{'dispatch':1,'identity':1}})
    monkeypatch.setattr(V,'durable_progress',lambda *a:{'result':len(done)})
    def child(*args):
        assert arm=='B0' and args[3]==key;calls.append('baseline');done.append(True);return dict(status='ready',run_id='exact-run')
    def current(*args):
        assert arm in ('B1','M1');calls.append('current');done.append(True);return dict(status='ready',run_id='exact-run')
    monkeypatch.setattr(O,'visit',child);monkeypatch.setattr(V.A,'execute',current)
    monkeypatch.setattr(sys,'argv',['observe_live_study.py','--trajectory',slot.name,'--credential-file',str(credential)])
    V.main();assert calls==(['baseline'] if arm=='B0' else ['current'])
    result=json.loads(bridge.execute('SELECT result FROM receipts').fetchone()[0])
    assert result['key']==key and result['value']['run_id']=='exact-run' and result['state']=='complete'
    after=(slot/'application.json').read_bytes()
    with pytest.raises(Hold,match='exact_pending_bridge_required'):V.main()
    assert (slot/'application.json').read_bytes()==after and len(calls)==1
    assert 'secret-canary' not in capsys.readouterr().out
    with sqlite3.connect(root/'controller.sqlite') as c:assert c.execute('SELECT state FROM operations').fetchall()==[('unknown',)]
    bridge.close()


def test_prior_known_rows_still_satisfy_generic_policy_offline():
    # Historical64 proof is an input-shape regression only, never current authority.
    path=ROOT/'.local/batch3/b35c/retained-read-recovery/implementation-63/PARENT_B0_ANCHOR.json'
    anchor=json.loads(path.read_text());step=anchor['steps'][0];attempt=anchor['attempts'][0]
    attempt['grant_id']=step['grant_id']  # New read query includes the real attempt grant column.
    state=dict(mode='official_api',current_run=anchor['run_id'],workspace=attempt['workspace_id'],active_grant=dict(id=step['grant_id']))
    assert O.validate_anchor(anchor,state)['run_id']==state['current_run']
