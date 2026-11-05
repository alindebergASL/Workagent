"""Narrow installer unit guards; real SQL rollback belongs to product proof."""
from copy import deepcopy
from unittest.mock import patch
import pytest
import amend_gateway_target_rejection as A

class Rows:
    def __init__(self,value):self.value=value
    def fetchall(self):return self.value
    def fetchone(self):return self.value
class Connection:
    def __init__(self,rows,body):self.rows,self.body=rows,body
    def execute(self,q,*args):
        if q.startswith('SELECT name,checksum'):return Rows(self.rows)
        if q.startswith('SELECT pg_get_functiondef'):return Rows({'d':self.body})
        raise AssertionError('unexpected SQL')

def case():
    m={'migration_inventory':{'076_selection_rejection.sql':'old',A.MIGRATION:'new'},'target_guard':{'before':A.digest('before'),'after':A.digest('after')}}
    return m,[{'name':k,'checksum':v} for k,v in sorted(m['migration_inventory'].items())]

@pytest.mark.parametrize('installed',[False,True])
def test_exact_schema_and_guard(installed):
    m,rows=case();assert A.state(Connection(rows if installed else rows[:-1],'after' if installed else 'before'),m) is installed

@pytest.mark.parametrize('fault',['checksum','missing','extra','body'])
def test_schema_or_guard_drift_denied(fault):
    m,rows=case();rows=deepcopy(rows);body='after'
    if fault=='checksum':rows[-1]['checksum']='wrong'
    if fault=='missing':rows=[]
    if fault=='extra':rows.append({'name':'078_unknown.sql','checksum':'wrong'})
    if fault=='body':body='unreviewed'
    with pytest.raises(AssertionError):A.state(Connection(rows,body),m)

def test_environment_only_exact077_mapping():
    name='backend/migrations/'+A.MIGRATION;mounted='/product/migrations/'+A.MIGRATION
    m={'migration_additions':{mounted:name},'files':{name:'bound'}}
    with patch.object(A.AM,'load',lambda:m):
        assert A.AM.environment({'files':{}})=={'files':{mounted:'bound'}}
        from study_controller import Hold
        with pytest.raises(Hold):A.AM.environment({'files':{mounted:'previous'}})
        m['migration_additions'][mounted]='backend/migrations/076_selection_rejection.sql'
        with pytest.raises(Hold):A.AM.environment({'files':{}})


@pytest.fixture
def installer(tmp_path, monkeypatch):
    """Exercise the whole installer, with 12 fake physical connections.

    Real file transition and real preflight state()/identity comparisons; replace
    only PG/external effects. This is installer ordering, not fresh SQL proof.
    """
    import json, sqlite3
    from contextlib import contextmanager
    from types import SimpleNamespace
    import install_recipient_funding as F
    out=tmp_path/'out';out.mkdir()
    campaign=tmp_path/'campaign';campaign.mkdir()
    slot=campaign/'trial';slot.mkdir()
    manifest=tmp_path/'active.json';approval=tmp_path/'approved'
    old={'successor':{},'execution_sources':{}}
    previous=(A.canonical(old)+'\n').encode();pred=A.digest(previous)
    monkeypatch.setattr(A,'ROOT',tmp_path);monkeypatch.setattr(A,'OUT',out)
    monkeypatch.setattr(A,'CAMPAIGN',campaign);monkeypatch.setattr(A,'SLOT',slot)
    monkeypatch.setattr(A,'PREDECESSOR',pred)
    monkeypatch.setattr(A.AM,'MANIFEST',manifest);monkeypatch.setattr(A.AM,'APPROVAL',approval)
    (out/'PREDECESSOR.json').write_bytes(previous)
    m,rows=case();m.update(old)
    before=b'before';after=b'after'
    m.update(files={},application_before_sha256=A.digest(before),application_after_sha256=A.digest(after))
    (out/'application-after.json').write_bytes(after)
    m['schema_continuation']={'journals':{}}
    for name,table in [('controller','operations'),('bridge','receipts')]:
        with sqlite3.connect(campaign/(name+'.sqlite')) as c:
            c.execute('CREATE TABLE '+table+' (id TEXT)')
            m['schema_continuation']['journals'][table]=A.G.logical(c,table)
    raw=(A.canonical(m)+'\n').encode();successor=A.digest(raw)
    (out/'CANDIDATE.json').write_bytes(raw)
    report=tmp_path/'review.md';report.write_text('PASS fixture, not real review')
    review=out/'review.json';review.write_text(json.dumps(dict(verdict='PASS',manifest_sha256=successor,report='review.md',report_sha256=A.digest(report.read_bytes()))))
    plans=[dict(blind_id=str(i),database='store'+str(i),database_oid=100+i) for i in range(12)]
    bindings={p['blind_id']:{'migration_database_url':p['database']} for p in plans}
    s=SimpleNamespace(installed=[False]*12,identity_fault=None,connection_fault=None,identity_calls=[],connection_calls=[],effects=[],applied=[],file_stage=0)
    monkeypatch.setattr(A.G,'exact_targets',lambda *a,**k:(plans,bindings))
    monkeypatch.setattr(F,'mapping',lambda:({p['blind_id']:p for p in plans},bindings))
    def identity(p,b):
        s.identity_calls.append(p['blind_id'])
        assert s.identity_fault!=p['blind_id'],'recipient_oid_drift'
    monkeypatch.setattr(F,'identity',identity)
    class DB:
        def __init__(self,url):self.i=int(url.removeprefix('store'))
        @contextmanager
        def transaction(self):
            i=self.i
            class C:
                def execute(self,q,*args):
                    if q=='SET TRANSACTION READ ONLY':return Rows(None)
                    if q.startswith('SELECT current_database()'):
                        s.connection_calls.append(i)
                        result=dict(name=plans[i]['database'],oid=plans[i]['database_oid'])
                        if s.connection_fault and s.connection_fault[0]==i:result[s.connection_fault[1]]='wrong'
                        return Rows(result)
                    return Connection(rows if s.installed[i] else rows[:-1],'after' if s.installed[i] else 'before').execute(q,*args)
            yield C()
    monkeypatch.setattr(A,'Database',DB)
    def backup(name,path):s.effects.append(('backup',name));path.write_bytes(b'backup')
    def apply(db,m):
        s.effects.append(('apply',db.i))
        if not s.installed[db.i]:s.applied.append(db.i)
        s.installed[db.i]=True
    monkeypatch.setattr(A.G,'backup',backup);monkeypatch.setattr(A,'apply',apply)
    monkeypatch.setattr(A,'preserved',lambda database:{'preserved':'same'})
    real_activate=A.D.activate_files
    def activate(*args):s.effects.append(('activate',));return real_activate(*args)
    monkeypatch.setattr(A.D,'activate_files',activate)
    def load():
        assert manifest.read_bytes()==raw and approval.read_text().strip()==successor
        return json.loads(manifest.read_bytes())
    monkeypatch.setattr(A.AM,'load',load)
    def stage(n):
        (slot/'application.json').write_bytes(before if n==0 else after)
        manifest.write_bytes(previous if n<2 else raw)
        approval.write_text(pred if n<3 else successor)
    stage(0)
    s.stage=stage;s.run=lambda:A.install(review)
    s.bytes=lambda:((slot/'application.json').read_bytes(),manifest.read_bytes(),approval.read_bytes())
    return s


@pytest.mark.parametrize('fault',['recipient','name','oid'])
def test_last_target_identity_mismatch_prevents_all_effects(installer,fault):
    s=installer
    if fault=='recipient':s.identity_fault='11'
    else:s.connection_fault=(11,fault)
    initial=s.bytes()
    with pytest.raises(AssertionError,match='recipient_oid_drift|migration_target_identity_drift'):s.run()
    assert s.identity_calls==[str(i) for i in range(12)]
    assert s.connection_calls==list(range(11 if fault=='recipient' else 12))
    assert s.effects==[] and s.bytes()==initial


@pytest.mark.parametrize('stage',[1,2,3])
@pytest.mark.parametrize('upgraded',[0,11])
def test_advanced_files_with_unupgraded_store_deny_before_effects(installer,stage,upgraded):
    s=installer;s.stage(stage);s.installed[:upgraded]=[True]*upgraded;initial=s.bytes()
    with pytest.raises(AssertionError,match='advanced_files_require_all077'):s.run()
    assert s.connection_calls==list(range(12))
    assert s.effects==[] and s.bytes()==initial


@pytest.mark.parametrize('stage,upgraded',[(0,0),(0,5),(0,12),(1,12),(2,12),(3,12)])
def test_legitimate_partial_install_and_completed_retries(installer,stage,upgraded):
    s=installer;s.stage(stage);s.installed[:upgraded]=[True]*upgraded
    s.run();first=s.bytes()
    assert s.connection_calls==list(range(12))
    assert s.applied==list(range(upgraded,12)) and all(s.installed)
    assert s.effects[-1]==('activate',)
    s.run()
    assert s.bytes()==first and s.applied==list(range(upgraded,12))

