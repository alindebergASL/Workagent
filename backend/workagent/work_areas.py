"""Project/workflow Spaces are metadata on canonical conversations, not tenants.

All mutations run under the existing workspace lock, command replay and source
reauthorization boundary. Runs, artifacts and responsibilities remain canonical.
"""
from .models import (Conversation, ConversationPage, WorkAreaMetadata, new_id)
from .errors import deny


class WorkAreas:
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
