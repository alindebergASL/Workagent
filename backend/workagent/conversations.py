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
        # Baseline manifests remain immutable historical receipts. The pinned
        # consumer implementation admits this explicit additive capability.
        effective=json.loads(raw)
        effective['tools']=[*effective['tools'],'publish_artifact']
        return effective
    path = PROFILE_PATH if name==PROFILE else PROFILE_PATH.with_name('general-products-v1.json')
    expected = PROFILE_HASH if name==PROFILE else PRODUCT_HASH
    if name not in (PROFILE,PRODUCT_PROFILE):
        raise DomainError('unsupported_operation')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise DomainError('unsupported_operation')
    effective=json.loads(raw)
    if name==PRODUCT_PROFILE:
        effective['tools']=[*effective['tools'],'publish_artifact']
        effective['result_kinds']=[*effective['result_kinds'],'document','structured_table','custom_view']
    return effective


def implementation_hash():
    # Refuse an in-flight run after an unreviewed local implementation change.
    return hashlib.sha256(b''.join(Path(__file__).with_name(name).read_bytes()
        for name in ('document_models.py', 'document_sandbox.py', 'document_parser.py', 'documents.py', 'composition.py', 'proposal_review.py', 'general_schema.py', 'work_areas.py', 'models.py', 'conversations.py', 'general_worker.py', 'products.py', 'product_models.py', 'flexible_models.py', 'flexible_work.py', 'model_base.py', 'local_operations.py', 'wasm_tool.py'))).hexdigest()


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

    def _conversation_preview(self,c,ws,cv,p=None):
        messages=self._conversation_messages(c,ws,cv.id)
        cv.updated_at=messages[-1].created_at if messages else cv.created_at
        cv.last_message_preview=messages[-1].text[:240] if messages else None
        from .general_responses import scope_predicate
        predicate=scope_predicate(c,'g','%s')
        activation=c.execute(f"SELECT active FROM provider_grants g WHERE workspace_id=%s AND principal_id=%s AND data->>'profile'='general-responses-v1' AND {predicate} ORDER BY active DESC,id LIMIT 1",(ws,p.id if p else cv.owner_id,cv.id)).fetchone()
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
            items=[self._conversation_preview(c,ws,self._conversation(c,p,ws,r['id']),p) for r in rows[:limit]]
            return ConversationPage(items=items,next_cursor=items[-1].id if len(rows)>limit else None)

    def get_conversation(self,p,ws,cid):
        with self.db.transaction() as c:
            self._scope(c,p,ws)
            cv=self._conversation(c,p,ws,cid)
            messages=self._conversation_messages(c,ws,cid)
            for message in messages:
                self._message_documents(c,p,ws,cid,message.document_refs)
            runs={r['id']:Run.model_validate(r['data']) for r in c.execute(
                'SELECT id,data FROM runs WHERE workspace_id=%s AND conversation_id=%s',(ws,cid)).fetchall()}
            assignments=c.execute('SELECT id FROM assignments WHERE workspace_id=%s AND conversation_id=%s ORDER BY id',(ws,cid)).fetchall()
            from .products import turn_state
            ordered=[runs[m.run_id] for m in messages if m.author_kind in ('human','system')]
            artifact_ids=[r['id'] for r in c.execute('''SELECT a.id FROM artifacts a
                WHERE a.workspace_id=%s AND a.conversation_id=%s
                AND NOT EXISTS (SELECT 1 FROM workspace_files f WHERE f.workspace_id=a.workspace_id
                    AND f.artifact_id=a.id AND f.owner_id<>%s) ORDER BY a.id''',(ws,cid,p.id)).fetchall()]
            from .original_attachments import projection as attachment_projection
            return ConversationDetail(attachment_context=attachment_projection(c,ws,messages),conversation=self._conversation_preview(c,ws,cv,p),messages=messages,artifact_ids=artifact_ids,turns=[turn_state(r,c) for r in ordered],
                runs=[runs[m.run_id] for m in messages if m.author_kind in ('human','system')],assignment_ids=[r['id'] for r in assignments])

    def _cancel_conversation_runs(self,c,ws,cid):
        from .outcomes import acknowledge
        for row in c.execute('SELECT data FROM runs WHERE workspace_id=%s AND conversation_id=%s',(ws,cid)).fetchall():
            run=Run.model_validate(row['data'])
            if run.state in ('queued','running'):
                run.state='cancelled'; run.fence+=1; run.lease_expires_at=None
                self._store_run(c,run)
                acknowledge(c,ws,run.id)

    def post_message(self,p,ws,cid,cmd):
        def authorize(c):
            cv=self._conversation(c,p,ws,cid)
            self._message_documents(c,p,ws,cid,cmd.document_refs)
            return cv
        return self._command(p,ws,'post_message',{'conversation_id':cid},cmd,MessageQueued,
            authorize,
            lambda c,cv:self._admit_conversation_turn(c,p,ws,cv,cmd))

    def _admit_conversation_turn(self,c,p,ws,cv,cmd,*,responsibility=None,required_grant_id=None,
                                 continuation=None,retained_message=None,queued_intent=None):
        from .service import digest, encoded
        cid=cv.id
        document_refs=self._message_documents(c,p,ws,cid,cmd.document_refs)
        self._conversation_cas(cv,cmd.expected_work_version)
        self._conversation(c,p,ws,cid,True)
        from .general_responses import admission, PROFILE as GENERAL, PROFILE_HASH as GENERAL_HASH, consumer_hash
        try:
            grant=admission(self,c,p,ws,cv,cmd,human_steering=responsibility is None and continuation is None and queued_intent is None)
        except DomainError as exc:
            from .general_responses import has_unresolved_attempt
            if responsibility is not None and exc.code.value=='action_unresolved' and has_unresolved_attempt(c,ws,cid):
                from .responsibility_execution import ContinuationAdmissionPending
                raise ContinuationAdmissionPending() from exc
            raise
        if responsibility is not None:
            if (p.kind != 'worker' or grant is None or grant.id != required_grant_id
                or getattr(grant.responses, 'runtime_extension', None) != 'general-alpha-v1'):
                raise DomainError('action_unresolved')
            from .responsibility_execution import check_admission_budget
            check_admission_budget(c,grant)
        selected=GENERAL if grant else PRODUCT_PROFILE if cmd.operation else PROFILE
        config=profile(selected)
        selected_hash=GENERAL_HASH if grant else PRODUCT_HASH if cmd.operation else PROFILE_HASH
        if cmd.operation:
            self._product_base(c,p,ws,cv,cmd.operation)
        messages=self._conversation_messages(c,ws,cid)
        # Reject oversized history before admission rather than leaving queued work with no executable context.
        from .service import canonical
        prior_messages=[m.model_dump(mode='json') for m in messages]
        from .documents import project_message_documents
        for message in prior_messages:
            project_message_documents(message)
        prospective={'messages':prior_messages,
                     'next':cmd.model_dump(mode='json'),
                     'sources':[self._source(c,p,ws,ref,True)['content'] for ref in cv.selected_source_refs],
                     'tools':self.local_tool_registry() if cmd.operation else []}
        from .general_responses import standing
        bounded=False
        if grant is not None:
            # Controlled fixture turns must not import provider transport/schema code.
            from .retained_results import enabled as retained_enabled
            bounded=standing(grant.responses) or retained_enabled({'responses':grant.responses.model_dump(mode='json')})
        if not bounded and responsibility is None and len(canonical(prospective).encode())+4096>config['max_context_bytes']:
            raise DomainError('budget_exhausted')
        if not bounded and sum(m.author_kind in ('human','system') for m in messages)>=config['max_turns_per_conversation']:
            raise DomainError('budget_exhausted')
        if responsibility is None and continuation is None and queued_intent is None:
            self._cancel_conversation_runs(c,ws,cid)  # Only human steering supersedes other work.
        generation=c.execute('SELECT access_generation FROM workspaces WHERE id=%s',(ws,)).fetchone()['access_generation']
        run=Run(id=new_id(),workspace_id=ws,conversation_id=cid,principal_id=p.id,kind='conversation_turn',
            access_generation=generation,profile=selected,bundle_hash=selected_hash,tool_registry_hash=digest(config['tools']),
            execution=(ExecutionProvenance(mode='managed',profile=selected,model=grant.model,grant_id=grant.id) if grant else
                       ExecutionProvenance(mode='fixture',profile=selected,evidence_origin='controlled_transport')))
        c.execute('INSERT INTO runs(workspace_id,id,conversation_id,data) VALUES (%s,%s,%s,%s)',(ws,run.id,cid,encoded(run)))
        pinned={'profile':selected,'bundle_hash':selected_hash,
                'implementation_hash':grant.consumer_sha256 if grant else implementation_hash(),'tools':config['tools']}
        if grant:
            pinned.update(grant_id=grant.id,model=grant.model,consumer_sha256=grant.consumer_sha256,
                max_received_output_tokens=grant.max_received_output_tokens,responses=grant.responses.model_dump(mode='json'))
        if grant and getattr(grant.responses,'runtime_extension',None)=='general-alpha-v1':
            from .evidence_context import VERSION
            pinned['evidence_context_version']=VERSION
        if responsibility is not None:
            pinned['responsibility']=responsibility.model_dump(mode='json')
        if continuation is not None:
            pinned['continuation']=continuation
        if queued_intent is not None:
            pinned['queued_intent']=queued_intent
        c.execute('INSERT INTO run_configurations(workspace_id,run_id,activation_id,data) VALUES (%s,%s,%s,%s)',
            (ws,run.id,selected,encoded(pinned)))
        message=ConversationMessage(id=new_id(),conversation_id=cid,run_id=run.id,sequence=len(messages)+1,
                                    author_id='responsibility-runtime' if responsibility else p.id,
                                    author_kind='system' if responsibility else 'human',text=cmd.text,
                                    evidence_origin='runtime' if responsibility else 'human',operation=cmd.operation,
                                    responsibility_origin=(ResponsibilityOrigin(assignment_id=responsibility.assignment_id,
                                        wake_id=responsibility.wake_id,work_version=responsibility.work_version) if responsibility else None),
                                    acceptance_checks=cmd.acceptance_checks,
                                    document_refs=document_refs,target=cmd.target,attachments=[MessageAttachment(**a.model_dump(),ref=new_id(),
                                        sha256=hashlib.sha256(a.content.encode()).hexdigest(),byte_length=len(a.content.encode())) for a in cmd.attachments])
        if retained_message is not None:
            # Same immutable human/runtime intent and attachment identities, not a
            # new model-authored request. The configuration retains its provenance.
            message=retained_message.model_copy(update={'id':message.id,'run_id':run.id,
                'sequence':message.sequence,'created_at':message.created_at})
        self._append_message(c,ws,message)
        # Opted-in file/compute conversations expose the original attachment as
        # an immutable file, not a copied draft or implicit execution grant.
        if grant and retained_message is None and message.author_kind == 'human' and p.id == cv.owner_id:
            from .capabilities.file_composition import enabled as files_enabled
            if files_enabled(pinned):
                from .source_snapshots import retain_attachments
                retain_attachments(self,c,p,ws,cv,message)
        if responsibility is None and continuation is None and queued_intent is None:
            cv.work_version+=1
            self._store_conversation(c,cv)
        if (bounded or document_refs) and responsibility is None and continuation is None:
            # Validate the exact bounded context in the admission transaction.
            # Oversized current intent rolls back rather than being truncated.
            self._materialize_general_context(c,p,run,cv)
        self._event(c,p,ws,'post_message' if responsibility is None and continuation is None else 'responsibility_run_queued',run.id)
        if grant: cv=cv.model_copy(update={'execution_profile':GENERAL,'model_activation':'active'})
        return MessageQueued(conversation=cv,message=message,run=run)

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
        def mutate(c,cv):
            return self._delegate_conversation(c,p,cv,cmd.expected_work_version,cmd.goal,cmd.completion_criteria)
        return self._command(p,ws,'delegate_conversation',{'conversation_id':cid},cmd,Assignment,
                             lambda c:self._conversation(c,p,ws,cid),mutate)

    def _delegate_conversation(self,c,p,cv,expected_work_version,goal,completion_criteria):
        """Transaction-local shared delegation; caller owns commit and authority."""
        from .service import encoded
        ws,cid=cv.workspace_id,cv.id
        self._conversation_cas(cv,expected_work_version)
        self._conversation(c,p,ws,cid,True)
        a=Assignment(id=new_id(),workspace_id=ws,conversation_id=cid,owner_id=p.id,goal=goal,
            completion_criteria=completion_criteria,selected_source_refs=cv.selected_source_refs,state='paused',
            unresolved=['Delegation recorded; autonomous execution is not supported by B1. Resume is disabled.'])
        c.execute('INSERT INTO assignments(workspace_id,id,conversation_id,data) VALUES (%s,%s,%s,%s)',(ws,a.id,cid,encoded(a)))
        for ref in a.selected_source_refs:
            c.execute('INSERT INTO assignment_sources(workspace_id,assignment_id,source_id) VALUES (%s,%s,%s)',(ws,a.id,ref.source_id))
        cv.work_version+=1
        self._store_conversation(c,cv)
        self._event(c,p,ws,'delegate_conversation',a.id)
        return a

    def _validate_general_context(self,c,cap):
        """Validate frozen authority and every own addition, without projecting it."""
        from .service import digest, encoded
        p,run,cv=self._check_capability(c,cap)
        materials=self._own_new_drafts(c,p,run,cv) if run.profile=='general-responses-v1' else []
        own=[m['artifact_id'] for m in materials]
        context,sources=self._materialize_general_context(c,p,run,cv,exclude_artifacts=own)
        observation={'context_sha256':digest(context),'source_manifest':[{'id':r['id'],'sha256':digest(r['content'])} for r in sources]}
        if 'work_area_context' in context:
            observation['work_area_context']=context['work_area_context']
        if 'work_context_index' in context:
            observation['work_context_index']=context['work_context_index']
        if 'document_context' in context:
            observation['document_context']=context['document_context']
        if 'evidence_context' in context:
            observation['evidence_context']=context['evidence_context']
        if 'memory_manifest' in context:
            observation['memory_manifest']=context['memory_manifest']
        previous=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(run.workspace_id,run.id)).fetchone()
        if own and not previous:
            raise DomainError('source_changed')
        if previous and previous['data']!=observation:
            raise DomainError('source_changed')
        if not previous:
            for item in context.get('document_context',{}).get('items',[]):
                self._event(c,p,run.workspace_id,'read_document_context',item['document_id'])
            c.execute('INSERT INTO run_contexts(workspace_id,run_id,data) VALUES (%s,%s,%s)',(run.workspace_id,run.id,encoded(observation)))
        return p,run,cv,context,materials

    def _general_context(self,c,cap,*,request_projection=False):
        """Authority callers also validate additions; only new requests need packing.

        In particular lease reclamation must succeed before a worker can settle
        an oversized projection against its new fenced capability.
        """
        p,run,cv,context,materials=self._validate_general_context(c,cap)
        own=[m['artifact_id'] for m in materials]
        if own:
            context['published_preparations']=materials
            # Baseline above stays byte-for-byte frozen. Only this run's verified
            # additions are projected for the next step, never arbitrary new work.
            from .general_responses import check_pins
            config=check_pins(c,run)
            if not config.get('responsibility') and 'work_area_context' in context:
                from copy import deepcopy
                from .responsibility_action import offer
                latest=next(m for m in self._conversation_messages(c,run.workspace_id,cv.id)
                            if m.run_id==run.id and m.author_kind=='human')
                context['responsibility_offer']=offer(c,run,cv,latest,config)
                snapshot=deepcopy(context['work_area_context'])
                known={a['artifact_id'] for a in snapshot['artifacts']}
                additions=[a for a in own if a not in known]
                room=max(0,12-len(known))
                snapshot['artifacts'] += [{'artifact_id':a} for a in additions[:room]]
                snapshot['omissions']['artifacts']+=len(additions[room:])
                projection=self._work_area_context(c,p,run.workspace_id,cv,snapshot=snapshot,
                    work_version=context['responsibility_offer']['conversation_work_version']).model_dump(mode='json')
                # New work is discoverable; same-turn revisions still require
                # the existing discovery + complete-read SQL authorization.
                projection['offered_targets']=context['work_area_context']['offered_targets']
                context['work_area_context']=projection
                # Bindable references use the same validated current revisions.
                for item in projection['artifacts']:
                    body=item['body']
                    if item['artifact_id'] in own and body and ('blocks' in body or body.get('kind')=='structured_table'):
                        context['bindable_artifacts'].append({**{k:item[k] for k in ('artifact_id','revision_id','body_hash')},'title':body['title']})
            # Pack optional history with the verified additions already present.
            # Re-read the full message pool so omission counts remain truthful;
            # never re-pack an already shortened history as if it were complete.
            if request_projection and 'history_window' in context and not config.get('responsibility'):
                from .conversation_context import bound_context
                context['messages']=[m.model_dump(mode='json',exclude={'acceptance_checks'})
                    for m in self._conversation_messages(c,run.workspace_id,cv.id)]
                bound_context(context,run.id,profile(run.profile)['max_context_bytes'])
            from .service import canonical
            if request_projection and len(canonical(context).encode())>profile(run.profile)['max_context_bytes']:
                raise DomainError('budget_exhausted')
        if request_projection and run.profile=='general-responses-v1':
            from .retained_results import enabled as retained_enabled, references, descriptor
            from .general_responses import check_pins
            config=check_pins(c,run)
            from .capabilities.research_composition import enabled as research_enabled
            if research_enabled(config):
                from .research import project as project_research
                project_research(self,c,p,run,cv,context,include_own=True)
            if retained_enabled(config):
                context['retained_results']=references(self,c,p,run,cv)
                context['continuation']=config.get('continuation')
                context.get('composition',{}).get('capabilities',[]).append({k:v for k,v in descriptor().items() if k!='input_schema'})
                from .original_attachments import descriptor as attachment_descriptor
                context.get('composition',{}).get('capabilities',[]).append({k:v for k,v in attachment_descriptor().items() if k!='input_schema'})
                from .service import canonical
                while context['retained_results'] and len(canonical(context).encode())>profile(run.profile)['max_context_bytes']:
                    context['retained_results'].pop()
                if len(canonical(context).encode())>profile(run.profile)['max_context_bytes']:
                    raise DomainError('budget_exhausted')
        return context

    def _materialize_general_context(self,c,p,run,cv,*,exclude_artifacts=()):
        """Shared exact context and bounds, without claiming or observing a run."""
        from .service import canonical
        if run.profile not in (PROFILE,PRODUCT_PROFILE,'general-responses-v1'):
            raise DomainError('unsupported_operation')
        messages=self._conversation_messages(c,run.workspace_id,cv.id)
        sources=[self._source(c,p,run.workspace_id,ref,True) for ref in cv.selected_source_refs]
        context={'profile':run.profile,'conversation_id':cv.id,'run_id':run.id,
                 'messages':[m.model_dump(mode='json',exclude={'acceptance_checks','operation'} if run.profile==PROFILE else {'acceptance_checks'}) for m in messages],
                 'sources':[{'id':r['id'],'content':r['content']} for r in sources],
                 # Live profiles replace this field below. Do not regenerate a
                 # discarded local registry on every authority recheck.
                 'tools':self.local_tool_registry() if run.profile==PRODUCT_PROFILE else []}
        if cv.work_area is not None:
            context['work_area']=cv.work_area.model_dump(mode='json')
        if run.profile=='general-responses-v1':
            from .general_responses import exact_target
            from .adaptive import contract
            from .models import ProviderGrant
            latest=next(m for m in messages if m.run_id==run.id and m.author_kind in ('human','system'))
            base=exact_target(self,c,p,run.workspace_id,cv,latest.target)
            config=check_general_pins(c,run)
            grant=ProviderGrant.model_validate(c.execute('SELECT data FROM provider_grants WHERE id=%s',(config['grant_id'],)).fetchone()['data'])
            policy,schema=contract(grant.responses)
            from .composition import enabled as alpha_enabled, context_catalog
            alpha=alpha_enabled(config)
            context.update(instructions=policy,target_body=base.model_dump(mode='json') if base else None,
                           tools=[{'name':'choose_general_action'}] if alpha else
                           [{'name':'choose_general_action','inputSchema':schema.model.model_json_schema()}])
            if alpha:
                from .responsibility_action import offer
                from .composition import continuity_enabled
                context['composition']=context_catalog(continuity_enabled(config))
                context['responsibility_offer']=offer(c,run,cv,latest,config,exclude_artifacts=exclude_artifacts)
            context['access_generation']=run.access_generation
            if config.get('responsibility'):
                context['messages']=[m for m in context['messages'] if m['run_id']==run.id]
                context['sources']=[]
                sources=[]
                context['responsibility']=config['responsibility']
                from .composition import continuity_enabled
                if continuity_enabled(config):
                    from .responsibility_execution import durable_context
                    context['durable_work']=durable_context(c,run,latest,config['responsibility'])
                    steering=next((m for m in reversed(messages) if m.author_kind=='human' and m.sequence<latest.sequence),None)
                    if steering:
                        context['durable_work']['latest_human_steering']={'message_id':steering.id,'text':steering.text}
                context['dependencies']=[]
                for dep in config['responsibility']['observations']:
                    if dep['kind']=='artifact_revision':
                        material=c.execute('SELECT data FROM revisions WHERE workspace_id=%s AND artifact_id=%s AND id=%s',
                            (run.workspace_id,dep['object_id'],dep['observed_version'])).fetchone()['data']['body']
                    else:
                        material=c.execute('SELECT content FROM sources WHERE workspace_id=%s AND id=%s',
                            (run.workspace_id,dep['object_id'])).fetchone()['content']
                    context['dependencies'].append({'binding':dep,'content':material})
            context['bindable_artifacts']=[{'artifact_id':r['artifact_id'],'revision_id':r['id'],
                'body_hash':r['data']['body_hash'],'title':r['data']['body']['title']}
                for r in c.execute('''SELECT rev.* FROM artifacts art JOIN revisions rev
                    ON rev.workspace_id=art.workspace_id AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
                    WHERE art.workspace_id=%s AND art.conversation_id=%s AND NOT (art.id=ANY(%s))
                    AND (rev.data->'body'->>'kind'='structured_table' OR rev.data->'body' ? 'blocks')
                    ORDER BY art.id LIMIT 20''',(run.workspace_id,cv.id,list(exclude_artifacts))).fetchall()]
            if config.get('responsibility'):
                permitted={d['object_id'] for d in config['responsibility']['observations'] if d['kind']=='artifact_revision'}
                context['bindable_artifacts']=[a for a in context['bindable_artifacts'] if a['artifact_id'] in permitted]
        else:
            # Do not change the canonical historical controlled context shape.
            for message in context['messages']:
                for field in ('attachments','target','model_receipt'): message.pop(field,None)
        latest=next(m for m in messages if m.run_id==run.id and m.author_kind in ('human','system'))
        documents=self._document_context(c,p,run,cv,messages,latest,
            config=config if run.profile=='general-responses-v1' else {},context=context)
        if documents is not None:
            context['document_context']=documents
            from .documents import project_message_documents
            for message in context['messages']:
                project_message_documents(message)
        if latest.author_kind=='human' and run.profile=='general-responses-v1':
            previous=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                (run.workspace_id,run.id)).fetchone()
            snapshot=previous['data'].get('work_area_context') if previous else None
            # Receipt-bound own recording normalizes only its exact version delta;
            # offer() validates the assignment version/state before doing so.
            version=context.get('responsibility_offer',{}).get('conversation_work_version',cv.work_version)
            context['work_area_context']=self._work_area_context(c,p,run.workspace_id,cv,
                snapshot=snapshot,work_version=version).model_dump(mode='json')
            if alpha_enabled(config):
                from .saved_work import index
                context['saved_work']=index(self,c,p,run.workspace_id,cv,context['work_area_context'])
                from .work_context import index as context_index
                context['work_context_index']=context_index(self,c,p,run,config,
                    snapshot=previous['data'].get('work_context_index') if previous else None)
                from .work_context import validate_consumed
                validate_consumed(self,c,p,run,config)
        if run.profile=='general-responses-v1':
            from .evidence_context import VERSION, materialize
            if config.get('evidence_context_version')==VERSION:
                previous=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                    (run.workspace_id,run.id)).fetchone()
                context['evidence_context']=materialize(self,c,p,run,cv,latest,messages,config,context,
                    snapshot=previous['data'].get('evidence_context') if previous else None)
            from .general_responses import standing
            from .composition import continuity_enabled
            from .saved_work import revalidate_reads
            revalidate_reads(self,c,p,run,cv)
            from .retained_results import enabled as retained_enabled, revalidate_reads as revalidate_results
            if retained_enabled(config):
                revalidate_results(self,c,p,run,cv)
            if continuity_enabled(config):
                context['saved_work_discovery']={'capability':'discover_saved_work',
                    'scope':'responsibility_dependencies' if config.get('responsibility') else 'current_conversation',
                    'first_page':{'kind':'discover_saved_work','after_artifact_id':None,'limit':12},
                    'notice':'Snapshot omission is not absence. Page descriptors, then read an exact target.'}
            from .memory.runtime import enabled as memory_enabled, project as project_memory
            if memory_enabled(config):
                project_memory(self,c,p,run,cv,context)
            from .capabilities.research_composition import enabled as research_enabled
            if research_enabled(config):
                from .research import project as project_research
                project_research(self,c,p,run,cv,context)
            if standing(grant.responses) or retained_enabled(config):
                from .conversation_context import bound_context
                bound_context(context,run.id,profile(run.profile)['max_context_bytes'])
        if len(canonical(context).encode())>profile(run.profile)['max_context_bytes']:
            if context.get('responsibility'):
                from .responsibility_execution import ContinuationContextTooLarge
                raise ContinuationContextTooLarge()
            raise DomainError('budget_exhausted')
        return context,sources

    def conversation_worker_context(self,cap):
        with self.db.transaction() as c:
            return self._general_context(c,cap,request_projection=True)

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
            self._identify_work_area(c,p,run,cv,result.work_area)
            run.state='ready'; run.used_units+=1; run.lease_expires_at=None
            self._store_run(c,run)
            self._event(c,p,run.workspace_id,'complete_run',run.id)
            acknowledge(c,run.workspace_id,run.id)
            return run
