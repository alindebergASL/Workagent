"""Assignment-bound typed tool broker; never accepts a free-form principal."""
from .errors import DomainError, deny
from .models import Artifact, Task, TaskInspection, now, new_id
from .service import encoded
from .tool_registry import TOOLS


class Broker:
    def __init__(self, service, capability):
        self._service = service
        self._cap = capability

    def _read_scoped_context(self, arguments):
        from .responses_schema import ScopedRead, scope_registry
        from .service import digest
        request=ScopedRead.model_validate(arguments,strict=True)
        service,cap=self._service,self._cap
        with service.db.transaction() as c:
            p,run,a=service._check_capability(c,cap)
            if run.profile!='openai-responses-v1':
                raise DomainError('unsupported_operation')
            config=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                             (run.workspace_id,run.id)).fetchone()['data']
            if config['responses']['scope_tool_sha256']!=digest(scope_registry()):
                deny()
            ids=[ref.source_id for ref in a.selected_source_refs]
            if (len(set(request.source_ids))!=len(request.source_ids) or set(request.source_ids)!=set(ids)
                    or request.include_current_body!=(run.kind=='revision')):
                deny()
            sources=[]
            for ref in a.selected_source_refs:
                row=service._source(c,p,run.workspace_id,ref,True)
                sources.append({'id':ref.source_id,'external_version':ref.external_version,
                                'content':row['content'],'trust':'untrusted_evidence'})
            body=None
            if run.artifact_id:
                artifact,_=service._artifact(c,p,run.workspace_id,run.artifact_id)
                base=service._revision(c,p,run.workspace_id,artifact,a,run.base_revision_id)
                body=base.body.model_dump(mode='json')
            return {'sources':sources,'current_body':body,'base_revision_id':run.base_revision_id,
                    'instruction':run.instruction,'goal':a.goal,'completion_criteria':a.completion_criteria}

    def call(self, name, arguments):
        if name == 'read_scoped_context':
            return self._read_scoped_context(arguments)
        if name not in TOOLS:
            raise DomainError('unsupported_operation')
        request = TOOLS[name][0].model_validate(arguments)
        service, cap = self._service, self._cap
        # Proposal service validates again in the commit transaction. No arbitrary
        # human principal, save, accept, activation, create-task or SQL tool exists.
        if name == 'propose_artifact_revision':
            return service.propose_artifact_revision(cap, request)
        with service.db.transaction() as c:
            p, run, assignment = service._check_capability(c, cap)
            if request.workspace_id != cap.workspace_id:
                deny()
            if name == 'get_assignment':
                if request.assignment_id != assignment.id:
                    deny()
                return assignment
            if name == 'get_artifact':
                if request.artifact_id not in assignment.artifact_ids:
                    deny()
                row, a = service._artifact(c, p, cap.workspace_id, request.artifact_id)
                if a.id != assignment.id:
                    deny()
                current = service._revision(c, p, cap.workspace_id, row, a)
                historical = service._revision(c, p, cap.workspace_id, row, a, request.revision_id) if request.revision_id else None
                return Artifact(id=row['id'],workspace_id=cap.workspace_id,assignment_id=a.id,
                    current_revision_id=row['current_revision_id'],current_revision=current,requested_revision=historical)
            row = c.execute('SELECT data FROM tasks WHERE workspace_id=%s AND id=%s AND assignment_id=%s',
                            (cap.workspace_id, request.task_id, assignment.id)).fetchone()
            if not row:
                deny()
            task = Task.model_validate(row['data'])
            service._dependencies(c, p, cap.workspace_id, assignment, task.evidence_refs, True)
            inspection = TaskInspection(task=task, inspection_id=new_id(), observed_at=now(),
                verification='verified_created' if request.expected_version == task.version and request.expected_desired_result == task.desired_result else 'unresolved')
            c.execute('INSERT INTO task_inspections(id,workspace_id,task_id,principal_id,data) VALUES (%s,%s,%s,%s,%s)',
                (inspection.inspection_id,cap.workspace_id,task.id,p.id,encoded(inspection)))
            service._event(c,p,cap.workspace_id,'inspect_task',task.id)
            return inspection
