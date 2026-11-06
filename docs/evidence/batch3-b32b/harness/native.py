"""Actual PTY office creation/edit/export/reopen; no widget calls."""
import json,os,sys,time
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'.local/batch3/b31b'))
from pty_driver import Terminal
from workagent.operator_client import OperatorClient
from workagent.tui.session import Session
root=Path.cwd();base=root/'.local/batch3/b32b';f=json.loads((base/'fixture.json').read_text());mode=sys.argv[1];ws=f['workspace_id'];client=OperatorClient();s=Session(client,ws,client.identity(ws));s.select(f['native'])
cols,rows=(80,35) if mode=='reopen' else (100,45)
out=base/'evidence/pty';out.mkdir(exist_ok=True);t=Terminal([str(root/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual'],root,dict(os.environ),cols,rows,out/('office-'+mode));actions=[]
def send(keys,seconds=.25):actions.append({'keys':keys});t.send(keys);t.pump(seconds)
def click(x,y):send(f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m')
def label(text,scroll=False,last=False):
 for i in range(90):
  lines=list(enumerate(t.screen.display))
  for y,line in reversed(lines) if last else lines:
   if text in line:click(line.index(text)+2,y+1);return
  if scroll:send(f'\x1b[<65;{cols-3};{rows-6}M',.1)
  else:t.pump(.15)
 t.capture('missing-label');raise AssertionError('Missing '+text+'\n'+t.text)
def paste(value):send('\x1b[200~'+value+'\x1b[201~',.6)
def input_value(label_text,value):label(label_text,True,True);send('\x01\x0b');paste(value)
result={'mode':mode,'size':[cols,rows],'actions':actions,'passed':False}
try:
 t.pump(1);t.wait('Enter adds a line');label('Files');label('Working files');t.wait('Working files ·');t.capture('opened')
 if mode=='create':
  label('New draft');input_value('notes.md','native-brief.json');send('\t')
  content=json.dumps({'office_version':'office-v1','kind':'document','paragraphs':['Native created brief','Exact quotation: “Keep these words.”'],'annotations':['Human native annotation retained across restart.']},ensure_ascii=False,indent=2)
  paste(content);send('\x13',2);t.wait('Saved exact version');t.capture('saved-created')
 if mode in ('create','export'):
  # Click opens the Textual select; four Down keys select DOCX.
  label('txt',True);send('\x1b[B'*4+'\r');label('Export saved version',True);t.pump(3);t.capture('exported')
  input_value('Absolute download destination',str(base/'evidence/native-export.docx'));label('Download export',True);t.pump(2);t.capture('downloaded')
 elif mode=='edit':
  # Persisted selected editor reopens without rebuilding from server history.
  label('Native created brief',True);send('\x1b[18~');content=json.dumps({'office_version':'office-v1','kind':'document','paragraphs':['Native created brief','Exact quotation: “Keep these words.”','Human native edit: revised after creation.'],'annotations':['Human native annotation retained across restart.']},ensure_ascii=False,indent=2);paste(content);send('\x13',2);t.wait('Saved exact version');t.capture('saved-edited')
 elif mode=='reopen':
  label('Human native edit',True);t.capture('reopened-human-text')
 files=client.request('/'+ws+'/work-areas/'+f['native']+'/files')['items'];file=next(x for x in files if x['filename']=='native-brief.json');artifact=client.request('/'+ws+'/artifacts/'+file['workspace_file_id']);text=artifact['current_revision']['body']['content'];assert 'Human native annotation retained across restart.' in text
 if mode in ('edit','reopen'):assert 'Human native edit: revised after creation.' in text
 result.update(passed=True,file=file,text=text)
finally:t.close();(out/('office-'+mode+'-result.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('Actual PTY PASS',mode)
