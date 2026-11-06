"""F1 closure: real product/tool-granted B1/M1, scripted wire, no provider.
No issuer or installed study writes; preserve all failed disposable attempts.
"""
import json
from hashlib import sha256
from pathlib import Path
import socket
import sys
from types import SimpleNamespace
from unittest.mock import patch
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'evaluation'),str(ROOT/'backend')]
import httpx
import verify_recipient_product as V
import study_application as A
import live_tool_authority as T
from network_harness import inventory
from study_controller import ingress
from workagent.adaptive import contract
from workagent.capabilities.delegation_composition import SCHEMA
from workagent.models import CreateWorkArea
from workagent.workspace_file_models import AcceptFileProposal
from workagent.service import Service

CONTENT='Disposable scripted editorial draft; no live-quality claim.'


class Wire(V.Wire):
    def __init__(self,decisions):
        super().__init__();self.decisions=decisions;self.contexts=[]
    def handle(self,request):
        response=super().handle(request);data=json.loads(request.content)
        if request.url.path=='/v1/responses':
            body=response.json();body['id']='resp_fixture_'+sha256(request.content).hexdigest()[:32]
            response=httpx.Response(200,json=body)
        if request.url.path=='/v1/responses' and data['metadata']['step_id']!='final':
            ctx=json.loads(data['input'][0]['content']);self.contexts.append(ctx)
            phase=data['metadata']['step_id']
            index=0 if phase=='selection' else int(phase.rsplit('_',1)[1])-1
            decision=self.decisions[index] if index<len(self.decisions) else dict(kind='reply',text='Scripted diagnostic complete.')
            body=response.json();body['output'][0]['arguments']=json.dumps(dict(goal='Exercise a disposable integration fixture',success_criteria=[],decision=decision))
            return httpx.Response(200,json=body)
        return response


def run(arm,out):
    mode='reviewed-v1' if arm=='M1' else 'off'
    instructions,schema=contract(SimpleNamespace(continuity_version='sustained-v1',memory_recall=mode,scope_tool_sha256=sha256(SCHEMA.material).hexdigest()))
    real_binding=V.GeneralAlphaResponsesBinding
    original_cv=Service.create_conversation
    calls=[]
    def create_cv(service,p,ws,cmd):
        calls.append(ws)
        if len(calls)==1:
            return service.create_work_area(p,ws,V.cmd(CreateWorkArea,title='Synthetic editorial project',goal='Public source editorial work',kind='project',selected_source_refs=[]))
        return original_cv(service,p,ws,cmd)
    with patch.object(V,'POLICY',instructions),patch.object(V,'DECISION_SCHEMA',schema),patch.object(V,'GeneralAlphaResponsesBinding',lambda **kw:real_binding(**kw,memory_recall=mode)),patch.object(Service,'create_conversation',create_cv):
        f=V.Fixture(out/arm)
    f.activate('2') # synthetic-only disposable certificate; no real issuer call
    grants={g['workspace_id']:g['data'] for g in f.grants}
    binding=dict(blind_id='disposable-'+arm,database_url=f.runtime.dsn,migration_database_url=f.owner.dsn,
      workspaces=f.workspaces,principal=f.principal.id,grant=grants[f.workspaces[0]],other_grant=grants[f.workspaces[1]])
    q=f.post(0);inputs=ROOT/'.local/batch3/b35c/preparation/public-inputs/B1/episode-1'
    state=dict(variant=arm,blind_id=binding['blind_id'],mode='official_api',workspace=f.workspaces[0],current_run=q.run.id,
      conversation=f.cvs[0].id,episode=1,active_grant=binding['grant'],inputs=str(inputs),input_files=inventory(inputs),artifacts=[],
      workspaces=f.workspaces,conversations=[f.cvs[0].id],other=f.cvs[1].id,memory=[],grant=binding['grant'],other_grant=binding['other_grant'])
    def execute(run,wire):
        T.install(binding,state,out/arm/'tool-intents')
        with patch.object(socket.socket,'connect',lambda *a:(_ for _ in ()).throw(AssertionError('network forbidden'))),patch.object(httpx.HTTPTransport,'handle_request',lambda _,r:wire.handle(r)):
            assert f.run(0,run).state=='ready'
            count=len(wire.calls)
            assert f.run(0,run).state=='ready' and len(wire.calls)==count
        assert all(('memory_context' in c)==(mode=='reviewed-v1') for c in wire.contexts)
    first=Wire([dict(kind='files_create_draft',source=dict(kind='text',filename='editorial.txt',mime_type='text/plain',content=CONTENT,sha256=sha256(CONTENT.encode()).hexdigest()))])
    execute(q.run,first)
    detail=f.service.get_conversation(f.principal,f.workspaces[0],f.cvs[0].id)
    aid=detail.artifact_ids[0];state.update(artifacts=[aid],collected=1)
    original=f.service.get_artifact(f.principal,f.workspaces[0],aid)
    ep2=ROOT/'.local/batch3/b35c/preparation/public-inputs/B1/episode-2'
    payload=dict(episode=2,input_directory=str(ep2.relative_to(ROOT)),input_files=inventory(ep2))
    with patch.object(A,'context',lambda *args:(f.service,f.principal,{})):
        transition=A.transition(out/arm,state,payload)
        human=f.service.get_artifact(f.principal,f.workspaces[0],aid)
        expected=CONTENT+'\n\n'+state['protected']
        assert human.current_revision.body.content==expected
        assert human.current_revision.body.content_sha256==sha256(expected.encode()).hexdigest()
        assert human.current_revision.author_kind=='human'
        assert human.current_revision_id!=original.current_revision_id
        assert len(state['memory'])==1 and state['memory'][0]['status']=='active'
        incoming=ingress(dict(input_directory=str(ep2.relative_to(ROOT))))
        admitted=A.admit(out/arm,state,incoming)
    run2=f.service.get_run(f.principal,state['workspace'],admitted['run_id'])
    version=dict(workspace_file_id=aid,version_id=human.current_revision_id,sha256=human.current_revision.body.content_sha256)
    newcontent=expected+'\n\nLater proposed clarification; human paragraph retained.'
    second=Wire([dict(kind='files_read_range',ref=version,offset=0,limit=8192),
      dict(kind='files_propose_patch',ref=version,content=newcontent,sha256=sha256(newcontent.encode()).hexdigest(),reason='Retain exact human paragraph and propose reviewed revision'),
      dict(kind='artifacts_export',input_ref=dict(kind='workspace_file',id=aid,version=version['version_id'],sha256=version['sha256']),format='txt')])
    execute(run2,second)
    unchanged=f.service.get_artifact(f.principal,state['workspace'],aid)
    assert unchanged.current_revision_id==human.current_revision_id
    proposals=f.service.proposals(f.principal,state['workspace'],aid).items
    assert len(proposals)==1 and proposals[0].status=='pending'
    assert proposals[0].body.content==newcontent and state['protected'] in proposals[0].body.content
    with f.runtime.transaction() as c:
        obs=c.execute("SELECT a.capability_id,e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id WHERE a.run_id=%s AND e.kind='observation'",(run2.id,)).fetchall()
    assert len(obs)==3 and all(o['data']['status']=='observed' for o in obs)
    exported=next(o for o in obs if o['capability_id']=='artifacts.export')['data']['output']['result']
    manifest,raw=f.service.download_export(f.principal,state['workspace'],exported['export_id'])
    assert raw==expected.encode() and sha256(raw).hexdigest()==manifest.blob.sha256
    # Explicit synthetic human review; NEVER performed by the model/driver.
    accepted=f.service.accept_file_proposal(f.principal,state['workspace'],aid,proposals[0].id,V.cmd(AcceptFileProposal,
       expected_current_revision_id=human.current_revision_id,expected_sha256=version['sha256'],acknowledge_removed_content=True))
    assert accepted.current.version_id!=version['version_id']
    final=f.service.get_artifact(f.principal,state['workspace'],aid)
    assert final.current_revision.body.content==newcontent and final.current_revision.author_kind=='human'
    restarted=Service(V.Database(f.runtime.dsn))
    assert restarted.download_export(f.principal,state['workspace'],exported['export_id'])[1]==raw
    assert restarted.get_artifact(f.principal,state['workspace'],aid).current_revision_id==final.current_revision_id
    with f.runtime.transaction() as c:
        assert c.execute('SELECT count(*) n FROM tool_grants').fetchone()['n']==2
        assert c.execute('SELECT count(*) n FROM tool_budget_accounts').fetchone()['n']==1
    f.close()
    return dict(arm=arm,database=f.name,status='PASS',file_human_edit=True,original_revision_preserved=True,
      memory_review=True,later_tool_read=True,proposal_pending_before_explicit_human_accept=True,
      human_acceptance=True,exact_human_content_retained=True,download_sha256=manifest.blob.sha256,
      download_bytes=len(raw),service_restart=True,duplicate_worker_sends=0,simulated_wire_calls=len(first.calls)+len(second.calls),
      live_episodes=0,provider_network_calls=0)


def main():
    out=ROOT/'.local/batch3/b35c/file-transition'/uuid.uuid4().hex;out.mkdir(mode=0o700,parents=True)
    rows=[run(arm,out) for arm in ('B1','M1')]
    summary=dict(status='PASS',scope='scripted no-network real-product transition/tools/receipt tests; not live study',rows=rows,evidence=str(out.relative_to(ROOT)))
    with (out/'summary.json').open('x') as f:json.dump(summary,f,indent=2);f.write('\n')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':
    import faulthandler
    faulthandler.dump_traceback_later(45,repeat=True)
    main()
