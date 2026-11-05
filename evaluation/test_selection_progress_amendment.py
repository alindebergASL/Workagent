"""Narrow source-only all-target preflight/order controls; no real effects."""
from contextlib import contextmanager
from types import SimpleNamespace
import json
import pytest
import amend_selection_progress as P
import install_recipient_funding as I

@pytest.mark.parametrize('fault',[None,'identity','connection','schema','resolution'])
def test_every_actual_target_before_source_activation(tmp_path,monkeypatch,fault):
    plans=[dict(blind_id=str(i),database='store'+str(i),database_oid=100+i) for i in range(12)]
    bindings={p['blind_id']:{'migration_database_url':p['database']} for p in plans};seen=[];effects=[]
    monkeypatch.setattr(P,'OUT',tmp_path);monkeypatch.setattr(P,'TRIAL','11')
    m={'resolution':{'exact':'resolution'}};(tmp_path/'CANDIDATE.json').write_text(json.dumps(m))
    monkeypatch.setattr(P.G,'exact_targets',lambda *a,**k:(plans,bindings))
    def identity(p,b):
        seen.append(('identity',p['blind_id']));assert not(fault=='identity' and p['blind_id']=='11')
    monkeypatch.setattr(I,'identity',identity)
    class DB:
        def __init__(self,url):self.index=int(url.removeprefix('store'))
        @contextmanager
        def transaction(self):yield SimpleNamespace(index=self.index,execute=lambda *a:None)
    monkeypatch.setattr(P.A,'Database',DB)
    def connected(c,p):
        seen.append(('connection',c.index));assert not(fault=='connection' and c.index==11)
    monkeypatch.setattr(P.A,'connected',connected)
    monkeypatch.setattr(P.A,'state',lambda c,m:not(fault=='schema' and c.index==11))
    monkeypatch.setattr(P.A,'resolution',lambda c:dict(data={} if fault=='resolution' else m['resolution']))
    monkeypatch.setattr(P.F,'activate',lambda review:effects.append(('shared_exact_activation',review)))
    if fault:
        with pytest.raises(AssertionError):P.activate(tmp_path/'review')
        assert effects==[]
    else:
        P.activate(tmp_path/'review');assert len(effects)==1
        assert [s[1] for s in seen if s[0]=='connection']==list(range(12))

def test_shared_activation_retains_review_and_journal_guards():
    # This wrapper delegates the real implementation, rather than reimplementing
    # or relaxing its exact-review / file-state protocol.
    import inspect
    source=inspect.getsource(P.activate)
    assert 'F.activate(review)' in source and source.index('targets(m)')<source.index('F.activate(review)')
