"""Actual native PTY + real HTTP journey; no offscreen widget calls."""
import json, os, sys, subprocess
from pathlib import Path
from pty_driver import Terminal
root=Path(__file__).resolve().parent; cwd=root.parents[2]
f=json.loads((root/'ui-fixture.json').read_text()); cols,rows=map(int,sys.argv[1:3]);label='pty'+str(cols)
subprocess.run([str(cwd/'backend/.venv/bin/python'),'-c',
 'from workagent.operator_client import OperatorClient;from workagent.tui.session import Session;import sys;c=OperatorClient();s=Session(c,sys.argv[1],c.identity(sys.argv[1]));s.select(sys.argv[2])',
 f['workspace_id'],f['conversations'][label]],check=True)
out=root/'pty-evidence';out.mkdir(exist_ok=True);actions=[]
t=Terminal([str(cwd/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',f['workspace_id'],'textual'],cwd,dict(os.environ),cols,rows,out/label)
def send(keys,seconds=.35):
 actions.append(dict(keys=keys));t.send(keys);t.pump(seconds)
def click(x,y):send(f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m')
def label_click(text,scroll=False,last=False):
 for _ in range(35):
  lines=list(enumerate(t.screen.display))
  for y,line in reversed(lines) if last else lines:
   if text in line:
    click(line.index(text)+2,y+1);return
  if not scroll:break
  send(f'\x1b[<65;{cols-4};{rows-4}M',.15)
 t.capture('label-failed');raise AssertionError('Label absent '+text+'\n'+t.text)
def wait(s):t.wait(s,35)
def cap(s):t.capture(s)
result=dict(evidence='actual PTY + HTTP + restricted PG',size=[cols,rows],actions=actions,pass_=False)
try:
 wait('Later '+label);t.pump(1)
 send('Unsent native composer '+label+' preserve me');cap('composer')
 # Files is an ordinary tab in the conversation shell, not a separate dashboard.
 label_click('Files');label_click('Memory');wait('Authorized memories loaded');cap('memory-open')
 label_click('Memories available');send('\r');wait('Native concise headings '+label);label_click('Native concise headings '+label);label_click('Inspect');wait('Inspected exact revision');cap('inspected')
 label_click('Native concise headings '+label,scroll=True,last=True)
 send('\x05');send(' corrected by human');cap('typed');label_click('Correct',scroll=True);wait('Read back saved state: active');cap('corrected')
 from workagent.operator_client import OperatorClient
 client=OperatorClient();mid=f['memories'][label]['memory_id'];ws=f['workspace_id']
 detail=client.request('/'+ws+'/memory/'+mid)
 assert detail['current']['content']=='Native concise headings '+label+' corrected by human',detail
 result['corrected_revision']=detail['current']['revision_id']
 label_click('I intend to forget',scroll=True);label_click('Forget',scroll=True);wait('Read back saved state: forgotten');cap('forgotten')
 detail=client.request('/'+ws+'/memory/'+mid)
 assert detail['current']['status']=='forgotten'
 assert all(r['content'] is None for r in detail['revisions'])
 assert 'Native concise headings' not in t.text
 send('\x1b');wait('Unsent native composer '+label);cap('composer-preserved')
 result.update(pass_=True,forgotten_revision=detail['current']['revision_id'],all_payloads_erased=True,composer_preserved=True)
finally:
 t.close();(out/(label+'-result.json')).write_text(json.dumps(result,indent=2)+'\n')
print(label,'ACTUAL PTY PASS')
