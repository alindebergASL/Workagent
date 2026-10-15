"""Real prefix upgrade and new-candidate prompt projection; synthetic only."""
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch
import json
import shutil
import pytest
from test_domain import context
from test_conversations import conversation,post
from test_general_alpha_runtime import activate,AlphaProvider
from test_general_responses import worker
from workagent.db import migrate
from workagent.composition import discovery,context_catalog,DECISION_SCHEMA
from workagent.responses_ledger import summary


def test_catalog_projection_preserves_scopes_skills_and_explicit_schemas():
    full=discovery();compact=context_catalog()
    assert compact=={**full,'capabilities':[{k:v for k,v in item.items() if k!='input_schema'} for item in full['capabilities']]}
    assert len(json.dumps(compact))<len(json.dumps(full))
    assert all(item['input_schema'] for item in full['capabilities'] if item['availability']=='available')


def test_actual_request_keeps_full_tool_schema_without_duplicate_in_context(context,tmp_path):
    s,p,ws,_,_=context;cv=conversation(context);activate(context,cv)
    q=post(context,cv,'Explain a reversible decision.')
    fake=AlphaProvider([{'kind':'reply','text':'A reversible decision can be changed after learning more.'}])
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    with s.db.transaction() as c:
        request=json.loads(c.execute("SELECT request_bytes FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.run_id=%s AND s.phase='selection'",(q.run.id,)).fetchone()['request_bytes'])
    assert request['tools'][0]['parameters']==DECISION_SCHEMA.model.model_json_schema()
    offered=json.loads(request['input'][0]['content'])
    assert 'tools' not in offered  # Worker never duplicates provider tool schemas in user context.
    assert offered['composition']==context_catalog()
    assert offered['messages'][0]['text']=='Explain a reversible decision.'


@pytest.mark.parametrize('cutoff',['029','030'])
def test_prefix_upgrade_preserves_authority_and_history(tmp_path,monkeypatch,cutoff):
    from dev_db import provision
    from test_domain import context as fixture
    from test_alpha_budget import prepared,count,reserve
    root=Path(__file__).resolve().parents[1]
    prefix=tmp_path/'prefix';(prefix/'workagent').mkdir(parents=True);(prefix/'migrations').mkdir()
    for source in sorted((root/'migrations').glob('*.sql')):
        if source.name<cutoff:shutil.copyfile(source,prefix/'migrations'/source.name)
    def old_migrate(dsn):
        with patch('workagent.db.__file__',str(prefix/'workagent/db.py')):migrate(dsn)
    env=tmp_path/'upgrade.env'
    with patch('dev_db.migrate',old_migrate):provision(env)
    for line in env.read_text().splitlines():
        key,value=line.removeprefix('export ').split('=',1);monkeypatch.setenv(key,value)
    ctx=fixture.__wrapped__();g,f,x=prepared(ctx,tmp_path/'old');count(x,f);reserve(x,'dispatch')
    def snapshot():
        with ctx[0].db.transaction() as c:
            return {table:c.execute('SELECT to_jsonb(t) row FROM '+table+' t ORDER BY to_jsonb(t)::text').fetchall()
                    for table in ('provider_grants','runs','run_configurations','run_contexts','provider_attempts','responses_steps','responses_events')}
    before=snapshot();migrate(ctx[4]);migrate(ctx[4]);assert snapshot()==before
    ctx[0].db.check_runtime_role()
    with ctx[0].db.transaction() as c:
        expected=[{'name':p.name,'checksum':sha256(p.read_bytes()).hexdigest()} for p in sorted((root/'migrations').glob('*.sql'))]
        assert c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()==expected
