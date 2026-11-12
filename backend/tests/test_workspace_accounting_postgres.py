"""Parent-only disposable PostgreSQL/socket tests. No live issuer/provider calls.

Opt in with WORKSPACE_ACCOUNTING_RUN_DB_TESTS=1 and explicit TEST_DSN,
TEST_RUNTIME_DSN, TEST_RUNTIME_ROLE, TEST_DATABASE (prefix below). The suite
installs 0002 in an EMPTY target and preserves its rows for inspection afterwards.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import socket
import stat
import tempfile
import threading
import unittest
from decimal import Decimal
from workagent.workspace_accounting_adapter import PostgresAccounting
from workagent.workspace_accounting_policy import canonical, price_envelope, jev_policy
from workagent.workspace_accounting_service import AccountingServer, assert_runtime, main
from test_workspace_accounting_policy import policy_fixture, request_fixture


@unittest.skipUnless(os.environ.get('WORKSPACE_ACCOUNTING_RUN_DB_TESTS') == '1',
                     'Parent-only: explicit disposable PostgreSQL/socket integration')
class PostgresTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg.types.json import Jsonb
        cls.psycopg=psycopg; cls.Jsonb=Jsonb
        cls.owner=os.environ['WORKSPACE_ACCOUNTING_TEST_DSN']
        cls.runtime=os.environ['WORKSPACE_ACCOUNTING_TEST_RUNTIME_DSN']
        expected=os.environ['WORKSPACE_ACCOUNTING_TEST_DATABASE']
        if not expected.startswith('workagent_accounting_test_'):
            raise ValueError('explicit_new_test_database_required')
        cls.policy=jev_policy(prompt_price=0.02,completion_price=0.04); cls.bound=price_envelope(cls.policy)
        with psycopg.connect(cls.owner) as c:
            if c.execute('SELECT current_database()').fetchone()[0] != expected:
                raise ValueError('wrong_test_database')
            if c.execute("SELECT to_regnamespace('workspace_accounting')").fetchone()[0]:
                raise ValueError('test_target_not_empty_no_reset_permitted')
            migration=Path(__file__).resolve().parents[2]/'apps/workagent-server/migrations/0002_accounting.sql'
            c.execute(migration.read_text())
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'policy.json'; path.write_text(canonical(cls.policy))
            main(['--dsn-env','WORKSPACE_ACCOUNTING_TEST_DSN','initialize','--policy',str(path)])
        main(['--dsn-env','WORKSPACE_ACCOUNTING_TEST_DSN','grant-runtime','--role',os.environ['WORKSPACE_ACCOUNTING_TEST_RUNTIME_ROLE']])
        cls.store=PostgresAccounting(cls.runtime)
        with psycopg.connect(cls.runtime) as c: assert_runtime(c)
        cls.policy_hash=cls.store.policy()['policyHash']
        cls.certificate=dict(issuer_database='workagent_test_47b87fe3b82e',issuer_schema='test_budget_correction',
            id='SYNTHETIC-DISPOSABLE-TEST-NOT-AN-ISSUER-CERTIFICATE',target_database=expected,
            target_binding_sha256=cls.store.status()['bindingHash'],amount_usd=str(cls.bound*32))
        with psycopg.connect(cls.owner) as c:
            c.execute('SELECT workspace_accounting.import_certificate(%s)',(Jsonb(cls.certificate),))

    def request(self, name, **changes):
        q=request_fixture(self.policy, session=name); q['policyHash']=self.policy_hash
        return dict(q,**changes)

    def reserve(self,name): return self.store.reserve_workspace_attempt(self.request(name))

    @staticmethod
    def binding(permit): return {k:permit[k] for k in ('reservationId','requestHash')}

    def test_01_funding_replay_identity_and_runtime_denial(self):
        with self.psycopg.connect(self.owner) as c:
            r=c.execute('SELECT workspace_accounting.import_certificate(%s)',(self.Jsonb(self.certificate),)).fetchone()[0]
            self.assertTrue(r['duplicate'])
        for change in (dict(target_database='other'),dict(target_binding_sha256='b'*64),dict(id='reused-other'),dict(amount_usd='275')):
            with self.assertRaises(self.psycopg.Error):
                with self.psycopg.connect(self.owner) as c:
                    c.execute('SELECT workspace_accounting.import_certificate(%s)',(self.Jsonb(dict(self.certificate,**change)),))
        for sql in ('SELECT workspace_accounting.import_certificate(%s)',
                    'INSERT INTO workspace_accounting.funding(certificate,amount_usd) VALUES(%s,275)'):
            with self.assertRaises(self.psycopg.errors.InsufficientPrivilege):
                with self.psycopg.connect(self.runtime) as c: c.execute(sql,(self.Jsonb(self.certificate),))

    def test_02_reservation_idempotence_identity_conflict_and_hash_tampering(self):
        q=self.request('idempotence'); first=self.store.reserve_workspace_attempt(q)
        self.assertEqual(first,self.store.reserve_workspace_attempt(q))
        other=request_fixture(self.policy,session='idempotence',text='changed'); other['policyHash']=self.policy_hash
        with self.assertRaises(self.psycopg.Error): self.store.reserve_workspace_attempt(other)
        with self.assertRaises(ValueError): self.store.reserve_workspace_attempt(dict(q,requestBody=q['requestBody']+' '))
        with self.assertRaises(self.psycopg.Error): self.store.dispatch_workspace_attempt(dict(self.binding(first),requestHash='b'*64))

    def test_03_duplicate_dispatch_restart_lost_ack_and_unknown_liability(self):
        b=self.binding(self.reserve('lost-ack')); self.store.dispatch_workspace_attempt(b)
        restarted=PostgresAccounting(self.runtime)
        with self.assertRaises(self.psycopg.Error): restarted.dispatch_workspace_attempt(b)
        before=restarted.status()['liabilityUsd']
        receipt=dict(b,outcome='unknown',replayState={'response':{'frames':[]}})
        restarted.retain_workspace_attempt(receipt)
        self.assertTrue(restarted.retain_workspace_attempt(receipt)['duplicate'])
        self.assertEqual(before,restarted.status()['liabilityUsd'])
        with self.assertRaises(self.psycopg.Error): restarted.retain_workspace_attempt(dict(b,outcome='not_dispatched'))
        with self.assertRaises(self.psycopg.Error): restarted.dispatch_workspace_attempt(b)

    def test_04_receipts_immutable_conflict_missing_money_and_no_invoice_claim(self):
        for name,usage,state in [('receipt-valid',{'cost':0.001,'prompt_tokens':10},'provider_reported'),
                                 ('receipt-missing',{'prompt_tokens':10},'missing_or_invalid'),
                                 ('receipt-invalid',{'cost':'NaN'},'missing_or_invalid'),
                                 ('receipt-negative',{'cost':-1},'missing_or_invalid')]:
            b=self.binding(self.reserve(name)); self.store.dispatch_workspace_attempt(b)
            before=self.store.status()['liabilityUsd']
            q=dict(b,outcome='received',terminal=True,responseId=name,resolvedModel='fixture/resolved',usage=usage,
                   replayState={'response':{'model':'fixture/resolved','frames':[{'usage':usage}]}})
            result=self.store.retain_workspace_attempt(q)
            self.assertEqual(result['monetaryState'],state); self.assertIsNone(result['verifiedInvoiceUsd'])
            self.assertTrue(self.store.retain_workspace_attempt(q)['duplicate'])
            if state=='provider_reported':
                self.assertEqual(Decimal(self.store.status()['liabilityUsd']), Decimal(before)-self.bound+Decimal('0.001'))
            else:
                self.assertEqual(before,self.store.status()['liabilityUsd'])
                self.assertTrue(self.store.status()['frozen'])
                with self.assertRaises(self.psycopg.Error): self.reserve(name+'-blocked')
            with self.assertRaises(self.psycopg.Error): self.store.retain_workspace_attempt(dict(q,usage={'cost':0.002}))
            with self.psycopg.connect(self.owner) as c:
                retained=c.execute('SELECT evidence FROM workspace_accounting.receipt WHERE reservation_id=%s',(b['reservationId'],)).fetchone()[0]
                self.assertEqual(retained,q)
            if state!='provider_reported':
                reconciled=dict(b,outcome='reconciled',terminal=True,responseId=name,resolvedModel='fixture/resolved',
                    generation=dict(id=name,model='fixture/resolved',finish_reason='stop',total_cost=0.001,is_byok=False))
                self.assertTrue(self.store.retain_workspace_attempt(reconciled)['settled'])
                self.assertFalse(self.store.status()['frozen'])
                self.assertTrue(self.store.retain_workspace_attempt(reconciled)['duplicate'])


    def test_05_rollback_and_exact_unsent_release(self):
        before=self.store.status()
        with self.psycopg.connect(self.runtime) as c:
            c.execute('SELECT workspace_accounting.reserve(%s)',(self.Jsonb(self.request('rollback')),))
            c.rollback()
        self.assertEqual(before,self.store.status())
        b=self.binding(self.reserve('cancelled'))
        result=self.store.retain_workspace_attempt(dict(b,outcome='not_dispatched'))
        self.assertTrue(result['settled']); self.assertEqual(Decimal(result['liabilityUsd']),0)
        self.assertEqual(self.store.status()['liabilityUsd'],before['liabilityUsd'])
        self.assertTrue(self.store.retain_workspace_attempt(dict(b,outcome='not_dispatched'))['duplicate'])
        self.assertEqual(self.store.status()['liabilityUsd'],before['liabilityUsd'])
        with self.assertRaises(self.psycopg.Error): self.store.dispatch_workspace_attempt(b)
        with self.assertRaises(self.psycopg.Error):
            with self.psycopg.connect(self.owner) as c: c.execute('DELETE FROM workspace_accounting.receipt')

    def test_06_socket_commit_ack_permissions_bounded_json_and_no_rebind(self):
        with tempfile.TemporaryDirectory() as directory:
            path=str(Path(directory)/'accounting.sock')
            server=AccountingServer(path,self.store)
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode),0o600)
            thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
            def post(operation,raw,extra=''):
                with socket.socket(socket.AF_UNIX) as s:
                    s.settimeout(5); s.connect(path)
                    s.sendall((f'POST /workspace-accounting/v1/{operation} HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: {len(raw)}\r\n{extra}\r\n').encode()+raw)
                    result=b''
                    while data:=s.recv(65536): result+=data
                    return result
            try:
                result=post('reserve',canonical(self.request('socket')).encode())
                self.assertIn(b'200 OK',result)
                permit=json.loads(result.split(b'\r\n\r\n',1)[1])
                # Separate connection observes the committed reservation.
                self.assertTrue(self.store.dispatch_workspace_attempt(self.binding(permit))['dispatched'])
                self.assertIn(b'409 Conflict',post('reserve',b'{"a":1,"a":2}'))
                self.assertIn(b'404 Not Found',post('import-certificate',b'{}'))
                with self.assertRaises(ValueError): AccountingServer(path,self.store)
            finally:
                server.shutdown(); thread.join(); server.server_close()
            self.assertTrue(os.path.exists(path))  # server does NOT delete sockets

    def test_07_repeated_known_settlements_charge_actuals_and_replays_cannot_mint(self):
        start=self.store.status()
        for i in range(40):
            name='settled-'+str(i); b=self.binding(self.reserve(name)); self.store.dispatch_workspace_attempt(b)
            q=dict(b,outcome='received',terminal=True,responseId=name,resolvedModel='resolved',usage={'cost':0.001})
            result=self.store.retain_workspace_attempt(q)
            self.assertTrue(result['settled']); self.assertEqual(Decimal(result['settledCostUsd']),Decimal('0.001'))
            self.assertTrue(self.store.retain_workspace_attempt(q)['duplicate'])
            with self.assertRaises(self.psycopg.Error): self.store.dispatch_workspace_attempt(b)
            with self.assertRaises(self.psycopg.Error): self.store.retain_workspace_attempt(dict(b,outcome='not_dispatched'))
        self.assertEqual(Decimal(self.store.status()['liabilityUsd'])-Decimal(start['liabilityUsd']),Decimal('0.040'))
        self.assertEqual(self.store.status()['fundedUsd'],start['fundedUsd'])
        for cost in (0,0.002,-1):
            with self.assertRaises(self.psycopg.Error):
                self.store.retain_workspace_attempt(dict(q,usage={'cost':cost}))
        with self.assertRaises(self.psycopg.Error):
            self.store.retain_workspace_attempt(dict(b,outcome='reconciled',responseId=name,resolvedModel='resolved',
                generation=dict(id=name,model='resolved',finish_reason='stop',total_cost=0)))
        type(self).settled_binding=b; type(self).settled_response=name
        other=self.binding(self.reserve('replayed-generation')); self.store.dispatch_workspace_attempt(other)
        with self.assertRaises(self.psycopg.Error):
            self.store.retain_workspace_attempt(dict(q,**other))
        self.assertEqual(self.store.status()['fundedUsd'],start['fundedUsd'])

    def test_08_unknown_holds_until_exact_generation_reconciliation(self):
        b=self.binding(self.reserve('lookup')); self.store.dispatch_workspace_attempt(b)
        before=self.store.status()['liabilityUsd']
        self.store.retain_workspace_attempt(dict(b,outcome='unknown',responseId='gen-lookup',usage={'cost':0.0001}))
        self.assertEqual(before,self.store.status()['liabilityUsd'])
        with self.assertRaises(self.psycopg.Error): self.store.retain_workspace_attempt(dict(b,outcome='not_dispatched'))
        q=dict(b,outcome='reconciled',responseId='gen-lookup',resolvedModel='resolved',
            generation=dict(id='gen-lookup',model='resolved',finish_reason='stop',total_cost=0.001,is_byok=False))
        with self.assertRaises(self.psycopg.Error):
            self.store.retain_workspace_attempt(dict(q,generation=dict(q['generation'],id='unrelated')))
        self.assertTrue(self.store.retain_workspace_attempt(q)['settled'])
        self.assertEqual(Decimal(self.store.status()['liabilityUsd']),Decimal(before)-self.bound+Decimal('0.001'))
        with self.assertRaises(self.psycopg.Error): self.store.dispatch_workspace_attempt(b)

    def test_90_concurrent_reserve_cannot_overspend(self):
        def attempt(i):
            try: return self.reserve('concurrent-'+str(i))
            except self.psycopg.Error: return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(attempt,range(40)))
        accepted=[r for r in results if r]
        self.assertTrue(accepted); self.assertTrue(any(r is None for r in results))
        status=self.store.status()
        self.assertLessEqual(Decimal(status['liabilityUsd']),Decimal(status['fundedUsd']))
        self.assertLess(Decimal(status['availableUsd']),self.bound)
        type(self).last_permit=accepted[0]

    def test_99_reported_overrun_retains_full_evidence_and_freezes_dispatch(self):
        b=self.binding(self.last_permit); self.store.dispatch_workspace_attempt(b)
        value=Decimal(self.store.status()['fundedUsd'])+1
        result=self.store.retain_workspace_attempt(dict(b,outcome='unknown',responseId='overrun',resolvedModel='fixture',usage={'cost':float(value)}))
        self.assertEqual(result['monetaryState'],'overrun')
        status=self.store.status(); self.assertGreater(Decimal(status['liabilityUsd']),Decimal(status['fundedUsd']))
        self.assertEqual(status['overruns'],1)
        with self.assertRaises(self.psycopg.Error): self.reserve('after-overrun')
        prior=Decimal(self.store.status()['liabilityUsd'])
        late=self.store.retain_workspace_attempt(dict(self.settled_binding,outcome='reconciled',responseId=self.settled_response,
            resolvedModel='resolved',generation=dict(id=self.settled_response,model='resolved',finish_reason='stop',total_cost=0.002)))
        self.assertEqual(late['monetaryState'],'cost_conflict'); self.assertTrue(late['frozen'])
        self.assertEqual(Decimal(self.store.status()['liabilityUsd']),prior+Decimal('0.001'))


if __name__ == '__main__': unittest.main()
