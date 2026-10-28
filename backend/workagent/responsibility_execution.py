"""Canonical responsibility continuation, driven only by ResponsesDispatcher.

No provider, scheduler or second ledger. Immutable run configuration binds a wake;
mutable lifecycle is a projection. All normal general grant/pin/budget gates apply.
"""
import secrets

from .errors import DomainError, deny
from .models import Run, PostMessage, new_id


class ContinuationAdmissionPending(DomainError):
    """A conversation attempt must settle before this same wake can be admitted."""
    def __init__(self):
        super().__init__('action_unresolved')


class ContinuationContextTooLarge(DomainError):
    """The complete authorized worker context exceeds the execution bound."""
    def __init__(self):
        super().__init__('budget_exhausted')


def validate_binding(c, run, config):
    """Recheck current authority for every general pin/capability/phase check."""
    from .service import digest
    binding = config.get('responsibility')
    if binding is None:
        return
    from .responsibility_models import ResponsibilityRunBinding
    b = ResponsibilityRunBinding.model_validate(binding)
    row = c.execute('SELECT data,conversation_id,responsibility_lifecycle,responsibility_fence FROM assignments '
                    'WHERE workspace_id=%s AND id=%s', (run.workspace_id, b.assignment_id)).fetchone()
    cv = c.execute('SELECT data FROM conversations WHERE workspace_id=%s AND id=%s',
                   (run.workspace_id, run.conversation_id)).fetchone()
    if (not row or not cv or b.workspace_id != run.workspace_id or b.owner_id != run.principal_id
        or b.conversation_id != run.conversation_id or row['conversation_id'] != run.conversation_id
        or row['responsibility_fence'] != b.review_fence
        or row['data']['owner_id'] != b.owner_id or row['data']['work_version'] != b.work_version
        or cv['data']['work_version'] != b.conversation_work_version or cv['data']['state'] != 'open'):
        raise DomainError('source_changed')
    life = row['responsibility_lifecycle']
    if (not life or life['state'] in ('paused', 'cancelled', 'taken_over')
        or life['wake_id'] != b.wake_id or life.get('run_id') != run.id):
        raise DomainError('action_unresolved')
    if config['responses'].get('runtime_extension') != 'general-alpha-v1':
        deny()
    for dep in b.observations:
        if dep.kind == 'artifact_revision':
            actual = c.execute('SELECT a.current_revision_id,a.conversation_id,a.assignment_id,r.data '
                'FROM artifacts a JOIN revisions r ON r.workspace_id=a.workspace_id AND r.id=a.current_revision_id '
                'AND r.artifact_id=a.id WHERE a.workspace_id=%s AND a.id=%s',
                (run.workspace_id, dep.object_id)).fetchone()
            if (not actual or not (actual['conversation_id'] == b.conversation_id or actual['assignment_id'] == b.assignment_id)
                or actual['current_revision_id'] != dep.observed_version or actual['data']['body_hash'] != dep.content_hash):
                raise DomainError('source_changed')
        else:
            actual = c.execute('SELECT s.data,s.content,g.active FROM sources s JOIN source_access g '
                'ON g.workspace_id=s.workspace_id AND g.source_id=s.id AND g.principal_id=%s '
                'JOIN assignment_sources a ON a.workspace_id=s.workspace_id AND a.source_id=s.id AND a.assignment_id=%s '
                'WHERE s.workspace_id=%s AND s.id=%s',
                (b.owner_id, b.assignment_id, run.workspace_id, dep.object_id)).fetchone()
            if (not actual or not actual['active'] or not actual['data']['available']
                or actual['data']['external_version'] != dep.observed_version or digest(actual['content']) != dep.content_hash):
                raise DomainError('source_changed')


def check_admission_budget(c, grant):
    """Feasibility only; the shared journal still reserves every actual phase.

    Take the same aggregate lock as reservation. No optimistic run admission when
    even the first count/generation cannot fit; never spend or refund here.
    """
    from decimal import Decimal
    from .responses_ledger import summary, RESERVED_INPUT, RESERVED_OUTPUT, RESERVED_COST
    c.execute('SELECT pg_advisory_xact_lock(721004120)')
    shared = summary(c, grant.id, shared=True)
    b = grant.responses
    # Match reservation/SQL scope: only alpha counters and tokens are shared.
    # Every grant still includes project-wide committed cost and historical carry.
    used = shared if getattr(b, 'runtime_extension', None) == 'general-alpha-v1' else summary(c, grant.id)
    if (used['request_counts']['count_send'] >= b.count_limit
        or used['request_counts']['dispatch'] >= b.generation_limit
        or used['reserved_input_tokens'] + RESERVED_INPUT > b.input_limit
        or used['reserved_output_tokens'] + RESERVED_OUTPUT > b.output_limit
        or Decimal(shared['reserved_cost_usd']) + RESERVED_COST > Decimal(b.cost_limit_usd)):
        raise DomainError('budget_exhausted')


def durable_context(c,run,message,binding):
    """Bounded plan evidence independent of rolling chat; never new authority."""
    from .service import canonical
    row=c.execute('SELECT responsibility_recording FROM assignments WHERE workspace_id=%s AND id=%s',
        (run.workspace_id,binding['assignment_id'])).fetchone()
    recording=row['responsibility_recording'] if row else None
    request=None
    if recording:
        source=c.execute("SELECT data FROM conversation_messages WHERE workspace_id=%s AND conversation_id=%s "
            "AND id=%s AND author_kind='human'",(run.workspace_id,run.conversation_id,
            recording['request']['message_id'])).fetchone()
        if source:
            request={'message_id':source['data']['id'],'text':source['data']['text'],
                     'attachments':[{k:v for k,v in a.items() if k!='content'} for a in source['data']['attachments']]}
    rows=c.execute("SELECT m.data FROM conversation_messages m JOIN run_configurations rc "
        "ON rc.workspace_id=m.workspace_id AND rc.run_id=m.run_id "
        "WHERE m.workspace_id=%s AND m.conversation_id=%s AND m.author_kind='assistant' "
        "AND m.sequence<%s AND rc.data->'responsibility'->>'assignment_id'=%s "
        "ORDER BY m.sequence DESC LIMIT 5",(run.workspace_id,run.conversation_id,message.sequence,binding['assignment_id'])).fetchall()
    results=[]; used=0
    for row in rows[:4]:
        m=row['data']; refs=[x for x in (m.get('result') or {}).get('results',[]) if x.get('kind')!='text']
        item={'message_id':m['id'],'run_id':m['run_id'],'text':m['text'][:2000],
              'text_truncated':len(m['text'])>2000,'saved_references':refs}
        size=len(canonical(item).encode())
        if used+size>12000: break
        results.append(item); used+=size
    return {'recorded_human_request':request,'request_available':request is not None,
            'saved_dependencies':binding['observations'],'prior_results':list(reversed(results)),
            'prior_results_truncated':len(rows)>len(results),
            'notice':'Recorded request and own prior outcomes are context, not permission. Current human corrections take precedence. '
                     'Only exact dependency observations authorize background artifact access.'}


class ResponsibilityExecution:
    def _store_run(self, c, run):
        super()._store_run(c, run)
        self._responsibility_run_event(c, None, run.workspace_id, 'store_run', run.id)

    def continue_responsibility(self, cap, grant_id):
        """Trusted worker-only fenced review AND admission in one transaction.

        A replay uses the immutable wake binding, never a new run or human message.
        The exact grant is mandatory; no controlled execution fallback exists.
        """
        from .responsibilities import ResponsibilityReviewCapability
        from .responsibility_models import ResponsibilityRunBinding
        from .service import Principal, digest, encoded
        if not isinstance(cap, ResponsibilityReviewCapability):
            deny()
        p = Principal(cap.principal_id, 'worker')
        with self.db.transaction() as c:
            generation = self._scope(c, p, cap.workspace_id, write=True)
            a, cv = self._responsibility_assignment(c, p, cap.workspace_id, cap.assignment_id)
            life = self._lifecycle(c, cap.workspace_id, a.id)
            row = c.execute('SELECT responsibility_fence,responsibility_lease FROM assignments '
                'WHERE workspace_id=%s AND id=%s', (a.workspace_id, a.id)).fetchone()
            lease = row['responsibility_lease']
            if (not lease or p.id != a.owner_id or cap.fence != row['responsibility_fence']
                or cap.work_version != a.work_version or cap.access_generation != generation
                or lease['wake_id'] != cap.wake_id or life.wake_id != cap.wake_id
                or lease['work_version'] != cap.work_version or lease['access_generation'] != generation
                or not secrets.compare_digest(lease['secret_hash'], digest(cap.secret))):
                deny()
            previous = c.execute("SELECT r.data,rc.data AS config FROM runs r JOIN run_configurations rc "
                "ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id WHERE rc.workspace_id=%s "
                "AND rc.data->'responsibility'->>'wake_id'=%s", (a.workspace_id, cap.wake_id)).fetchone()
            if previous:
                run = Run.model_validate(previous['data'])
                if previous['config']['grant_id'] != grant_id:
                    deny()
                self._runtime_pins(c, run)
                return run
            if (life.state != 'active' or life.blocker or life.next_action.kind not in ('continue_work', 'review_dependency')
                or not c.execute('SELECT %s::timestamptz > now() AS live', (lease['expires_at'],)).fetchone()['live']):
                raise DomainError('action_unresolved')
            if self._refresh_responsibility(c, p, a, cv, life):
                raise DomainError('version_conflict', current_version=a.work_version)
            binding = ResponsibilityRunBinding(review_fence=cap.fence, workspace_id=a.workspace_id, assignment_id=a.id,
                conversation_id=cv.id, owner_id=a.owner_id, wake_id=cap.wake_id, work_version=a.work_version,
                conversation_work_version=cv.work_version, observations=life.observations,
                goal=a.goal, completion_criteria=a.completion_criteria,
                current_outcome=life.current_outcome, next_action=life.next_action)
            # This is runtime provenance, not an invented human instruction.
            cmd = PostMessage(schema_version='workagent/v1', request_id=new_id(), command_id=cap.wake_id,
                expected_work_version=cv.work_version,
                text='Responsibility continuation: review the bound saved plan and changed dependencies. '
                     'Prepared work is not goal completion; do not infer permissions or accept proposals.')
            queued = self._admit_conversation_turn(c, p, a.workspace_id, cv, cmd,
                responsibility=binding, required_grant_id=grant_id)
            life.run_id = queued.run.id
            life.execution_status = 'queued'
            life.wake_status = 'reviewed'
            a.run_ids.append(queued.run.id)
            a.unresolved = ['Responsibility continuation queued; outcome remains unverified.']
            self._store_assignment(c, a)
            # Keep the fenced review lease for an exact lost-admission-ACK replay.
            c.execute('UPDATE assignments SET responsibility_lifecycle=%s WHERE workspace_id=%s AND id=%s',
                      (encoded(life), a.workspace_id, a.id))
            # Materialize the identical authorized worker context before committing
            # any admission effects. Oversize rolls back run/request/lifecycle.
            self._materialize_general_context(c, p, queued.run, cv)
            c.execute("UPDATE outbox SET consumed_at=now() WHERE workspace_id=%s AND id=%s "
                "AND operation='responsibility_wake' AND object_id=%s AND consumed_at IS NULL",
                (a.workspace_id, cap.wake_id, a.id))
            self._event(c, p, a.workspace_id, 'responsibility_admitted', a.id)
            return queued.run

    def advance_responsibilities(self, ws, grant_id, limit=50):
        """Bounded catch-up/admission on the existing consumer tick, exact grant only."""
        from .service import Principal
        if type(limit) is not int or not 1 <= limit <= 100:
            deny()
        cursors=getattr(self,'_responsibility_scan_cursors',{})
        cursor=cursors.get((ws,grant_id))
        with self.db.transaction() as c:
            grant = c.execute('SELECT data,principal_id FROM provider_grants WHERE workspace_id=%s AND id=%s',
                              (ws, grant_id)).fetchone()
            if not grant or grant['data']['responses'].get('runtime_extension') != 'general-alpha-v1':
                return
            p = Principal(grant['principal_id'], 'worker')
            # This transaction only discovers candidates. Do not contend with
            # every reader when no responsibility can advance. Each reconcile,
            # claim and admission below rechecks write authority under its lock.
            self._scope(c, p, ws)
            from .general_responses import scope_predicate
            predicate=scope_predicate(c,'g','assignments.conversation_id')
            rows = c.execute("SELECT id FROM assignments WHERE workspace_id=%s AND data->>'owner_id'=%s "
                f"AND EXISTS(SELECT 1 FROM provider_grants g WHERE g.id=%s AND {predicate}) AND responsibility_lifecycle IS NOT NULL "
                "AND responsibility_lifecycle->>'state' NOT IN ('cancelled','taken_over') "
                "AND (%s::text IS NULL OR id>%s) ORDER BY id LIMIT %s",
                (ws, p.id, grant_id, cursor, cursor, limit)).fetchall()
        # Restart-safe fairness hint only; canonical authority remains entirely in PG.
        cursors[(ws,grant_id)]=rows[-1]['id'] if len(rows)==limit else None
        self._responsibility_scan_cursors=cursors
        for row in rows:
            cap = None
            try:
                detail = self.reconcile_responsibility(p, ws, row['id'])
                life = detail.lifecycle
                if (life.state != 'active' or life.blocker or life.execution_status in ('queued', 'running', 'settled')
                    or life.wake_status not in ('queued', 'reviewed')
                    or life.next_action.kind not in ('continue_work', 'review_dependency')):
                    continue
                cap = self.claim_responsibility_wake(p, ws, row['id'], detail.assignment.work_version)
                self.continue_responsibility(cap, grant_id)
            except DomainError as exc:
                # Persist a truthful stop, not a model run or a fresh wake per tick.
                # Claim contention has no cap and must not change another consumer.
                if cap is not None and exc.code.value not in ('version_conflict','source_changed'):
                    from .service import encoded
                    with self.db.transaction() as c:
                        self._scope(c,p,ws,write=True)
                        a,_=self._responsibility_assignment(c,p,ws,row['id'])
                        current=self._lifecycle(c,ws,a.id)
                        fence=c.execute('SELECT responsibility_fence FROM assignments WHERE workspace_id=%s AND id=%s',
                                        (ws,a.id)).fetchone()['responsibility_fence']
                        if (fence==cap.fence and a.work_version==cap.work_version and current.wake_id==cap.wake_id
                            and current.run_id is None and current.execution_status!='blocked'):
                            if isinstance(exc,ContinuationAdmissionPending):
                                # Release only our review lease, not the wake or the
                                # other attempt. A fresh claim rechecks all authority.
                                current.current_outcome=('Continuation pending: the existing conversation attempt must settle. '
                                    'Unknown outcomes require explicit resolution; no resend or new run was started.')
                                c.execute('UPDATE assignments SET responsibility_lifecycle=%s,responsibility_lease=NULL '
                                          'WHERE workspace_id=%s AND id=%s', (encoded(current),ws,a.id))
                                continue
                            current.execution_status='blocked'
                            current.state='blocked'
                            current.current_outcome='Continuation not admitted: '+exc.code.value+'. No provider work was started.'
                            if isinstance(exc,ContinuationContextTooLarge):
                                current.current_outcome=('Continuation not admitted: complete authorized dependency context exceeds the context byte bound '
                                    '(budget_exhausted). Correct the saved material or explicitly revise the plan; no dependencies were dropped '
                                    'and no provider work was started.')
                            c.execute('UPDATE assignments SET responsibility_lifecycle=%s WHERE workspace_id=%s AND id=%s',
                                      (encoded(current),ws,a.id))
                continue

    def _responsibility_run_event(self, c, p, ws, operation, rid):
        from .service import encoded
        from .responsibility_models import ResponsibilityWait, ResponsibilityNextAction
        row = c.execute("SELECT data->'responsibility' AS binding FROM run_configurations "
                        'WHERE workspace_id=%s AND run_id=%s', (ws, rid)).fetchone()
        if not row or not row['binding']:
            return
        aid = row['binding']['assignment_id']
        life = self._lifecycle(c, ws, aid)
        if life.run_id != rid or life.wake_id != row['binding']['wake_id']:
            return
        run = Run.model_validate(c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s', (ws, rid)).fetchone()['data'])
        status = {'queued': 'queued', 'running': 'running', 'ready': 'settled', 'partial': 'settled', 'cancelled': 'blocked'}[run.state]
        from .retained_results import enabled as retained_enabled
        from .run_successors import has_new_progress
        config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchone()['data']
        slice_end=(run.stop_reason=='step_limit' and retained_enabled(config) and life.state=='active'
            and not life.wait and not life.blocker and has_new_progress(c,ws,rid,config))
        if run.stop_reason in ('budget_limit','blocked','waiting_for_user','step_limit') and not slice_end:
            status = 'blocked'
        if life.execution_status == status:
            return
        life.execution_status = status
        if status in ('settled','blocked') and run.state != 'cancelled' and not slice_end:
            life.review_required = False
            life.outcome_status = 'needs_review'
            life.current_outcome = 'Continuation result retained; human review required. The goal is not verified complete.'
            if life.check_in_due:
                life.wait = None
                life.next_check_in_at = None
                life.check_in_due = False
            life.next_action = ResponsibilityNextAction(kind='await_event' if life.dependencies and status == 'settled' else 'request_decision',
                description='Await a material dependency change or a human decision on the retained result.')
            life.wait = ResponsibilityWait(kind='dependency_change' if life.dependencies and status == 'settled' else 'person',
                reason='No automatic acceptance or claim of goal completion.')
            self._responsibility_state(life)
        c.execute('UPDATE assignments SET responsibility_lifecycle=%s WHERE workspace_id=%s AND id=%s', (encoded(life), ws, aid))
        if run.state in ('ready','partial','cancelled'):
            from .run_checkpoints import record
            from .models import Conversation
            cv=Conversation.model_validate(c.execute('SELECT data FROM conversations WHERE workspace_id=%s AND id=%s',
                (ws,run.conversation_id)).fetchone()['data'])
            record(self,c,run,cv,'stop' if run.state=='cancelled' else 'final','responsibility')
