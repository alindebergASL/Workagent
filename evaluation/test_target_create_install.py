"""079 integration boundaries: mocks are not SQL proof; lineage checks are real files."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json
import pytest
import amend_target_create_rejection as T
import install_recipient_funding as I

@pytest.mark.parametrize('fault',[None,'identity','connection','schema','resolution'])
def test_all_actual_targets(fault,monkeypatch):
 plans=[dict(blind_id=str(i),database='store'+str(i),database_oid=100+i) for i in range(12)]
 bindings={p['blind_id']:{'migration_database_url':p['database']} for p in plans};seen=[]
 monkeypatch.setattr(T,'TRIAL','11');monkeypatch.setattr(T.G,'exact_targets',lambda *a,**kw:(plans,bindings))
 def identity(p,b):assert not(fault=='identity' and p['blind_id']=='11')
 monkeypatch.setattr(I,'identity',identity)
 class DB:
  def __init__(self,url):self.index=int(url.removeprefix('store'))
  @contextmanager
  def transaction(self):yield SimpleNamespace(index=self.index,execute=lambda *a:None)
 monkeypatch.setattr(T,'Database',DB)
 def connected(c,p):
  seen.append(c.index);assert not(fault=='connection' and c.index==11)
 monkeypatch.setattr(T.A,'connected',connected)
 def state(c,m):assert not(fault=='schema' and c.index==11);return False
 monkeypatch.setattr(T,'state',state)
 monkeypatch.setattr(T.A,'resolution',lambda c:dict(data={} if fault=='resolution' else {'exact':True}))
 if fault:
  with pytest.raises(AssertionError):T.targets({'resolution':{'exact':True}})
 else:
  assert T.targets({'resolution':{'exact':True}})[2]==[False]*12
  assert seen==list(range(12))

@pytest.mark.parametrize('position',[0,1,2,3])
@pytest.mark.parametrize('complete',[False,True])
def test_advanced_files_require_all079(tmp_path,monkeypatch,position,complete):
 monkeypatch.setattr(T,'OUT',tmp_path);monkeypatch.setattr(T,'SLOT',tmp_path)
 monkeypatch.setattr(T.AM,'MANIFEST',tmp_path/'manifest');monkeypatch.setattr(T.AM,'APPROVAL',tmp_path/'approved')
 raw=b'candidate';old=b'predecessor';before=b'oldapp';after=b'newapp'
 monkeypatch.setattr(T,'PREDECESSOR',T.digest(old));m={'application_before_sha256':T.digest(before),'application_after_sha256':T.digest(after)}
 (tmp_path/'application-after.json').write_bytes(after)
 (tmp_path/'application.json').write_bytes(before if position==0 else after)
 (tmp_path/'manifest').write_bytes(old if position<2 else raw)
 (tmp_path/'approved').write_text(T.digest(old if position<3 else raw))
 states=[True]*11+[complete]
 if position and not complete:
  with pytest.raises(AssertionError,match='advanced_files_require_all079'):T.file_state(m,raw,states)
 else:T.file_state(m,raw,states)

@pytest.mark.parametrize('fault',[None,'link_hash','before','after','snapshot','old_transition','current_pin','predecessor_bytes'])
def test_exact_source_chain(fault):
 m=json.loads((T.OUT/'CANDIDATE.json').read_bytes());link=m['target_create_continuation']
 if fault=='link_hash':link['predecessor_sha256']='0'*64
 if fault in ('before','after'):link['product_delta']['adaptive.py'][fault]='0'*64
 if fault=='snapshot':link['historical_snapshot']=m['file_input_continuation']['historical_snapshot']
 if fault=='old_transition':m['file_input_continuation']['predecessor_sha256']='0'*64
 if fault=='current_pin':m['files']['backend/workagent/general_responses.py']='0'*64
 original=Path.read_bytes
 def read(p):
  raw=original(p)
  if fault=='predecessor_bytes' and p==T.ROOT/link['predecessor_manifest']:return raw+b' '
  return raw
 with patch.object(Path,'read_bytes',read),patch.object(T.AM,'load',lambda:m):
  if fault:
   with pytest.raises(AssertionError):T.lineage(m);I.mapping(source_amendment=m)
  else:
   T.lineage(m)
   plans,bindings=I.mapping(source_amendment=m);assert len(plans)==len(bindings)==12
