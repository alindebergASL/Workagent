import json,os
from pathlib import Path
from workagent.db import Database
from workagent.service import Service,Principal
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
root=Path.cwd();f=json.loads((root.parent/'fixture.json').read_text());s=Service(Database());p=Principal('local-human');ws=f['workspace_id'];old=json.loads((root.parent/'evidence/history/initial2/initial-tool-grant.json').read_text());r=s.get_run(p,ws,old['run_id']);ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
provider=AlphaProvider([{'kind':'reply','text':'MUST NOT DISPATCH'}]);w=worker(ctx,provider,root.parent/'worker-state');result=w.work(p,ws,r.id)
assert not provider.calls
with s.db.transaction() as c:
 attempts=c.execute('SELECT t.attempt_id,t.phase,t.request_sha256 FROM responses_steps t JOIN provider_attempts a ON a.id=t.attempt_id WHERE a.run_id=%s',(r.id,)).fetchall()
(root.parent/'evidence/unknown-no-repeat.json').write_text(json.dumps(dict(run_id=r.id,state=result.state,provider_calls=provider.calls,steps=attempts,reason='Controlled callback raised before returning a result; retained unknown, no blind resend'),indent=2))
print('UNKNOWN NO REPEAT',result.state)
