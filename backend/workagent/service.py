"""One transactional domain boundary shared by HTTP and the fixture worker.

Coarse workspace row locks deliberately serialize mutations, including command replay,
lease claims and revocation. Read paths hold a shared workspace/authority lock. This
small baseline favors auditable correctness over throughput; no distributed effects.
"""
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Callable

from psycopg.types.json import Jsonb
from .db import Database
from .errors import DomainError, deny
from .models import *
from .provider_attempts import ProviderAttempts, admission_grant, attempt_row


def canonical(value) -> str:
    if isinstance(value, Model):
        value = value.model_dump(mode='json')
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def fixture_pins():
    from .tool_registry import registry
    from .runtime_config import loader
    approved = loader()
    approved.load('0.1.0')
    return approved.approvals['0.1.0']['manifest_sha256'], digest(registry())


def encoded(value):
    return Jsonb(value.model_dump(mode='json') if isinstance(value, Model) else value)


@dataclass(frozen=True)
class Principal:
    id: str
    kind: str = 'human'


@dataclass(frozen=True)
class WorkerCapability:
    workspace_id: str
    run_id: str
    principal_id: str
    fence: int
    secret: str


class Service(ProviderAttempts):
    def __init__(self, db: Database):
        self.db = db

    def _scope(self, c, p, ws, write=False):
        lock = 'UPDATE' if write else 'SHARE'
        row = c.execute(f'SELECT * FROM workspaces WHERE id=%s FOR {lock}', (ws,)).fetchone()
        if not row:
            deny()
        member = c.execute('SELECT * FROM memberships WHERE workspace_id=%s AND principal_id=%s FOR SHARE', (ws, p.id)).fetchone()
        if not member or not member['active'] or (write and member['role'] == 'viewer'):
            deny()
        return row['access_generation']

    def _source(self, c, p, ws, ref, check_version=False):
        grant = c.execute('SELECT active FROM source_access WHERE workspace_id=%s AND source_id=%s AND principal_id=%s FOR SHARE', (ws, ref.source_id, p.id)).fetchone()
        row = c.execute('SELECT * FROM sources WHERE workspace_id=%s AND id=%s FOR SHARE', (ws, ref.source_id)).fetchone()
        if not grant or not grant['active'] or not row:
            deny()
        source = Source.model_validate(row['data'])
        if not source.available:
            raise DomainError('source_unavailable')
        if check_version and source.external_version != ref.external_version:
            raise DomainError('source_changed')
        return row

    def _assignment(self, c, p, ws, assignment_id, versions=False):
        row = c.execute('SELECT data FROM assignments WHERE workspace_id=%s AND id=%s', (ws, assignment_id)).fetchone()
        if not row:
            deny()
        a = Assignment.model_validate(row['data'])
        for ref in sorted(a.selected_source_refs, key=lambda s: s.source_id):
            self._source(c, p, ws, ref, versions)
        return a

    def _artifact(self, c, p, ws, artifact_id):
        row = c.execute('SELECT * FROM artifacts WHERE workspace_id=%s AND id=%s', (ws, artifact_id)).fetchone()
        if not row:
            deny()
        a = self._assignment(c, p, ws, row['assignment_id'])
        return row, a

    def _proposal(self, c, p, ws, proposal_id):
        row = c.execute('SELECT data FROM proposals WHERE workspace_id=%s AND id=%s', (ws, proposal_id)).fetchone()
        if not row:
            deny()
        proposal = Proposal.model_validate(row['data'])
        artifact, assignment = self._artifact(c, p, ws, proposal.artifact_id)
        self._dependencies(c, p, ws, assignment, proposal.source_dependencies)
        return proposal, artifact, assignment

    def _dependencies(self, c, p, ws, assignment, refs, versions=False):
        allowed = {s.source_id for s in assignment.selected_source_refs}
        for ref in refs:
            if ref.source_id not in allowed:
                deny()
            self._source(c, p, ws, ref, versions)

    def _revision(self, c, p, ws, artifact, assignment, revision_id=None):
        rid = revision_id or artifact['current_revision_id']
        row = c.execute('SELECT data FROM revisions WHERE workspace_id=%s AND artifact_id=%s AND id=%s', (ws, artifact['id'], rid)).fetchone()
        if not row:
            deny()
        revision = Revision.model_validate(row['data'])
        self._dependencies(c, p, ws, assignment, revision.source_dependencies)
        return revision

    def _event(self, c, p, ws, operation, object_id):
        event_id = new_id()
        c.execute('INSERT INTO audit(id,workspace_id,principal_id,operation,object_id) VALUES (%s,%s,%s,%s,%s)', (event_id,ws,p.id,operation,object_id))
        c.execute('INSERT INTO outbox(id,workspace_id,operation,object_id) VALUES (%s,%s,%s,%s)', (event_id,ws,operation,object_id))
        if operation in ('create_assignment', 'request_revision', 'control_assignment'):
            c.execute('''INSERT INTO run_dispatches(workspace_id,run_id,outbox_id)
                SELECT workspace_id,id,%s FROM runs WHERE workspace_id=%s
                AND (id=%s OR assignment_id=%s) AND data->>'state'='queued'
                ON CONFLICT(workspace_id,run_id) DO NOTHING''', (event_id,ws,object_id,object_id))

    def _store_assignment(self, c, a):
        a.observed_at=now()
        c.execute('UPDATE assignments SET data=%s WHERE workspace_id=%s AND id=%s', (encoded(a.model_dump(mode='json',exclude={'responsibility'})),a.workspace_id,a.id))

    def _store_run(self, c, r):
        r.observed_at=now()
        c.execute('UPDATE runs SET data=%s WHERE workspace_id=%s AND id=%s', (encoded(r),r.workspace_id,r.id))

    def _refresh_progress(self,c,a):
        # Preparation state is authoritative across all admitted runs, not whichever
        # completion happened last. Human proposal approval is a separate receipt.
        rows=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND assignment_id=%s',(a.workspace_id,a.id)).fetchall()
        runs={row['data']['id']:Run.model_validate(row['data']) for row in rows}
        ordered=[runs[id] for id in a.run_ids if id in runs]
        terminal={}
        for run in ordered:
            if run.state in ('ready','partial'):
                terminal[run.artifact_id or 'initial']=run
        a.unresolved=list(dict.fromkeys(note for run in terminal.values() for note in run.unresolved))
        a.state=('running' if any(r.state=='running' for r in ordered) else
                 'queued' if any(r.state=='queued' for r in ordered) else
                 'partial' if a.unresolved else 'ready')

    def _command(self, p, ws, op, path_args, command, result_model, authorize: Callable, mutate: Callable):
        if p.kind != 'human':
            deny()
        payload = command.model_dump(mode='json', exclude={'request_id', 'command_id'})
        key = digest({'operation': op, 'arguments': path_args, 'payload': payload})
        with self.db.transaction() as c:
            self._scope(c, p, ws, write=True)
            authorized = authorize(c)  # Always current authorization, before cached result access.
            previous = c.execute('SELECT payload_hash,result FROM commands WHERE principal_id=%s AND workspace_id=%s AND command_id=%s', (p.id,ws,command.command_id)).fetchone()
            if previous:
                if previous['payload_hash'] != key:
                    raise DomainError('command_conflict')
                return result_model.model_validate(previous['result'])
            result = mutate(c, authorized)
            c.execute('INSERT INTO commands(principal_id,workspace_id,command_id,payload_hash,result) VALUES (%s,%s,%s,%s,%s)', (p.id,ws,command.command_id,key,encoded(result)))
            return result

    def list_workspaces(self, p, cursor=None, limit=25):
        with self.db.transaction() as c:
            rows = c.execute('SELECT w.data,w.id,w.access_generation FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.principal_id=%s AND m.active AND w.id>%s ORDER BY w.id LIMIT %s FOR SHARE OF w,m', (p.id,cursor or '',limit+1)).fetchall()
            items = [Workspace.model_validate({**r['data'], 'access_generation':r['access_generation']}) for r in rows[:limit]]
            return WorkspacePage(items=items, next_cursor=items[-1].id if len(rows)>limit else None)

    def list_sources(self, p, ws, cursor=None, limit=25):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            rows = c.execute('SELECT s.data FROM sources s JOIN source_access g ON g.workspace_id=s.workspace_id AND g.source_id=s.id WHERE s.workspace_id=%s AND g.principal_id=%s AND g.active AND s.id>%s ORDER BY s.id LIMIT %s FOR SHARE OF s,g', (ws,p.id,cursor or '',limit+1)).fetchall()
            items = [Source.model_validate(r['data']) for r in rows[:limit]]
            return SourcePage(items=items,next_cursor=items[-1].id if len(rows)>limit else None)

    def get_source(self,p,ws,source_id):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            row=c.execute('SELECT data FROM sources WHERE workspace_id=%s AND id=%s',(ws,source_id)).fetchone()
            if not row:
                deny()
            source=Source.model_validate(row['data'])
            row=self._source(c,p,ws,SourceRef(source_id=source.id,external_version=source.external_version,observed_at=source.observed_at))
            return SourceDetail(**source.model_dump(),content=row['content'])

    def list_assignments(self, p, ws, cursor=None, limit=25):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            # Filter source authorization in SQL before materializing assignment titles/bodies.
            rows = c.execute('''SELECT a.id FROM assignments a WHERE a.workspace_id=%s AND a.id>%s
              AND NOT EXISTS (SELECT 1 FROM assignment_sources s LEFT JOIN source_access g
                ON g.workspace_id=s.workspace_id AND g.source_id=s.source_id AND g.principal_id=%s
                JOIN sources src ON src.workspace_id=s.workspace_id AND src.id=s.source_id
                WHERE s.workspace_id=a.workspace_id AND s.assignment_id=a.id
                AND (g.active IS DISTINCT FROM true OR (src.data->>'available')::boolean IS DISTINCT FROM true))
              ORDER BY a.id LIMIT %s''', (ws,cursor or '',p.id,limit+1)).fetchall()
            from .outcomes import project_assignment
            items = [project_assignment(self,c,p,self._assignment(c,p,ws,r['id'])) for r in rows[:limit]]
            return AssignmentPage(items=items,next_cursor=items[-1].id if len(rows)>limit else None)

    def get_assignment(self,p,ws,assignment_id):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            from .outcomes import project_assignment
            return project_assignment(self,c,p,self._assignment(c,p,ws,assignment_id))

    def get_run(self,p,ws,run_id):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            row=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',(ws,run_id)).fetchone()
            if not row:
                deny()
            r=Run.model_validate(row['data'])
            self._assignment(c,p,ws,r.assignment_id)
            return r

    def _new_run(self,c,p,a,kind='initial',**kwargs):
        pending=c.execute("""SELECT 1 FROM provider_attempts t JOIN runs r
            ON r.workspace_id=t.workspace_id AND r.id=t.run_id
            WHERE r.workspace_id=%s AND r.assignment_id=%s
            AND t.data->>'state' IN ('prepared','dispatched','outcome_unknown','responded') LIMIT 1""",
            (a.workspace_id,a.id)).fetchone()
        if pending:
            raise DomainError('action_unresolved')
        generation=c.execute('SELECT access_generation FROM workspaces WHERE id=%s',(a.workspace_id,)).fetchone()['access_generation']
        from .runtime_config import active_configuration, pin_run
        from .tool_registry import registry
        activation_id, activation = active_configuration(c)
        bundle_hash,tool_registry_hash=activation['bundle_hash'],digest(registry())
        grant=admission_grant(c,a.workspace_id,p.id)
        if grant and grant.profile=='openai-responses-v1':
            previous=c.execute("SELECT r.assignment_id,r.data FROM runs r JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id WHERE rc.data->>'grant_id'=%s",(grant.id,)).fetchall()
            if (not previous and kind!='initial') or (previous and (len(previous)!=1 or kind!='revision' or previous[0]['assignment_id']!=a.id or previous[0]['data']['kind']!='initial')):
                raise DomainError('action_unresolved')
        profile=grant.profile if grant else 'fixture-deterministic-v1'
        execution=ExecutionProvenance(mode='managed' if grant else 'fixture',profile=profile,
                                     model=grant.model if grant else None,grant_id=grant.id if grant else None,
                                     evidence_origin='unverified' if grant else 'fixture')
        r=Run(id=new_id(), workspace_id=a.workspace_id, assignment_id=a.id, principal_id=p.id,
              kind=kind, access_generation=generation, bundle_hash=bundle_hash,
              tool_registry_hash=tool_registry_hash, profile=profile, execution=execution, **kwargs)
        c.execute('INSERT INTO runs(workspace_id,id,assignment_id,data) VALUES (%s,%s,%s,%s)',(a.workspace_id,r.id,a.id,encoded(r)))
        pin_run(c, r, a, activation_id, activation, grant)
        a.run_ids.append(r.id)
        self._refresh_progress(c,a)
        self._store_assignment(c,a)
        return r

    def create_assignment(self,p,ws,cmd):
        def auth(c):
            for ref in sorted(cmd.selected_source_refs,key=lambda s:s.source_id):
                self._source(c,p,ws,ref,False)
        def mutate(c,_):
            # Freshness is an admission precondition, not a cached-result permission.
            for ref in sorted(cmd.selected_source_refs,key=lambda s:s.source_id):
                self._source(c,p,ws,ref,True)
            a=Assignment(id=new_id(),workspace_id=ws,owner_id=p.id,goal=cmd.goal,completion_criteria=cmd.completion_criteria,selected_source_refs=cmd.selected_source_refs)
            c.execute('INSERT INTO assignments(workspace_id,id,data) VALUES (%s,%s,%s)',(ws,a.id,encoded(a)))
            for ref in a.selected_source_refs:
                c.execute('INSERT INTO assignment_sources(workspace_id,assignment_id,source_id) VALUES (%s,%s,%s)',(ws,a.id,ref.source_id))
            r=self._new_run(c,p,a)
            self._event(c,p,ws,'create_assignment',a.id)
            return AssignmentCreated(assignment=a,run=r)
        return self._command(p,ws,'create_assignment',{},cmd,AssignmentCreated,auth,mutate)

    def get_artifact(self,p,ws,artifact_id,revision_id=None):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            row,a=self._artifact(c,p,ws,artifact_id)
            rev=self._revision(c,p,ws,row,a)
            requested=self._revision(c,p,ws,row,a,revision_id) if revision_id else None
            return Artifact(id=artifact_id,workspace_id=ws,assignment_id=a.id,current_revision_id=row['current_revision_id'],current_revision=rev,requested_revision=requested)

    def history(self,p,ws,artifact_id,cursor=None,limit=25):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            row,a=self._artifact(c,p,ws,artifact_id)
            rows=c.execute('SELECT id FROM revisions WHERE workspace_id=%s AND artifact_id=%s AND id>%s ORDER BY id LIMIT %s',(ws,artifact_id,cursor or '',limit+1)).fetchall()
            items=[self._revision(c,p,ws,row,a,r['id']) for r in rows[:limit]]
            return RevisionPage(items=items,next_cursor=items[-1].id if len(rows)>limit else None)

    def proposals(self,p,ws,artifact_id,cursor=None,limit=25):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            self._artifact(c,p,ws,artifact_id)
            rows=c.execute('SELECT id FROM proposals WHERE workspace_id=%s AND artifact_id=%s AND id>%s ORDER BY id LIMIT %s',(ws,artifact_id,cursor or '',limit+1)).fetchall()
            items=[self._proposal(c,p,ws,r['id'])[0] for r in rows[:limit]]
            return ProposalPage(items=items,next_cursor=items[-1].id if len(rows)>limit else None)

    def _cas(self,row,expected,proposal_id=None):
        if row['current_revision_id'] != expected:
            raise DomainError('version_conflict',current_revision_id=row['current_revision_id'],proposal_id=proposal_id)

    def _append_revision(self,c,p,ws,row,a,body,deps,author_kind):
        previous=self._revision(c,p,ws,row,a) if row['current_revision_id'] else None
        rev=Revision(id=new_id(),artifact_id=row['id'],revision_number=previous.revision_number+1 if previous else 1,
                     parent_revision_id=previous.id if previous else None,author_id=p.id,author_kind=author_kind,
                     body=body,body_hash=digest(body),source_dependencies=deps)
        c.execute('INSERT INTO revisions(workspace_id,artifact_id,id,revision_number,parent_revision_id,data) VALUES (%s,%s,%s,%s,%s,%s)',(ws,row['id'],rev.id,rev.revision_number,rev.parent_revision_id,encoded(rev)))
        c.execute('UPDATE artifacts SET current_revision_id=%s WHERE workspace_id=%s AND id=%s',(rev.id,ws,row['id']))
        return Artifact(id=row['id'],workspace_id=ws,assignment_id=a.id,current_revision_id=rev.id,current_revision=rev)

    def human_save(self,p,ws,artifact_id,cmd):
        def mutate(c,state):
            row,a=state
            self._cas(row,cmd.expected_current_revision_id)
            previous=self._revision(c,p,ws,row,a)
            result=self._append_revision(c,p,ws,row,a,cmd.body,previous.source_dependencies,'human')
            self._event(c,p,ws,'human_save',artifact_id)
            return result
        return self._command(p,ws,'human_save',{'artifact_id':artifact_id},cmd,Artifact,lambda c:self._artifact(c,p,ws,artifact_id),mutate)

    def request_revision(self,p,ws,artifact_id,cmd):
        def mutate(c,state):
            row,a=state
            self._cas(row,cmd.base_revision_id)
            if a.work_version != cmd.expected_work_version:
                raise DomainError('version_conflict',current_version=a.work_version)
            self._assignment(c,p,ws,a.id,True)
            if a.state in ('paused','cancelled'):
                raise DomainError('unsupported_operation')
            a.work_version+=1
            r=self._new_run(c,p,a,'revision',artifact_id=artifact_id,base_revision_id=cmd.base_revision_id,instruction=cmd.instruction)
            self._event(c,p,ws,'request_revision',r.id)
            return RevisionQueued(run=r)
        return self._command(p,ws,'request_revision',{'artifact_id':artifact_id},cmd,RevisionQueued,lambda c:self._artifact(c,p,ws,artifact_id),mutate)

    def accept_proposal(self,p,ws,proposal_id,cmd):
        def mutate(c,state):
            proposal,row,a=state
            self._cas(row,cmd.expected_current_revision_id,proposal.id)
            # Supplying the new current ID is NOT an implicit rebase of old bytes.
            self._cas(row,proposal.base_revision_id,proposal.id)
            if proposal.status != 'pending':
                raise DomainError('decision_stale')
            self._dependencies(c,p,ws,a,proposal.source_dependencies,True)
            result=self._append_revision(c,p,ws,row,a,proposal.body,proposal.source_dependencies,'human')
            proposal.status='accepted'
            proposal.accepted_revision_id=result.current_revision_id
            c.execute('UPDATE proposals SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(proposal),ws,proposal.id))
            self._event(c,p,ws,'accept_proposal',proposal.id)
            return result
        return self._command(p,ws,'accept_proposal',{'proposal_id':proposal_id},cmd,Artifact,lambda c:self._proposal(c,p,ws,proposal_id),mutate)

    def dismiss_proposal(self,p,ws,proposal_id,cmd):
        def mutate(c,state):
            proposal,row,_=state
            self._cas(row,cmd.expected_current_revision_id,proposal.id)
            if proposal.status != 'pending':
                raise DomainError('decision_stale')
            proposal.status='dismissed'
            c.execute('UPDATE proposals SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(proposal),ws,proposal.id))
            self._event(c,p,ws,cmd.resolution,proposal.id)
            return proposal
        return self._command(p,ws,'dismiss_proposal',{'proposal_id':proposal_id},cmd,Proposal,lambda c:self._proposal(c,p,ws,proposal_id),mutate)

    def create_task(self,p,ws,assignment_id,cmd):
        def auth(c):
            a=self._assignment(c,p,ws,assignment_id)
            owner=c.execute('SELECT active FROM memberships WHERE workspace_id=%s AND principal_id=%s FOR SHARE',(ws,cmd.owner_id)).fetchone()
            if not owner or not owner['active']:
                deny()
            self._dependencies(c,p,ws,a,cmd.evidence_refs)
            return a
        def mutate(c,a):
            if a.work_version != cmd.expected_work_version:
                raise DomainError('version_conflict',current_version=a.work_version)
            t=Task(id=new_id(),workspace_id=ws,assignment_id=a.id,owner_id=cmd.owner_id,desired_result=cmd.desired_result,evidence_refs=cmd.evidence_refs)
            c.execute('INSERT INTO tasks(workspace_id,id,assignment_id,data) VALUES (%s,%s,%s,%s)',(ws,t.id,a.id,encoded(t)))
            a.work_version+=1
            self._store_assignment(c,a)
            self._event(c,p,ws,'create_task',t.id)
            return TaskReceipt(task=t)
        return self._command(p,ws,'create_task',{'assignment_id':assignment_id},cmd,TaskReceipt,auth,mutate)

    def get_task(self,p,ws,task_id,expected_version=None,expected_desired_result=None):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            row=c.execute('SELECT data FROM tasks WHERE workspace_id=%s AND id=%s',(ws,task_id)).fetchone()
            if not row:
                deny()
            t=Task.model_validate(row['data'])
            a=self._assignment(c,p,ws,t.assignment_id)
            self._dependencies(c,p,ws,a,t.evidence_refs)
            result=TaskInspection(task=t,inspection_id=new_id(),observed_at=now(),verification='verified_created' if expected_version==t.version and expected_desired_result==t.desired_result else 'unresolved')
            c.execute('INSERT INTO task_inspections(id,workspace_id,task_id,principal_id,data) VALUES (%s,%s,%s,%s,%s)',(result.inspection_id,ws,t.id,p.id,encoded(result)))
            self._event(c,p,ws,'inspect_task',t.id)
            return result

    def control_assignment(self,p,ws,assignment_id,cmd):
        def mutate(c,a):
            if a.work_version != cmd.expected_work_version:
                raise DomainError('version_conflict',current_version=a.work_version)
            if cmd.operation=='resume' and a.state!='paused':
                raise DomainError('unsupported_operation')
            if a.state=='cancelled':
                raise DomainError('unsupported_operation')
            rows=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND assignment_id=%s',(ws,a.id)).fetchall()
            for row in rows:
                r=Run.model_validate(row['data'])
                if r.state in ('queued','running'):
                    r.state='cancelled'; r.fence+=1; r.lease_expires_at=None
                    self._store_run(c,r)
            a.state={'pause':'paused','resume':'queued','cancel':'cancelled'}[cmd.operation]
            a.work_version+=1
            if cmd.operation=='resume':
                self._assignment(c,p,ws,a.id,True)
                if a.artifact_ids:
                    self._refresh_progress(c,a)
                else:
                    self._new_run(c,p,a)
            self._store_assignment(c,a)
            self._event(c,p,ws,'control_assignment',a.id)
            return a
        return self._command(p,ws,'control_assignment',{'assignment_id':assignment_id},cmd,Assignment,lambda c:self._assignment(c,p,ws,assignment_id),mutate)

    def _runtime_pins(self,c,r):
        from .runtime_config import check_pins, BundleDenied
        try:
            check_pins(c,r)
        except (BundleDenied, OSError, KeyError, ValueError) as exc:
            raise DomainError('unsupported_operation') from exc

    def worker_context(self,cap):
        from .runtime_config import assemble_context
        with self.db.transaction() as c:
            return assemble_context(self,c,cap)

    def claim_run(self,p,ws,run_id):
        """Trusted-process seam, never an HTTP/model tool. Returns a fenced lease."""
        return self._claim_run(p,ws,run_id)

    def _claim_run(self,p,ws,run_id,received_result=False,responses_receipt=None):
        with self.db.transaction() as c:
            generation=self._scope(c,p,ws,True)
            row=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s',(ws,run_id)).fetchone()
            if not row:
                deny()
            r=Run.model_validate(row['data'])
            if r.principal_id!=p.id:
                deny()
            a=self._assignment(c,p,ws,r.assignment_id,True)
            attempt=attempt_row(c,ws,run_id)
            if responses_receipt is not None:
                bound,existing,_=self._receipt_binding(c,responses_receipt)
                if bound.id!=r.id or r.profile!='openai-responses-v1' or existing.state=='failed':
                    raise DomainError('action_unresolved')
            elif received_result:
                if not attempt or attempt.state!='responded':
                    raise DomainError('action_unresolved')
            elif attempt:
                # Lease expiry/repeated delivery is never permission for another send.
                raise DomainError('action_unresolved')
            self._runtime_pins(c,r)
            if a.state in ('paused','cancelled') or r.state not in ('queued','running'):
                raise DomainError('action_unresolved')
            if r.access_generation!=generation:
                raise DomainError('source_changed')
            if r.state=='running' and r.lease_expires_at and r.lease_expires_at>now():
                raise DomainError('action_unresolved')
            if r.used_units>=r.budget_units:
                raise DomainError('budget_exhausted')
            others=c.execute('SELECT data FROM runs WHERE workspace_id=%s AND assignment_id=%s AND id<>%s',(ws,a.id,r.id)).fetchall()
            for other in others:
                active=Run.model_validate(other['data'])
                if active.state=='running' and active.lease_expires_at and active.lease_expires_at>now():
                    raise DomainError('action_unresolved')
            secret=secrets.token_urlsafe(32)
            r.fence+=1; r.state='running'; r.lease_expires_at=now()+timedelta(seconds=120)
            self._store_run(c,r)
            c.execute('UPDATE runs SET lease_hash=%s WHERE workspace_id=%s AND id=%s',(digest(secret),ws,r.id))
            self._refresh_progress(c,a)
            a.work_version+=1; self._store_assignment(c,a)
            self._event(c,p,ws,'claim_run',r.id)
            cap=WorkerCapability(ws,r.id,p.id,r.fence,secret)
            from .runtime_config import assemble_context
            assemble_context(self,c,cap)
            return cap

    def _check_capability(self,c,cap,allow_completed=False):
        if not isinstance(cap,WorkerCapability):
            deny()
        p=Principal(cap.principal_id,'worker')
        generation=self._scope(c,p,cap.workspace_id,True)
        row=c.execute('SELECT * FROM runs WHERE workspace_id=%s AND id=%s',(cap.workspace_id,cap.run_id)).fetchone()
        if not row:
            deny()
        r=Run.model_validate(row['data'])
        if r.principal_id!=p.id or r.fence!=cap.fence or not secrets.compare_digest(row['lease_hash'] or '',digest(cap.secret)):
            deny()
        completed=allow_completed and r.state in ('ready','partial')
        if not completed and (r.state!='running' or not r.lease_expires_at or r.lease_expires_at<=now()):
            raise DomainError('action_unresolved')
        a=self._assignment(c,p,cap.workspace_id,r.assignment_id,True)
        self._runtime_pins(c,r)
        if r.access_generation!=generation:
            raise DomainError('source_changed')
        if a.state in ('paused','cancelled'):
            raise DomainError('action_unresolved')
        if not completed and r.used_units>=r.budget_units:
            raise DomainError('budget_exhausted')
        context=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(r.workspace_id,r.id)).fetchone()
        if context:
            for source in context['data']['source_manifest']:
                row=c.execute('SELECT content FROM sources WHERE workspace_id=%s AND id=%s',(r.workspace_id,source['id'])).fetchone()
                if not row or digest(row['content'])!=source['sha256']:
                    raise DomainError('source_changed')
        return p,r,a

    def worker_inputs(self,cap):
        with self.db.transaction() as c:
            p,r,a=self._check_capability(c,cap)
            sources=[self._source(c,p,a.workspace_id,ref,True) for ref in a.selected_source_refs]
            base=None
            if r.artifact_id:
                artifact,_=self._artifact(c,p,a.workspace_id,r.artifact_id)
                base=self._revision(c,p,a.workspace_id,artifact,a,r.base_revision_id)
            return r,a,sources,base

    def complete_run(self,cap,bodies: list[Body],unresolved: list[str] | None=None,command: Command | None=None):
        """Publish initial artifacts OR immutable proposal; never accept over a human edit.

        Supply a stable Command for replay after a lost response. Without one a second
        completion is unresolved; it never creates another set of artifacts/proposals.
        """
        bodies=[Body.model_validate(b) for b in bodies]
        if not 1<=len(bodies)<=10:
            raise DomainError('validation_error')
        payload_hash=digest({'operation':'complete_run','run_id':cap.run_id if isinstance(cap,WorkerCapability) else None,
                             'bodies':[b.model_dump(mode='json') for b in bodies],'unresolved':unresolved or [],
                             'command':command.model_dump(mode='json',exclude={'request_id','command_id'}) if command else None})
        with self.db.transaction() as c:
            p,r,a=self._check_capability(c,cap,allow_completed=command is not None)
            ws=a.workspace_id
            if command:
                previous=c.execute('SELECT payload_hash,result FROM commands WHERE principal_id=%s AND workspace_id=%s AND command_id=%s',(p.id,ws,command.command_id)).fetchone()
                if previous:
                    if previous['payload_hash']!=payload_hash:
                        raise DomainError('command_conflict')
                    return Run.model_validate(previous['result'])
            if r.state!='running':
                raise DomainError('action_unresolved')
            if r.profile in ('openai-agents-v1','openai-responses-v1'):
                attempt=attempt_row(c,ws,r.id)
                if not attempt or attempt.state!='responded' or not attempt.result:
                    raise DomainError('action_unresolved')
                if bodies!=attempt.result.bodies or (unresolved or [])!=attempt.result.unresolved:
                    raise DomainError('command_conflict')
                config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,r.id)).fetchone()['data']
                if attempt.result.usage.output_tokens>config['max_received_output_tokens']:
                    raise DomainError('budget_exhausted')
            bindings=[]
            if r.kind=='initial':
                if a.artifact_ids:
                    raise DomainError('version_conflict')
                for body in bodies:
                    artifact_id=new_id()
                    c.execute('INSERT INTO artifacts(workspace_id,id,assignment_id) VALUES (%s,%s,%s)',(ws,artifact_id,a.id))
                    published=self._append_revision(c,p,ws,{'id':artifact_id,'current_revision_id':None},a,body,a.selected_source_refs,'worker')
                    bindings.append(ArtifactBinding(artifact_id=artifact_id,revision_id=published.current_revision_id,body_hash=digest(body)))
                    a.artifact_ids.append(artifact_id)
            else:
                if len(bodies)!=1:
                    raise DomainError('validation_error')
                row,_=self._artifact(c,p,ws,r.artifact_id)
                # Deliberately retain a proposal even if current moved since its base.
                proposal=Proposal(id=new_id(),workspace_id=ws,assignment_id=a.id,artifact_id=r.artifact_id,base_revision_id=r.base_revision_id,
                                  base_work_version=a.work_version,body=bodies[0],body_hash=digest(bodies[0]),source_dependencies=a.selected_source_refs,reason=r.instruction)
                c.execute('INSERT INTO proposals(workspace_id,id,artifact_id,base_revision_id,data) VALUES (%s,%s,%s,%s,%s)',(ws,proposal.id,r.artifact_id,r.base_revision_id,encoded(proposal)))
                r.proposal_id=proposal.id
                bindings.append(ArtifactBinding(artifact_id=r.artifact_id,proposal_id=proposal.id,
                                               base_revision_id=r.base_revision_id,body_hash=proposal.body_hash))
            c.execute('INSERT INTO run_publications(workspace_id,run_id,data) VALUES (%s,%s,%s)',
                      (ws,r.id,encoded({'artifacts':[b.model_dump(mode='json') for b in bindings]})))
            r.state='partial' if unresolved else 'ready'; r.unresolved=unresolved or []; r.used_units+=1
            r.lease_expires_at=None; r.cursor+=1
            self._store_run(c,r)
            self._refresh_progress(c,a)
            a.work_version+=1
            self._store_assignment(c,a)
            self._event(c,p,ws,'complete_run',r.id)
            # Outbox admission is acknowledged only by post-commit reconciliation.
            # A crash here leaves durable terminal state, never another computation.
            if command:
                c.execute('INSERT INTO commands(principal_id,workspace_id,command_id,payload_hash,result) VALUES (%s,%s,%s,%s,%s)',(p.id,ws,command.command_id,payload_hash,encoded(r)))
            return r

    def propose_artifact_revision(self,cap,command):
        """Typed broker seam: capability fixes assignment/artifact/base/dependencies.

        No human acceptance is reachable here. Rechecking in complete_run closes the
        gap between validation and commit, including fence and source revocation.
        """
        from .tool_registry import ProposeArtifactRevisionInput
        command=ProposeArtifactRevisionInput.model_validate(command)
        with self.db.transaction() as c:
            p,r,a=self._check_capability(c,cap,allow_completed=True)
            if (r.kind!='revision' or command.workspace_id!=a.workspace_id or
                command.artifact_id!=r.artifact_id or command.base_revision_id!=r.base_revision_id):
                deny()
            if sorted(canonical(x) for x in command.source_dependencies)!=sorted(canonical(x) for x in a.selected_source_refs):
                deny()
        return self.complete_run(cap,[command.body],command=command)
