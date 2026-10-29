"""Actual native PTY read-only GitHub receipts + verified brief download."""
import json,os,sys
from pathlib import Path
from hashlib import sha256
ROOT=Path.cwd();BASE=ROOT/'.local/batch3/b33a';OUT=BASE/'evidence/pty';OUT.mkdir(exist_ok=True)
os.environ['WORKAGENT_OPERATOR_JOURNAL']=str(BASE/'native-journal');os.environ['WORKAGENT_TUI_DRAFTS']=str(BASE/('native-drafts-'+sys.argv[1]))
sys.path.insert(0,str(ROOT/'.local/batch3/b31b'))
from pty_driver import Terminal
from workagent.operator_client import OperatorClient
from workagent.tui.session import Session
f=json.loads((BASE/'fixture.json').read_text());mode=sys.argv[1];ws=f['workspace_id'];client=OperatorClient();session=Session(client,ws,client.identity(ws));session.select(f['conversation_id'])
rid=f['stages']['live']['run_id'];items=client.request('/'+ws+'/runs/'+rid+'/tool-attempts?limit=25')['items'];chosen=next(i for i in items if i['capability_id']=='connectors.github.read');cols,rows=100,45
t=Terminal([str(ROOT/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual'],ROOT,dict(os.environ),cols,rows,OUT/mode);actions=[]
def send(keys,seconds=.3):actions.append({'keys':keys});t.send(keys);t.pump(seconds)
def click(x,y):send(f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m')
def label(text,scroll=False):
 for _ in range(70):
  for y,line in enumerate(t.screen.display):
   if text in line:click(line.index(text)+2,y+1);return
  if scroll:send('\t',.12)
  else:t.pump(.15)
 t.capture('missing');raise AssertionError('Missing '+text+'\n'+t.text)
result=dict(mode=mode,actions=actions,passed=False)
try:
 t.pump(1);t.wait('Enter adds a line');label('Status');label('Tool activity');t.wait('Read selected run');t.pump(.8);t.capture('opened')
 click(30,7);send('\x1b[H\x1b[B\r');label('Read selected run');t.pump(1)
 label('Recorded attempts');send('\x1b[H'+'\x1b[B'*(items.index(chosen)+1)+'\r',.8);t.wait('Connector status: available');t.capture('public-read-receipt')
 assert chosen['observation']['output']['result']['snapshot']['original_sha256'] in t.text
 result.update(response_sha256=chosen['observation']['output']['result']['snapshot']['original_sha256'])
 send('\x1b');label('Files');label('Working files');t.wait('Working files ·')
 files=client.request('/'+ws+'/work-areas/'+f['conversation_id']+'/files')['items'];index=next(i for i,x in enumerate(files) if x['filename']=='requests-brief.md')
 label('Working files (25 per page)');send('\x1b[H'+'\x1b[B'*(index+1)+'\r');label('Open exact');t.pump(.8)
 label('txt',True);send('\x1b[H\x1b[B\r');label('Export saved version',True);t.pump(1)
 dest=OUT/(mode+'-requests-brief.md');label('Absolute download destination',True);label('Absolute download destination',True);send('\x01\x0b');send('\x1b[200~'+str(dest)+'\x1b[201~',1);t.capture('destination');label('Download export',True);t.pump(2);t.capture('downloaded')
 raw=dest.read_bytes();expected=(BASE/('evidence/expected-human.md' if mode.startswith('after') else 'evidence/expected-brief.md')).read_bytes();assert raw==expected
 result.update(passed=True,export_sha256=sha256(raw).hexdigest(),export_bytes=len(raw))
finally:t.close();(OUT/(mode+'-result.json')).write_text(json.dumps(result,indent=2))
print('Actual native GitHub PTY',mode,result['passed'])
