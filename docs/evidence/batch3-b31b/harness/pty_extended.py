"""Actual PTY candidate review, source revocation and external forget + HTTP readback."""
import json, os, sys, subprocess
from pathlib import Path
import psycopg
from workagent.db import Database
from workagent.service import Service, Principal
from workagent.models import CreateConversation, new_id
from workagent.memory.models import ProposeMemory, RememberMemory, MemorySource
from test_domain import cmd
from pty_driver import Terminal
from capture_later import capture
root=Path.cwd();proof=root.parent;out=proof/'evidence'/'pty-extended';out.mkdir(exist_ok=True)
f=json.loads((root/'.local/batch3/b31b/ui-fixture.json').read_text());ws=f['workspace_id'];p=Principal('local-human');s=Service(Database())
cv=s.create_conversation(p,ws,cmd(CreateConversation,title='Native review and revocation'))
candidate=s.propose_memory(p,ws,cmd(ProposeMemory,kind='procedure',scope_kind='task',scope_id=cv.id,subject_key='units',predicate_key='check',content='Check units before calculating'))
subprocess.run([str(root/'backend/.venv/bin/python'),'-c','from workagent.operator_client import OperatorClient;from workagent.tui.session import Session;import sys;c=OperatorClient();s=Session(c,sys.argv[1],c.identity(sys.argv[1]));s.select(sys.argv[2])',ws,cv.id],check=True)
t=Terminal([str(root/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual'],root,dict(os.environ),100,45,out/'native')
actions=[]
def send(keys):actions.append(keys);t.send(keys);t.pump(.3)
def click(x,y):send(f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m')
def label(text,scroll=False):
 for _ in range(35):
  for y,line in enumerate(t.screen.display):
   if text in line:click(line.index(text)+2,y+1);return
  if not scroll:break
  send('\x1b[<65;96;41M')
 raise AssertionError('Absent '+text+'\n'+t.text)
def select(text):
 label('Memories available');send('\r');t.wait(text);label(text);label('Inspect');t.wait('Inspected exact revision')
result={'passed':False,'evidence':'actual PTY/API/restricted PG; controlled model context, not live quality'}
try:
 t.wait('Native review and revocation');label('Files');label('Memory');t.wait('Authorized memories loaded')
 label('Current recall');send('\x1b[B');send('\r');t.pump(.8);label('Refresh');t.wait('Authorized memories loaded')
 select('Check units before calculating');t.capture('candidate-inspected');label('Approve candidate',True);t.wait('Read back saved state: active')
 accepted=s.inspect_memory(p,ws,candidate.memory_id).current;assert accepted.status=='active' and accepted.origin=='human_reviewed'
 t.capture('reviewed');before=capture(ws,cv.id,'native-reviewed');assert accepted.revision_id in before['expected_revisions']
 # Current recall view + inspect an active source-derived item.
 source=s.list_sources(p,ws).items[0]
 from workagent.models import SourceRef
 backed=s.remember_memory(p,ws,cmd(RememberMemory,kind='fact',scope_kind='task',scope_id=cv.id,subject_key='source',predicate_key='fact',content='Revocable native secret summary',source_refs=[MemorySource(ref=SourceRef(source_id=source.id,external_version=source.external_version,observed_at=source.observed_at))]))
 label('Candidates to review');send('\x1b[A');send('\r');label('Refresh');t.wait('Authorized memories loaded')
 label('Memories available');send('\r');t.wait('Revocable native secret summary');label('Revocable native secret summary');label('Inspect');t.wait('Inspected exact revision');t.capture('source-inspected')
 with psycopg.connect(os.environ['MIGRATION_DATABASE_URL']) as c:
  c.execute('DELETE FROM source_access WHERE workspace_id=%s AND source_id=%s AND principal_id=%s',(ws,source.id,p.id))
 label('Refresh');t.wait('No inspected memory.');assert 'Revocable native secret summary' not in t.text;t.capture('revocation-cleared')
 # Explicit forget of the reviewed procedure via native UI, then later request excludes it.
 label('Refresh');t.wait('Authorized memories loaded');select('Check units before calculating')
 label('I intend to forget',True);label('Forget',True);t.wait('Read back saved state: forgotten');t.capture('forgotten')
 assert s.inspect_memory(p,ws,candidate.memory_id).current.status=='forgotten'
 after=capture(ws,cv.id,'native-forgotten');assert not after['expected_revisions']
 result.update(passed=True,conversation_id=cv.id,reviewed_revision=accepted.revision_id,source_loss_cleared=True,forgotten_later_manifest_empty=True,before_run=before['run_id'],after_run=after['run_id'])
finally:
 t.capture('final');t.close();result['actions']=actions;(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print('EXTENDED NATIVE PASS')
