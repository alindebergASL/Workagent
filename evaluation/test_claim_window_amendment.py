"""New source wrapper preflight controls; mock effects explicitly scoped."""
from contextlib import contextmanager
from types import SimpleNamespace
import json
import pytest
import amend_claim_window as P

@pytest.mark.parametrize('fault',[None,'uninstalled079','descriptor','pending','target_identity'])
def test_claim_source_preflight_before_activation(tmp_path,monkeypatch,fault):
    plans=[dict(blind_id=str(i)) for i in range(12)]
    bindings={str(i):{'migration_database_url':str(i)} for i in range(12)}
    (tmp_path/'CANDIDATE.json').write_text('{}')
    monkeypatch.setattr(P,'OUT',tmp_path);monkeypatch.setattr(P,'TRIAL','11')
    effects=[];seen=[]
    def targets(m):
        if fault=='target_identity':raise AssertionError('actual target denied')
        return plans,bindings,[i!=11 or fault!='uninstalled079' for i in range(12)]
    monkeypatch.setattr(P.T,'targets',targets)
    import workagent.capabilities.registry as R
    monkeypatch.setattr(R,'adapters',lambda:{'test':SimpleNamespace(descriptor=SimpleNamespace(id='test',implementation_sha256='exact'))})
    class Connection:
        def __init__(self,index):self.index=index
        def execute(self,sql):
            if sql=='SET TRANSACTION READ ONLY':return None
            assert sql=='SELECT data FROM tool_grants'
            return SimpleNamespace(fetchall=lambda:[{'data':{'capabilities':[dict(id='test',implementation_sha256='drift' if fault=='descriptor' and self.index==11 else 'exact')]}}])
    class DB:
        def __init__(self,url):self.index=int(url)
        @contextmanager
        def transaction(self):
            seen.append(self.index);yield Connection(self.index)
    monkeypatch.setattr(P.T,'Database',DB)
    def pending(db):
        assert db.index==11
        if fault=='pending':raise AssertionError('original run changed')
    monkeypatch.setattr(P,'pending',pending)
    monkeypatch.setattr(P.F,'activate',lambda review:effects.append(review))
    if fault:
        with pytest.raises(AssertionError):P.activate(tmp_path/'review.json')
        assert not effects
    else:
        P.activate(tmp_path/'review.json');assert seen==list(range(12)) and len(effects)==1

def test_unmodified_shared_review_journal_file_guards_are_delegated():
    import inspect
    source=inspect.getsource(P.activate)
    assert source.index('targets(m)')<source.index('F.activate(review)')
    assert P.PREDECESSOR=='9fe9b041ccdb370d99d4fec2985265748f8324cf7ed557e0c8d754510d6112fd'
