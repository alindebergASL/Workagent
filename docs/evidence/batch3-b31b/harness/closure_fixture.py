"""Bounded synthetic fixture actions; env stays on the approved EC2."""
import json, os, sys, subprocess
from pathlib import Path
from workagent.db import Database
from workagent.fixture import seed
from workagent.service import Service, Principal
from workagent.models import CreateConversation, CreateWorkArea, SourceRef, new_id
from workagent.memory.models import RememberMemory, BindMemoryScope, NarrowMemory, CorrectMemory, MemorySource
from test_domain import cmd
root=Path.cwd(); out=root.parent/'evidence/closure';out.mkdir(exist_ok=True)
p=Principal('local-human');s=Service(Database())
if sys.argv[1]=='setup':
 ws='b31b-closure-'+new_id();seed(os.environ['MIGRATION_DATABASE_URL'],json.loads((root/'fixtures/actor/solo-v0.1/initial_records.json').read_text()),ws,p.id)
 source=s.list_sources(p,ws).items[0];ref=SourceRef(source_id=source.id,external_version=source.external_version,observed_at=source.observed_at)
 cv=s.create_conversation(p,ws,cmd(CreateConversation,title='Closure partial history'))
 area=s.create_work_area(p,ws,cmd(CreateWorkArea,title='Revocable history area',goal='Bounded history privacy',kind='project',selected_source_refs=[ref]))
 s.bind_memory_scope(p,ws,cmd(BindMemoryScope,conversation_id=cv.id,work_area_id=area.id,expected_work_version=cv.work_version))
 old=s.remember_memory(p,ws,cmd(RememberMemory,kind='fact',scope_kind='work_area',scope_id=area.id,subject_key='history',predicate_key='value',content='Historical area-only payload'))
 narrow=s.narrow_memory(p,ws,old.memory_id,cmd(NarrowMemory,expected_revision_id=old.revision_id,scope_kind='task',scope_id=cv.id))
 current=s.correct_memory(p,ws,old.memory_id,cmd(CorrectMemory,expected_revision_id=narrow.revision_id,content='Current allowed task payload'))
 denycv=s.create_conversation(p,ws,cmd(CreateConversation,title='Closure denied browser'))
 denied=s.remember_memory(p,ws,cmd(RememberMemory,kind='fact',scope_kind='task',scope_id=denycv.id,subject_key='denied',predicate_key='value',content='Revocable browser payload',source_refs=[MemorySource(ref=ref)]))
 f=dict(workspace_id=ws,source_id=source.id,conversation_id=cv.id,memory_id=old.memory_id,old_revision=old.revision_id,current_revision=current.revision_id,denied_conversation=denycv.id,denied_memory=denied.memory_id)
 (out/'fixture.json').write_text(json.dumps(f,indent=2));print('Seeded fresh closure fixture')
elif sys.argv[1]=='revoke':
 f=json.loads((out/'fixture.json').read_text())
 with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s AND principal_id=%s',(f['workspace_id'],f['source_id'],p.id))
 print('Revoked only fresh synthetic source access')
elif sys.argv[1]=='native':
 from pty_driver import Terminal
 f=json.loads((out/'fixture.json').read_text());ws=f['workspace_id'];cid=f['conversation_id']
 subprocess.run([str(root/'backend/.venv/bin/python'),'-c','from workagent.operator_client import OperatorClient;from workagent.tui.session import Session;import sys;c=OperatorClient();s=Session(c,sys.argv[1],c.identity(sys.argv[1]));s.select(sys.argv[2])',ws,cid],check=True)
 t=Terminal([str(root/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual'],root,dict(os.environ),100,45,out/'history')
 def label(text):
  for y,line in enumerate(t.screen.display):
   if text in line:
    x=line.index(text)+2;t.send(f'\x1b[<0;{x};{y+1}M\x1b[<0;{x};{y+1}m');t.pump(.3);return
  raise AssertionError('Missing rendered '+text+'\n'+t.text)
 result={'passed':False,'mode':'actual PTY + HTTP + restricted PG'}
 try:
  t.wait('Closure partial history');label('Files');label('Memory');t.wait('Authorized memories loaded');label('Memories available');t.send('\r');t.wait('Current allowed task payload');label('Current allowed task payload');label('Inspect');t.wait('Inspected exact revision');t.capture('before')
  before=s.inspect_memory(p,ws,f['memory_id']);assert any(r.revision_id==f['old_revision'] for r in before.revisions)
  # Wait for browser denial case to perform this same scoped revocation.
  subprocess.run([str(root/'backend/.venv/bin/python'),str(Path(__file__)), 'revoke'],check=True)
  after=s.inspect_memory(p,ws,f['memory_id']);assert after.current.revision_id==f['current_revision'];assert f['old_revision'] not in [r.revision_id for r in after.revisions]
  label('Refresh');t.wait('No inspected memory.');assert 'Current allowed task payload' not in t.text;t.capture('cleared')
  label('Refresh');t.wait('Authorized memories loaded');label('Memories available');t.send('\r');t.wait('Current allowed task payload');label('Current allowed task payload');label('Inspect');t.wait('Inspected exact revision');t.capture('reinspected')
  result.update(passed=True,current_remains_authorized=True,historical_revision_removed=True,selection_cleared=True,explicit_reinspect_succeeds=True,before_revisions=[r.revision_id for r in before.revisions],after_revisions=[r.revision_id for r in after.revisions])
 finally:t.close();(out/'native-result.json').write_text(json.dumps(result,indent=2))
 print('PARTIAL HISTORY PTY PASS')
