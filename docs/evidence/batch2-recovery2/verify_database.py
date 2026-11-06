"""Read-only identity/schema proof; never emit DSNs or role names."""
import hashlib
import json
import os
from pathlib import Path
from workagent.db import Database

root = Path.cwd()
db = Database(os.environ['DATABASE_URL'])
db.check_runtime_role()
with db.transaction() as c:
    identity = c.execute('SELECT current_database() AS db, current_user AS role').fetchone()
    assert identity['db'].startswith('workagent_test_')
    roles = c.execute('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
    actual = c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    expected = [{'name': p.name, 'checksum': hashlib.sha256(p.read_bytes()).hexdigest()}
                for p in sorted((root / 'backend/migrations').glob('*.sql'))]
    assert actual == expected, 'Schema must exactly match this source'
    tables = ['conversation_documents', 'conversation_intents', 'run_checkpoints', 'work_events']
    for table in tables:
        assert c.execute('SELECT to_regclass(%s) AS relation', ('public.' + table,)).fetchone()['relation']
proof = {
    'database_kind': 'fresh disposable workagent_test_* for recovery2',
    'database_identity_sha256': hashlib.sha256(identity['db'].encode()).hexdigest(),
    'role_identity_sha256': hashlib.sha256(identity['role'].encode()).hexdigest(),
    'runtime_superuser': roles['rolsuper'], 'runtime_bypassrls': roles['rolbypassrls'],
    'migration_checksums_verified': actual,
    'installed_feature_tables': tables,
    'fixture_strategy': 'test_domain.context seeds a fresh synthetic workspace per test; HTTP fixtures use current source on ephemeral loopback ports, not old API18963',
}
(root / '.local/recovery2/database-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
print('Restricted runtime and exact schema verified:', len(actual), 'migrations; no credentials emitted')
