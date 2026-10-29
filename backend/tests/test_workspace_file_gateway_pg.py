"""Actual gateway calls against the restricted PG fixture, never a human API proxy."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import pytest
from test_domain import context, cmd, raises
from test_workspace_files_pg import make, text
from test_conversations import post
from workagent.models import new_id, now
from workagent.db import Database
from workagent.service import encoded
from workagent.errors import DomainError
from workagent.capabilities import registry, policy
from workagent.capabilities.models import ToolGrantV1, CapabilityPin, ToolCallV1, InputRef
from workagent.capabilities.broker import CapabilityBroker
from workagent.workspace_file_models import EditWorkspaceFile


def install(ctx, cv, selectors, names):
    s,p,ws,_,admin=ctx
    q=post(ctx,cv);cap=s.claim_run(p,ws,q.run.id)
    adapters=registry.adapters();descriptors=[adapters[name].descriptor for name in names]
    grant=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,
                                    implementation_sha256=d.implementation_sha256) for d in descriptors],
        resource_selectors=selectors,effects=list(set(effect for d in descriptors for effect in d.effects)),
        privacy_classes=['workspace_private'],egress='none',expires_at=now()+timedelta(hours=1),
        access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),grant,limits={'local_compute':20,'rendering':5})
    return cap,grant,q


def call(cap,q,name,args,refs):
    return ToolCallV1(call_id=new_id(),capability_id=name,capability_version=registry.adapters()[name].descriptor.version,
                     arguments=args,input_refs=refs,expected_work_version=q.conversation.work_version)


def test_gateway_exact_refs_scope_list_range_and_pre_post_fences(context,monkeypatch):
    s,p,ws,_,admin=context;cv,file,_=make(context)
    ref=InputRef(kind='workspace_file',id=file.workspace_file_id,version=file.current.version_id,sha256=file.current.sha256)
    cap,grant,q=install(context,cv,[ref],['files.list','files.read_range'])
    broker=CapabilityBroker(s,cap)
    listing=broker.call(call(cap,q,'files.list',{'kind':'files_list','after':None,'limit':10},[]))
    assert listing.status=='observed' and len(listing.output['result']['items'])==1
    request=call(cap,q,'files.read_range',{'kind':'files_read_range','ref':file.current.model_dump(),'offset':0,'limit':8192},[ref])
    read=broker.call(request)
    assert read.status=='observed' and read.output['result']['text']=='\ufeffα😀\r\nHuman note\r\n'
    assert broker.call(request)==read
    for forged in [request.model_copy(update={'input_refs':[]}),
                   request.model_copy(update={'arguments':{**request.arguments,'ref':{**request.arguments['ref'],'sha256':'0'*64}}})]:
        with pytest.raises(DomainError): broker.call(forged)
    adapters=registry.adapters();original=adapters['files.read_range']
    def late(*args):
        result=original.invoke_fenced(*args)
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(grant.id,))
        return result
    adapters['files.read_range']=replace(original,invoke_fenced=late)
    monkeypatch.setattr(registry,'adapters',lambda:adapters)
    late_result=broker.call(request.model_copy(update={'call_id':new_id()}))
    assert late_result.status=='cost_only' and late_result.output is None


def test_gateway_draft_exactly_once_and_patch_never_accepts(context):
    s,p,ws,_,_=context;cv,file,_=make(context)
    ref=InputRef(kind='workspace_file',id=file.workspace_file_id,version=file.current.version_id,sha256=file.current.sha256)
    cap,grant,q=install(context,cv,[ref],['files.create_draft','files.propose_patch','artifacts.export'])
    broker=CapabilityBroker(s,cap)
    create=call(cap,q,'files.create_draft',{'kind':'files_create_draft','source':text('New draft').model_dump()},[])
    drafted=broker.call(create)
    assert drafted.status=='observed'
    assert broker.call(create)==drafted
    assert s.get_artifact(p,ws,drafted.output['result']['workspace_file_id']).current_revision.author_kind=='worker'
    patch=call(cap,q,'files.propose_patch',{'kind':'files_propose_patch','ref':file.current.model_dump(),
        'content':'Proposed','sha256':sha256(b'Proposed').hexdigest(),'reason':'Review'},[ref])
    proposed=broker.call(patch)
    assert proposed.status=='observed' and proposed.output['result']['status']=='pending'
    assert s.get_artifact(p,ws,file.workspace_file_id).current_revision_id==file.current.version_id
    export=call(cap,q,'artifacts.export',{'kind':'artifacts_export','input_ref':ref.model_dump(),'format':'txt'},[ref])
    exported=broker.call(export)
    assert exported.status=='observed'
    manifest,raw=s.download_export(p,ws,exported.output['result']['export_id'])
    assert sha256(raw).hexdigest()==manifest.blob.sha256
    s.edit_workspace_file(p,ws,file.workspace_file_id,cmd(EditWorkspaceFile,expected_work_version=q.conversation.work_version,
        base_version_id=ref.version,base_sha256=ref.sha256,content='New human text',sha256=sha256(b'New human text').hexdigest()))
    with pytest.raises(DomainError): broker.call(patch.model_copy(update={'call_id':new_id()}))
