"""Actual PTY controls, no widget calls. HTTP used only for independent expected refs."""
import json,os,sys
from pathlib import Path
from hashlib import sha256
sys.path.insert(0,str(Path.cwd()/'.local/batch3/b31b'))
from pty_driver import Terminal
from workagent.operator_client import OperatorClient
from workagent.tui.session import Session
root=Path.cwd();base=root/'.local/batch3/b32c';f=json.loads((base/'fixture.json').read_text());out=base/'evidence/pty';out.mkdir(exist_ok=True);mode=sys.argv[1];ws=f['workspace_id'];client=OperatorClient();session=Session(client,ws,client.identity(ws));session.select(f['conversation_id']);rid=f['stages']['transfer']['run_id']
page=client.request('/'+ws+'/runs/'+rid+'/tool-attempts?limit=25');items=page['items'];assert not page['next_after'];passed=next(i for i in items if i['capability_id']=='compute.python' and i['observation']['output']['result']['status']=='succeeded');failed=next(i for i in items if i['capability_id']=='compute.python' and i['observation']['output']['result']['status']=='failed')
cols,rows=100,45;t=Terminal([str(root/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual'],root,dict(os.environ),cols,rows,out/mode);actions=[]
def send(keys,seconds=.3):actions.append({'keys':keys});t.send(keys);t.pump(seconds)
def click(x,y):send(f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m')
def label(text,scroll=False):
 for _ in range(60):
  for y,line in enumerate(t.screen.display):
   if text in line:click(line.index(text)+2,y+1);return
  if scroll:send(f'\x1b[<65;{cols-3};{rows-6}M',.1)
  else:t.pump(.15)
 t.capture('missing');raise AssertionError('Missing '+text+'\n'+t.text)
def select_attempt(item):
 # Focus select by visible old selection or placeholder; Home then Down chooses exact index.
 for _ in range(50):
  if 'Recorded attempts' in t.text or 'compute.python · observed' in t.text:break
  send(f'\x1b[<64;{cols-3};8M',.1)
 label('Recorded attempts' if 'Recorded attempts' in t.text else 'compute.python · observed')
 send('\x1b[H'+'\x1b[B'*(items.index(item)+1)+'\r',.7)
result=dict(mode=mode,actions=actions,passed=False)
try:
 t.pump(1);t.wait('Enter adds a line');label('Status');label('Tool activity');t.wait('recorded attempts on this page');t.capture('opened')
 select_attempt(failed);t.wait('Execution not successful: failed');t.capture('failed')
 select_attempt(passed);t.wait('Execution succeeded');t.capture('passed-resources')
 label('Generated exports',True);exports=passed['observation']['output']['result']['outputs'];m=next(m for m in exports if m['filename']=='patch.txt');send('\x1b[H'+'\x1b[B'*(exports.index(m)+1)+'\r');
 label('Absolute new download path',True);dest=out/(mode+'-patch.txt');send('\x1b[200~'+str(dest)+'\x1b[201~');label('Download verified bytes',True);t.wait('Downloaded actual bytes');t.capture('downloaded');raw=dest.read_bytes();assert sha256(raw).hexdigest()==m['blob']['sha256'];result.update(passed=True,patch_sha256=m['blob']['sha256'],export_id=m['export_id'])
finally:t.close();(out/(mode+'-result.json')).write_text(json.dumps(result,indent=2))
print('Actual PTY verified',mode)
