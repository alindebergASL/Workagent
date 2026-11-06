"""Real SDK stdio execution and hostile fixture against the same jail."""
import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess

from workagent.connectors.stdio_jail import parameters, MODULES


def test_product_read_uses_fixed_stdio(monkeypatch):
    from workagent.connectors.mcp_client import read
    monkeypatch.setenv('WORKAGENT_SYNTHETIC_MCP_TRANSPORT','isolated-stdio')
    result=read('never-pass-this-token-to-child',2)
    assert result['structured']['items'][0]['id']=='synthetic-2'


def test_actual_version_pinned_stdio_tool():
    from mcp import Client
    async def exercise():
        async with Client(parameters(), mode='2026-07-28', cache=None,
                          extensions=[], input_required_max_rounds=0) as client:
            discovery=await client.session.send_discover('2026-07-28')
            assert discovery['supportedVersions']==['2026-07-28']
            assert discovery['_meta']['io.modelcontextprotocol/serverInfo']=={
                'name':'workagent-synthetic-catalog','version':'1'}
            result=await client.call_tool('catalog_read',{'page':2})
            assert result.structured_content['items'][0]['id']=='synthetic-2'
    asyncio.run(asyncio.wait_for(exercise(),15))


def test_stdio_real_no_secret_proc_host_or_network(tmp_path):
    source=Path(__file__).parents[1]/'workagent/connectors'
    for name in MODULES:
        shutil.copy2(source/name,tmp_path/name)
    (tmp_path/'stdio_bootstrap.py').write_text('''import os,json,pathlib,socket
s=socket.socket();s.settimeout(.2)
r={"secret_absent":"B33B_AMBIENT_CANARY" not in os.environ,
"home_absent":not pathlib.Path("/home/ubuntu").exists(),
"proc_absent":not pathlib.Path("/proc/1/environ").exists(),
"network_denied":s.connect_ex(("127.0.0.1",18769))!=0}
s.close()
try:pathlib.Path("/app/cannot-write").write_text("x");r["readonly"]=False
except OSError:r["readonly"]=True
print(json.dumps(r))
''')
    args=parameters(source_directory=tmp_path)
    process=subprocess.run([args.command,*args.args],env={**os.environ,'B33B_AMBIENT_CANARY':'synthetic-not-a-credential'},capture_output=True,timeout=10)
    assert process.returncode==0,process.stderr.decode()
    assert all(json.loads(process.stdout).values())
    assert b'synthetic-not-a-credential' not in process.stdout+process.stderr
