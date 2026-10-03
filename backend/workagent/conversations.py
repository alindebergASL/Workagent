"""Additive conversation operations on Service's existing authority and run ledger.

No second queue, turn state machine, credential path, or model/tool loop. New
conversation messages are immutable products; run state remains canonical.
"""
import hashlib
import json
from pathlib import Path

from .errors import DomainError, deny
from .models import *

PROFILE = 'general-controlled-v1'
PROFILE_HASH = 'dcd90d3d65afb2e1259f0badf7212b7bea8b1b647be1da540fb97967071e2eb4'
PROFILE_PATH = Path(__file__).resolve().parents[2] / 'runtime/general-b1-v1.json'


def profile():
    raw = PROFILE_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != PROFILE_HASH:
        raise DomainError('unsupported_operation')
    return json.loads(raw)


def implementation_hash():
    # Refuse an in-flight run after an unreviewed local implementation change.
    return hashlib.sha256(b''.join(Path(__file__).with_name(name).read_bytes()
        for name in ('conversations.py', 'general_worker.py'))).hexdigest()


def check_general_pins(c, run):
    from .service import digest
    data = c.execute('SELECT data,activation_id FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                     (run.workspace_id,run.id)).fetchone()
    expected = profile()
    if (not data or data['activation_id'] != PROFILE or
        data['data'] != {'profile': PROFILE, 'bundle_hash': PROFILE_HASH,
                         'implementation_hash': implementation_hash(), 'tools': expected['tools']} or
        run.profile != PROFILE or run.bundle_hash != PROFILE_HASH or
        run.tool_registry_hash != digest(expected['tools']) or run.budget_units != 1):
        raise DomainError('unsupported_operation')


class Conversations:
    def _conversation(self,c,p,ws,cid,versions=False):
        row=c.execute('SELECT data FROM conversations WHERE workspace_id=%s AND id=%s',(ws,cid)).fetchone()
        if not row:
            deny()
        cv=Conversation.model_validate(row['data'])
        for ref in sorted(cv.selected_source_refs,key=lambda r:r.source_id):
            self._source(c,p,ws,ref,versions)
        return cv

    def _store_conversation(self,c,cv):
        from .service import encoded
        c.execute('UPDATE conversations SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(cv),cv.workspace_id,cv.id))

    def _conversation_cas(self,cv,expected):
        if cv.work_version != expected:
            raise DomainError('version_conflict',current_version=cv.work_version)
        if cv.state != 'open':
            raise DomainError('action_unresolved')

    def _conversation_messages(self,c,ws,cid):
        return [ConversationMessage.model_validate(r['data']) for r in c.execute(
            'SELECT data FROM conversation_messages WHERE workspace_id=%s AND conversation_id=%s ORDER BY sequence',
            (ws,cid)).fetchall()]

    def _append_message(self,c,ws,message):
        from .service import encoded
        c.execute('''INSERT INTO conversation_messages(workspace_id,conversation_id,id,run_id,sequence,author_kind,data)
                     VALUES (%s,%s,%s,%s,%s,%s,%s)''',
                  (ws,message.conversation_id,message.id,message.run_id,message.sequence,message.author_kind,encoded(message)))

    def create_conversation(self,p,ws,cmd):
        from .service import encoded
        def auth(c):
            for ref in sorted(cmd.selected_source_refs,key=lambda r:r.source_id):
                self._source(c,p,ws,ref)
        def mutate(c,_):
            for ref in sorted(cmd.selected_source_refs,key=lambda r:r.source_id):
                self._source(c,p,ws,ref,True)
            cv=Conversation(id=new_id(),workspace_id=ws,owner_id=p.id,title=cmd.title,selected_source_refs=cmd.selected_source_refs)
            c.execute('INSERT INTO conversations(workspace_id,id,data) VALUES (%s,%s,%s)',(ws,cv.id,encoded(cv)))
            for ref in cv.selected_source_refs:
                c.execute('INSERT INTO conversation_sources(workspace_id,conversation_id,source_id) VALUES (%s,%s,%s)',(ws,cv.id,ref.source_id))
            self._event(c,p,ws,'create_conversation',cv.id)
            return cv
        return self._command(p,ws,'create_conversation',{},cmd,Conversation,auth,mutate)

    def list_conversations(self,p,ws,cursor=None,limit=25):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            rows=c.execute('''SELECT cv.id FROM conversations cv WHERE cv.workspace_id=%s AND cv.id>%s
                AND NOT EXISTS (SELECT 1 FROM conversation_sources s LEFT JOIN source_access g
                  ON g.workspace_id=s.workspace_id AND g.source_id=s.source_id AND g.principal_id=%s
                  JOIN sources src ON src.workspace_id=s.workspace_id AND src.id=s.source_id
                  WHERE s.workspace_id=cv.workspace_id AND s.conversation_id=cv.id
                  AND (g.active IS DISTINCT FROM true OR (src.data->>'available')::boolean IS DISTINCT FROM true))
                ORDER BY cv.id LIMIT %s''',(ws,cursor or '',p.id,limit+1)).fetchall()
            items=[self._conversation(c,p,ws,r['id']) for r in rows[:limit]]
            return ConversationPage(items=items,next_cursor=items[-1].id if len(rows)>limit else None)

    def get_conversation(self,p,ws,cid):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            cv=self._conversation(c,p,ws,cid)
            messages=self._conversation_messages(c,ws,cid)
            runs={r['id']:Run.model_validate(r['data']) for r in c.execute(
                'SELECT id,data FROM runs WHERE workspace_id=%s AND conversation_id=%s',(ws,cid)).fetchall()}
            assignments=c.execute('SELECT id FROM assignments WHERE workspace_id=%s AND conversation_id=%s ORDER BY id',(ws,cid)).fetchall()
            return ConversationDetail(conversation=cv,messages=messages,
                runs=[runs[m.run_id] for m in messages if m.author_kind=='human'],assignment_ids=[r['id'] for r in assignments])

    def _cancel_conversation_runs(self,c,ws,cid):
        from .outcomes import acknowledge
        for row in c.execute('SELECT data FROM runs WHERE workspace_id=%s AND conversation_id=%s',(ws,cid)).fetchall():
            run=Run.model_validate(row['data'])
            if run.state in ('queued','running'):
                run.state='cancelled'; run.fence+=1; run.lease_expires_at=None
                self._store_run(c,run)
                acknowledge(c,ws,run.id)

    def post_message(self,p,ws,cid,cmd):
        from .service import digest, encoded
        def mutate(c,cv):
            self._conversation_cas(cv,cmd.expected_work_version)
            self._conversation(c,p,ws,cid,True)
            config=profile()
            messages=self._conversation_messages(c,ws,cid)
            if sum(m.author_kind=='human' for m in messages)>=config['max_turns_per_conversation']:
                raise DomainError('budget_exhausted')
            self._cancel_conversation_runs(c,ws,cid)  # New steering supersedes unfinished responses, not messages.
            generation=c.execute('SELECT access_generation FROM workspaces WHERE id=%s',(ws,)).fetchone()['access_generation']
            run=Run(id=new_id(),workspace_id=ws,conversation_id=cid,principal_id=p.id,kind='conversation_turn',
                access_generation=generation,profile=PROFILE,bundle_hash=PROFILE_HASH,tool_registry_hash=digest(config['tools']),
                execution=ExecutionProvenance(mode='fixture',profile=PROFILE,evidence_origin='controlled_transport'))
            c.execute('INSERT INTO runs(workspace_id,id,conversation_id,data) VALUES (%s,%s,%s,%s)',(ws,run.id,cid,encoded(run)))
            c.execute('INSERT INTO run_configurations(workspace_id,run_id,activation_id,data) VALUES (%s,%s,%s,%s)',
                (ws,run.id,PROFILE,encoded({'profile':PROFILE,'bundle_hash':PROFILE_HASH,
                                          'implementation_hash':implementation_hash(),'tools':config['tools']})))
            message=ConversationMessage(id=new_id(),conversation_id=cid,run_id=run.id,sequence=len(messages)+1,
                                        author_id=p.id,author_kind='human',text=cmd.text,evidence_origin='human')
            self._append_message(c,ws,message)
            cv.work_version+=1
            self._store_conversation(c,cv)
            self._event(c,p,ws,'post_message',run.id)
            return MessageQueued(conversation=cv,message=message,run=run)
        return self._command(p,ws,'post_message',{'conversation_id':cid},cmd,MessageQueued,
                             lambda c:self._conversation(c,p,ws,cid),mutate)

    def cancel_conversation(self,p,ws,cid,cmd):
        def mutate(c,cv):
            self._conversation_cas(cv,cmd.expected_work_version)
            self._cancel_conversation_runs(c,ws,cid)
            cv.state='cancelled'; cv.work_version+=1
            self._store_conversation(c,cv)
            self._event(c,p,ws,'cancel_conversation',cid)
            return cv
        return self._command(p,ws,'cancel_conversation',{'conversation_id':cid},cmd,Conversation,
                             lambda c:self._conversation(c,p,ws,cid),mutate)

    def delegate_conversation(self,p,ws,cid,cmd):
        from .service import encoded
        def mutate(c,cv):
            self._conversation_cas(cv,cmd.expected_work_version)
            self._conversation(c,p,ws,cid,True)
            a=Assignment(id=new_id(),workspace_id=ws,conversation_id=cid,owner_id=p.id,goal=cmd.goal,
                completion_criteria=cmd.completion_criteria,selected_source_refs=cv.selected_source_refs,state='paused',
                unresolved=['Delegation recorded; autonomous execution is not supported by B1. Resume is disabled.'])
            c.execute('INSERT INTO assignments(workspace_id,id,conversation_id,data) VALUES (%s,%s,%s,%s)',(ws,a.id,cid,encoded(a)))
            for ref in a.selected_source_refs:
                c.execute('INSERT INTO assignment_sources(workspace_id,assignment_id,source_id) VALUES (%s,%s,%s)',(ws,a.id,ref.source_id))
            cv.work_version+=1
            self._store_conversation(c,cv)
            self._event(c,p,ws,'delegate_conversation',a.id)
            return a
        return self._command(p,ws,'delegate_conversation',{'conversation_id':cid},cmd,Assignment,
                             lambda c:self._conversation(c,p,ws,cid),mutate)

    def _general_context(self,c,cap):
        from .service import canonical, digest, encoded
        p,run,cv=self._check_capability(c,cap)
        if run.profile!=PROFILE:
            raise DomainError('unsupported_operation')
        messages=self._conversation_messages(c,run.workspace_id,cv.id)
        sources=[self._source(c,p,run.workspace_id,ref,True) for ref in cv.selected_source_refs]
        context={'profile':PROFILE,'conversation_id':cv.id,'run_id':run.id,
                 'messages':[m.model_dump(mode='json') for m in messages],
                 'sources':[{'id':r['id'],'content':r['content']} for r in sources], 'tools':[]}
        if len(canonical(context).encode())>profile()['max_context_bytes']:
            raise DomainError('budget_exhausted')
        observation={'context_sha256':digest(context),'source_manifest':[{'id':r['id'],'sha256':digest(r['content'])} for r in sources]}
        previous=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(run.workspace_id,run.id)).fetchone()
        if previous and previous['data']!=observation:
            raise DomainError('source_changed')
        if not previous:
            c.execute('INSERT INTO run_contexts(workspace_id,run_id,data) VALUES (%s,%s,%s)',(run.workspace_id,run.id,encoded(observation)))
        return context

    def conversation_worker_context(self,cap):
        with self.db.transaction() as c:
            return self._general_context(c,cap)

    def complete_conversation_turn(self,cap,result):
        """Trusted fenced worker seam. No HTTP/model tool exposes this operation."""
        from .outcomes import acknowledge
        # Validate, not model_construct/model_copy: reject caller-supplied origin/authority.
        result=TurnResult.model_validate(result.model_dump() if isinstance(result,TurnResult) else result)
        with self.db.transaction() as c:
            p,run,cv=self._check_capability(c,cap,allow_completed=True)
            if run.profile!=PROFILE:
                raise DomainError('unsupported_operation')
            messages=self._conversation_messages(c,run.workspace_id,cv.id)
            existing=next((m for m in messages if m.run_id==run.id and m.author_kind=='assistant'),None)
            if existing:
                if existing.result!=result:
                    raise DomainError('command_conflict')
                acknowledge(c,run.workspace_id,run.id)
                return run
            self._general_context(c,cap)
            message=ConversationMessage(id=new_id(),conversation_id=cv.id,run_id=run.id,sequence=len(messages)+1,
                author_id='general-worker',author_kind='assistant',text=result.results[0].text,
                result=result,evidence_origin='controlled_transport')
            self._append_message(c,run.workspace_id,message)
            run.state='ready'; run.used_units+=1; run.lease_expires_at=None
            self._store_run(c,run)
            self._event(c,p,run.workspace_id,'complete_run',run.id)
            acknowledge(c,run.workspace_id,run.id)
            return run
