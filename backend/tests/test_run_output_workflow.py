"""Deterministic real-SQL tools, not live model/research quality evidence."""
from hashlib import sha256
from test_domain import context
from test_workspace_files_pg import make, text
from test_workspace_file_gateway_pg import install, call
from workagent.capabilities.broker import CapabilityBroker
from workagent.capabilities.models import InputRef


def test_created_draft_can_be_exported_in_same_run(context):
    s,p,ws,_,_=context
    cv,_,_=make(context)
    cap,grant,q=install(context,cv,[],['files.create_draft','files.read_range','artifacts.export'],allow_run_outputs=True)
    broker=CapabilityBroker(s,cap)
    draft=broker.call(call(cap,q,'files.create_draft',{'kind':'files_create_draft','source':text('Complete editorial draft').model_dump()},[]))
    assert draft.status=='observed'
    current=draft.output['result']['current']
    ref=InputRef(kind='workspace_file',id=current['workspace_file_id'],version=current['version_id'],sha256=current['sha256'])
    export=broker.call(call(cap,q,'artifacts.export',{'kind':'artifacts_export','input_ref':ref.model_dump(),'format':'txt'},[ref]))
    assert export.status=='observed'
    manifest,raw=s.download_export(p,ws,export.output['result']['export_id'])
    assert raw==b'Complete editorial draft' and sha256(raw).hexdigest()==manifest.blob.sha256


import json
import secrets
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
import pytest
import psycopg
from test_domain import cmd
from test_conversations import conversation, post
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_runtime import expire
from research_http_fixture import fixture, QUERY, URL
from workagent.adaptive import contract
from workagent.db import Database
from workagent.service import digest, encoded
from workagent.models import now, new_id
from workagent.errors import DomainError
from workagent.capabilities import registry, policy, research_adapters as R
from workagent.capabilities.models import ToolGrantV1, CapabilityPin
from workagent.memory.models import RememberMemory
from test_memory_full_tools import config


def install_workflow(ctx,cv,q,pg):
    s,p,ws,_,admin=ctx
    requests=[R.ResearchSearch(kind='research_search',query=QUERY),
              R.ResearchCapture(kind='research_capture',url=URL,allow_browser=False)]
    names=['research.search','research.capture','research.cite','files.read_range','files.create_draft','artifacts.export']
    ds=[registry.adapters()[n].descriptor for n in names]
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=[r for req in requests for r in R.input_refs(req)],
        effects=['read','draft','local_compute'],privacy_classes=['public','workspace_private'],egress='public_https',
        expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)
    policy.install(Database(admin),g,limits={'local_compute':20,'rendering':5,'search':10,'extraction':10},provider_grant_id=pg.id if pg else None)
    return g


@pytest.mark.parametrize('mode',['off','reviewed-v1'])
def test_complete_research_editorial_worker_restart(context,tmp_path,monkeypatch,mode):
    """Actual worker and local TLS fixture; scripted choices are NOT usefulness."""
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1')
    s,p,ws,_,_=context; cv=conversation(context)
    memory=s.remember_memory(p,ws,cmd(RememberMemory,kind='preference',scope_kind='task',scope_id=cv.id,
        subject_key='editorial',predicate_key='scope',content='Always retain geographic scope qualifiers.'))
    instructions,schema=contract(SimpleNamespace(**config(mode)['responses']))
    with patch('test_general_alpha_runtime.POLICY',instructions),patch('test_general_alpha_runtime.DECISION_SCHEMA',schema):
        pg=activate(context,cv,continuity_version='sustained-v1',max_steps=8,memory_recall=mode)
    q=post(context,cv,'Research the bulletin, read the primary source, draft an editorial with exact attribution, and deliver a downloadable file.')
    g=install_workflow(context,cv,q,pg)
    content='# Capacity bulletin\n\nThe synthetic east depot reports 10 units. This does not establish capacity elsewhere.\n\nSource: '+URL+'\n'
    def source_read(ctx):
        ref=next(r for r in ctx['run_output_refs'] if r['kind']=='workspace_file')
        return dict(kind='files_read_range',ref=dict(workspace_file_id=ref['id'],version_id=ref['version'],sha256=ref['sha256']),offset=0,limit=8192)
    def cite(ctx):
        a=next(r for r in ctx['run_output_refs'] if r['kind']=='artifact_revision')
        snap=ctx['research_sources'][0]
        # Use source bytes actually returned to the worker, not a hidden oracle.
        observation=next(o for o in ctx['adaptive']['observations'] if o['decision']['kind']=='files_read_range')
        raw=observation['capability_result']['result']['text']
        quote='Current public capacity: 10 units.'; start=raw.index(quote)
        return dict(kind='research_cite',artifact_id=a['id'],revision_id=a['version'],body_hash=a['sha256'],
            claim='The bulletin reports 10 units at the synthetic east depot.',evidence=[dict(workspace_file_id=snap['workspace_file_id'],
            snapshot_id=snap['snapshot_id'],text_sha256=snap['extraction_sha256'],start=start,end=start+len(quote),quote=quote,relation='supports')])
    def export(ctx):
        a=next(r for r in ctx['run_output_refs'] if r['kind']=='artifact_revision')
        return dict(kind='artifacts_export',input_ref=a,format='markdown')
    fake=AlphaProvider([dict(kind='research_search',query=QUERY),dict(kind='research_capture',url=URL,allow_browser=False),
        source_read,dict(kind='files_create_draft',source=text(content).model_dump()),cite,export,
        dict(kind='reply',text='Editorial draft and exact-source citation retained; downloadable file ready.')],
        explanation='Deterministic research/editorial mechanism completed; no live model quality claim.')
    class Interrupted(RuntimeError): pass
    interrupted=False
    def hook(name):
        nonlocal interrupted
        if name=='after_tool_result' and len(fake.contexts)==4 and not interrupted:
            interrupted=True
            raise Interrupted('deterministic restart after committed draft')
    with fixture(tmp_path/'https') as http:
        with pytest.raises(Interrupted):
            finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
        assert interrupted
        expire(context,q.run.id)
        assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
        calls=list(fake.calls)
        assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
        assert fake.calls==calls and len(http['calls'])==2
    with s.db.transaction() as c:
        steps=c.execute('SELECT request_bytes FROM responses_steps WHERE attempt_id IN (SELECT id FROM provider_attempts WHERE run_id=%s) ORDER BY phase',(q.run.id,)).fetchall()
        observations=c.execute("SELECT a.capability_id,e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' WHERE a.run_id=%s",(q.run.id,)).fetchall()
        assert c.execute('SELECT data FROM tool_grants WHERE id=%s',(g.id,)).fetchone()['data']==g.model_dump(mode='json')
    assert len(steps)==8 and all(json.loads(r['request_bytes'])['max_output_tokens']==8192 for r in steps)
    assert len(observations)==6 and all(o['data']['status']=='observed' for o in observations)
    export_id=next(o['data']['output']['result']['export_id'] for o in observations if o['capability_id']=='artifacts.export')
    manifest,raw=s.download_export(p,ws,export_id)
    assert content.encode() in raw and sha256(raw).hexdigest()==manifest.blob.sha256
    assert '99 units' not in content
    assert all(('memory_context' in ctx)==(mode=='reviewed-v1') for ctx in fake.contexts)
    if mode=='reviewed-v1':
        assert all(ctx['memory_manifest'][0]['revision_id']==memory.revision_id for ctx in fake.contexts)
    assert len(s.memory_usage(p,ws,q.run.id).items)==(8 if mode=='reviewed-v1' else 0)
    import os
    from pathlib import Path
    if os.environ.get('B35C_PROOF_DIR'):
        out=Path(os.environ['B35C_PROOF_DIR']);out.mkdir(parents=True,exist_ok=True)
        (out/(mode+'-editorial.md')).write_bytes(raw)
        (out/(mode+'-proof.json')).write_text(json.dumps(dict(
            evidence='deterministic_worker_local_TLS_not_live_usefulness',mode=mode,
            run_id=q.run.id,request_sha256=[sha256(r['request_bytes'].encode()).hexdigest() for r in steps],
            max_output_tokens=[json.loads(r['request_bytes'])['max_output_tokens'] for r in steps],
            observations=[o['data'] for o in observations],export=manifest.model_dump(mode='json'),
            memory_usage=[u.model_dump(mode='json') for u in s.memory_usage(p,ws,q.run.id).items],
            restarted_after_draft=True,duplicate_requests=0,paid_product_calls=0),indent=2)+'\n')


@pytest.mark.parametrize('opt_in',[False,True])
def test_output_selectors_do_not_grant_unrelated_or_forged_resources(context,opt_in):
    s,p,ws,_,_=context;cv,unrelated,_=make(context)
    cap,g,q=install(context,cv,[],['files.create_draft','artifacts.export'],allow_run_outputs=opt_in)
    broker=CapabilityBroker(s,cap)
    draft=broker.call(call(cap,q,'files.create_draft',{'kind':'files_create_draft','source':text('Own').model_dump()},[]))
    own=draft.output['result']['current']
    valid=InputRef(kind='workspace_file',id=own['workspace_file_id'],version=own['version_id'],sha256=own['sha256'])
    refs=[InputRef(kind='workspace_file',id=unrelated.workspace_file_id,version=unrelated.current.version_id,sha256=unrelated.current.sha256),
          valid.model_copy(update={'sha256':'0'*64}),valid.model_copy(update={'version':new_id()})]
    if not opt_in: refs.append(valid)
    for ref in refs:
        request=call(cap,q,'artifacts.export',{'kind':'artifacts_export','input_ref':ref.model_dump(),'format':'txt'},[ref])
        with pytest.raises(DomainError): broker.call(request)
        with pytest.raises(psycopg.Error),s.db.transaction() as c:
            c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s)',
                (ws,q.run.id,cap.fence,digest(cap.secret),encoded(request),digest(secrets.token_urlsafe(32))))


def test_human_edit_removes_implicit_output_access(context):
    from workagent.workspace_file_models import EditWorkspaceFile
    s,p,ws,_,_=context;cv,_,_=make(context)
    cap,g,q=install(context,cv,[],['files.create_draft','artifacts.export'],allow_run_outputs=True)
    draft=CapabilityBroker(s,cap).call(call(cap,q,'files.create_draft',{'kind':'files_create_draft','source':text('Own').model_dump()},[]))
    own=draft.output['result']['current']
    s.edit_workspace_file(p,ws,own['workspace_file_id'],cmd(EditWorkspaceFile,expected_work_version=q.conversation.work_version,
        base_version_id=own['version_id'],base_sha256=own['sha256'],content='Human edit preserved',sha256=sha256(b'Human edit preserved').hexdigest()))
    with s.db.transaction() as c:
        assert c.execute('SELECT tool_run_output_resources(%s,%s) AS refs',(ws,q.run.id)).fetchone()['refs']==[]
    ref=InputRef(kind='workspace_file',id=own['workspace_file_id'],version=own['version_id'],sha256=own['sha256'])
    with pytest.raises(DomainError):
        CapabilityBroker(s,cap).call(call(cap,q,'artifacts.export',{'kind':'artifacts_export','input_ref':ref.model_dump(),'format':'txt'},[ref]))


@pytest.mark.parametrize('change',['source_reduction','grant_revoke'])
def test_capture_reuse_and_derived_draft_denied_after_revoke(context,monkeypatch,change):
    from test_research_pg import material
    from workagent import public_retrieval
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1')
    monkeypatch.setattr(public_retrieval,'fetch_public_source',lambda url,**kw:material(url,'Exact primary source.'))
    s,p,ws,_,admin=context;cv=conversation(context);q=post(context,cv)
    cap=s.claim_run(p,ws,q.run.id);g=install_workflow(context,cv,q,None)
    broker=CapabilityBroker(s,cap); req=R.ResearchCapture(kind='research_capture',url=URL,allow_browser=False)
    captured=broker.call(call(cap,q,'research.capture',req.model_dump(),R.input_refs(req)))
    draft=broker.call(call(cap,q,'files.create_draft',{'kind':'files_create_draft','source':text('Derived draft').model_dump()},[]))
    assert captured.status==draft.status=='observed'
    with s.db.transaction() as c:
        assert len(c.execute('SELECT tool_run_output_resources(%s,%s) AS refs',(ws,q.run.id)).fetchone()['refs'])==3
    if change=='source_reduction': policy.restrict_resources(Database(admin),g.id,[R.input_refs(req)[0]])
    else:
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
    with s.db.transaction() as c:
        assert c.execute('SELECT tool_run_output_resources(%s,%s) AS refs',(ws,q.run.id)).fetchone()['refs']==[]
        assert not c.execute('SELECT research_source_visible(%s,%s) AS ok',(ws,captured.attempt_id)).fetchone()['ok']
    own=draft.output['result']['current']
    ref=InputRef(kind='workspace_file',id=own['workspace_file_id'],version=own['version_id'],sha256=own['sha256'])
    request=call(cap,q,'artifacts.export',dict(kind='artifacts_export',input_ref=ref.model_dump(),format='txt'),[ref])
    with pytest.raises(DomainError):broker.call(request)
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s)',
            (ws,q.run.id,cap.fence,digest(cap.secret),encoded(request),digest(secrets.token_urlsafe(32))))


def test_unknown_draft_does_not_become_authority_or_repeat_effect(context,monkeypatch):
    from dataclasses import replace
    s,p,ws,_,_=context;cv,_,_=make(context)
    cap,g,q=install(context,cv,[],['files.create_draft','artifacts.export'],allow_run_outputs=True)
    adapters=registry.adapters(); original=adapters['files.create_draft']; invocations=[]
    def lost(*args):
        result=original.invoke_fenced(*args); invocations.append(result)
        raise OSError('simulated loss after durable file effect')
    adapters['files.create_draft']=replace(original,invoke_fenced=lost)
    monkeypatch.setattr(registry,'adapters',lambda:adapters)
    request=call(cap,q,'files.create_draft',dict(kind='files_create_draft',source=text('Unknown outcome').model_dump()),[])
    broker=CapabilityBroker(s,cap);obs=broker.call(request)
    assert obs.status=='outcome_unknown' and obs.output is None
    assert broker.call(request)==obs and len(invocations)==1
    with s.db.transaction() as c:
        assert c.execute('SELECT tool_run_output_resources(%s,%s) AS refs',(ws,q.run.id)).fetchone()['refs']==[]


def test_derived_resources_do_not_cross_runs_or_owners(context):
    from workagent.service import Principal
    s,p,ws,_,_=context;cv,_,_=make(context)
    cap,g,q=install(context,cv,[],['files.create_draft','artifacts.export'],allow_run_outputs=True)
    draft=CapabilityBroker(s,cap).call(call(cap,q,'files.create_draft',dict(kind='files_create_draft',source=text('Private output').model_dump()),[]))
    cv2=conversation(context);cap2,g2,q2=install(context,cv2,[],['artifacts.export'],allow_run_outputs=True)
    own=draft.output['result']['current'];ref=InputRef(kind='workspace_file',id=own['workspace_file_id'],version=own['version_id'],sha256=own['sha256'])
    request=call(cap2,q2,'artifacts.export',dict(kind='artifacts_export',input_ref=ref.model_dump(),format='txt'),[ref])
    with pytest.raises(DomainError):CapabilityBroker(s,cap2).call(request)
    with pytest.raises(DomainError):s.get_artifact(Principal('different-owner'),ws,ref.id)
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s)',
            (ws,q2.run.id,cap2.fence,digest(cap2.secret),encoded(request),digest(secrets.token_urlsafe(32))))
