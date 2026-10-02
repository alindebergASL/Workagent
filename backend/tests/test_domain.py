import json
import os
import secrets
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from workagent.api import create_app, Settings
from workagent.db import Database
from workagent.errors import DomainError
from workagent.fixture import seed, work_once, generate
from workagent.models import *
from workagent.service import Service, Principal, encoded

ACTOR=Path(__file__).resolve().parents[2]/'fixtures/actor/solo-v0.1/initial_records.json'


def cmd(cls,**kwargs):
    return cls(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),**kwargs)


class PrivateDsn(str):
    def __repr__(self):
        return "<disposable database DSN redacted>"


@pytest.fixture
def context():
    # A missing real PostgreSQL environment is a FAIL, never a skip/pass.
    dsn=PrivateDsn(os.environ['DATABASE_URL']); admin=PrivateDsn(os.environ['MIGRATION_DATABASE_URL'])
    assert '/workagent_test_' in dsn, 'Tests only run against disposable workagent_test_* databases'
    ws='test-'+new_id(); p=Principal('local-human')
    records=json.loads(ACTOR.read_text())
    seed(admin,records,ws,p.id)
    service=Service(Database(dsn)); service.db.check_runtime_role()
    refs=[SourceRef(source_id=s.id,external_version=s.external_version,observed_at=s.observed_at) for s in service.list_sources(p,ws).items]
    return service,p,ws,refs,admin


def create(context):
    s,p,ws,refs,_=context
    return s.create_assignment(p,ws,cmd(CreateAssignment,goal='Improve my private intake review',completion_criteria=['Reusable plan and checklist'],selected_source_refs=refs))


def ready(context):
    s,p,ws,refs,_=context
    result=create(context)
    work_once(s,p,ws,result.run.id)
    a=s.get_assignment(p,ws,result.assignment.id)
    return a,s.get_artifact(p,ws,a.artifact_ids[0])


def raises(code,fn):
    with pytest.raises(DomainError) as e: fn()
    assert e.value.code.value==code


def test_create_replay_conflict_concurrency_and_restart(context):
    s,p,ws,refs,_=context
    request=cmd(CreateAssignment,goal='A private goal',completion_criteria=['Done'],selected_source_refs=refs)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results=list(pool.map(lambda _:s.create_assignment(p,ws,request),range(6)))
    assert len({r.assignment.id for r in results})==1
    replay=Service(Database()).create_assignment(p,ws,request.model_copy(update={'request_id':new_id()}))
    assert replay==results[0]
    changed=request.model_copy(update={'goal':'Different'})
    raises('command_conflict',lambda:s.create_assignment(p,ws,changed))
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM assignments WHERE workspace_id=%s',(ws,)).fetchone()['n']==1
        assert c.execute('SELECT count(*) AS n FROM audit WHERE workspace_id=%s',(ws,)).fetchone()['n']==1
        assert c.execute('SELECT count(*) AS n FROM outbox WHERE workspace_id=%s',(ws,)).fetchone()['n']==1


def test_generalized_fixture_plan_protected_note_independent_versions(context):
    s,p,ws,refs,_=context
    a,artifact=ready(context)
    assert a.state=='ready' and len(a.artifact_ids)==2
    text=' '.join(b.text for b in artifact.current_revision.body.blocks)
    assert '4 of 8' in text
    assert 'Keep Wednesday 14:00–15:00 for method drafting.' in [b.text for b in artifact.current_revision.body.blocks]
    arbitrary=[{'content':{'rows':[{'id':'X','owner_recorded':True,'next_action_recorded':False},{'id':'Y','owner_recorded':False,'next_action_recorded':True},{'id':'Z','owner_recorded':True,'next_action_recorded':True}]}}]
    bodies,unresolved=generate(arbitrary)
    assert '2 of 3' in bodies[0].blocks[1].text and not unresolved
    before=[x.external_version for x in s.list_sources(p,ws).items]
    saved=s.human_save(p,ws,artifact.id,cmd(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=Body(title='Human',blocks=[Block(block_id='h',kind='paragraph',text='My protected new idea')])) )
    assert saved.current_revision.revision_number==2
    other=s.get_artifact(p,ws,a.artifact_ids[1])
    assert other.current_revision.revision_number==1
    assert s.get_assignment(p,ws,a.id).work_version==a.work_version
    assert before==[x.external_version for x in s.list_sources(p,ws).items]
    assert len(s.history(p,ws,artifact.id).items)==2


def test_stale_proposal_preserves_both_and_resolution_rechecks(context):
    s,p,ws,refs,_=context
    a,artifact=ready(context)
    queued=s.request_revision(p,ws,artifact.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=artifact.current_revision_id,instruction='Make next action concrete'))
    cap=s.claim_run(p,ws,queued.run.id)
    human=s.human_save(p,ws,artifact.id,cmd(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=Body(title='Human edit',blocks=[Block(block_id='h',kind='paragraph',text='Keep this edit')])) )
    proposal_body=Body(title='Worker alternative',blocks=[Block(block_id='w',kind='paragraph',text='Separate proposal')])
    r=s.complete_run(cap,[proposal_body])
    proposal=s.proposals(p,ws,artifact.id).items[0]
    assert proposal.body==proposal_body
    raises('version_conflict',lambda:s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=artifact.current_revision_id)))
    raises('version_conflict',lambda:s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=human.current_revision_id)))
    assert s.get_artifact(p,ws,artifact.id).current_revision.body.title=='Human edit'
    assert s.proposals(p,ws,artifact.id).items[0].status=='pending'
    assert s.get_artifact(p,ws,artifact.id,artifact.current_revision_id).requested_revision.body==artifact.current_revision.body
    dismissed=s.dismiss_proposal(p,ws,proposal.id,cmd(DismissProposal,expected_current_revision_id=human.current_revision_id,resolution='keep_current'))
    assert dismissed.status=='dismissed' and dismissed.body==proposal_body
    fresh_a=s.get_assignment(p,ws,a.id)
    new=s.request_revision(p,ws,artifact.id,cmd(RequestRevision,expected_work_version=fresh_a.work_version,base_revision_id=human.current_revision_id,instruction='Preserve human text'))
    work_once(s,p,ws,new.run.id)
    pending=next(x for x in s.proposals(p,ws,artifact.id).items if x.status=='pending')
    accepted=s.accept_proposal(p,ws,pending.id,cmd(AcceptProposal,expected_current_revision_id=human.current_revision_id))
    assert accepted.current_revision.revision_number==3
    assert accepted.current_revision.body==pending.body


def test_concurrent_human_saves_only_one_wins(context):
    s,p,ws,refs,_=context
    a,artifact=ready(context)
    def save(i):
        try:
            return s.human_save(p,ws,artifact.id,cmd(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=Body(title=str(i),blocks=[Block(block_id='a',kind='paragraph',text='Human')]))).current_revision.revision_number
        except DomainError as e:
            return e.code.value
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes=list(pool.map(save,range(2)))
    assert sorted(map(str,outcomes))==['2','version_conflict']


def test_reauthorize_all_paths_and_replay(context):
    s,p,ws,refs,admin=context
    request=cmd(CreateAssignment,goal='Private',completion_criteria=['Done'],selected_source_refs=refs)
    result=s.create_assignment(p,ws,request)
    work_once(s,p,ws,result.run.id)
    a=s.get_assignment(p,ws,result.assignment.id)
    artifact=s.get_artifact(p,ws,a.artifact_ids[0])
    denied=Principal('outsider')
    raises('not_found_or_not_authorized',lambda:s.get_assignment(denied,ws,a.id))
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
        c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
    for action in [lambda:s.create_assignment(p,ws,request),lambda:s.get_assignment(p,ws,a.id),lambda:s.get_run(p,ws,result.run.id),lambda:s.get_artifact(p,ws,artifact.id),lambda:s.history(p,ws,artifact.id),lambda:s.proposals(p,ws,artifact.id)]:
        raises('not_found_or_not_authorized',action)
    assert s.list_assignments(p,ws).items==[]


def test_task_creation_requires_independent_matching_readback(context):
    s,p,ws,refs,_=context
    result=create(context)
    receipt=s.create_task(p,ws,result.assignment.id,cmd(CreateTask,expected_work_version=result.assignment.work_version,owner_id=p.id,desired_result='Review the checklist',evidence_refs=refs[:1]))
    assert receipt.verification=='unresolved'
    assert s.get_task(p,ws,receipt.task.id).verification=='unresolved'
    assert s.get_task(p,ws,receipt.task.id,1,'Wrong desired result').verification=='unresolved'
    inspected=s.get_task(p,ws,receipt.task.id,1,receipt.task.desired_result)
    assert inspected.verification=='verified_created'
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM task_inspections WHERE workspace_id=%s',(ws,)).fetchone()['n']==3
    raises('not_found_or_not_authorized',lambda:s.get_task(p,ws,'missing',1,'Review the checklist'))


def test_fence_lease_and_revocation_at_commit(context):
    s,p,ws,refs,admin=context
    result=create(context)
    cap=s.claim_run(p,ws,result.run.id)
    raises('action_unresolved',lambda:s.claim_run(p,ws,result.run.id))
    with Database(admin).transaction() as c:
        r=s.get_run(p,ws,result.run.id)
        r.lease_expires_at=now().replace(year=2020)
        c.execute('UPDATE runs SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(r),ws,r.id))
    new_cap=s.claim_run(p,ws,result.run.id)
    body=Body(title='Not committed',blocks=[Block(block_id='a',kind='paragraph',text='Separate')])
    raises('not_found_or_not_authorized',lambda:s.complete_run(cap,[body]))
    with Database(admin).transaction() as c:
        c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
    raises('source_changed',lambda:s.complete_run(new_cap,[body]))
    assert s.get_assignment(p,ws,result.assignment.id).artifact_ids==[]


def test_worker_cannot_human_save_accept_or_forge_capability(context):
    s,p,ws,refs,_=context
    a,artifact=ready(context)
    raises('not_found_or_not_authorized',lambda:s.human_save(Principal(p.id,'worker'),ws,artifact.id,cmd(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=artifact.current_revision.body)))
    raises('not_found_or_not_authorized',lambda:s.accept_proposal(Principal(p.id,'worker'),ws,'absent',cmd(AcceptProposal,expected_current_revision_id=artifact.current_revision_id)))
    raises('not_found_or_not_authorized',lambda:s.complete_run(p,[artifact.current_revision.body]))


def test_immutable_postgres_records_and_runtime_authority_guard(context):
    s,p,ws,refs,admin=context
    a,artifact=ready(context)
    for dsn in [s.db.dsn,admin]:
        with pytest.raises(psycopg.Error):
            with Database(dsn).transaction() as c:
                c.execute('UPDATE revisions SET data=data WHERE workspace_id=%s',(ws,))
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))


def test_atomic_rollback_if_event_fails(context,monkeypatch):
    s,p,ws,refs,_=context
    def fail(*args): raise RuntimeError('deliberate audit failure')
    monkeypatch.setattr(s,'_event',fail)
    with pytest.raises(RuntimeError): create(context)
    assert s.list_assignments(p,ws).items==[]
    with s.db.transaction() as c:
        for table in ['commands','runs','outbox','audit']:
            assert c.execute(f'SELECT count(*) AS n FROM {table} WHERE workspace_id=%s',(ws,)).fetchone()['n']==0


def test_http_errors_strict_schema_auth_and_polling(context):
    s,p,ws,refs,_=context
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    with TestClient(create_app(settings)) as client:
        headers={'Authorization':'Bearer '+settings.local_bearer,'X-Schema-Version':'workagent/v1','X-Request-Id':'http-test'}
        path=f'/v1/workspaces/{ws}/assignments'
        response=client.get(path,headers=headers)
        assert response.status_code==200
        response=client.get(path)
        assert response.status_code==401 and response.json()['code']=='unauthenticated'
        request=cmd(CreateAssignment,goal='HTTP goal',completion_criteria=['Done'],selected_source_refs=refs).model_dump(mode='json')
        response=client.post(path,headers=headers,json={**request,'arbitrary':'forbidden'})
        assert response.status_code==422 and response.json()['code']=='validation_error'
        response=client.post(path,headers=headers,json=request)
        assert response.status_code==202
        result=response.json()
        assert result['run']['state']=='queued'
        response=client.post(path,headers=headers,json={**request,'goal':'new intent'})
        assert response.status_code==409 and response.json()['code']=='command_conflict'
        response=client.get(path+'/missing',headers=headers)
        assert response.status_code==404 and response.json()['code']=='not_found_or_not_authorized'
        assert response.json()['request_id']=='http-test'
        assert client.get(path+'?limit=101',headers=headers).status_code==422
        assert client.get(path,headers={**headers,'X-Schema-Version':'workagent/v2'}).status_code==422
        spec=client.get('/openapi.json').json()
        assert spec['openapi'].startswith('3.1')
        assert spec['paths'][path.replace(ws,'{workspace_id}')]['post']['security']


def test_partial_pause_resume_cancel_and_budget(context):
    s,p,ws,refs,_=context
    result=create(context)
    paused=s.control_assignment(p,ws,result.assignment.id,cmd(ControlAssignment,expected_work_version=result.assignment.work_version,operation='pause'))
    raises('action_unresolved',lambda:s.claim_run(p,ws,result.run.id))
    resumed=s.control_assignment(p,ws,paused.id,cmd(ControlAssignment,expected_work_version=paused.work_version,operation='resume'))
    cap=s.claim_run(p,ws,resumed.run_ids[-1])
    bodies,unresolved=generate([])
    run=s.complete_run(cap,bodies,unresolved)
    assert run.state=='partial' and run.unresolved
    assert s.get_assignment(p,ws,resumed.id).artifact_ids


def test_worker_proposal_command_replay_scope_and_revocation(context):
    from workagent.tool_registry import ProposeArtifactRevisionInput, registry
    s,p,ws,refs,admin=context
    a,artifact=ready(context)
    queued=s.request_revision(p,ws,artifact.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=artifact.current_revision_id,instruction='Refine'))
    cap=s.claim_run(p,ws,queued.run.id)
    request=cmd(ProposeArtifactRevisionInput,workspace_id=ws,artifact_id=artifact.id,base_revision_id=artifact.current_revision_id,body=artifact.current_revision.body,source_dependencies=refs)
    raises('not_found_or_not_authorized',lambda:s.propose_artifact_revision(cap,request.model_copy(update={'artifact_id':'outside-scope'})))
    result=s.propose_artifact_revision(cap,request)
    replay=s.propose_artifact_revision(cap,request.model_copy(update={'request_id':new_id()}))
    assert result==replay
    different=request.model_copy(update={'body':Body(title='Changed',blocks=[Block(block_id='a',kind='paragraph',text='Different intent')])})
    raises('command_conflict',lambda:s.propose_artifact_revision(cap,different))
    assert len(s.proposals(p,ws,artifact.id).items)==1
    names={tool['name'] for tool in registry()['tools']}
    assert names=={'get_assignment','get_artifact','get_task','propose_artifact_revision'}
    with Database(admin).transaction() as c:
        c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s',(ws,))
    raises('not_found_or_not_authorized',lambda:s.propose_artifact_revision(cap,request))


def test_source_change_unavailability_and_budget(context):
    s,p,ws,refs,admin=context
    result=create(context)
    with Database(admin).transaction() as c:
        row=c.execute('SELECT data FROM sources WHERE workspace_id=%s AND id=%s',(ws,refs[0].source_id)).fetchone()
        source=Source.model_validate(row['data']); source.external_version='2'
        c.execute('UPDATE sources SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(source),ws,source.id))
    raises('source_changed',lambda:s.claim_run(p,ws,result.run.id))
    with Database(admin).transaction() as c:
        source.available=False
        c.execute('UPDATE sources SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(source),ws,source.id))
    raises('source_unavailable',lambda:s.get_assignment(p,ws,result.assignment.id))
    with Database(admin).transaction() as c:
        source.available=True; source.external_version='1'
        c.execute('UPDATE sources SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(source),ws,source.id))
        run=result.run.model_copy(update={'budget_units':0})
        c.execute('UPDATE runs SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(run),ws,run.id))
    raises('budget_exhausted',lambda:s.claim_run(p,ws,result.run.id))


def test_one_active_assignment_lease_and_pin_drift(context):
    s,p,ws,refs,admin=context
    a,artifact=ready(context)
    q1=s.request_revision(p,ws,artifact.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=artifact.current_revision_id,instruction='First'))
    a=s.get_assignment(p,ws,a.id)
    q2=s.request_revision(p,ws,artifact.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=artifact.current_revision_id,instruction='Second'))
    cap=s.claim_run(p,ws,q1.run.id)
    raises('action_unresolved',lambda:s.claim_run(p,ws,q2.run.id))
    with Database(admin).transaction() as c:
        run=s.get_run(p,ws,q1.run.id).model_copy(update={'bundle_hash':'0'*64})
        c.execute('UPDATE runs SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(run),ws,run.id))
    raises('unsupported_operation',lambda:s.complete_run(cap,[artifact.current_revision.body]))
    assert s.proposals(p,ws,artifact.id).items==[]


def test_http_internal_errors_are_safe_envelopes(context,monkeypatch):
    s,p,ws,refs,_=context
    settings=Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    app=create_app(settings)
    def failed(*args): raise RuntimeError('sensitive storage detail must not escape')
    monkeypatch.setattr(app.state.service,'list_workspaces',failed)
    headers={'Authorization':'Bearer '+settings.local_bearer,'X-Schema-Version':'workagent/v1','X-Request-Id':'safe-error'}
    with TestClient(app,raise_server_exceptions=False) as client:
        response=client.get('/v1/workspaces',headers=headers)
        assert response.status_code==500
        assert response.json()['code']=='internal_error'
        assert response.json()['request_id']=='safe-error'
        assert 'sensitive' not in response.text
        assert client.get('/unknown',headers=headers).json()['code']=='not_found_or_not_authorized'


def test_real_http_process_restart_reopens_saved_work(context):
    import socket
    import subprocess
    import sys
    import time
    import httpx
    s,p,ws,refs,_=context
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
    env={**os.environ,'LOCAL_TEST_MODE':'true','LOCAL_PRINCIPAL_ID':p.id,'LOCAL_BEARER_TOKEN':secrets.token_urlsafe(32)}
    headers={'Authorization':'Bearer '+env['LOCAL_BEARER_TOKEN'],'X-Schema-Version':'workagent/v1','X-Request-Id':'process-test'}
    base=f'http://127.0.0.1:{port}'
    def start():
        proc=subprocess.Popen([sys.executable,'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port',str(port),'--no-proxy-headers'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(80):
            if proc.poll() is not None: raise AssertionError('API process exited before readiness')
            try:
                if httpx.get(base+'/openapi.json',timeout=.2).status_code==200: return proc
            except httpx.TransportError: pass
            time.sleep(.05)
        proc.terminate(); proc.wait(timeout=5)
        raise AssertionError('API process did not become ready')
    proc=start()
    try:
        path=f'/v1/workspaces/{ws}/assignments'
        request=cmd(CreateAssignment,goal='Process restart evidence',completion_criteria=['Private artifacts'],selected_source_refs=refs)
        response=httpx.post(base+path,headers=headers,json=request.model_dump(mode='json'))
        assert response.status_code==202
        result=response.json()
        child=subprocess.run([sys.executable,'-m','workagent.fixture','work','--workspace',ws,'--run',result['run']['id']],env=env,capture_output=True,text=True,check=True)
        assert json.loads(child.stdout)['state']=='ready'
        a=httpx.get(base+path+'/'+result['assignment']['id'],headers=headers).json()
        artifact_path=f'/v1/workspaces/{ws}/artifacts/'+a['artifact_ids'][0]
        artifact=httpx.get(base+artifact_path,headers=headers).json()
        save=cmd(HumanSave,expected_current_revision_id=artifact['current_revision_id'],body=Body(title='Saved across process restart',blocks=[Block(block_id='h',kind='paragraph',text='Durable human text')]))
        saved=httpx.post(base+artifact_path+'/save',headers=headers,json=save.model_dump(mode='json'))
        assert saved.status_code==200
        saved_id=saved.json()['current_revision_id']
    finally:
        proc.terminate(); proc.wait(timeout=5)
    proc=start()
    try:
        reopened=httpx.get(base+artifact_path,headers=headers)
        assert reopened.status_code==200
        assert reopened.json()['current_revision_id']==saved_id
        assert reopened.json()['current_revision']['body']['title']=='Saved across process restart'
    finally:
        proc.terminate(); proc.wait(timeout=5)
