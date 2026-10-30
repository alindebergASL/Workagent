"""Narrow no-network real-PG probes. Only fresh Fixture stores are writable.

Wire replies are scripted; issuer calls are NOT exercised here. The transition
context seam selects this disposable Service instead of any installed mapping.
"""
import json
import socket
import sys
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT/'evaluation'), str(ROOT/'backend')]
import httpx
import verify_recipient_product as V
import live_tool_authority as T
import study_application as A
from workagent.adaptive import contract
from workagent.capabilities.delegation_composition import SCHEMA
from workagent.capabilities import policy
from workagent.errors import DomainError
from network_harness import inventory

OUT=ROOT/'.local/batch3/b35c/recipient-review'/uuid.uuid4().hex
OUT.mkdir(parents=True, mode=0o700)
RESULT=Path(__file__).with_name('workflow-results.json')
CONTENT='Disposable scripted editorial draft; no live-quality claim.'

class DraftWire(V.Wire):
    def handle(self, request):
        response=super().handle(request)
        data=json.loads(request.content)
        if request.url.path=='/v1/responses' and data['metadata']['step_id']=='selection':
            body=response.json()
            body['output'][0]['arguments']=json.dumps(dict(goal='Exercise a disposable integration fixture',success_criteria=[],decision=dict(
                kind='files_create_draft',source=dict(kind='text',filename='editorial.txt',mime_type='text/plain',content=CONTENT,sha256=sha256(CONTENT.encode()).hexdigest()))))
            return httpx.Response(200,json=body)
        return response

def no_socket(*args,**kwargs):
    raise AssertionError('Python network forbidden by independent review')

def run(arm):
    mode='reviewed-v1' if arm=='M1' else 'off'
    instructions,schema=contract(SimpleNamespace(continuity_version='sustained-v1',memory_recall=mode,scope_tool_sha256=sha256(SCHEMA.material).hexdigest()))
    real_binding=V.GeneralAlphaResponsesBinding
    def binding_factory(**kwargs):
        return real_binding(**kwargs,memory_recall=mode)
    with patch.object(V,'POLICY',instructions),patch.object(V,'DECISION_SCHEMA',schema),patch.object(V,'GeneralAlphaResponsesBinding',binding_factory):
        f=V.Fixture(OUT/arm)
    wire=DraftWire()
    try:
        f.activate('2')  # synthetic certificate in new fixture ONLY
        q=f.post(0)
        grants={g['workspace_id']:g['data'] for g in f.grants}
        binding=dict(blind_id='disposable-'+arm,database_url=f.runtime.dsn,migration_database_url=f.owner.dsn,
                     workspaces=f.workspaces,principal=f.principal.id,grant=grants[f.workspaces[0]],other_grant=grants[f.workspaces[1]])
        inputs=ROOT/'.local/batch3/b35c/preparation/public-inputs/B1/episode-1'
        state=dict(variant=arm,blind_id=binding['blind_id'],mode='official_api',workspace=f.workspaces[0],current_run=q.run.id,
                   conversation=f.cvs[0].id,episode=1,active_grant=binding['grant'],inputs=str(inputs),input_files=inventory(inputs),artifacts=[])
        tool=T.install(binding,state,OUT/arm/'tool-intents')
        assert T.install(binding,state,OUT/arm/'tool-intents')==tool
        with f.runtime.transaction() as c:
            for kind in ('publish_artifact','record_responsibility','advance_responsibility'):
                try: policy.require_operation(c,q.run,SimpleNamespace(kind=kind))
                except DomainError as exc: assert exc.code.value=='unsupported_operation'
                else: raise AssertionError('legacy effect unexpectedly authorized')
            policy.require_operation(c,q.run,None)
        with patch.object(socket.socket,'connect',no_socket),patch.object(httpx.HTTPTransport,'handle_request',lambda _,request:wire.handle(request)):
            result=f.run(0,q.run)
        assert result.state=='ready', result.state
        detail=f.service.get_conversation(f.principal,f.workspaces[0],f.cvs[0].id)
        assert len(detail.artifact_ids)==1
        aid=detail.artifact_ids[0]
        artifact=f.service.get_artifact(f.principal,f.workspaces[0],aid)
        assert type(artifact.current_revision.body).__name__=='FileBody'
        before=(artifact.current_revision_id,artifact.current_revision.model_dump(mode='json'))
        state.update(mode='controlled_http',workspaces=f.workspaces,artifacts=[aid],collected=1,conversations=[f.cvs[0].id],other=f.cvs[1].id,memory=[])
        ep2=ROOT/'.local/batch3/b35c/preparation/public-inputs/B1/episode-2'
        payload=dict(episode=2,input_directory=str(ep2.relative_to(ROOT)),input_files=inventory(ep2))
        with patch.object(A,'context',lambda *args:(f.service,f.principal,{})):
            try:A.transition(OUT/arm,state,payload)
            except AttributeError as exc:
                error=str(exc)
                assert 'FileBody' in error and 'blocks' in error
            else:raise AssertionError('expected document-only transition incompatibility absent')
        after=f.service.get_artifact(f.principal,f.workspaces[0],aid)
        assert (after.current_revision_id,after.current_revision.model_dump(mode='json'))==before
        snapshot=f.snapshot()
        return dict(arm=arm,database=f.name,worker_state=result.state,tool_granted=True,full_tool_schema=True,
                    memory_mode=mode,artifact_body_type=type(artifact.current_revision.body).__name__,
                    episode2_blocker=error,artifact_unchanged=True,legacy_effects_denied=True,
                    simulated_wire_calls=len(wire.calls),network_provider_calls=0,
                    dispatches=len(V.kinds(snapshot,'dispatch')),retained_usd=str(snapshot['retained']),
                    tool_capabilities=[p['id'] for p in tool['capabilities']])
    finally:f.close()

if __name__=='__main__':
    rows=[run(arm) for arm in ('B1','M1')]
    result=dict(status='BLOCKER_REPRODUCED',scope='fresh real product DB, actual full-tool worker, scripted official HTTP wire; not live study',
                evidence=str(OUT.relative_to(ROOT)),results=rows,provider_calls=0)
    with RESULT.open('x') as stream:json.dump(result,stream,indent=2);stream.write('\n')
    print(json.dumps(result,indent=2))
