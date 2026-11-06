import json,os,sys
from pathlib import Path
from workagent.db import Database
from workagent.service import Service,Principal
base=Path.cwd()/'.local/batch3/b35a';f=next(x for x in json.loads((base/'ui-fixture-v2.json').read_text()) if x['label']==sys.argv[2]);s=Service(Database());p=Principal('local-human');ws=f['workspace_id']
if sys.argv[1]=='prepare-connector':
 os.environ['WORKAGENT_SYNTHETIC_CONNECTOR']='1'
 from uuid import uuid4
 from datetime import timedelta
 from workagent.models import now
 from workagent.connectors import service as lifecycle
 workspaces=s.list_workspaces(p).items;default=next((x for x in workspaces if x.kind=='personal'),workspaces[0]);cid=str(uuid4())
 with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:c.execute("INSERT INTO connector_accounts(workspace_id,id,principal_id,state,expires_at,credential_ref) VALUES (%s,%s,%s,'connected',%s,%s)",(default.id,cid,p.id,now()+timedelta(hours=2),'synthetic-unavailable-vault-'+cid))
 connected=[x.connector_id for x in lifecycle.listing(s,p,default.id).items if x.state=='connected']
 print(json.dumps({'workspace_id':default.id,'connector_id':cid,'index':connected.index(cid)}))
elif sys.argv[1]=='revoke-source':
 with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,f['source_id']))
 assert all(i.revision.memory_id!=f['revocable_memory_id'] for i in s.list_memory(p,ws,f['conversation_id']).items)
 print('Source revoked; derivative absent before counts')
else:
 human=f['human_file'];assert s.read_workspace_file(p,ws,human['workspace_file_id'],human['current']['version_id'],human['current']['sha256']).text=='Protected human notes '+f['label']
 result={'label':f['label'],'preserved_human_sha256':human['current']['sha256'],'memory':s.inspect_memory(p,ws,f['memory_id']).model_dump(mode='json'),'visible_memory_count':len(s.list_memory(p,ws,f['conversation_id']).items)}
 print(json.dumps(result))
