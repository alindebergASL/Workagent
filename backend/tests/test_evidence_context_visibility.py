"""Execute fresh enumeration SQL and frozen hydration; visibility leaves doubled.

SQLite syntax translation only; actual restricted-PG suffix remains parent-owned.
"""
from copy import deepcopy
from datetime import datetime,timezone
import json
import sqlite3
from types import SimpleNamespace as NS
import pytest
from workagent import evidence_context as E
from workagent.errors import DomainError
from workagent.flexible_models import Body
from workagent.service import digest


class Projection:
    def __init__(self):
        self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row
        self.db.executescript('CREATE TABLE artifacts(workspace_id,id,conversation_id,current_revision_id); CREATE TABLE proposals(workspace_id,id,artifact_id,data);')
        self.proposals={};self.artifacts={};self.pvisible={};self.rvisible={};self.allowed=[];self.hydrated=[];self.queries=[];self.race=None
        self.db.create_function('memory_proposal_visible',2,lambda ws,pid:self.pvisible.get(pid,False))
        self.db.create_function('memory_revision_visible',3,lambda ws,aid,rid:self.rvisible.get((aid,rid),False))
        self.time=datetime(2026,1,1,tzinfo=timezone.utc)
        self.cv=NS(id='conversation',owner_id='human',state='open',selected_source_refs=[])
        self.current=NS(target=None,sequence=1,created_at=self.time)
    def add(self,pid,*,proposal_visible=True,base_visible=True,ws='ws',cv='conversation',status='pending',base=None,created=None,allowed=True):
        aid='artifact-'+pid;rid='revision-'+pid
        art=dict(id=aid,conversation_id=cv,current_revision_id=rid)
        self.artifacts[aid]=art
        body=Body(title='Evidence',blocks=[dict(block_id='p',kind='paragraph',text=pid,checked=None)])
        value=NS(id=pid,artifact_id=aid,status=status,base_revision_id=base or rid,created_at=created or self.time,accepted_revision_id=None,source_dependencies=[],body=body,body_hash=digest(body))
        self.proposals[pid]=value;self.pvisible[pid]=proposal_visible;self.rvisible[aid,rid]=base_visible
        self.db.execute('INSERT INTO artifacts VALUES(?,?,?,?)',(ws,aid,cv,rid))
        self.db.execute('INSERT INTO proposals VALUES(?,?,?,?)',(ws,pid,aid,json.dumps(dict(status=status,base_revision_id=value.base_revision_id,created_at=value.created_at.isoformat()))))
        if allowed:self.allowed.append(aid)
    def execute(self,sql,args):
        self.queries.append(sql)
        sql=sql.replace('art.id=ANY(%s)','art.id IN (SELECT value FROM json_each(%s))').replace('::timestamptz','').replace('%s','?')
        return self.db.execute(sql,tuple(json.dumps(a) if isinstance(a,list) else a.isoformat() if isinstance(a,datetime) else a for a in args))
    def _conversation(self,*args):return self.cv
    def _proposal(self,c,p,ws,pid):
        self.hydrated.append(pid)
        if not self.pvisible[pid] or self.race=='proposal':raise DomainError('not_found_or_not_authorized')
        proposal=self.proposals[pid]
        return proposal,self.artifacts[proposal.artifact_id],None
    def _revision(self,c,p,ws,art,scope):
        if not self.rvisible[art['id'],art['current_revision_id']] or self.race=='revision':raise DomainError('not_found_or_not_authorized')
        return NS(body_hash='a'*64)
    def _dependencies(self,*args):pass
    def materialize(self,snapshot=None):
        return E.materialize(self,self,NS(id='human'),NS(workspace_id='ws'),self.cv,self.current,[],{},
            {'work_area_context':{'artifacts':[dict(artifact_id=aid) for aid in self.allowed]}},snapshot)


@pytest.mark.parametrize('leaf',['proposal','current_base'])
def test_hidden_rows_filtered_before_count_limit_and_hydration(leaf):
    p=Projection()
    for i in range(E.MAX_PROPOSALS+1):p.add(f'0-hidden-{i:02}',proposal_visible=leaf!='proposal',base_visible=leaf!='current_base')
    for i in range(E.MAX_PROPOSALS+1):p.add(f'1-visible-{i:02}')
    area=p.materialize()['work_area']
    assert [v['proposal_id'] for v in area['proposals']]==[f'1-visible-{i:02}' for i in range(E.MAX_PROPOSALS)]
    assert area['omitted_proposals']==1 and all('hidden' not in pid for pid in p.hydrated)
    sql=p.queries[0]
    for predicate in ('memory_proposal_visible(pr.workspace_id,pr.id)','memory_revision_visible(art.workspace_id,art.id,art.current_revision_id)'):
        assert sql.index('WHERE')<sql.index(predicate)<sql.index('ORDER BY')<sql.index('LIMIT')


@pytest.mark.parametrize('leaf',['proposal','current_base'])
def test_frozen_references_still_deny_without_refill(leaf):
    p=Projection();p.add('saved');frozen=p.materialize();original=deepcopy(frozen)
    p.add('later');assert p.materialize(frozen)==original
    if leaf=='proposal':p.pvisible['saved']=False
    else:p.rvisible['artifact-saved','revision-saved']=False
    with pytest.raises(DomainError) as caught:p.materialize(frozen)
    assert caught.value.code.value=='not_found_or_not_authorized'
    assert frozen==original and len(p.queries)==1


@pytest.mark.parametrize('race',['proposal','revision'])
def test_hydration_reauthorization_is_not_swallowed(race):
    p=Projection();p.add('saved');p.race=race
    with pytest.raises(DomainError):p.materialize()


def test_existing_scope_status_base_and_creation_bounds_stay_exact():
    from datetime import timedelta
    p=Projection();p.add('valid')
    p.add('foreign-workspace',ws='other');p.add('foreign-conversation',cv='other')
    p.add('outside-allowed',allowed=False);p.add('not-pending',status='dismissed')
    p.add('stale-base',base='old');p.add('future',created=p.time+timedelta(days=1))
    area=p.materialize()['work_area']
    assert [v['proposal_id'] for v in area['proposals']]==['valid'] and area['omitted_proposals']==0
