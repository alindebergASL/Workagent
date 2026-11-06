"""Exact stop and retained FIFO input on the ordinary command/admission path."""
from .checkpoint_models import QueuedMessage, QueuedMessagePage
from .errors import DomainError, deny
from .models import Run, new_id, now


def fingerprint(service,c,p,ws,cv,intent):
    from .general_responses import exact_target
    from .service import digest
    target=exact_target(service,c,p,ws,cv,intent.target)
    sources=[service._source(c,p,ws,ref,True)['content'] for ref in cv.selected_source_refs]
    return digest({'sources':sources,'target':target.body_hash if target else None})


class ConversationIntents:
    def _owned_conversation(self,c,p,ws,cid):
        # Reading/cancelling is authorized by current access, not execution freshness.
        # Admission/fingerprint checks enforce versions separately.
        cv=self._conversation(c,p,ws,cid)
        if cv.owner_id!=p.id: deny()
        return cv

    def stop_conversation_run(self,p,ws,cid,cmd):
        def mutate(c,cv):
            from .outcomes import acknowledge
            from .run_checkpoints import record
            self._conversation_cas(cv,cmd.expected_work_version)
            row=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND conversation_id=%s AND id=%s',
                (ws,cid,cmd.run_id)).fetchone()
            if not row: deny()
            run=Run.model_validate(row['data'])
            if run.principal_id!=p.id: deny()
            if run.state not in ('queued','running'): raise DomainError('action_unresolved')
            run.state='cancelled'; run.fence+=1; run.lease_expires_at=None
            # STOP is human steering, so queued intents cannot silently follow it.
            cv.work_version+=1
            self._store_conversation(c,cv)
            self._store_run(c,run)
            acknowledge(c,ws,run.id)
            record(self,c,run,cv,'stop','stop')
            self._event(c,p,ws,'stop_conversation_run',run.id)
            return run
        return self._command(p,ws,'stop_conversation_run',{'conversation_id':cid},cmd,Run,
            lambda c:self._owned_conversation(c,p,ws,cid),mutate)

    def queue_message(self,p,ws,cid,cmd):
        def mutate(c,cv):
            from .service import encoded
            self._conversation_cas(cv,cmd.expected_work_version)
            generation=self._scope(c,p,ws,write=True)
            count=c.execute("SELECT count(*) n FROM conversation_intents WHERE workspace_id=%s AND conversation_id=%s "
                "AND data->>'state' IN ('pending','held')",(ws,cid)).fetchone()['n']
            if count>=100: raise DomainError('budget_exhausted')
            position=c.execute('SELECT coalesce(max(position),0)+1 n FROM conversation_intents '
                'WHERE workspace_id=%s AND conversation_id=%s',(ws,cid)).fetchone()['n']
            queued=QueuedMessage(id=new_id(),conversation_id=cid,owner_id=p.id,position=position,created_at=now(),
                intent=cmd,admission_work_version=cv.work_version,access_generation=generation,
                dependency_fingerprint=fingerprint(self,c,p,ws,cv,cmd))
            c.execute('INSERT INTO conversation_intents(workspace_id,id,conversation_id,owner_id,command_id,position,data) '
                'VALUES (%s,%s,%s,%s,%s,%s,%s)',(ws,queued.id,cid,p.id,cmd.command_id,position,encoded(queued)))
            self._event(c,p,ws,'queue_message',cid)
            return queued
        return self._command(p,ws,'queue_message',{'conversation_id':cid},cmd,QueuedMessage,
            lambda c:self._owned_conversation(c,p,ws,cid),mutate)

    def list_queued_messages(self,p,ws,cid,after=0):
        if type(after) is not int or after<0: raise DomainError('validation_error')
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            self._owned_conversation(c,p,ws,cid)
            return QueuedMessagePage(items=[QueuedMessage.model_validate(r['data']) for r in c.execute(
                'SELECT data FROM conversation_intents WHERE workspace_id=%s AND conversation_id=%s '
                'AND owner_id=%s AND position>%s ORDER BY position LIMIT 100',(ws,cid,p.id,after)).fetchall()])

    def cancel_queued_message(self,p,ws,cid,qid,cmd):
        def authorize(c):
            self._owned_conversation(c,p,ws,cid)
            row=c.execute('SELECT data FROM conversation_intents WHERE workspace_id=%s AND conversation_id=%s '
                'AND id=%s AND owner_id=%s',(ws,cid,qid,p.id)).fetchone()
            if not row: deny()
            return QueuedMessage.model_validate(row['data'])
        def mutate(c,queued):
            if queued.queue_version!=cmd.expected_queue_version:
                raise DomainError('version_conflict',current_version=queued.queue_version)
            if queued.state not in ('pending','held'): raise DomainError('action_unresolved')
            queued.state='cancelled'; queued.queue_version+=1
            self._store_queued_message(c,ws,queued)
            self._event(c,p,ws,'cancel_queued_message',cid)
            return queued
        return self._command(p,ws,'cancel_queued_message',{'conversation_id':cid,'queued_message_id':qid},
            cmd,QueuedMessage,authorize,mutate)

    def _store_queued_message(self,c,ws,queued):
        from .service import encoded
        c.execute('UPDATE conversation_intents SET data=%s WHERE workspace_id=%s AND id=%s',
            (encoded(queued),ws,queued.id))

    def drain_queued_messages(self,ws,grant_id,limit=50):
        """One FIFO head per conversation per dispatcher tick; all checks under lock."""
        from .service import Principal
        from .general_responses import has_unresolved_attempt, admission
        from .responsibility_execution import check_admission_budget
        if type(limit) is not int or not 1<=limit<=100: deny()
        cursors=getattr(self,'_queue_scan_cursors',{})
        cursor=cursors.get((ws,grant_id),'')
        with self.db.transaction() as c:
            grant=c.execute('SELECT principal_id FROM provider_grants WHERE workspace_id=%s AND id=%s',
                (ws,grant_id)).fetchone()
            if not grant: return
            p=Principal(grant['principal_id'],'worker')
            self._scope(c,p,ws)
            rows=c.execute("SELECT DISTINCT conversation_id FROM conversation_intents WHERE workspace_id=%s "
                "AND owner_id=%s AND data->>'state'='pending' AND conversation_id>%s ORDER BY conversation_id LIMIT %s",
                (ws,p.id,cursor,limit)).fetchall()
        cursors[(ws,grant_id)]=rows[-1]['conversation_id'] if len(rows)==limit else ''
        self._queue_scan_cursors=cursors
        for item in rows:
            with self.db.transaction() as c:
                generation=self._scope(c,p,ws,write=True)
                cid=item['conversation_id']
                row=c.execute("SELECT data FROM conversation_intents WHERE workspace_id=%s AND conversation_id=%s "
                    "AND data->>'state' IN ('pending','held') ORDER BY position LIMIT 1",(ws,cid)).fetchone()
                if not row: continue
                q=QueuedMessage.model_validate(row['data'])
                if q.state!='pending': continue
                try:
                    # A revoked source must not abort the entire workspace scan.
                    # Keep source ACL checks; only retain a body-free hold state
                    # on this already owner-scoped queued intent.
                    with c.transaction():
                        cv=self._owned_conversation(c,p,ws,cid)
                except DomainError as exc:
                    if exc.code.value not in ('not_found_or_not_authorized','source_unavailable','source_changed'):
                        raise
                    q=QueuedMessage.model_validate({**q.model_dump(mode='json'),
                        'state':'held','reason':'scope_changed','queue_version':q.queue_version+1})
                    self._store_queued_message(c,ws,q)
                    self._event(c,p,ws,'queued_message_held',cid)
                    continue
                reason=None
                if cv.state!='open' or cv.work_version!=q.admission_work_version: reason='work_changed'
                elif generation!=q.access_generation: reason='scope_changed'
                elif not c.execute('SELECT active FROM provider_grants WHERE workspace_id=%s AND id=%s',
                    (ws,grant_id)).fetchone()['active']: reason='authority_unavailable'
                else:
                    from .responses_ledger import observations
                    attempts=c.execute('SELECT a.id FROM provider_attempts a JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id '
                        "WHERE r.workspace_id=%s AND r.conversation_id=%s AND a.data->>'state' NOT IN ('reconciled','failed')",(ws,cid)).fetchall()
                    if any(step.state in ('count_unknown','outcome_unknown') for attempt in attempts for step in observations(c,attempt['id'])):
                        reason='outcome_unknown'
                if reason is None and c.execute("SELECT 1 FROM runs WHERE workspace_id=%s AND conversation_id=%s "
                    "AND data->>'state' IN ('queued','running')",(ws,cid)).fetchone(): continue
                if reason is None and has_unresolved_attempt(c,ws,cid): reason='outcome_unknown'
                if reason is None and c.execute("SELECT 1 FROM assignments WHERE workspace_id=%s AND conversation_id=%s "
                    "AND responsibility_lifecycle->>'state' IN ('paused','taken_over','cancelled')",(ws,cid)).fetchone(): reason='paused'
                if reason is None:
                    try:
                        # Roll back admission effects before retaining a hold reason.
                        with c.transaction():
                            if fingerprint(self,c,p,ws,cv,q.intent)!=q.dependency_fingerprint:
                                raise DomainError('source_changed')
                            g=admission(self,c,p,ws,cv,q.intent,human_steering=False)
                            if g is None or g.id!=grant_id: raise DomainError('action_unresolved')
                            check_admission_budget(c,g)
                            admitted=self._admit_conversation_turn(c,p,ws,cv,q.intent,
                                queued_intent={'id':q.id,'command_id':q.intent.command_id})
                    except DomainError as exc:
                        reason='scope_changed' if exc.code.value in ('source_changed','version_conflict') else 'authority_unavailable'
                transition=({'state':'held','reason':reason} if reason else
                    {'state':'admitted','run_id':admitted.run.id})
                q=QueuedMessage.model_validate({**q.model_dump(mode='json'),**transition,'queue_version':q.queue_version+1})
                self._store_queued_message(c,ws,q)
                self._event(c,p,ws,'queued_message_'+q.state,cid)
