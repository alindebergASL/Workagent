"""Synthetic installer boundary/fault probes; no database or provider effects."""
from contextlib import contextmanager
from copy import deepcopy
from types import SimpleNamespace
import json
import pytest
import amend_gateway_recovery as G

@pytest.fixture
def boundary(tmp_path,monkeypatch):
    monkeypatch.setattr(G,'ROOT',tmp_path);monkeypatch.setattr(G,'OUT',tmp_path/'live')
    G.OUT.mkdir();(tmp_path/'backend/migrations').mkdir(parents=True)
    (tmp_path/'backend/migrations/074_prior.sql').write_text('prior')
    (tmp_path/'backend/migrations'/G.MIGRATION).write_text('reviewed075')
    (G.OUT/'plans').write_text('exact plans');(G.OUT/'bindings').write_text('exact bindings')
    m={'authority_files':{n:G.digest((G.OUT/n).read_bytes()) for n in ['plans','bindings']},
       'migration_inventory':{p.name:G.digest(p.read_bytes()) for p in (tmp_path/'backend/migrations').glob('*.sql')}}
    plans={str(i):dict(database='db'+str(i),database_oid=i) for i in range(12)}
    bindings={str(i):dict(migration_database_url='postgresql://not-used/db'+str(i)) for i in range(12)}
    import install_recipient_funding as I
    monkeypatch.setattr(I,'mapping',lambda:(plans,bindings))
    return m,plans,bindings

@pytest.mark.parametrize('fault',['empty','subset','duplicate_oid','wrong_database','mapping_bytes','extra_migration'])
def test_preflight_denies_before_effects(boundary,monkeypatch,fault):
    m,p,b=boundary
    if fault=='empty':p.clear();b.clear()
    elif fault=='subset':p.pop('0');b.pop('0')
    elif fault=='duplicate_oid':p['0']['database_oid']=p['1']['database_oid']
    elif fault=='wrong_database':b['0']['migration_database_url']='postgresql://not-used/unintended'
    elif fault=='mapping_bytes':(G.OUT/'bindings').write_text('drift')
    elif fault=='extra_migration':(G.ROOT/'backend/migrations/076_unreviewed.sql').write_text('never execute')
    monkeypatch.setattr(G.subprocess,'run',lambda *a,**k:pytest.fail('side effect before preflight'))
    with pytest.raises(AssertionError):G.exact_targets(m)

def test_exact_twelve(boundary):
    m,_,_=boundary;p,b=G.exact_targets(m);assert len(p)==len(b)==12

class DB:
    def __init__(self,rows):self.rows=rows;self.calls=[]
    @contextmanager
    def transaction(self):yield self
    def execute(self,sql,args=None):self.calls.append((sql,args));return self
    def fetchall(self):return self.rows

@pytest.mark.parametrize('fault',['older','changed_checksum','extra'])
def test_only_exact_prefix_migrates(boundary,fault):
    m,_,_=boundary;rows=[dict(name=n,checksum=h) for n,h in sorted(m['migration_inventory'].items())][:-1]
    if fault=='older':rows=[]
    elif fault=='changed_checksum':rows[0]['checksum']='wrong'
    else:rows.append(dict(name='076_wrong.sql',checksum='wrong'))
    db=DB(rows)
    with pytest.raises(AssertionError):G.apply075(db,m)
    assert all(s.startswith('SELECT ') for s,_ in db.calls)

def test_applies_only075_or_is_idempotent(boundary):
    m,_,_=boundary;rows=[dict(name=n,checksum=h) for n,h in sorted(m['migration_inventory'].items())]
    db=DB(rows[:-1]);G.apply075(db,m)
    assert [s for s,_ in db.calls if not s.startswith('SELECT ')]==['reviewed075','INSERT INTO schema_migrations(name,checksum) VALUES (%s,%s)']
    db=DB(rows);G.apply075(db,m);assert all(s.startswith('SELECT ') for s,_ in db.calls)

def test_partial_dump_preserved_and_retry_is_exact(tmp_path,monkeypatch):
    dump=tmp_path/'db.before075.dump';old=tmp_path/'db.before075.partial';old.write_bytes(b'partial historical bytes')
    calls=[]
    def run(argv,**kw):
        calls.append(argv)
        if 'pg_dump' in argv:kw['stdout'].write(b'synthetic-dump-fixture')
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(G.subprocess,'run',run)
    G.backup('synthetic',dump);G.backup('synthetic',dump)
    assert sum('pg_dump' in a for a in calls)==1 and old.read_bytes()==b'partial historical bytes'
    dump.write_bytes(b'changed')
    with pytest.raises(AssertionError):G.backup('synthetic',dump)

def test_application_artifacts_resume_without_overwriting(tmp_path):
    for name in ['before.json','after.json','application.next']:
        path=tmp_path/name;G.exact_bytes(path,b'exact');G.exact_bytes(path,b'exact')
        with pytest.raises(AssertionError):G.exact_bytes(path,b'changed')
        assert path.read_bytes()==b'exact'

def test_hold_review_never_activates(tmp_path,monkeypatch):
    manifest=tmp_path/'manifest.json';manifest.write_text('{}');monkeypatch.setattr(G.AM,'MANIFEST',manifest)
    review=tmp_path/'review.json';review.write_text(json.dumps(dict(verdict='HOLD',manifest_sha256=G.digest(manifest.read_bytes()))))
    monkeypatch.setattr(G,'exact_targets',lambda m:pytest.fail('HOLD must deny before preflight'))
    with pytest.raises(AssertionError,match='exact_PASS_required'):G.install(review,G.digest(manifest.read_bytes()))
