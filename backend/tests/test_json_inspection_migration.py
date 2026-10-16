"""Exact031 upgrade with synthetic saved human work; private disposable DB only."""
import hashlib
import json
import shutil
from pathlib import Path
from unittest.mock import patch
from dev_db import provision
from workagent.db import Database,migrate
from workagent.fixture import seed
from workagent.service import Service,Principal
from workagent.models import HumanSave,new_id
from test_domain import ACTOR,cmd
from test_work_area_context import saved,document


def test_exact_031_upgrade_preserves_saved_history_and_runtime_acl(tmp_path):
    root=Path(__file__).resolve().parents[1];prefix=tmp_path/'prefix'
    (prefix/'workagent').mkdir(parents=True);(prefix/'migrations').mkdir()
    paths=sorted((root/'migrations').glob('*.sql'))
    assert paths[31].name=='032_json_inspection.sql'
    for path in paths[:31]:shutil.copyfile(path,prefix/'migrations'/path.name)
    env=tmp_path/'upgrade.env'
    with patch('workagent.db.__file__',str(prefix/'workagent/db.py')):provision(env)
    values=dict(line.removeprefix('export ').split('=',1) for line in env.read_text().splitlines())
    db=Database(values['DATABASE_URL']);owner=values['MIGRATION_DATABASE_URL'];p=Principal('local-human');ws='test-'+new_id()
    seed(owner,json.loads(ACTOR.read_text()),ws,p.id)
    s=Service(db);ctx=(s,p,ws,[],owner);cv,a=saved(ctx)
    a=s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=document('Exact human correction; keep this saved work.')))
    def snapshots():
        with db.transaction() as c:
            c.execute('SET TRANSACTION READ ONLY')
            journal=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
            digests={table:hashlib.sha256('\n'.join(row['payload'] for row in c.execute(
                'SELECT to_jsonb(t)::text payload FROM '+table+' t ORDER BY to_jsonb(t)::text').fetchall()).encode()).hexdigest()
                for table in ('sources','artifacts','revisions','conversations','conversation_messages','runs','run_configurations')}
        return journal,digests
    before,hashes=snapshots();assert len(before)==31
    migrate(owner);migrate(owner)
    after,updated=snapshots();assert after[:31]==before and len(after)==len(paths) and updated==hashes
    assert s.get_artifact(p,ws,a.id).current_revision_id==a.current_revision_id
    db.check_runtime_role()
    with db.transaction() as c:
        assert c.execute("SELECT has_table_privilege(current_user,'responses_events','INSERT') AS i,has_table_privilege(current_user,'responses_events','UPDATE') AS u,has_table_privilege(current_user,'responses_events','DELETE') AS d").fetchone()=={'i':True,'u':False,'d':False}
        triggers={r['tgname'] for r in c.execute("SELECT tgname FROM pg_trigger WHERE tgrelid='responses_events'::regclass AND NOT tgisinternal").fetchall()}
        assert {'json_inspection_guard','alpha_stage_guard','work_context_search_guard','companion_view_scope_guard'}<=triggers
