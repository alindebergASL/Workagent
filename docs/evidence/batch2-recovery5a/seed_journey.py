"""Disposable synthetic journey setup. Not model-quality or external-effect evidence."""
import hashlib
import json
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from workagent.db import Database
from workagent.fixture import seed
from workagent.service import Service,Principal
from workagent.models import CreateConversation,HumanSave,SourceRef
from test_domain import cmd
from test_flexible_work import publish,table
from test_proposal_review_pg import candidate
OUT=ROOT/'docs/evidence/batch2-recovery5a'
assert '/workagent_test_' in os.environ['DATABASE_URL']
assert not (OUT/'fixture.json').exists()
source=json.loads((ROOT/'docs/evidence/batch2-recovery4/final-source-manifest.json').read_text())
assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in source.items())
(OUT/'source-manifest.json').write_text(json.dumps(source,indent=2)+'\n')
ws='recovery5a-workspace';p=Principal('local-human')
seed(os.environ['MIGRATION_DATABASE_URL'],json.loads((ROOT/'fixtures/actor/solo-v0.1/initial_records.json').read_text()),ws,p.id)
s=Service(Database());s.db.check_runtime_role()
refs=[SourceRef(source_id=x.id,external_version=x.external_version,observed_at=x.observed_at) for x in s.list_sources(p,ws).items]
ctx=(s,p,ws,refs,os.environ['MIGRATION_DATABASE_URL'])
cv=s.create_conversation(p,ws,cmd(CreateConversation,title='Community garden continuity',selected_source_refs=[]))
body=table();body['title']='Garden plot options';body['notes']=['Keep the shaded beds.','Volunteer notes:\n  water Tuesday\n  preserve this line ♪']
cv,_,art=publish(ctx,body,cv)
art=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
bad=table();bad['title']='Earlier candidate removes human notes';bad['notes']=[]
old=candidate(ctx,art,bad)
newbody=table();newbody['title']='Latest candidate keeps human notes';newbody['notes']=body['notes']
new=candidate(ctx,art,newbody)
protected=s.create_conversation(p,ws,cmd(CreateConversation,title='Restricted source continuity',selected_source_refs=refs[:1]))
fixture={'workspace':ws,'principal':p.id,'conversation':cv.id,'title':cv.title,'artifact':art.id,'revision':art.current_revision_id,'body_hash':art.current_revision.body_hash,'human_body':body,'older_proposal':old.id,'latest_proposal':new.id,'protected_conversation':protected.id,'source_ref':refs[0].model_dump(mode='json'),'evidence_origin':'Synthetic fixture; initial artifact from ControlledTransport, proposals seeded explicitly. No live model results.'}
(OUT/'fixture.json').write_text(json.dumps(fixture,indent=2)+'\n')
with s.db.transaction() as c:
 role=c.execute('SELECT current_database() db,current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
 assert not role['rolsuper'] and not role['rolbypassrls']
 migrations=c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall()
proof={'runtime':dict(role),'migrations':migrations,'fixture_sha256':hashlib.sha256((OUT/'fixture.json').read_bytes()).hexdigest(),'source_manifest_sha256':hashlib.sha256((OUT/'source-manifest.json').read_bytes()).hexdigest()}
(OUT/'database-proof.json').write_text(json.dumps(proof,indent=2,default=str)+'\n')
print('Created synthetic named work, human revision, two pending proposals and separately revocable source scope.')
