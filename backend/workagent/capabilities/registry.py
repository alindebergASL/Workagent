"""Reviewed native adapters; no dynamic imports, model-supplied handlers or grants.

Historical catalogs are not modified. A V2 install pins these wrappers plus their
transitive implementation files, and still needs a separately installed ToolGrant.
"""
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Callable
from pydantic import BaseModel, ConfigDict, JsonValue
from .. import composition
from ..broker import Broker
from ..tool_registry import TOOLS
from ..service import digest
from .models import CapabilityDescriptorV2, CostProfile


class ReadOutput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    capability: str
    version: str
    result: JsonValue


@dataclass(frozen=True)
class Adapter:
    descriptor: CapabilityDescriptorV2
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    invoke: Callable | None
    invoke_fenced: Callable | None = None


def implementation_hash(*paths):
    root=Path(__file__).resolve().parents[1]
    common=('capabilities/models.py','capabilities/broker.py','capabilities/policy.py',
            'capabilities/observations.py','service.py','model_base.py','../migrations/053_capability_gateway.sql')
    return digest({p:sha256((root/p).read_bytes()).hexdigest() for p in sorted(set(common+paths))})


def _read(model):
    def invoke(service, cap, request):
        # Materialize only server-scoped context. No context object from a model.
        if isinstance(request,composition.DiscoverCapabilities):
            from .policy import discover
            with service.db.transaction() as c:
                p,run,_=service._check_capability(c,cap)
            return {'capability':request.kind,'version':'1',
                    'result':discover(service,p,run.workspace_id,run.id).model_dump(mode='json')}
        context=service.conversation_worker_context(cap)
        return composition.execute_read(request,context)
    return invoke


def _legacy(name):
    return lambda service,cap,request: Broker(service,cap)._call_legacy(name,request.model_dump(mode='json'))


def _adapter(name, inp, out, invoke, paths, *, public=False, version='2', effects=None, resource_kinds=None,
             profile='native-bounded-read-v1', category=None):
    ins,outs=inp.model_json_schema(),out.model_json_schema()
    descriptor=CapabilityDescriptorV2(id=name,version=version,schema_sha256=digest({'input':ins,'output':outs}),
        implementation_sha256=implementation_hash('capabilities/registry.py',*paths),transport='native',
        input_schema=ins,output_schema=outs,effects=effects or ['read'],resource_kinds=resource_kinds or ['run_context'],
        privacy_classes=['public'] if public else ['workspace_private'],execution_profile=profile,
        cost_profile=CostProfile(category=category or ('extraction' if public else 'local_compute'),reserved_units=1,unit='call'),
        result_byte_limit=262144,timeout_ms=30000,retry_policy='never_resend_unknown',
        installation_state='installed',availability_reason='needs_consent',
        required_permission_template='public_https' if public else 'run_context')
    return Adapter(descriptor,inp,out,invoke)


def adapters():
    result={}
    for name,model,paths,public in [
        ('context.read',composition.ReadContext,('composition.py','conversations.py'),False),
        ('files.inspect_json',composition.InspectJSON,('composition.py','json_inspection.py'),False),
        ('research.fetch',composition.FetchPublicURL,('composition.py','public_retrieval.py'),True),
        ('capabilities.discover_legacy',composition.DiscoverCapabilities,('composition.py',),False),
        ('procedures.load_legacy',composition.LoadSkill,('composition.py',),False),
    ]:
        result[name]=_adapter(name,model,ReadOutput,_read(model),paths,public=public)
    for name in ('get_assignment','get_artifact'):
        inp,out,_=TOOLS[name]
        key='legacy.'+name
        result[key]=_adapter(key,inp,out,_legacy(name),('broker.py','tool_registry.py','service.py'))
    from .file_adapters import adapters as file_adapters
    result.update(file_adapters())
    return result


def catalog():
    return [a.descriptor for a in adapters().values()]


COMPOSITION_IDS={'read_context':'context.read','inspect_json':'files.inspect_json','fetch_public_url':'research.fetch',
                 'discover_capabilities':'capabilities.discover_legacy','load_skill':'procedures.load_legacy'}

# New opt-in operations; frozen legacy descriptor catalogs remain unchanged.
from .file_adapters import IDS as FILE_IDS
COMPOSITION_IDS.update(FILE_IDS)
