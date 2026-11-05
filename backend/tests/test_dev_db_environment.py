"""Exercise fixture environment generation without provisioning any database."""
import os
import shlex
from unittest.mock import MagicMock, Mock

import dev_db
from test_domain import fixture_database_urls


def test_generated_environment_satisfies_exact_fixture_binding(tmp_path, monkeypatch):
    monkeypatch.setattr('socket.socket.connect', Mock(side_effect=AssertionError('No network')))
    monkeypatch.setattr(dev_db.secrets, 'token_hex', lambda count: 'a1b2c3d4e5f6')
    monkeypatch.setattr(dev_db.secrets, 'token_urlsafe', lambda count: 'synthetic-secret')
    admin = Mock()
    migrate = Mock()
    connection = MagicMock()
    connection.__enter__.return_value.execute.return_value.fetchone.return_value = (None,)
    monkeypatch.setattr(dev_db, 'admin', admin)
    monkeypatch.setattr(dev_db, 'migrate', migrate)
    monkeypatch.setattr(dev_db.psycopg, 'connect', Mock(return_value=connection))
    path = tmp_path / 'fixture.env'
    name = dev_db.provision(path)
    env = {}
    for line in path.read_text().splitlines():
        export, assignment = shlex.split(line)
        assert export == 'export'
        key, value = assignment.split('=', 1)
        env[key] = value
    assert env.get('WORKAGENT_TEST_DATABASE') == name
    assert fixture_database_urls(env) == (env['DATABASE_URL'], env['MIGRATION_DATABASE_URL'])
    assert os.stat(path).st_mode & 0o777 == 0o600
    admin.assert_called_once()
    migrate.assert_called_once_with(env['MIGRATION_DATABASE_URL'])
