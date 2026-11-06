"""Actual PTY combined journey. No Textual pilot/widget invocation."""
import json,os,sys,subprocess,time
from pathlib import Path
from hashlib import sha256
sys.path.insert(0,str(Path.cwd()/'.local/batch3/b31b'))
from pty_driver import Terminal
from workagent.operator_client import OperatorClient
from workagent.tui.session import Session
root=Path.cwd();proof=root.parent;f=json.loads((proof/'fixture.json').read_text());ws=f['workspace_id'];client=OperatorClient();cols,rows=map(int,sys.argv[1:3]);label='native'+str(cols)
selected=f['later'] if cols==100 else f['first']
Session(client,ws,client.identity(ws)).select(selected)
out=proof/'evidence/pty';out.mkdir(exist_ok=True)
t=Terminal([str(root/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual'],root,dict(os.environ),cols,rows,out/label)
actions=[]
def send(keys,seconds=.3):actions.append(dict(keys=keys));t.send(keys);t.pump(seconds)
def click(x,y):send(f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m')
def label_click(text,scroll=False,last=False):
 for _ in range(60):
  lines=list(enumerate(t.screen.display))
  for y,line in reversed(lines) if last else lines:
   if text in line:click(line.index(text)+2,y+1);return
  if not scroll:break
  send(f'\x1b[<65;{cols-4};{rows-5}M',.1)
 t.capture('label-failed');raise AssertionError('Label absent '+text+'\n'+t.text)
def wait(text):return t.wait(text,25)
def cap(name):t.capture(name)
result=dict(label=label,size=[cols,rows],pid=t.child.pid,actions=actions,passed=False)
try:
 t.pump(3);cap('opened')
 if cols==100:
  label_click('Files');wait('Local UTF-8');cap('files')
  data='record_id,cohort,elapsed_minutes\nn1,North,0.5\nn2,North,2.5\nn2,North,2.5\ns1,South,4\ns2,South,2\n'
  source=proof/'native.csv';source.write_text(data)
  label_click('Local UTF-8');send(str(source));label_click('Stage file');wait('native.csv');cap('staged')
  # Composer is outside the tab; F5 is the actual app send binding.
  click(12,rows-7)
  prompt='Summarize duration by group in seconds, checking duplicates and missing observations. Column mapping: '+json.dumps(dict(id='record_id',group='cohort',value='elapsed_minutes',seconds_per_unit='60'))
  send(prompt);cap('composed');send('\x1b[15~',2)
  detail=client.request('/'+ws+'/conversations/'+selected);latest=detail['messages'][-1]
  assert latest['text']==prompt and latest['attachments'][0]['content']==data,latest
  subprocess.run([str(root/'backend/.venv/bin/python'),'journey.py','run',selected,label],check=True,stdout=(out/(label+'-worker.log')).open('w'),stderr=subprocess.STDOUT)
  send('\x12',2);label_click('Files');label_click('Memory');wait('Authorized memories loaded');label_click('Memories available');send('\r');wait('For this duration study');label_click('For this duration study');label_click('Inspect');wait('Inspected exact revision');cap('memory')
  send('\x1b');label_click('Working files');wait('Working files (25 per page)');label_click('Working files (25 per page)');send('\r');wait('summary.csv');cap('file-options')
  # Multiple saved summaries in this conversation: choose the newest observed
  # output via its actual visible dropdown label (exact version distinguished).
  label_click('summary.csv',last=True);label_click('Open exact');t.pump(2);cap('result')
 else:
  label_click('Files');label_click('Working files');wait('Working files (25 per page)');label_click('Working files (25 per page)');send('\r');wait('summary.csv');label_click('summary.csv');label_click('Open exact');t.pump(2);cap('human-preserved')
  assert 'South remains provisional' in t.text,t.text
 # Export through native controls, then read back authenticated exact bytes.
 label_click('Export saved version',scroll=True);t.pump(1);cap('export')
 destination=proof/(label+'-download.txt');label_click('Absolute download',scroll=True);send(str(destination));label_click('Download export',scroll=True);t.pump(2);cap('download')
 assert destination.exists();raw=destination.read_bytes()
 result['download_sha256']=sha256(raw).hexdigest();result['download_text']=raw.decode();result['conversation_id']=selected
 if cols==80:assert raw.decode()==f['human']['revised']
 result['passed']=True
finally:
 t.close();(out/(label+'-result.json')).write_text(json.dumps(result,indent=2)+'\n')
print(label,'ACTUAL PTY PASS')
