"""Reviewed SDK adapter, current version only. No fallback, prompts or extensions."""
import asyncio
import base64
import hashlib
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from .registry import BASE, PROTOCOL, IDENTITY, endpoint

class MCPUnavailable(ValueError):pass

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def reviewed_tools():return json.loads(Path(__file__).with_name('synthetic-tools.json').read_text())
def validate_tools(tools):
    material=[t.model_dump(mode='json',by_alias=True,exclude_none=True) for t in tools]
    if digest(material)!=reviewed_tools()['sha256']:raise MCPUnavailable('reviewed schema changed')
    if [t.name for t in tools]!=['catalog_read']:raise MCPUnavailable('unreviewed tools')

def reject_transport(transport):
    if transport not in ('loopback-http','isolated-stdio'):raise MCPUnavailable('transport unavailable; no arbitrary stdio or legacy adapter')

@asynccontextmanager
async def connection(token,transport,wire):
    from mcp import Client
    if transport=='isolated-stdio':
        from .stdio_jail import parameters
        # No token, caller path, argument or environment crosses this boundary.
        async with Client(parameters(),mode=PROTOCOL,cache=None,read_timeout_seconds=10,
                          extensions=[],input_required_max_rounds=0) as client:
            yield client
        return
    async with http_connection(token,wire) as client:
        yield client

@asynccontextmanager
async def http_connection(token,wire):
    import httpx2
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client

    async def request_hook(request):
        if str(request.url)!=endpoint(BASE+'/mcp'):raise MCPUnavailable('unreviewed endpoint')
        if wire is not None and request.method=='POST':
            data=json.loads(await request.aread())
            wire.append({'method':data.get('method'),'meta':data.get('params',{}).get('_meta'),
                         'version':request.headers.get('MCP-Protocol-Version')})
    async def response_hook(response):
        # SDK implements its own redirect logic, so follow_redirects=False alone
        # is insufficient. Reject before it can examine a Location header.
        if 300<=response.status_code<400:raise MCPUnavailable('redirect rejected')
        raw=b''
        async for chunk in response.aiter_bytes():
            raw+=chunk
            if len(raw)>262144:raise MCPUnavailable('response byte bound')
        response._content=raw
    async with httpx2.AsyncClient(trust_env=False,follow_redirects=False,timeout=10,
            headers={'Authorization':'Bearer '+token},event_hooks={'request':[request_hook],'response':[response_hook]}) as http:
        async with Client(streamable_http_client(endpoint(BASE+'/mcp'),http_client=http,max_sse_event_size=262144),
                mode=PROTOCOL,cache=None,read_timeout_seconds=10,extensions=[],input_required_max_rounds=0) as client:
            yield client

async def read_async(token,page,*,wire=None,transport='loopback-http'):
    reject_transport(transport)
    if type(page) is not int or not 1<=page<=3:raise MCPUnavailable('page bound')
    from importlib.metadata import version
    if version('mcp')!='2.3.0' or version('mcp-types')!='2.3.0':raise MCPUnavailable('SDK pin mismatch')
    async with connection(token,transport,wire) as client:
            # Explicit send_discover avoids the SDK discover() convenience version retry.
            from mcp.types import DiscoverResult
            discovery=DiscoverResult.model_validate(await client.session.send_discover(PROTOCOL))
            info=(discovery.meta or {}).get('io.modelcontextprotocol/serverInfo')
            caps=discovery.capabilities.model_dump(mode='json',exclude_none=True)
            if info!=IDENTITY or PROTOCOL not in discovery.supported_versions or discovery.instructions:
                raise MCPUnavailable('server identity changed')
            expected_caps={'prompts':{'list_changed':False},'resources':{'subscribe':False,'list_changed':False},'tools':{'list_changed':False}}
            if caps!=expected_caps:raise MCPUnavailable('unsupported server capability')
            client.session.adopt(discovery)
            if client.protocol_version!=PROTOCOL:raise MCPUnavailable('protocol pin mismatch')
            result=await client.list_tools(cache_mode='bypass')
            if result.next_cursor is not None:raise MCPUnavailable('tool pagination exceeds reviewed single page')
            validate_tools(result.tools)
            # Low-level SDK call deliberately avoids high-level call_tool's
            # HEADER_MISMATCH relist/retry (which could adopt a poisoned schema).
            out=await client.session.call_tool('catalog_read',{'page':page},allow_input_required=False,allow_claimed=False)
            after=await client.list_tools(cache_mode='bypass')
            if after.next_cursor is not None:raise MCPUnavailable('tool pagination changed')
            validate_tools(after.tools)
            if out.is_error or any(b.type!='text' for b in out.content):raise MCPUnavailable('unsupported result')
            material={'text':[b.text for b in out.content],'structured':out.structured_content}
            if token and token in json.dumps(material,ensure_ascii=False):
                raise MCPUnavailable('credential-bearing response rejected')
            if len(json.dumps(material).encode())>131072:raise MCPUnavailable('output byte bound')
            return material

def read(token,page):
    try:return asyncio.run(asyncio.wait_for(read_async(token,page,
        transport=os.environ.get('WORKAGENT_SYNTHETIC_MCP_TRANSPORT','loopback-http')),timeout=15))
    except Exception:raise MCPUnavailable('synthetic MCP unavailable') from None
