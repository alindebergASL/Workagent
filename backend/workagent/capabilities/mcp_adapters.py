"""Synthetic MCP reads through run grants, existing accounting and snapshots."""
from dataclasses import replace
from typing import Literal
from types import SimpleNamespace
from pydantic import Field
from ..composition import ReadDecision
from ..connectors.models import UUID
from ..model_base import Model
from ..workspace_file_models import SourceSnapshot
from ..errors import deny, DomainError
from .research_adapters import selector

PROFILE='synthetic-mcp-v1'
class MCPRead(ReadDecision):
    kind: Literal['mcp_read']
    connector_id: UUID
    access_generation: int = Field(strict=True,ge=1,le=2147483646)
    page: int = Field(strict=True,ge=1,le=3)
class MCPResult(Model):
    source: Literal['synthetic'] = 'synthetic'
    status: Literal['available','unavailable']
    snapshot: SourceSnapshot | None = None
class MCPOutput(Model):
    capability: Literal['mcp_read'] = 'mcp_read'
    version: Literal['1'] = '1'
    result: MCPResult

def input_refs(request):
    return [selector('connector',request.connector_id+':'+str(request.access_generation)),selector('processor','local-synthetic-mcp')]

def authorize_resources(service,c,p,run,scope,call,adapter):
    request=MCPRead.model_validate(call.arguments,strict=True)
    from .file_adapters import scope_targets
    if not run.conversation_id or call.input_refs!=input_refs(request) or scope_targets(service,c,p,run,scope) is not None:deny()
    if not c.execute('SELECT connector_read_authorized(%s,%s,%s) ok',
        (run.workspace_id,run.id,__import__('workagent.service',fromlist=['encoded']).encoded(call))).fetchone()['ok']:deny()

def material(request,result):
    import json,base64
    from hashlib import sha256
    from ..models import now
    text=json.dumps({'source':'synthetic','evidence':result},sort_keys=True,ensure_ascii=False)
    raw=text.encode();h=sha256(raw).hexdigest()
    url='https://synthetic.invalid/catalog/'+request.connector_id+'/'+str(request.page)
    return dict(status='ok',requested_url=url,final_url=url,raw_base64=base64.b64encode(raw).decode(),
        text=text,content_sha256=h,text_sha256=h,content_type='application/json',title='Synthetic library',
        http_status=200,redirects=[],fetched_at=now(),extractor_version='synthetic-mcp-2026-07-28-v1',
        coverage={'body_complete':True,'text_complete':True,'omissions':['One bounded synthetic catalog page; no private account.']},
        external_version={'etag':h,'last_modified':None},extraction_status='extracted',browser_used=False)

def invoke(service,cap,request,call):
    from . import policy,registry
    from .. import research
    from ..connectors import service as lifecycle,mcp_client
    adapter=registry.adapters()['connectors.mcp.read']
    with service.db.transaction() as c:
        p,run,scope,_=policy.authorize(service,c,cap,call,adapter)
        aid=c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND call_id=%s',
            (run.workspace_id,run.id,call.call_id)).fetchone()['id']
    captured=None
    try:
        token=lifecycle.credential(service,p,run.workspace_id,request.connector_id,request.access_generation)
        captured=material(request,mcp_client.read(token,request.page))
    except (ValueError,KeyError):pass
    except DomainError as error:
        if error.code.value!='source_unavailable':raise
    with service.db.transaction() as c:
        service._scope(c,p,run.workspace_id,write=True)
        policy.authorize(service,c,cap,call,adapter)
        if captured is None:return MCPOutput(result=MCPResult(status='unavailable'))
        snapshot=research.append_capture(service,c,p,run,scope,aid,SimpleNamespace(url=captured['requested_url']),captured)
        return MCPOutput(result=MCPResult(status='available',snapshot=snapshot))

def adapters():
    from .registry import _adapter
    paths=('capabilities/mcp_adapters.py','capabilities/mcp_composition.py','connectors/mcp_client.py','connectors/synthetic-tools.json',
        'connectors/registry.py','connectors/synthetic_server.py','../requirements-connectors.lock','connectors/service.py','connectors/oauth.py','connectors/vault.py','connectors/revocation.py',
        'connectors/models.py','connectors/stdio_jail.py','connectors/stdio_bootstrap.py','research.py','../migrations/065_synthetic_connectors.sql','../migrations/066_connector_evidence_authority.sql')
    a=_adapter('connectors.mcp.read',MCPRead,MCPOutput,None,paths,public=False,version='1',profile=PROFILE,
        category='connector',resource_kinds=['connector','processor'])
    return {'connectors.mcp.read':replace(a,invoke_fenced=invoke)}

def project(service,c,p,run,context):
    """Offer only exact task-granted connector IDs to ordinary model selection."""
    from . import policy
    from ..connectors.registry import configured
    context['synthetic_connectors']=[]
    if not configured() or not c.execute('SELECT 1 FROM tool_grants WHERE workspace_id=%s AND run_id=%s',(run.workspace_id,run.id)).fetchone():return
    policy.require_run_tools(c,run)
    g=policy.grant(c,run.workspace_id,run.id)
    if g.principal_id!=p.id or not any(pin.id=='connectors.mcp.read' for pin in g.capabilities):return
    rows=c.execute("SELECT id,access_generation,expires_at FROM connector_accounts WHERE workspace_id=%s AND principal_id=%s AND state='connected' AND expires_at>clock_timestamp() ORDER BY id LIMIT 100",(run.workspace_id,p.id)).fetchall()
    for row in rows:
        req=MCPRead(kind='mcp_read',connector_id=row['id'],access_generation=row['access_generation'],page=1)
        if all(ref in g.resource_selectors for ref in input_refs(req)):
            context['synthetic_connectors'].append(dict(connector_id=row['id'],access_generation=row['access_generation'],
                provider='synthetic',account='Synthetic library',resource='synthetic/catalog',effects=['read'],
                processor='local-synthetic-mcp',expires_at=row['expires_at'].isoformat()))
