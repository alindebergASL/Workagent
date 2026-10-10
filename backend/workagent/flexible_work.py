"""Exact-version read broker. No code execution, bearer forwarding or arbitrary target."""
from .errors import DomainError, deny
from .flexible_models import Body, StructuredTableBody, CustomViewBody, check_table_edit, json_bytes


class FlexibleWork:
    def _validate_flexible_edit(self,before,after):
        if isinstance(before,StructuredTableBody) and isinstance(after,StructuredTableBody):
            try:
                check_table_edit(before,after)
            except ValueError as exc:
                raise DomainError('unsupported_operation') from exc

    def _view_bindings(self,c,p,ws,owner,body,generation):
        if body.access_generation!=generation:
            deny()  # Never reveal the replacement generation to a revoked view.
        bindings={}
        for ref in body.bindings:
            row,bound_owner=self._artifact(c,p,ws,ref.artifact_id)
            if row.get('conversation_id')!=owner.id or getattr(owner,'state',None)!='open':
                deny()
            # Do not leak the current replacement revision on a stale broker call.
            if row['current_revision_id']!=ref.revision_id: deny()
            revision=self._revision(c,p,ws,row,bound_owner,ref.revision_id)
            self._dependencies(c,p,ws,bound_owner,revision.source_dependencies,True)
            if revision.body_hash!=ref.body_hash: deny()
            if not isinstance(revision.body,(Body,StructuredTableBody)):
                raise DomainError('unsupported_operation')
            bindings[ref.name]=revision
        if json_bytes({k:v.body.model_dump(mode='json') for k,v in bindings.items()})>48000:
            raise DomainError('validation_error')
        return bindings

    def _validate_flexible_body(self,c,p,ws,owner,body):
        if isinstance(body,CustomViewBody):
            from .models import Conversation
            if not isinstance(owner,Conversation) or owner.state!='open': deny()
            generation=self._scope(c,p,ws)
            self._view_bindings(c,p,ws,owner,body,generation)

    def invoke_view_action(self,p,ws,artifact_id,cmd):
        from .models import ViewActionRequest, ViewActionResponse
        # Revalidate even trusted-process entry points, not only HTTP requests.
        cmd=ViewActionRequest.model_validate(cmd.model_dump(),strict=True)
        with self.db.transaction() as c:
            # Shared workspace/membership locks serialize with revocation and every
            # sanctioned save/accept. All exact revisions are checked in one tx.
            generation=self._scope(c,p,ws)
            row,owner=self._artifact(c,p,ws,artifact_id)
            if not row.get('conversation_id') or owner.state!='open': deny()
            if row['current_revision_id']!=cmd.view_revision_id: deny()
            revision=self._revision(c,p,ws,row,owner,cmd.view_revision_id)
            self._dependencies(c,p,ws,owner,revision.source_dependencies,True)
            if revision.body_hash!=cmd.view_body_hash or generation!=cmd.access_generation: deny()
            body=revision.body
            if not isinstance(body,CustomViewBody): raise DomainError('unsupported_operation')
            bound=self._view_bindings(c,p,ws,owner,body,generation)
            action=next((a for a in body.actions if a.name==cmd.action),None)
            if action is None: raise DomainError('unsupported_operation')
            target=bound[action.binding]  # Target comes ONLY from saved declarations.
            result=ViewActionResponse(view_revision_id=revision.id,access_generation=generation,
                binding=action.binding,artifact_id=target.artifact_id,revision_id=target.id,
                body_hash=target.body_hash,body=target.body)
            if json_bytes(result.model_dump(mode='json'))>60000:
                raise DomainError('validation_error')
            return result
