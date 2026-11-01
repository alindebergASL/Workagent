"""Pure/mocked pre-seed controls; never connects to PostgreSQL or a provider.

PYTHONPATH=backend backend/.venv/bin/python -B backend/tests/test_domain_fixture_safety.py -v
Also run with -O: the actual fixture guards must not depend on assert rewriting.
"""
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

# Even an accidental import-time database connection must fail closed.
with patch('psycopg.connect', side_effect=AssertionError('No PostgreSQL in pure tests')):
    import test_domain as domain


DATABASE = 'workagent_test_generic_fixture'


def environment(database=DATABASE, host='127.0.0.1', port=':5432'):
    return {
        'LOCAL_TEST_MODE': 'true',
        'WORKAGENT_TEST_DATABASE': database,
        'DATABASE_URL': f'postgresql://reader:synthetic-secret@{host}{port}/{database}',
        'MIGRATION_DATABASE_URL': f'postgresql://owner:synthetic-secret@{host}{port}/{database}',
    }


class FixtureSafetyTests(unittest.TestCase):
    def setUp(self):
        self.connect = self.enterContext(patch('psycopg.connect', side_effect=AssertionError('No PostgreSQL')))
        self.enterContext(patch('socket.socket.connect', side_effect=AssertionError('No network')))

    def reject_before_io(self, env):
        with patch.dict(os.environ, env, clear=True), patch.object(domain, 'seed') as seed, \
             patch.object(domain, 'Database') as database, patch.object(domain, 'ACTOR') as actor, \
             patch.object(domain, 'Service') as service:
            # A removed preflight must fail our assertion, not merely stumble on
            # an unrelated mock/type error farther into the fixture.
            actor.read_text.return_value = '[]'
            service.return_value.list_sources.return_value = SimpleNamespace(items=[])
            with self.assertRaises(RuntimeError) as error:
                getattr(domain.context, '__wrapped__')()
            self.assertNotIn('synthetic-secret', str(error.exception))
            self.assertNotIn('postgresql://', str(error.exception))
            seed.assert_not_called()
            database.assert_not_called()
            actor.read_text.assert_not_called()
        self.connect.assert_not_called()

    def test_accepts_exact_owned_generic_and_generated_names(self):
        for name in (DATABASE, 'workagent_test_a1b2c3d4e5f6', 'workagent_test_historical_authorized'):
            with self.subTest(name=name):
                env = environment(name)
                self.assertEqual(domain.fixture_database_urls(env), (env['DATABASE_URL'], env['MIGRATION_DATABASE_URL']))

    def test_loopback_and_default_port_forms(self):
        for host in ('localhost', '127.0.0.1', '[::1]'):
            env = environment(host=host, port='')
            env['MIGRATION_DATABASE_URL'] = env['MIGRATION_DATABASE_URL'].replace(f'@{host}/', f'@{host}:5432/')
            self.assertEqual(len(domain.fixture_database_urls(env)), 2)

    def test_existing_exact_native_fixture_binding_is_compatible(self):
        env = environment()
        env['WORKAGENT_NATIVE_PROJECTION_TEST_DATABASE'] = env.pop('WORKAGENT_TEST_DATABASE')
        self.assertEqual(len(domain.fixture_database_urls(env)), 2)

    def test_conflicting_acknowledgements_refused(self):
        env = environment()
        env['WORKAGENT_NATIVE_PROJECTION_TEST_DATABASE'] = 'workagent_test_another'
        self.reject_before_io(env)

    def test_prefix_and_local_mode_do_not_authorize_retained_study(self):
        env = environment('workagent_test_retained_study')
        env.pop('WORKAGENT_TEST_DATABASE')
        self.reject_before_io(env)
        env['WORKAGENT_TEST_DATABASE'] = DATABASE
        self.reject_before_io(env)

    def test_missing_and_inexact_bindings_refused(self):
        for value in ('', DATABASE + '_other', '/' + DATABASE, '*', DATABASE + ' '):
            with self.subTest(value=value):
                env = environment()
                env['WORKAGENT_TEST_DATABASE'] = value
                self.reject_before_io(env)

    def test_local_test_mode_is_explicit(self):
        for value in ('', 'false', 'TRUE'):
            env = environment()
            env['LOCAL_TEST_MODE'] = value
            self.reject_before_io(env)

    def test_admin_target_must_match_before_any_io(self):
        for old, new in ((DATABASE, 'workagent_test_other'), (DATABASE, 'production'),
                         ('127.0.0.1', 'localhost'), (':5432/', ':5433/'), ('owner:', 'reader:')):
            with self.subTest(new=new):
                env = environment()
                env['MIGRATION_DATABASE_URL'] = env['MIGRATION_DATABASE_URL'].replace(old, new)
                self.reject_before_io(env)

    def test_encoded_equal_roles_are_not_distinct(self):
        env = environment()
        env['MIGRATION_DATABASE_URL'] = env['MIGRATION_DATABASE_URL'].replace('owner:', '%72eader:')
        self.reject_before_io(env)

    def test_full_path_not_dsn_substring_controls_scope(self):
        for value in ('postgresql://reader:synthetic-secret@127.0.0.1/production?note=/workagent_test_x',
                      'postgresql://reader:synthetic-secret@127.0.0.1/production/workagent_test_x',
                      'postgresql://reader:synthetic-secret@127.0.0.1/workagent_test_x/production',
                      'postgresql://reader:synthetic-secret@127.0.0.1/workagent_test_x%2Fproduction'):
            env = environment()
            env['DATABASE_URL'] = value
            self.reject_before_io(env)

    def test_dsn_overrides_and_invalid_urls_are_refused(self):
        base = environment()['DATABASE_URL']
        for value in ('', 'host=127.0.0.1 dbname=' + DATABASE, base + '?host=remote',
                      base + '?dbname=production', base + '?user=owner', base + '?service=other',
                      base + '#fragment', base.replace('127.0.0.1', 'example.org'),
                      base.replace('5432', 'bad'), base.replace('5432', '65536'), base.replace('5432', '0'),
                      base.replace('postgresql', 'https'), base.replace('reader:', ':'),
                      base.replace('127.0.0.1', '127.0.0.1,localhost'), '\n' + base,
                      base.replace(DATABASE, 'workagent_test_' + 'x' * 64)):
            with self.subTest(value=value):
                for key in ('DATABASE_URL', 'MIGRATION_DATABASE_URL'):
                    env = environment()
                    env[key] = value
                    self.reject_before_io(env)

    def test_ambient_libpq_redirection_is_refused(self):
        for key in ('PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGPORT'):
            env = environment()
            env[key] = 'synthetic-override'
            self.reject_before_io(env)

    def test_runtime_privilege_failure_precedes_seed(self):
        db = Mock()
        db.check_runtime_role.side_effect = RuntimeError('restricted runtime required')
        service = SimpleNamespace(db=db, list_sources=Mock(return_value=SimpleNamespace(items=[])))
        with patch.dict(os.environ, environment(), clear=True), patch.object(domain, 'Database', return_value=db), \
             patch.object(domain, 'Service', return_value=service), \
             patch.object(domain, 'seed') as seed, patch.object(domain, 'ACTOR') as actor:
            actor.read_text.return_value = '[]'
            with self.assertRaisesRegex(RuntimeError, 'restricted runtime'):
                getattr(domain.context, '__wrapped__')()
            seed.assert_not_called()
            actor.read_text.assert_not_called()
        self.connect.assert_not_called()

    def test_success_preserves_fixture_api_and_safety_order(self):
        calls = []
        db = Mock()
        db.check_runtime_role.side_effect = lambda: calls.append('runtime-role')
        service = SimpleNamespace(db=db, list_sources=Mock(return_value=SimpleNamespace(items=[])))
        with patch.dict(os.environ, environment(), clear=True), patch.object(domain, 'Database', return_value=db), \
             patch.object(domain, 'Service', return_value=service), patch.object(domain, 'ACTOR') as actor, \
             patch.object(domain, 'seed', side_effect=lambda *args: calls.append('seed')) as seed:
            actor.read_text.return_value = '[]'
            result = getattr(domain.context, '__wrapped__')()
            self.assertEqual(len(result), 5)
            self.assertIs(result[0], service)
            self.assertEqual(result[1].id, 'local-human')
            self.assertTrue(result[2].startswith('test-'))
            self.assertEqual(result[3], [])
            self.assertIsInstance(result[4], domain.PrivateDsn)
            self.assertNotIn('synthetic-secret', repr(result[4]))
            seed.assert_called_once_with(result[4], [], result[2], result[1].id)
            self.assertEqual(calls, ['runtime-role', 'seed'])
        self.connect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
