"""Task-local explicit candidate transition; no provider/installed SQL effects."""
import json
import pytest
import study_source_amendment as A
from study_controller import Hold
from observe_live_study import visit_evidence

@pytest.fixture
def amendment(tmp_path,monkeypatch):
    monkeypatch.setattr(A,'ROOT',tmp_path)
    monkeypatch.setattr(A,'MANIFEST',tmp_path/'manifest.json')
    monkeypatch.setattr(A,'APPROVAL',tmp_path/'approved.sha256')
    f=tmp_path/'candidate.py';f.write_text('exact candidate')
    m=dict(name=A.NAME,scope=dict(trajectories=12,episodes=72),files={'candidate.py':A.digest(f.read_bytes())},
        historical_sources={'B1':'old'},execution_sources={'B1':'new'},
        bindings={'controller':{'before':A.digest('before'),'after':A.digest('after')}},migration_additions={})
    A.MANIFEST.write_text(A.canonical(m))
    return m,f

def approve(m):
    A.MANIFEST.write_text(A.canonical(m));A.APPROVAL.write_text(A.digest(A.MANIFEST.read_bytes()))

def test_no_implicit_approval(amendment):
    m,_=amendment
    assert A.load() is None and A.sources({'B1':'old'})=={'B1':'old'}
    with pytest.raises(Hold):A.accept_binding('controller','before','after')

def test_exact_scope_files_and_predecessor(amendment):
    m,f=amendment;approve(m)
    assert A.accept_binding('controller','before','after')==A.NAME
    assert A.sources({'B1':'old'})=={'B1':'new'}
    for old,new in [('different','after'),('before','different')]:
        with pytest.raises(Hold):A.accept_binding('controller',old,new)
    with pytest.raises(Hold):A.sources({'B1':'unexpected'})
    f.write_text('drift')
    with pytest.raises(Hold):A.load()

def test_approval_hash_and_scope_denial(amendment):
    m,_=amendment;approve(m);A.MANIFEST.write_text(A.canonical(dict(m,name='other')))
    with pytest.raises(Hold):A.load()
    m['scope']['episodes']=1;approve(m)
    with pytest.raises(Hold):A.load()

def test_open_identity_not_recreated(amendment):
    m,_=amendment;approve(m)
    old=dict(variant='B1',blind_id='exact',source_manifest_sha256='old')
    new=dict(old,source_manifest_sha256='new')
    assert A.opened_payload(old,new)==old
    with pytest.raises(Hold):A.opened_payload(old,dict(new,blind_id='substitution'))
    with pytest.raises(Hold):A.opened_payload(dict(old,source_manifest_sha256='wrong'),new)

def test_migration_scope_cannot_expand(amendment):
    m,_=amendment;m['migration_additions']={'/other':'candidate.py'};approve(m)
    with pytest.raises(Hold):A.environment({'files':{}})

@pytest.mark.parametrize('stdout',['','not-json','[]'])
def test_failed_worker_receipt_never_masks_error(tmp_path,stdout):
    path=tmp_path/'worker-0.stdout';path.write_text(stdout)
    stderr=path.with_suffix('.stderr');stderr.write_text('actual failure')
    with pytest.raises(RuntimeError,match='original worker failure'):
        try:raise RuntimeError('original worker failure')
        finally:
            evidence=visit_evidence(path)
            assert evidence['evidence_level']=='failed_worker_visit_no_receipt'
            assert 'state' not in evidence and evidence['stderr_sha256']==A.digest(stderr.read_bytes())
    assert path.read_text()==stdout and stderr.read_text()=='actual failure'
