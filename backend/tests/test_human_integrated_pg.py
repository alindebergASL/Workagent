"""Real owned PostgreSQL proof. No providers, worker loops, or network servers.
Admin is used only for fixture seeding/mutations; every observation uses runtime.
"""
import json
import os
from pathlib import Path
import secrets

import pytest
from fastapi.testclient import TestClient
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_memory_pg import remember
from workagent.api import create_app, Settings
from workagent.db import Database
from workagent.models import new_id, now
from workagent.service import encoded, digest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
from workagent.service import Principal
from workagent.memory.models import CorrectMemory, MemorySource

ART = Path(os.environ.get('HUMAN_PG_ARTIFACTS', '/home/ubuntu/human-integrated-pg-artifacts'))


def http(ctx, principal=None):
    s,p,ws,_,_=ctx
    token=secrets.token_urlsafe(32)
    client=TestClient(create_app(Settings(s.db.dsn, True, token, principal or p.id)))
    client.headers.update({'Authorization':'Bearer '+token, 'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()})
    return client  # no lifespan/background worker; service uses actual DB


def walk(client, route, params, key, *, cursor_key='cursor', next_key='next_cursor'):
    items=[]; cursor=None; pages=0
    while True:
        response=client.get(route,params={**params,**({cursor_key:cursor} if cursor else {})})
        assert response.status_code==200,response.text
        page=response.json();pages+=1
        assert len(page['items'])<=params['limit']
        items.extend(page['items'])
        assert page['has_more']==bool(page[next_key])
        if not page['has_more']:break
        assert page[next_key]!=cursor
        cursor=page[next_key]
        assert pages<300
    ids=[key(i) for i in items]
    assert len(ids)==len(set(ids))
    return items


def test_10_memory_and_evidence_beyond_limits(context):
    s,p,ws,refs,admin=context; cv=conversation(context)
    memories=[]
    for i in range(57):
        m,_=remember(context,cv,subject_key=f'pref-{i:03}',content=f'Human memory {i}: '+('long detail. '*80),
            source_refs=[MemorySource(ref=refs[0])] if i%11==0 else [])
        memories.append(m)
    q=post(context,cv,'Original human evidence')
    expected_evidence=[q.message.id]
    cv=q.conversation
    from workagent.models import ConversationMessage
    class TiedMessage(ConversationMessage):
        created_at: datetime = datetime(2026,1,1,tzinfo=timezone.utc)
    for i in range(56):
        with patch('workagent.conversations.ConversationMessage',TiedMessage):
            q=post(context,cv,f'Evidence {i} '+('complete detail '*80))
        cv=q.conversation
        expected_evidence.append(q.message.id)
    root=f'/v1/workspaces/{ws}/memory'
    with http(context) as client:
        for limit in (7,50):
            found=walk(client,root+'/discovery',{'conversation_id':cv.id,'limit':limit},lambda i:i['memory_id'])
            assert [i['memory_id'] for i in found]==sorted(m.memory_id for m in memories)
            evidence=walk(client,root+'/lesson-evidence',{'conversation_id':cv.id,'limit':limit},lambda i:(i['evidence']['kind'],i['evidence']['event_id']))
            assert {i['evidence']['event_id'] for i in evidence}==set(expected_evidence)
            assert [i['evidence']['event_id'] for i in evidence[1:]]==sorted(expected_evidence[1:])
        late=found[-1]
        response=client.get(root+'/discovery/'+late['memory_id'],params={'conversation_id':cv.id,'revision_id':late['revision_id']})
        assert response.status_code==200 and len(response.json()['revision']['content'])>240
        ev=evidence[-1]['evidence']
        response=client.get(root+'/lesson-evidence/'+ev['kind']+'/'+ev['event_id'],params={'conversation_id':cv.id,'sha256':ev['sha256']})
        assert response.status_code==200 and len(response.json()['data']['text'])>240
        assert client.get(root+'/lesson-evidence/'+ev['kind']+'/'+ev['event_id'],params={'conversation_id':cv.id,'sha256':'0'*64}).status_code==409
        # Add one actual local tool observation, walking a mixed-kind >50 set.
        from test_capability_gateway import setup as tool_setup
        from workagent.capabilities.broker import CapabilityBroker
        cap,grant,call,_=tool_setup(context,cv=cv,q=q)
        observation=CapabilityBroker(s,cap).call(call)
        mixed=walk(client,root+'/lesson-evidence',{'conversation_id':cv.id,'limit':7},lambda i:(i['evidence']['kind'],i['evidence']['event_id']))
        assert len(mixed)==len(expected_evidence)+1
        assert sum(i['evidence']['kind']=='tool_observation' for i in mixed)==1
        tool=next(i['evidence'] for i in mixed if i['evidence']['kind']=='tool_observation')
        assert tool['sha256']==digest(observation)
        tool_route=root+'/lesson-evidence/tool_observation/'+tool['event_id']
        assert client.get(tool_route,params={'conversation_id':cv.id,'sha256':tool['sha256']}).status_code==200
        tool_cursor='tool_observation:'+tool['event_id']
        assert client.get(root+'/lesson-evidence',params={'conversation_id':cv.id,'cursor':tool_cursor}).status_code==200
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(grant.id,))
        assert client.get(root+'/lesson-evidence',params={'conversation_id':cv.id,'cursor':tool_cursor}).status_code==409
        assert client.get(tool_route,params={'conversation_id':cv.id,'sha256':tool['sha256']}).status_code==404
        # The memory cursor binds effective revisions, not stale summaries.
        first=client.get(root+'/discovery',params={'conversation_id':cv.id,'limit':7}).json()
        m=memories[-1]
        s.correct_memory(p,ws,m.memory_id,cmd(CorrectMemory,expected_revision_id=m.revision_id,content='Human corrected current content'))
        assert client.get(root+'/discovery',params={'conversation_id':cv.id,'cursor':first['next_cursor']}).status_code==409
        # Source-denied items disappear before has_more/count, and direct detail refuses.
        with Database(admin).transaction() as c:
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',(ws,p.id,refs[0].source_id))
        found=walk(client,root+'/discovery',{'conversation_id':cv.id,'limit':13},lambda i:i['memory_id'])
        assert {i['memory_id'] for i in found}=={m.memory_id for i,m in enumerate(memories) if i%11}
        denied=memories[0]
        assert client.get(root+'/discovery/'+denied.memory_id,params={'conversation_id':cv.id,'revision_id':denied.revision_id}).status_code==404
        cursor=client.get(root+'/lesson-evidence',params={'conversation_id':cv.id,'limit':7}).json()['next_cursor']
        with Database(admin).transaction() as c:
            c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
            c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
        assert client.get(root+'/lesson-evidence',params={'conversation_id':cv.id,'cursor':cursor}).status_code==404
    (ART/'memory-large.json').write_text(json.dumps({'passed':True,'memory_count':len(memories),'human_evidence_count':len(expected_evidence),'mixed_evidence_count':len(mixed),'tool_cursor_revoked':True,'page_sizes':[7,50],'source_denied_count':sum(i%11==0 for i in range(57))},indent=2)+'\n')


def test_20_checkpoint_history_beyond_100(context):
    from workagent.run_checkpoints import record
    s,p,ws,refs,admin=context;cv=conversation(context,refs[:1]);expected=[]
    phases=['selection']+[f'selection_{i}' for i in range(2,9)]+['final','stop']
    positions=[(phase,kind) for phase in phases for kind in ['stage','publication','responsibility','stop']]
    # Genuine canonical hashes/FKs/triggers, synthetic history snapshots only.
    # No provider grants, provider receipts, or dispatch is needed for discovery.
    for batch in range(4):
        cv=s.get_conversation(p,ws,cv.id).conversation
        q=post(context,cv,f'Synthetic history intent {batch}');cv=q.conversation
        with s.db.transaction() as c:
            s._scope(c,p,ws,write=True)
            run=q.run
            for phase,kind in positions[:min(35,137-len(expected))]:
                with patch('workagent.run_checkpoints.now',return_value=datetime(2026,1,1,tzinfo=timezone.utc)+timedelta(seconds=batch)):
                    cp=record(s,c,run,cv,phase,kind)
                expected.append(cp)
    root=f'/v1/workspaces/{ws}/conversations/{cv.id}/checkpoints'
    from workagent.checkpoint_models import ContinueRun
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,'history-peer','editor')",(ws,))
        c.execute('INSERT INTO source_access(workspace_id,principal_id,source_id) VALUES (%s,%s,%s)',(ws,'history-peer',refs[0].source_id))
    with http(context,'history-peer') as peer:
        page=peer.get(root);assert page.status_code==404
        assert peer.get(root,params={'after':expected[0].checkpoint_id}).status_code==404
        direct=cmd(ContinueRun,expected_work_version=cv.work_version,checkpoint_id=expected[-1].checkpoint_id,checkpoint_hash=expected[-1].checkpoint_hash)
        assert peer.post(root.removesuffix('/checkpoints')+'/continue',json=direct.model_dump(mode='json')).status_code==404
    ordered=[cp.checkpoint_id for cp in sorted(expected,key=lambda cp:(cp.created_at,cp.checkpoint_id),reverse=True)]
    with http(context) as client:
        for limit in (17,100):
            items=walk(client,root,{'limit':limit},lambda i:i['checkpoint_id'],cursor_key='after',next_key='next_after')
            assert [i['checkpoint_id'] for i in items]==ordered
            assert all(not i['continuation_supported'] for i in items)
        first=client.get(root,params={'limit':17}).json()
        assert first['has_more']
        # Wrong conversation anchor, same current owner.
        other=conversation(context)
        wrong=f'/v1/workspaces/{ws}/conversations/{other.id}/checkpoints'
        assert client.get(wrong,params={'after':first['next_after']}).status_code==404
        with Database(admin).transaction() as c:
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',(ws,p.id,refs[0].source_id))
        assert client.get(root,params={'after':first['next_after']}).status_code==404
        with Database(admin).transaction() as c:
            c.execute('UPDATE source_access SET active=true WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',(ws,p.id,refs[0].source_id))
            c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
        assert client.get(root,params={'after':first['next_after']}).status_code==404
        assert client.get(root).json()['items']==[]
    with http(context,'outsider') as client:assert client.get(root).status_code==404
    with s.db.transaction() as c:
        rows=c.execute('SELECT checkpoint_id,checkpoint_hash,data FROM run_checkpoints WHERE workspace_id=%s AND conversation_id=%s',(ws,cv.id)).fetchall()
        assert {r['checkpoint_id']:r['checkpoint_hash'] for r in rows}=={cp.checkpoint_id:cp.checkpoint_hash for cp in expected}
        assert all(digest(r['data'])==r['checkpoint_hash'] for r in rows)
        assert c.execute('SELECT count(*) AS n FROM provider_attempts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
    (ART/'history-large.json').write_text(json.dumps({'passed':True,'checkpoint_count':len(expected),'runs':4,'page_sizes':[17,100],'timestamp_ties':True,'source_denial':True,'generation_revocation':True},indent=2)+'\n')


def test_30_mixed_responsibility_outputs_over_100(context,tmp_path):
    from test_sustained_continuity import setup, draft
    from test_general_alpha_runtime import AlphaProvider
    from test_responsibility_execution import dispatch, admitted
    from test_adaptive_execution import finish_safe_visits
    from workagent.models import Revision, HumanSave
    from workagent.responsibility_models import ControlResponsibility
    from workagent.errors import DomainError
    s,p,ws,refs,admin=context
    # Entire provider protocol is in-process httpx.MockTransport, never a provider
    # connection. Grant and synthetic receipts exist only in this new fixture DB.
    cv,art,a,g,life=setup(context)
    fake=AlphaProvider([draft('Bound one'),draft('Bound two'),{'kind':'reply','text':'Synthetic drafts, not external outcomes.'}])
    d,fake,w=dispatch(context,tmp_path,g,fake)
    d.once()
    if fake.failures:raise fake.failures[0]
    runs=admitted(s,ws);assert len(runs)==1
    assert finish_safe_visits(context,w,runs[0]['run_id']).state=='ready'
    with s.db.transaction() as c:
        row=c.execute('SELECT data FROM assignments WHERE workspace_id=%s AND id=%s',(ws,a.id)).fetchone()
        assert row['data']['artifact_ids']==[]
    root=f'/v1/workspaces/{ws}/assignments/{a.id}/responsibility/outputs'
    # Small complete positive+negative output vertical before adding larger fixtures.
    with http(context) as client:
        first=client.get(root,params={'limit':1})
        assert first.status_code==200,first.text
        bound=walk(client,root,{'limit':1},lambda i:i['artifact_id'],cursor_key='after',next_key='next_after')
        assert len(bound)==2
        assert client.get(root,params={'after':new_id()}).status_code==404
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,'other-member','editor')",(ws,))
    # Source-free conversation artifacts are intentionally shared with members;
    # owner-only fences apply to memories/checkpoints, not shared output reads.
    with http(context,'other-member') as client:assert client.get(root).status_code==200
    with http(context,'outsider') as client:assert client.get(root).status_code==404
    # Fixture-only original outputs: 50 assignment-owned + 50 conversation-owned.
    # Canonical revisions, foreign keys and all immutable/admission triggers stay enabled.
    originals=[];all_revisions={};source_backed=[]
    with Database(admin).transaction() as c:
        for i in range(100):
            aid=f'original-{i:03}-'+new_id();rid=new_id()
            body=art.current_revision.body.model_copy(update={'title':f'Original {i:03}'})
            rev=Revision(id=rid,artifact_id=aid,revision_number=1,parent_revision_id=None,author_id=p.id,
                author_kind='human',body=body,body_hash=digest(body),source_dependencies=[refs[0]] if i in (0,17,98,99) else [])
            c.execute('INSERT INTO artifacts(workspace_id,id,assignment_id,conversation_id,current_revision_id) VALUES (%s,%s,%s,%s,%s)',
                (ws,aid,a.id if i%2==0 else None,cv.id if i%2 else None,rid))
            c.execute('INSERT INTO revisions(workspace_id,artifact_id,id,revision_number,parent_revision_id,data) VALUES (%s,%s,%s,1,NULL,%s)',(ws,aid,rid,encoded(rev)))
            originals.append(aid);all_revisions[aid]=rid
            if rev.source_dependencies:source_backed.append(aid)
        data={**row['data'],'artifact_ids':originals,'selected_source_refs':[refs[0].model_dump(mode='json')]}
        c.execute('UPDATE assignments SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(data),ws,a.id))
        c.execute("UPDATE conversations SET data=jsonb_set(data,'{selected_source_refs}',%s::jsonb) WHERE workspace_id=%s AND id=%s",(encoded([refs[0].model_dump(mode='json')]),ws,cv.id))
        c.execute('INSERT INTO assignment_sources(workspace_id,assignment_id,source_id) VALUES (%s,%s,%s)',(ws,a.id,refs[0].source_id))
        c.execute('INSERT INTO conversation_sources(workspace_id,conversation_id,source_id) VALUES (%s,%s,%s)',(ws,cv.id,refs[0].source_id))
    expected=sorted(originals+[i['artifact_id'] for i in bound])
    with http(context) as client:
        for limit in (1,25,100):
            items=walk(client,root,{'limit':limit},lambda i:i['artifact_id'],cursor_key='after',next_key='next_after')
            assert [i['artifact_id'] for i in items]==expected
        # Current-revision discovery follows a human save, without altering history.
        target=s.get_artifact(p,ws,originals[42])
        body=target.current_revision.body.model_copy(update={'title':'Current human title'})
        saved=s.human_save(p,ws,target.id,cmd(HumanSave,expected_current_revision_id=target.current_revision_id,body=body))
        current=walk(client,root,{'limit':25},lambda i:i['artifact_id'],cursor_key='after',next_key='next_after')
        item=next(i for i in current if i['artifact_id']==target.id)
        assert item['revision_id']==saved.current_revision_id and item['title']=='Current human title'
        assert saved.current_revision_id!=all_revisions[target.id]
        # Authorized anchor becomes source-denied: direct anchor and detail refuse.
        # Revoke a source selected by the whole owning scope. All output reads,
        # including already-issued anchors and direct artifact reads, must deny.
        with Database(admin).transaction() as c:
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',(ws,p.id,refs[0].source_id))
        assert client.get(root,params={'after':source_backed[0]}).status_code==404
        assert client.get(root).status_code==404
        assert client.get(f'/v1/workspaces/{ws}/artifacts/{source_backed[0]}').status_code==404
        with Database(admin).transaction() as c:
            c.execute('UPDATE source_access SET active=true WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',(ws,p.id,refs[0].source_id))
        remaining=walk(client,root,{'limit':25},lambda i:i['artifact_id'],cursor_key='after',next_key='next_after')
        assert [i['artifact_id'] for i in remaining]==expected
        # Read-only history remains after cancellation; no continuation/admission.
        state=s.get_responsibility(p,ws,a.id)
        s.control_responsibility(p,ws,a.id,cmd(ControlResponsibility,expected_work_version=state.assignment.work_version,operation='cancel'))
        cancelled=walk(client,root,{'limit':25},lambda i:i['artifact_id'],cursor_key='after',next_key='next_after')
        assert cancelled==remaining
        with Database(admin).transaction() as c:c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
        assert client.get(root,params={'after':remaining[0]['artifact_id']}).status_code==404
    with s.db.transaction() as c:
        for aid,rid in all_revisions.items():
            assert c.execute('SELECT id FROM revisions WHERE workspace_id=%s AND artifact_id=%s AND id=%s',(ws,aid,rid)).fetchone()['id']==rid
        assert c.execute('SELECT count(*) AS n FROM provider_attempts WHERE workspace_id=%s AND evidence_origin<>%s',(ws,'synthetic_provider_receipt')).fetchone()['n']==0
    (ART/'outputs-large.json').write_text(json.dumps({'passed':True,'output_count':len(expected),'original_assignment_owned':50,'original_conversation_owned':50,'bound_published_outputs':len(bound),'source_dependency_output_count':len(source_backed),'scope_revocation_denies_all':True,'page_sizes':[1,25,100],'external_provider_calls':0,'synthetic_protocol_calls':len(fake.calls),'guards_disabled':False},indent=2)+'\n')


def test_00_small_memory_evidence_vertical(context):
    s,p,ws,refs,admin=context
    cv=conversation(context)
    receipt,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])])
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,'memory-peer','editor')",(ws,))
        c.execute('INSERT INTO source_access(workspace_id,principal_id,source_id) VALUES (%s,%s,%s)',(ws,'memory-peer',refs[0].source_id))
    with http(context,'memory-peer') as peer:
        direct=f'/v1/workspaces/{ws}/memory/discovery/{receipt.memory_id}'
        assert peer.get(direct,params={'conversation_id':cv.id,'revision_id':receipt.revision_id}).status_code==404
        assert peer.get(f'/v1/workspaces/{ws}/memory/{receipt.memory_id}').status_code==404
    post(context,cv,'Human correction: preserve exact text.')
    root=f'/v1/workspaces/{ws}/memory'
    with http(context) as client:
        page=client.get(root+'/discovery',params={'conversation_id':cv.id,'limit':1})
        assert page.status_code==200,page.text
        item=page.json()['items'][0]
        detail=client.get(root+'/discovery/'+item['memory_id'],params={'conversation_id':cv.id,'revision_id':item['revision_id']})
        assert detail.status_code==200,detail.text
        assert detail.json()['revision']['content']=='Use concise headings'
        evidence=client.get(root+'/lesson-evidence',params={'conversation_id':cv.id,'limit':1})
        assert evidence.status_code==200,evidence.text
        ev=evidence.json()['items'][0]['evidence']
        response=client.get(root+'/lesson-evidence/'+ev['kind']+'/'+ev['event_id'],params={'conversation_id':cv.id,'sha256':ev['sha256']})
        assert response.status_code==200,response.text
        changed=s.correct_memory(p,ws,receipt.memory_id,cmd(CorrectMemory,expected_revision_id=receipt.revision_id,content='Keep exact human revision.'))
        assert changed.revision_id!=receipt.revision_id
        stale=client.get(root+'/discovery/'+item['memory_id'],params={'conversation_id':cv.id,'revision_id':item['revision_id']})
        assert stale.status_code!=200
        with Database(admin).transaction() as c:
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s',(ws,p.id,refs[0].source_id))
        assert client.get(root+'/discovery',params={'conversation_id':cv.id}).json()['items']==[]
        denied=client.get(root+'/discovery/'+item['memory_id'],params={'conversation_id':cv.id,'revision_id':changed.revision_id})
        assert denied.status_code==404,denied.text
    with http(context,'outsider') as client:
        assert client.get(root+'/discovery',params={'conversation_id':cv.id}).status_code==404
        assert client.get(root+'/lesson-evidence',params={'conversation_id':cv.id}).status_code==404
    with s.db.transaction() as c:
        s._scope(c,p,ws)
        role=c.execute("SELECT r.rolsuper,r.rolbypassrls,pg_get_userbyid(d.datdba)=current_user AS owns_db FROM pg_roles r,pg_database d WHERE r.rolname=current_user AND d.datname=current_database()").fetchone()
        tables=c.execute("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY(%s) ORDER BY relname",(['memory_items','memory_revisions','conversation_messages','artifacts','run_checkpoints'],)).fetchall()
        rls_active=c.execute("SELECT row_security_active('memory_items') AS memory_items,row_security_active('run_checkpoints') AS run_checkpoints,row_security_active('artifacts') AS artifacts").fetchone()
        policy_count=c.execute("SELECT count(*) AS n FROM pg_policies WHERE schemaname='public'").fetchone()['n']
        assert not any(role.values())
        assert c.execute('SELECT count(*) AS n FROM provider_attempts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
    (ART/'small-vertical.json').write_text(json.dumps({'passed':True,'runtime_role':role,'rls_catalog':tables,'rls_active':rls_active,'public_policy_count':policy_count,'literal_rls_requirement_satisfied':all(rls_active.values()),'note':'RLS flags reported, not assumed. HTTP/service authorization is separately tested.'},indent=2)+'\n')
