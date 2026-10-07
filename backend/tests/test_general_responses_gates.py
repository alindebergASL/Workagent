"""DB and CLI authority gates for the additive general profile; synthetic only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from unittest.mock import patch
import psycopg
import pytest
from pydantic import ValidationError
from test_domain import context,cmd,PrivateDsn,ACTOR
from test_general_responses import activate,Provider,worker,setup,totals
from test_conversations import conversation,post
from test_general_products import execute,csvop
from workagent.models import *
from workagent.service import Service,Principal,WorkerCapability,encoded
from workagent.db import Database,migrate
from workagent.provider_attempts import ReceiptCapability,configure_grant
from workagent.responses_ledger import Ledger
from workagent.general_responses import verify_route_record
from workagent.responses_transport import TransportError
from dev_db import provision


def test_retrieval_80_cancel_zero_sql_and_application(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path)
    def crash(name):
        if name=='before_publication':raise RuntimeError('before publication')
    w.phases.hook=crash
    with pytest.raises(RuntimeError):w.work(p,ws,q.run.id)
    saved=w.phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**saved['worker']); receipt=ReceiptCapability(**saved['receipt'])
    ledger=Ledger(s,receipt); request,_=ledger.snapshot('final',cap)
    for _ in range(80): ledger.reserve_operation(request,'read',cap)
    from test_domain import raises
    raises('budget_exhausted',lambda:ledger.reserve_operation(request,'read',cap))
    raises('budget_exhausted',lambda:ledger.reserve_operation(request,'cancel',cap))
    for kind in ('read','cancel'):
        with pytest.raises(psycopg.Error,match='cumulative request limit'):
            with s.db.transaction() as c:
                c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,'final',%s,'{}')",(new_id(),receipt.attempt_id,kind))
    assert totals(s,g)['request_counts']['read']==80
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert len(fake.calls)==4  # reservations themselves never call the provider


def test_predispatch_revoke_blocks_send_and_keeps_reservation(context,tmp_path):
    from workagent.provider_attempts import revoke_grant
    s,p,ws,_,admin=context
    cv,g,fake,q,w=setup(context,tmp_path)
    def revoke(name):
        if name=='after_predispatch':revoke_grant(Database(admin),g.id)
    w.phases.hook=revoke
    with pytest.raises(Exception):w.work(p,ws,q.run.id)
    assert len(fake.responses)==0 and len(fake.calls)==1
    assert totals(s,g)['request_counts']['dispatch']==1
    assert totals(s,g)['reserved_input_tokens']==20000
    with pytest.raises(Exception):worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert len(fake.calls)==1


def test_versioned_expiry_and_raw_grant_guards(context):
    from datetime import timedelta
    s,p,ws,_,admin=context
    cv=conversation(context); g=activate(context,[cv]); raw=g.model_dump(mode='json')
    for mutate in [lambda x:x.update(expires_at=(now()+timedelta(minutes=5)).isoformat()),
                   lambda x:x['responses'].update(count_limit=9),lambda x:x['responses'].update(input_limit=200000)]:
        bad=json.loads(json.dumps(raw)); bad['id']=new_id(); mutate(bad)
        with pytest.raises(ValidationError):ProviderGrant.model_validate(bad)
        with pytest.raises(psycopg.Error):
            with Database(admin).transaction() as c:
                c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,active,data) VALUES (%s,%s,%s,false,%s)',(bad['id'],ws,p.id,encoded(bad)))
    historical=ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,model='historical-model',consumer_sha256='0'*64,expires_at=now()+timedelta(minutes=15))
    with pytest.raises(ValidationError):ProviderGrant.model_validate(historical.model_dump()|{'expires_at':None})
    assert historical.expires_at is not None
    with pytest.raises(TransportError):verify_route_record({})
    live=g.model_copy(update={'responses':g.responses.model_copy(update={'transport_mode':'official_api'})})
    with pytest.raises(TransportError):configure_grant(Database(admin),live)


def test_raw_immutable_attachments_and_forged_observation(context,tmp_path):
    s,p,ws,_,_=context
    cv,g,fake,q,w=setup(context,tmp_path)
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute("UPDATE conversation_messages SET data=jsonb_set(data,'{attachments,0,content}','\"forged\"') WHERE workspace_id=%s",(ws,))
    # The runtime does not receive UPDATE permission for this immutable ledger.
    assert w.work(p,ws,q.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    item=detail.messages[-1].result.results[1]
    record=s.get_product_observation(p,ws,item.observation_id).observation.model_dump(mode='json')
    record['id']=new_id(); record['output']['expected_sum']='999.99'
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute('INSERT INTO product_observations(workspace_id,id,run_id,artifact_id,data) VALUES (%s,%s,%s,%s,%s)',(ws,record['id'],q.run.id,item.artifact_id,encoded(record)))


def test_general_cli_admission_is_prompt_attachment_no_operator(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,[cv]); path=tmp_path/'invoices.csv'; path.write_text('id,quantity,unit_price,reported_total\nA,1,10,10\n')
    process=subprocess.run([sys.executable,'-m','workagent.prompt_cli','--general-responses','--workspace',ws,
        'continue',cv.id,'Reconcile this CSV','--attach',str(path)],capture_output=True,text=True,env=os.environ)
    assert process.returncode==0,process.stderr
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.messages)==1 and detail.runs[0].profile=='general-responses-v1'
    assert detail.messages[0].operation is None and detail.messages[0].attachments[0].content==path.read_text()
    assert detail.turns[0].provider_observation=='not_observed'
    with s.db.transaction() as c: assert c.execute('SELECT count(*) n FROM provider_attempts WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
    assert worker(context,Provider(),tmp_path).work(p,ws,detail.runs[0].id).state=='ready'


def test_general_http_payload_and_honest_projection(context,tmp_path):
    from fastapi.testclient import TestClient
    from workagent.api import create_app,Settings
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,[cv])
    with TestClient(create_app(Settings(s.db.dsn,True,'general-synthetic-token-do-not-use-live',p.id))) as client:
        headers={'Authorization':'Bearer general-synthetic-token-do-not-use-live','X-Schema-Version':'workagent/v1','X-Request-Id':'general-test'}
        path=f'/v1/workspaces/{ws}/conversations/{cv.id}/messages'
        payload=cmd(PostMessage,expected_work_version=cv.work_version,text='Hello').model_dump(mode='json')
        forged=payload|{'attachments':[{'filename':'input.txt','mime_type':'text/plain','content':'synthetic','ref':'forged'}]}
        assert client.post(path,headers=headers,json=forged).status_code==422
        accepted=client.post(path,headers=headers,json=payload)
        assert accepted.status_code==202,accepted.text
        receipt=accepted.json(); assert receipt['run']['profile']=='general-responses-v1'
        assert receipt['conversation']['model_activation']=='active'
        worker(context,Provider(),tmp_path).work(p,ws,receipt['run']['id'])
        detail=client.get(f'/v1/workspaces/{ws}/conversations/{cv.id}',headers=headers).json()
        assert detail['turns'][0]['provider_observation']=='received'
        assert detail['messages'][-1]['evidence_origin']=='synthetic_provider_receipt'
        assert detail['messages'][-1]['model_receipt']


def test_exact_010_upgrade_preserves_records_hashes_and_minimal_acl(tmp_path):
    # Provision ONLY via dev_db. All databases are new; no adopted review state.
    root=Path(__file__).resolve().parents[1]
    prefix=tmp_path/'prefix'; (prefix/'workagent').mkdir(parents=True); (prefix/'migrations').mkdir()
    for path in sorted((root/'migrations').glob('*.sql'))[:10]:shutil.copyfile(path,prefix/'migrations'/path.name)
    env=tmp_path/'upgrade.env'
    with patch('workagent.db.__file__',str(prefix/'workagent/db.py')): provision(env)
    values=dict(line.removeprefix('export ').split('=',1) for line in env.read_text().splitlines())
    owner=PrivateDsn(values['MIGRATION_DATABASE_URL']); runtime=PrivateDsn(values['DATABASE_URL'])
    from workagent.fixture import seed
    from datetime import timedelta
    ws='upgrade-'+new_id(); p=Principal('local-human'); seed(owner,json.loads(ACTOR.read_text()),ws,p.id)
    s=Service(Database(runtime)); ctx=(s,p,ws,[],owner)
    detail,products=execute(ctx,csvop()); artifact=s.get_artifact(p,ws,products[0].artifact_id)
    historical=ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,model='synthetic-historical',consumer_sha256='a'*64,expires_at=now()+timedelta(minutes=20))
    configure_grant(Database(owner),historical)
    with Database(owner).transaction() as c:
        assert c.execute('SELECT count(*) n FROM schema_migrations').fetchone()['n']==10
        before=c.execute('SELECT data FROM provider_grants WHERE id=%s',(historical.id,)).fetchone()['data']
        migrations=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    migrate(owner);migrate(owner)
    with Database(runtime).transaction() as c:
        assert c.execute('SELECT data FROM provider_grants WHERE id=%s',(historical.id,)).fetchone()['data']==before
        assert c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name LIMIT 10').fetchall()==migrations
        assert c.execute('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').fetchone()['name']=='012_adaptive_execution.sql'
        for table in ('conversation_messages','product_observations','responses_events'):
            assert c.execute("SELECT has_table_privilege(current_user,%s,'INSERT') i,has_table_privilege(current_user,%s,'UPDATE') u,has_table_privilege(current_user,%s,'DELETE') d",(table,table,table)).fetchone()=={'i':True,'u':False,'d':False}
    after=s.get_artifact(p,ws,artifact.id)
    assert after.current_revision.body_hash==artifact.current_revision.body_hash and after.current_revision.body==artifact.current_revision.body
    s.db.check_runtime_role()


@pytest.mark.parametrize('change',['cancel','revoke','membership'])
def test_raw_sql_publication_rechecks_authority(context,tmp_path,change):
    from workagent.provider_attempts import revoke_grant
    s,p,ws,_,admin=context
    cv,g,fake,q,w=setup(context,tmp_path)
    def crash(name):
        if name=='before_publication': raise RuntimeError('retain before commit')
    w.phases.hook=crash
    with pytest.raises(RuntimeError): w.work(p,ws,q.run.id)
    saved=w.phases.state.load(ws,q.run.id); attempt=saved['receipt']['attempt_id']
    with s.db.transaction() as c:
        text=c.execute("SELECT data->'value'->>'text' text FROM responses_events WHERE attempt_id=%s AND phase='final' AND kind='result'",(attempt,)).fetchone()['text']
    if change=='cancel': s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
    elif change=='revoke': revoke_grant(Database(admin),g.id)
    else:
        with Database(admin).transaction() as c: c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    message=ConversationMessage(id=new_id(),conversation_id=cv.id,run_id=q.run.id,sequence=2,author_id='general-worker',author_kind='assistant',text=text,
        evidence_origin='synthetic_provider_receipt',model_receipt=attempt,result=TurnResult(results=[TextResult(text=text)]))
    with pytest.raises(psycopg.Error,match='authority required'):
        with s.db.transaction() as c: s._append_message(c,ws,message)
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM conversation_messages WHERE run_id=%s AND author_kind='assistant'",(q.run.id,)).fetchone()['n']==0


def test_legacy_post_command_hash_and_replay_unchanged(context):
    from workagent.service import digest
    s,p,ws,_,_=context; cv=conversation(context)
    command=cmd(PostMessage,expected_work_version=1,text='Original controlled message')
    result=s.post_message(p,ws,cv.id,command)
    payload=command.model_dump(mode='json',exclude={'request_id','command_id','attachments','target','operation'})
    old_hash=digest({'operation':'post_message','arguments':{'conversation_id':cv.id},'payload':payload})
    with s.db.transaction() as c:
        assert c.execute('SELECT payload_hash FROM commands WHERE workspace_id=%s AND command_id=%s',(ws,command.command_id)).fetchone()['payload_hash']==old_hash
    restarted=Service(Database(s.db.dsn))
    assert restarted.post_message(p,ws,cv.id,command.model_copy(update={'request_id':new_id()})).run.id==result.run.id


@pytest.mark.parametrize('decision',[
    {'decision':{'kind':'send_email','text':'no'}},
    {'decision':{'kind':'reply','text':'ok','execution_observed':True}},
    {'decision':{'kind':'reconcile_csv','attachment':{'ref':'input','sha256':'bad'},'target':None,'rounding':'ROUND_HALF_UP'}},
    {'decision':{'kind':'reconcile_csv','attachment':None,'target':None,'rounding':'ROUND_HALF_UP','input_csv':'fabricated'}},
    {'decision':{'kind':'reply','text':'ok'},'permission':'all'},
])
def test_general_closed_schema_denies_untrusted_authority_and_repair(decision):
    from workagent.general_schema import DECISION_SCHEMA
    with pytest.raises(TransportError): DECISION_SCHEMA.validate(json.dumps(decision))


def test_grant_draft_pins_and_exclusive_cli_write_without_credentials(tmp_path):
    from general_grant_draft import draft
    from workagent.general_responses import PROFILE,AUTHORIZATION_HASH,consumer_hash
    record={'grant_id':'operator-draft-only','runtime':{'model':'gpt-6.1-sol','profile':PROFILE,
        'product_project_id':'proj_synthetic_test','secure_secret_reference':'file:/not-read-by-draft'},
        'verification':{'checked_at':now().isoformat(),'model':'gpt-6.1-sol','official_origin':'https://api.openai.com',
        'account_available':True,'model_available':True,'synthetic_context_confirmed':True,'service_tier':'default',
        'store_acknowledged':True,'input_usd_per_million':'2.5','output_usd_per_million':'10','authorization_sha256':AUTHORIZATION_HASH}}
    grant=draft(record,'synthetic-workspace','local-human',['synthetic-conversation'])
    assert grant.consumer_sha256==consumer_hash() and grant.expires_at is None and grant.max_runs==4
    path=tmp_path/'route.json'; path.write_text(json.dumps(record)); output=tmp_path/'draft.json'
    command=[sys.executable,str(Path(__file__).resolve().parents[1]/'general_grant_draft.py'),'--authority-record',str(path),
        '--workspace','synthetic-workspace','--principal','local-human','--conversation','synthetic-conversation','--out',str(output)]
    env={k:v for k,v in os.environ.items() if k not in ('DATABASE_URL','MIGRATION_DATABASE_URL') and 'OPENAI' not in k}
    result=subprocess.run(command,env=env,capture_output=True,text=True,timeout=20)
    assert result.returncode==0 and 'no grant installed' in result.stdout
    assert ProviderGrant.model_validate_json(output.read_text())==grant and output.stat().st_mode & 0o777==0o600
    assert subprocess.run(command,env=env,capture_output=True,timeout=20).returncode==2
