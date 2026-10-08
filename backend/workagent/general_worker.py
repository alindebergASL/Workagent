"""The B1 product worker, used unchanged by CLI and HTTP-admitted turns.

Controlled transport is an explicit test input, not a second answer-producing
CLI or an inference implementation. No provider modules, keys or fallback.
"""
from copy import deepcopy

from .conversations import PROFILE, PRODUCT_PROFILE
from .errors import DomainError
from .models import TextResult, TurnResult
from .service import Principal


class ControlledTransport:
    mode = 'controlled'

    def __init__(self, responses=None):
        self.responses = iter(responses) if responses is not None else None
        self.calls = 0
        self.contexts = []

    def respond(self, context):
        self.calls += 1
        self.contexts.append(deepcopy(context))
        if self.responses is not None:
            return next(self.responses)
        humans=[m for m in context['messages'] if m['author_kind']=='human']
        operation=humans[-1].get('operation')
        if operation is not None:
            # Controlled selection from the explicit registry; broker resolves exact inputs.
            return {'tool':operation['kind']}
        # Deliberately a wiring receipt rather than a canned useful answer.
        return TurnResult(results=[TextResult(text=(
            f'Controlled transport: retained {len(humans)} human message(s). '
            'What outcome would you like to work toward? '
            'This verifies persistence and worker wiring, not model usefulness.'))])


class GeneralWorker:
    def __init__(self, service, *, transport, enable_responses=False, state=None, poll_limit=10, hook=None):
        self.phases=None
        if isinstance(transport,ControlledTransport) and transport.mode=='controlled':
            if enable_responses: raise DomainError('unsupported_operation')
        elif enable_responses is True and state is not None:
            from .responses_transport import ResponsesTransport
            if type(transport) is not ResponsesTransport: raise DomainError('unsupported_operation')
            # Reuse only the existing durable one-phase HTTP driver, never its
            # intake worker/run path. GeneralWorker owns this conversation loop.
            from .responses_worker import ResponsesWorker
            self.phases=ResponsesWorker(service,transport,state,poll_limit=poll_limit,hook=hook)
        else:
            raise DomainError('unsupported_operation')
        self.service=service
        self.transport=transport

    def _terminal_readback(self,p,ws,run):
        if run.state=='ready':
            detail=self.service.get_conversation(p,ws,run.conversation_id)
            if not any(m.run_id==run.id and m.author_kind=='assistant' for m in detail.messages):
                raise DomainError('action_unresolved')
        return run

    def _recover_failure(self,p,ws,run_id,cap):
        """One failure publication attempt; durable authority wins over a lost ACK."""
        service=self.service
        try:
            observed=service.get_run(p,ws,run_id)
            if observed.state in ('ready','partial'):
                return self._terminal_readback(p,ws,observed)
            # Recheck context before attempting publication. fail_local_turn checks
            # the fenced capability again in its own terminal-write transaction.
            service.conversation_worker_context(cap)
            try:
                service.fail_local_turn(cap,
                    'Controlled worker failed; no result was fabricated. Submit a fresh turn to retry.')
            except DomainError:
                raise
            except Exception:
                # No retry: publication itself may have committed before losing ACK.
                pass
            observed=service.get_run(p,ws,run_id)
            if observed.state not in ('ready','partial'):
                raise DomainError('action_unresolved')
            return self._terminal_readback(p,ws,observed)
        except DomainError as exc:
            raise exc from None
        except Exception:
            # Recovery/readback unavailable: leave the existing lease/outbox alone.
            # Never leak transport, validation, or persistence exception contents.
            raise DomainError('action_unresolved') from None

    def work(self,p,ws,run_id):
        service=self.service
        run=service.get_run(p,ws,run_id)
        if run.profile=='general-responses-v1':
            if self.phases is None: raise DomainError('unsupported_operation')
            with self.phases.state.lock(ws,run_id):
                return self._responses_work(p,ws,run)
        if self.phases is not None or run.profile not in (PROFILE,PRODUCT_PROFILE):
            raise DomainError('unsupported_operation')
        if run.state in ('ready','partial','cancelled'):
            # Exact durable readback; duplicate delivery must not invoke transport.
            return self._terminal_readback(p,ws,run)
        cap=service.claim_run(p,ws,run_id)
        try:
            context=service.conversation_worker_context(cap)
            result=self.transport.respond(context)
            if run.profile==PRODUCT_PROFILE:
                if not isinstance(result,dict) or set(result)!= {'tool'}:
                    return service.fail_local_turn(cap,'Controlled transport did not select the authorized local tool.')
                try:
                    service.execute_local_product(cap,result['tool'])
                except DomainError as exc:
                    if exc.code.value in ('version_conflict','unsupported_operation','budget_exhausted'):
                        return service.fail_local_turn(cap,exc.code.value+'; inspect saved state and submit a fresh turn.')
                    raise
            else:
                service.complete_conversation_turn(cap,result)
            observed=service.get_run(p,ws,run_id)
            if observed.state not in ('ready','partial'):
                raise DomainError('action_unresolved')
            return observed
        except DomainError:
            raise
        except Exception:
            # Only ordinary post-claim failures are isolated; process-control
            # BaseExceptions (SystemExit/KeyboardInterrupt) retain crash semantics.
            return self._recover_failure(p,ws,run_id,cap)

    def _responses_work(self,p,ws,run):
        from dataclasses import asdict
        import time
        from .provider_attempts import ReceiptCapability
        from .service import WorkerCapability,canonical,digest
        from .general_responses import check_pins,POLICY
        from .general_schema import DECISION_SCHEMA,EXPLANATION_SCHEMA
        from .responses_transport import RequestMetadata,build_tool_selection,build_final,TransportError
        from .responses_ledger import Ledger
        s=self.service; phases=self.phases; rid=run.id
        if run.state in ('ready','partial','cancelled'):
            return self._terminal_readback(p,ws,run)
        with s.db.transaction() as c:
            config=check_pins(c,run)
            phases._authorize_transport(config)
        saved=phases.state.load(ws,rid)
        receipt=ReceiptCapability(**saved['receipt']) if saved and saved.get('receipt') else None
        cap=WorkerCapability(**saved['worker']) if saved else None
        if cap:
            try:
                with s.db.transaction() as c: s._check_capability(c,cap)
            except DomainError:
                if receipt is None: raise
                cap=s._claim_run(p,ws,rid,responses_receipt=receipt)
                saved['worker']=asdict(cap); phases.state.save(ws,rid,saved)
        else:
            cap=s.claim_run(p,ws,rid)
            saved={'worker':asdict(cap),'receipt':None}; phases.state.save(ws,rid,saved)
        context=s.conversation_worker_context(cap)
        from .adaptive import enabled,contract
        from .models import ProviderGrant
        with s.db.transaction() as c:
            grant=ProviderGrant.model_validate(c.execute('SELECT data FROM provider_grants WHERE id=%s',(config['grant_id'],)).fetchone()['data'])
        POLICY,DECISION_SCHEMA=contract(grant.responses)
        if receipt is None:
            attempt=s.prepare_provider_attempt(cap,request_hash=digest({'context':context,'schema':DECISION_SCHEMA.material.decode()}),
                consumer_sha256=config['consumer_sha256'],transport=self.transport,
                evidence_origin='live_provider_receipt' if self.transport.provenance.mode=='official_api' else 'synthetic_provider_receipt')
            receipt=s.bind_provider_receipt(cap,attempt.id)
            saved['receipt']=asdict(receipt); phases.state.save(ws,rid,saved)
        from .responses_recovery import record_successor_use
        record_successor_use(s,receipt,cap)
        ledger=Ledger(s,receipt); deadline=time.monotonic()+phases.deadline_seconds
        if enabled(config):
            return self._adaptive_work(p,ws,run,cap,receipt,ledger,context,config,deadline)
        selection,_=ledger.snapshot('selection',cap)
        if selection is None:
            selection=build_tool_selection(instructions=POLICY,source_context=canonical(context),
                read_schema=DECISION_SCHEMA,metadata=RequestMetadata(request_id=rid,attempt_id=receipt.attempt_id,step_id='selection'),
                policy='general-responses-v1')
            ledger.prepare(selection,cap)
        try:
            selected=phases._step(ledger,selection,cap,deadline)
            if selected is None or selected.state!='function_call':
                return s.get_run(p,ws,rid)
            staged=s.stage_general_product(cap,receipt)
            phases._hook('after_tool_result')
            final,_=ledger.snapshot('final',cap)
            if final is None:
                final=build_final(selection_request=selection,selection=selected,tool_output=canonical(staged),
                    instructions=POLICY,artifact_schema=EXPLANATION_SCHEMA,
                    metadata=RequestMetadata(request_id=rid,attempt_id=receipt.attempt_id,step_id='final'))
                ledger.prepare(final,cap)
            generated=phases._step(ledger,final,cap,deadline)
            if generated is None or generated.state!='completed':
                return s.get_run(p,ws,rid)
            phases._hook('before_publication')
            s.complete_general_product(cap,receipt)
            phases._hook('after_publication')
            return self._terminal_readback(p,ws,s.get_run(p,ws,rid))
        except TransportError:
            # Ambiguous count/send is kept in the exact journal. No controlled
            # failure message, new turn, repair, regenerated decision or refund.
            return s.get_run(p,ws,rid)
        except DomainError:
            raise
        except Exception:
            # Read back a potentially committed result; never fail/retry generation.
            observed=s.get_run(p,ws,rid)
            if observed.state in ('ready','partial','cancelled'):
                return self._terminal_readback(p,ws,observed)
            raise

    def _adaptive_work(self,p,ws,run,cap,receipt,ledger,context,config,deadline):
        from .acceptance_checks import for_model
        from .adaptive import POLICY,DECISION_SCHEMA,CAPABILITY,phase_name,retained,continuation_context
        from .general_schema import EXPLANATION_SCHEMA
        from .responses_transport import RequestMetadata,build_tool_selection,build_final,TransportError
        from .service import canonical
        s=self.service; phases=self.phases; rid=run.id
        bound=config['responses']['max_steps']
        try:
            for index in range(1,bound+1):
                phase=phase_name(index)
                selection,_=ledger.snapshot(phase,cap)
                if selection is None:
                    with s.db.transaction() as c:
                        ledger._auth(c,cap)
                        observations=retained(c,receipt.attempt_id)
                    selection=build_tool_selection(instructions=POLICY,
                        source_context=canonical(continuation_context(context,observations,bound)),
                        read_schema=DECISION_SCHEMA,
                        metadata=RequestMetadata(request_id=rid,attempt_id=receipt.attempt_id,step_id=phase),
                        policy=CAPABILITY,phase=phase)
                    ledger.prepare(selection,cap)
                selected=phases._step(ledger,selection,cap,deadline)
                if selected is None or selected.state!='function_call': return s.get_run(p,ws,rid)
                staged=s.stage_general_product(cap,receipt,phase)
                phases._hook('after_tool_result')
                if staged['terminal_outcome']=='continue': continue
                final,_=ledger.snapshot('final',cap)
                if final is None:
                    final=build_final(selection_request=selection,selection=selected,tool_output=canonical(for_model(staged)),
                        instructions=POLICY,artifact_schema=EXPLANATION_SCHEMA,
                        metadata=RequestMetadata(request_id=rid,attempt_id=receipt.attempt_id,step_id='final'))
                    ledger.prepare(final,cap)
                generated=phases._step(ledger,final,cap,deadline)
                if generated is None or generated.state!='completed': return s.get_run(p,ws,rid)
                phases._hook('before_publication')
                s.complete_general_product(cap,receipt,phase)
                phases._hook('after_publication')
                return self._terminal_readback(p,ws,s.get_run(p,ws,rid))
            raise DomainError('action_unresolved')
        except TransportError:
            return s.get_run(p,ws,rid)
        except DomainError as exc:
            if exc.code.value!='budget_exhausted': raise
            s.stop_general_budget(cap,receipt)
            return self._terminal_readback(p,ws,s.get_run(p,ws,rid))
        except Exception:
            observed=s.get_run(p,ws,rid)
            if observed.state in ('ready','partial','cancelled'):
                return self._terminal_readback(p,ws,observed)
            raise

    def once(self, *, workspace=None):
        """One bounded batch from the existing durable outbox admission ledger."""
        with self.service.db.transaction() as c:
            rows=c.execute('''SELECT d.workspace_id,d.run_id,r.data FROM run_dispatches d
                JOIN runs r ON r.workspace_id=d.workspace_id AND r.id=d.run_id
                WHERE d.acknowledged_at IS NULL AND r.data->>'profile' IN (%s,%s,%s)
                AND (%s::text IS NULL OR d.workspace_id=%s) ORDER BY d.cursor LIMIT 100''',
                (PROFILE if self.phases is None else 'general-responses-v1',PRODUCT_PROFILE if self.phases is None else 'general-responses-v1','general-responses-v1' if self.phases else PROFILE,workspace,workspace)).fetchall()
        counts={'completed':0,'deferred':0,'denied':0}
        for row in rows:
            try:
                run=self.work(Principal(row['data']['principal_id'],'worker'),row['workspace_id'],row['run_id'])
                counts['completed' if run.state in ('ready','partial','cancelled') else 'deferred']+=1
            except DomainError as exc:
                counts['deferred' if exc.code.value=='action_unresolved' else 'denied']+=1
        return counts


def main():
    import argparse
    import os
    import json
    from .db import Database
    from .service import Service
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controlled',action='store_true')
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--provider')
    parser.add_argument('--workspace')
    args=parser.parse_args()
    if not args.controlled or args.live or args.provider:
        parser.error('Only explicit --controlled is supported; live/provider execution is disabled.')
    if os.environ.get('LOCAL_TEST_MODE')!='true':
        parser.error('LOCAL_TEST_MODE=true required')
    db=Database(); db.check_runtime_role()
    print(json.dumps(GeneralWorker(Service(db),transport=ControlledTransport()).once(workspace=args.workspace)))


if __name__=='__main__':
    main()
