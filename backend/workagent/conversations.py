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


PRODUCT_PROFILE = 'general-products-controlled-v1'
PRODUCT_HASH = '6de411192661913bff7489b792cbd6dfb7e52421e9e18c3980bc2c7360f060ce'
LEGACY_IMPLEMENTATION = 'a8119955657d5158c04b7b7cbae10faf896736e60bb0424715d9fd5a9831c0ee'


def profile(name=PROFILE):
    from .general_responses import PROFILE as GENERAL, PROFILE_HASH as GENERAL_HASH
    if name==GENERAL:
        raw=PROFILE_PATH.with_name('general-responses-v1.json').read_bytes()
        if hashlib.sha256(raw).hexdigest()!=GENERAL_HASH: raise DomainError('unsupported_operation')
        return json.loads(raw)
    path = PROFILE_PATH if name==PROFILE else PROFILE_PATH.with_name('general-products-v1.json')
    expected = PROFILE_HASH if name==PROFILE else PRODUCT_HASH
    if name not in (PROFILE,PRODUCT_PROFILE):
        raise DomainError('unsupported_operation')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise DomainError('unsupported_operation')
    return json.loads(raw)


def implementation_hash():
    # Refuse an in-flight run after an unreviewed local implementation change.
    return hashlib.sha256(b''.join(Path(__file__).with_name(name).read_bytes()
        for name in ('conversations.py', 'general_worker.py', 'products.py', 'product_models.py', 'model_base.py', 'local_operations.py', 'wasm_tool.py'))).hexdigest()


def check_general_pins(c, run):
    if run.profile=='general-responses-v1':
        from .general_responses import check_pins
        return check_pins(c,run)
    from .service import digest
    data = c.execute('SELECT data,activation_id FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                     (run.workspace_id,run.id)).fetchone()
    expected = profile(run.profile)
    expected_hash = PROFILE_HASH if run.profile==PROFILE else PRODUCT_HASH
    impl = data['data'].get('implementation_hash') if data else None
    accepted_impl = (implementation_hash(),LEGACY_IMPLEMENTATION) if run.profile==PROFILE else (implementation_hash(),)
    if impl not in accepted_impl:
        raise DomainError('unsupported_operation')
    if (not data or data['activation_id'] != run.profile or
        data['data'] != {'profile': run.profile, 'bundle_hash': expected_hash,
                         'implementation_hash': impl, 'tools': expected['tools']} or
        run.bundle_hash != expected_hash or
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

    def _conversation_preview(self,c,ws,cv):
        messages=self._conversation_messages(c,ws,cv.id)
        cv.updated_at=messages[-1].created_at if messages else cv.created_at
        cv.last_message_preview=messages[-1].text[:240] if messages else None
        activation=c.execute("SELECT active FROM provider_grants WHERE workspace_id=%s AND data->>'profile'='general-responses-v1' AND data->'responses'->'conversation_ids' ? %s",(ws,cv.id)).fetchone()
        if activation:
            cv.execution_profile='general-responses-v1'
            cv.model_activation='active' if activation['active'] else 'revoked'
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
            items=[self._conversation_preview(c,ws,self._conversation(c,p,ws,r['id'])) for r in rows[:limit]]
            return ConversationPage(items=items,next_cursor=items[-1].id if len(rows)>limit else None)

    def get_conversation(self,p,ws,cid):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            cv=self._conversation(c,p,ws,cid)
            messages=self._conversation_messages(c,ws,cid)
            runs={r['id']:Run.model_validate(r['data']) for r in c.execute(
                'SELECT id,data FROM runs WHERE workspace_id=%s AND conversation_id=%s',(ws,cid)).fetchall()}
            assignments=c.execute('SELECT id FROM assignments WHERE workspace_id=%s AND conversation_id=%s ORDER BY id',(ws,cid)).fetchall()
            from .products import turn_state
            ordered=[runs[m.run_id] for m in messages if m.author_kind=='human']
            artifact_ids=[r['id'] for r in c.execute('SELECT id FROM artifacts WHERE workspace_id=%s AND conversation_id=%s ORDER BY id',(ws,cid)).fetchall()]
            return ConversationDetail(conversation=self._conversation_preview(c,ws,cv),messages=messages,artifact_ids=artifact_ids,turns=[turn_state(r,c) for r in ordered],
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
            from .general_responses import admission, PROFILE as GENERAL, PROFILE_HASH as GENERAL_HASH, consumer_hash
            grant=admission(self,c,p,ws,cv,cmd)
            selected=GENERAL if grant else PRODUCT_PROFILE if cmd.operation else PROFILE
            config=profile(selected)
            selected_hash=GENERAL_HASH if grant else PRODUCT_HASH if cmd.operation else PROFILE_HASH
            if cmd.operation:
                self._product_base(c,p,ws,cv,cmd.operation)
            messages=self._conversation_messages(c,ws,cid)
            # Reject oversized history before admission rather than leaving queued work with no executable context.
            from .service import canonical
            prospective={'messages':[m.model_dump(mode='json') for m in messages],
                         'next':cmd.model_dump(mode='json'),
                         'sources':[self._source(c,p,ws,ref,True)['content'] for ref in cv.selected_source_refs],
                         'tools':self.local_tool_registry() if cmd.operation else []}
            if len(canonical(prospective).encode())+4096>config['max_context_bytes']:
                raise DomainError('budget_exhausted')
            if sum(m.author_kind=='human' for m in messages)>=config['max_turns_per_conversation']:
                raise DomainError('budget_exhausted')
            self._cancel_conversation_runs(c,ws,cid)  # New steering supersedes unfinished responses, not messages.
            generation=c.execute('SELECT access_generation FROM workspaces WHERE id=%s',(ws,)).fetchone()['access_generation']
            run=Run(id=new_id(),workspace_id=ws,conversation_id=cid,principal_id=p.id,kind='conversation_turn',
                access_generation=generation,profile=selected,bundle_hash=selected_hash,tool_registry_hash=digest(config['tools']),
                execution=(ExecutionProvenance(mode='managed',profile=selected,model=grant.model,grant_id=grant.id) if grant else
                           ExecutionProvenance(mode='fixture',profile=selected,evidence_origin='controlled_transport')))
            c.execute('INSERT INTO runs(workspace_id,id,conversation_id,data) VALUES (%s,%s,%s,%s)',(ws,run.id,cid,encoded(run)))
            pinned={'profile':selected,'bundle_hash':selected_hash,
                    'implementation_hash':consumer_hash() if grant else implementation_hash(),'tools':config['tools']}
            if grant:
                pinned.update(grant_id=grant.id,model=grant.model,consumer_sha256=grant.consumer_sha256,
                    max_received_output_tokens=grant.max_received_output_tokens,responses=grant.responses.model_dump(mode='json'))
            c.execute('INSERT INTO run_configurations(workspace_id,run_id,activation_id,data) VALUES (%s,%s,%s,%s)',
                (ws,run.id,selected,encoded(pinned)))
            message=ConversationMessage(id=new_id(),conversation_id=cid,run_id=run.id,sequence=len(messages)+1,
                                        author_id=p.id,author_kind='human',text=cmd.text,evidence_origin='human',operation=cmd.operation,
                                        target=cmd.target,attachments=[MessageAttachment(**a.model_dump(),ref=new_id(),
                                            sha256=hashlib.sha256(a.content.encode()).hexdigest(),byte_length=len(a.content.encode())) for a in cmd.attachments])
            self._append_message(c,ws,message)
            cv.work_version+=1
            self._store_conversation(c,cv)
            self._event(c,p,ws,'post_message',run.id)
            if grant: cv=cv.model_copy(update={'execution_profile':GENERAL,'model_activation':'active'})
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
        if run.profile not in (PROFILE,PRODUCT_PROFILE,'general-responses-v1'):
            raise DomainError('unsupported_operation')
        messages=self._conversation_messages(c,run.workspace_id,cv.id)
        sources=[self._source(c,p,run.workspace_id,ref,True) for ref in cv.selected_source_refs]
        context={'profile':run.profile,'conversation_id':cv.id,'run_id':run.id,
                 'messages':[m.model_dump(mode='json',exclude={'operation'} if run.profile==PROFILE else set()) for m in messages],
                 'sources':[{'id':r['id'],'content':r['content']} for r in sources],
                 'tools':[] if run.profile==PROFILE else self.local_tool_registry()}
        if run.profile=='general-responses-v1':
            from .general_responses import exact_target, POLICY
            latest=next(m for m in messages if m.run_id==run.id and m.author_kind=='human')
            base=exact_target(self,c,p,run.workspace_id,cv,latest.target)
            from .general_schema import GeneralDecision
            context.update(instructions=POLICY,target_body=base.model_dump(mode='json') if base else None,
                           tools=[{'name':'choose_general_action','inputSchema':GeneralDecision.model_json_schema()}])
        else:
            # Do not change the canonical historical controlled context shape.
            for message in context['messages']:
                for field in ('attachments','target','model_receipt'): message.pop(field,None)
        if len(canonical(context).encode())>profile(run.profile)['max_context_bytes']:
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
        if len(result.results)!=1 or not isinstance(result.results[0],TextResult):
            raise DomainError('unsupported_operation')
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
