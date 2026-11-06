"""Readback and original/access probes against an actual loopback API socket."""
import base64,hashlib,json,os,sys,uuid
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/batch2-recovery5a'
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from workagent.db import Database
from document_fixtures import pdf,docx,xlsx
f=json.loads((OUT/'fixture.json').read_text());ws=f['workspace'];cid=f['conversation']
c=httpx.Client(base_url='http://127.0.0.1:18965',timeout=30,headers={'Authorization':'Bearer '+os.environ['LOCAL_BEARER_TOKEN'],'X-Schema-Version':'workagent/v1','X-Request-Id':str(uuid.uuid4())})
root='/v1/workspaces/'+ws;path=root+'/conversations/'+cid

def cmd(**values):return {'schema_version':'workagent/v1','command_id':str(uuid.uuid4()),'request_id':str(uuid.uuid4()),**values}
def save(name,data):(OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
def get(url):
 r=c.get(url);assert r.status_code==200,(url,r.status_code);return r.json()
def post(url,body):
 r=c.post(url,json=body);assert r.status_code in (200,201,202),(url,r.status_code,r.text);return r.json()

if sys.argv[1]=='state':
 detail=get(path);queue=get(path+'/queued-messages');snapshot=get(root+'/work-snapshot?conversation_id='+cid);cps=get(path+'/checkpoints')
 save(sys.argv[2],{'conversation':detail,'queue':queue,'snapshot':snapshot,'checkpoints':cps,'documents':get(path+'/documents')})
 print('Actual HTTP state:',snapshot['execution']['state'],'worker_live',snapshot['execution']['worker_live'],'messages',len(detail['messages']),'queue',[(q['state'],q['intent']['text']) for q in queue['items']],'checkpoints',len(cps['items']))
elif sys.argv[1]=='responsibility':
 detail=get(path);snap=get(root+'/work-snapshot?conversation_id='+cid)
 stopped=post(path+'/stop',cmd(expected_work_version=detail['conversation']['work_version'],run_id=snap['execution']['run_id']))
 assert stopped['state']=='cancelled'
 detail=get(path);cp=get(path+'/checkpoints')['items'][-1]
 refused=c.post(path+'/continue',json=cmd(expected_work_version=detail['conversation']['work_version'],checkpoint_id=cp['checkpoint_id'],checkpoint_hash=cp['checkpoint_hash']))
 assert refused.status_code==409 and refused.json()['code']=='action_unresolved'
 assert get(path)==detail
 save('continue-stopped-refusal',{'status':refused.status_code,'code':refused.json()['code'],'unchanged_runs_messages':True})
 assignment=post(path+'/delegate',cmd(expected_work_version=detail['conversation']['work_version'],goal='Keep the community garden plan current',completion_criteria=['Human confirms a usable garden plan; saved draft alone is not completion.']))
 arpath=root+'/artifacts/'+f['artifact'];art=get(arpath)
 responsibility=post(root+'/assignments/'+assignment['id']+'/responsibility',cmd(expected_work_version=assignment['work_version'],current_outcome='Prepared context only; outcome remains unverified.',next_action={'kind':'await_event','description':'Review the next human change to garden options.'},dependencies=[{'kind':'artifact_revision','object_id':art['id'],'expected_version':art['current_revision_id']}],wait={'kind':'dependency_change','reason':'Await a material human edit.'}))
 before=get(root+'/work-snapshot?conversation_id='+cid)
 assert before['responsibility'][0]['historical_observation'] is not None
 body=art['current_revision']['body'];body['title']='Garden options — current human correction'
 saved=post(arpath+'/save',cmd(expected_current_revision_id=art['current_revision_id'],body=body))
 after=get(root+'/work-snapshot?conversation_id='+cid)
 current=get(root+'/assignments/'+assignment['id']+'/responsibility')
 assert next(a for a in after['artifacts'] if a['id']==art['id'])['current_revision_id']==saved['current_revision_id']
 assert before['responsibility'][0]['historical_observation']==after['responsibility'][0]['historical_observation']
 assert current['lifecycle']['observations'][0]['observed_version']==saved['current_revision_id']
 assert current['lifecycle']['review_required'] and not current['provider_execution_queued']
 assert current['lifecycle']['outcome_status']!='completed' and after['execution']['state']!='completed'
 save('dependency-historical-truth',{'before':before,'after':after,'responsibility':current,'prior_accepted_revision':art['current_revision_id'],'current_revision':saved['current_revision_id'],'historical_observation_unchanged':True,'no_provider_admission':True})
 print('Actual socket: stopped boundary rejects Continue409; human artifact edit changes dependency/current revision while historical observation stays exact and objective remains unverified.')
elif sys.argv[1]=='documents':
 originals=[]
 for kind,fn,mime in [('pdf',pdf,'application/pdf'),('docx',docx,'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),('xlsx',xlsx,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')]:
  raw=fn();sha=hashlib.sha256(raw).hexdigest();body=cmd(filename='continuity.'+kind,mime_type=mime,sha256=sha,content_base64=base64.b64encode(raw).decode())
  item=post(path+'/documents',body);assert item['status']=='extracted'
  download=c.get(path+'/documents/'+item['document_id']+'/download');assert download.status_code==200 and download.content==raw
  assert download.headers['x-content-type-options']=='nosniff'
  destination=ROOT/'.local/recovery5a'/('original.'+kind);destination.write_bytes(raw)
  originals.append({'kind':kind,'document':item,'command':body,'original_path':str(destination.relative_to(ROOT)),'download_sha256':hashlib.sha256(download.content).hexdigest()})
 # Keep full upload commands only in private local harness state, not log output.
 (ROOT/'.local/recovery5a/document-commands.json').write_text(json.dumps(originals))
 save('document-originals',[{k:v for k,v in x.items() if k!='command'} for x in originals])
 print('Actual socket: PDF/DOCX/XLSX extracted with byte-exact original downloads; no model worker.')
elif sys.argv[1]=='documents-replay':
 originals=json.loads((ROOT/'.local/recovery5a/document-commands.json').read_text())
 for x in originals:
  assert post(path+'/documents',x['command'])==x['document']
  r=c.get(path+'/documents/'+x['document']['document_id']+'/download');assert r.status_code==200 and r.content==(ROOT/x['original_path']).read_bytes()
 assert len(get(path+'/documents')['items'])==3
 save('document-restart-replay',{'originals':len(originals),'byte_exact':True,'same_command_envelopes':True,'duplicate_documents':False})
 print('Post-restart exact upload replay and all3 byte-identical originals verified.')
elif sys.argv[1]=='revoke':
 protected=root+'/conversations/'+f['protected_conversation'];raw=pdf();body=cmd(filename='restricted.pdf',mime_type='application/pdf',sha256=hashlib.sha256(raw).hexdigest(),content_base64=base64.b64encode(raw).decode())
 doc=post(protected+'/documents',body);before=get(root+'/work-snapshot?conversation_id='+f['protected_conversation'])
 assert c.get(protected+'/documents/'+doc['document_id']+'/download').content==raw
 # Authorized test-fixture mutation only, never maintenance or a production DB.
 assert '/workagent_test_' in os.environ['MIGRATION_DATABASE_URL']
 with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as connection:
  changed=connection.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s AND principal_id=%s',(ws,f['source_ref']['source_id'],f['principal'])).rowcount
  assert changed==1
 denied={}
 for name,url in [('conversation',protected),('document',protected+'/documents/'+doc['document_id']),('original',protected+'/documents/'+doc['document_id']+'/download'),('snapshot',root+'/work-snapshot?conversation_id='+f['protected_conversation']),('events',root+'/events?conversation_id='+f['protected_conversation']+'&after='+before['snapshot_cursor'])]:
  response=c.get(url);assert response.status_code in (403,404),(name,response.status_code);denied[name]=response.status_code
 response=c.post(protected+'/documents',json=body);assert response.status_code in (403,404);denied['exact_upload_replay']=response.status_code
 assert get(path)['conversation']['id']==cid
 save('revocation-proof',{'denied':denied,'unrelated_conversation_readable':True,'document_id':doc['document_id']})
 print('Actual socket: revoked source denies conversation, document metadata/original, snapshot/events and exact command replay; unrelated work stays readable.')
