"""Append-only two-step durable authority. Every network slot commits before I/O."""
from dataclasses import asdict
from decimal import Decimal
from hashlib import sha256
from .errors import DomainError
from .models import new_id
from .service import encoded, digest
from .responses_transport import (PreparedRequest, RequestMetadata, DispatchPermit, ParsedResponse,
                                  Provenance, Usage, MODEL)
from .responses_schema import READ_SCHEMA, FINAL_SCHEMA

RESERVED_INPUT=20000
RESERVED_OUTPUT=8192
RESERVED_COST=(Decimal(RESERVED_INPUT)*Decimal('2.5')+Decimal(RESERVED_OUTPUT)*Decimal('10'))/Decimal(1000000)

class Ledger:
    def __init__(self,service,receipt):
        self.service=service
        self.receipt=receipt

    def _auth(self,c,cap=None):
        run,attempt,origin=self.service._receipt_binding(c,self.receipt)
        if cap is not None:
            _,current,_=self.service._check_capability(c,cap)
            if current.id!=run.id:
                raise DomainError('not_found_or_not_authorized')
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
        with self.service.db.transaction() as c:
            run,_,_=self._auth(c,cap)
            row=c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                          (self.receipt.attempt_id,phase)).fetchone()
            if not row:
                return None,{}
            policy='general-responses-v1' if run.profile=='general-responses-v1' else 'intake-v1'
            if policy=='general-responses-v1':
                from .general_schema import DECISION_SCHEMA,EXPLANATION_SCHEMA
                from .general_responses import check_pins
                from .adaptive import enabled,CAPABILITY
                if enabled(check_pins(c,run)):
                    from .adaptive import DECISION_SCHEMA
                    policy=CAPABILITY
                schema=DECISION_SCHEMA if phase!='final' else EXPLANATION_SCHEMA
            else:
                schema=READ_SCHEMA if phase=='selection' else FINAL_SCHEMA
            request=PreparedRequest(row['request_bytes'].encode(),RequestMetadata.model_validate(row['metadata']),phase,schema,policy)
            if request.sha256!=row['request_sha256'] or request.count_body()!=row['count_bytes'].encode():
                raise DomainError('command_conflict')
            return request,self._events(c,phase)

    def prepare(self,request,cap):
        with self.service.db.transaction() as c:
            _,attempt,_=self._auth(c,cap)
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

    def reserve_operation(self,request,kind,cap):
        if kind not in ('count_send','dispatch','read','cancel'):
            raise ValueError('invalid operation')
        with self.service.db.transaction() as c:
            run,attempt,_=self._auth(c,cap)
            if run.profile=='general-responses-v1':
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
            n=c.execute('''SELECT count(*) AS n FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
                           WHERE s.grant_id=%s AND e.kind=%s''',(attempt.grant_id,kind)).fetchone()['n']
            from .models import ProviderGrant
            grant=ProviderGrant.model_validate(c.execute('SELECT data FROM provider_grants WHERE id=%s',(attempt.grant_id,)).fetchone()['data'])
            b=grant.responses
            limit={'count_send':b.count_limit,'dispatch':b.generation_limit,'read':b.read_limit,'cancel':b.cancel_limit}[kind]
            if n >= limit:
                raise DomainError('budget_exhausted')
            data={}
            if kind=='dispatch':
                # Same lock/order and isolation as the DB guard. Check after the
                # lock so a racing workspace yields a typed budget stop, not SQL
                # exception/retry. Never change the caller's isolation implicitly.
                if c.execute('SHOW transaction_isolation').fetchone()['transaction_isolation']!='read committed':
                    raise DomainError('unsupported_operation')
                c.execute('SELECT pg_advisory_xact_lock(721004120)')
                totals=summary(c,attempt.grant_id)
                shared=summary(c,attempt.grant_id,shared=True)
                if (totals['reserved_input_tokens']+RESERVED_INPUT>b.input_limit or
                    totals['reserved_output_tokens']+RESERVED_OUTPUT>b.output_limit or
                    Decimal(shared['reserved_cost_usd'])+RESERVED_COST>Decimal(b.cost_limit_usd)):
                    raise DomainError('budget_exhausted')
                data={'reserved_input_tokens':RESERVED_INPUT,'reserved_output_tokens':RESERVED_OUTPUT,
                      'reserved_cost_usd':str(RESERVED_COST),'billed_cost_usd':None}
                if attempt.state=='prepared':
                    attempt.state='dispatched'
                    self.service._store_attempt(c,attempt)
            event_id=self.event(c,request.phase,kind,data)
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
    steps=c.execute('SELECT phase FROM responses_steps WHERE attempt_id=%s ORDER BY CASE phase WHEN \'final\' THEN 1 ELSE 0 END,phase',(attempt_id,)).fetchall()
    result=[]
    for step in steps:
        rows=c.execute('SELECT kind,data FROM responses_events WHERE attempt_id=%s AND phase=%s AND kind NOT IN (\'read\',\'cancel\')',(attempt_id,step['phase'])).fetchall()
        e={r['kind']:r['data'] for r in rows}
        receipt=e.get('corrected_readback',e.get('result',{})); usage=receipt.get('usage'); identity=e.get('identity',{})
        state=('received' if receipt.get('state') in ('function_call','completed') else 'invalid') if receipt else (
            'accepted' if identity else 'outcome_unknown' if 'dispatch' in e else 'counted' if 'count_result' in e else 'count_unknown' if 'count_send' in e else 'prepared')
        if e.get('problem',{}).get('received') and not receipt: state='invalid'
        cost=(Decimal(usage['input_tokens'])*Decimal('2.5')+Decimal(usage['output_tokens'])*Decimal('10'))/Decimal(1000000) if usage else None
        result.append(ResponseStepObservation(phase=step['phase'],state=state,response_id=identity.get('response_id'),
            reported_input_tokens=usage['input_tokens'] if usage else None,reported_output_tokens=usage['output_tokens'] if usage else None,
            reserved_cost_usd=e.get('dispatch',{}).get('reserved_cost_usd'),
            conservatively_calculated_cost_usd=str(cost) if cost is not None else None,billed_cost_usd=None))
    return result


def summary(c,grant_id,*,shared=False):
    predicate='s.grant_id IN (SELECT responses_budget_grants(%s))' if shared else 's.grant_id=%s'
    rows=c.execute('SELECT e.kind,e.data FROM responses_events e JOIN responses_steps s USING(attempt_id,phase) WHERE '+predicate,(grant_id,)).fetchall()
    counts={k:sum(r['kind']==k for r in rows) for k in ('count_send','dispatch','read','cancel')}
    reservations=[r['data'] for r in rows if r['kind']=='dispatch']
    receipts=[r['data'] for r in rows if r['kind']=='result']
    usages=[r['usage'] for r in receipts if r.get('usage')]
    unknown=len(reservations)-len(usages)
    calculated=sum((Decimal(u['input_tokens'])*Decimal('2.5')+Decimal(u['output_tokens'])*Decimal('10'))/Decimal(1000000) for u in usages)
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
    return {**carry_fields,'request_counts':counts,'reserved_input_tokens':sum(r['reserved_input_tokens'] for r in reservations),
            'reserved_output_tokens':sum(r['reserved_output_tokens'] for r in reservations),
            'reserved_cost_usd':str(carried+sum((Decimal(r['reserved_cost_usd']) for r in reservations),Decimal(0))),
            'reported_usage':{'input_tokens':sum(u['input_tokens'] for u in usages),'output_tokens':sum(u['output_tokens'] for u in usages)},
            'unknown_usage_steps':unknown,'conservatively_calculated_cost_usd':str(calculated) if not unknown else None,
            'billed_cost_usd':None,'cost_basis':'undiscounted reservation rates; not provider billing'}
