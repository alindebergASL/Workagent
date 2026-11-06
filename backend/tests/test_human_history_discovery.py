"""Real services/routes with a relational in-memory query double; NO PostgreSQL.

The double models predicates/keysets, not PostgreSQL syntax, RLS or locking.
Those require the separately documented restricted-role acceptance proof.
"""
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from hashlib import sha256
from types import SimpleNamespace as NS
from typing import Any
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from workagent.api import create_app, Settings
from workagent.checkpoint_models import CheckpointData
from workagent.errors import DomainError, deny
from workagent.outcomes import project_responsibility_artifacts
from workagent.responsibilities import Responsibilities
from workagent.run_successors import RunSuccessors
from workagent.retained_results import SCHEMA
from workagent.service import Principal, digest

P=Principal('human')


def checkpoint(i, **overrides) -> dict[str,Any]:
    data=CheckpointData(principal_id='human',access_generation=1,run_fence=0,
        conversation_work_version=1,assignment_work_version=None,assignment_fence=None,
        configuration_sha256='0'*64,runtime_sha256='0'*64,scope_fingerprint='0'*64,
        context_sha256=None,intent_message_id='intent',intent_sha256='0'*64,
        latest_human_intent_id='intent',last_observed_phase='final',steps=[],
        pending_proposal_ids=[],waiting='none',next_safe_action='continue_slice')
    row=dict(checkpoint_id=f'cp-{i:04}',workspace_id='ws',conversation_id='cv',
        run_id='run',assignment_id=None,phase='final',checkpoint_kind='settlement',
        created_at=datetime(2026,1,1,tzinfo=timezone.utc)+timedelta(seconds=i//10),
        checkpoint_hash=digest(data),data=data.model_dump(mode='json'))
    row.update(overrides)
    return row


class Rows:
    def __init__(self, rows): self.rows=rows
    def fetchall(self): return self.rows
    def fetchone(self): return self.rows[0] if self.rows else None


class Store:
    def __init__(self, count=137):
        self.outputs={f'art-{i:04}':dict(workspace_id='ws',conversation_id='cv',
            assignment_id=None,binding='assignment',id=f'art-{i:04}',
            current_revision_id=f'rev-{i:04}',title=f'Output {i}') for i in range(count)}
        self.checkpoints=[checkpoint(i) for i in range(count)]
        self.queries=[]
        self.config={'responses':{'continuity_version':'sustained-v1',
            'scope_tool_sha256':sha256(SCHEMA.material).hexdigest()}}

    @contextmanager
    def transaction(self): yield self

    def execute(self, sql, args=()):
        self.queries.append((sql,args))
        assert sql.lstrip().startswith('SELECT'), 'Discovery must not write'
        if 'SELECT a.id FROM artifacts a' in sql:
            ws,aid,original_cid,original,cid,binding,bound_cid,*tail=args
            assert aid==binding and cid==bound_cid==original_cid
            candidates=[r for r in self.outputs.values() if r['workspace_id']==ws and
                (((r['assignment_id']==aid or r['conversation_id']==cid) and r['id'] in original) or
                 (r['conversation_id']==cid and r['binding']==binding))]
            if ' AND a.id=%s' in sql:
                candidates=[r for r in candidates if r['id']==tail[0]]
            else:
                assert 'ORDER BY a.id LIMIT %s' in sql
                candidates=sorted((r for r in candidates if r['id']>tail[0]),key=lambda r:r['id'])[:tail[1]]
            return Rows([{'id':r['id']} for r in candidates])
        if 'FROM run_checkpoints' in sql:
            ws,cid,*tail=args
            rows=[r for r in self.checkpoints if r['workspace_id']==ws and r['conversation_id']==cid]
            if "data->>'principal_id'" in sql:
                principal,generation,*tail=tail
                rows=[r for r in rows if r['data']['principal_id']==principal and r['data']['access_generation']==generation]
            if ' AND checkpoint_id=%s' in sql:
                anchor=tail.pop(0)
                rows=[r for r in rows if r['checkpoint_id']==anchor]
            if '(created_at,checkpoint_id)<' in sql:
                timestamp,anchor,*tail=tail
                rows=[r for r in rows if (r['created_at'],r['checkpoint_id'])<(timestamp,anchor)]
            rows.sort(key=lambda r:(r['created_at'],r['checkpoint_id']),reverse=True)
            if 'LIMIT %s' in sql: rows=rows[:tail[0]]
            elif 'LIMIT 1' in sql: rows=rows[:1]
            return Rows(rows)
        if 'FROM run_configurations' in sql: return Rows([{'data':self.config}])
        if 'FROM run_successors' in sql: return Rows([])
        raise AssertionError(sql)


class ServiceDouble(Responsibilities,RunSuccessors):
    def __init__(self,count=137):
        self.db=Store(count); self.generation=1; self.active=True; self.denied=set()
        self.revision_denied=set(); self.observations=0
        self.assignment=NS(id='assignment',workspace_id='ws',conversation_id='cv',artifact_ids=[])
        self.cv=NS(id='cv',run_ids=['run'])
        self.life=NS(dependencies=[],state='active')
    def _scope(self,c,p,ws,write=False):
        if not self.active or ws!='ws' or p.id!='human': deny()
        return self.generation
    def _conversation(self,c,p,ws,cid):
        if cid!='cv': deny()
        return self.cv
    def _owned_conversation(self,c,p,ws,cid): return self._conversation(c,p,ws,cid)
    def _responsibility_assignment(self,c,p,ws,aid):
        if aid!='assignment': deny()
        return self.assignment,self.cv
    def _lifecycle(self,c,ws,aid): return self.life
    def _responsibility_observations(self,*args): self.observations+=1
    def _artifact(self,c,p,ws,aid):
        if aid in self.denied: deny()
        return self.db.outputs[aid],self.cv
    def _revision(self,c,p,ws,artifact,owner):
        if artifact['id'] in self.revision_denied: raise DomainError('source_unavailable')
        return NS(id=artifact['current_revision_id'],body=NS(title=artifact['title']))


def collect(read,key):
    ids=[];after=None
    while True:
        page=read(after)
        ids.extend(getattr(item,key) for item in page.items)
        assert page.has_more == bool(page.next_after)
        if not page.has_more: break
        assert page.next_after!=after
        assert page.next_after==getattr(page.items[-1],key)
        after=page.next_after
    assert len(set(ids))==len(ids)
    return ids


@pytest.mark.parametrize('limit',[1,17,100])
def test_all_outputs_beyond_100_and_legacy_summary(limit):
    s=ServiceDouble()
    assert collect(lambda after:s.list_responsibility_outputs(P,'ws','assignment',after,limit),'artifact_id')==sorted(s.db.outputs)
    assert s.observations>1
    project_responsibility_artifacts(s,s.db,P,s.assignment)
    assert len(s.assignment.artifact_ids)==100  # only the legacy DTO remains bounded


@pytest.mark.parametrize('limit',[1,19,100])
def test_checkpoint_ties_and_beyond_100(limit):
    s=ServiceDouble()
    ids=collect(lambda after:s.list_run_checkpoints(P,'ws','cv',after,limit),'checkpoint_id')
    assert ids==[r['checkpoint_id'] for r in reversed(s.db.checkpoints)]


def test_denied_candidates_do_not_create_cursor_or_false_has_more():
    s=ServiceDouble(240)
    s.denied={f'art-{i:04}' for i in range(120)}
    s.revision_denied={f'art-{i:04}' for i in range(138,240)}
    ids=collect(lambda after:s.list_responsibility_outputs(P,'ws','assignment',after,7),'artifact_id')
    assert ids==[f'art-{i:04}' for i in range(120,138)]
    assert not s.list_responsibility_outputs(P,'ws','assignment','art-0137').has_more
    assert all(args[-1]<=101 for sql,args in s.db.queries if 'ORDER BY a.id LIMIT' in sql)


@pytest.mark.parametrize('anchor',['missing','art-0000','art-0001','art-0002','art-0003'])
def test_output_anchors_are_current_same_scope_and_non_enumerating(anchor):
    s=ServiceDouble()
    s.denied.add('art-0000');s.revision_denied.add('art-0001')
    s.db.outputs['art-0002']['binding']='other-assignment'
    s.db.outputs['art-0003']['workspace_id']='foreign'
    with pytest.raises(DomainError) as exc:
        s.list_responsibility_outputs(P,'ws','assignment',anchor)
    assert exc.value.code.value=='not_found_or_not_authorized'


@pytest.mark.parametrize('change',['principal','generation','conversation','workspace','missing'])
def test_checkpoint_anchors_are_current_same_scope(change):
    s=ServiceDouble()
    row=s.db.checkpoints[10]
    if change=='principal': row['data']['principal_id']='other'
    elif change=='generation': s.generation=2
    elif change=='conversation': row['conversation_id']='other'
    elif change=='workspace': row['workspace_id']='other'
    else: s.db.checkpoints.remove(row)
    with pytest.raises(DomainError) as exc: s.list_run_checkpoints(P,'ws','cv',row['checkpoint_id'])
    assert exc.value.code.value=='not_found_or_not_authorized'


def test_changes_between_pages_are_live_and_revocation_withdraws_history():
    s=ServiceDouble()
    first=s.list_responsibility_outputs(P,'ws','assignment',limit=10)
    s.db.outputs['art-0010'].update(title='Human revision',current_revision_id='human-revision')
    s.life.state='cancelled'  # authorized history remains readable; no admission
    second=s.list_responsibility_outputs(P,'ws','assignment',first.next_after,10)
    assert second.items[0].title=='Human revision'
    assert second.items[0].revision_id=='human-revision'
    s.revision_denied.add(first.next_after)
    with pytest.raises(DomainError): s.list_responsibility_outputs(P,'ws','assignment',first.next_after)
    s.active=False
    for fn,args in [(s.list_responsibility_outputs,('assignment',)),(s.list_run_checkpoints,('cv',))]:
        with pytest.raises(DomainError): fn(P,'ws',*args)


def test_new_checkpoint_requires_refresh_without_changing_capability_metadata():
    s=ServiceDouble()
    first=s.list_run_checkpoints(P,'ws','cv',limit=10)
    assert first.items[0].continuation_supported
    assert all(cp.continuation_supported for cp in first.items)
    s.db.checkpoints.append(checkpoint(500))
    older=s.list_run_checkpoints(P,'ws','cv',first.next_after,100)
    assert all(cp.continuation_supported for cp in older.items)
    assert s.list_run_checkpoints(P,'ws','cv').items[0].checkpoint_id=='cp-0500'
    # Listing never calls admission, nor changes baseline capability metadata.
    assert not any('FROM runs' in sql for sql,_ in s.db.queries)


@pytest.mark.parametrize('limit',[0,101,True,-1,'10'])
def test_service_bounds_are_per_page_not_lifetime(limit):
    s=ServiceDouble()
    for fn,identifier in [(s.list_responsibility_outputs,'assignment'),(s.list_run_checkpoints,'cv')]:
        with pytest.raises(DomainError) as exc: fn(P,'ws',identifier,limit=limit)
        assert exc.value.code.value=='validation_error'


def test_duplicate_messages_and_foreign_binding_are_not_output_membership():
    s=ServiceDouble(2)
    s.db.outputs['foreign']=dict(s.db.outputs['art-0000'],id='foreign',binding='other')
    # Membership is EXISTS per artifact, not a row per message occurrence.
    page=s.list_responsibility_outputs(P,'ws','assignment')
    assert [item.artifact_id for item in page.items]==['art-0000','art-0001']
    assert any('EXISTS (' in sql for sql,_ in s.db.queries)


def test_original_outputs_remain_members_even_without_new_run_binding():
    s=ServiceDouble(2)
    s.assignment.artifact_ids=['art-0000','art-0001']
    s.db.outputs['art-0000']['binding']='original'
    s.db.outputs['art-0001'].update(binding='original',conversation_id=None,assignment_id='assignment')
    page=s.list_responsibility_outputs(P,'ws','assignment')
    assert [item.artifact_id for item in page.items]==s.assignment.artifact_ids


def test_old_checkpoint_idempotent_success_is_readback_not_new_admission(monkeypatch):
    import workagent.run_successors as module
    s=ServiceDouble()
    cp=s.db.checkpoints[0]
    execute=s.db.execute
    def query(sql,args=()):
        if sql.startswith('SELECT checkpoint_id FROM run_successors'): return Rows([{'checkpoint_id':cp['checkpoint_id']}])
        if 'FROM run_successors' in sql: return Rows([{'successor_run_id':'existing-successor'}])
        if 'FROM runs' in sql: return Rows([{'data':{'saved':'existing-successor'}}])
        return execute(sql,args)
    s.db.execute=query
    validation=Mock(return_value='prior-success')
    monkeypatch.setattr(module.Run,'model_validate',validation)
    result=s._admit_run_successor(s.db,P,'ws',s.cv,cp['checkpoint_id'],cp['checkpoint_hash'])
    assert result=='prior-success'
    validation.assert_called_once_with({'saved':'existing-successor'})
    assert not any('ORDER BY created_at' in sql for sql,_ in s.db.queries)


def test_hash_and_owner_guards_precede_any_successor_admission():
    for change in ['hash','principal']:
        s=ServiceDouble()
        cp=s.db.checkpoints[-1]

        if change=='principal':
            cp['data']['principal_id']='foreign'
            cp['checkpoint_hash']=digest(CheckpointData.model_validate(cp['data']))
        supplied_hash='f'*64 if change=='hash' else cp['checkpoint_hash']
        with pytest.raises(DomainError):
            s._admit_run_successor(s.db,P,'ws',s.cv,cp['checkpoint_id'],supplied_hash)
        assert not any('FROM run_successors' in sql for sql,_ in s.db.queries)


def test_generation_change_refuses_fresh_admission_before_configuration_or_spend(monkeypatch):
    import workagent.run_successors as module
    s=ServiceDouble();s.generation=2
    cp=s.db.checkpoints[-1]
    execute=s.db.execute
    def query(sql,args=()):
        if 'FROM runs' in sql: return Rows([{'data':{}}])
        return execute(sql,args)
    s.db.execute=query
    monkeypatch.setattr(module.Run,'model_validate',lambda data:NS(state='partial',stop_reason='step_limit',fence=0))
    with pytest.raises(DomainError) as exc:
        s._admit_run_successor(s.db,P,'ws',s.cv,cp['checkpoint_id'],cp['checkpoint_hash'])
    assert exc.value.code.value=='source_changed'
    assert not any('FROM run_configurations' in sql for sql,_ in s.db.queries)


@pytest.fixture
def http(monkeypatch):
    from workagent import api
    service=ServiceDouble()
    monkeypatch.setattr(api,'Service',lambda *a,**k:service)
    app=create_app(Settings('unused-no-connection',True,'x'*32,principal_id='human'))
    # No lifespan, connection, runtime-role probe or server: in-process route only.
    client=TestClient(app)
    headers={'Authorization':'Bearer '+'x'*32,'X-Schema-Version':'workagent/v1','X-Request-Id':'test'}
    return client,headers,service


@pytest.mark.parametrize('path,key',[
    ('assignments/assignment/responsibility/outputs','artifact_id'),
    ('conversations/cv/checkpoints','checkpoint_id'),
])
def test_real_routes_deliver_all_pages_and_refuse_invalid_denied_cursors(http,path,key):
    client,headers,service=http
    url='/v1/workspaces/ws/'+path
    ids=[];after=None
    while True:
        r=client.get(url,headers=headers,params={'limit':29,**({'after':after} if after else {})})
        assert r.status_code==200,r.text
        body=r.json();ids.extend(item[key] for item in body['items'])
        assert body['has_more']==bool(body['next_after'])
        if not body['has_more']:break
        after=body['next_after']
    assert len(ids)==137 and len(set(ids))==137
    for params in [{'limit':101},{'limit':0},{'after':'invalid cursor'}]:
        assert client.get(url,headers=headers,params=params).status_code==422
    bad=client.get(url,headers=headers,params={'after':'foreign'})
    assert bad.status_code==404
    assert 'foreign' not in bad.text
    service.active=False
    assert client.get(url,headers=headers).status_code==404
    assert client.get(url,headers={}).status_code==401
