"""One bounded successor of settled work, admitted through canonical gates."""
from .errors import DomainError, deny
from .models import Run, PostMessage, new_id


def progress_keys(observations):
    """Compare retained work/evidence, excluding request IDs and provider prose."""
    from .service import digest
    result=set()
    for item in observations:
        if item.get('status')=='observed':
            result.add(digest({'body':item.get('body'),'output':item.get('output')}))
        elif item.get('capability_result'):
            cap=item['capability_result']; kind=cap.get('capability')
            if kind in ('read_result','read_attachment'):
                page=cap.get('result',{})
                if (page.get('status')=='available' and page.get('next_offset',0)>page.get('offset',0)
                        and page.get('body_sha256')!=item.get('decision',{}).get('operation_hash')):
                    result.add(digest({k:page[k] for k in ('body_sha256','offset','next_offset')}))
                continue
            # Discovery/guidance and rereading our own bookkeeping do not prove
            # progress across indefinitely repeated bounded executions.
            if kind not in ('discover_capabilities','load_skill','discover_saved_work','read_result','read_context'):
                result.add(digest(cap))
    return result


def has_new_progress(c,ws,rid,config):
    predecessor=config.get('continuation',{}).get('predecessor_run_id')
    if not predecessor: return True  # Allow the first slice to gather guidance.
    def observations(run_id):
        return [r['data'] for r in c.execute("SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id "
            "WHERE a.workspace_id=%s AND a.run_id=%s AND e.kind='tool_result'",(ws,run_id)).fetchall()]
    return bool(progress_keys(observations(rid))-progress_keys(observations(predecessor)))


def scope_fingerprint(service,c,p,ws,cv,config,*,versions=True):
    from .service import digest
    sources=[{'id':ref.source_id,'data':service._source(c,p,ws,ref,versions)['data']} for ref in cv.selected_source_refs]
    artifacts=c.execute('''SELECT a.id,a.current_revision_id FROM artifacts a WHERE a.workspace_id=%s AND a.conversation_id=%s
        AND NOT EXISTS (SELECT 1 FROM workspace_files f WHERE f.workspace_id=a.workspace_id
            AND f.artifact_id=a.id AND f.owner_id<>%s) ORDER BY a.id''',
        (ws,cv.id,p.id)).fetchall()
    binding=config.get('responsibility')
    if binding:
        allowed={d['object_id'] for d in binding['observations'] if d['kind']=='artifact_revision'}
        artifacts=[a for a in artifacts if a['id'] in allowed]
    return digest({'sources':sources,'artifacts':artifacts,'responsibility':binding})


def latest_human_intent(c,ws,cid):
    row=c.execute("SELECT m.id FROM conversation_messages m JOIN run_configurations rc "
        "ON rc.workspace_id=m.workspace_id AND rc.run_id=m.run_id WHERE m.workspace_id=%s "
        "AND m.conversation_id=%s AND m.author_kind='human' AND NOT rc.data ? 'continuation' "
        "ORDER BY m.sequence DESC LIMIT 1",(ws,cid)).fetchone()
    return row['id'] if row else None


class RunSuccessors:
    def list_run_checkpoints(self,p,ws,cid):
        from .checkpoint_models import RunCheckpointPage
        from .run_checkpoints import read_row
        with self.db.transaction() as c:
            generation=self._scope(c,p,ws)
            self._owned_conversation(c,p,ws,cid)
            rows=c.execute("SELECT * FROM run_checkpoints WHERE workspace_id=%s AND conversation_id=%s "
                "AND data->>'principal_id'=%s AND (data->>'access_generation')::bigint=%s "
                "ORDER BY created_at DESC,checkpoint_id DESC LIMIT 100",(ws,cid,p.id,generation)).fetchall()
            from .retained_results import enabled
            items=[]
            for row in rows:
                checkpoint=read_row(row)
                config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                    (ws,checkpoint.run_id)).fetchone()
                checkpoint.continuation_supported=bool(config and enabled(config['data']))
                items.append(checkpoint)
            return RunCheckpointPage(items=items)

    def continue_conversation(self,p,ws,cid,cmd):
        def mutate(c,cv):
            self._conversation_cas(cv,cmd.expected_work_version)
            return self._admit_run_successor(c,p,ws,cv,cmd.checkpoint_id,cmd.checkpoint_hash)
        return self._command(p,ws,'continue_conversation',{'conversation_id':cid},cmd,Run,
            lambda c:self._owned_conversation(c,p,ws,cid),mutate)

    def _admit_run_successor(self,c,p,ws,cv,checkpoint_id,checkpoint_hash,grant_id=None):
        from .run_checkpoints import read_row
        from .service import digest, encoded, Principal
        from .general_responses import check_pins, has_unresolved_attempt, admission, consumer_hash
        from .responsibility_execution import check_admission_budget
        from .responsibility_models import ResponsibilityRunBinding
        from .retained_results import enabled
        row=c.execute('SELECT * FROM run_checkpoints WHERE workspace_id=%s AND conversation_id=%s AND checkpoint_id=%s',
            (ws,cv.id,checkpoint_id)).fetchone()
        if not row: deny()
        cp=read_row(row)
        if cp.checkpoint_hash!=checkpoint_hash: raise DomainError('command_conflict')
        if cp.data.principal_id!=p.id: deny()
        generation=self._scope(c,p,ws,write=True)
        previous=c.execute('SELECT successor_run_id FROM run_successors WHERE workspace_id=%s AND predecessor_run_id=%s',
            (ws,cp.run_id)).fetchone()
        if previous:
            link=c.execute('SELECT checkpoint_id FROM run_successors WHERE workspace_id=%s AND predecessor_run_id=%s',
                (ws,cp.run_id)).fetchone()
            if link['checkpoint_id']!=cp.checkpoint_id: raise DomainError('command_conflict')
            return Run.model_validate(c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',
                (ws,previous['successor_run_id'])).fetchone()['data'])
        run=Run.model_validate(c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',
            (ws,cp.run_id)).fetchone()['data'])
        if (run.state!='partial' or run.stop_reason!='step_limit' or cp.checkpoint_kind!='settlement'
                or cp.data.waiting!='none' or cp.data.next_safe_action!='continue_slice'):
            raise DomainError('action_unresolved')
        if (generation!=cp.data.access_generation or run.fence!=cp.data.run_fence
                or cv.state!='open' or cv.work_version!=cp.data.conversation_work_version):
            raise DomainError('source_changed')
        config=check_pins(c,run)
        if not enabled(config) or digest(config)!=cp.data.configuration_sha256 or cp.data.runtime_sha256!=consumer_hash():
            raise DomainError('unsupported_operation')
        if not has_new_progress(c,ws,run.id,config): raise DomainError('action_unresolved')
        if grant_id is not None and config['grant_id']!=grant_id: deny()
        if scope_fingerprint(self,c,p,ws,cv,config)!=cp.data.scope_fingerprint:
            raise DomainError('source_changed')
        if latest_human_intent(c,ws,cv.id)!=cp.data.latest_human_intent_id:
            raise DomainError('source_changed')
        if has_unresolved_attempt(c,ws,cv.id): raise DomainError('action_unresolved')
        if c.execute("SELECT 1 FROM runs WHERE workspace_id=%s AND conversation_id=%s AND data->>'state' IN ('queued','running')",
                (ws,cv.id)).fetchone(): raise DomainError('action_unresolved')
        messages=self._conversation_messages(c,ws,cv.id)
        original=next((m for m in messages if m.id==cp.data.intent_message_id),None)
        original_material=c.execute('SELECT data FROM conversation_messages WHERE workspace_id=%s AND conversation_id=%s AND id=%s',
            (ws,cv.id,cp.data.intent_message_id)).fetchone()
        if original is None or not original_material or digest(original_material['data'])!=cp.data.intent_sha256:
            raise DomainError('source_changed')
        binding=config.get('responsibility')
        life=None
        if binding:
            a,_=self._responsibility_assignment(c,p,ws,binding['assignment_id'])
            life=self._lifecycle(c,ws,a.id)
            fence=c.execute('SELECT responsibility_fence FROM assignments WHERE workspace_id=%s AND id=%s',
                (ws,a.id)).fetchone()['responsibility_fence']
            if (a.work_version!=cp.data.assignment_work_version or fence!=cp.data.assignment_fence
                    or life.state!='active' or life.blocker or life.wait or life.run_id!=run.id
                    or life.next_action.model_dump(mode='json')!=binding['next_action']
                    or life.current_outcome!=binding['current_outcome']):
                raise DomainError('source_changed')
        elif p.kind!='human': deny()
        cmd=PostMessage(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),
            expected_work_version=cv.work_version,text=original.text,target=original.target,
            attachments=[a.model_dump(exclude={'ref','sha256','byte_length'}) for a in original.attachments],
            acceptance_checks=original.acceptance_checks)
        g=admission(self,c,p,ws,cv,cmd,human_steering=False)
        if not g or g.id!=config['grant_id']: deny()
        from .models import now
        from .responses_recovery import effective_expiry
        expiry=effective_expiry(c,g)
        if expiry is not None and expiry<=now(): raise DomainError('action_unresolved')
        check_admission_budget(c,g)
        continuation={'predecessor_run_id':run.id,'checkpoint_id':cp.checkpoint_id,'checkpoint_hash':cp.checkpoint_hash,
                      'intent_message_id':original.id,'intent_sha256':cp.data.intent_sha256}
        admitted=self._admit_conversation_turn(c,Principal(p.id,'worker') if binding else p,ws,cv,cmd,
            responsibility=ResponsibilityRunBinding.model_validate(binding) if binding else None,
            required_grant_id=g.id,continuation=continuation,retained_message=original)
        c.execute('INSERT INTO run_successors(workspace_id,predecessor_run_id,successor_run_id,checkpoint_id) VALUES (%s,%s,%s,%s)',
            (ws,run.id,admitted.run.id,cp.checkpoint_id))
        if life:
            life.run_id=admitted.run.id; life.execution_status='queued'
            a.run_ids.append(admitted.run.id)
            self._store_assignment(c,a)
            c.execute('UPDATE assignments SET responsibility_lifecycle=%s WHERE workspace_id=%s AND id=%s',(encoded(life),ws,a.id))
        self._materialize_general_context(c,Principal(p.id,'worker'),admitted.run,cv)
        self._event(c,p,ws,'run_successor_admitted',admitted.run.id)
        return admitted.run

    def advance_run_successors(self,ws,grant_id,limit=50):
        from .service import Principal
        if type(limit) is not int or not 1<=limit<=100: deny()
        cursors=getattr(self,'_successor_scan_cursors',{})
        cursor=cursors.get((ws,grant_id),'')
        with self.db.transaction() as c:
            rows=c.execute("SELECT cp.* FROM run_checkpoints cp JOIN run_configurations rc ON rc.workspace_id=cp.workspace_id AND rc.run_id=cp.run_id "
                "JOIN assignments a ON a.workspace_id=cp.workspace_id AND a.id=cp.assignment_id "
                "WHERE cp.workspace_id=%s AND rc.data->>'grant_id'=%s AND cp.assignment_id IS NOT NULL "
                "AND cp.checkpoint_kind='settlement' AND cp.data->>'next_safe_action'='continue_slice' "
                "AND a.responsibility_lifecycle->>'state'='active' AND a.responsibility_lifecycle->>'run_id'=cp.run_id "
                "AND NOT EXISTS (SELECT 1 FROM run_successors s WHERE s.workspace_id=cp.workspace_id AND s.predecessor_run_id=cp.run_id) "
                "AND cp.checkpoint_id>%s ORDER BY cp.checkpoint_id LIMIT %s",(ws,grant_id,cursor,limit)).fetchall()
        cursors[(ws,grant_id)]=rows[-1]['checkpoint_id'] if len(rows)==limit else ''
        self._successor_scan_cursors=cursors
        for row in rows:
            try:
                with self.db.transaction() as c:
                    p=Principal(row['data']['principal_id'],'worker')
                    self._scope(c,p,ws,write=True)
                    cv=self._owned_conversation(c,p,ws,row['conversation_id'])
                    self._admit_run_successor(c,p,ws,cv,row['checkpoint_id'],row['checkpoint_hash'],grant_id)
            except DomainError as exc:
                # Park only our still-current plan. A newer human plan, revoked
                # membership or changed generation must never be overwritten.
                try:
                    with self.db.transaction() as c:
                        generation=self._scope(c,p,ws,write=True)
                        a,_=self._responsibility_assignment(c,p,ws,row['assignment_id'])
                        life=self._lifecycle(c,ws,a.id)
                        fence=c.execute('SELECT responsibility_fence FROM assignments WHERE workspace_id=%s AND id=%s',
                            (ws,a.id)).fetchone()['responsibility_fence']
                        if (generation!=row['data']['access_generation'] or a.work_version!=row['data']['assignment_work_version']
                                or fence!=row['data']['assignment_fence'] or life.run_id!=row['run_id'] or life.state!='active'): continue
                        from .service import encoded
                        from .responsibility_models import ResponsibilityNextAction, ResponsibilityWait
                        life.execution_status='blocked'; life.state='blocked'
                        life.current_outcome='Continuation not admitted: '+exc.code.value+'. Retained work and reservations are unchanged.'
                        life.next_action=ResponsibilityNextAction(kind='request_decision',description='Resolve the admission blocker before continuing the saved work.')
                        life.wait=ResponsibilityWait(kind='person',reason='The prior bounded execution settled; successor admission was denied.')
                        c.execute('UPDATE assignments SET responsibility_lifecycle=%s WHERE workspace_id=%s AND id=%s',(encoded(life),ws,a.id))
                        self._event(c,p,ws,'responsibility_successor_blocked',a.id)
                except DomainError:
                    continue
