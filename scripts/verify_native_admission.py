#!/usr/bin/env python3
"""Provider-free production-build native-target regression on a disposable DB.

Run once against the intended build before authorizing live review. Use
--expect-disabled with a deliberately flag-disabled build as a negative control.
Does not construct a provider transport, start a dispatcher, or run a model.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from workagent.db import Database
from workagent.service import Service, Principal, digest
from workagent.models import Body, Block, CreateConversation, PostMessage, HumanSave, ProviderGrant, GeneralResponsesBinding, new_id
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.general_responses import PROFILE, POLICY, AUTHORIZATION_HASH, consumer_hash
from workagent.general_schema import DECISION_SCHEMA, EXPLANATION_SCHEMA
from workagent.provider_attempts import configure_grant
import workagent as unused_package  # backend package already loaded above
import importlib.util
spec=importlib.util.spec_from_file_location('local_launcher',ROOT/'scripts/workagent.py')
launcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(launcher)

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--web-root',type=Path,required=True)
 p.add_argument('--out',type=Path,required=True)
 p.add_argument('--expect-disabled',action='store_true')
 a=p.parse_args();out=a.out.resolve();assert not out.exists(),'New output/DB required; preserve prior attempts'
 out.mkdir(parents=True,mode=0o700)
 for port in (3266,8266):
  with socket.socket() as sock:assert sock.connect_ex(('127.0.0.1',port))!=0,'Owned test port occupied'
 env_path=out/'isolated.private.env';env=launcher.environment(env_path)
 # Only explicit fixture/grant provisioning receives the new disposable owner DSN.
 import shlex
 owner={}
 for line in env_path.read_text().splitlines():
  tokens=shlex.split(line)
  for token in tokens:
   if '=' in token:
    k,v=token.split('=',1);owner[k]=v
 env.update(WORKAGENT_WEB_ORIGIN='http://127.0.0.1:3266',WORKAGENT_BACKEND_URL='http://127.0.0.1:8266',NEXT_TELEMETRY_DISABLED='1')
 env.pop('PYTHONPATH',None);env.pop('PYTHONHOME',None)
 db=Database(env['DATABASE_URL']);s=Service(db);who=Principal('local-human');ws='local-workspace'
 def cmd(cls,**kw):return cls(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),**kw)
 cv=s.create_conversation(who,ws,cmd(CreateConversation,title='Controlled native-admission preflight'))
 body=Body(title='Controlled editable work',blocks=[Block(block_id='purpose',kind='paragraph',text='Synthetic wording for a provider-free configuration check.')])
 q=s.post_message(who,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Controlled fixture publication.',operation={'kind':'publish_artifact','body':body.model_dump(mode='json')}))
 GeneralWorker(s,transport=ControlledTransport()).work(who,ws,q.run.id)
 detail=s.get_conversation(who,ws,cv.id);art=s.get_artifact(who,ws,detail.artifact_ids[0])
 body=art.current_revision.body.model_copy(deep=True)
 body.blocks.append(Block(block_id='human-note',kind='protected_note',text='Human fixture note: retain the accessible entrance reminder exactly.'))
 s.human_save(who,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
 art=s.get_artifact(who,ws,art.id);saved=art.current_revision.model_dump(mode='json')
 configure_grant(Database(owner['MIGRATION_DATABASE_URL']),ProviderGrant(id=new_id(),workspace_id=ws,principal_id=who.id,profile=PROFILE,model='gpt-6.1-sol',consumer_sha256=consumer_hash(),expires_at=None,max_runs=1,max_received_output_tokens=16384,responses=GeneralResponsesBinding(project_id='proj_native_preflight_synthetic',secret_reference='file:/nonexistent/native-preflight-no-key',transport_mode='synthetic',instructions_sha256=hashlib.sha256(POLICY.encode()).hexdigest(),schema_sha256=hashlib.sha256(EXPLANATION_SCHEMA.material).hexdigest(),scope_tool_sha256=hashlib.sha256(DECISION_SCHEMA.material).hexdigest(),authorization_sha256=AUTHORIZATION_HASH,conversation_ids=[cv.id])))
 fixture={'fixture_origin':'controlled native-admission preflight','workspace_id':ws,'conversation_id':cv.id,'artifact_id':art.id,'target':{'artifact_id':art.id,'revision_id':art.current_revision_id,'body_hash':art.current_revision.body_hash},'url':f'/conversations/{cv.id}/artifacts/{art.id}','before_message_count':len(detail.messages)}
 (out/'fixture.json').write_text(json.dumps(fixture,indent=2)+'\n')
 children=[];logs=[]
 try:
  for name,args,cwd in [('api',[sys.executable,'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port','8266','--no-proxy-headers'],ROOT/'backend'),('web',['node',str(a.web_root/'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3266'],a.web_root)]:
   log=(out/(name+'.log')).open('wb');logs.append(log);children.append(subprocess.Popen(args,cwd=cwd,env=env,stdout=log,stderr=log,start_new_session=True))
  for _ in range(100):
   assert all(c.poll() is None for c in children),'Owned service exited'
   try:
    if launcher.scoped_ready('http://127.0.0.1:3266'):break
   except (OSError, ValueError, KeyError):pass
   time.sleep(.2)
  else:raise RuntimeError('Readiness failed')
  result=subprocess.run(['node',str(ROOT/'scripts/verify_native_target.mjs'),str(out/'fixture.json'),str(out/'browser.json')],env=env,cwd=ROOT)
  browser=json.loads((out/'browser.json').read_text());detail=s.get_conversation(who,ws,cv.id)
  context_hash=None
  if a.expect_disabled:
   assert result.returncode!=0 and browser['blocked_before_admission']
   assert len(detail.messages)==fixture['before_message_count']
  else:
   assert result.returncode==0 and browser['native_target_present']
   msg=detail.messages[-1];assert msg.target.model_dump()==fixture['target']
   cap=s.claim_run(who,ws,msg.run_id);context=s.conversation_worker_context(cap)
   assert context['target_body']==saved
   context_hash=digest(context)
   with db.transaction() as c:assert c.execute('SELECT data FROM run_contexts WHERE run_id=%s',(msg.run_id,)).fetchone()['data']['context_sha256']==context_hash
  with db.transaction() as c:
   counts={t:c.execute('SELECT count(*) n FROM '+t).fetchone()['n'] for t in ('provider_attempts','responses_steps','responses_events','responses_consumer_uses','proposals')}
  assert all(v==0 for v in counts.values())
  assert s.get_artifact(who,ws,art.id).current_revision.model_dump(mode='json')==saved
  report={'passed':True,'negative_control':a.expect_disabled,'build_id':(a.web_root/'.next/BUILD_ID').read_text().strip(),'native_target_present':browser['native_target_present'],'exact_saved_body_in_context':not a.expect_disabled,'context_hash':context_hash,'provider_counts':counts,'semantic_continuation':False,'fixture_origin':'controlled','candidate_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()}
  (out/'verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
 finally:
  for c in children:
   if c.poll() is None:os.killpg(c.pid,signal.SIGTERM)
  for c in children:
   try:c.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(c.pid,signal.SIGKILL);c.wait()
  for log in logs:log.close()

if __name__=='__main__':main()
