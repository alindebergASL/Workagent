"""Run-derived policy and explicit owner installation; no descriptor-as-grant."""
from decimal import Decimal
from ..errors import DomainError, deny
from ..models import now, Run
from ..provider_attempts import _owner
from ..service import canonical, encoded
from .models import ToolGrantV1, CapabilityPage
from . import registry


def grant(c,ws,rid):
    row=c.execute('SELECT data,active FROM tool_grants WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchone()
    if not row or not row['active']:
        deny()
    g=ToolGrantV1.model_validate_json(canonical(row['data']))
    denied=[r['selector'] for r in c.execute('SELECT selector FROM tool_scope_reductions WHERE grant_id=%s',(g.id,)).fetchall()]
    return g.model_copy(update={'resource_selectors':[ref for ref in g.resource_selectors if ref.model_dump(mode='json') not in denied]})


def require_run_tools(c,run):
    """One current-authority fence for staging, context, dispatch and publication."""
    bound=c.execute('SELECT 1 FROM tool_grants WHERE workspace_id=%s AND run_id=%s',
                    (run.workspace_id,run.id)).fetchone()
    if not bound:
        return
    if not c.execute('SELECT tool_run_available(%s,%s) AS ok',(run.workspace_id,run.id)).fetchone()['ok']:
        deny()
    g=grant(c,run.workspace_id,run.id)
    current=registry.adapters()
    for pin in g.capabilities:
        adapter=current.get(pin.id)
        if (adapter is None or adapter.descriptor.version!=pin.version
            or adapter.descriptor.schema_sha256!=pin.schema_sha256
            or adapter.descriptor.implementation_sha256!=pin.implementation_sha256):
            deny()


def require_operation(c,run,operation):
    if operation is None:
        return  # Reply/stop remain decisions, not ungranted adapter effects.
    bound=c.execute('SELECT 1 FROM tool_grants WHERE workspace_id=%s AND run_id=%s',
                    (run.workspace_id,run.id)).fetchone()
    if bound and operation.kind not in registry.COMPOSITION_IDS:
        raise DomainError('unsupported_operation')


def authorize(service,c,cap,call,adapter):
    p,run,scope=service._check_capability(c,cap)
    g=grant(c,run.workspace_id,run.id)
    d=adapter.descriptor
    installed=c.execute('SELECT descriptor,enabled FROM capability_installations WHERE id=%s AND version=%s',
                        (d.id,d.version)).fetchone()
    if not installed or not installed['enabled'] or installed['descriptor']!=d.model_dump(mode='json'):
        deny()
    if (g.principal_id!=p.id or g.access_generation!=run.access_generation or g.scope_id!=scope.id
        or g.expires_at<=now() or call.expected_work_version!=scope.work_version
        or call.capability_version!=d.version or call.capability_id!=d.id
        or not any(pin.id==d.id and pin.version==d.version and pin.schema_sha256==d.schema_sha256
                   and pin.implementation_sha256==d.implementation_sha256 for pin in g.capabilities)
        or not set(d.effects)<=set(g.effects) or not set(d.privacy_classes)<=set(g.privacy_classes)
        or any(ref not in g.resource_selectors for ref in call.input_refs)
        or (d.required_permission_template=='public_https' and g.egress!='public_https')):
        deny()
    if d.execution_profile in ('native-bounded-files-v1','confined-office-v1'):
        from .file_adapters import authorize_resources
        authorize_resources(service,c,p,run,scope,call,adapter)
    elif d.execution_profile == 'python-analysis-v1':
        from .compute_adapters import authorize_resources
        authorize_resources(service,c,p,run,scope,call,adapter)
    elif d.execution_profile == 'native-grounded-research-v1':
        from .research_adapters import authorize_resources
        authorize_resources(service,c,p,run,scope,call,adapter)
    elif d.execution_profile == 'native-github-public-v1':
        from .github_adapters import authorize_resources
        authorize_resources(service,c,p,run,scope,call,adapter)
    elif d.execution_profile == 'synthetic-mcp-v1':
        from .mcp_adapters import authorize_resources
        authorize_resources(service,c,p,run,scope,call,adapter)
    elif d.execution_profile == 'bounded-delegation-v1':
        from .delegation import authorize_resources
        authorize_resources(service,c,p,run,scope,call,adapter)
    elif call.input_refs:
        deny()
    return p,run,scope,g


def readable(service,c,p,ws,rid):
    generation=service._scope(c,p,ws)
    row=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',(ws,rid)).fetchone()
    if not row or row['data']['principal_id']!=p.id:
        deny()
    run=row['data']
    from ..models import Run
    require_run_tools(c,Run.model_validate(run))
    g=grant(c,ws,rid)
    if g.principal_id!=p.id or g.access_generation!=generation or g.expires_at<=now():
        deny()
    if run.get('conversation_id'):
        scope=service._conversation(c,p,ws,run['conversation_id'],True)
    else:
        scope=service._assignment(c,p,ws,run['assignment_id'],True)
    if scope.id!=g.scope_id:
        deny()
    return g


def discover(service,p,ws,rid):
    with service.db.transaction() as c:
        # Human API scope is authenticated separately; never trust an arbitrary ID.
        service._scope(c,p,ws)
        row=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',(ws,rid)).fetchone()
        if not row or row['data']['principal_id']!=p.id:
            deny()
        run=row['data']
        if run.get('conversation_id'):
            service._conversation(c,p,ws,run['conversation_id'],True)
        else:
            service._assignment(c,p,ws,run['assignment_id'],True)
        try:
            g=readable(service,c,p,ws,rid)
        except DomainError:
            g=None
        items=[]
        for adapter in registry.adapters().values():
            d=adapter.descriptor
            installed=c.execute('SELECT descriptor,enabled FROM capability_installations WHERE id=%s AND version=%s',
                                (d.id,d.version)).fetchone()
            state='not_installed'; reason='not_installed'
            if installed:
                state='installed' if installed['enabled'] else 'disabled'
                reason='temporarily_unavailable'
                if installed['enabled'] and installed['descriptor']==d.model_dump(mode='json'):
                    reason='needs_consent' if g is None else 'blocked_by_scope'
                    if g and any(pin.id==d.id and pin.version==d.version and pin.schema_sha256==d.schema_sha256
                                 and pin.implementation_sha256==d.implementation_sha256 for pin in g.capabilities):
                        if (set(d.effects)<=set(g.effects) and set(d.privacy_classes)<=set(g.privacy_classes)
                            and (d.required_permission_template!='public_https' or g.egress=='public_https')):
                            reason='available'
                            if d.execution_profile == 'native-github-public-v1':
                                from .github_adapters import selector
                                from ..connectors.base import PROCESSOR
                                if (selector('processor',PROCESSOR) not in g.resource_selectors
                                    or not any(ref.kind=='github_repository' and ref.version=='1' and ref.id==ref.sha256
                                               for ref in g.resource_selectors)):
                                    reason='blocked_by_scope'
            if d.execution_profile=='bounded-delegation-v1' and reason=='available':
                from .delegation import processor_ref
                if processor_ref() not in g.resource_selectors:
                    reason='blocked_by_scope'
            if d.execution_profile=='synthetic-mcp-v1':
                from ..connectors.registry import configured
                if not configured():reason='temporarily_unavailable'
                elif reason=='available':
                    from .mcp_adapters import project
                    offered={}
                    try:project(service,c,p,Run.model_validate(run),offered)
                    except DomainError:offered={}
                    if not offered.get('synthetic_connectors'):reason='blocked_by_scope'
            items.append(d.model_copy(update={'installation_state':state,'availability_reason':reason}))
        return CapabilityPage(items=items)


def restrict_resources(db, grant_id, selectors):
    """Owner-only monotone restriction; original grant and receipts stay immutable.

    This is a trusted bootstrap seam like install(), not an HTTP/model tool.
    Restoring access requires a new grant, never deletion of a restriction.
    """
    from .models import InputRef
    refs=[InputRef.model_validate_json(ref.model_dump_json()) for ref in selectors]
    if not refs:
        raise ValueError('explicit selectors required')
    with db.transaction() as c:
        _owner(c)
        row=c.execute('SELECT workspace_id,data FROM tool_grants WHERE id=%s',(grant_id,)).fetchone()
        if not row:
            raise ValueError('unknown grant')
        c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE',(row['workspace_id'],))
        if any(ref.model_dump(mode='json') not in row['data']['resource_selectors'] for ref in refs):
            raise ValueError('original selectors required')
        for ref in refs:
            c.execute('INSERT INTO tool_scope_reductions(grant_id,selector) VALUES(%s,%s) ON CONFLICT DO NOTHING',
                      (grant_id,encoded(ref)))
    with db.transaction() as c:
        saved=[r['selector'] for r in c.execute('SELECT selector FROM tool_scope_reductions WHERE grant_id=%s',(grant_id,)).fetchall()]
        if any(ref.model_dump(mode='json') not in saved for ref in refs):
            raise RuntimeError('scope restriction readback mismatch')


def install(db, tool_grant, *, limits, provider_grant_id=None):
    """Trusted operator bootstrap, no HTTP/model exposure. Read back exact records.

    Reuse an existing account ID for parent/child/shared capacity; never manufacture
    a new money limit. Dollars remain bounded by the existing project grant ledger.
    """
    g=ToolGrantV1.model_validate_json(tool_grant.model_dump_json())
    allowed={'local_compute','search','extraction','rendering','connector','child'}
    if not limits or set(limits)-allowed or any(type(v) is not int or not 0<v<=1000000 for v in limits.values()):
        raise ValueError('finite typed capacity limits required')
    available=registry.adapters()
    with db.transaction() as c:
        _owner(c)
        c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE',(g.workspace_id,))
        r=c.execute('SELECT data,conversation_id,assignment_id FROM runs WHERE workspace_id=%s AND id=%s',
                    (g.workspace_id,g.run_id)).fetchone()
        generation=c.execute('SELECT access_generation FROM workspaces WHERE id=%s',(g.workspace_id,)).fetchone()
        if (not r or r['data']['principal_id']!=g.principal_id or g.scope_id!=(r['conversation_id'] or r['assignment_id'])
            or generation['access_generation']!=g.access_generation or g.expires_at<=now()):
            raise ValueError('exact current run-derived grant required')
        for pin in g.capabilities:
            d=available[pin.id].descriptor
            if (pin.version!=d.version or pin.schema_sha256!=d.schema_sha256 or pin.implementation_sha256!=d.implementation_sha256
                or not set(d.effects)<=set(g.effects) or not set(d.privacy_classes)<=set(g.privacy_classes)):
                raise ValueError('reviewed exact capability pin required')
            c.execute('INSERT INTO capability_installations(id,version,descriptor) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',
                      (d.id,d.version,encoded(d)))
            saved=c.execute('SELECT descriptor,enabled FROM capability_installations WHERE id=%s AND version=%s',(d.id,d.version)).fetchone()
            if not saved['enabled'] or saved['descriptor']!=d.model_dump(mode='json'):
                raise ValueError('installation drift; install a new version')
        if provider_grant_id:
            pg=c.execute('SELECT * FROM provider_grants WHERE id=%s',(provider_grant_id,)).fetchone()
            if not pg or not pg['active'] or pg['workspace_id']!=g.workspace_id or pg['principal_id']!=g.principal_id:
                raise ValueError('existing matching provider budget required')
        c.execute('''INSERT INTO tool_budget_accounts(id,workspace_id,principal_id,provider_grant_id,limits)
                     VALUES(%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
                  (g.budget_account_id,g.workspace_id,g.principal_id,provider_grant_id,encoded(limits)))
        account=c.execute('SELECT * FROM tool_budget_accounts WHERE id=%s',(g.budget_account_id,)).fetchone()
        if account!={'id':g.budget_account_id,'workspace_id':g.workspace_id,'principal_id':g.principal_id,
                     'provider_grant_id':provider_grant_id,'limits':limits}:
            raise ValueError('existing account binding mismatch')
        c.execute('INSERT INTO tool_grants(id,workspace_id,run_id,data) VALUES(%s,%s,%s,%s)',
                  (g.id,g.workspace_id,g.run_id,encoded(g)))
    with db.transaction() as c:
        if grant(c,g.workspace_id,g.run_id)!=g:
            raise RuntimeError('grant readback mismatch')
    return g
