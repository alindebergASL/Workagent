"""Diagnostic-only cold worker: measure the real reservation guard, then roll back.

No product source changes, cached authorization, HTTP sends, or committed dispatch.
The clone arm retains official provenance using an invalid literal credential and
never changes a grant/certificate. The synthetic arm has its own fixture authority.
"""
from contextlib import contextmanager
from functools import wraps
from hashlib import sha256
import io
import json
import sys
import time
from urllib.parse import urlsplit


class Timings:
    def __init__(self):
        self.started = time.monotonic()
        self.claim_started = None
        self.stack = []
        self.totals = {}
        self.events = []
        self.work = False

    def event(self, name, **data):
        self.events.append(dict(event=name, since_start=time.monotonic()-self.started,
            since_claim=None if self.claim_started is None else time.monotonic()-self.claim_started,
            **data))

    @contextmanager
    def span(self, name):
        start = time.monotonic()
        frame = [0.0, name]
        self.stack.append(frame)
        error = False
        try:
            yield
        except BaseException:
            error = True
            raise
        finally:
            elapsed = time.monotonic()-start
            self.stack.pop()
            if self.stack:
                self.stack[-1][0] += elapsed
            key = ('work:' if self.work else 'startup:') + name
            row = self.totals.setdefault(key, dict(calls=0, errors=0, inclusive_seconds=0.,
                exclusive_seconds=0., max_seconds=0.))
            row['calls'] += 1
            row['errors'] += int(error)
            row['inclusive_seconds'] += elapsed
            row['exclusive_seconds'] += max(0, elapsed-frame[0])
            row['max_seconds'] = max(row['max_seconds'], elapsed)

    def report(self):
        return dict(events=self.events, totals=self.totals,
            elapsed_seconds=time.monotonic()-self.started,
            measurement='selected wrappers; inclusive totals overlap; exclusive is relative to instrumented children only')


def safe_error(exc):
    # Never serialize exception messages/queries/parameters or provider content.
    out = dict(error=type(exc).__name__)
    if getattr(getattr(exc, 'diag', None), 'message_primary', None) == 'funding_scope_mismatch':
        out['reason'] = 'funding_scope_mismatch'
    return out


def install(t, cfg):
    import httpx
    import psycopg
    from pydantic import BaseModel
    from workagent.db import Database
    from workagent.general_worker import GeneralWorker
    from workagent.responses_worker import ResponsesWorker
    from workagent.responses_transport import ResponsesTransport, FrozenSchema, PreparedRequest
    from workagent.responses_ledger import Ledger
    from workagent.service import Service, now
    from workagent import responses_transport, responses_ledger, general_responses, provider_attempts, adaptive
    recovering = cfg.get('probe_execution','rollback') == 'controlled_recovery'
    if recovering:
        assert cfg['probe_mode']=='synthetic' and cfg['grant']['responses']['transport_mode']=='synthetic'
        assert cfg['transport']=='controlled_http'

    def wrap(obj, name, label=None):
        descriptor = vars(obj).get(name)
        isclass = isinstance(descriptor, classmethod)
        original = descriptor.__func__ if isclass else getattr(obj, name)
        @wraps(original)
        def measured(*a, **kw):
            key = label or name
            if obj is BaseModel:
                key += ':'+a[0].__name__
            with t.span(key):
                return original(*a, **kw)
        setattr(obj, name, classmethod(measured) if isclass else measured)

    for cls, names in (
        (GeneralWorker, ('_responses_work', '_prepared_selection', '_prepared_final', '_adaptive_work')),
        (ResponsesWorker, ('_fresh', '_visit_deadline', '_http_ready', '_reserve_http', '_after_reservation_ready')),
        (Ledger, ('snapshot', '_auth', '_events', 'event')),
        (Service, ('_general_context', '_check_capability', 'conversation_worker_context')),
        (ResponsesTransport, ('restore_count',)),
        (PreparedRequest, ('count_body',)),
        (FrozenSchema, ('freeze', 'validate')),
        (BaseModel, ('model_json_schema', 'model_validate', 'model_validate_json')),
    ):
        for name in names:
            wrap(cls, name, cls.__name__+'.'+name)
    for module, names in (
        (responses_transport, ('_validate_request',)),
        (responses_ledger, ('restore_result',)),
        (general_responses, ('resolve_selection', 'check_pins')),
        (provider_attempts, ('check_grant',)),
        (adaptive, ('retained', 'continuation_context', 'contract')),
    ):
        for name in names:
            # Include aliases already imported into product modules; all invoke
            # the same unchanged function. No argument/result caching.
            original = getattr(module, name)
            wrap(module, name, module.__name__.rsplit('.',1)[-1]+'.'+name)
            for other in list(sys.modules.values()):
                if getattr(other, '__name__', '').startswith('workagent.'):
                    for key, value in list(vars(other).items()):
                        if value is original:
                            setattr(other, key, getattr(module, name))

    execute = psycopg.Connection.execute
    def sql(self, query, *a, **kw):
        # Static query fingerprint only: no SQL text, bound values or rows.
        raw = query.encode() if isinstance(query, str) else b'<composed>'
        caller = t.stack[-1][1] if t.stack else 'unscoped'
        key = 'sql.'+sha256(raw).hexdigest()[:20]+'.via.'+caller
        with t.span(key):
            return execute(self, query, *a, **kw)
    psycopg.Connection.execute = sql
    transaction = Database.transaction
    @contextmanager
    def tx(self):
        cm = transaction(self)
        with t.span('transaction.connect_begin'):
            conn = cm.__enter__()
        t.event('transaction_open')
        try:
            yield conn
        except BaseException:
            info = sys.exc_info()
            with t.span('transaction.rollback_close'):
                suppressed = cm.__exit__(*info)
            t.event('transaction_end', disposition='rollback')
            if not suppressed:
                raise
        else:
            with t.span('transaction.commit_close'):
                cm.__exit__(None, None, None)
            t.event('transaction_end', disposition='commit')
    Database.transaction = tx
    claim = Service._claim_run
    def claiming(self, *a, **kw):
        t.claim_started = time.monotonic()
        with t.span('Service._claim_run'):
            result = claim(self, *a, **kw)
        t.event('claim_complete', fence=result.fence,
            lease_remaining=(result.lease_expires_at-now()).total_seconds() if hasattr(result, 'lease_expires_at') else None)
        return result
    Service._claim_run = claiming
    if hasattr(GeneralWorker,'_claim_responses_run'):
        worker_claim = GeneralWorker._claim_responses_run
        def claiming_responses(self,*a,**kw):
            t.claim_started=time.monotonic()
            with t.span('GeneralWorker._claim_responses_run'):
                result=worker_claim(self,*a,**kw)
            t.event('claim_complete',fence=result.fence,policy_seconds=180)
            return result
        GeneralWorker._claim_responses_run=claiming_responses
    window = ResponsesWorker._http_window
    def check(self, run, deadline, **kw):
        result = window(self, run, deadline, **kw)
        t.event('http_window', allowed=result, handoff=kw.get('handoff', False),
            lease_remaining=(run.lease_expires_at-now()).total_seconds(),
            deadline_remaining=deadline-time.monotonic(),
            allowance=sum(self.transport._client.timeout.as_dict().values())+5+(5 if kw.get('handoff') else 0))
        return result
    ResponsesWorker._http_window = check
    http_ready = ResponsesWorker._http_ready
    def readiness(self, *a, **kw):
        start = time.monotonic()
        result = http_ready(self, *a, **kw)
        t.event('http_ready', allowed=result, seconds=time.monotonic()-start)
        return result
    ResponsesWorker._http_ready = readiness
    after_ready=ResponsesWorker._after_reservation_ready
    def postcommit(self,request,kind,*a,**kw):
        start=time.monotonic()
        result=after_ready(self,request,kind,*a,**kw)
        t.event('postcommit_authorization',phase=request.phase,operation=kind,
            allowed=result,seconds=time.monotonic()-start)
        return result
    ResponsesWorker._after_reservation_ready=postcommit
    operation = Ledger.reserve_operation
    def reserve(self, request, kind, cap, **kw):
        if not recovering:
            assert request.phase == cfg['probe_phase'] and kind == 'dispatch', 'unexpected operation'
        ready = kw['ready']
        def guard(run):
            # This callback follows the real INSERT and its SQL guards. It is
            # inside the original transaction, immediately before commit.
            allowed = ready(run)
            t.event('reservation_ready_callback', allowed=allowed, phase=request.phase,
                lease_remaining=(run.lease_expires_at-now()).total_seconds(),
                request_sha256=request.sha256)
            if allowed and (not recovering or (cfg.get('probe_fault')=='before_reservation'
                    and request.phase==cfg['probe_phase'] and kind=='dispatch')):
                raise InterruptedError('diagnostic rollback after actual handoff guard')
            return allowed
        kw['ready'] = guard
        t.event('reserve_enter', phase=request.phase, operation=kind)
        try:
            with t.span('Ledger.reserve_operation'):
                result=operation(self, request, kind, cap, **kw)
            t.event('reserve_committed',phase=request.phase,operation=kind)
            return result
        except BaseException as exc:
            t.event('reserve_exit', **safe_error(exc))
            raise
    Ledger.reserve_operation = reserve
    step = ResponsesWorker._step
    def stepping(self, ledger, request, *a, **kw):
        if not recovering:
            assert request.phase == cfg['probe_phase'], 'settled phase replay'
        if request.phase==cfg['probe_phase']:
            assert request.sha256 == cfg['probe_request_sha256'], 'prepared request changed'
            assert len(request.body) == cfg['probe_request_bytes'], 'prepared request size changed'
        t.event('step_enter', phase=request.phase, request_sha256=request.sha256, request_bytes=len(request.body))
        with t.span('ResponsesWorker._step'):
            return step(self, ledger, request, *a, **kw)
    ResponsesWorker._step = stepping
    work = GeneralWorker.work
    def working(self, *a, **kw):
        t.work = True
        t.event('work_enter')
        try:
            return work(self, *a, **kw)
        finally:
            t.event('work_exit')
    GeneralWorker.work = working
    def forbidden(*a, **kw):
        t.event('forbidden_io_or_rebuild')
        raise AssertionError('diagnostic forbids HTTP, count, prepare, and tool staging')
    if not recovering:
        httpx.Client.send = forbidden
        ResponsesTransport.count = forbidden
        Ledger.prepare = forbidden
        Service.stage_general_product = forbidden
        # Even a misbound unexpected DTO must never execute a native tool.
        from workagent.capabilities.broker import CapabilityBroker
        CapabilityBroker.call = forbidden
    else:
        send=httpx.Client.send
        def controlled_send(self,request,*a,**kw):
            assert str(request.url).split('/v1/')[0]==cfg['controlled_origin']
            assert request.url.host=='127.0.0.1' and request.url.scheme=='http'
            t.event('controlled_http_enter',method=request.method,path=request.url.path,
                request_sha256=sha256(request.content).hexdigest())
            return send(self,request,*a,**kw)
        httpx.Client.send=controlled_send
        init=GeneralWorker.__init__
        def initialize(self,*a,**kw):
            hook=kw.get('hook')
            def fault(name):
                t.event('worker_hook',hook_name=name)
                if ((cfg.get('probe_fault')=='after_dispatch' and name=='after_predispatch') or
                    (cfg.get('probe_fault')=='after_identity' and name=='after_response')):
                    raise InterruptedError('controlled committed boundary')
                if hook:hook(name)
            kw['hook']=fault
            return init(self,*a,**kw)
        GeneralWorker.__init__=initialize


def main():
    sys.path[:0] = ['/product', '/deps', '/']
    import study_worker
    cfg = json.load(sys.stdin)
    assert 'credential' not in cfg, 'credentials prohibited'
    parts = urlsplit(cfg['dsn'])
    assert parts.hostname in ('localhost', '127.0.0.1') and parts.path.startswith('/workagent_test_')
    mode = cfg['probe_mode']
    if mode == 'clone':
        assert parts.path == '/workagent_test_stall_77db950a56'
        assert cfg['run_id'] == 'daacd79b-f1ab-4af9-a3d0-0699c2d03a45'
        assert cfg['probe_request_sha256'] == '8d45e31d7ce6cdd598d2da480abee9da00bc37856e7652158dcb2891e4b1bbcf'
        assert cfg['transport'] == cfg['grant']['responses']['transport_mode'] == 'official_api'
        cfg['credential'] = 'diagnostic-invalid-no-network'
    else:
        assert mode == 'synthetic'
        assert cfg['transport'] == 'controlled_http' and cfg['grant']['responses']['transport_mode'] == 'synthetic'
    assert 443 not in cfg['allowed_tcp_ports']
    t = Timings()
    install(t, cfg)
    sys.stdin = io.StringIO(json.dumps(cfg))
    try:
        study_worker.main()
    except BaseException as exc:
        t.event('worker_exception', **safe_error(exc))
        # Suppress raw traceback/exception contents. Preserve failure as nonzero.
        return 1
    finally:
        print(json.dumps({'timing_recovery': t.report()}), file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
