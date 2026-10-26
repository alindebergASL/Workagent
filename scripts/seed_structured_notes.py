"""Seed isolated B2.1 browser fixtures through canonical controlled operations.
No provider requests or authority grants. Call only with disposable test DSNs.
"""
import json,os,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'backend/tests'))
sys.path.insert(0,str(root/'backend'))
from workagent.db import Database
from workagent.fixture import seed
from workagent.service import Service,Principal
from test_flexible_work import publish,table

assert '/workagent_test_' in os.environ['DATABASE_URL']
if len(sys.argv) not in (2,3) or (len(sys.argv)==3 and sys.argv[2]!='--append'):
    raise SystemExit('Usage: PYTHONPATH=backend python scripts/seed_structured_notes.py OUTPUT_JSON [--append]')
path=Path(sys.argv[1])
if path.exists():raise SystemExit('Refusing to replace an existing fixture manifest')
ws='local-workspace';p=Principal('local-human')
if '--append' not in sys.argv:
    seed(os.environ['MIGRATION_DATABASE_URL'],json.loads((root/'fixtures/actor/solo-v0.1/initial_records.json').read_text()),ws,p.id)
s=Service(Database());s.db.check_runtime_role()
ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
notes=['Venue shortlist:\n- Hall A\n- Hall B\n- Hall C\n- Hall D','  Deposit due Friday.  ','Contacts\n\nMara (catering)\nIo (AV)\n','Single line.','Budget\n  draft 1\n  draft 2\n\t(rounded)\n']
fixtures=[]
for name,width in [('desktop',1440),('mobile',390),('narrow',320)]:
    body=table();body['notes']=notes;body['title']='Synthetic note review '+name
    cv,_,art=publish(ctx,body)
    fixtures.append({'name':name,'width':width,'conversation':cv.id,'artifact':art.id,'revision':art.current_revision_id})
manifest={'evidence':'actual API/PostgreSQL with controlled synthetic fixture generation; no provider calls','notes':notes,'fixtures':fixtures,'workspace':ws}
path.write_text(json.dumps(manifest,indent=2))
print('Seeded',len(fixtures),'controlled fixtures:',path)
