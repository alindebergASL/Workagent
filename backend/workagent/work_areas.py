"""Project/workflow Spaces are metadata on canonical conversations, not tenants.

All mutations run under the existing workspace lock, command replay and source
reauthorization boundary. Runs, artifacts and responsibilities remain canonical.
"""
from .models import (Conversation, ConversationPage, WorkAreaMetadata, new_id)
from .errors import deny


class WorkAreas:
    def get_work_area_context(self,p,ws,cid):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            cv=self._conversation(c,p,ws,cid)
            return self._work_area_context(c,p,ws,cv)

    def _work_area_context(self,c,p,ws,cv,*,snapshot=None,work_version=None):
        """Project current canonical records after enumerating scoped identifiers.

        A run's first projection fixes its read set. Revalidation reads those same
        records, never expands the snapshot because this run recorded a new
        responsibility. Existing records must still match exactly. API reads have
        no snapshot and always show current work, including new records.
        """
        from .work_area_models import (WorkAreaContext, WorkAreaArtifact,
            WorkAreaProposal, WorkAreaResponsibility, WorkAreaOmissions)
        from .models import ExactTarget
        from .product_models import TableBody,ToolBody
        from .flexible_models import Body,StructuredTableBody,CustomViewBody
        from .service import canonical,digest
        from .errors import DomainError

        def identifiers(table,key,limit,extra='',name=None):
            name=name or table
            selected=[item[key] for item in snapshot[name]] if snapshot else None
            # Only identifiers/counts, scoped BEFORE body/lifecycle materialization.
            scope=('artifact_id IN (SELECT id FROM artifacts WHERE workspace_id=%s AND conversation_id=%s)'
                   if table=='proposals' else 'conversation_id=%s')
            params=(ws,ws,cv.id) if table=='proposals' else (ws,cv.id)
            rows=c.execute(f'SELECT id,count(*) OVER () AS total FROM {table} '
                'WHERE workspace_id=%s AND '+scope+extra+
                (' AND id=ANY(%s)' if selected is not None else '')+
                ' ORDER BY id LIMIT %s',
                (*params,*([selected] if selected is not None else []),limit)).fetchall()
            if selected is not None and {r['id'] for r in rows}!=set(selected):
                raise DomainError('source_changed')
            omitted=(snapshot['omissions'][name] if snapshot else
                     (rows[0]['total']-len(rows) if rows else 0))
            return [r['id'] for r in rows],omitted

        artifact_ids,omitted_artifacts=identifiers('artifacts','artifact_id',12)
        proposal_ids,omitted_proposals=identifiers('proposals','proposal_id',20)
        assignment_ids,omitted_responsibilities=identifiers('assignments','assignment_id',8,
            ' AND responsibility_lifecycle IS NOT NULL',name='responsibilities')

        artifacts=[]; proposals=[]; responsibilities=[]; targets=[]
        remaining=32768
        def bounded(value):
            nonlocal remaining
            size=len(canonical(value).encode())
            if size>8192 or size>remaining: return None
            remaining-=size
            return value

        for aid in artifact_ids:
            row,scope=self._artifact(c,p,ws,aid)
            rev=self._revision(c,p,ws,row,scope)
            body=bounded(rev.body)
            artifacts.append(WorkAreaArtifact(artifact_id=aid,revision_id=rev.id,
                revision_number=rev.revision_number,body_hash=rev.body_hash,
                author_id=rev.author_id,author_kind=rev.author_kind,body=body,body_omitted=body is None))
            if body is not None and isinstance(body,(TableBody,ToolBody,Body,StructuredTableBody,CustomViewBody)):
                targets.append(ExactTarget(artifact_id=aid,revision_id=rev.id,body_hash=rev.body_hash))
        for pid in proposal_ids:
            proposal,row,_=self._proposal(c,p,ws,pid)
            # Defend the canonical conversation boundary even for malformed joins.
            if row.get('conversation_id')!=cv.id: deny()
            same=proposal.base_revision_id==row['current_revision_id']
            proposals.append(WorkAreaProposal(proposal_id=pid,artifact_id=proposal.artifact_id,
                base_revision_id=proposal.base_revision_id,base_work_version=proposal.base_work_version,
                body_hash=proposal.body_hash,status=proposal.status,accepted_revision_id=proposal.accepted_revision_id,
                base_is_current=same,stale=proposal.status=='pending' and not same))
        for aid in assignment_ids:
            a,_=self._responsibility_assignment(c,p,ws,aid)
            life=self._lifecycle(c,ws,aid)
            self._responsibility_observations(c,p,a,life.dependencies)
            material=bounded(life)
            projected=WorkAreaResponsibility(assignment_id=aid,work_version=a.work_version,
                owner_id=a.owner_id,lifecycle_sha256=digest(life),lifecycle=material,lifecycle_omitted=material is None)
            if snapshot and work_version is not None and cv.work_version==work_version+1:
                # offer() permits this version delta only for this run's exact
                # receipt-bound recording. The scheduler may have refreshed an
                # older waiting responsibility in response to that own mutation.
                # Preserve the input projection only when *nothing else* changed;
                # actual edits, controls, due events and authority changes still
                # invalidate the frozen context. Never rewrite stored history.
                prior=next(r for r in snapshot['responsibilities'] if r['assignment_id']==aid)
                before=prior.get('lifecycle')
                after=projected.model_dump(mode='json')['lifecycle']
                bookkeeping={'conversation_work_version','last_change_key'}
                if (before is not None and after is not None
                        and before['state'] in ('waiting_person','paused')
                        and prior['owner_id']==a.owner_id
                        and a.work_version==prior['work_version']+1
                        and before['conversation_work_version']==work_version
                        and after['conversation_work_version']==cv.work_version
                        and {k:v for k,v in before.items() if k not in bookkeeping}
                            =={k:v for k,v in after.items() if k not in bookkeeping}):
                    projected=WorkAreaResponsibility.model_validate(prior)
            responsibilities.append(projected)
        omissions=WorkAreaOmissions(artifacts=omitted_artifacts,proposals=omitted_proposals,
            responsibilities=omitted_responsibilities,saved_bodies=sum(a.body_omitted for a in artifacts),
            lifecycles=sum(a.lifecycle_omitted for a in responsibilities))
        return WorkAreaContext(conversation_id=cv.id,conversation_work_version=work_version or cv.work_version,
            purpose=cv.work_area,artifacts=artifacts,proposals=proposals,responsibilities=responsibilities,
            offered_targets=targets,omissions=omissions,truncated=any((omitted_artifacts,omitted_proposals,
                omitted_responsibilities,omissions.saved_bodies,omissions.lifecycles)))

    def create_work_area(self,p,ws,cmd):
        from .service import encoded
        def auth(c):
            for ref in sorted(cmd.selected_source_refs,key=lambda r:r.source_id):
                self._source(c,p,ws,ref)
        def mutate(c,_):
            for ref in cmd.selected_source_refs:
                self._source(c,p,ws,ref,True)
            cv=Conversation(id=new_id(),workspace_id=ws,owner_id=p.id,title=cmd.title,
                selected_source_refs=cmd.selected_source_refs,
                work_area=WorkAreaMetadata(title=cmd.title,goal=cmd.goal,kind=cmd.kind,origin='human'))
            c.execute('INSERT INTO conversations(workspace_id,id,data) VALUES (%s,%s,%s)',(ws,cv.id,encoded(cv)))
            for ref in cv.selected_source_refs:
                c.execute('INSERT INTO conversation_sources(workspace_id,conversation_id,source_id) VALUES (%s,%s,%s)',(ws,cv.id,ref.source_id))
            self._event(c,p,ws,'create_work_area',cv.id)
            return cv
        return self._command(p,ws,'create_work_area',{},cmd,Conversation,auth,mutate)

    def promote_work_area(self,p,ws,cid,cmd):
        def mutate(c,cv):
            self._conversation_cas(cv,cmd.expected_work_version)
            self._conversation(c,p,ws,cid,True)
            # Human scope changes supersede queued/in-flight work just like steering.
            self._cancel_conversation_runs(c,ws,cid)
            cv.work_area=WorkAreaMetadata(title=cmd.title,goal=cmd.goal,kind=cmd.kind,origin='human')
            cv.title=cmd.title
            cv.work_version+=1
            self._store_conversation(c,cv)
            self._event(c,p,ws,'promote_work_area',cid)
            return cv
        return self._command(p,ws,'promote_work_area',{'conversation_id':cid},cmd,Conversation,
            lambda c:self._conversation(c,p,ws,cid),mutate)

    def list_work_areas(self,p,ws,cursor=None,limit=25):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            rows=c.execute('''SELECT cv.id FROM conversations cv WHERE cv.workspace_id=%s AND cv.id>%s
                AND cv.data->'work_area' IS NOT NULL AND cv.data->'work_area'<>'null'::jsonb
                AND NOT EXISTS (SELECT 1 FROM conversation_sources s LEFT JOIN source_access g
                  ON g.workspace_id=s.workspace_id AND g.source_id=s.source_id AND g.principal_id=%s
                  JOIN sources src ON src.workspace_id=s.workspace_id AND src.id=s.source_id
                  WHERE s.workspace_id=cv.workspace_id AND s.conversation_id=cv.id
                  AND (g.active IS DISTINCT FROM true OR (src.data->>'available')::boolean IS DISTINCT FROM true))
                ORDER BY cv.id LIMIT %s''',(ws,cursor or '',p.id,limit+1)).fetchall()
            items=[self._conversation_preview(c,ws,self._conversation(c,p,ws,r['id'])) for r in rows[:limit]]
            return ConversationPage(items=items,next_cursor=items[-1].id if len(rows)>limit else None)

    def get_work_area(self,p,ws,cid):
        detail=self.get_conversation(p,ws,cid)
        if detail.conversation.work_area is None:
            deny()
        return detail

    def _identify_work_area(self,c,p,run,cv,identification):
        # Trusted parsed worker result, already capability/fence/source checked.
        # Never erase an earlier agent identification or any human metadata.
        if identification is not None and cv.work_area is None:
            cv.work_area=WorkAreaMetadata(**identification.model_dump(),origin='agent',identified_by_run_id=run.id)
            cv.title=identification.title
            cv.work_version+=1
            self._store_conversation(c,cv)
            self._event(c,p,run.workspace_id,'identify_work_area',cv.id)
