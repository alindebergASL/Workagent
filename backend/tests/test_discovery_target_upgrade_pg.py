"""Post-install 083/084 composition and ordinary runner idempotency."""
import json
import os
from pathlib import Path
from hashlib import sha256
from workagent import db
from test_domain import fixture_database_urls
from test_model_discovery_proposal_install_pg import catalog, rows, ROOT


def test_normal_upgrade_preserves_083_guards_data_and_is_idempotent():
    runtime,owner=fixture_database_urls(os.environ)
    db.Database(runtime).check_runtime_role()
    saved=json.loads((Path(os.environ['TARGET_INTEGRATION_ARTIFACTS'])/'prefix83-catalog-and-data.json').read_text())
    with db.Database(owner).transaction() as c:
        assert catalog(c)==saved['guards']
        before=rows(c)
        assert {n:before[n] for n in saved['data'] if n!='schema_migrations'}=={n:v for n,v in saved['data'].items() if n!='schema_migrations'}
        assert before['model_discovery_receipts_v2']['n']==0
        functions=c.execute("SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1").fetchall()
    db.migrate(owner)
    db.migrate(owner)
    with db.Database(owner).transaction() as c:
        assert rows(c)==before
        assert c.execute("SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1").fetchall()==functions
        expected={p.name:sha256(p.read_bytes()).hexdigest() for p in (ROOT/'migrations').glob('*.sql')}
        assert {r['name']:r['checksum'] for r in c.execute('SELECT name,checksum FROM schema_migrations').fetchall()}==expected
    (Path(os.environ['TARGET_INTEGRATION_ARTIFACTS'])/'upgrade-idempotency.json').write_text(json.dumps({'passed':True,'normal_migrate_repeats':2,'preserved_083_guards':saved['guards'],'prior_tables_unchanged':len(saved['data'])-1,'all_public_functions_unchanged_on_repeat':len(functions),'journal_rows':len(expected)},indent=2,sort_keys=True)+'\n')
