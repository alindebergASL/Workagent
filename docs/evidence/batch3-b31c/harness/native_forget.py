"""Fresh native client after forget: visible nonappearance plus scoped HTTP read."""
import json,os,sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'.local/batch3/b31b'))
from pty_driver import Terminal
from workagent.operator_client import OperatorClient
from workagent.tui.session import Session
root=Path.cwd();proof=root.parent;f=json.loads((proof/'fixture.json').read_text());c=OperatorClient();ws=f['workspace_id'];Session(c,ws,c.identity(ws)).select(f['forgotten'])
t=Terminal([str(root/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual'],root,dict(os.environ),80,35,proof/'evidence/pty/forgotten80')
def click_label(text):
 for y,line in enumerate(t.screen.display):
  if text in line:
   x=line.index(text)+2;t.send(f'\x1b[<0;{x};{y+1}M\x1b[<0;{x};{y+1}m');t.pump(.5);return
 raise AssertionError(text+'\n'+t.text)
try:
 t.pump(3);click_label('Files');click_label('Memory');t.wait('Authorized memories loaded',25);t.capture('nonappearance')
 assert 'For this duration study' not in t.text and not c.request('/'+ws+'/memory?conversation_id='+f['forgotten'])['items']
 (proof/'evidence/pty/forgotten80-result.json').write_text(json.dumps(dict(passed=True,pid=t.child.pid,conversation_id=f['forgotten'],lesson_absent=True,size=[80,35]),indent=2))
finally:t.close()
print('FORGET ACTUAL PTY PASS')
