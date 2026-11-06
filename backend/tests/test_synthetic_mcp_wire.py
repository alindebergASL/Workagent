"""Required real localhost SDK proof. Run outside socket-restricted sandboxes.

No skip/mock substitute: unavailable socket support FAILS this explicit test.
"""
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from workagent.connectors import oauth,mcp_client,registry

def test_real_tcp_sdk_executes_current_protocol(tmp_path):
    # Never take over a listener or silently reuse an unrelated fixture.
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1',18769))!=0,'reviewed fixture port already occupied'
    log=(tmp_path/'synthetic-server.log').open('wb')
    process=subprocess.Popen([sys.executable,'-m','workagent.connectors.synthetic_server'],
        env={'PATH':str(Path(sys.executable).parent),'PYTHONPATH':str(Path(__file__).resolve().parents[1]),'LANG':'C.UTF-8'},stdout=log,stderr=log)
    try:
        for _ in range(100):
            assert process.poll() is None,'owned fixture failed to start'
            with socket.socket() as probe:
                if probe.connect_ex(('127.0.0.1',18769))==0:break
            time.sleep(.05)
        tokens=oauth.exchange(oauth.new_flow());wire=[]
        result=asyncio.run(mcp_client.read_async(tokens['access_token'],2,wire=wire))
        assert result['structured']['items'][0]['id']=='synthetic-2'
        assert [r['method'] for r in wire]==['server/discover','tools/list','tools/call','tools/list']
        assert all(r['version']==registry.PROTOCOL and r['meta']['io.modelcontextprotocol/protocolVersion']==registry.PROTOCOL for r in wire)
        assert 'initialize' not in str(wire)
        assert oauth.post('/oauth/revoke',{'access_token':tokens['access_token'],'refresh_token':tokens['refresh_token']})=={'revoked':True}
        (tmp_path/'sdk-wire.json').write_text(json.dumps({'wire':wire,'result':result,'real_tcp':True},indent=2))
    finally:
        process.terminate();process.wait(timeout=10);log.close()
