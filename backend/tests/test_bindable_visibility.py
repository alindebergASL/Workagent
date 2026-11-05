"""Execute the production bindable query; SQLite visibility leaves are doubles.

This tests enumeration/order, not PostgreSQL authorization. The separate PG case
uses ordinary publication, memory provenance and source-access revocation.
"""
import ast
import json
from pathlib import Path
import sqlite3
from types import SimpleNamespace as NS
import pytest


def query_code():
    source=Path(__file__).parents[1]/'workagent/conversations.py'
    tree=ast.parse(source.read_text())
    method=next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=='_materialize_general_context')
    assignments=[n for n in ast.walk(method) if isinstance(n,ast.Assign)]
    permitted=next(n for n in assignments if ast.unparse(n.targets[0])=='permitted')
    bindables=next(n for n in assignments if ast.unparse(n.targets[0])=="context['bindable_artifacts']")
    return compile(ast.fix_missing_locations(ast.Module(body=[permitted,bindables],type_ignores=[])),str(source),'exec')


class Query:
    def __init__(self):
        self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row
        self.db.executescript('CREATE TABLE artifacts(workspace_id,id,conversation_id,current_revision_id); CREATE TABLE revisions(workspace_id,artifact_id,id,data);')
        self.visible={};self.calls=[]
        self.db.create_function('memory_revision_visible',3,lambda ws,aid,rid:self.visible[ws,aid,rid])
    def add(self,aid,*,body='blocks',visible=True,ws='ws',cv='cv'):
        rid='revision-'+aid;self.visible[ws,aid,rid]=visible
        data={'body_hash':'hash-'+aid,'body':{'title':'title-'+aid}}
        if body=='blocks':data['body']['blocks']=[]
        else:data['body']['kind']=body
        self.db.execute('INSERT INTO artifacts VALUES(?,?,?,?)',(ws,aid,cv,rid))
        self.db.execute('INSERT INTO revisions VALUES(?,?,?,?)',(ws,aid,rid,json.dumps(data)))
    def execute(self,sql,args):
        self.calls.append((sql,args))
        sql=sql.replace('art.id=ANY(%s)','art.id IN (SELECT value FROM json_each(%s))')
        sql=sql.replace("rev.data->'body' ? 'blocks'","json_type(rev.data,'$.body.blocks') IS NOT NULL")
        sql=sql.replace('::text[]','').replace('%s','?')
        rows=self.db.execute(sql,tuple(json.dumps(v) if isinstance(v,list) else v for v in args)).fetchall()
        return NS(fetchall=lambda:[dict(r)|{'data':json.loads(r['data'])} for r in rows])
    def project(self,config=None,exclude=()):
        scope=dict(c=self,run=NS(workspace_id='ws'),cv=NS(id='cv'),context={},config=config or {},exclude_artifacts=exclude)
        exec(query_code(),scope)
        return scope['context']['bindable_artifacts']


def responsibility(ids):
    return {'responsibility':{'observations':[{'kind':'artifact_revision','object_id':aid} for aid in ids]}}


@pytest.mark.parametrize('body',['blocks','structured_table'])
def test_hidden_and_nonpermitted_metadata_filtered_before_limit(body):
    q=Query()
    for i in range(21):q.add(f'0-hidden-{i:02}',body=body,visible=False)
    for i in range(21):q.add(f'1-nonpermitted-{i:02}',body=body)
    q.add('2-visible',body=body)
    allowed=[f'0-hidden-{i:02}' for i in range(21)]+['2-visible']
    result=q.project(responsibility(allowed))
    assert result==[dict(artifact_id='2-visible',revision_id='revision-2-visible',body_hash='hash-2-visible',title='title-2-visible')]
    sql,args=q.calls[-1]
    assert sql.index('memory_revision_visible')<sql.index('ORDER BY')<sql.index('LIMIT 20')
    assert sql.index('art.id=ANY(%s)',sql.index('memory_revision_visible'))<sql.index('LIMIT 20')
    assert args[-1]==args[-2]==sorted(allowed)


@pytest.mark.parametrize('config',[{}, {'responsibility':None}, {'responsibility':{}}])
def test_nonresponsibility_preserves_twenty_visible_slots(config):
    q=Query()
    for i in range(21):q.add(f'0-hidden-{i:02}',visible=False)
    for i in range(21):q.add(f'1-visible-{i:02}')
    assert [r['artifact_id'] for r in q.project(config)]==[f'1-visible-{i:02}' for i in range(20)]
    assert q.calls[-1][1][-2:]==(None,None)


def test_empty_responsibility_and_nonartifact_observations_authorize_no_rows():
    q=Query();q.add('visible')
    assert q.project(responsibility([]))==[]
    assert q.project({'responsibility':{'observations':[{'kind':'source','object_id':'visible'}]}})==[]
    assert q.calls[-1][1][-2:]==([],[])


def test_workspace_conversation_body_and_exclusions_unchanged():
    q=Query();q.add('ok');q.add('foreign-ws',ws='other');q.add('foreign-cv',cv='other')
    q.add('file',body='file');q.add('own')
    assert [r['artifact_id'] for r in q.project(exclude=['own'])]==['ok']
