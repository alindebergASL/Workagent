"""Broker-checked local operations on the existing run/artifact authority.

No external effects. Pure computation may repeat after an uncommitted crash.
Only this seam creates observations, from local kernel returns, never caller bodies.
"""
import hashlib
from .models import *
from .product_models import ReconcileCSV, RunWasm, CSVObservation, WasmObservation, RetainedLocalResult
from .errors import DomainError, deny
from .local_operations import reconcile_csv, OperationRejected
from .wasm_tool import run_wasm_tool, ToolRejected


def byte_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def adaptive_readback(c,run,attempt):
    from .adaptive import enabled,retained
    from .product_models import AdaptiveExecution,AdaptiveStep
    from .responses_ledger import summary
    config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(run.workspace_id,run.id)).fetchone()
    if not config or not enabled(config['data']): return None
    data=config['data']; observations=retained(c,attempt['id']) if attempt else []
    first=c.execute("SELECT data->'value' AS value FROM responses_events WHERE attempt_id=%s AND phase='selection' AND kind='result'",(attempt['id'],)).fetchone() if attempt else None
    value=(first['value'] if first else None) or {}
    return AdaptiveExecution(goal=value.get('goal'),success_criteria=value.get('success_criteria',[]),
        max_steps=data['responses']['max_steps'],outcome='cancelled' if run.state=='cancelled' else (run.stop_reason or (observations[-1]['terminal_outcome'] if observations else 'pending')),
        shared_reserved_cost_usd=summary(c,data['grant_id'],shared=True)['reserved_cost_usd'],
        steps=[AdaptiveStep(phase=o['phase'],status=o['status'],operation_hash=o['binding']['operation_hash'],
            reason=o.get('reason'),verification=o['verification'],outcome=o['terminal_outcome']) for o in observations])


def turn_state(run,c=None):
    from .service import encoded
    if run.profile=='general-responses-v1':
        from .responses_ledger import observations
        attempt=c.execute('SELECT id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(run.workspace_id,run.id)).fetchone() if c else None
        steps=observations(c,attempt['id']) if attempt else []
        observation='not_observed'
        if steps: observation='pending'
        if any(s.state in ('count_unknown','outcome_unknown') for s in steps): observation='outcome_unknown'
        if any(s.state=='invalid' for s in steps): observation='invalid'
        if run.state in ('ready','partial') and run.stop_reason is None: observation='received'
        state={'ready':'replied','partial':'failed','cancelled':'cancelled','queued':'queued','running':'responding'}[run.state]
        reason={
            'not_observed':'Explicit general profile queued; no provider receipt observed.',
            'pending':'Provider phase pending; recover only the same durable response, never regenerate.',
            'outcome_unknown':'Provider/count outcome unknown; reservations retained. Do not send a fresh turn to retry.',
            'invalid':'Provider output invalid; no repair or generation retry; retained local result is not yet a published product.',
            'received':'Receipt-backed explanation and local result read back; proposals require explicit human acceptance.'}[observation]
        if observation in ('outcome_unknown','invalid'): state='unavailable'
        if run.state=='cancelled': state='cancelled'; reason='Turn cancelled; any sent provider reservations remain retained.'
        if run.state=='partial' and run.unresolved:
            state='failed'; reason=' '.join(run.unresolved)
        retained=None
        if attempt:
            stage=c.execute("SELECT data FROM responses_events WHERE attempt_id=%s AND kind='tool_result' ORDER BY phase DESC LIMIT 1",(attempt['id'],)).fetchone()
            if stage:
                data=stage['data']; output=data['output']
                if output and output['kind']=='run_wasm': output={**output,'value':str(output['value'])}
                published=bool(c.execute("SELECT 1 FROM product_observations WHERE workspace_id=%s AND run_id=%s AND data->'model_selection'=%s LIMIT 1",
                    (run.workspace_id,run.id,encoded(data['binding']))).fetchone())
                retained=RetainedLocalResult(status=data['status'],published=published,
                    binding=data['binding'],body=data['body'],output=output,reason=data.get('reason'))
        return TurnState(run_id=run.id,state=state,reason=reason,profile=run.profile,
            evidence_origin=run.execution.evidence_origin,provider_observation=observation,response_steps=steps,
            retained_local_result=retained,adaptive=adaptive_readback(c,run,attempt))

    state={'ready':'replied','partial':'failed','cancelled':'cancelled','queued':'queued','running':'responding'}[run.state]
    reason={'ready':'Controlled result persisted; proposals still require explicit human acceptance.',
            'partial':'; '.join(run.unresolved) or 'Local operation failed; no result was fabricated.',
            'cancelled':'Turn cancelled or superseded.',
            'queued':'Waiting for the controlled local consumer; no provider response observed.',
            'running':'Controlled local consumer holds a bounded lease.'}[run.state]
    if run.state=='partial' and any('unavailable' in x or 'engine version' in x for x in run.unresolved):
        state='unavailable'
    if run.state=='running' and (not run.lease_expires_at or run.lease_expires_at<=now()):
        state='unavailable'; reason='Consumer lease expired; restart the controlled worker to retry pure local computation.'
    elif run.state=='queued' and (now()-run.observed_at).total_seconds()>10:
        state='unavailable'; reason='No controlled consumer claim observed; start or check the local server worker. No provider fallback.'
    return TurnState(run_id=run.id,state=state,reason=reason)


class Products:
    def local_tool_registry(self):
        return [{'name':name,'inputSchema':model.model_json_schema(),
                 'description':'Only the exact human-authorized current-turn input; no external effects.',
                 'annotations':{'openWorldHint':False,'destructiveHint':False}}
                for name,model in [('reconcile_csv',ReconcileCSV),('run_wasm',RunWasm)]]

    def _product_base(self,c,p,ws,cv,operation):
        if operation.artifact_id is None:
            return None
        row,owner=self._artifact(c,p,ws,operation.artifact_id)
        if row.get('conversation_id')!=cv.id:
            deny()
        self._cas(row,operation.base_revision_id)
        base=self._revision(c,p,ws,row,owner,operation.base_revision_id)
        expected=TableBody if operation.kind=='reconcile_csv' else ToolBody
        if not isinstance(base.body,expected):
            raise DomainError('unsupported_operation')
        return base

    def _local_input(self,c,cap):
        from .conversations import PRODUCT_PROFILE
        p,run,cv=self._check_capability(c,cap)
        if run.profile!=PRODUCT_PROFILE:
            raise DomainError('unsupported_operation')
        self._general_context(c,cap)
        message=next(m for m in self._conversation_messages(c,run.workspace_id,cv.id)
                     if m.run_id==run.id and m.author_kind=='human')
        if message.operation is None:
            raise DomainError('unsupported_operation')
        base=self._product_base(c,p,run.workspace_id,cv,message.operation)
        return p,run,cv,message.operation,base

    def _calculate_product(self,operation,base):
        # Same bounded kernels for controlled and model-selected operations.
        notes=list(base.body.notes) if base else []
        if isinstance(operation,ReconcileCSV):
            source=operation.input_csv
            if base:
                import csv, io
                buffer=io.StringIO(newline='')
                columns=[x for x in base.body.columns if x not in ('calculated_total','difference','check')]
                writer=csv.DictWriter(buffer,fieldnames=columns,lineterminator='\n')
                writer.writeheader(); writer.writerows([{k:row[k] for k in columns} for row in base.body.rows])
                source=buffer.getvalue()
            output=reconcile_csv(source,rounding=operation.rounding)
            body=TableBody(title=base.body.title if base else 'Reconciled invoices',source_csv=base.body.source_csv if base else source,
                rounding=operation.rounding,columns=output['columns'],rows=output['rows'],notes=notes)
            observed=CSVObservation(**{k:v for k,v in output.items() if k not in ('columns','rows','csv')})
            file=FileBody(title='Calculated CSV export',filename='reconciled.csv',mime_type='text/csv',
                          content=output['csv'],content_sha256=byte_hash(output['csv']))
        else:
            code=operation.code if operation.code is not None else base.body.code
            output=run_wasm_tool(code,operation.entrypoint,operation.arguments)
            body=ToolBody(title=base.body.title if base else f'{operation.entrypoint} tool',code=code,
                entrypoint=operation.entrypoint,arguments=operation.arguments,input_form=operation.input_form,notes=notes)
            observed=WasmObservation(**output)
            file=FileBody(title='Portable WebAssembly text',filename=f'tool-{operation.entrypoint}.wat',mime_type='application/wasm-text',
                          content=code,content_sha256=byte_hash(code))
        return body,file,observed

    def execute_local_product(self,cap,tool_name):
        """Selection only; inputs are resolved from immutable authorized messages.

        Returned values cannot be submitted separately to forge an observation.
        Authority is checked before execution and again in the publish transaction.
        """
        from .service import digest, encoded
        from .outcomes import acknowledge
        with self.db.transaction() as c:
            p,run,cv,operation,base=self._local_input(c,cap)
            if operation.kind!=tool_name:
                raise DomainError('unsupported_operation')
            operation_hash=digest(operation)
            base_hash=base.body_hash if base else None
        try:
            body,file,observed=self._calculate_product(operation,base)
        except (OperationRejected,ToolRejected,ValueError) as exc:
            return self.fail_local_turn(cap,str(exc))
        with self.db.transaction() as c:
            p,run,cv,current,current_base=self._local_input(c,cap)
            if digest(current)!=operation_hash or (current_base.body_hash if current_base else None)!=base_hash:
                raise DomainError('source_changed')
            text=('Controlled CSV calculation observed: reported '+observed.reported_sum+'; calculated '+observed.expected_sum+'.' if isinstance(observed,CSVObservation)
                  else f'Controlled import-free Wasm execution observed return: {observed.value}.')
            if base:
                text+=' Change proposed, not accepted; saved human notes retained.'
            results=self._publish_product(c,p,run,cv,operation,base,body,file,observed,text)
        # Exact authorized durable readback, not just a write receipt.
        for item in results:
            readback=self.get_product_observation(p,run.workspace_id,item.observation_id)
            if readback.observation.body_hash!=digest(body if item.kind!='file' else file):
                raise DomainError('action_unresolved')
        return self.get_run(p,run.workspace_id,run.id)

    def _publish_product(self,c,p,run,cv,operation,base,body,file,observed,text,origin='controlled_transport',binding=None,*,unresolved=None):
        from .service import digest,encoded
        from .outcomes import acknowledge
        operation_hash=digest(operation)
        results=[]
        # Initial product creates a typed editable body plus exact download file.
        # Revised product proposes only that body; download its accepted revision.
        for material in ([body] if base else [body,file]):
            aid=operation.artifact_id if base else new_id()
            rid=pid=None
            if base:
                proposal=Proposal(id=new_id(),workspace_id=run.workspace_id,conversation_id=cv.id,
                    artifact_id=aid,base_revision_id=base.id,base_work_version=cv.work_version,
                    body=material,body_hash=digest(material),source_dependencies=cv.selected_source_refs,
                    reason=('Model-selected local result; saved human notes retained. Review before acceptance.' if binding else
                            'Controlled local recalculation/execution; exact saved human notes retained. Review before acceptance.'))
                c.execute('INSERT INTO proposals(workspace_id,id,artifact_id,base_revision_id,data) VALUES (%s,%s,%s,%s,%s)',
                    (run.workspace_id,proposal.id,aid,base.id,encoded(proposal)))
                pid=proposal.id; run.proposal_id=pid; run.artifact_id=aid; run.base_revision_id=base.id
            else:
                c.execute('INSERT INTO artifacts(workspace_id,id,conversation_id) VALUES (%s,%s,%s)',(run.workspace_id,aid,cv.id))
                row,owner=self._artifact(c,p,run.workspace_id,aid)
                artifact=self._append_revision(c,p,run.workspace_id,row,owner,material,cv.selected_source_refs,'worker')
                rid=artifact.current_revision_id
            observation=ProductObservation(id=new_id(),workspace_id=run.workspace_id,conversation_id=cv.id,run_id=run.id,
                artifact_id=aid,revision_id=rid,proposal_id=pid,base_revision_id=base.id if base else None,
                body_hash=digest(material),operation_hash=operation_hash,access_generation=run.access_generation,output=observed,
                evidence_origin='local_tool' if binding else 'controlled_transport',model_selection=binding)
            c.execute('INSERT INTO product_observations(workspace_id,id,run_id,artifact_id,data) VALUES (%s,%s,%s,%s,%s)',
                (run.workspace_id,observation.id,run.id,aid,encoded(observation)))
            results.append(ProductResult(kind=material.kind,artifact_id=aid,revision_id=rid,proposal_id=pid,observation_id=observation.id))
        result=TurnResult(results=[TextResult(text=text),*results])
        messages=self._conversation_messages(c,run.workspace_id,cv.id)
        self._append_message(c,run.workspace_id,ConversationMessage(id=new_id(),conversation_id=cv.id,run_id=run.id,
            sequence=len(messages)+1,author_id='general-worker',author_kind='assistant',text=text,
            evidence_origin=origin,result=result,model_receipt=binding['attempt_id'] if binding else None))
        # Saving an executable artifact is not proof of the requested goal.
        run.state='partial' if unresolved else 'ready'
        if unresolved: run.unresolved=[unresolved]
        run.used_units+=1; run.lease_expires_at=None
        self._store_run(c,run); self._event(c,p,run.workspace_id,'complete_run',run.id)
        acknowledge(c,run.workspace_id,run.id)
        return results

    def stage_general_product(self,cap,receipt,phase='selection'):
        """Resolve receipt-bound args, compute once, retain trusted local evidence.

        Model output cannot submit a staged observation. Crash before retention may
        repeat pure local computation; after retention restart never re-executes it.
        """
        from .general_responses import resolve_selection
        from .responses_ledger import Ledger
        from .service import digest
        ledger=Ledger(self,receipt)
        with self.db.transaction() as c:
            p,run,cv,operation,base,binding,origin=resolve_selection(self,c,cap,receipt,phase)
            prior=ledger._events(c,phase).get('tool_result')
            if prior:
                if prior['binding']!=binding: raise DomainError('source_changed')
                return prior
        if operation is None:
            staged={'status':'reply','body':None,'file':None,'output':None,'binding':binding}
        else:
            try:
                body,file,output=self._calculate_product(operation,base)
                staged={'status':'observed','body':body.model_dump(mode='json'),
                        'file':file.model_dump(mode='json'),'output':output.model_dump(mode='json'),'binding':binding}
            except (OperationRejected,ToolRejected,ValueError) as exc:
                from .adaptive import rejection_diagnostic
                diagnostic=rejection_diagnostic(exc)
                staged={'status':'rejected','body':None,'file':None,'output':None,'binding':binding,
                        'diagnostic':diagnostic,'reason':diagnostic['detail']}
        with self.db.transaction() as c:
            current=resolve_selection(self,c,cap,receipt,phase)
            if current[5]!=binding: raise DomainError('source_changed')
            from .general_responses import check_pins
            from .adaptive import enabled,decision,stage_metadata
            config=check_pins(c,current[1])
            if enabled(config):
                message=next(m for m in self._conversation_messages(c,current[1].workspace_id,current[2].id)
                             if m.run_id==current[1].id and m.author_kind=='human')
                staged.update(stage_metadata(c,ledger,phase,decision(c,ledger,phase),operation,staged,config['responses']['max_steps'],message))
            prior=ledger._events(c,phase).get('tool_result')
            if prior:
                if prior!=staged: raise DomainError('command_conflict')
            else:
                ledger.event(c,phase,'tool_result',staged)
        with self.db.transaction() as c:
            resolve_selection(self,c,cap,receipt,phase)
            if ledger._events(c,phase).get('tool_result')!=staged: raise DomainError('action_unresolved')
        return staged

    def complete_general_product(self,cap,receipt,phase='selection'):
        """Atomic explanation/products/proposal, strictly from retained receipts."""
        from .general_responses import resolve_selection
        from .general_schema import GeneralExplanation
        from .responses_ledger import Ledger
        from .service import digest
        from .outcomes import acknowledge
        ledger=Ledger(self,receipt)
        results=[]
        with self.db.transaction() as c:
            p,run,cv,operation,base,binding,origin=resolve_selection(self,c,cap,receipt,phase)
            staged=ledger._events(c,phase).get('tool_result')
            final=ledger._events(c,'final').get('result',{})
            if not staged or staged['binding']!=binding or final.get('state')!='completed':
                raise DomainError('action_unresolved')
            text=GeneralExplanation.model_validate(final['value'],strict=True).text
            adaptive_outcome=staged.get('terminal_outcome')
            if adaptive_outcome and adaptive_outcome=='continue': raise DomainError('action_unresolved')
            if adaptive_outcome and adaptive_outcome!='completed':
                # Trusted status, not unchecked final provider success prose.
                # Full model explanation remains immutable in its receipt.
                text=staged['reason']
            unresolved=None
            if adaptive_outcome=='needs_validation':
                from .adaptive import unresolved_summary
                unresolved=unresolved_summary(staged['reason'])
                # Ordinary conversation, not only technical details, must expose
                # the trusted limitation. Keep provider prose in its receipt.
                text=staged['reason']
            if staged['status']=='observed' and adaptive_outcome in (None,'completed','needs_validation'):
                body=(TableBody if isinstance(operation,ReconcileCSV) else ToolBody).model_validate(staged['body'])
                file=FileBody.model_validate(staged['file'])
                output=(CSVObservation if isinstance(operation,ReconcileCSV) else WasmObservation).model_validate(staged['output'])
                results=self._publish_product(c,p,run,cv,operation,base,body,file,output,text,origin,binding,unresolved=unresolved)
            else:
                messages=self._conversation_messages(c,run.workspace_id,cv.id)
                self._append_message(c,run.workspace_id,ConversationMessage(id=new_id(),conversation_id=cv.id,run_id=run.id,
                    sequence=len(messages)+1,author_id='general-worker',author_kind='assistant',text=text,
                    evidence_origin=origin,model_receipt=receipt.attempt_id,result=TurnResult(results=[TextResult(text=text)])))
                run.state='partial' if staged['status']=='rejected' or adaptive_outcome not in (None,'completed') else 'ready'
                run.used_units+=1; run.lease_expires_at=None
                if run.state=='partial':
                    from .adaptive import unresolved_summary
                    run.unresolved=[unresolved_summary(staged.get('reason') or adaptive_outcome or 'Local verification failed.') ]
                acknowledge(c,run.workspace_id,run.id)
                self._event(c,p,run.workspace_id,'complete_run',run.id)
            # Two immutable phase receipts are the model evidence. No domain Body is
            # synthesized into the historical intake ProviderResult family.
            bound,attempt,_=self._receipt_binding(c,receipt)
            attempt.state='reconciled'
            self._store_attempt(c,attempt)
            run.execution.provider_observation='received'; run.execution.evidence_origin=origin
            run.provider_session_id=final['response_id']; run.provider_turn_id=final['response_id']
            self._store_run(c,run)
        detail=self.get_conversation(p,run.workspace_id,cv.id)
        message=next((m for m in detail.messages if m.run_id==run.id and m.author_kind=='assistant'),None)
        if not message or message.text!=text or message.model_receipt!=receipt.attempt_id:
            raise DomainError('action_unresolved')
        for item in results:
            observed=self.get_product_observation(p,run.workspace_id,item.observation_id)
            if observed.observation.model_selection.model_dump()!=binding:
                raise DomainError('action_unresolved')
        return self.get_run(p,run.workspace_id,run.id)

    def stop_general_budget(self,cap,receipt):
        """Durable no-provider terminal path; not a synthesized model message.

        Current authority is still required. Existing request bytes, events and
        local output are untouched. Unknown sends stay unresolved for admission;
        write-only late receipt retention remains possible after this stop.
        """
        from .responses_ledger import Ledger, observations
        from .general_responses import check_pins
        from .outcomes import acknowledge
        from .adaptive import enabled, BUDGET_STOP_REASON
        ledger=Ledger(self,receipt)
        with self.db.transaction() as c:
            p,run,cv=self._check_capability(c,cap)
            bound,attempt,origin=ledger._auth(c,cap)
            if bound.id!=run.id or not enabled(check_pins(c,run)):
                raise DomainError('unsupported_operation')
            # Includes current human target, scope and original context pins.
            self._general_context(c,cap)
            steps=observations(c,attempt.id)
            received=any(x.state in ('received','invalid') for x in steps)
            # Budget exhaustion is not evidence of an unsent/abandoned attempt.
            # Preserve its state and every receipt, including known completed
            # phases; only exact final publication may reconcile the attempt.
            # This also keeps count-only ambiguity from opening a replacement.
            run.state='partial'; run.stop_reason='budget_limit'
            run.unresolved=[BUDGET_STOP_REASON]
            run.used_units+=1; run.lease_expires_at=None
            if received:
                run.execution.provider_observation='received'
                run.execution.evidence_origin=origin
            self._store_run(c,run)
            self._event(c,p,run.workspace_id,'general_budget_stop',run.id)
            acknowledge(c,run.workspace_id,run.id)
        observed=self.get_run(p,run.workspace_id,run.id)
        if observed.state!='partial' or observed.stop_reason!='budget_limit':
            raise DomainError('action_unresolved')
        return observed

    def fail_local_turn(self,cap,reason):
        from .outcomes import acknowledge
        with self.db.transaction() as c:
            p,run,cv=self._check_capability(c,cap)
            run.state='partial'; run.unresolved=['Local capability rejected: '+reason[:400]]
            run.used_units+=1; run.lease_expires_at=None
            self._store_run(c,run); self._event(c,p,run.workspace_id,'local_operation_rejected',run.id)
            acknowledge(c,run.workspace_id,run.id)
            return run

    def get_product_observation(self,p,ws,oid):
        with self.db.transaction() as c:
            generation=self._scope(c,p,ws)
            row=c.execute('SELECT data FROM product_observations WHERE workspace_id=%s AND id=%s',(ws,oid)).fetchone()
            if not row:
                deny()
            observation=ProductObservation.model_validate(row['data'])
            artifact,owner=self._artifact(c,p,ws,observation.artifact_id)
            current=self._revision(c,p,ws,artifact,owner)
            state='historical'
            if observation.revision_id==current.id and observation.body_hash==current.body_hash:
                state='current_revision'
            elif observation.proposal_id:
                proposal,_,_=self._proposal(c,p,ws,observation.proposal_id)
                if (proposal.status=='pending' and proposal.base_revision_id==current.id and proposal.body_hash==observation.body_hash):
                    state='pending_proposal'
                elif (proposal.status=='accepted' and proposal.accepted_revision_id==current.id and current.body_hash==observation.body_hash):
                    state='current_revision'
            # Current scope includes source freshness, not just membership generation.
            scope_current=generation==observation.access_generation
            try:
                self._conversation(c,p,ws,observation.conversation_id,True)
                run_context=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,observation.run_id)).fetchone()
                from .service import digest
                for source in run_context['data']['source_manifest']:
                    source_row=c.execute('SELECT content FROM sources WHERE workspace_id=%s AND id=%s',(ws,source['id'])).fetchone()
                    scope_current=scope_current and digest(source_row['content'])==source['sha256']
            except DomainError:
                scope_current=False
            return ObservationReadback(observation=observation,binding_state=state,current_scope=scope_current)

    def download_product(self,p,ws,aid,revision_id=None):
        artifact=self.get_artifact(p,ws,aid,revision_id)
        body=(artifact.requested_revision or artifact.current_revision).body
        if isinstance(body,FileBody):
            return body
        if isinstance(body,ToolBody):
            return FileBody(title=body.title,filename=f'tool-{body.entrypoint}.wat',mime_type='application/wasm-text',content=body.code,content_sha256=byte_hash(body.code))
        if isinstance(body,TableBody):
            # Export SAVED cells, not a hidden recalculation or an execution claim.
            import csv, io
            buffer=io.StringIO(newline=''); writer=csv.DictWriter(buffer,fieldnames=body.columns,lineterminator='\n')
            # Reject human-edited formula injection; generated differences may be negative decimal values.
            import re
            for row in body.rows:
                for cell in row.values():
                    if cell.lstrip().startswith(('=','+','-','@')) and not re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?',cell):
                        raise DomainError('unsupported_operation')
            writer.writeheader(); writer.writerows(body.rows)
            text=buffer.getvalue()
            return FileBody(title=body.title,filename='reconciled.csv',mime_type='text/csv',content=text,content_sha256=byte_hash(text))
        raise DomainError('unsupported_operation')
