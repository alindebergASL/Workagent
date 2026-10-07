"""Actual predecessor provisioning -> additive upgrade, under runtime role."""
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
from workagent.db import Database,migrate
from workagent.fixture import seed
from workagent.models import *
from workagent.product_models import RunWasm,InputField
from workagent.service import Service,Principal
from workagent.general_worker import GeneralWorker,ControlledTransport

ROOT=Path(__file__).resolve().parents[2]

def test_predecessor_runtime_gets_only_new_observation_privileges(tmp_path):
    archive=subprocess.check_output(['git','archive','9a8944b','backend','runtime','agent'],cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(tmp_path,filter='data')
    path=tmp_path/'predecessor.env'
    child=subprocess.run([sys.executable,str(tmp_path/'backend/dev_db.py'),'--env-file',str(path)],cwd=tmp_path,
        env={**os.environ,'PYTHONPATH':str(tmp_path/'backend')},capture_output=True,text=True)
    assert child.returncode==0,'predecessor provisioning failed (details withheld to avoid credential disclosure)'
    env={}
    for line in path.read_text().splitlines():
        key,value=shlex.split(line)[1].split('=',1); env[key]=value
    admin=env['MIGRATION_DATABASE_URL']; runtime=env['DATABASE_URL']
    assert '/workagent_test_' in admin
    with Database(admin).transaction() as c:
        before=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
        assert before[-1]['name']=='009_conversations.sql'
    migrate(admin)
    migrate(admin)  # exact checksum replay is no-op
    with Database(admin).transaction() as c:
        after=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
        assert after[:len(before)]==before
        assert [row['name'] for row in after[len(before):]]==['010_general_products.sql','011_general_responses.sql','012_adaptive_execution.sql']
    db=Database(runtime); db.check_runtime_role()
    with db.transaction() as c:
        rights=c.execute("SELECT has_table_privilege(current_user,'product_observations','SELECT') s, has_table_privilege(current_user,'product_observations','INSERT') i, has_table_privilege(current_user,'product_observations','UPDATE') u, has_table_privilege(current_user,'product_observations','DELETE') d").fetchone()
        assert rights=={'s':True,'i':True,'u':False,'d':False}
    ws='upgrade-'+new_id(); p=Principal('local-human')
    seed(admin,json.loads((ROOT/'fixtures/actor/solo-v0.1/initial_records.json').read_text()),ws,p.id)
    s=Service(db)
    def cmd(cls,**kw):
        return cls(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),**kw)
    cv=s.create_conversation(p,ws,cmd(CreateConversation))
    op=RunWasm(kind='run_wasm',code=(ROOT/'fixtures/general-work/invoice-total.wat').read_text(),arguments=[3,1250],
        input_form=[InputField(name='q',label='Quantity'),InputField(name='p',label='Cents')])
    admitted=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=1,text='Check upgraded local tool',operation=op))
    result=GeneralWorker(s,transport=ControlledTransport()).work(p,ws,admitted.run.id)
    assert result.state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    product=detail.messages[-1].result.results[1]
    assert s.get_product_observation(p,ws,product.observation_id).observation.output.value==3750
