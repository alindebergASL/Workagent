"""B3.2a real pexpect/pyte user inputs; never Textual pilot/widget methods."""
import json,os,sys,subprocess,time
from pathlib import Path
from hashlib import sha256
sys.path.insert(0,str(Path.cwd()/'.local/batch3/b31b'))
from pty_driver import Terminal
from workagent.operator_client import OperatorClient
from workagent.tui.session import Session
root=Path.cwd();base=root/'.local/batch3/b32a';fixture=base/'native-fixture.json';f=json.loads(fixture.read_text());ws=f['workspace_id'];client=OperatorClient();mode=sys.argv[1];cols,rows=(80,35) if mode in ('restart80','human80') else (100,45)
out=base/'evidence/pty';out.mkdir(exist_ok=True);session=Session(client,ws,client.identity(ws));session.select('__new__' if mode=='initial' else f['native'])
t=Terminal([str(root/'backend/.venv/bin/python'),'-m','workagent.operator_tui','--workspace',ws,'textual'],root,dict(os.environ),cols,rows,out/('native-'+mode));actions=[]
def send(keys,seconds=.3):actions.append({'keys':keys});t.send(keys);t.pump(seconds)
def click(x,y):send(f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m')
def label(text,scroll=False,last=False):
 for _ in range(80):
  lines=list(enumerate(t.screen.display))
  for y,line in reversed(lines) if last else lines:
   if text in line:click(line.index(text)+2,y+1);return
  if not scroll:
   t.pump(.15);continue
  send(f'\x1b[<65;{cols-4};{rows-8}M',.1)
 t.capture('label-missing');raise AssertionError('Missing '+text+'\n'+t.text)
def cap(name):return t.capture(name)
def wait(text):return t.wait(text,35)
def worker(which):
 subprocess.run([str(root/'backend/.venv/bin/python'),str(base/'journey.py'),'run',f['native'],which,'native-'+which],check=True,stdout=(out/('native-'+which+'-worker.log')).open('w'),stderr=subprocess.STDOUT)
def request(prompt):
 click(12,rows-7);send(prompt);cap('composed');send('\x1b[15~',2)
 # Real app creates/selects the conversation. Read the private session only to discover its id.
 saved=Session(client,ws,client.identity(ws));cid=saved.draft['conversation'];assert cid
 f['native']=cid;fixture.write_text(json.dumps({**json.loads(fixture.read_text()),**f},indent=2));detail=client.request('/'+ws+'/conversations/'+cid);assert detail['messages'][-1]['text']==prompt;return detail
result={'mode':mode,'size':[cols,rows],'pid':t.child.pid,'actions':actions,'passed':False}
try:
 t.pump(1);wait('Enter adds a line');cap('opened')
 if mode=='initial':
  prompt='Research https://fixture.example/source for the east depot capacity. Treat search snippets as discovery only. Save an editable conclusion with exact captured evidence; do not accept any decision.'
  request(prompt);worker('initial');send('\x12',2);cap('initial-retained')
 elif mode=='edit':
  label('Files');label('Working files');wait('Working files (25 per page)');label('Working files (25 per page)');send('\r');wait('research-conclusion.txt');label('research-conclusion.txt');label('Open exact');wait('Exact file loaded');cap('file-before-edit')
  detail=client.request('/'+ws+'/conversations/'+f['native']);files=client.request('/'+ws+'/work-areas/'+f['native']+'/files')['items'];item=next(x for x in files if x['filename']=='research-conclusion.txt');art=client.request('/'+ws+'/artifacts/'+item['workspace_file_id']);original=art['current_revision']['body']['content'];human=original+'\nHuman native conclusion: reserve only ten units until the new source is reviewed — preserve exact wording.\n'
  f['native_original']=original;f['native_human']=human;f['native_artifact']=art['id'];fixture.write_text(json.dumps({**json.loads(fixture.read_text()),**f},indent=2))
  label('Research conclusion');send('\x1b[18~');send('\x1b[200~'+human+'\x1b[201~',1);cap('typed-human');send('\x13',2);wait('Saved exact version');cap('saved-human')
  got=client.request('/'+ws+'/artifacts/'+art['id']);assert got['current_revision']['body']['content']==human,got['current_revision']['body']['content']
  send('\x1b',1);request('Cite the exact retained source for my current human-edited conclusion. Keep any all-depots extrapolation explicitly unsupported.');worker('cite');send('\x12',2);cap('cited-current')
 elif mode=='refresh':
  request('Refresh https://fixture.example/source after its capacity change. Propose a source update; do not overwrite my exact human native conclusion.');worker('refresh');send('\x12',2);cap('refresh-proposed')
 if mode in ('inspect','restart80'):
  label('Work');label('Saved results');send('\r');t.pump(.5);cap('artifact-options');label('Working file');wait('Current saved');t.pump(1)
  for version in ('A','B'):
   label('Citations & freshness');wait('2 sources on this page');label('Sources (25 per page)');send('\r');wait('Capacity bulletin '+version);label('Capacity bulletin '+version);label('Inspect selected source',scroll=True);send('\t',.5);wait('Snapshot ')
   cap('source-'+version+'-metadata-start');label('Snapshot ');send('\x1b[6~',.5);cap('source-'+version+'-metadata-end')
   send('\t',.5);cap('source-'+version+'-text')
   send('\t');send('\t',.5);cap('claims-'+version+'-start');label('Exact quotes verify attribution');send('\x1b[6~',.5);cap('claims-'+version+'-end')
   send('\x1b',1)
 if mode in ('inspect','restart80','human80','human100'):
  label('Files');label('Working files');wait('Complete editor content: '+str(len(f['native_human'].encode()))+' UTF-8 bytes');cap('human-reopened')
  label('Research conclusion',scroll=True);send('\x1b[6~',.5)
  for _ in range(8):send(f'\x1b[<65;{cols-1};{rows-4}M',.15)
  cap('human-annotation')
  got=client.request('/'+ws+'/artifacts/'+f['native_artifact']);assert got['current_revision']['body']['content']==f['native_human']
 result['passed']=True
finally:
 result['conversation_id']=f.get('native');t.close();(out/('native-'+mode+'-result.json')).write_text(json.dumps(result,indent=2))
print('ACTUAL PTY PASS',mode)
