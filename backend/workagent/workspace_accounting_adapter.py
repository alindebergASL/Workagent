"""PostgreSQL certificate-funded subaccount. No issuer or provider connections."""
from __future__ import annotations
from .workspace_accounting_policy import validate_request, validate_policy


class PostgresAccounting:
    def __init__(self, dsn):
        self.dsn = dsn

    def _call(self, operation, value=None):
        import psycopg
        from psycopg.types.json import Jsonb
        if operation not in {'policy', 'status', 'reserve', 'dispatch', 'retain'}:
            raise ValueError('unsupported_accounting_operation')
        # A new transaction per operation. The response leaves this method only
        # AFTER commit succeeds. No retry on commit/connection ambiguity.
        with psycopg.connect(self.dsn, connect_timeout=5,
                options='-c statement_timeout=10000 -c lock_timeout=5000 -c synchronous_commit=on') as conn:
            if value is None:
                result = conn.execute(f'SELECT workspace_accounting.{operation}()').fetchone()[0]
            else:
                result = conn.execute(f'SELECT workspace_accounting.{operation}(%s)', (Jsonb(value),)).fetchone()[0]
        return result

    def policy(self):
        result = self._call('policy')
        validate_policy(result['policy'])
        return result

    def status(self):
        return self._call('status')

    def reserve_workspace_attempt(self, request):
        policy = self.policy()
        if request.get('policyHash') != policy['policyHash']:
            raise ValueError('policy_binding_conflict')
        validate_request(request, policy['policy'])
        return self._call('reserve', request)

    def dispatch_workspace_attempt(self, request):
        return self._call('dispatch', request)

    def retain_workspace_attempt(self, receipt):
        return self._call('retain', receipt)
