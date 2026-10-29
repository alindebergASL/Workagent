"""Parent-run restricted PG + real SDK TCP integration. No model calls.

Requires fresh migrated DATABASE_URL/MIGRATION_DATABASE_URL workagent_test_*.
Starts only its own fixed-port synthetic fixture; refuses an existing listener.
"""
from datetime import timedelta
from pathlib import Path
import base64
import os
import socket
import subprocess
import sys
import time
from uuid import uuid4
import pytest
from test_domain import context,cmd
from test_conversations import conversation,post
from test_workspace_file_gateway_pg import call
from test_memory_pg import remember
from workagent.connectors import service as L,oauth,mcp_client
from workagent.connectors.models import StartAuthorization,CompleteAuthorization,RevokeConnector
from workagent.connectors.revocation import revoke
from workagent.capabilities import policy,registry,mcp_adapters as A
from workagent.capabilities.broker import CapabilityBroker
from workagent.capabilities.models import ToolGrantV1,CapabilityPin
from workagent.db import Database
from workagent.models import new_id,now
from workagent.errors import DomainError
from workagent.service import Principal,Service
from workagent.memory.models import MemoryFile

@pytest.fixture
def connector(context,tmp_path,monkeypatch):
    with socket.socket() as s:assert s.connect_ex(('127.0.0.1',18769))!=0,'fixture port occupied'
    monkeypatch.setenv('WORKAGENT_SYNTHETIC_CONNECTOR','1')
    monkeypatch.setenv('WORKAGENT_SYNTHETIC_VAULT_DIR',str(tmp_path/'vault'))
    monkeypatch.setenv('WORKAGENT_SYNTHETIC_VAULT_KEY_ID','disposable-test')
    monkeypatch.setenv('WORKAGENT_SYNTHETIC_VAULT_KEY',base64.b64encode(os.urandom(32)).decode())
    log=(tmp_path/'server.log').open('wb')
    proc=subprocess.Popen([sys.executable,'-m','workagent.connectors.synthetic_server'],
        env={'PATH':str(Path(sys.executable).parent),'PYTHONPATH':str(Path(__file__).resolve().parents[1]),'LANG':'C.UTF-8'},stdout=log,stderr=log)
    try:
        for _ in range(100):
            assert proc.poll() is None
            with socket.socket() as s:
                if s.connect_ex(('127.0.0.1',18769))==0:break
            time.sleep(.05)
        s,p,ws,_,_=context;request=StartAuthorization(resource='synthetic/catalog',idempotency_key=str(uuid4()))
        flow=L.start(s,p,ws,request);assert L.start(s,p,ws,request)==flow
        complete=CompleteAuthorization(idempotency_key=str(uuid4()));status=L.complete(s,p,ws,flow.flow_id,complete)
        assert status.state=='connected';assert L.complete(s,p,ws,flow.flow_id,complete)==status
        with pytest.raises(DomainError):L.complete(s,p,ws,flow.flow_id,CompleteAuthorization(idempotency_key=str(uuid4())))
        yield status
    finally:proc.terminate();proc.wait(timeout=10);log.close()

def install(context,connector,*,expires_after=300):
    s,p,ws,_,admin=context;cv=conversation(context);q=post(context,cv);cap=s.claim_run(p,ws,q.run.id)
    req=A.MCPRead(kind='mcp_read',connector_id=connector.connector_id,access_generation=connector.access_generation,page=1)
    d=registry.adapters()['connectors.mcp.read'].descriptor
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256)],
        resource_selectors=A.input_refs(req),effects=['read'],privacy_classes=['workspace_private'],egress='none',
        expires_at=now()+timedelta(seconds=expires_after),access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),g,limits={'connector':10})
    request=call(cap,q,'connectors.mcp.read',req.model_dump(mode='json'),A.input_refs(req))
    return cv,q,cap,request

def test_real_read_memory_revoke_and_restart(context,connector):
    s,p,ws,_,_=context;cv,q,cap,request=install(context,connector)
    observation=CapabilityBroker(s,cap).call(request)
    assert observation.status=='observed' and observation.output['result']['status']=='available'
    snapshot=observation.output['result']['snapshot'];files=s.list_workspace_files(p,ws,cv.id).items;assert len(files)==1
    memory,_=remember(context,cv,content='Invented catalog fact',source_refs=[MemoryFile(ref=files[0].current)])
    assert s.list_memory(p,ws,cv.id).items
    with pytest.raises(DomainError):L.status(s,Principal('intruder'),ws,connector.connector_id)
    with s.db.transaction() as c:
        handle=c.execute('SELECT credential_ref FROM connector_accounts WHERE workspace_id=%s',(ws,)).fetchone()['credential_ref']
        tokens,_=L.vault().read(handle)
        app_data=str(c.execute('SELECT row_to_json(a) data FROM connector_accounts a WHERE workspace_id=%s',(ws,)).fetchall())
        assert tokens['access_token'] not in app_data and tokens['refresh_token'] not in app_data
        with pytest.raises(Exception):c.execute("UPDATE connector_accounts SET access_generation=999 WHERE workspace_id=%s",(ws,))
    request_revoke=RevokeConnector(expected_generation=1,idempotency_key=str(uuid4()))
    removed=revoke(s,p,ws,connector.connector_id,request_revoke)
    assert removed.state=='revoked' and removed.access_generation==2 and removed.provider_revocation=='revoked'
    assert revoke(s,p,ws,connector.connector_id,request_revoke)==removed
    assert L.status(Service(Database(s.db.dsn)),p,ws,connector.connector_id)==removed
    with pytest.raises(ValueError):L.vault().read(handle)
    assert s.list_workspace_files(p,ws,cv.id).items==[] and s.list_memory(p,ws,cv.id).items==[]
    for action in [lambda:s.get_source_snapshot(p,ws,snapshot['snapshot_id']),lambda:s.inspect_memory(p,ws,memory.memory_id),lambda:CapabilityBroker(s,cap).call(request)]:
        with pytest.raises(DomainError):action()

def test_inflight_late_result_and_queued_denied(context,connector,monkeypatch):
    s,p,ws,_,_=context;cv,q,cap,request=install(context,connector);original=mcp_client.read;calls=[]
    def late(token,page):
        result=original(token,page);calls.append(1)
        revoke(s,p,ws,connector.connector_id,RevokeConnector(expected_generation=1,idempotency_key=str(uuid4())))
        return result
    monkeypatch.setattr(mcp_client,'read',late)
    observed=CapabilityBroker(s,cap).call(request)
    assert observed.status=='cost_only' and observed.output is None
    with s.db.transaction() as c:assert c.execute('SELECT count(*) n FROM source_snapshots WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
    with pytest.raises(DomainError):CapabilityBroker(s,cap).call(request)
    assert calls==[1]

def test_provider_failure_does_not_restore_local_access(context,connector,monkeypatch):
    s,p,ws,_,_=context
    monkeypatch.setattr(oauth,'post',lambda *args:(_ for _ in ()).throw(ConnectionError('synthetic outage')))
    status=revoke(s,p,ws,connector.connector_id,RevokeConnector(expected_generation=1,idempotency_key=str(uuid4())))
    assert status.state=='revoked' and status.access_generation==2 and status.provider_revocation=='failed'
    with pytest.raises(DomainError):L.credential(s,p,ws,connector.connector_id,1)
