"""The B1 product worker, used unchanged by CLI and HTTP-admitted turns.

Controlled transport is an explicit test input, not a second answer-producing
CLI or an inference implementation. No provider modules, keys or fallback.
"""
from copy import deepcopy

from .conversations import PROFILE, PRODUCT_PROFILE
from .errors import DomainError
from .models import TextResult, TurnResult
from .service import Principal

GENERAL_CLAIM_SECONDS = 600


def final_tool_output(staged,selection):
    """Avoid a second copy of the exact draft already in the tool-call history.

    All provider output/reasoning items and the initial context remain intact.
    Only identical publish_artifact bodies are referenced, never calculated
    outputs, differing normalized bodies, human notes or verification evidence.
    This is a projection for a NEW final request, not a journal/stage rewrite.
    """
    from .service import canonical,digest
    value=selection.value.model_dump(mode='json') if selection.value is not None else {}
    decision=value.get('decision',{})
    body=staged.get('body')
    if (staged.get('status')=='observed' and body is not None
            and decision.get('kind')=='publish_artifact'
            and canonical(decision.get('body'))==canonical(body)):
        staged={**staged,'body':None,'body_reference':{
            'source':'preceding_choose_general_action_arguments.decision.body',
            'sha256':digest(body),'reason':'identical_body_already_present_in_full_function_call'}}
    return canonical(staged)


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
            self.phases=ResponsesWorker(service,transport,state,poll_limit=poll_limit,hook=hook,
                                        general_responses=True)
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
                result=self._responses_work(p,ws,run)
                if result.state=='running' and self.phases._yield_if_settled(ws,run_id):
                    return service.get_run(p,ws,run_id)
                return result
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

    @staticmethod
    def _request_context(context):
        # These exact declarations already occupy the top-level provider fields.
        # Keep all user content, target bodies, bindings and method discovery;
        # remove only the redundant control-plane copies from the user payload.
        return {k:v for k,v in context.items() if k not in ('instructions','tools')}

    def _observe_cancelled(self,p,ws,run):
        from dataclasses import asdict
        from .provider_attempts import ReceiptCapability, check_grant
        from .responses_ledger import Ledger, ObservationAuthority, parsed_data
        from .responses_transport import TransportError
        saved=self.phases.state.load(ws,run.id)
        if not saved or not saved.get('receipt'):return
        ledger=Ledger(self.service,ReceiptCapability(**saved['receipt']))
        authority=ObservationAuthority(p)
        def fresh(request=None):
            with self.service.db.transaction() as c:
                current,attempt,_=ledger._auth(c,authority,observation=True)
                config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                    (ws,run.id)).fetchone()['data']
                check_grant(c,current,config)
                self.phases._authorize_transport(config)
                if request is not None:
                    events=ledger._events(c,request.phase)
                    if events['identity']['provenance']!=asdict(self.transport.provenance):
                        raise DomainError('action_unresolved')
                return attempt
        try:
            attempt=fresh()
            with self.service.db.transaction() as c:
                phases=c.execute('SELECT phase FROM responses_steps WHERE attempt_id=%s ORDER BY phase',
                                 (attempt.id,)).fetchall()
            # One GET per visit, under the existing private run lock. All reads
            # use the original prepared bytes/schema and shared read counter.
            for row in phases:
                request,events=ledger.snapshot(row['phase'],authority)
                if 'result' in events or 'identity' not in events:continue
                if self.phases.poll_limit==0:return
                fresh(request)
                ledger.reserve_operation(request,'read',authority)
                fresh(request)  # Independently recheck after reservation commit.
                response=self.transport.retrieve(events['identity']['response_id'],request=request)
                if response.state not in ('queued','in_progress'):
                    ledger.retain(request,'result',parsed_data(response))
                return
        except (DomainError,TransportError):
            return  # No replay, refund, execution, publication or lease mutation.

    def _claim_responses_run(self,p,ws,run_id,*,responses_receipt=None):
        """Ordinary NEW general Responses claim, with a fixed 600-second lease.

        Retain the ordinary claim transaction protocol. Never extend an existing lease or
        accept a caller-selected duration. Other profiles use the service policy.
        An abandoned new claim can take 420 seconds longer than the prior policy;
        provider timeouts and all current authority stay unchanged.
        """
        import secrets
        from datetime import timedelta
        from .errors import deny
        from .models import Run,now
        from .provider_attempts import attempt_row
        from .service import WorkerCapability,digest
        s=self.service
        with s.db.transaction() as c:
            generation=s._scope(c,p,ws,True)
            row=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',(ws,run_id)).fetchone()
            if not row:
                deny()
            r=Run.model_validate(row['data'])
            if r.principal_id!=p.id or r.profile!='general-responses-v1':
                deny()
            a=(s._conversation(c,p,ws,r.conversation_id,True) if r.conversation_id else
               s._assignment(c,p,ws,r.assignment_id,True))
            attempt=attempt_row(c,ws,run_id)
            if responses_receipt is not None:
                bound,existing,_=s._receipt_binding(c,responses_receipt)
                if bound.id!=r.id or existing.state=='failed':
                    raise DomainError('action_unresolved')
            elif attempt:
                raise DomainError('action_unresolved')
            s._runtime_pins(c,r)
            if a.state in ('paused','cancelled') or r.state not in ('queued','running'):
                raise DomainError('action_unresolved')
            if r.access_generation!=generation:
                raise DomainError('source_changed')
            if r.state=='running' and r.lease_expires_at and r.lease_expires_at>now():
                raise DomainError('action_unresolved')
            if r.used_units>=r.budget_units:
                raise DomainError('budget_exhausted')
            owner_column='conversation_id' if r.conversation_id else 'assignment_id'
            others=c.execute(f'SELECT data FROM runs WHERE workspace_id=%s AND {owner_column}=%s AND id<>%s',(ws,a.id,r.id)).fetchall()
            for other in others:
                active=Run.model_validate(other['data'])
                if active.state=='running' and active.lease_expires_at and active.lease_expires_at>now():
                    raise DomainError('action_unresolved')
            secret=secrets.token_urlsafe(32)
            r.fence+=1; r.state='running'; r.lease_expires_at=now()+timedelta(seconds=GENERAL_CLAIM_SECONDS)
            s._store_run(c,r)
            c.execute('UPDATE runs SET lease_hash=%s WHERE workspace_id=%s AND id=%s',(digest(secret),ws,r.id))
            if not r.conversation_id:
                s._refresh_progress(c,a)
                a.work_version+=1; s._store_assignment(c,a)
            s._event(c,p,ws,'claim_run',r.id)
            cap=WorkerCapability(ws,r.id,p.id,r.fence,secret)
            if r.conversation_id:
                s._general_context(c,cap)
            else:
                from .runtime_config import assemble_context
                assemble_context(s,c,cap)
            return cap

    def _responses_work(self,p,ws,run):
        from dataclasses import asdict
        from .provider_attempts import ReceiptCapability
        from .service import WorkerCapability,canonical,digest
        from .general_responses import check_pins,POLICY
        from .general_schema import DECISION_SCHEMA,EXPLANATION_SCHEMA
        from .responses_transport import RequestMetadata,build_tool_selection,build_final,TransportError
        from .responses_ledger import Ledger
        s=self.service; phases=self.phases; rid=run.id
        if run.state=='cancelled':
            self._observe_cancelled(p,ws,run)
            return self._terminal_readback(p,ws,run)
        if run.state in ('ready','partial'):
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
                # Reclaim only through domain authority: a receipt is required
                # whenever an attempt exists; an active lease is never renewed.
                cap=self._claim_responses_run(p,ws,rid,responses_receipt=receipt)
                saved['worker']=asdict(cap); phases.state.save(ws,rid,saved)
        else:
            cap=self._claim_responses_run(p,ws,rid)
            saved={'worker':asdict(cap),'receipt':None}; phases.state.save(ws,rid,saved)
        deadline=phases._visit_deadline(cap)
        from .adaptive import enabled,contract
        resume_prepared=False; resume_final=False
        if receipt is not None and enabled(config):
            with s.db.transaction() as c:
                prepared_phases={row['phase'] for row in c.execute(
                    'SELECT phase FROM responses_steps WHERE attempt_id=%s',(receipt.attempt_id,)).fetchall()}
                resume_prepared=bool(prepared_phases); resume_final='final' in prepared_phases
        try:
            # _visit_deadline's _fresh already validates current context. A
            # retained request needs no new request projection; each retained
            # selection and the pre-I/O gates revalidate context below as well.
            context=None if resume_prepared else s.conversation_worker_context(cap)
        except DomainError as exc:
            # A restart may encounter a committed draft before staging got to
            # revalidate its request projection. Settle against frozen authority,
            # without replaying any retained step or creating a new attempt.
            if exc.code.value!='budget_exhausted' or receipt is None:
                raise
            return self._terminal_readback(p,ws,s.stop_general_budget(cap,receipt))
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
        ledger=Ledger(s,receipt)
        if enabled(config):
            return self._adaptive_work(p,ws,run,cap,receipt,ledger,context,config,deadline,resume_final=resume_final)
        try:
            selection,_=ledger.snapshot('selection',cap)
            if selection is None:
                from .request_packing import prepare_selection
                selection=prepare_selection(context,instructions=POLICY,
                    read_schema=DECISION_SCHEMA,metadata=RequestMetadata(request_id=rid,attempt_id=receipt.attempt_id,step_id='selection'),
                    policy='general-responses-v1')
                ledger.prepare(selection,cap)
            selected=phases._step(ledger,selection,cap,deadline)
            if selected is None or selected.state!='function_call':
                return s.get_run(p,ws,rid)
            staged=s.stage_general_product(cap,receipt)
            phases._hook('after_tool_result')
            final,_=ledger.snapshot('final',cap)
            if final is None:
                final=build_final(selection_request=selection,selection=selected,tool_output=final_tool_output(staged,selected),
                    instructions=POLICY,artifact_schema=EXPLANATION_SCHEMA,
                    metadata=RequestMetadata(request_id=rid,attempt_id=receipt.attempt_id,step_id='final'))
                from .request_packing import check_final
                check_final(final)
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
        except DomainError as error:
            if error.code.value=='budget_exhausted':
                result=s.stop_general_budget(cap,receipt)
                return self._terminal_readback(p,ws,result)
            raise
        except Exception:
            # Read back a potentially committed result; never fail/retry generation.
            observed=s.get_run(p,ws,rid)
            if observed.state in ('ready','partial','cancelled'):
                return self._terminal_readback(p,ws,observed)
            raise

    def _prepared_selection(self,ledger,cap,config,decision_schema,*,resume_settled=False):
        """Validate the prefix and optionally return its last durable local stage.

        Default callers retain the prepared-request interface. The ordinary
        worker also consumes a fully settled latest phase without replaying it.
        """
        from .adaptive import phase_name
        with self.service.db.transaction() as c:
            ledger._auth(c,cap)
            names={r['phase'] for r in c.execute(
                'SELECT phase FROM responses_steps WHERE attempt_id=%s',
                (ledger.receipt.attempt_id,)).fetchall()}
            latest=phase_name(len(names)) if names and 'final' not in names else None
            events=ledger._events(c,latest) if latest and resume_settled else {}
        if 'final' in names or not names:return None
        count=len(names)
        if (count>config['responses']['max_steps'] or
                names!={phase_name(i) for i in range(1,count+1)}):
            raise DomainError('command_conflict')
        if resume_settled and {'tool_result','selection_rejection','file_input_rejection'} & events.keys():
            selection,selected,staged,rejection_kind=self._prepared_final(
                ledger,cap,config,decision_schema,settled_prefix=True)
            return selection,count,(selected,staged,rejection_kind)
        if names=={'selection'}:return None
        request,_=self._prepared_final(ledger,cap,config,decision_schema,pending_phase=phase_name(count))
        return (request,count,None) if resume_settled else (request,count)

    def _prepared_final(self,ledger,cap,config,decision_schema,*,pending_phase=None,settled_prefix=False):
        """Validate a retained chain without executing or restaging its effects.

        A final follows a terminal choice; a prepared selection follows only
        continuing choices. A settled prefix may await its first successor.
        Load each exact request/schema/count, restore each
        result, and resolve current
        authority for every choice. Nothing here grants I/O or caches authority.
        The ordinary phase driver owns count/dispatch/identity recovery unchanged.
        """
        import json
        from .adaptive import phase_name
        from .responses_ledger import restore_result
        from .general_responses import resolve_selection
        from .capabilities.policy import require_operation
        from .products import is_builtin_operation
        from .product_models import PublishArtifact
        from .acceptance_checks import for_model
        from .responses_transport import PreparedRequest,RequestMetadata
        from .service import canonical
        from .legacy_document_schema import restore_schema
        from .adaptive import CAPABILITY
        if pending_phase and settled_prefix:raise ValueError('one resume boundary required')
        destination=None if settled_prefix else pending_phase or 'final'
        if not pending_phase and not settled_prefix:
            final,_=ledger.snapshot(destination,cap)
            if final is None:return None
        s=self.service
        with s.db.transaction() as c:
            # The final snapshot authenticates its read. For a selection, do one
            # authenticated bulk read and fully validate its exact request below,
            # rather than validating it once in snapshot and again in this chain.
            if pending_phase or settled_prefix:ledger._auth(c,cap)
            # Every choice still resolves current authority below; the unchanged
            # phase driver independently snapshots and authorizes before I/O.
            rows=c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s',
                           (ledger.receipt.attempt_id,)).fetchall()
            # One authenticated read of immutable history. This is not an
            # authority cache: resolve_selection below rechecks current scope,
            # grant, context, targets and dependencies for every selected action.
            history={r['phase']:(r,ledger._events(c,r['phase'])) for r in rows if r['phase']!=destination}
        names={r['phase'] for r in rows}
        count=len(names)-(0 if settled_prefix else 1)
        expected={phase_name(i) for i in range(1,count+1)}
        if not settled_prefix:expected.add(destination)
        if not 1<=count<=config['responses']['max_steps'] or names!=expected:
            raise DomainError('command_conflict')
        if pending_phase:
            from hashlib import sha256
            pending_row=next(r for r in rows if r['phase']==pending_phase)
            schema=restore_schema(json.loads(pending_row['request_bytes'])['tools'][0]['parameters'],decision_schema)
            final=PreparedRequest(pending_row['request_bytes'].encode(),
                RequestMetadata.model_validate(pending_row['metadata']),pending_phase,schema,CAPABILITY)
            count_bytes=final.count_body()
            if (final.body!=pending_row['request_bytes'].encode()
                    or final.sha256!=pending_row['request_sha256']
                    or count_bytes!=pending_row['count_bytes'].encode()
                    or sha256(count_bytes).hexdigest()!=pending_row['count_sha256']
                    or pending_row['grant_id']!=config['grant_id']
                    or final.metadata.request_id!=cap.run_id
                    or final.metadata.attempt_id!=ledger.receipt.attempt_id
                    or final.metadata.step_id!=pending_phase):
                raise DomainError('command_conflict')
        if pending_phase or settled_prefix:
            from .adaptive import retained,continuation_context
            from .request_packing import project_observations
            with s.db.transaction() as c:
                observations=retained(c,ledger.receipt.attempt_id,include_rejections=True)
            def validate_continuation(request,index):
                # Validate the original compact projection against exact retained
                # observations. Do not reconstruct context, repack, or reprepare.
                # Current context/targets are checked by resolve_selection and
                # rejection retain below, and again at the unchanged I/O gates.
                body=json.loads(request.body)
                if len(body['input'])!=1 or body['input'][0].get('role')!='user':
                    raise DomainError('command_conflict')
                context=json.loads(body['input'][0]['content'])
                prior=[o for o in observations if o['phase'] in {phase_name(i) for i in range(1,index)}]
                if (context.get('run_id')!=cap.run_id or len(prior)!=index-1
                        or [o['phase'] for o in prior]!=[phase_name(i) for i in range(1,index)]):
                    raise DomainError('command_conflict')
                # A result obtained AFTER this request was prepared cannot
                # retroactively establish the goal on an earlier malformed call.
                first=next((history[phase_name(i)][1]['result']['value'] for i in range(1,index)
                    if history[phase_name(i)][1].get('result',{}).get('state')=='function_call'),None)
                for observation in prior:
                    if observation.get('kind')=='file_input_rejection':
                        for key in ('goal','success_criteria'):
                            if first is None:observation.pop(key,None)
                            else:observation[key]=first[key]
                projected=continuation_context(deepcopy(context),prior,config['responses']['max_steps'])
                project_observations(projected,context.get('input_projection',{}).get('version'))
                if context.get('adaptive')!=projected['adaptive']:
                    raise DomainError('command_conflict')
            if pending_phase:validate_continuation(final,count+1)
        for index in range(1,count+1):
            phase=phase_name(index)
            row,events=history[phase]
            schema=restore_schema(json.loads(row['request_bytes'])['tools'][0]['parameters'],decision_schema)
            selection=PreparedRequest(row['request_bytes'].encode(),RequestMetadata.model_validate(row['metadata']),
                                      phase,schema,CAPABILITY)
            if settled_prefix:validate_continuation(selection,index)
            # Same full request/schema/count validation as Ledger.snapshot; no
            # FrozenSchema or validator instance is treated as prevalidated.
            count_bytes=selection.count_body()
            from hashlib import sha256
            if (selection.sha256!=row['request_sha256'] or count_bytes!=row['count_bytes'].encode()
                    or sha256(count_bytes).hexdigest()!=row['count_sha256']
                    or row['grant_id']!=config['grant_id']
                    or selection.metadata.request_id!=cap.run_id
                    or selection.metadata.attempt_id!=ledger.receipt.attempt_id or selection.metadata.step_id!=phase):
                raise DomainError('command_conflict')
            if not {'count_send','count_result','dispatch','identity','result'}<=events.keys():
                raise DomainError('action_unresolved')
            if pending_phase or settled_prefix:
                for kind in ('count_result','identity','result'):
                    if (events[kind].get('request_sha256')!=selection.sha256 or
                            events[kind].get('metadata')!=selection.metadata.model_dump()):
                        raise DomainError('command_conflict')
                if (events['count_result'].get('count_sha256')!=row['count_sha256'] or
                        events['identity'].get('response_id')!=events['result'].get('response_id') or
                        {'problem','corrected_readback'} & events.keys()):
                    raise DomainError('command_conflict')
            selected=restore_result(events['result'],selection)
            if settled_prefix and selected.usage is None:
                raise DomainError('action_unresolved')
            rejection_kind=None
            if 'file_input_rejection' in events:
                from .file_input_rejection import retain
                rejection=retain(ledger,selection,cap)
                if (not rejection or 'tool_result' in events or 'selection_rejection' in events
                        or (index==count and not pending_phase and not settled_prefix)
                        or rejection['terminal_outcome'] not in (
                            ('continue','step_limit') if settled_prefix and index==count else ('continue',))):
                    raise DomainError('command_conflict')
                staged=rejection;rejection_kind='file_input_rejection'
                continue
            if selected.state=='malformed' and selected.issue=='schema_validation_failed':
                # retain revalidates the diagnostic, original malformed bytes,
                # current publication authority and exact historical fence. With
                # an existing rejection it is validation only, never an insert.
                if 'selection_rejection' not in events or 'tool_result' in events:
                    raise DomainError('command_conflict')
                from .selection_rejection import retain
                rejection=retain(ledger,selection,cap)
                if ((index==count and not pending_phase and not settled_prefix) or
                        rejection['terminal_outcome'] not in (
                            ('continue','step_limit') if settled_prefix and index==count else ('continue',))):
                    raise DomainError('command_conflict')
                staged=rejection;rejection_kind='selection_rejection'
                continue
            staged=events.get('tool_result')
            if selected.state!='function_call' or not staged or 'selection_rejection' in events:
                raise DomainError('action_unresolved')
            with s.db.transaction() as c:
                resolved=resolve_selection(s,c,cap,ledger.receipt,phase)
                _,run,_,operation,_,binding,_=resolved
                try:
                    if not is_builtin_operation(operation):
                        require_operation(c,run,operation)
                except DomainError as exc:
                    # Same narrow legacy rejection as stage_general_product;
                    # never turn a current authority denial into valid history.
                    if (exc.code.value!='unsupported_operation' or not isinstance(operation,PublishArtifact)
                            or staged.get('status')!='rejected'):
                        raise
                if staged['binding']!=binding:
                    raise DomainError('source_changed')
                if settled_prefix:
                    # A provider result/stage marker alone cannot resolve an
                    # uncertain native send. 078 no-effect rejection was handled
                    # by its dedicated validator above, not this observed path.
                    native=c.execute("SELECT e.data FROM tool_attempts a LEFT JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' WHERE a.workspace_id=%s AND a.run_id=%s AND a.call_id=%s",
                        (cap.workspace_id,cap.run_id,phase)).fetchall()
                    if any(not r['data'] or r['data'].get('status')!='observed' for r in native):
                        raise DomainError('action_unresolved')
            terminal=staged.get('terminal_outcome')
            allowed=('answered','completed','needs_validation','blocked','waiting_for_user','step_limit')
            if settled_prefix:allowed=(*allowed,'continue')
            if ((index<count or pending_phase) and terminal!='continue') or (not pending_phase and index==count and terminal not in allowed):
                raise DomainError('command_conflict')
        if settled_prefix:
            # Historical metadata counted tool_result rows only. A fully
            # authenticated bound-length continuing prefix is exhausted work,
            # not permission to select another action or rewrite its receipt.
            return selection,selected,staged,rejection_kind
        if pending_phase:return final,pending_phase
        # Validate the exact continuation relation, without building/preparing a
        # replacement request, invoking tools, recounting, or changing any bytes.
        body=json.loads(final.body)
        history=json.loads(selection.body)['input']+json.loads(selected.output_items)+[
            {'type':'function_call_output','call_id':selected.call_id,
             'output':final_tool_output(for_model(staged),selected)}]
        # Instructions remain the original hash/count-bound bytes, even after a
        # policy amendment. Current grant/context authority is checked separately.
        if body['input']!=history:
            raise DomainError('command_conflict')
        return final,phase

    def _stop_exhausted_prefix(self,ledger,cap,config,selection,staged):
        """Settle only a prefix already checked by _prepared_final(settled_prefix).

        The immutable history stays continuing; the run's bounded slice is
        partial. No model final, assistant receipt or material is fabricated.
        """
        from .adaptive import phase_name,phase_ordinal
        from .general_responses import check_pins
        from .file_input_rejection import tools_unresolved
        from .outcomes import acknowledge
        from .run_checkpoints import record
        reason=('Execution reached its configured selection phase limit. Retained work and usage are preserved; '
                'the requested goal is incomplete. Further work requires a new bounded continuation.')
        s=self.service
        with s.db.transaction() as c:
            ledger._auth(c,cap)
            p,run,cv=s._check_capability(c,cap)
            current=check_pins(c,run)
            if current!=config:raise DomainError('source_changed')
            bound=current['responses']['max_steps']
            if (phase_ordinal(selection.phase,bound)!=bound or staged.get('terminal_outcome')!='continue'
                    or selection.metadata.attempt_id!=ledger.receipt.attempt_id
                    or selection.metadata.request_id!=run.id):
                raise DomainError('command_conflict')
            names={r['phase'] for r in c.execute('SELECT phase FROM responses_steps WHERE attempt_id=%s',
                (ledger.receipt.attempt_id,)).fetchall()}
            if (names!={phase_name(i) for i in range(1,bound+1)}
                    or ledger._events(c,selection.phase).get('tool_result')!=staged):
                raise DomainError('command_conflict')
            s._validate_general_context(c,cap)
            c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',
                (run.workspace_id,run.id))
            if (tools_unresolved(c,run.workspace_id,run.id) or c.execute(
                    "SELECT 1 FROM tool_attempts a LEFT JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' "
                    'WHERE a.workspace_id=%s AND a.run_id=%s AND e.attempt_id IS NULL',
                    (run.workspace_id,run.id)).fetchone()):raise DomainError('action_unresolved')
            run.state='partial';run.stop_reason='step_limit';run.unresolved=[reason]
            run.used_units+=1;run.lease_expires_at=None
            run.execution.provider_observation='received'
            s._store_run(c,run)
            record(s,c,run,cv,'final','settlement')
            s._event(c,p,run.workspace_id,'selection_phase_limit',run.id)
            acknowledge(c,run.workspace_id,run.id)
            return run

    def _terminal_or_pending(self,p,ws,rid,cap,receipt,phase,result):
        from .general_responses import terminal_response_failure,stop_terminal_response
        if result is not None and terminal_response_failure(result.state,result.issue):
            return self._terminal_readback(p,ws,stop_terminal_response(self.service,cap,receipt,phase))
        return self.service.get_run(p,ws,rid)

    def _adaptive_work(self,p,ws,run,cap,receipt,ledger,context,config,deadline,*,resume_final=True):
        from .capabilities.broker import NativeAdmissionDeferred
        from .acceptance_checks import for_model
        from .adaptive import POLICY,DECISION_SCHEMA,CAPABILITY,phase_name,retained,continuation_context
        from .general_schema import EXPLANATION_SCHEMA
        from .responses_transport import RequestMetadata,build_tool_selection,build_final,TransportError
        from .service import canonical
        s=self.service; phases=self.phases; rid=run.id
        from .adaptive import contract
        from .models import ProviderGrant
        with s.db.transaction() as c:
            grant=ProviderGrant.model_validate(c.execute('SELECT data FROM provider_grants WHERE id=%s',(config['grant_id'],)).fetchone()['data'])
        POLICY,DECISION_SCHEMA=contract(grant.responses)
        bound=config['responses']['max_steps']
        try:
            prepared=self._prepared_final(ledger,cap,config,DECISION_SCHEMA) if resume_final else None
            if prepared is not None:
                final,phase=prepared
                generated=phases._step(ledger,final,cap,deadline)
                if generated is None or generated.state!='completed':return self._terminal_or_pending(p,ws,rid,cap,receipt,'final',generated)
                phases._hook('before_publication')
                s.complete_general_product(cap,receipt,phase)
                phases._hook('after_publication')
                return self._terminal_readback(p,ws,s.get_run(p,ws,rid))
            prepared=self._prepared_selection(ledger,cap,config,DECISION_SCHEMA,resume_settled=True)
            start=prepared[1] if prepared else 1
            settled=prepared[2] if prepared else None
            if settled and settled[1]['terminal_outcome']=='continue':
                if start==bound:
                    stopped=self._stop_exhausted_prefix(ledger,cap,config,prepared[0],settled[1])
                    return self._terminal_readback(p,ws,stopped)
                start+=1;prepared=None;settled=None
            for index in range(start,bound+1):
                phase=phase_name(index)
                selection=prepared[0] if prepared and index==start else ledger.snapshot(phase,cap)[0]
                if selection is None:
                    with s.db.transaction() as c:
                        ledger._auth(c,cap)
                        observations=retained(c,receipt.attempt_id,include_rejections=True)
                    context=s.conversation_worker_context(cap)
                    from .request_packing import prepare_selection
                    selection=prepare_selection(continuation_context(context,observations,bound),instructions=POLICY,
                        read_schema=DECISION_SCHEMA,
                        metadata=RequestMetadata(request_id=rid,attempt_id=receipt.attempt_id,step_id=phase),
                        policy=CAPABILITY,phase=phase)
                    ledger.prepare(selection,cap)
                selected=settled[0] if settled else phases._step(ledger,selection,cap,deadline)
                if settled and settled[2]:
                    if settled[2]=='file_input_rejection':
                        from .file_input_rejection import stop
                        stopped=stop(s,cap,receipt,selection)
                    else:
                        from .selection_rejection import stop
                        stopped=stop(s,cap,receipt,phase)
                    return self._terminal_readback(p,ws,stopped)
                if selected is not None and not settled:
                    from .file_input_rejection import retain as reject_file_input
                    rejection=reject_file_input(ledger,selection,cap)
                    if rejection is not None:
                        phases._hook('after_file_input_rejection')
                        if rejection['terminal_outcome']=='step_limit':
                            from .file_input_rejection import stop
                            return self._terminal_readback(p,ws,stop(s,cap,receipt,selection))
                        continue
                if not settled and selected is not None and selected.state=='malformed' and selected.issue=='schema_validation_failed':
                    from .selection_rejection import retain
                    rejection=retain(ledger,selection,cap)
                    phases._hook('after_selection_rejection')
                    if rejection['terminal_outcome']=='step_limit':
                        from .selection_rejection import stop
                        return self._terminal_readback(p,ws,stop(s,cap,receipt,phase))
                    continue
                if selected is None or selected.state!='function_call':return self._terminal_or_pending(p,ws,rid,cap,receipt,phase,selected)
                from .adaptive import stage_product
                staged=settled[1] if settled else stage_product(s,cap,receipt,phase)
                if not settled:phases._hook('after_tool_result')
                if staged['terminal_outcome']=='continue':
                    if index==bound:
                        exact,_,retained_stage,_=self._prepared_final(ledger,cap,config,DECISION_SCHEMA,settled_prefix=True)
                        stopped=self._stop_exhausted_prefix(ledger,cap,config,exact,retained_stage)
                        return self._terminal_readback(p,ws,stopped)
                    continue
                final,_=ledger.snapshot('final',cap)
                if final is None:
                    final=build_final(selection_request=selection,selection=selected,tool_output=final_tool_output(for_model(staged),selected),
                        instructions=POLICY,artifact_schema=EXPLANATION_SCHEMA,
                        metadata=RequestMetadata(request_id=rid,attempt_id=receipt.attempt_id,step_id='final'))
                    from .request_packing import check_final
                    check_final(final)
                    ledger.prepare(final,cap)
                generated=phases._step(ledger,final,cap,deadline)
                if generated is None or generated.state!='completed':return self._terminal_or_pending(p,ws,rid,cap,receipt,'final',generated)
                phases._hook('before_publication')
                s.complete_general_product(cap,receipt,phase)
                phases._hook('after_publication')
                return self._terminal_readback(p,ws,s.get_run(p,ws,rid))
            raise DomainError('action_unresolved')
        except NativeAdmissionDeferred:
            # Only the broker's new-attempt pre-effect rollback is deferrable.
            # Existing unknown/cost-only outcomes and authority denials propagate.
            return s.get_run(p,ws,rid)
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
