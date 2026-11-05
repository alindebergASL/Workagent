"""Real enumeration SQL in SQLite; PG visibility functions are explicit row doubles.

This proves query ordering/count/limit and unchanged Python safety, not PG authority.
"""
from copy import deepcopy
import json
import sqlite3
from types import SimpleNamespace as NS
import pytest
from workagent.work_areas import WorkAreas
from workagent.flexible_models import Body
from workagent.errors import DomainError
from workagent.general_responses import exact_target
from workagent.models import ExactTarget


class Projection(WorkAreas):
    def __init__(self):
        self.sql=sqlite3.connect(':memory:');self.sql.row_factory=sqlite3.Row
        self.visible={};self.queries=[];self.hydrated=[];self.race=None
        self.sql.executescript('''
          CREATE TABLE artifacts(workspace_id TEXT,id TEXT,conversation_id TEXT,current_revision_id TEXT);
          CREATE TABLE proposals(workspace_id TEXT,id TEXT,artifact_id TEXT);
          CREATE TABLE workspace_files(workspace_id TEXT,artifact_id TEXT,owner_id TEXT);
          CREATE TABLE assignments(workspace_id TEXT,id TEXT,conversation_id TEXT,responsibility_lifecycle TEXT);
        ''')
        self.sql.create_function('memory_revision_visible',3,lambda ws,aid,rid:self.visible.get(('artifacts',aid),False))
        self.sql.create_function('memory_proposal_visible',2,lambda ws,pid:self.visible.get(('proposals',pid),False))
        self.person=NS(id='human');self.cv=NS(id='conversation',work_version=1,work_area=None)
    def execute(self,sql,args):
        self.queries.append((sql,args))
        sql=sql.replace('id=ANY(%s)','id IN (SELECT value FROM json_each(%s))').replace('%s','?')
        return self.sql.execute(sql,tuple(json.dumps(v) if isinstance(v,list) else v for v in args))
    def artifact(self,aid,visible=True,*,ws='ws',cv='conversation',owner='human'):
        self.sql.execute('INSERT INTO artifacts VALUES (?,?,?,?)',(ws,aid,cv,'revision-'+aid))
        self.sql.execute('INSERT INTO workspace_files VALUES (?,?,?)',(ws,aid,owner));self.visible['artifacts',aid]=visible
    def proposal(self,pid,aid='human',visible=True):
        self.sql.execute('INSERT INTO proposals VALUES (?,?,?)',('ws',pid,aid));self.visible['proposals',pid]=visible
    def project(self,**kw):return self._work_area_context(self,self.person,'ws',self.cv,**kw)
    def _artifact(self,c,p,ws,aid):
        self.hydrated.append(('artifacts',aid))
        return dict(id=aid,conversation_id=self.cv.id,current_revision_id='revision-'+aid),None
    def _cas(self,row,rid):assert row['current_revision_id']==rid
    def _revision(self,c,p,ws,row,scope,rid=None):
        if not self.visible['artifacts',row['id']] or self.race=='revision':raise DomainError('not_found_or_not_authorized')
        return NS(id=row['current_revision_id'],revision_number=1,body_hash='a'*64,author_id='human',author_kind='human',
            body=Body(title='Human',blocks=[dict(block_id='p',kind='paragraph',text='Keep unchanged',checked=None)]))
    def _proposal(self,c,p,ws,pid):
        self.hydrated.append(('proposals',pid))
        if not self.visible['proposals',pid] or self.race=='proposal':raise DomainError('not_found_or_not_authorized')
        aid=self.sql.execute('SELECT artifact_id FROM proposals WHERE id=?',(pid,)).fetchone()[0]
        return NS(id=pid,artifact_id=aid,base_revision_id='revision-'+aid,base_work_version=1,body_hash='b'*64,
            status='pending',accepted_revision_id=None),dict(conversation_id=self.cv.id,current_revision_id='revision-'+aid),None


@pytest.mark.parametrize('table,limit',[('artifacts',12),('proposals',20)])
def test_authorization_precedes_window_count_limit_and_hydration(table,limit):
    p=Projection()
    if table=='proposals':p.artifact('human')
    add=p.artifact if table=='artifacts' else p.proposal
    for i in range(limit+1):add(f'0-hidden-{i:02}',visible=False)
    for i in range(limit+1):add(f'1-visible-{i:02}')
    got=p.project();items=getattr(got,table);key='artifact_id' if table=='artifacts' else 'proposal_id'
    assert [getattr(v,key) for v in items]==[f'1-visible-{i:02}' for i in range(limit)]
    assert getattr(got.omissions,table)==1 and got.truncated
    assert not any('hidden' in value for _,value in p.hydrated)
    query=next(q for q,args in p.queries if 'FROM '+table+' ' in q)
    predicate='memory_revision_visible(artifacts.workspace_id,artifacts.id,artifacts.current_revision_id)' if table=='artifacts' else 'memory_proposal_visible(proposals.workspace_id,proposals.id)'
    assert query.index('WHERE')<query.index(predicate)<query.index('ORDER BY')<query.index('LIMIT')


@pytest.mark.parametrize('table',['artifacts','proposals'])
def test_snapshot_visibility_loss_raises_source_changed_without_replacement(table):
    p=Projection();p.artifact('human');p.proposal('saved')
    snapshot=p.project().model_dump(mode='json');saved=deepcopy(snapshot)
    p.artifact('later');p.proposal('later-proposal')
    assert p.project(snapshot=snapshot).model_dump(mode='json')==saved
    p.visible[table,'human' if table=='artifacts' else 'saved']=False
    with pytest.raises(DomainError) as e:p.project(snapshot=snapshot)
    assert e.value.code.value=='source_changed' and snapshot==saved
    assert not any('later' in str(v) for v in snapshot.values())


@pytest.mark.parametrize('race',['revision','proposal'])
def test_hydration_authority_race_is_not_swallowed(race):
    p=Projection();p.artifact('human');p.proposal('saved');p.race=race
    with pytest.raises(DomainError) as e:p.project()
    assert e.value.code.value=='not_found_or_not_authorized'


def test_scope_owner_and_explicit_hidden_target_still_deny():
    p=Projection();p.artifact('human');p.artifact('other-workspace',ws='outside');p.artifact('other-conversation',cv='outside');p.artifact('other-owner',owner='other')
    assert [r.artifact_id for r in p.project().artifacts]==['human']
    t=ExactTarget(artifact_id='human',revision_id='revision-human',body_hash='a'*64)
    assert exact_target(p,p,p.person,'ws',p.cv,t).body_hash==t.body_hash
    p.visible['artifacts','human']=False
    assert p.project().artifacts==[]
    with pytest.raises(DomainError) as e:exact_target(p,p,p.person,'ws',p.cv,t)
    assert e.value.code.value=='not_found_or_not_authorized'
