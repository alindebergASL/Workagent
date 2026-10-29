"""Actual PTYs; controlled real DB restriction, no widget invocations."""
import json,os,sys,subprocess
from pathlib import Path
ROOT=Path.cwd();B=ROOT/'.local/batch3/b33a';O=B/'evidence/client-native';O.mkdir(exist_ok=True)
os.environ['WORKAGENT_OPERATOR_JOURNAL']=str(B/'client-native-journal');os.environ['WORKAGENT_TUI_DRAFTS']=str(B/'client-native-drafts')
sys.path.insert(0,str(ROOT/'.local/batch3/b31b'))
from pty_driver import Terminal
from workagent.operator_client import OperatorClient
from workagent.tui.session import Session
f=json.loads((B/'client-fixture-native.json').read_text());ws=f['workspace_id'];client=OperatorClient();session=Session(client,ws,client.identity(ws));session.select(f['conversation_id'])
items=client.request('/'+ws+'/runs/'+f['run_id']+'/tool-attempts?limit=25')['items'];args=[str(ROOT/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual']
t=Terminal(args,ROOT,dict(os.environ),100,60,O/'receipt');u=None;actions=[];result={'passed':False,'classification':f['classification'],'statuses':[],'actions':actions}
def send(v,keys):actions.append(keys);v.send(keys);v.pump(.4)
def label(v,text):
 for _ in range(60):
  for y,line in enumerate(v.screen.display):
   if text in line:
    x=line.index(text)+2;y+=1;send(v,f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m');return
  send(v,'\t')
 v.capture('missing');raise AssertionError('missing '+text+'\n'+v.text)
try:
 t.wait('Enter adds a line');label(t,'Status');label(t,'Tool activity');t.wait('recorded attempts on this page')
 for case in f['cases']:
  index=next(i for i,x in enumerate(items) if x['attempt_id']==case['attempt_id']);label(t,'Recorded attempts' if not result['statuses'] else 'connectors.github.')
  send(t,'\x1b[H'+'\x1b[B'*(index+1)+'\r');t.wait('Connector status: '+case['status']);assert 'Source transport: fixture' in t.text;t.capture(case['status']);result['statuses'].append(case['status'])
 assert f['snapshot']['original_sha256'] in t.text
 u=Terminal(args,ROOT,dict(os.environ),100,60,O/'source');u.wait('Enter adds a line');label(u,'Files');label(u,'Working files');u.wait('Listed 1 files');label(u,'Working files (25 per page)');send(u,'\x1b[H\x1b[B\r');label(u,'Inspect source metadata');u.wait('Metadata refreshed only');u.capture('preloaded')
 # Use actual terminal text-area navigation if the title is below the first range viewport.
 if 'CONTROLLED_REVOKED_TITLE' not in u.text:
  label(u,'"evidence"');send(u,'\x1b[H');u.pump(.5)
 assert 'CONTROLLED_REVOKED_TITLE' in u.text,u.text
 u.capture('title-preloaded')
 subprocess.run([str(ROOT/'backend/.venv/bin/python'),str(B/'client_fixture.py'),'revoke','native'],check=True)
 send(t,'\x12');t.wait('visible output cleared');assert f['snapshot']['original_sha256'] not in t.text and 'Connector status:' not in t.text;t.capture('denied')
 send(u,'\x12');u.wait('Visible source and claim rows cleared');assert 'CONTROLLED_REVOKED_TITLE' not in u.text and f['snapshot']['original_sha256'] not in u.text;u.capture('denied')
 result.update(passed=True,receipt_cleared=True,preloaded_title_cleared=True)
finally:
 t.close()
 if u:u.close()
 (O/'result.json').write_text(json.dumps(result,indent=2))
print('Actual controlled native PTY statuses and preloaded title/receipt denial PASS')
