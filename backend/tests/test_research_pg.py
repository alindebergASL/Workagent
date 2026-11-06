"""Parent-run restricted PostgreSQL tests. In-process fetch fixture; not live HTTP proof."""
import base64
from datetime import timedelta
from hashlib import sha256
from dataclasses import replace
import pytest
from test_domain import context, cmd
from test_conversations import conversation, post
from test_workspace_files_pg import make
from test_workspace_file_gateway_pg import call
from workagent.models import now,new_id,TurnResult,TextResult,CancelConversation
from workagent.db import Database
from workagent.errors import DomainError
from workagent.service import Principal,encoded
from workagent.capabilities import registry,policy,research_adapters as R
from workagent.capabilities.models import ToolGrantV1,CapabilityPin
from workagent.capabilities.broker import CapabilityBroker
from workagent.workspace_file_models import EditWorkspaceFile
from workagent import research


def install(ctx,cv,requests):
    s,p,ws,_,admin=ctx
    q=post(ctx,cv);cap=s.claim_run(p,ws,q.run.id)
    names=list(dict.fromkeys(R.IDS[r.kind] for r in requests))
    ds=[registry.adapters()[n].descriptor for n in names]
    selectors=list({r.model_dump_json():r for req in requests for r in R.input_refs(req)}.values())
    g=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=selectors,effects=['read'],privacy_classes=['public','workspace_private'],egress='public_https',
        expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),g,limits={'search':20,'extraction':20})
    return cap,g,q


def material(url,text):
    raw=('<html>'+text+'</html>').encode()
    return dict(requested_url=url,final_url=url,status='ok',http_status=200,content_type='text/html',title='Fixture',
        fetched_at=now().isoformat(),redirects=[],raw_base64=base64.b64encode(raw).decode(),content_sha256=sha256(raw).hexdigest(),
        text=text,text_sha256=sha256(text.encode()).hexdigest(),extractor_version='fixture-extractor-v1',
        coverage={'body_complete':True,'text_complete':True,'omissions':[]},external_version={'etag':None,'last_modified':None},
        extraction_status='extracted' if text else 'empty',browser_used=False)


def capture_request():
    return R.ResearchCapture(kind='research_capture',url='https://example.com/source',allow_browser=False)


def execute(s,cap,q,req):
    request=call(cap,q,R.IDS[req.kind],req.model_dump(mode='json'),R.input_refs(req))
    obs=CapabilityBroker(s,cap).call(request)
    assert obs.status=='observed',obs.model_dump()
    return obs,request


def finish(ctx,cap,cv):
    s,p,ws,_,_=ctx
    s.complete_conversation_turn(cap,TurnResult(results=[TextResult(text='Controlled mechanism fixture, no live usefulness claim.')]))
    return s.get_conversation(p,ws,cv.id).conversation


def test_versions_claim_conflict_freshness_human_conclusion_and_no_repeat(context,monkeypatch):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1')
    from workagent import public_retrieval
    s,p,ws,_,_=context;cv,file,_=make(context,'Human conclusion remains.')
    req=capture_request();texts=iter(['α😀 supports X.','Evidence contradicts X.','Changed evidence.'])
    monkeypatch.setattr(public_retrieval,'fetch_public_source',lambda url,**kw:material(url,next(texts)),raising=False)
    cap,g,q=install(context,cv,[req]);first,request=execute(s,cap,q,req)
    assert CapabilityBroker(s,cap).call(request)==first
    a=first.output['result']['snapshot']
    other=Principal('research-other-'+new_id())
    with Database(context[4]).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'editor')",(ws,other.id))
    with pytest.raises(DomainError): s.get_source_snapshot(other,ws,a['snapshot_id'])
    second,_=execute(s,cap,q,req);b=second.output['result']['snapshot']
    assert b['parent_snapshot_id']==a['snapshot_id'] and b['workspace_file_id']==a['workspace_file_id']
    assert s.read_workspace_file(p,ws,a['workspace_file_id'],a['snapshot_id'],a['extraction_sha256']).text=='α😀 supports X.'
    cv=finish(context,cap,cv)
    art=s.get_artifact(p,ws,file.workspace_file_id)
    refs=[]
    for snapshot,relation in [(a,'supports'),(b,'contradicts')]:
        text=snapshot['locator']['text']
        refs.append(dict(workspace_file_id=snapshot['workspace_file_id'],snapshot_id=snapshot['snapshot_id'],
            text_sha256=snapshot['extraction_sha256'],start=0,end=len(text),quote=text,relation=relation))
    cite=R.ResearchCite(kind='research_cite',artifact_id=art.id,revision_id=art.current_revision_id,
        body_hash=art.current_revision.body_hash,claim='X is true.',evidence=refs)
    cap,g,q=install(context,cv,[cite,req]);linked,_=execute(s,cap,q,cite)
    assert linked.output['result']['semantic_status']=='conflict'
    assert len(linked.output['result']['evidence'])==2
    execute(s,cap,q,req)
    projection=research.claims(s,p,ws,art.id,art.current_revision_id,art.current_revision.body_hash)
    assert projection.items[0].freshness=='potentially_stale'
    assert s.get_artifact(p,ws,art.id).current_revision.body==art.current_revision.body
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM source_snapshots WHERE workspace_id=%s',(ws,)).fetchone()['n']==3
    with pytest.raises(Exception):
        with s.db.transaction() as c:c.execute("UPDATE source_snapshots SET data='{}' WHERE workspace_id=%s",(ws,))
    with pytest.raises(Exception):
        with s.db.transaction() as c:c.execute('DELETE FROM research_claims WHERE workspace_id=%s',(ws,))


@pytest.mark.parametrize('event',['revoke','cancel','human_edit'])
def test_late_authority_loss_no_publication_or_download(context,monkeypatch,event):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1')
    from workagent import public_retrieval
    s,p,ws,_,admin=context;cv,file,_=make(context,'Human original')
    req=capture_request();cap,g,q=install(context,cv,[req])
    def late(url,**kw):
        if event=='revoke':
            with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
        elif event=='cancel':
            s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
        else:
            new='Human edit wins'
            s.edit_workspace_file(p,ws,file.workspace_file_id,cmd(EditWorkspaceFile,expected_work_version=q.conversation.work_version,
                base_version_id=file.current.version_id,base_sha256=file.current.sha256,content=new,sha256=sha256(new.encode()).hexdigest()))
        return material(url,'late source')
    monkeypatch.setattr(public_retrieval,'fetch_public_source',late,raising=False)
    request=call(cap,q,'research.capture',req.model_dump(),R.input_refs(req))
    obs=CapabilityBroker(s,cap).call(request)
    assert obs.status=='cost_only' and obs.output is None and obs.output_refs==[]
    with s.db.transaction() as c:
        # A human-edit fingerprint may only be detected at settlement, so a
        # quarantined immutable row can exist but must never become visible.
        rows=c.execute("SELECT id FROM source_snapshots WHERE workspace_id=%s",(ws,)).fetchall()
        for row in rows:
            assert not c.execute('SELECT research_source_visible(%s,%s) AS ok',(ws,row['id'])).fetchone()['ok']


def test_unknown_never_replayed_and_cross_scope_hidden(context,monkeypatch):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1')
    from workagent import public_retrieval
    s,p,ws,_,_=context;cv=conversation(context);req=capture_request();cap,g,q=install(context,cv,[req]);calls=[]
    def uncertain(*a,**kw): calls.append(1);raise TimeoutError('synthetic secret must not escape')
    monkeypatch.setattr(public_retrieval,'fetch_public_source',uncertain,raising=False)
    request=call(cap,q,'research.capture',req.model_dump(),R.input_refs(req))
    first=CapabilityBroker(s,cap).call(request)
    assert first.status=='outcome_unknown' and first.output is None
    assert CapabilityBroker(s,cap).call(request)==first and len(calls)==1
    with pytest.raises(DomainError): s.get_source_snapshot(Principal('another-owner'),ws,first.attempt_id)


def test_restricted_sql_rejects_ungranted_query_and_processor(context,monkeypatch):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1')
    from workagent.service import digest
    s,p,ws,_,_=context;cv=conversation(context)
    req=R.ResearchSearch(kind='research_search',query='approved public query')
    cap,g,q=install(context,cv,[req])
    for changed in [req.model_copy(update={'query':'private secret query'}),req]:
        refs=R.input_refs(changed)
        if changed==req: refs=refs[:1]
        forged=call(cap,q,'research.search',changed.model_dump(),refs)
        with pytest.raises(Exception):
            with s.db.transaction() as c:
                c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s)',
                    (ws,cap.run_id,cap.fence,digest(cap.secret),encoded(forged),digest('receipt')))
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE workspace_id=%s AND run_id=%s',(ws,cap.run_id)).fetchone()
