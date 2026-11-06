"""Full native PTY with real keyboard/mouse and exact HTTP readback."""
import json,os,sys,subprocess
from pathlib import Path
ROOT=Path.cwd();BASE=ROOT/'.local/batch3/b35a'
for line in (BASE/'ui.env').read_text().splitlines():
 if line.startswith('export '):k,v=line[7:].split('=',1);os.environ[k]=v
os.environ.update(WORKAGENT_OPERATOR_URL='http://127.0.0.1:18250',WORKAGENT_TUI_DRAFTS=str(BASE/'native-state'),PYTHONPATH=str(ROOT/'backend'))
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'.local/batch3/b31b')]
from pty_driver import Terminal
from workagent.operator_client import OperatorClient
from workagent.tui.session import Session
cols=int(sys.argv[1]);rows=40 if cols==120 else 24;f=next(x for x in json.loads((BASE/'ui-fixture-v2.json').read_text()) if x['label']=='pty'+str(cols));ws=f['workspace_id'];cid=f['conversation_id'];c=OperatorClient();Session(c,ws,c.identity(ws)).select(cid)
out=BASE/'evidence/native';out.mkdir(exist_ok=True);t=Terminal([str(ROOT/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual'],ROOT,dict(os.environ),cols,rows,out/str(cols));actions=[]
def send(keys,pause=.15):actions.append({'keys':keys});t.send(keys);t.pump(pause)
def click(x,y):send(f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m')
def locate(text,scroll=False):
 t.pump(.3)
 for _ in range(50):
  for y,line in enumerate(t.screen.display):
   if text in line:return line.index(text)+2,y+1
  if not scroll:t.pump(.2)
  else:send(f'\x1b[<65;{cols-4};{rows-4}M',.04)
 t.capture('label-failed');raise AssertionError('Absent '+text+'\n'+t.text)
def label(text,scroll=False):click(*locate(text,scroll))
def top():send(f'\x1b[<64;{cols-4};10M'*45,.15)
def read():return c.request('/'+ws+'/memory/'+f['memory_id'])
r={'actual_pty':True,'cols':cols,'rows':rows,'passed':False,'actions':actions}
try:
 t.wait('Enter adds a line.',45);label('Files');t.wait('Memory');label('Memory');t.wait('Authorized memories loaded');t.capture('loaded')
 label('Memories available');label('Use concise synthetic');label('Inspect',True);t.wait('Inspected exact revision');top();t.capture('inspected')
 matches=[(line.index('Use concise synthetic')+2,y+1) for y,line in enumerate(t.screen.display) if 'Use concise synthetic' in line];assert matches;click(*matches[-1]);send('\x1b[1;5F');send(' Human native correction.');label('Correct',True);t.wait('Read back saved state: active');r['corrected']=read();assert r['corrected']['current']['content'].endswith(' Human native correction.');t.capture('corrected')
 label('I intend to forget',True);label('Forget',True);t.wait('Read back saved state: forgotten');r['forgotten']=read();assert all(x['content'] is None for x in r['forgotten']['revisions']);t.capture('forgotten')
 subprocess.run([str(ROOT/'backend/.venv/bin/python'),str(BASE/'ui_actions.py'),'revoke-source',f['label']],env=os.environ,check=True)
 top();label('Refresh');t.wait('Authorized memories loaded');assert 'Revocable synthetic' not in t.text;assert not c.request('/'+ws+'/memory?conversation_id='+cid)['items'];t.capture('revoked-source-readback')
 send('\x1b');send('\x1b');t.pump(.5);label('Status');t.pump(.4);t.capture('status');label('Connections',True);t.wait('Read-only accounts loaded');t.capture('connections');label('Saved connector');send('\x1b[B\r');label('Inspect');t.wait('Verified current status.');label('Revoke locally',True);t.wait('Synthetic library: revoked');t.wait('Provider revocation: failed');t.capture('local-revoke-failed-provider')
 r['human_readback']=json.loads(subprocess.check_output([str(ROOT/'backend/.venv/bin/python'),str(BASE/'ui_actions.py'),'readback',f['label']],env=os.environ,text=True));r['passed']=True
finally:
 t.capture('final');t.close();(out/(str(cols)+'-result.json')).write_text(json.dumps(r,indent=2))
print('Actual full-native correction/forget/revoke PASS',cols,rows)
