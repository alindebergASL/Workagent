"""Restricted Unix HTTP service and explicit parent-only setup commands."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import socketserver
import stat
import sys
import uuid
from http.server import BaseHTTPRequestHandler
from .workspace_accounting_adapter import PostgresAccounting
from .workspace_accounting_bridge import WorkspaceAccountingBridge
from .workspace_accounting_policy import (MAX_JSON, canonical, certificate_identity,
                                         strict_json, validate_policy)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'
    server_version = 'WorkspaceAccounting'
    sys_version = ''

    def setup(self):
        self.request.settimeout(10)
        super().setup()

    def log_message(self, *_args):
        pass  # No request text, headers, provider data or database errors in logs.

    def send_error(self, code, message=None, explain=None):
        self.reply(code, {'error': 'invalid_http_request'})

    def reply(self, code, value):
        raw = canonical(value).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        try:
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                raise ValueError('invalid_length')
            length = int(self.headers['Content-Length'])
            if not 0 < length <= MAX_JSON or self.headers.get_content_type() != 'application/json':
                raise ValueError('invalid_request')
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError('incomplete_request')
            value = strict_json(raw.decode('utf-8'))
            if not isinstance(value, dict):
                raise ValueError('invalid_request')
            prefix = '/workspace-accounting/v1/'
            operation = self.path[len(prefix):] if self.path.startswith(prefix) else ''
            if operation in ('policy', 'status'):
                if value:
                    raise ValueError('invalid_request')
                result = getattr(self.server.store, operation)()
            elif operation in ('reserve', 'dispatch', 'retain'):
                result = getattr(self.server.bridge, operation)(value)
            else:
                self.reply(404, {'error': 'unknown_operation'})
                return
        except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
            self.reply(409, {'error': 'accounting_request_refused'})
            return
        except Exception:
            self.reply(503, {'error': 'accounting_unavailable_or_refused'})
            return
        # All store methods commit before this acknowledgement.
        self.reply(200, result)


class AccountingServer(socketserver.UnixStreamServer):
    def __init__(self, path, store):
        path = os.path.abspath(path)
        parent = os.path.dirname(path)
        info = os.lstat(parent)
        if (os.path.realpath(parent) != parent or not stat.S_ISDIR(info.st_mode)
                or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700):
            raise ValueError('socket_parent_must_be_owned_private_directory')
        if os.path.lexists(path):
            raise ValueError('socket_path_already_exists')
        self.store = store
        self.bridge = WorkspaceAccountingBridge(store)
        # Bind with private umask; no exposure before chmod. Never unlink paths.
        mask = os.umask(0o177)
        try:
            super().__init__(path, Handler)
            os.chmod(path, 0o600)
        finally:
            os.umask(mask)

    def handle_error(self, request, client_address):
        pass


def connect(dsn):
    import psycopg
    return psycopg.connect(dsn, connect_timeout=5,
        options='-c statement_timeout=10000 -c lock_timeout=5000 -c synchronous_commit=on')


def assert_runtime(conn):
    row = conn.execute("""SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls,
      pg_has_role(current_user,n.nspowner,'MEMBER'),
      has_function_privilege(current_user,'workspace_accounting.import_certificate(jsonb)','EXECUTE')
      FROM pg_roles r CROSS JOIN pg_namespace n
      WHERE r.rolname=current_user AND n.nspname='workspace_accounting'""").fetchone()
    if row is None or any(row):
        raise ValueError('separate_restricted_runtime_role_required')
    for table in ('binding', 'funding', 'reservation', 'dispatch', 'receipt', 'settlement'):
        if conn.execute('SELECT has_table_privilege(current_user,%s,%s)',
                        ('workspace_accounting.' + table, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')).fetchone()[0]:
            raise ValueError('runtime_has_table_write_access')
    for operation in ('policy()', 'status()', 'reserve(jsonb)', 'dispatch(jsonb)', 'retain(jsonb)'):
        if not conn.execute('SELECT has_function_privilege(current_user,%s,%s)',
                            ('workspace_accounting.' + operation, 'EXECUTE')).fetchone()[0]:
            raise ValueError('runtime_missing_function_grant')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn-env', required=True, help='Name of an environment variable; never pass a DSN on the command line')
    sub = parser.add_subparsers(dest='command', required=True)
    init = sub.add_parser('initialize'); init.add_argument('--policy', required=True)
    imp = sub.add_parser('import-certificate'); imp.add_argument('--certificate', required=True)
    grant = sub.add_parser('grant-runtime'); grant.add_argument('--role', required=True)
    sub.add_parser('validate'); sub.add_parser('status')
    serve = sub.add_parser('serve'); serve.add_argument('--socket', required=True)
    args = parser.parse_args(argv)
    dsn = os.environ[args.dsn_env]
    store = PostgresAccounting(dsn)
    if args.command in ('serve', 'validate'):
        with connect(dsn) as conn:
            assert_runtime(conn)
        policy = store.policy()
        status = store.status()
        if args.command == 'validate':
            print(canonical(dict(policy, status=status)))
            return
        with AccountingServer(args.socket, store) as server:
            server.serve_forever()
        return
    if args.command == 'status':
        print(canonical(store.status())); return
    from psycopg import sql
    from psycopg.types.json import Jsonb
    with connect(dsn) as conn:
        # Administrative commands are accessible only to the schema owner (or
        # its authorized member), never through the HTTP or runtime functions.
        if not conn.execute("SELECT pg_has_role(current_user,nspowner,'MEMBER') FROM pg_namespace WHERE nspname='workspace_accounting'").fetchone()[0]:
            raise ValueError('migration_owner_required')
        if args.command == 'initialize':
            policy = validate_policy(strict_json(Path(args.policy).read_text()))
            identity = conn.execute("SELECT current_database(), (SELECT oid::text FROM pg_database WHERE datname=current_database()), system_identifier::text FROM pg_control_system()").fetchone()
            binding = dict(target_database=identity[0], database_oid=identity[1], system_identifier=identity[2],
                           nonce=uuid.uuid4().hex, policy=policy)
            result = conn.execute('SELECT workspace_accounting.initialize(%s,%s)',
                                  (canonical(binding), canonical(policy))).fetchone()[0]
            result['policy'] = policy
        elif args.command == 'import-certificate':
            cert = strict_json(Path(args.certificate).read_text())
            status = store.status()
            certificate_identity(cert, dict(target_database=status['targetDatabase'], binding_sha256=status['bindingHash']))
            result = conn.execute('SELECT workspace_accounting.import_certificate(%s)', (Jsonb(cert),)).fetchone()[0]
        else:
            role = args.role
            flags = conn.execute('SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls FROM pg_roles WHERE rolname=%s', (role,)).fetchone()
            if not flags or flags[0] or conn.execute("SELECT pg_has_role(%s,nspowner,'MEMBER') FROM pg_namespace WHERE nspname='workspace_accounting'", (role,)).fetchone()[0]:
                raise ValueError('separate_restricted_runtime_role_required')
            conn.execute(sql.SQL('GRANT USAGE ON SCHEMA workspace_accounting TO {}').format(sql.Identifier(role)))
            for operation in ('policy()', 'status()', 'reserve(jsonb)', 'dispatch(jsonb)', 'retain(jsonb)'):
                conn.execute(sql.SQL('GRANT EXECUTE ON FUNCTION workspace_accounting.' + operation + ' TO {}').format(sql.Identifier(role)))
            result = {'grantedRuntimeRole': role}
    print(canonical(result))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('workspace_accounting_command_failed; inspect role, target, policy and path with the owner', file=sys.stderr)
        sys.exit(1)
