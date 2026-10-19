"""Ongoing responsibilities extend Assignments and the canonical event boundary.

Put Responsibilities first in Service's MRO. Only opted-in conversation assignments
participate. Local domain mutations reconcile exact affected dependencies atomically
with their canonical events. Catch-up uses current saved versions, not event prose.
No run admission, model client, external effects, or independent scheduler lives here.
"""
from dataclasses import dataclass
from datetime import timedelta
import secrets

from .errors import DomainError, deny
from .models import Assignment, Run, now, new_id
from .responsibility_models import (
    ResponsibilityPlan, ResponsibilityLifecycle, ResponsibilityDetail,
    DependencyObservation, ResponsibilityNextAction, ResponsibilityReviewReceipt,
    ControlResponsibility, ResponsibilityContinuationRequest,
)


@dataclass(frozen=True)
class ResponsibilityReviewCapability:
    workspace_id: str
    assignment_id: str
    principal_id: str
    work_version: int
    access_generation: int
    fence: int
    wake_id: str
    secret: str


from .responsibility_execution import ResponsibilityExecution


class Responsibilities(ResponsibilityExecution):
    def _responsibility_assignment(self, c, p, ws, aid):
        a = self._assignment(c, p, ws, aid)
        if not a.conversation_id:
            raise DomainError('unsupported_operation')
        cv = self._conversation(c, p, ws, a.conversation_id)
        # Same conversation and selected-source audience, not merely workspace access.
        if {r.source_id for r in a.selected_source_refs} != {r.source_id for r in cv.selected_source_refs}:
            deny()
        return a, cv

    def _lifecycle(self, c, ws, aid, required=True):
        row = c.execute('SELECT responsibility_lifecycle FROM assignments WHERE workspace_id=%s AND id=%s',
                        (ws, aid)).fetchone()
        value = row['responsibility_lifecycle'] if row else None
        if value is None:
            if required:
                raise DomainError('unsupported_operation')
            return None
        return ResponsibilityLifecycle.model_validate(value)

    def _responsibility_observations(self, c, p, a, dependencies, *, exact=False):
        from .service import digest
        observations = []
        for dep in dependencies:
            if dep.kind == 'source_version':
                ref = next((r for r in a.selected_source_refs if r.source_id == dep.object_id), None)
                if ref is None:
                    deny()
                row = self._source(c, p, a.workspace_id, ref)
                version = row['data']['external_version']
                content_hash = digest(row['content'])
            else:
                # Check ownership boundary BEFORE materializing any artifact/revision.
                row = c.execute('SELECT conversation_id,assignment_id,current_revision_id FROM artifacts '
                                'WHERE workspace_id=%s AND id=%s', (a.workspace_id, dep.object_id)).fetchone()
                if not row or not (row['conversation_id'] == a.conversation_id or row['assignment_id'] == a.id):
                    deny()
                artifact, scope = self._artifact(c, p, a.workspace_id, dep.object_id)
                revision = self._revision(c, p, a.workspace_id, artifact, scope)
                content_hash = revision.body_hash
                version = artifact['current_revision_id']
            if exact and dep.expected_version != version:
                raise DomainError('version_conflict', current_version=a.work_version)
            observations.append(DependencyObservation(**dep.model_dump(), observed_version=version,
                                                      content_hash=content_hash, changed=version != dep.expected_version))
        return observations

    @staticmethod
    def _responsibility_cas(a, expected):
        if a.work_version != expected:
            raise DomainError('version_conflict', current_version=a.work_version)

    @staticmethod
    def _responsibility_state(life):
        if life.state in ('paused', 'cancelled', 'taken_over'):
            return
        if life.blocker:
            life.state = 'blocked'
        elif life.wait is not None and life.wait.kind == 'person':
            # Changed context can require human review, but cannot supply the
            # decision this responsibility explicitly waits for.
            life.state = 'waiting_person'
        elif life.review_required or life.check_in_due or life.wait is None:
            life.state = 'active'
        else:
            life.state = 'waiting_person' if life.wait.kind == 'person' else 'waiting_event'

    @staticmethod
    def _responsibility_detail(a, life):
        return ResponsibilityDetail(assignment=a, lifecycle=life,
            provider_execution_queued=life.execution_status == 'queued',
            local_review_eligible=life.wake_status in ('queued', 'reviewed') and life.execution_status not in ('queued','running','settled') and (
                life.state == 'active' or (life.state == 'blocked' and life.review_required
                                          and life.blocker in ('grant_required', 'tool_required'))))

    def _responsibility_grant_blocker(self, c, p, a, life):
        """Narrow grant existence check, NOT admission or access to grant secrets.

        Parent worker still uses canonical admission/pins/budgets/tool checks.
        Uninstalled, revoked, exhausted run-count scopes block continuation;
        provider-free local review of why it is blocked can still be queued.
        """
        if life.next_action.kind not in ('continue_work', 'review_dependency'):
            return
        if life.blocker in ('tool_required', 'authority_unavailable', 'conversation_closed'):
            return
        from .general_responses import scope_predicate
        predicate=scope_predicate(c,'g','%s')
        rows = c.execute("SELECT g.id FROM provider_grants g WHERE g.workspace_id=%s "
            "AND g.principal_id=%s AND g.active AND g.data->>'profile'='general-responses-v1' "
            f"AND {predicate} "
            "AND (SELECT count(*) FROM run_configurations rc WHERE rc.workspace_id=g.workspace_id "
            "AND rc.data->>'grant_id'=g.id) < (g.data->>'max_runs')::integer"
            if life.execution_status not in ('queued', 'running') else
            "SELECT g.id FROM provider_grants g WHERE g.workspace_id=%s AND g.principal_id=%s "
            "AND g.active AND g.data->>'profile'='general-responses-v1' "
            f"AND {predicate}",
            (a.workspace_id, p.id, a.conversation_id)).fetchall()
        if len(rows) != 1:
            life.blocker = 'grant_required'
        elif life.blocker == 'grant_required':
            life.blocker = None  # Still not admitted: only the full parent gate can admit.

    def _responsibility_review_receipt(self, a, life, wake_id):
        continuation = None
        if life.next_action.kind in ('continue_work', 'review_dependency'):
            continuation = ResponsibilityContinuationRequest(assignment_id=a.id,
                workspace_id=a.workspace_id, conversation_id=a.conversation_id, owner_id=a.owner_id,
                wake_id=wake_id, expected_work_version=a.work_version,
                expected_conversation_work_version=life.conversation_work_version,
                goal=a.goal, completion_criteria=a.completion_criteria,
                current_outcome=life.current_outcome, next_action=life.next_action,
                observations=life.observations,run_id=life.run_id,execution_admitted=life.run_id is not None)
        return ResponsibilityReviewReceipt(responsibility=self._responsibility_detail(a, life),
            reviewed_wake_id=wake_id, continuation=continuation,
            provider_execution_started=life.execution_status in ('running','settled'))

    def _persist_responsibility(self, c, a, life):
        from .service import encoded
        self._store_assignment(c, a)
        c.execute('UPDATE assignments SET responsibility_lifecycle=%s, responsibility_lease=NULL '
                  'WHERE workspace_id=%s AND id=%s', (encoded(life), a.workspace_id, a.id))

    def _retire_responsibility_wake(self, c, ws, life):
        if life.wake_id:
            # Never ACK another consumer's source event or run-dispatch wake.
            c.execute("UPDATE outbox SET consumed_at=now() WHERE workspace_id=%s AND id=%s "
                      "AND operation='responsibility_wake' AND consumed_at IS NULL", (ws, life.wake_id))
        life.wake_id = None
        life.wake_status = 'none'

    def _queue_responsibility_wake(self, c, p, a, life):
        self._retire_responsibility_wake(c, a.workspace_id, life)
        if life.wait is not None and life.wait.kind == 'person':
            return
        if not (life.state == 'active' or (life.state == 'blocked' and life.review_required
                and life.blocker in ('grant_required', 'tool_required'))):
            return
        # Canonical audit/outbox; intentionally no run_dispatches entry or run.
        super()._event(c, p, a.workspace_id, 'responsibility_wake', a.id)
        event = c.execute("SELECT o.id FROM outbox o WHERE o.workspace_id=%s AND o.object_id=%s "
                          "AND o.operation='responsibility_wake' AND o.consumed_at IS NULL",
                          (a.workspace_id, a.id)).fetchall()
        if len(event) != 1:
            raise RuntimeError('responsibility wake must have exactly one current identity')
        life.wake_id = event[0]['id']
        life.wake_status = 'queued'

    def _stop_responsibility_runs(self, c, a):
        from .outcomes import acknowledge
        # Never cancel unrelated conversation turns; these have no responsibility binding.
        for row in c.execute("SELECT r.data FROM runs r JOIN run_configurations rc ON rc.workspace_id=r.workspace_id "
                             "AND rc.run_id=r.id WHERE r.workspace_id=%s AND (r.assignment_id=%s OR rc.data->'responsibility'->>'assignment_id'=%s)",
                             (a.workspace_id, a.id, a.id)).fetchall():
            run = Run.model_validate(row['data'])
            if run.state in ('queued', 'running'):
                run.state = 'cancelled'
                run.fence += 1
                run.lease_expires_at = None
                self._store_run(c, run)
                acknowledge(c, a.workspace_id, run.id)

    def _new_responsibility_plan(self, c, p, a, cv, cmd):
        plan = ResponsibilityPlan.model_validate(cmd.model_dump(include=set(ResponsibilityPlan.model_fields)))
        observations = self._responsibility_observations(c, p, a, plan.dependencies, exact=True)
        life = ResponsibilityLifecycle(**plan.model_dump(), observations=observations,
                                       conversation_work_version=cv.work_version)
        life.blocker = {'obtain_grant': 'grant_required', 'obtain_tool': 'tool_required'}.get(plan.next_action.kind)
        self._responsibility_grant_blocker(c, p, a, life)
        life.check_in_due = bool(life.next_check_in_at and life.next_check_in_at <= now())
        self._responsibility_state(life)
        return life

    def activate_responsibility(self, p, ws, assignment_id, cmd):
        def authorize(c):
            a, cv = self._responsibility_assignment(c, p, ws, assignment_id)
            if a.owner_id != p.id:
                deny()
            self._responsibility_observations(c, p, a, cmd.dependencies)
            return a, cv

        def mutate(c, scope):
            a, cv = scope
            return self._activate_responsibility(c,p,a,cv,cmd,cmd.expected_work_version)
        return self._command(p, ws, 'activate_responsibility', {'assignment_id': assignment_id}, cmd,
                             ResponsibilityDetail, authorize, mutate)

    def _activate_responsibility(self,c,p,a,cv,plan,expected_work_version):
        """Transaction-local activation shared with receipt-bound recording."""
        self._responsibility_cas(a,expected_work_version)
        if (a.owner_id != p.id or self._lifecycle(c,a.workspace_id,a.id,False) is not None
                or cv.state != 'open' or a.state == 'cancelled' or a.run_ids):
            raise DomainError('unsupported_operation')
        life=self._new_responsibility_plan(c,p,a,cv,plan)
        a.work_version+=1
        a.state='paused'
        a.unresolved=['Ongoing responsibility recorded; execution is not admitted.']
        self._queue_responsibility_wake(c,p,a,life)
        self._persist_responsibility(c,a,life)
        super(Responsibilities,self)._event(c,p,a.workspace_id,'activate_responsibility',a.id)
        return self._responsibility_detail(a,life)

    def update_responsibility(self, p, ws, assignment_id, cmd):
        def authorize(c):
            a, cv = self._responsibility_assignment(c, p, ws, assignment_id)
            if a.owner_id != p.id:
                deny()
            old = self._lifecycle(c, ws, a.id)
            self._responsibility_observations(c, p, a, old.dependencies)
            self._responsibility_observations(c, p, a, cmd.dependencies)
            return a, cv, old

        def mutate(c, scope):
            a, cv, old = scope
            self._responsibility_cas(a, cmd.expected_work_version)
            if old.state in ('cancelled', 'taken_over') or cv.state != 'open':
                raise DomainError('unsupported_operation')
            life = self._new_responsibility_plan(c, p, a, cv, cmd)
            if old.state == 'paused':
                life.state = 'paused'
            plan_fields = set(ResponsibilityPlan.model_fields)
            if (old.model_dump(include=plan_fields) == life.model_dump(include=plan_fields)
                    and old.observations == life.observations and not old.review_required
                    and old.conversation_work_version == cv.work_version
                    and old.check_in_due == life.check_in_due and old.blocker == life.blocker):
                return self._responsibility_detail(a, old)
            self._retire_responsibility_wake(c, ws, old)
            self._stop_responsibility_runs(c, a)
            a.work_version += 1
            self._queue_responsibility_wake(c, p, a, life)
            self._persist_responsibility(c, a, life)
            super(Responsibilities, self)._event(c, p, ws, 'update_responsibility', a.id)
            return self._responsibility_detail(a, life)
        return self._command(p, ws, 'update_responsibility', {'assignment_id': assignment_id}, cmd,
                             ResponsibilityDetail, authorize, mutate)

    def control_responsibility(self, p, ws, assignment_id, cmd):
        return self._control_responsibility(p, ws, assignment_id, cmd)

    def _control_responsibility(self, p, ws, assignment_id, cmd, *, legacy=False):
        # Share mutation, not command identity: each public route keeps its own
        # durable operation, original command payload and receipt model.
        operation = 'control_assignment' if legacy else 'control_responsibility'
        def authorize(c):
            a, cv = self._responsibility_assignment(c, p, ws, assignment_id)
            if a.owner_id != p.id:
                deny()
            life = self._lifecycle(c, ws, a.id)
            self._responsibility_observations(c, p, a, life.dependencies)
            return a, cv, life

        def mutate(c, scope):
            a, cv, life = scope
            self._responsibility_cas(a, cmd.expected_work_version)
            if life.state in ('cancelled', 'taken_over'):
                raise DomainError('unsupported_operation')
            if cmd.operation == 'resume':
                if life.state != 'paused' or cv.state != 'open':
                    raise DomainError('unsupported_operation')
                life.state = 'active'
                # Resume is a new human-controlled wake, never a replay of the
                # cancelled run. Admission still checks every unresolved send.
                life.run_id = None
                life.execution_status = 'not_admitted'
                self._refresh_responsibility(c, p, a, cv, life)
                self._responsibility_state(life)
            else:
                life.state = {'pause': 'paused', 'cancel': 'cancelled', 'takeover': 'taken_over'}[cmd.operation]
            self._stop_responsibility_runs(c, a)
            if life.execution_status in ('queued', 'running'):
                life.execution_status = 'blocked'
            a.state = 'cancelled' if life.state == 'cancelled' else 'paused'
            a.work_version += 1
            self._queue_responsibility_wake(c, p, a, life)
            self._persist_responsibility(c, a, life)
            super(Responsibilities, self)._event(c, p, ws, operation, a.id)
            return a if legacy else self._responsibility_detail(a, life)
        return self._command(p, ws, operation, {'assignment_id': assignment_id}, cmd,
                             Assignment if legacy else ResponsibilityDetail, authorize, mutate)

    def control_assignment(self, p, ws, assignment_id, cmd):
        # Preserve legacy command semantics, including unsupported B1 resume, unless
        # this exact assignment has explicitly opted into ongoing ownership.
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            self._assignment(c, p, ws, assignment_id)
            life = self._lifecycle(c, ws, assignment_id, False)
        if life is None:
            return super().control_assignment(p, ws, assignment_id, cmd)
        return self._control_responsibility(p, ws, assignment_id, cmd, legacy=True)

    def get_responsibility(self, p, ws, assignment_id):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            a, _ = self._responsibility_assignment(c, p, ws, assignment_id)
            life = self._lifecycle(c, ws, a.id)
            self._responsibility_observations(c, p, a, life.dependencies)
            return self._responsibility_detail(a, life)

    def _refresh_responsibility(self, c, p, a, cv, life):
        from .service import digest
        observations = self._responsibility_observations(c, p, a, life.dependencies)
        due = bool(life.next_check_in_at and life.next_check_in_at <= now())
        old_blocker = life.blocker
        self._responsibility_grant_blocker(c, p, a, life)
        context_changed = observations != life.observations
        due_changed = due != life.check_in_due
        blocker_changed = old_blocker != life.blocker
        changed = (context_changed or cv.work_version != life.conversation_work_version
                   or due_changed or blocker_changed)
        if not changed:
            return False
        key = digest({'observations': [o.model_dump() for o in observations],
                      'conversation_version': cv.work_version, 'check_in_due': due,
                      'blocker': life.blocker})
        if key == life.last_change_key:
            return False
        life.last_change_key = key
        life.execution_status = 'not_admitted'
        life.run_id = None
        life.observations = observations
        life.conversation_work_version = cv.work_version
        life.check_in_due = due
        person_wait = life.wait is not None and life.wait.kind == 'person'
        if not person_wait or context_changed or due_changed or blocker_changed or cv.state != 'open':
            life.review_required = True
            life.outcome_status = 'needs_review'
        # A wake invalidates evidence, not the saved plan. Keep an executable
        # human/agent-maintained next action instead of replacing it with boilerplate.
        # Non-executable waits still become a scoped review when their event arrives.
        if not person_wait and life.next_action.kind not in ('continue_work','review_dependency'):
            life.next_action = ResponsibilityNextAction(kind='review_dependency',
                description='Review changed saved context or the due check-in before continuing.')
        # Retain an explicit human wait and its next action verbatim. Ordinary
        # messages only advance the fenced conversation version; evidence/check-in
        # changes may flag review, never silently authorize a continuation.
        self._responsibility_grant_blocker(c, p, a, life)
        if cv.state != 'open':
            life.blocker = 'conversation_closed'
        self._responsibility_state(life)
        return True

    def _reconcile_responsibility(self, c, p, ws, aid):
        a, cv = self._responsibility_assignment(c, p, ws, aid)
        life = self._lifecycle(c, ws, aid)
        if life.state in ('cancelled', 'taken_over'):
            return self._responsibility_detail(a, life)
        if self._refresh_responsibility(c, p, a, cv, life):
            a.work_version += 1
            self._stop_responsibility_runs(c, a)
            self._queue_responsibility_wake(c, p, a, life)
            self._persist_responsibility(c, a, life)
            super()._event(c, p, ws, 'responsibility_changed', aid)
        return self._responsibility_detail(a, life)

    def reconcile_responsibility(self, p, ws, assignment_id):
        """Exact-target provider-free catch-up, for existing consumer/check-in hooks."""
        with self.db.transaction() as c:
            self._scope(c, p, ws, write=True)
            a, _ = self._responsibility_assignment(c, p, ws, assignment_id)
            if p.id != a.owner_id:
                deny()
            return self._reconcile_responsibility(c, p, ws, assignment_id)

    def reconcile_due_responsibilities(self, p, ws, limit=50):
        """Bounded existing-consumer hook, scoped to one current owner/workspace.

        Returns only assignment IDs whose due check-in was reconciled. This is not
        a timer, a new scheduler, or authority to invoke any provider.
        """
        if p.kind != 'worker' or type(limit) is not int or not 1 <= limit <= 100:
            deny()
        with self.db.transaction() as c:
            self._scope(c, p, ws, write=True)
            rows = c.execute("SELECT id FROM assignments WHERE workspace_id=%s AND data->>'owner_id'=%s "
                "AND responsibility_lifecycle->>'state' NOT IN ('cancelled','taken_over') "
                "AND responsibility_lifecycle->>'check_in_due'='false' "
                "AND (responsibility_lifecycle->>'next_check_in_at')::timestamptz <= now() "
                "ORDER BY (responsibility_lifecycle->>'next_check_in_at')::timestamptz,id LIMIT %s",
                (ws, p.id, limit)).fetchall()
            for row in rows:
                self._reconcile_responsibility(c, p, ws, row['id'])
            return [row['id'] for row in rows]

    def _event(self, c, p, ws, operation, object_id):
        super()._event(c, p, ws, operation, object_id)
        if operation in ('claim_run', 'complete_run'):
            self._responsibility_run_event(c, p, ws, operation, object_id)
        if operation.startswith('responsibility_'):
            return
        # No workspace-wide private-body reads. Resolve only event object ownership
        # and query explicitly subscribed assignment IDs in this same workspace.
        artifact_ids = []
        conversation_id = None
        if operation == 'human_save':
            artifact_ids = [object_id]
        elif operation in ('accept_proposal', 'reject', 'dismiss'):
            row = c.execute('SELECT artifact_id FROM proposals WHERE workspace_id=%s AND id=%s',
                            (ws, object_id)).fetchone()
            artifact_ids = [row['artifact_id']] if row else []
        elif operation == 'cancel_conversation':
            conversation_id = object_id
        elif operation == 'post_message':
            row = c.execute('SELECT conversation_id FROM runs WHERE workspace_id=%s AND id=%s',
                            (ws, object_id)).fetchone()
            conversation_id = row['conversation_id'] if row else None
        elif operation == 'complete_run':
            artifact_ids = [r['artifact_id'] for r in c.execute(
                'SELECT DISTINCT artifact_id FROM product_observations WHERE workspace_id=%s AND run_id=%s',
                (ws, object_id)).fetchall() if r['artifact_id']]
        else:
            return
        from .service import encoded, Principal
        ids = set()
        for artifact_id in artifact_ids:
            ids.update(r['id'] for r in c.execute('SELECT id FROM assignments WHERE workspace_id=%s '
                "AND responsibility_lifecycle->'dependencies' @> %s", (ws, encoded([
                    {'kind': 'artifact_revision', 'object_id': artifact_id}]))).fetchall())
        if conversation_id:
            ids.update(r['id'] for r in c.execute('SELECT id FROM assignments WHERE workspace_id=%s '
                'AND conversation_id=%s AND responsibility_lifecycle IS NOT NULL',
                (ws, conversation_id)).fetchall())
        for aid in sorted(ids):
            owner = c.execute("SELECT data->>'owner_id' AS owner FROM assignments WHERE workspace_id=%s AND id=%s",
                              (ws, aid)).fetchone()['owner']
            principal = Principal(owner)
            try:
                self._scope(c, principal, ws, write=True)
                self._reconcile_responsibility(c, principal, ws, aid)
            except DomainError as exc:
                if exc.code.value not in ('not_found_or_not_authorized', 'source_unavailable'):
                    raise
                # Do not materialize private dependency bodies or queue work under
                # revoked authority. Current reads/replays still fail closed.
                row = c.execute('SELECT data FROM assignments WHERE workspace_id=%s AND id=%s', (ws, aid)).fetchone()
                a = Assignment.model_validate(row['data'])
                life = self._lifecycle(c, ws, aid)
                if life.state in ('cancelled', 'taken_over') or life.blocker == 'authority_unavailable':
                    continue
                life.blocker = 'authority_unavailable'
                self._responsibility_state(life)
                self._retire_responsibility_wake(c, ws, life)
                a.work_version += 1
                self._stop_responsibility_runs(c, a)
                self._persist_responsibility(c, a, life)
                super()._event(c, p, ws, 'responsibility_blocked', aid)

    def claim_responsibility_wake(self, p, ws, assignment_id, expected_work_version):
        """Trusted-process, exact-owner seam: claim local review, NEVER execution."""
        from .service import digest, encoded
        if p.kind != 'worker':
            deny()
        # Commit catch-up even when the caller's CAS is now stale. Raising inside
        # the claim transaction would otherwise roll back the replacement wake.
        self.reconcile_responsibility(p, ws, assignment_id)
        with self.db.transaction() as c:
            generation = self._scope(c, p, ws, write=True)
            a, _ = self._responsibility_assignment(c, p, ws, assignment_id)
            if a.owner_id != p.id:
                deny()
            self._responsibility_cas(a, expected_work_version)
            life = self._lifecycle(c, ws, a.id)
            if not self._responsibility_detail(a, life).local_review_eligible:
                raise DomainError('action_unresolved')
            row = c.execute('SELECT responsibility_fence,responsibility_lease FROM assignments '
                            'WHERE workspace_id=%s AND id=%s', (ws, a.id)).fetchone()
            lease = row['responsibility_lease']
            if lease and c.execute('SELECT %s::timestamptz > now() AS live',
                                   (lease['expires_at'],)).fetchone()['live']:
                raise DomainError('action_unresolved')
            secret = secrets.token_urlsafe(32)
            fence = row['responsibility_fence'] + 1
            lease = {'secret_hash': digest(secret), 'expires_at': (now() + timedelta(seconds=30)).isoformat(),
                     'work_version': a.work_version, 'access_generation': generation, 'wake_id': life.wake_id}
            c.execute('UPDATE assignments SET responsibility_fence=%s,responsibility_lease=%s '
                      'WHERE workspace_id=%s AND id=%s', (fence, encoded(lease), ws, a.id))
            return ResponsibilityReviewCapability(ws, a.id, p.id, a.work_version, generation,
                                                 fence, life.wake_id, secret)

    def review_responsibility_wake(self, cap):
        """Fenced local readback + exact ACK. Does not generate, admit, or complete work."""
        from .service import Principal, digest, encoded
        if not isinstance(cap, ResponsibilityReviewCapability):
            deny()
        p = Principal(cap.principal_id, 'worker')
        with self.db.transaction() as c:
            generation = self._scope(c, p, cap.workspace_id, write=True)
            a, cv = self._responsibility_assignment(c, p, cap.workspace_id, cap.assignment_id)
            life = self._lifecycle(c, cap.workspace_id, cap.assignment_id)
            row = c.execute('SELECT responsibility_fence,responsibility_lease FROM assignments '
                            'WHERE workspace_id=%s AND id=%s', (cap.workspace_id, cap.assignment_id)).fetchone()
            lease = row['responsibility_lease']
            if (not lease or a.owner_id != p.id or cap.fence != row['responsibility_fence'] or
                    a.work_version != cap.work_version or generation != cap.access_generation or
                    lease['work_version'] != cap.work_version or lease['access_generation'] != generation or
                    lease['wake_id'] != cap.wake_id or life.wake_id != cap.wake_id or
                    not secrets.compare_digest(lease['secret_hash'], digest(cap.secret))):
                deny()
            # Receipt replay after lost ACK also rechecks snapshot freshness, not
            # only authority. A missed source event must not replay a stale ACK.
            if self._refresh_responsibility(c, p, a, cv, life):
                raise DomainError('version_conflict', current_version=a.work_version)
            if life.wake_status == 'reviewed':
                return self._responsibility_review_receipt(a, life, cap.wake_id)
            if not c.execute('SELECT %s::timestamptz > now() AS live', (lease['expires_at'],)).fetchone()['live']:
                deny()

            if not self._responsibility_detail(a, life).local_review_eligible:
                deny()
            life.wake_status = 'reviewed'
            c.execute("UPDATE outbox SET consumed_at=now() WHERE workspace_id=%s AND id=%s "
                      "AND object_id=%s AND operation='responsibility_wake' AND consumed_at IS NULL",
                      (cap.workspace_id, cap.wake_id, cap.assignment_id))
            c.execute('UPDATE assignments SET responsibility_lifecycle=%s WHERE workspace_id=%s AND id=%s',
                      (encoded(life), cap.workspace_id, cap.assignment_id))
            super()._event(c, p, cap.workspace_id, 'responsibility_reviewed', cap.assignment_id)
            return self._responsibility_review_receipt(a, life, cap.wake_id)
