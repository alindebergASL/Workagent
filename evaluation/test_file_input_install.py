"""Whole078 installer ordering with fake PG; restored-copy proof is separate."""
import json,sqlite3
from contextlib import contextmanager
from types import SimpleNamespace
from copy import deepcopy
import pytest
import amend_file_input_rejection as A
import install_recipient_funding as F

class Rows:
    def __init__(self,v):self.v=v
    def fetchone(self):return self.v
    def fetchall(self):return self.v

@pytest.fixture
def installer(tmp_path,monkeypatch):
    out=tmp_path/'out';out.mkdir();campaign=tmp_path/'campaign';campaign.mkdir();slot=campaign/'0';slot.mkdir()
    active=tmp_path/'active.json';approval=tmp_path/'approved'
    old={'successor':{},'execution_sources':{'B1':A.digest(A.canonical({}))}}
    previous=(A.canonical(old)+'\n').encode();pred=A.digest(previous)
    for k,v in dict(ROOT=tmp_path,OUT=out,CAMPAIGN=campaign,SLOT=slot,PREDECESSOR=pred,TRIAL='0',SNAPSHOT=tmp_path/'snapshot').items():monkeypatch.setattr(A,k,v)
    monkeypatch.setattr(A,'inventory',lambda _:{});monkeypatch.setattr(A.AM,'MANIFEST',active);monkeypatch.setattr(A.AM,'APPROVAL',approval)
    (out/'PREDECESSOR.json').write_bytes(previous)
    before=b'before';after=b'after';(out/'application-after.json').write_bytes(after)
    m=dict(old,files={},migration_inventory={'077.sql':'old',A.MIGRATION:'new'},sql_definitions={'before':{'old':'hash'},'after':{'new':'hash'}},
      resolution={'proof':'exact'},application_before_sha256=A.digest(before),application_after_sha256=A.digest(after),file_input_continuation={'journals':{}})
    for name,table in [('controller','operations'),('bridge','receipts')]:
        with sqlite3.connect(campaign/(name+'.sqlite')) as c:
            c.execute('CREATE TABLE '+table+'(id text)');m['file_input_continuation']['journals'][table]=A.G.logical(c,table)
    raw=(A.canonical(m)+'\n').encode();successor=A.digest(raw);(out/'CANDIDATE.json').write_bytes(raw)
    report=tmp_path/'report.md';report.write_text('synthetic PASS fixture, not review')
    review=out/'review.json';review.write_text(json.dumps(dict(verdict='PASS',manifest_sha256=successor,report='report.md',report_sha256=A.digest(report.read_bytes()))))
    plans=[dict(blind_id=str(i),database='store'+str(i),database_oid=100+i) for i in range(12)]
    bindings={p['blind_id']:{'migration_database_url':p['database']} for p in plans}
    s=SimpleNamespace(installed=[False]*12,resolved=False,connection_fault=None,identity_fault=None,body_fault=None,effects=[],applied=[],connections=[])
    monkeypatch.setattr(A.G,'exact_targets',lambda *a,**k:(plans,bindings));monkeypatch.setattr(F,'mapping',lambda:({p['blind_id']:p for p in plans},bindings))
    def identity(p,b):assert s.identity_fault!=p['blind_id'],'recipient_oid_drift'
    monkeypatch.setattr(F,'identity',identity)
    class DB:
        def __init__(self,url):self.i=int(url.removeprefix('store'))
        @contextmanager
        def transaction(self):
            i=self.i
            class C:
                index=i
                def execute(self,q,*args):
                    if q=='SET TRANSACTION READ ONLY':return Rows(None)
                    if q.startswith('SELECT current_database()'):
                        s.connections.append(i);v=dict(name=plans[i]['database'],oid=plans[i]['database_oid'])
                        if s.connection_fault and s.connection_fault[0]==i:v[s.connection_fault[1]]='wrong'
                        return Rows(v)
                    if q.startswith('SELECT name,checksum'):
                        rows=[dict(name=k,checksum=v) for k,v in sorted(m['migration_inventory'].items())]
                        return Rows(rows if s.installed[i] else rows[:-1])
                    raise AssertionError(q)
            yield C()
    monkeypatch.setattr(A,'Database',DB)
    monkeypatch.setattr(A,'definitions',lambda c: {'bad':'hash'} if s.body_fault==c.index else m['sql_definitions']['after' if s.installed[c.index] else 'before'])
    monkeypatch.setattr(A,'tables',lambda c:{'kept':'exact'})
    monkeypatch.setattr(A,'resolution',lambda c: {'data':m['resolution']} if s.resolved else None)
    monkeypatch.setattr(A.G,'preserved_rows',lambda _: {'fiscal':'same'})
    def backup(name,path):s.effects.append(('backup',name));path.write_bytes(b'backup')
    def apply(db,m):
        s.effects.append(('apply',db.i))
        if not s.installed[db.i]:s.applied.append(db.i)
        s.installed[db.i]=True
    def resolve(db,m):assert all(s.installed);s.effects.append(('resolve',));s.resolved=True
    monkeypatch.setattr(A.G,'backup',backup);monkeypatch.setattr(A,'apply',apply);monkeypatch.setattr(A,'import_resolution',resolve)
    real=A.D.activate_files
    def activate(*args):assert all(s.installed) and s.resolved;s.effects.append(('activate',));return real(*args)
    monkeypatch.setattr(A.D,'activate_files',activate)
    def load():assert active.read_bytes()==raw and approval.read_text().strip()==successor;return m
    monkeypatch.setattr(A.AM,'load',load)
    def stage(n):
        (slot/'application.json').write_bytes(before if n==0 else after);active.write_bytes(previous if n<2 else raw);approval.write_text(pred if n<3 else successor)
    stage(0);s.stage=stage;s.run=lambda:A.install(review);s.bytes=lambda:((slot/'application.json').read_bytes(),active.read_bytes(),approval.read_bytes())
    return s

@pytest.mark.parametrize('fault',['recipient','name','oid','definition'])
def test_last_target_mismatch_zero_effects(installer,fault):
    s=installer
    if fault=='recipient':s.identity_fault='11'
    elif fault=='definition':s.body_fault=11
    else:s.connection_fault=(11,fault)
    original=s.bytes()
    with pytest.raises(AssertionError):s.run()
    assert s.effects==[] and s.bytes()==original

@pytest.mark.parametrize('stage',[1,2,3])
@pytest.mark.parametrize('installed,resolved',[(11,True),(12,False)])
def test_advanced_files_require_all_schema_and_resolution(installer,stage,installed,resolved):
    s=installer;s.installed[:installed]=[True]*installed;s.resolved=resolved;s.stage(stage);old=s.bytes()
    with pytest.raises(AssertionError,match='advanced_files_require_all078_and_resolution'):s.run()
    assert s.effects==[] and s.bytes()==old

@pytest.mark.parametrize('stage,upgraded,resolved',[(0,0,False),(0,5,False),(0,12,False),(0,12,True),(1,12,True),(2,12,True),(3,12,True)])
def test_partial_and_completed_retries(installer,stage,upgraded,resolved):
    s=installer;s.installed[:upgraded]=[True]*upgraded;s.resolved=resolved;s.stage(stage)
    s.run();first=s.bytes();assert s.connections==list(range(12));assert s.applied==list(range(upgraded,12))
    assert s.effects[-1]==('activate',) and s.resolved
    s.run();assert s.bytes()==first and s.applied==list(range(upgraded,12))

def test_only_exact078_environment_mapping(monkeypatch):
    mounted='/product/migrations/'+A.MIGRATION;rel='backend/migrations/'+A.MIGRATION
    m={'migration_additions':{mounted:rel},'files':{rel:'bound'}};monkeypatch.setattr(A.AM,'load',lambda:m)
    assert A.AM.environment({'files':{}})=={'files':{mounted:'bound'}}
    from study_controller import Hold
    with pytest.raises(Hold):A.AM.environment({'files':{mounted:'old'}})
    m['migration_additions'][mounted]='backend/migrations/077_gateway_target_rejection.sql'
    with pytest.raises(Hold):A.AM.environment({'files':{}})

@pytest.mark.parametrize('fault',[None,'before','after','prior','source','origin'])
def test_retained_source_chain_mapping(fault):
    path=A.OUT/'CANDIDATE.json'
    if not path.exists():pytest.skip('prepare exact candidate before source-chain test')
    m=json.loads(path.read_bytes());t=m['file_input_continuation']
    if fault in ['before','after']:t['product_delta']['general_responses.py'][fault]='0'*64
    elif fault=='prior':t['predecessor_sha256']='0'*64
    elif fault=='source':m['files']['backend/workagent/general_responses.py']='0'*64
    elif fault=='origin':m['successor']['product_delta']['general_responses.py']['after']='0'*64
    if fault is None:assert len(A.G.exact_targets(m,source_amendment=m)[0])==12
    else:
        with pytest.raises(AssertionError):A.G.exact_targets(m,source_amendment=m)
