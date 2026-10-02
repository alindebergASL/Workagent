import hashlib
import os
from contextlib import contextmanager
from pathlib import Path
import psycopg
from psycopg.rows import dict_row

class Database:
    def __init__(self, dsn=None):
        self.dsn = dsn or os.environ['DATABASE_URL']

    @contextmanager
    def transaction(self):
        with psycopg.connect(self.dsn, row_factory=dict_row) as conn:
            conn.execute("SET LOCAL statement_timeout = '15s'")
            yield conn

    def check_runtime_role(self):
        with self.transaction() as c:
            row = c.execute("SELECT r.rolsuper, r.rolbypassrls, pg_get_userbyid(d.datdba) = current_user AS owns_db FROM pg_roles r, pg_database d WHERE r.rolname = current_user AND d.datname = current_database()").fetchone()
            owns_tables = c.execute("SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user LIMIT 1").fetchone()
            if row['rolsuper'] or row['rolbypassrls'] or row['owns_db'] or owns_tables:
                raise RuntimeError('Runtime database role must not own the database/tables or bypass authorization.')


def migrate(dsn=None):
    db = Database(dsn)
    with db.transaction() as c:
        c.execute('SELECT pg_advisory_xact_lock(17402111)')
        c.execute('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
        files = sorted((Path(__file__).resolve().parents[1] / 'migrations').glob('*.sql'))
        applied = c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
        if [r['name'] for r in applied] != [p.name for p in files[:len(applied)]]:
            raise RuntimeError('Migration journal is not a known exact prefix')
        for p in files:
            digest = hashlib.sha256(p.read_bytes()).hexdigest()
            previous = c.execute('SELECT checksum FROM schema_migrations WHERE name=%s', (p.name,)).fetchone()
            if previous:
                if previous['checksum'] != digest:
                    raise RuntimeError('Migration checksum drift: ' + p.name)
                continue
            c.execute(p.read_text())
            c.execute('INSERT INTO schema_migrations(name,checksum) VALUES (%s,%s)', (p.name,digest))

if __name__ == '__main__':
    migrate()
