"""Accepted052 source/data -> additive053, including the EXISTING runtime role."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

from workagent.db import Database,migrate
from workagent.responses_ledger import summary
from test_domain import context as context_fixture
from test_capability_gateway import setup
from workagent.capabilities.broker import CapabilityBroker


BASE='26e599b3db8a61b73eeeaea4f87a1d3de0b296d9'
TABLES=('workspaces','memberships','sources','source_access','assignments','artifacts','revisions','runs',
        'provider_grants','provider_attempts','responses_steps','responses_events','run_contexts','run_configurations',
        'responses_budget_carry','conversation_messages','work_events','run_checkpoints')


def snapshot(db):
    with db.transaction() as c:
        return {table:sorted(json.dumps(r['row'],sort_keys=True,default=str) for r in
            c.execute(f'SELECT row_to_json(t) AS row FROM {table} t').fetchall()) for table in TABLES}


def test_052_upgrade_preserves_human_work_receipts_money_and_existing_role(tmp_path,monkeypatch):
    root=Path(__file__).resolve().parents[2]; accepted=tmp_path/'accepted';accepted.mkdir()
    archive=subprocess.run(['git','archive',BASE,'backend','fixtures','runtime','agent','contracts'],cwd=root,
                           check=True,capture_output=True).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tf: tf.extractall(accepted,filter='data')
    envfile=tmp_path/'upgrade.private.env'; receipt=tmp_path/'historical-summary.json'
    # Execute the actual accepted source, not a facade over new code/old tables.
    script="""
import os,sys,json
from pathlib import Path
from dev_db import provision
provision(sys.argv[1])
values=dict(line.removeprefix('export ').split('=',1) for line in Path(sys.argv[1]).read_text().splitlines())
os.environ.update(values)
from test_domain import context,ready,cmd
from test_alpha_budget import prepared,count,reserve
from workagent.models import HumanSave,Body,Block,new_id
from workagent.db import Database
from workagent.budget_carryforward import install_carry
from workagent.responses_ledger import summary
ctx=context.__wrapped__();s,p,ws,_,admin=ctx
a,artifact=ready(ctx)
s.human_save(p,ws,artifact.id,cmd(HumanSave,expected_current_revision_id=artifact.current_revision_id,
    body=Body(title='Protected human note',blocks=[Block(block_id='human',kind='paragraph',text='Synthetic retained human acceptance must survive upgrade.')])) )
ctx=context.__wrapped__();project='proj_upgrade_'+new_id()
install_carry(Database(ctx[4]),project_id=project,transport_mode='synthetic',source_database='synthetic_historical_source',
    source_grant_id=new_id(),source_manifest_sha256='b'*64,reserved_cost_usd='1')
g,f,x=prepared(ctx,Path(sys.argv[2]).parent/'old-worker',project=project)
count(x,f);reserve(x,'dispatch')
with ctx[0].db.transaction() as c:
    totals=summary(c,g.id,shared=True)
    assert totals['unknown_usage_steps']==1
Path(sys.argv[2]).write_text(json.dumps({'grant_id':g.id,'summary':totals}))
"""
    env={**os.environ,'PYTHONPATH':str(accepted/'backend')+os.pathsep+str(accepted/'backend/tests')}
    run=subprocess.run([sys.executable,'-c',script,str(envfile),str(receipt)],cwd=accepted,env=env,
                       capture_output=True,text=True,timeout=120)
    assert run.returncode==0,run.stdout+run.stderr
    values=dict(line.removeprefix('export ').split('=',1) for line in envfile.read_text().splitlines())
    for key,value in values.items():monkeypatch.setenv(key,value)
    db=Database(values['DATABASE_URL']);db.check_runtime_role();before=snapshot(db)
    historical=json.loads(receipt.read_text())
    with db.transaction() as c: assert c.execute("SELECT to_regclass('public.tool_attempts') AS name").fetchone()['name'] is None
    migrate(values['MIGRATION_DATABASE_URL']);migrate(values['MIGRATION_DATABASE_URL'])
    assert snapshot(db)==before
    db.check_runtime_role()
    with db.transaction() as c:
        assert summary(c,historical['grant_id'],shared=True)==historical['summary']
        for table in ('capability_installations','tool_budget_accounts','tool_grants','tool_attempts','tool_attempt_events','tool_cost_entries'):
            assert c.execute('SELECT has_table_privilege(current_user,%s,\'SELECT\') AS ok',(table,)).fetchone()['ok']
            assert not c.execute('SELECT has_table_privilege(current_user,%s,\'INSERT\') AS ok',(table,)).fetchone()['ok']
    # New functionality works using the SAME runtime principal, not a fresh broad role.
    ctx=context_fixture.__wrapped__();cap,g,call,q=setup(ctx)
    assert CapabilityBroker(ctx[0],cap).call(call).status=='observed'
