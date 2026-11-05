"""Fast migration-runner sequencing; real PostgreSQL coverage lives alongside it."""
from contextlib import contextmanager
from types import SimpleNamespace
import pytest
import workagent.db as module


def test_file_local_namespace_is_reset_without_transaction_split(tmp_path, monkeypatch):
    directory=tmp_path/'migrations';directory.mkdir()
    first="SET LOCAL search_path=pg_catalog; SELECT 'first';"
    second="CREATE FUNCTION migration_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';"
    (directory/'001_first.sql').write_text(first)
    (directory/'002_second.sql').write_text(second)
    monkeypatch.setattr(module,'__file__',str(tmp_path/'workagent/db.py'))
    calls=[];transactions=[]
    class Connection:
        def execute(self,query,params=()):
            calls.append((query,params))
            return SimpleNamespace(fetchall=lambda:[],fetchone=lambda:None)
    @contextmanager
    def transaction(self):
        transactions.append('begin')
        try:yield Connection()
        except BaseException:
            transactions.append('rollback');raise
        else:transactions.append('commit')
    monkeypatch.setattr(module.Database,'transaction',transaction)
    module.migrate('offline-only')
    assert transactions==['begin','commit']
    queries=[q for q,_ in calls]
    assert queries.count('SELECT pg_advisory_xact_lock(17402111)')==1
    for body in (first,second):
        i=queries.index(body)
        assert queries[i-1]=='SET LOCAL search_path = public, pg_temp'
        assert queries[i+1].startswith('INSERT INTO public.schema_migrations(')
    assert all('public.schema_migrations' in q for q in queries if 'schema_migrations' in q)
    assert queries[0]=='SET LOCAL search_path = public, pg_temp'


def test_pending_sql_error_keeps_single_rollback(tmp_path, monkeypatch):
    directory=tmp_path/'migrations';directory.mkdir()
    (directory/'001_first.sql').write_text('FIRST;')
    (directory/'002_fail.sql').write_text('FAIL;')
    monkeypatch.setattr(module,'__file__',str(tmp_path/'workagent/db.py'))
    calls=[];ends=[]
    class Connection:
        def execute(self,query,params=()):
            calls.append((query,params))
            if query=='FAIL;':raise ValueError('SQL failed')
            return SimpleNamespace(fetchall=lambda:[],fetchone=lambda:None)
    @contextmanager
    def transaction(self):
        try:yield Connection()
        except BaseException:
            ends.append('rollback');raise
        else:ends.append('commit')
    monkeypatch.setattr(module.Database,'transaction',transaction)
    with pytest.raises(ValueError,match='SQL failed'):module.migrate('offline-only')
    assert ends==['rollback']
    receipts=[params[0] for q,params in calls if q.startswith('INSERT INTO public.schema_migrations')]
    assert receipts==['001_first.sql']  # Pending receipt is in that SAME rollback.
