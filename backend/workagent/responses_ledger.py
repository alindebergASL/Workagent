"""Append-only two-step durable authority. Every network slot commits before I/O."""
from dataclasses import asdict, dataclass
from decimal import Decimal
from hashlib import sha256
from .errors import DomainError
from .models import new_id
from .service import encoded, digest
from .responses_transport import (PreparedRequest, RequestMetadata, DispatchPermit, ParsedResponse,
                                  Provenance, Usage, MODEL, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS,
                                  INPUT_RESERVATION_RATE, OUTPUT_RESERVATION_RATE)
from .responses_schema import READ_SCHEMA, FINAL_SCHEMA

RESERVED_INPUT=MAX_INPUT_TOKENS
RESERVED_OUTPUT=MAX_OUTPUT_TOKENS
RESERVED_COST=(Decimal(RESERVED_INPUT)*Decimal(INPUT_RESERVATION_RATE)+
               Decimal(RESERVED_OUTPUT)*Decimal(OUTPUT_RESERVATION_RATE))/Decimal(1000000)


def count_input_limit(send):
    """Read immutable send policy, not today's ceiling, for historical receipts.

    Pre-041 count sends stored exactly {}; new SQL inserts require an explicit
    50k policy. Never treat a missing send or malformed policy as legacy evidence.
    """
    if send == {}:
        return 20000
    if (isinstance(send,dict) and set(send)=={'input_token_limit'}
            and type(send['input_token_limit']) is int and send['input_token_limit']==50000):
        return 50000
    raise DomainError('command_conflict')

class ReservationDeferred(Exception):
    """The uncommitted reservation was rolled back before any external I/O."""


@dataclass(frozen=True)
class ObservationAuthority:
    """Current principal authority, independent of the write-only receipt."""
    principal: object


@dataclass(frozen=True)
class ExactObservationAuthority(ObservationAuthority):
    """Owner-installed, finite authority to read one revoked response only."""
    observer_id: str
    phase: str


class Ledger:
    def __init__(self,service,receipt):
        self.service=service
        self.receipt=receipt

    def _auth(self,c,cap=None,*,observation=False):
        run,attempt,origin=self.service._receipt_binding(c,self.receipt)
        if isinstance(cap,ObservationAuthority):
            if not observation:raise DomainError('unsupported_operation')
            self.service._scope(c,cap.principal,run.workspace_id,write=True)
            if isinstance(cap,ExactObservationAuthority):
                from .receipt_observer import observer_hash
                row=c.execute('SELECT observer_sha256 FROM exact_receipt_observers WHERE id=%s',
                              (cap.observer_id,)).fetchone()
                permitted=bool(row and row['observer_sha256']==observer_hash() and c.execute(
                    'SELECT exact_receipt_observation_permits(%s,%s,%s) permitted',
                    (cap.observer_id,attempt.id,cap.phase)).fetchone()['permitted'])
            else:
                permitted=c.execute(
                    'SELECT cancelled_response_observation_permits(%s) permitted',
                    (attempt.id,)).fetchone()['permitted']
            if cap.principal.id!=run.principal_id or not permitted:
                raise DomainError('not_found_or_not_authorized')
        elif cap is not None:
            _,current,_=self.service._check_capability(c,cap)
            if current.id!=run.id:
                raise DomainError('not_found_or_not_authorized')
            from .research import authorize_run_dependencies
            authorize_run_dependencies(c,run.workspace_id,run.id)
        return run,attempt,origin

    def _events(self,c,phase):
        rows=c.execute('SELECT kind,data FROM responses_events WHERE attempt_id=%s AND phase=%s ORDER BY created_at,id',
                       (self.receipt.attempt_id,phase)).fetchall()
        return {r['kind']:r['data'] for r in rows if r['kind'] not in ('read','cancel')}

    def event(self,c,phase,kind,data):
        event_id=new_id()
        c.execute('INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,%s,%s,%s)',
                  (event_id,self.receipt.attempt_id,phase,kind,encoded(data)))
        return event_id

    def snapshot(self,phase,cap):
        if cap is None:raise DomainError('not_found_or_not_authorized')
        if isinstance(cap,ExactObservationAuthority) and phase!=cap.phase:
            raise DomainError('not_found_or_not_authorized')
        with self.service.db.transaction() as c:
            run,_,_=self._auth(c,cap,observation=True)
            row=c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                          (self.receipt.attempt_id,phase)).fetchone()
            if not row:
                return None,{}
            policy='general-responses-v1' if run.profile=='general-responses-v1' else 'intake-v1'
            if policy=='general-responses-v1':
                from .general_schema import DECISION_SCHEMA,EXPLANATION_SCHEMA
                from .general_responses import check_pins
                from .adaptive import enabled,CAPABILITY
                if isinstance(cap,ObservationAuthority):
                    config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                        (run.workspace_id,run.id)).fetchone()['data']
                    from .provider_attempts import check_grant
                    if not isinstance(cap,ExactObservationAuthority):
                        check_grant(c,run,config)
                else:
                    config=check_pins(c,run)
                if enabled(config):
                    from .adaptive import DECISION_SCHEMA
                    from .composition import enabled as alpha_enabled, continuity_enabled
                    if alpha_enabled(config):
                        from .composition import DECISION_SCHEMA
                    if continuity_enabled(config):
                        from .composition import CONTINUITY_DECISION_SCHEMA as DECISION_SCHEMA
                    policy=CAPABILITY
                from .retained_results import enabled as retained_enabled, SCHEMA as RETAINED_SCHEMA
                if retained_enabled(config): DECISION_SCHEMA=RETAINED_SCHEMA
                from .capabilities.file_composition import enabled as file_enabled, SCHEMA as FILE_SCHEMA
                if file_enabled(config): DECISION_SCHEMA=FILE_SCHEMA
                from .capabilities.compute_composition import enabled as compute_enabled, SCHEMA as COMPUTE_SCHEMA
                if compute_enabled(config): DECISION_SCHEMA=COMPUTE_SCHEMA
                from .memory.runtime import enabled as memory_enabled, SCHEMA as MEMORY_SCHEMA
                if memory_enabled(config): DECISION_SCHEMA=MEMORY_SCHEMA
                from .capabilities.research_composition import enabled as research_enabled, SCHEMA as RESEARCH_SCHEMA
                if research_enabled(config): DECISION_SCHEMA=RESEARCH_SCHEMA
                schema=DECISION_SCHEMA if phase!='final' else EXPLANATION_SCHEMA
                if phase!='final' and enabled(config) and alpha_enabled(config):
                    # Restore an exact recognized historical validator, never
                    # rewrite stored schemas or parse old bytes as a new request.
                    import json
                    from .service import canonical
                    from .composition import LEGACY_DECISION_SCHEMA,LEGACY_CONTINUITY_DECISION_SCHEMA
                    legacy=LEGACY_CONTINUITY_DECISION_SCHEMA if continuity_enabled(config) else LEGACY_DECISION_SCHEMA
                    stored=json.loads(row['request_bytes'])['tools'][0]['parameters']
                    if canonical(stored).encode()==legacy.material:
                        schema=legacy
            else:
                schema=READ_SCHEMA if phase=='selection' else FINAL_SCHEMA
            request=PreparedRequest(row['request_bytes'].encode(),RequestMetadata.model_validate(row['metadata']),phase,schema,policy)
            if request.sha256!=row['request_sha256'] or request.count_body()!=row['count_bytes'].encode():
                raise DomainError('command_conflict')
            return request,self._events(c,phase)

    def prepare(self,request,cap):
        with self.service.db.transaction() as c:
            run,attempt,_=self._auth(c,cap)
            if request.metadata.attempt_id!=attempt.id or request.metadata.step_id!=request.phase:
                raise DomainError('command_conflict')
            prior=c.execute('SELECT request_sha256 FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                            (attempt.id,request.phase)).fetchone()
            if prior:
                if prior['request_sha256']!=request.sha256:
                    raise DomainError('command_conflict')
                return
            count=request.count_body()
            c.execute('''INSERT INTO responses_steps(attempt_id,phase,grant_id,request_bytes,request_sha256,count_bytes,count_sha256,metadata)
                         VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',
                      (attempt.id,request.phase,attempt.grant_id,request.body.decode(),request.sha256,count.decode(),
                       sha256(count).hexdigest(),encoded(request.metadata.model_dump())))
            from .memory.runtime import record_request
            record_request(self.service,c,run,request)

    def reserve_operation(self,request,kind,cap,*,ready=None):
        if cap is None:raise DomainError('not_found_or_not_authorized')
        if kind not in ('count_send','dispatch','read','cancel'):
            raise ValueError('invalid operation')
        with self.service.db.transaction() as c:
            run,attempt,_=self._auth(c,cap,observation=True)
            if isinstance(cap,ObservationAuthority):
                if kind!='read':raise DomainError('unsupported_operation')
                if isinstance(cap,ExactObservationAuthority) and request.phase!=cap.phase:
                    raise DomainError('not_found_or_not_authorized')
            elif run.profile=='general-responses-v1':
                self.service._general_context(c,cap)
            events=self._events(c,request.phase)
            stored=c.execute('SELECT request_sha256 FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                             (attempt.id,request.phase)).fetchone()
            if not stored or stored['request_sha256']!=request.sha256:
                raise DomainError('command_conflict')
            if kind in events:
                raise DomainError('action_unresolved')
            if kind in ('read','cancel') and not events.get('identity'):
                raise DomainError('action_unresolved')
            if kind=='dispatch' and 'count_result' not in events:
                raise DomainError('action_unresolved')
            from .models import ProviderGrant
            grant=ProviderGrant.model_validate(c.execute('SELECT data FROM provider_grants WHERE id=%s',(attempt.grant_id,)).fetchone()['data'])
            b=grant.responses
            alpha=getattr(b,'runtime_extension',None)=='general-alpha-v1'
            if alpha:
                # Same workspace -> project lock order as SQL. Refresh shared
                # counters only AFTER locking; pending/unknown sends never refund.
                if c.execute('SHOW transaction_isolation').fetchone()['transaction_isolation']!='read committed':
                    raise DomainError('unsupported_operation')
                c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE',(grant.workspace_id,))
                c.execute('SELECT pg_advisory_xact_lock(721004120)')
                shared=summary(c,attempt.grant_id,shared=True)
                n=shared['request_counts'][kind]
            else:
                n=c.execute('''SELECT count(*) AS n FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
                               WHERE s.grant_id=%s AND e.kind=%s''',(attempt.grant_id,kind)).fetchone()['n']
            limit={'count_send':b.count_limit,'dispatch':b.generation_limit,'read':b.read_limit,'cancel':b.cancel_limit}[kind]
            if n >= limit:
                raise DomainError('budget_exhausted')
            data={'input_token_limit':MAX_INPUT_TOKENS} if kind=='count_send' else {}
            if isinstance(cap,ObservationAuthority):
                data=({'receipt_observer':cap.observer_id} if isinstance(cap,ExactObservationAuthority)
                      else {'cancelled_observation':True})
            if kind in ('count_send','dispatch'):
                # Same lock/order and isolation as the DB guard. Check after the
                # lock so a racing workspace yields a typed budget stop, not SQL
                # exception/retry. Never change the caller's isolation implicitly.
                # A fresh count is futile if its generation cannot fit. This is
                # feasibility, not a reservation: dispatch still rechecks. Reads
                # and already committed dispatch permits must remain usable.
                if c.execute('SHOW transaction_isolation').fetchone()['transaction_isolation']!='read committed':
                    raise DomainError('unsupported_operation')
                c.execute('SELECT pg_advisory_xact_lock(721004120)')
                totals=summary(c,attempt.grant_id,shared=alpha)
                shared=summary(c,attempt.grant_id,shared=True)
                if (totals['request_counts']['dispatch']>=b.generation_limit or
                    totals['reserved_input_tokens']+RESERVED_INPUT>b.input_limit or
                    totals['reserved_output_tokens']+RESERVED_OUTPUT>b.output_limit or
                    Decimal(shared['reserved_cost_usd'])+RESERVED_COST>Decimal(b.cost_limit_usd)):
                    raise DomainError('budget_exhausted')
            if kind=='dispatch':
                data={'reserved_input_tokens':RESERVED_INPUT,'reserved_output_tokens':RESERVED_OUTPUT,
                      'reserved_cost_usd':str(RESERVED_COST),'billed_cost_usd':None}
                if attempt.state=='prepared':
                    attempt.state='dispatched'
                    self.service._store_attempt(c,attempt)
            event_id=self.event(c,request.phase,kind,data)
            # SQL guards/lock waits can consume the remaining HTTP window. Check
            # at the last transactional boundary: a refusal rolls back both the
            # event and attempt transition, never refunds a committed reservation.
            # The caller must still reauthorize immediately before external I/O.
            if ready is not None and not ready(run):
                raise ReservationDeferred()
            if kind=='dispatch':
                return DispatchPermit(metadata=request.metadata,request_sha256=request.sha256,
                    input_tokens=events['count_result']['input_tokens'],model=MODEL,service_tier='default',
                    input_reservation_usd_per_million='2.5',output_reservation_usd_per_million='10',
                    durable_predispatch_committed=True,aggregate_budget_reserved=True,live_grant_id=attempt.grant_id)
            return event_id

    def retain(self,request,kind,data):
        # Write-only retention survives revoke/lease expiry. No stored body returned.
        # Scheduling and broker writes require their separate live-capability path.
        if kind not in ('count_result','identity','result'):
            raise DomainError('unsupported_operation')
        with self.service.db.transaction() as c:
            _,attempt,origin=self._auth(c)
            row=c.execute('SELECT request_sha256 FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                          (attempt.id,request.phase)).fetchone()
            if not row or row['request_sha256']!=request.sha256:
                raise DomainError('command_conflict')
            events=self._events(c,request.phase)
            if kind in events:
                if events[kind]!=data:
                    raise DomainError('command_conflict')
                return True
            if kind=='count_result':
                if (data['request_sha256']!=request.sha256 or data['count_sha256']!=sha256(request.count_body()).hexdigest()
                    or data['metadata']!=request.metadata.model_dump()):
                    raise DomainError('command_conflict')
            if kind in ('identity','result'):
                if data['request_sha256']!=request.sha256 or data['metadata']!=request.metadata.model_dump():
                    raise DomainError('command_conflict')
                expected='official_api' if origin=='live_provider_receipt' else 'synthetic'
                if data['provenance']['mode']!=expected:
                    raise DomainError('command_conflict')
                if events.get('identity') and events['identity']['response_id']!=data['response_id']:
                    raise DomainError('command_conflict')
            self.event(c,request.phase,kind,data)
        return True

    def count_problem(self,request,error):
        """Retain only safe count diagnostics; never clear/retry an unknown slot."""
        allowed={'observation_unavailable','http_error','malformed_response',
                 'invalid_or_excessive_input_count','input_count_exceeds_limit'}
        code=error.code if error.code in allowed else 'count_observation_unavailable'
        data={'operation':'count','code':code,'received':False}
        if code=='http_error' and type(error.http_status) is int and 100<=error.http_status<=599:
            data['http_status']=error.http_status
        with self.service.db.transaction() as c:
            self._auth(c)
            row=c.execute('SELECT request_sha256 FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                          (self.receipt.attempt_id,request.phase)).fetchone()
            events=self._events(c,request.phase)
            if (not row or row['request_sha256']!=request.sha256 or 'count_send' not in events
                    or 'count_result' in events or 'dispatch' in events):
                raise DomainError('command_conflict')
            limit=count_input_limit(events['count_send'])
            if (code=='input_count_exceeds_limit' and type(error.input_tokens) is int
                    and error.input_tokens>limit):
                data.update(received=True,input_tokens=error.input_tokens,limit=limit)
            if 'problem' in events:
                if events['problem']!=data: raise DomainError('command_conflict')
                return
            self.event(c,request.phase,'problem',data)

    def corrected_readback(self,request,response,read_id,cap):
        """One exact parser correction, NOT a general receipt replacement/import.

        Arrival retention of original receipts remains unchanged. This correction
        additionally requires current scope and an explicitly approved successor.
        """
        from .responses_worker import consumer_hash
        import json
        data=parsed_data(response)
        with self.service.db.transaction() as c:
            _,attempt,_=self._auth(c,cap)
            row=c.execute('SELECT request_sha256,metadata FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                          (attempt.id,request.phase)).fetchone()
            old_row=c.execute("SELECT id,data FROM responses_events WHERE attempt_id=%s AND phase=%s AND kind='result'",
                              (attempt.id,request.phase)).fetchone()
            events=self._events(c,request.phase)
            old=old_row['data'] if old_row else {}
            if (request.phase!='final' or not row or row['request_sha256']!=request.sha256 or
                row['metadata']!=request.metadata.model_dump() or old.get('state')!='malformed' or
                old.get('issue')!='invalid_reasoning_item' or old.get('output_items')!='[]' or
                old.get('value') is not None or not old.get('usage') or data['state']!='completed' or
                data['issue'] is not None or data['value'] is None or
                any(data[k]!=old[k] for k in ('response_id','request_sha256','metadata','usage','provenance')) or
                data['response_id']!=events.get('identity',{}).get('response_id')):
                raise DomainError('command_conflict')
            # Revalidate strict schema before storing; provider parsing already
            # checked model/tier/correlation and transport checked retrieved ID.
            request.schema.model.model_validate(data['value'],strict=True)
            data.update(original_event_id=old_row['id'],original_issue=old['issue'],
                original_result_sha256=digest(old),read_event_id=read_id,
                original_consumer_sha256=attempt.consumer_sha256,actual_consumer_sha256=consumer_hash(),
                model=json.loads(request.body)['model'])
            if 'corrected_readback' in events:raise DomainError('command_conflict')
            self.event(c,request.phase,'corrected_readback',data)
        # Explicit committed exact readback, still behind fresh current authority.
        with self.service.db.transaction() as c:
            self._auth(c,cap)
            if self._events(c,request.phase).get('corrected_readback')!=data:
                raise DomainError('command_conflict')

    def tool_result(self,request,data,cap):
        with self.service.db.transaction() as c:
            run,_,_=self._auth(c,cap)
            if run.profile=='general-responses-v1': raise DomainError('unsupported_operation')
            events=self._events(c,'selection')
            if events.get('result',{}).get('state')!='function_call':
                raise DomainError('action_unresolved')
            if 'tool_result' in events:
                if events['tool_result']!=data:
                    raise DomainError('command_conflict')
                return
            self.event(c,'selection','tool_result',data)


def parsed_data(result):
    return {'response_id':result.response_id,'request_sha256':result.request_sha256,
            'metadata':result.metadata.model_dump(),'provenance':asdict(result.provenance),
            'state':result.state,'usage':asdict(result.usage) if result.usage else None,
            'value':result.value.model_dump(mode='json') if result.value else None,
            'call_id':result.call_id,'output_items':result.output_items.decode(),'issue':result.issue}


def restore_result(data,request):
    if data['request_sha256']!=request.sha256 or data['metadata']!=request.metadata.model_dump():
        raise DomainError('command_conflict')
    return ParsedResponse(response_id=data['response_id'],request_sha256=request.sha256,metadata=request.metadata,
        provenance=Provenance(**data['provenance']),state=data['state'],usage=Usage(**data['usage']) if data['usage'] else None,
        value=request.schema.model.model_validate(data['value'],strict=True) if data['value'] else None,
        call_id=data['call_id'],output_items=data['output_items'].encode(),issue=data['issue'])


def observations(c,attempt_id):
    from .models import ResponseStepObservation
    # Mirror the immutable explicit-target equality gate in general_responses.
    # A parsed call that cannot pass that gate is not pending provider work.
    # This is read-only classification: never rewrite/settle the received result,
    # release its reservation, retry it, or broaden the selected target.
    message=c.execute("SELECT m.data->'target' target,m.author_kind,rc.data config FROM conversation_messages m "
                      'JOIN provider_attempts a ON a.workspace_id=m.workspace_id AND a.run_id=m.run_id '
                      'JOIN run_configurations rc ON rc.workspace_id=a.workspace_id AND rc.run_id=a.run_id '
                      "WHERE a.id=%s AND m.author_kind IN ('human','system')",(attempt_id,)).fetchone()
    target=message['target'] if message else None
    from .selection_policy import companion_view, companion_enabled
    # Only the new policy permits companion creation. Historical denied receipts
    # keep their original classification; this is not retrospective authority.
    config=message['config'] if message else {}
    companion_policy=companion_enabled(config)
    steps=c.execute('SELECT phase FROM responses_steps WHERE attempt_id=%s ORDER BY CASE phase WHEN \'final\' THEN 1 ELSE 0 END,phase',(attempt_id,)).fetchall()
    result=[]
    for step in steps:
        rows=c.execute('SELECT kind,data FROM responses_events WHERE attempt_id=%s AND phase=%s AND kind NOT IN (\'read\',\'cancel\')',(attempt_id,step['phase'])).fetchall()
        e={r['kind']:r['data'] for r in rows}
        receipt=e.get('corrected_readback',e.get('result',{})); usage=receipt.get('usage'); identity=e.get('identity',{})
        state=('received' if receipt.get('state') in ('function_call','completed') else 'invalid') if receipt else (
            'accepted' if identity else 'outcome_unknown' if 'dispatch' in e else 'counted' if 'count_result' in e else 'count_unknown' if 'count_send' in e else 'prepared')
        if state in ('count_unknown','outcome_unknown') and 'problem' not in e:
            from .responses_io import active
            kind='count_send' if state=='count_unknown' else 'dispatch'
            if active(c,attempt_id,step['phase'],kind):
                state='counting' if kind=='count_send' else 'dispatching'
        if e.get('problem',{}).get('received') and not receipt: state='invalid'
        decision=(receipt.get('value') or {}).get('decision',{})
        if (target is not None and receipt.get('state')=='function_call' and 'tool_result' not in e
                and decision.get('kind') in ('publish_artifact','reconcile_csv','run_wasm')
                and decision.get('target')!=target
                and not companion_view(decision,target,author_kind=message['author_kind'],
                    alpha=companion_policy,responsibility=bool(config.get('responsibility')))):
            state='invalid'
        cost=(Decimal(usage['input_tokens'])*Decimal('2.5')+Decimal(usage['output_tokens'])*Decimal('10'))/Decimal(1000000) if usage else None
        result.append(ResponseStepObservation(phase=step['phase'],state=state,response_id=identity.get('response_id'),
            reported_input_tokens=usage['input_tokens'] if usage else None,reported_output_tokens=usage['output_tokens'] if usage else None,
            reserved_cost_usd=e.get('dispatch',{}).get('reserved_cost_usd'),
            conservatively_calculated_cost_usd=str(cost) if cost is not None else None,billed_cost_usd=None))
    return result


def summary(c,grant_id,*,shared=False):
    predicate='s.grant_id IN (SELECT responses_budget_grants(%s))' if shared else 's.grant_id=%s'
    # One aggregate row, not one Python/JSON object for every historical event.
    # Keep the exact grant/project predicate, unknown reservations and carry;
    # no cache may hide a reservation committed by another worker.
    totals=c.execute('''SELECT
        count(*) FILTER (WHERE e.kind='count_send') AS count_send,
        count(*) FILTER (WHERE e.kind='dispatch') AS dispatch,
        count(*) FILTER (WHERE e.kind='read') AS read,
        count(*) FILTER (WHERE e.kind='cancel') AS cancel,
        coalesce(sum((e.data->>'reserved_input_tokens')::bigint) FILTER (WHERE e.kind='dispatch'),0) AS reserved_input,
        coalesce(sum((e.data->>'reserved_output_tokens')::bigint) FILTER (WHERE e.kind='dispatch'),0) AS reserved_output,
        coalesce(sum((e.data->>'reserved_cost_usd')::numeric) FILTER (WHERE e.kind='dispatch'),0) AS reserved_cost,
        count(*) FILTER (WHERE e.kind='result' AND e.data->'usage'->>'input_tokens' IS NOT NULL) AS usages,
        coalesce(sum((e.data->'usage'->>'input_tokens')::bigint) FILTER (WHERE e.kind='result'),0) AS reported_input,
        coalesce(sum((e.data->'usage'->>'output_tokens')::bigint) FILTER (WHERE e.kind='result'),0) AS reported_output
        FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
        WHERE '''+predicate+" AND e.kind IN ('count_send','dispatch','read','cancel','result')",(grant_id,)).fetchone()
    counts={k:totals[k] for k in ('count_send','dispatch','read','cancel')}
    unknown=counts['dispatch']-totals['usages']
    calculated=((Decimal(totals['reported_input'])*Decimal('2.5')+Decimal(totals['reported_output'])*Decimal('10'))/Decimal(1000000)
                if totals['usages'] else 0)
    carried = Decimal(0)
    carry_fields = {}
    if shared:
        carry = c.execute('''SELECT count(*) AS n, coalesce(sum(b.reserved_cost_usd),0) AS cost
            FROM responses_budget_carry b JOIN provider_grants g ON g.id=%s
            WHERE b.project_id=g.data->'responses'->>'project_id'
              AND b.transport_mode=g.data->'responses'->>'transport_mode' ''',(grant_id,)).fetchone()
        carried = carry['cost']
        if carry['n']:
            carry_fields = {'carried_reserved_cost_usd':str(carried)}
    from .capabilities.observations import accounting
    tools=accounting(c,grant_id,shared=shared)
    tool_fields=({'tool_accounting':tools,'model_calculated_cost_usd':str(calculated) if not unknown else None}
                 if tools else {})
    tool_reserved=Decimal(tools['reserved_cost_usd']) if tools else Decimal(0)
    # Local elapsed/CPU measurements do not establish dollars or provider billing.
    # Never label the model-only calculation as the combined cost.
    total_calculated=None if tools else (str(calculated) if not unknown else None)
    return {**carry_fields,**tool_fields,'request_counts':counts,'reserved_input_tokens':int(totals['reserved_input']),
            'reserved_output_tokens':int(totals['reserved_output']),
            'reserved_cost_usd':str(carried+totals['reserved_cost']+tool_reserved),
            'reported_usage':{'input_tokens':int(totals['reported_input']),'output_tokens':int(totals['reported_output'])},
            'unknown_usage_steps':unknown,'conservatively_calculated_cost_usd':total_calculated,
            'billed_cost_usd':None,'cost_basis':'undiscounted reservation rates; not provider billing'}
