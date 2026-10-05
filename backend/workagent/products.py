"""Broker-checked local operations on the existing run/artifact authority.

No external effects. Pure computation may repeat after an uncommitted crash.
Only this seam creates observations, from local kernel returns, never caller bodies.
"""
import hashlib
from .models import *
from .product_models import ReconcileCSV, RunWasm, CSVObservation, WasmObservation
from .errors import DomainError, deny
from .local_operations import reconcile_csv, OperationRejected
from .wasm_tool import run_wasm_tool, ToolRejected


def byte_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def turn_state(run):
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
        notes=list(base.body.notes) if base else []
        try:
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
                body=ToolBody(title=base.body.title if base else 'Invoice total tool',code=code,
                    entrypoint=operation.entrypoint,arguments=operation.arguments,input_form=operation.input_form,notes=notes)
                observed=WasmObservation(**output)
                file=FileBody(title='Portable WebAssembly text',filename='invoice-tool.wat',mime_type='application/wasm-text',
                              content=code,content_sha256=byte_hash(code))
        except (OperationRejected,ToolRejected,ValueError) as exc:
            return self.fail_local_turn(cap,str(exc))
        with self.db.transaction() as c:
            p,run,cv,current,current_base=self._local_input(c,cap)
            if digest(current)!=operation_hash or (current_base.body_hash if current_base else None)!=base_hash:
                raise DomainError('source_changed')
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
                        reason='Controlled local recalculation/execution; exact saved human notes retained. Review before acceptance.')
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
                    body_hash=digest(material),operation_hash=operation_hash,access_generation=run.access_generation,output=observed)
                c.execute('INSERT INTO product_observations(workspace_id,id,run_id,artifact_id,data) VALUES (%s,%s,%s,%s,%s)',
                    (run.workspace_id,observation.id,run.id,aid,encoded(observation)))
                results.append(ProductResult(kind=material.kind,artifact_id=aid,revision_id=rid,proposal_id=pid,observation_id=observation.id))
            text=('Controlled CSV calculation observed: reported '+observed.reported_sum+'; calculated '+observed.expected_sum+'.' if isinstance(observed,CSVObservation)
                  else f'Controlled import-free Wasm execution observed return: {observed.value}.')
            if base:
                text+=' Change proposed, not accepted; saved human notes retained.'
            result=TurnResult(results=[TextResult(text=text),*results])
            messages=self._conversation_messages(c,run.workspace_id,cv.id)
            self._append_message(c,run.workspace_id,ConversationMessage(id=new_id(),conversation_id=cv.id,run_id=run.id,
                sequence=len(messages)+1,author_id='general-worker',author_kind='assistant',text=text,
                evidence_origin='controlled_transport',result=result))
            run.state='ready'; run.used_units+=1; run.lease_expires_at=None
            self._store_run(c,run); self._event(c,p,run.workspace_id,'complete_run',run.id)
            acknowledge(c,run.workspace_id,run.id)
        # Exact authorized durable readback, not just a write receipt.
        for item in results:
            readback=self.get_product_observation(p,run.workspace_id,item.observation_id)
            if readback.observation.body_hash!=digest(body if item.kind!='file' else file):
                raise DomainError('action_unresolved')
        return self.get_run(p,run.workspace_id,run.id)

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
            return FileBody(title=body.title,filename='invoice-tool.wat',mime_type='application/wasm-text',content=body.code,content_sha256=byte_hash(body.code))
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
