"""Synthetic review candidates for the same cross-client work; no provider calls."""
from pathlib import Path
import sys, os, json, copy
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from workagent.db import Database
from workagent.service import Service,Principal
from test_proposal_review_pg import candidate
assert '/workagent_test_' in os.environ['DATABASE_URL']
s=Service(Database());p=Principal('local-human');ws='recovery5a-workspace';aid='dfe536ed-23fa-44fc-8e3d-0f9796317304'
art=s.get_artifact(p,ws,aid)
ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
body=art.current_revision.body.model_dump(mode='json') if hasattr(art.current_revision.body,'model_dump') else copy.deepcopy(art.current_revision.body)
if sys.argv[1]=='initial':
 bad=copy.deepcopy(body);bad['notes']=[];bad['title']='Earlier inferior browser proposal'
 old=candidate(ctx,art,bad)
 good=copy.deepcopy(body);good['title']='Latest browser proposal retains human notes'
 latest=candidate(ctx,art,good)
 result={'older':old.id,'latest':latest.id,'base_revision':art.current_revision_id,'notes':body['notes'],'body':body,'evidence':'Direct synthetic proposal fixture; not a model-quality trial'}
else:
 good=copy.deepcopy(body);good['title']='Newer browser proposal retains human notes'
 latest=candidate(ctx,art,good);result={'latest':latest.id,'base_revision':art.current_revision_id,'notes':body['notes']}
path=ROOT/'docs/evidence/batch2-recovery5b'/('review-'+sys.argv[1]+'.json')
with path.open('x') as f:json.dump(result,f,indent=2)
print(json.dumps(result))
