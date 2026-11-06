"""046 -> 047 upgrade with retained work; only fresh disposable databases."""
import hashlib
from pathlib import Path
import shutil
from unittest.mock import patch

from dev_db import provision
from workagent.db import Database,migrate
from workagent.fixture import seed
from workagent.models import new_id
from workagent.service import Service,Principal
from test_conversations import conversation
from test_home_work_summary import artifact


def test_047_upgrade_is_additive_baseline_only_and_repeat_apply_is_noop(tmp_path):
    root=Path(__file__).resolve().parents[1]
    prefix=tmp_path/'prefix'
    (prefix/'workagent').mkdir(parents=True)
    (prefix/'migrations').mkdir()
    paths=sorted((root/'migrations').glob('*.sql'))
    assert any(path.name=='047_work_events.sql' for path in paths)
    # Keep the historical prefix fixed when later additive slices are present.
    for path in paths:
        if path.name < '047_work_events.sql':
            shutil.copyfile(path,prefix/'migrations'/path.name)
    env=tmp_path/'fresh-events.env'
    with patch('workagent.db.__file__',str(prefix/'workagent/db.py')): provision(env)
    values=dict(line.removeprefix('export ').split('=',1) for line in env.read_text().splitlines())
    db=Database(values['DATABASE_URL']); owner=values['MIGRATION_DATABASE_URL']
    ws='test-'+new_id(); p=Principal('local-human')
    seed(owner,[],ws,p.id)
    s=Service(db); ctx=(s,p,ws,[],owner)
    cv=conversation(ctx); aid,rev=artifact(ctx,cv)

    def retained():
        with db.transaction() as c:
            return {table:hashlib.sha256('\n'.join(row['payload'] for row in c.execute(
                'SELECT to_jsonb(t)::text AS payload FROM '+table+' t ORDER BY to_jsonb(t)::text').fetchall()).encode()).hexdigest()
                for table in ('workspaces','memberships','sources','source_access','conversations',
                    'conversation_messages','assignments','artifacts','revisions','proposals','runs',
                    'run_configurations','provider_attempts','responses_steps','responses_events',
                    'responses_budget_carry','commands','audit','outbox')}
    before=retained()
    migrate(owner)
    assert retained()==before
    with db.transaction() as c:
        heads=c.execute('SELECT * FROM work_event_heads').fetchall()
        assert len(heads)==1 and heads[0]['position']==0
        assert c.execute('SELECT count(*) AS n FROM work_events').fetchone()['n']==0
        journal=c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall()
        assert c.execute("SELECT has_table_privilege(current_user,'work_events','SELECT') AS s,has_table_privilege(current_user,'work_events','INSERT') AS i,has_table_privilege(current_user,'work_event_heads','UPDATE') AS u").fetchone()=={'s':True,'i':False,'u':False}
    migrate(owner)
    with db.transaction() as c:
        assert c.execute('SELECT * FROM work_event_heads').fetchall()==heads
        assert c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall()==journal
    assert retained()==before and s.get_artifact(p,ws,aid).current_revision_id==rev.id
