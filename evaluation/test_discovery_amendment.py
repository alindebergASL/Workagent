"""No SQL/provider effects; exact filesystem activation crash boundaries."""
import pytest
import amend_discovery_continuation as A

@pytest.fixture
def setup(tmp_path,monkeypatch):
    monkeypatch.setattr(A,'OUT',tmp_path)
    monkeypatch.setattr(A.AM,'MANIFEST',tmp_path/'manifest.json')
    monkeypatch.setattr(A.AM,'APPROVAL',tmp_path/'approved.sha256')
    old=b'old manifest';new=b'new manifest';before=b'old application';after=b'new application'
    monkeypatch.setattr(A,'PREDECESSOR',A.digest(old))
    A.AM.MANIFEST.write_bytes(old);A.AM.APPROVAL.write_text(A.digest(old)+'\n')
    path=tmp_path/'application.json';path.write_bytes(before)
    (tmp_path/'application-after.json').write_bytes(after)
    return path,new,{'application_before_sha256':A.digest(before),'application_after_sha256':A.digest(after)}

@pytest.mark.parametrize('boundary',['application','manifest','approval'])
def test_interrupt_resume_and_idempotency(setup,boundary):
    path,raw,m=setup
    def fault(stage):
        if stage==boundary:raise InterruptedError(stage)
    with pytest.raises(InterruptedError):A.activate_files(path,raw,m,fault)
    if boundary!='approval':assert A.AM.APPROVAL.read_text().strip()==A.PREDECESSOR
    A.activate_files(path,raw,m)
    A.activate_files(path,raw,m)
    assert A.digest(path.read_bytes())==m['application_after_sha256']
    assert A.AM.MANIFEST.read_bytes()==raw
    assert A.AM.APPROVAL.read_text().strip()==A.digest(raw)


def test_replacement_tamper_denied_before_any_write(setup):
    path,raw,m=setup;before=[p.read_bytes() for p in (path,A.AM.MANIFEST,A.AM.APPROVAL)]
    (A.OUT/'application-after.json').write_bytes(b'tamper')
    with pytest.raises(AssertionError,match='replacement_application_drift'):A.activate_files(path,raw,m)
    assert before==[p.read_bytes() for p in (path,A.AM.MANIFEST,A.AM.APPROVAL)]

@pytest.mark.parametrize('target',['application','manifest','approval'])
def test_arbitrary_partial_state_denied(setup,target):
    path,raw,m=setup
    paths={'application':path,'manifest':A.AM.MANIFEST,'approval':A.AM.APPROVAL}
    paths[target].write_bytes(b'tamper')
    before=[p.read_bytes() for p in paths.values()]
    with pytest.raises(AssertionError,match='unrecognized_activation_state'):A.activate_files(path,raw,m)
    assert before==[p.read_bytes() for p in paths.values()]


def test_premature_marker_not_repaired_into_authority(setup):
    path,raw,m=setup;A.AM.APPROVAL.write_text(A.digest(raw)+'\n')
    with pytest.raises(AssertionError,match='unrecognized_activation_state'):A.activate_files(path,raw,m)
