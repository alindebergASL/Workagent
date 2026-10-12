import os,sys,json,hashlib,subprocess,socket
from pathlib import Path
import psycopg
ROOT=Path('/home/ubuntu/workagent-general-continuation-review');OUT=ROOT/'.local/general-continuation-breadth'
sys.path.insert(0,str(ROOT/'scripts'));import workagent
workagent.PYTHON=Path('/home/ubuntu/workagent-flexible-work/backend/.venv/bin/python')
env=workagent.environment(ROOT/'.local/general-continuation-breadth.env')
r=json.loads((OUT/'verification.json').read_text());s=json.loads((OUT/'source.json').read_text())
with psycopg.connect(env['DATABASE_URL']) as c:
    db=c.execute('select current_database()').fetchone()[0]
    assert db=='workagent_test_ae55e72eba85'
    proposal=c.execute("select id,data->>'status',data->>'accepted_revision_id' from proposals where id=%s",(r['final_proposals'][0]['id'],)).fetchone()
    current=c.execute('select current_revision_id from artifacts where id=%s',(r['artifact_id'],)).fetchone()[0]
    counts={t:c.execute('select count(*) from '+t).fetchone()[0] for t in ['conversations','runs','provider_attempts','proposals']}
ports={}
for p in [3175,8175]:
    with socket.socket() as sock: ports[str(p)]=sock.connect_ex(('127.0.0.1',p))!=0
scope={'database':db,'postgresql_readback':{'proposal_id':str(proposal[0]),'status':proposal[1],'accepted_revision_id':proposal[2],'current_revision_id':str(current)},'isolated_database_counts_including_harness_retries':counts,'owned_ports_closed':ports,'owned_pids_remaining':[x['pid'] for x in json.loads((OUT/'owned-processes.json').read_text()) if Path('/proc/'+str(x['pid'])).exists()],'original_source_file_sha256_unchanged':hashlib.sha256(Path(s['source_file']).read_bytes()).hexdigest()==s['source_file_sha256'],'tracked_diff_empty':not subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT,text=True).strip(),'git_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'original_database_access':'Not opened, compared, modified, or granted. Only the newly provisioned isolated database was accessed. No global original-DB immutability assertion: parent live work is concurrent.','expected_formula':s['formula'],'independent_python_expected_integer':137*12*75//100,'source_code_sha256':s['source_code_sha256']}
assert proposal[1]=='pending' and proposal[2] is None and str(current)==r['saved_revision_id']
assert counts['provider_attempts']==0 and all(ports.values()) and not scope['owned_pids_remaining']
assert scope['original_source_file_sha256_unchanged'] and scope['tracked_diff_empty']
(OUT/'scope-and-cleanup.json').write_text(json.dumps(scope,indent=2)+'\n')
print(json.dumps({'passed':r['passed'],'conversation_id':r['conversation_id'],'artifact_id':r['artifact_id'],'pending_proposal_id':proposal[0],'actual_ui_result':r['actual_ui_result'],'scope':scope},indent=2,default=str))
