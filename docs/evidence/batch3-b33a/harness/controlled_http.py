"""Controlled fixtures through live loopback HTTP, never live GitHub failures."""
import json,os
from pathlib import Path
import httpx
from test_domain import context
from test_conversations import conversation
from test_github_pg import install,execute
from test_github_unit import discover,response
from workagent.connectors import github_read as G
from workagent.capabilities import policy
from workagent.capabilities.github_adapters import input_refs
from workagent.db import Database
B=Path.cwd()/'.local/batch3/b33a';O=B/'evidence';ctx=context.__wrapped__();s,p,ws,_,admin=ctx;cv=conversation(ctx);req=discover();allowed=req.model_copy(update={'repository':'psf/requests'});cap,g,q=install(ctx,cv,[req,allowed]);original=G.fetch
result={'classification':'controlled fixture + real loopback HTTP; not GitHub outages','workspace_id':ws,'conversation_id':cv.id,'run_id':q.run.id,'cases':[]}
client=httpx.Client(base_url='http://127.0.0.1:18238/v1/workspaces/'+ws,headers={'Authorization':'Bearer '+os.environ['LOCAL_BEARER_TOKEN'],'X-Schema-Version':'workagent/v1','X-Request-Id':'b33a-http-evaluator'},timeout=20)
try:
 for page,status in enumerate(['rate_limited','denied','unavailable','changed_source'],1):
  G.fetch=lambda r,status=status: {'status':status,'source':'fixture','retry_after_seconds':9} if status=='rate_limited' else {'status':status,'source':'fixture'}
  observation,call=execute(s,cap,q,req.model_copy(update={'page':page}));r=client.get('/runs/'+q.run.id+'/tool-attempts');assert r.status_code==200
  row=next(x for x in r.json()['items'] if x['call_id']==call.call_id);assert row['observation']['output']['result']['status']==status;assert row['observation']['output']['result']['source']=='fixture';result['cases'].append({'status':status,'http':r.status_code,'receipt':row})
 G.fetch=lambda r:response([{'number':777,'title':'CONTROLLED_SCOPE_SECRET_TITLE','body':'untrusted <script>never execute</script>'}])
 observed,_=execute(s,cap,q,req.model_copy(update={'page':5}));snap=observed.output['result']['snapshot']
 G.fetch=lambda r:response([{'number':778,'title':'Permitted other repository'}])
 kept,_=execute(s,cap,q,allowed)
 assert client.get('/source-snapshots/'+snap['snapshot_id']).status_code==200
 policy.restrict_resources(Database(admin),g.id,[input_refs(req)[0]])
 denied=client.get('/source-snapshots/'+snap['snapshot_id']);unknown=client.get('/source-snapshots/00000000-0000-4000-8000-000000000000');assert denied.status_code==unknown.status_code==404;assert denied.json()['code']==unknown.json()['code'];assert 'CONTROLLED_SCOPE_SECRET_TITLE' not in denied.text
 listing=client.get('/work-areas/'+cv.id+'/files');assert listing.status_code==200;assert len(listing.json()['items'])==1;assert listing.json()['items'][0]['workspace_file_id']==kept.output['result']['snapshot']['workspace_file_id'];assert 'CONTROLLED_SCOPE_SECRET_TITLE' not in listing.text
 assert client.get('/source-snapshots/'+kept.output['result']['snapshot']['snapshot_id']).status_code==200
 receipts=client.get('/runs/'+q.run.id+'/tool-attempts');assert receipts.status_code==404;assert 'CONTROLLED_SCOPE_SECRET_TITLE' not in receipts.text
 result.update(passed=True,denied_status=denied.status_code,unknown_status=unknown.status_code,remaining_file_count=1,denied_run_receipts_status=receipts.status_code)
finally:G.fetch=original;client.close();(O/'controlled-http.json').write_text(json.dumps(result,indent=2)+'\n')
print('Controlled real-HTTP statuses, selective-scope nonenumeration PASS')
