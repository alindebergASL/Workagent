"""Independent evaluator readback: SQL bytes, external GETs, exact exports, restart."""
import base64,json,os,sys,urllib.request
from pathlib import Path
from hashlib import sha256,sha1
from workagent.db import Database
from workagent.service import Service
from workagent.service import Principal
from workagent.dispatcher import Dispatcher
B=Path.cwd()/'.local/batch3/b33a';O=B/'evidence/readback';O.mkdir(exist_ok=True);f=json.loads((B/'fixture.json').read_text());ws=f['workspace_id'];mode=sys.argv[1];s=Service(Database());p=Principal('local-human')
result={'mode':mode,'sources':[],'exports':[]}
with s.db.transaction() as c:
 snapshots=c.execute('SELECT data FROM source_snapshots WHERE workspace_id=%s ORDER BY id',(ws,)).fetchall()
 result['counts']={table:c.execute('SELECT count(*) AS n FROM '+table+' WHERE workspace_id=%s',(ws,)).fetchone()['n'] for table in ('tool_attempts','source_snapshots','product_observations','provider_attempts')}
 for row in snapshots:
  snap=row['data'];loc=snap['locator'];raw=bytes(c.execute('SELECT bytes FROM generated_blobs WHERE workspace_id=%s AND id=%s',(ws,loc['blob_id'])).fetchone()['bytes'])
  assert sha256(raw).hexdigest()==snap['original_sha256']==loc['sha256'];assert sha256(loc['text'].encode()).hexdigest()==snap['extraction_sha256']==loc['text_sha256']
  item={'snapshot_id':snap['snapshot_id'],'version_number':snap['version_number'],'url':loc['final_url'],'original_sha256':snap['original_sha256'],'extraction_sha256':snap['extraction_sha256'],'bytes':len(raw)}
  (O/(snap['snapshot_id']+'.raw.json')).write_bytes(raw)
  if '/readme?ref=' in item['url']:
   value=json.loads(raw);body=base64.b64decode(value['content']);blob=sha1(b'blob '+str(len(body)).encode()+b'\0'+body).hexdigest();assert blob==value['sha'];assert item['url'].endswith('3c7baaa05ab4aa49cc819ce3a819d260de19c157');assert raw==(B/'external-readback/readme.json').read_bytes();item['git_blob_sha']=blob
  if mode=='before':
   class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
   opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());req=urllib.request.Request(item['url'],headers={'Accept':'application/vnd.github+json','Accept-Encoding':'identity','User-Agent':'Independent-Workagent-Evaluator/1','X-GitHub-Api-Version':'2022-11-28'})
   with opener.open(req,timeout=20) as response:
    direct=response.read(262145);assert len(direct)<=262144;assert response.status==200
    (O/(snap['snapshot_id']+'.external.json')).write_bytes(direct);item['external_sha256']=sha256(direct).hexdigest();item['external_exact_match']=direct==raw
    assert direct==raw, 'changed external response: retained body is still versioned, inspect before accepting'
  result['sources'].append(item)
assert len(result['sources'])==4
manifest=json.loads((B/'evidence/export-observations.json').read_text())[0]['data']['output']['result'];actual,raw=s.download_export(p,ws,manifest['export_id']);assert actual.model_dump(mode='json')==manifest;assert raw==(B/'evidence/expected-brief.md').read_bytes();assert sha256(raw).hexdigest()==manifest['input_sha256']==manifest['blob']['sha256'];result['exports'].append(manifest)
file=next(x for x in s.list_workspace_files(p,ws,f['conversation_id']).items if x.filename=='requests-brief.md');part=s.read_workspace_file(p,ws,file.workspace_file_id,file.current.version_id,file.current.sha256);expected=(B/'evidence/expected-human.md').read_bytes();assert part.text.encode()==expected;assert sha256(expected).hexdigest()==file.current.sha256;result['human']=file.model_dump(mode='json')
if mode=='after':
 before=json.loads((O/'before.json').read_text());assert result['counts']==before['counts'];assert result['human']==before['human'];assert [{k:v for k,v in x.items() if not k.startswith('external_')} for x in before['sources']]==result['sources']
 from workagent.connectors import github_read
 github_read.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('unexpected repeated connector read'))
 from test_general_alpha_runtime import AlphaProvider
 from test_general_responses import worker
 provider=AlphaProvider([]);ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
 result['restart_runs']=[]
 for stage in f['stages'].values():
  run=worker(ctx,provider,O/'restart-worker').work(p,ws,stage['run_id']);assert run.state=='ready';result['restart_runs'].append({'run_id':run.id,'state':run.state})
 assert provider.contexts==[] and provider.responses=={};result['restart_model_posts']=0
 with s.db.transaction() as c:assert result['counts']=={table:c.execute('SELECT count(*) AS n FROM '+table+' WHERE workspace_id=%s',(ws,)).fetchone()['n'] for table in result['counts']}
result['passed']=True;(O/(mode+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(mode,'independent readback PASS',len(result['sources']),'sources; exact export; human revision')
