"""Conversation-first optional Textual HTTP client. Detaching never cancels work."""
import asyncio
import copy
import json
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.widgets import (Button, Checkbox, Footer, Input, Select, Static,
                             TabbedContent, TabPane, TextArea)
from rich.text import Text
from ..operator_client import OperatorClient, identifier
from ..operator_journal import OperatorError, ReadUnavailable
from ..operator_attachments import stage_text_files, validate_snapshots, stage_documents, validate_documents
from .safe_text import literal, conversation_text
from .presentation import (body_text, comparison_text, execution_text, proposal_label,
                           revision_label, review_identity)
from .session import Session
from .continuity import read as read_continuity, status_text, can_continue, can_stop
from .lifecycle import ACTIONS as LIFECYCLE_ACTIONS
from .presentation import prose
from .widgets import Composer
from .transport import ReadLane, wait_future


class WorkagentApp(App):
    TITLE='Workagent'
    CSS='''
    #navigation { height: 3; }
    #search { width: 30%; }
    #work { width: 70%; }
    TabbedContent { height: 1fr; }
    TabPane { padding: 0; }
    #timeline-scroll { height: 1fr; }
    .prose { height: auto; padding: 0 1; }
    #status { height: 2; padding: 0 1; }
    #composer { height: 5; }
    .actions { height: 3; }
    Button { min-width: 9; margin-right: 1; }
    #execution { height: auto; }
    #target { height: auto; }
    #attachment-preview { height: auto; }
    Checkbox { height: auto; }
    #send { min-width: 18; }
    '''
    BINDINGS=[Binding('ctrl+enter','send','Send',priority=True),
              Binding('f5','send','Send',priority=True),
              Binding('ctrl+r','refresh','Refresh',priority=True),
              Binding('ctrl+q','quit','Detach',priority=True)]

    def __init__(self,client:OperatorClient,workspace:str):
        super().__init__()
        self.client=client;self.workspace=identifier(workspace)
        self.queue_after=0;self.queue_back=[]
        self.canonical=None;self.attention=None;self.queued=[];self.checkpoints=[];self.documents=[]
        self.session=None;self.conversation=None;self.detail=None;self.context=None
        self.listing=[];self.catalog=[];self.execution={};self.last_read=None;self.execution_render='No verified execution read.'
        self.read_lane=ReadLane();self.write_pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix='workagent-write')
        self.reading=False;self.refresh_requested=False;self.deliberate_refresh=False;self.read_errors={};self.sending=False;self.storage_error=False
        self.selected_artifact=None;self.selected_revision=None;self.selected_proposal=None
        self.artifact=None;self.history=[];self.proposals=[];self.review_key=None
        self.page=0;self.poll_interval=15;self.next_poll=time.monotonic()+15
        self.setting_text=False;self.options_cache={};self.render_cache={};self.write_notice=None;self.read_authorized=False
        self.lifecycle_receipts={}
        self.timeline_snapshot=None;self.stale_timeline=False

    def check_action(self, action, parameters):
        # App priority bindings otherwise precede modal bindings. A file-editor
        # shortcut must never submit the hidden conversation composer.
        from .files_screen import WorkingFilesScreen
        from .memory_screen import MemoryScreen
        from .research_screen import ResearchScreen
        from .tool_activity_screen import ToolActivityScreen
        if isinstance(self.screen, (WorkingFilesScreen, MemoryScreen, ResearchScreen, ToolActivityScreen)) and action in ('send', 'refresh'):
            return False
        return super().check_action(action, parameters)

    @property
    def pending_command(self):
        pending=self.session.draft['pending'] if self.session else None
        return pending['command_id'] if pending else None

    def compose(self)->ComposeResult:
        with Horizontal(id='navigation'):
            yield Input(placeholder='Find recent work',id='search')
            yield Select([('Home · New conversation','__new__')],value='__new__',allow_blank=False,id='work')
        with TabbedContent(id='panels'):
            with TabPane('Conversation',id='conversation-panel'):
                with VerticalScroll(id='timeline-scroll'):
                    yield Static('Start with a message.',markup=False,id='timeline',classes='prose')
                with Horizontal(classes='actions'):
                    yield Button('Earlier',id='earlier')
                    yield Button('Later',id='later')
            with TabPane('Work',id='work-panel'):
                with VerticalScroll():
                    yield Static('Select a saved result to read its full body and history.',markup=False,classes='prose')
                    yield Static('Saved results have not been read.',markup=False,id='catalog-status',classes='prose')
                    yield Select([],prompt='Saved results',id='artifact')
                    yield Select([],prompt='Exact revision',id='revision')
                    yield Button('Citations & freshness',id='research-claims')
                    with Horizontal(classes='actions'):
                        yield Button('Use as target',id='target-use')
                        yield Button('Clear target',id='target-clear')
                    yield Static('Conversation target',markup=False,id='target',classes='prose')
                    yield Static('',markup=False,id='artifact-body',classes='prose')
                    yield Select([],prompt='Proposal history',id='proposal')
                    yield Static('',markup=False,id='comparison',classes='prose')
                    yield Checkbox('I reviewed and permit removed/replaced content',id='ack-removed')
                    yield Checkbox('I deliberately choose this earlier candidate',id='ack-older')
                    with Horizontal(classes='actions'):
                        yield Button('Accept',id='accept',disabled=True)
                        yield Button('Dismiss',id='dismiss',disabled=True)
            with TabPane('Files',id='files-panel'):
                with VerticalScroll():
                    yield Button('Working files',id='working-files')
                    yield Button('Memory',id='memory')
                    yield Button('Research sources',id='research-sources')
                    yield Input(placeholder='Local UTF-8 file path (inert snapshot)',id='file-path')
                    with Horizontal(classes='actions'):
                        yield Button('Stage file',id='stage-file')
                        yield Button('Remove file',id='remove-file')
                    yield Select([],prompt='Staged snapshots',id='attachments')
                    yield Static('',markup=False,id='attachment-preview',classes='prose')
                    yield Static('Documents: original bytes only; parsing happens on the server.',markup=False,classes='prose')
                    with Horizontal(classes='actions'):
                        yield Button('Stage document',id='stage-document')
                        yield Button('Remove document',id='remove-document')
                    yield Select([],prompt='Staged PDF / DOCX / XLSX',id='staged-documents')
                    yield Static('',markup=False,id='document-staging',classes='prose')
                    yield Select([],prompt='Uploaded originals',id='documents')
                    yield Static('',markup=False,id='document-status',classes='prose')
                    yield Input(placeholder='Absolute destination for original (must not exist)',id='download-path')
                    yield Button('Download original',id='download-document')
            with TabPane('Status',id='status-panel'):
                with VerticalScroll():
                    yield Button('Tool activity',id='tool-activity')
                    yield Static('Execution has not been read.',markup=False,id='execution',classes='prose')
                    yield Static('Pause stops this responsibility; Resume requests a fresh authorized wake. Take over ends agent ownership. Saved work is retained.',markup=False,classes='prose')
                    yield Select([],prompt='Ongoing responsibility',id='responsibility')
                    yield Static('',markup=False,id='responsibility-status',classes='prose')
                    with Horizontal(classes='actions'):
                        yield Button('Pause',id='responsibility-pause',disabled=True)
                        yield Button('Resume',id='responsibility-resume',disabled=True)
                        yield Button('Take over',id='responsibility-takeover',disabled=True)
                    yield Static('Cancel conversation closes it and stops its work. It cannot be resumed here; saved results and drafts are retained.',markup=False,classes='prose')
                    yield Button('Cancel conversation',id='conversation-cancel',variant='error',disabled=True)
                    yield Static('No lifecycle command receipt in this session.',markup=False,id='lifecycle-receipt',classes='prose')
                    yield Static('',markup=False,id='attention-status',classes='prose')
                    with Horizontal(classes='actions'):
                        yield Button('Mark seen',id='seen')
                        yield Button('STOP exact run',id='stop')
                    yield Static('STOP cancels the displayed run only. Detach leaves work running. Neither closes or pauses a responsibility.',markup=False,classes='prose')
                    yield Select([],prompt='Retained checkpoint',id='checkpoint')
                    yield Static('',markup=False,id='checkpoint-status',classes='prose')
                    yield Button('Continue exact',id='continue')
                    yield Select([],prompt='Durable queued messages',id='queued')
                    yield Static('',markup=False,id='queue-status',classes='prose')
                    yield Button('Cancel selected queue',id='queue-cancel')
                    with Horizontal(classes='actions'):
                        yield Button('Earlier queue',id='queue-earlier')
                        yield Button('Later queue',id='queue-later')
            with TabPane('Recovery',id='recovery-panel'):
                with VerticalScroll():
                    yield Static('Inspect a retained command before explicitly reading back or replaying. Replay sends the exact envelope once; it never refreshes a version or consent.',markup=False,classes='prose')
                    with Horizontal(classes='actions'):
                        yield Button('Inspect',id='inspect')
                        yield Button('Read back',id='readback')
                        yield Button('Replay exact',id='replay')
                    yield Button('Abandon rejected',id='abandon')
                    yield Static('No pending command.',markup=False,id='recovery',classes='prose')
            with TabPane('Details',id='details-panel'):
                with VerticalScroll():yield Static('',markup=False,id='details',classes='prose')
        yield Static('Restoring saved draft; editing unlocks when restoration completes.',markup=False,id='status')
        yield Composer(id='composer',soft_wrap=True,read_only=True)
        with Horizontal(id='actions',classes='actions'):
            yield Button('Send · F5',id='send',variant='primary')
            yield Button('Queue later',id='queue')
            yield Button('Refresh',id='refresh')
            yield Button('Detach',id='detach')
        yield Footer()

    def on_mount(self):
        self.query_one('#composer',TextArea).focus()
        self.action_refresh(deliberate=False);self.poll_timer=self.set_interval(1,self.poll)

    def on_unmount(self):
        # Work already dispatched to a thread is not cancelled/replayed. Its
        # journal records the final known boundary even after UI detachment.
        if hasattr(self,'poll_timer'):self.poll_timer.stop()
        self.read_lane.close();self.write_pool.shutdown(wait=False,cancel_futures=True)

    def status(self,text):
        if self.query('#status'):self.query_one('#status',Static).update(literal(text))

    def update_text(self,id,text):
        if self.render_cache.get(id)==text:return
        self.render_cache[id]=text
        self.query_one('#'+id,Static).update(text)

    def options(self,id,options,value):
        # Avoid touching open selectors on every polling response.
        if value is not Select.NULL and value not in {key for _,key in options}:
            options=options+[('Selected item unavailable in this sample',value)]
        signature=(options,value)
        if self.options_cache.get(id)==signature:return
        self.options_cache[id]=copy.deepcopy(signature)
        selector=self.query_one('#'+id,Select)
        with selector.prevent(Select.Changed):
            selector.set_options([(Text(label),key) for label,key in options]);selector.value=value

    def poll(self):
        if not self.query('#execution'):return
        if time.monotonic()>=self.next_poll:
            self.next_poll=time.monotonic()+self.poll_interval;self.action_refresh(deliberate=False)
        if self.last_read:
            age=int(time.monotonic()-self.last_read)
            self.query_one('#execution',Static).update(self.execution_render+'\nLocal read age: '+str(age)+' seconds.'+
                (' Refresh unavailable; displayed information may be stale.' if age>30 else ''))

    def read_key(self):
        return (self.conversation,self.selected_artifact,self.selected_revision,self.selected_proposal,self.queue_after)

    def action_refresh(self,*,deliberate=True):
        if not self.query('#composer'):return
        self.deliberate_refresh=self.deliberate_refresh or deliberate
        if self.reading or self.read_lane.busy or self.sending:
            self.refresh_requested=True;return
        self.reading=True;self.refresh_requested=False
        deliberate=self.deliberate_refresh;self.deliberate_refresh=False
        self.run_worker(self.refresh_read(self.read_key(),deliberate=deliberate),group='reads',exit_on_error=False)

    def read_bundle(self,key):
        conversation,artifact,revision,proposal=key[:4]
        queue_after=key[4] if len(key)>4 else 0
        identity=None;identity_error=None;errors={};transient=[]
        self.client.identity_execution=None
        try:identity=self.client.identity(self.workspace)
        except OperatorError as exc:identity_error=str(exc)
        root='/'+self.workspace
        # Each refresh is finite, and only one such function can be in flight.
        def read(name,call,default):
            try:return call()
            except (OperatorError,KeyError,TypeError,ValueError) as exc:
                errors[name]=str(exc) if isinstance(exc,OperatorError) else 'Invalid server readback'
                if isinstance(exc,ReadUnavailable):transient.append(name)
                return default
        listing=read('listing',lambda:self.client.browse(root+'/conversations'),{'items':[]})
        execution=getattr(self.client,'identity_execution',None)
        if execution is None:
            execution=read('execution',lambda:self.client.request(root+'/execution'),{}) if not identity_error else {}
            if identity_error:errors['execution']=identity_error
        catalog=read('catalog',lambda:self.client.browse(root+'/conversation-work'),{'items':[]})
        retained=None
        if self.session:
            retained=copy.deepcopy(self.session.state['drafts'].get(conversation,{}).get('continuity'))
        continuity=read('snapshot',lambda:read_continuity(self.client,self.workspace,conversation,retained),None) if conversation else None
        from ..checkpoint_models import QueuedMessagePage, RunCheckpointPage
        from ..document_models import DocumentPage
        queue=read('queue',lambda:self.client.request(root+'/conversations/'+conversation+'/queued-messages'+('?after='+str(queue_after) if queue_after else '')),{'items':[]}) if conversation else {'items':[]}
        checkpoints=read('checkpoints',lambda:self.client.request(root+'/conversations/'+conversation+'/checkpoints'),{'items':[]}) if conversation else {'items':[]}
        documents=read('documents',lambda:self.client.browse(root+'/conversations/'+conversation+'/documents'),{'items':[]}) if conversation else {'items':[]}
        queue=read('queue',lambda:QueuedMessagePage.model_validate(queue).model_dump(mode='json'),{'items':[]})
        checkpoints=read('checkpoints',lambda:RunCheckpointPage.model_validate(checkpoints).model_dump(mode='json'),{'items':[]})
        documents=read('documents',lambda:DocumentPage.model_validate(documents).model_dump(mode='json'),{'items':[]})
        detail=read('conversation',lambda:self.client.run(self.workspace,'show',[conversation]),None) if conversation else None
        context=read('context',lambda:self.client.request(root+'/conversations/'+conversation+'/work-context'),None) if conversation else None
        if identity and context and any(r.get('lifecycle_omitted') for r in context.get('responsibilities',[])):
            from .lifecycle import read_omitted_lifecycles
            context=read('responsibility_details',lambda:read_omitted_lifecycles(self.client,self.workspace,conversation,context,read),context)
        product=None;history=[];proposals=[]
        def read_product():
            nonlocal product,history,proposals
            product=self.client.request(root+'/artifacts/'+artifact)
            history=self.client.browse(root+'/artifacts/'+artifact+'/history')['items']
            proposals=self.client.browse(root+'/artifacts/'+artifact+'/proposals')['items']
            candidate=next((p for p in proposals if p['id']==proposal),None)
            required={value for value in (revision,candidate.get('base_revision_id') if candidate else None) if value}
            retained={r['id'] for r in history}|{product['current_revision_id']}
            for rid in required-retained:
                exact=self.client.request(root+'/artifacts/'+artifact+'?revision_id='+identifier(rid))
                requested=exact.get('requested_revision')
                if not requested or requested['id']!=rid:raise OperatorError('Exact revision readback unavailable')
                history.append(requested);product=exact
        if artifact:
            read('artifact',read_product,None)
            if 'artifact' in errors:product=None;history=[];proposals=[]
        return dict(identity=identity,identity_error=identity_error,errors=errors,transient=transient,listing=listing['items'],
                    execution=execution,catalog=catalog['items'],detail=detail,context=context,
                    artifact=product,history=history,proposals=proposals,continuity=continuity,queue=queue['items'],checkpoints=checkpoints['items'],documents=documents['items'])

    async def refresh_read(self,key,*,deliberate=False):
        recovery_refresh=bool(self.session and self.session.draft['stage']=='refresh_required')
        try:
            data=await self.read_lane.read(self.read_bundle,key)
            if data is None or key!=self.read_key():return
            if self.session and data['identity'] and data['identity']!=self.session.principal:
                self.storage_error=True
                raise OperatorError('Authenticated identity changed/unavailable. Draft scope locked; detach and reconnect.')
            if not self.session and data['identity']:
                self.session=Session(self.client,self.workspace,data['identity'])
                composer=self.query_one('#composer',TextArea)
                self.conversation=self.session.draft['conversation'];self.load_draft();composer.read_only=False
                self.listing=data['listing'];self.catalog=data['catalog'];self.refresh_options()
                if self.conversation!=key[0]:self.refresh_requested=True;self.deliberate_refresh=deliberate;return
            self.read_errors=data.get('errors',{})
            self.read_authorized=bool(data['identity']) and (not self.conversation or (data['detail'] is not None and data['continuity'] is not None));self.listing=data['listing'];self.catalog=data['catalog'];self.detail=data['detail'];self.context=data['context']
            continuity=data['continuity'] if data['identity'] else None
            self.canonical=continuity['snapshot'] if continuity else None
            self.stale_timeline=bool(self.detail is None and 'conversation' in data.get('transient',()) and
                continuity and not continuity['generation_changed'] and self.timeline_snapshot and
                self.timeline_snapshot[0]==self.timeline_scope())
            if self.detail is None and not self.stale_timeline:self.timeline_snapshot=None
            self.attention=continuity['attention'] if continuity else None
            self.queued=data['queue'];self.checkpoints=data['checkpoints'];self.documents=data['documents']
            if self.canonical:
                self.catalog=[dict(item,artifact_id=item['id'],conversation_id=self.conversation) for item in self.canonical['artifacts']]
            if continuity and self.session:
                self.session.draft['continuity']=continuity['continuity'];self.session.save()
            if self.conversation and (not continuity or continuity['generation_changed']):
                # Revoked/generation-changed protected caches and consent are discarded.
                self.lifecycle_receipts.pop(self.conversation,None)
                self.selected_artifact=None;self.selected_revision=None;self.selected_proposal=None
                data['artifact']=None;data['history']=[];data['proposals']=[];self.reset_consent()
                if not continuity:
                    self.detail=None;self.context=None;self.catalog=[];self.queued=[];self.checkpoints=[];self.documents=[]
                    data.update(detail=None,context=None,catalog=[],queue=[],checkpoints=[],documents=[],continuity=None)
                    if self.session:self.session.draft['continuity']=None;self.session.save()
            self.execution=data['execution'];self.last_read=time.monotonic()
            self.artifact=data['artifact'];self.history=data['history'];self.proposals=data['proposals']
            if self.session and (self.detail or not self.conversation):
                self.session.displayed(self.canonical['work_version'] if self.canonical else (self.detail['conversation']['work_version'] if self.detail else None),deliberate=deliberate and recovery_refresh)
            self.refresh_options();self.render_conversation();self.render_work()
            self.execution_render=status_text(self.canonical,detail=self.detail,checkpoints=self.checkpoints) if self.canonical else ('Current conversation state unavailable.' if self.conversation else execution_text(self.execution,self.detail,self.context))
            self.render_continuity()
            if self.read_errors:self.execution_render+='\nUnavailable reads: '+', '.join(self.read_errors)
            self.update_text('execution',self.execution_render)
            details=json.dumps({**data,'local_target':self.session.draft['target'] if self.session else None},ensure_ascii=False,indent=2)
            self.update_text('details',literal(details[:1000000])+('\n[Details display bounded to 1,000,000 characters.]' if len(details)>1000000 else ''))
            active=(self.canonical or {}).get('execution',{}).get('state') in ('queued','running','awaiting_provider','recovering')
            self.poll_interval=1 if continuity and continuity['events']['has_more'] else (2 if active else 15)
            run_ids={run['id'] for run in (self.detail or {}).get('runs',[])}
            redirect=active
            self.query_one('#send',Button).label='Redirect · F5' if redirect else 'Send · F5'
            pending_notice='Retained command needs inspection in Recovery; fresh send is locked.' if self.pending_command else None
            self.status(data['identity_error'] or ('Read unavailable; showing last read transcript. Draft kept. Refresh to verify before sending.' if self.stale_timeline else None) or ('Read unavailable: '+'; '.join(k+': '+v for k,v in self.read_errors.items()) if self.read_errors else None) or self.write_notice or pending_notice or ('Active work: Send redirects/supersedes it; it does not queue a later turn.' if redirect else
                'Enter adds a line. F5 / Ctrl+Enter sends. Detach leaves server work running.'))
        except (OperatorError,KeyError,TypeError,ValueError) as exc:
            self.poll_interval=30;self.read_authorized=False
            self.timeline_snapshot=None;self.stale_timeline=False
            if self.query('#timeline'):
                self.detail=None;self.artifact=None;self.history=[];self.proposals=[];self.last_read=None
                self.canonical=None;self.attention=None;self.queued=[];self.checkpoints=[];self.documents=[];self.catalog=[];self.listing=[]
                self.render_continuity();self.refresh_options()
                for id in ('timeline','artifact-body','comparison','details','execution'):
                    self.update_text(id,'Access unavailable. Refresh to verify access again.')
            self.reset_consent()
            self.status((str(exc) if isinstance(exc,OperatorError) else 'Invalid server readback')+' Draft retained; Refresh reads only.')
        finally:
            self.reading=False;self.next_poll=time.monotonic()+self.poll_interval
            if self.refresh_requested and not self.sending:self.call_later(lambda:self.action_refresh(deliberate=False))

    def refresh_options(self):
        query=self.query_one('#search',Input).value.casefold()
        recent=sorted(self.listing,key=lambda item:item.get('updated_at') or item.get('created_at') or '',reverse=True)
        choices=[('Home · New conversation','__new__')]
        for item in recent:
            if query in item['title'].casefold() or item['id']==self.conversation:
                choices.append((literal(item['title']),item['id']))
        if self.conversation and self.conversation not in {v for _,v in choices}:
            choices.append((literal((self.detail or {}).get('conversation',{}).get('title','Created conversation')),self.conversation))
        self.options('work',choices,self.conversation or '__new__')
        catalog=[item for item in self.catalog if item['conversation_id']==self.conversation]
        self.update_text('catalog-status','Saved results unavailable: '+self.read_errors['catalog'] if 'catalog' in self.read_errors else (str(len(catalog))+' saved results.'))
        self.options('artifact',[(literal(item['title']),item['artifact_id']) for item in catalog],self.selected_artifact or Select.NULL)

    def timeline_scope(self):
        return (self.session.principal if self.session else None,self.workspace,self.conversation,
                (self.canonical or {}).get('access_generation'),self.page)

    def render_conversation(self):
        stale=bool(self.stale_timeline and self.canonical and self.timeline_snapshot and
                   self.timeline_snapshot[0]==self.timeline_scope())
        for id in ('earlier','later'):self.query_one('#'+id,Button).disabled=self.detail is None
        if stale:
            self.update_text('timeline',self.timeline_snapshot[1]);return
        self.stale_timeline=False;self.timeline_snapshot=None
        if self.conversation and self.detail is None:
            self.update_text('timeline','Conversation unavailable: '+self.read_errors['conversation'] if 'conversation' in self.read_errors else 'Loading conversation…')
        else:
            text=conversation_text(self.detail or {},page=self.page)
            if self.detail and self.canonical:self.timeline_snapshot=(self.timeline_scope(),text)
            self.update_text('timeline',text)

    def load_draft(self):
        self.setting_text=True
        try:
            composer=self.query_one('#composer',TextArea)
            if composer.text!=self.session.draft['text']:
                with composer.prevent(TextArea.Changed):composer.load_text(self.session.draft['text'])
            self.render_attachments();self.render_target()
            pending=self.session.draft['pending']
            if pending:self.update_text('recovery','Retained '+pending['action']+' command '+pending['command_id']+' · '+self.session.draft['stage']+' · Inspect before explicit Read back or Replay exact.')
            else:self.update_text('recovery','No pending command.')
        finally:self.setting_text=False

    def persist(self,**values):
        if self.storage_error:raise OperatorError('Private storage is locked; detach and repair before sending')
        if not self.session:raise OperatorError('Authenticated identity unavailable; drafts and writes are locked')
        try:self.session.edit(**values)
        except OperatorError:
            self.storage_error=True;raise

    def on_text_area_changed(self,event:TextArea.Changed):
        if event.text_area.id=='composer' and not self.setting_text and self.session:
            try:self.persist(text=event.text_area.text)
            except OperatorError as exc:self.status(str(exc))

    def on_input_changed(self,event:Input.Changed):
        if event.input.id=='search':self.refresh_options()

    def on_select_changed(self,event:Select.Changed):
        if event.value is Select.NULL or event.value!=event.select.value:return
        if event.select.id=='work' and 'work' not in self.options_cache:return
        selected=str(event.value)
        try:
            if event.select.id=='work':
                conversation=None if selected=='__new__' else selected
                if conversation==self.conversation:return
                if self.session:
                    self.persist(text=self.query_one('#composer',TextArea).text)
                    self.session.select(selected)
                self.conversation=conversation;self.queue_after=0;self.queue_back=[]
                self.canonical=None;self.attention=None;self.queued=[];self.checkpoints=[];self.documents=[];self.read_authorized=False
                self.render_continuity()
                self.detail=None;self.read_errors={};self.catalog=[];self.page=0;self.selected_artifact=None;self.selected_revision=None;self.selected_proposal=None
                self.artifact=None;self.history=[];self.proposals=[];self.reset_consent()
                if self.session:self.load_draft()
                self.render_conversation();self.render_work();self.action_refresh(deliberate=False)
            elif event.select.id=='artifact':
                if selected==self.selected_artifact:return
                self.selected_artifact=selected;self.selected_revision=None;self.selected_proposal=None
                self.artifact=None;self.history=[];self.proposals=[];self.reset_consent();self.render_work();self.action_refresh(deliberate=False)
            elif event.select.id=='revision':
                self.selected_revision=selected;self.render_work()
                if selected not in {r['id'] for r in self.history}:self.action_refresh(deliberate=False)
            elif event.select.id=='proposal':
                self.selected_proposal=selected;self.reset_consent();self.render_work();self.action_refresh(deliberate=False)
            elif event.select.id in ('documents','queued','checkpoint'):self.render_continuity_details()
            elif event.select.id=='responsibility':self.render_lifecycle_controls()
            elif event.select.id=='attachments':self.render_attachment_preview(selected)
        except OperatorError as exc:self.status(str(exc))

    def reset_consent(self):
        self.review_key=None
        for id in ('ack-removed','ack-older'):self.query_one('#'+id,Checkbox).value=False
        for id in ('accept','dismiss'):self.query_one('#'+id,Button).disabled=True

    def render_target(self):
        target=self.session.draft['target'] if self.session else None
        if target:
            item=next((item for item in self.catalog if item['artifact_id']==target['artifact_id']),None)
            title=literal(item['title']) if item else 'retained saved result'
            self.update_text('target','Send target: '+title+' · exact retained revision. Refresh never changes this binding; identifiers/hash are in Details.')
        else:self.update_text('target','Send target: conversation (no artifact)')

    def render_work(self):
        if not self.artifact:
            self.reset_consent()
            self.options('revision',[],Select.NULL);self.options('proposal',[],Select.NULL)
            self.update_text('artifact-body','Saved result unavailable: '+self.read_errors['artifact'] if 'artifact' in self.read_errors else '');self.update_text('comparison','');return
        current=self.artifact['current_revision'];rid=self.selected_revision or current['id']
        revisions={r['id']:r for r in self.history};revisions[current['id']]=current
        revision=revisions.get(rid)
        self.options('revision',[(revision_label(r,current['id']),r['id']) for r in sorted(revisions.values(),key=lambda r:r['revision_number'],reverse=True)],rid if revision else Select.NULL)
        self.update_text('artifact-body',revision_label(revision,current['id'])+'\n\n'+body_text(revision['body']) if revision else 'Selected revision unavailable. Target remains unchanged.')
        self.options('proposal',[(proposal_label(p),p['id']) for p in sorted(self.proposals,key=lambda p:p.get('created_at',''),reverse=True)],self.selected_proposal or Select.NULL)
        candidate=next((p for p in self.proposals if p['id']==self.selected_proposal),None)
        if not candidate:self.reset_consent();self.update_text('comparison','Select a candidate for its full current/base/proposed comparison.');return
        identity=review_identity(self.artifact,candidate)
        if identity!=self.review_key:self.reset_consent();self.review_key=identity
        base=revisions.get(candidate['base_revision_id'])
        if not base:
            self.reset_consent();self.update_text('comparison','Exact base unavailable in bounded history; acceptance disabled.');return
        self.update_text('comparison',comparison_text(self.artifact,base,candidate))
        enabled=candidate['status']=='pending' and isinstance(candidate.get('review'),dict) and candidate['base_revision_id']==current['id']
        self.query_one('#accept',Button).disabled=not enabled
        self.query_one('#dismiss',Button).disabled=candidate['status']!='pending'

    def render_continuity(self):
        self.update_text('attention-status',('Attention: '+str(len(self.attention['facts']))+' material transitions'+
            (' · more available' if self.attention['has_more'] else '')+' · seen is separate from acceptance\n'+ '\n'.join(literal(f['type'])+' · '+literal(f['reason_code'])+' · '+literal(f['occurred_at']) for f in self.attention['facts'])) if self.attention else 'Attention unavailable.')
        for widget,items,key,label in (
            ('queued',self.queued,'id',lambda q: q['state']+' · '+(q.get('reason') or '')+' · '+q['intent']['text'][:80]),
            ('checkpoint',self.checkpoints,'checkpoint_id',lambda c: c['phase']+' · '+c['data']['waiting']+' · '+c['data']['next_safe_action']),
            ('documents',self.documents,'document_id',lambda d: d['filename']+' · '+d['status'])):
            selected=self.query_one('#'+widget,Select).value
            if selected not in {x[key] for x in items}:selected=Select.NULL
            self.options(widget,[(literal(label(x)),x[key]) for x in items],selected)
        self.query_one('#queue-earlier',Button).disabled=not self.queue_back
        self.query_one('#queue-later',Button).disabled=len(self.queued)!=100
        self.render_continuity_details()

    def render_continuity_details(self):
        selected=lambda widget,items,key:next((x for x in items if x[key]==self.query_one('#'+widget,Select).value),None)
        document=selected('documents',self.documents,'document_id')
        self.update_text('document-status',('Parser: '+prose(document['status'])+' · '+prose(document['reason'])+
            '\nCoverage and omissions:\n'+prose(document['coverage'])) if document else 'Choose an uploaded original to inspect parser coverage and omissions.')
        queued=selected('queued',self.queued,'id')
        self.update_text('queue-status',('State: '+prose(queued['state'])+' · '+prose(queued.get('reason'))+
            '\nExact queued text:\n'+literal(queued['intent']['text'])) if queued else 'Queue later retains the exact intent on the server. Held messages are not automatically rebased. This list is bounded to 100 entries.')
        checkpoint=selected('checkpoint',self.checkpoints,'checkpoint_id')
        self.update_text('checkpoint-status',prose(checkpoint) if checkpoint else 'Choose an exact checkpoint. Unknown or unsafe outcomes cannot continue.')
        self.query_one('#continue',Button).disabled=not (self.read_authorized and can_continue(checkpoint,self.canonical))
        self.query_one('#stop',Button).disabled=not (self.read_authorized and can_stop(self.canonical,self.detail))
        self.query_one('#seen',Button).disabled=not (self.read_authorized and self.attention and not self.attention['reset_required'])
        self.query_one('#queue-cancel',Button).disabled=not (self.read_authorized and queued and queued['state'] in ('pending','held'))
        self.render_lifecycle_controls()

    def lifecycle_selection(self):
        cv=(self.detail or {}).get('conversation',{});context=self.context or {};snapshot=self.canonical or {}
        # Context carries assignment CAS; WorkSnapshot only carries conversation CAS.
        scoped=(self.read_authorized and self.session and cv.get('id')==self.conversation==context.get('conversation_id')==snapshot.get('conversation_id')
                and cv.get('work_version')==context.get('conversation_work_version')==snapshot.get('work_version'))
        items=context.get('responsibilities',[]) if scoped else []
        item=next((r for r in items if r['assignment_id']==self.query_one('#responsibility',Select).value),None)
        allowed=[]
        if scoped and cv.get('state')=='open':allowed.append('conversation-cancel')
        life=(item or {}).get('lifecycle')
        if scoped and item and life and not item.get('lifecycle_omitted') and item['owner_id']==self.session.principal:
            current=next((r for r in snapshot.get('responsibility',[]) if r['assignment_id']==item['assignment_id']),None)
            state=life['state']
            if current and current['state']==state and state not in ('cancelled','taken_over'):
                allowed.append('responsibility-takeover')
                if state!='paused':allowed.append('responsibility-pause')
                elif cv.get('state')=='open':allowed.append('responsibility-resume')
        return copy.deepcopy(dict(conversation=cv,responsibility=item,allowed=allowed))

    def render_lifecycle_controls(self):
        context=self.context or {}
        items=context.get('responsibilities',[]) if self.read_authorized and context.get('conversation_id')==self.conversation else []
        selected=self.query_one('#responsibility',Select).value
        if selected not in {r['assignment_id'] for r in items}:selected=items[0]['assignment_id'] if items else Select.NULL
        self.options('responsibility',[(literal(r['assignment_id'])+' · '+literal((r.get('lifecycle') or {}).get('state','details unavailable')),r['assignment_id']) for r in items],selected)
        selection=self.lifecycle_selection();item=selection['responsibility'];cv=selection['conversation']
        text='Conversation now: '+literal(cv.get('state','unavailable'))
        if item:
            text+='\nSelected responsibility now: '+prose((item.get('lifecycle') or {}).get('state'))+' · displayed assignment version '+str(item['work_version'])
        else:text+='\nNo verified responsibility selected. Refresh to inspect current work.'
        if context.get('truncated'):text+='\nWork context is bounded; some responsibilities or details may be omitted.'
        self.update_text('responsibility-status',text)
        locked=(not self.session or self.sending or self.storage_error or self.pending_command or self.session.draft['stage']=='refresh_required')
        for action in LIFECYCLE_ACTIONS:self.query_one('#'+action,Button).disabled=bool(locked or action not in selection['allowed'])
        receipt=self.lifecycle_receipts.get(self.conversation) if self.read_authorized else None
        self.update_text('lifecycle-receipt',receipt or 'No lifecycle command receipt in this session. Historical receipts remain in the private command journal.')

    def show_lifecycle_receipt(self,record,result):
        if record['format']!=5:return
        receipt=result['receipt'];item=receipt.get('assignment',receipt)
        state=receipt.get('lifecycle',receipt)['state']
        self.lifecycle_receipts[record['args'][0]]=('COMMAND RECEIPT · '+literal(record['action'])+' · '+literal(result['command_id'])+
            '\nState at command: '+literal(state)+' · version '+str(item['work_version'])+
            '\nExact readback confirmed. This historical receipt is not current state; current state is shown separately above.')
        self.render_lifecycle_controls()

    async def lifecycle_write(self,action,selection):
        if not self.session or not self.read_authorized or action not in selection['allowed']:
            raise OperatorError('Refresh and inspect the exact lifecycle control before sending')
        draft=self.session.draft;cv=selection['conversation']
        if cv['id']!=draft['conversation']:raise OperatorError('Displayed lifecycle scope changed; inspect again')
        args=[cv['id']];version=cv['work_version']
        if action!='conversation-cancel':
            item=selection['responsibility'];args.append(item['assignment_id']);version=item['work_version']
        record=self.session.prepare(draft,action,args,expected_work_version=version)
        result=await self.execute(record);self.capture_edits(draft);self.session.complete(draft,result)
        self.show_lifecycle_receipt(record,result)
        self.status('Lifecycle command receipt and readback confirmed; saved work and composer retained.')

    def control_selection(self):
        # Freeze what was displayed at the key/click, before a refresh can land.
        return copy.deepcopy(dict(snapshot=self.canonical,attention=self.attention,
            checkpoint=next((c for c in self.checkpoints if c['checkpoint_id']==self.query_one('#checkpoint',Select).value),None),
            queued=next((q for q in self.queued if q['id']==self.query_one('#queued',Select).value),None)))

    async def continuity_write(self,action,selection):
        if not self.session or not self.read_authorized or not self.canonical:raise OperatorError('Refresh current scope before this command')
        draft=self.session.draft;conversation=draft['conversation'];snapshot=selection['snapshot']
        if not snapshot or snapshot['conversation_id']!=conversation:raise OperatorError('Displayed command scope changed; inspect again')
        version=snapshot['work_version']
        if action=='stop':
            run=snapshot['execution']
            if not run['run_id']:raise OperatorError('No exact current run to STOP')
            args=[conversation,run['run_id']]
        elif action=='seen':
            attention=selection['attention']
            if not attention or attention['reset_required']:raise OperatorError('Attention cursor unavailable')
            args=[conversation,attention['next_cursor']]
        elif action=='continue':
            checkpoint=selection['checkpoint']
            if not can_continue(checkpoint,snapshot):raise OperatorError('Checkpoint cannot safely continue; unknown outcomes require reconciliation')
            args=[conversation,checkpoint['checkpoint_id'],checkpoint['checkpoint_hash']]
        else:
            queued=selection['queued']
            if not queued or queued['state'] not in ('pending','held'):raise OperatorError('Choose a pending or held queue item')
            args=[conversation,queued['id'],str(queued['queue_version'])]
        record=self.session.prepare(draft,action,args,expected_work_version=version)
        result=await self.execute(record);self.capture_edits(draft);self.session.complete(draft,result)
        self.status('Exact '+action+' receipt and readback confirmed.')

    async def download_original(self):
        if not self.session or not self.read_authorized:raise OperatorError('Refresh access before download')
        document=self.query_one('#documents',Select).value;destination=self.query_one('#download-path',Input).value
        if document is Select.NULL:raise OperatorError('Select an uploaded original')
        while self.read_lane.busy:await asyncio.sleep(.025)
        future=self.write_pool.submit(self.client.download_document,self.workspace,self.conversation,str(document),destination)
        await wait_future(future);self.status('Exact original saved to the selected local destination.')

    def render_attachments(self):
        attachments=self.session.draft['attachments'] if self.session else []
        documents=self.session.draft['documents'] if self.session else []
        self.options('staged-documents',[(literal(d['filename'])+' · SHA-256 '+d['sha256'],str(i)) for i,d in enumerate(documents)],'0' if documents else Select.NULL)
        delivery=self.session.draft['delivery'] if self.session else None
        self.update_text('document-staging',str(len(documents))+' staged originals (max 2, 5 MiB each).'+(' Retained delivery: '+str(len(delivery['refs']))+' uploads confirmed; Send resumes the frozen intent.' if delivery else ''))
        self.options('attachments',[(literal(a['filename'])+' · '+str(len(a['content'].encode()))+' bytes',str(i)) for i,a in enumerate(attachments)],'0' if attachments else Select.NULL)
        if attachments:self.render_attachment_preview('0')
        else:self.update_text('attachment-preview','No staged files. Original files are never reread on send/replay.')

    def render_attachment_preview(self,index):
        from hashlib import sha256
        attachments=self.session.draft['attachments'] if self.session else []
        if not index.isdigit() or int(index)>=len(attachments):return
        attachment=attachments[int(index)];raw=attachment['content'].encode()
        self.update_text('attachment-preview',literal(attachment['filename'])+'\nSHA-256 '+sha256(raw).hexdigest()+
                         '\nExact retained text (CR/BOM/control characters escaped for display):\n'+literal(attachment['content']))

    def on_button_pressed(self,event:Button.Pressed):
        action=event.button.id
        try:
            if action=='send':self.action_send()
            elif action=='queue':self.action_send(mode='queue')
            elif action=='queue-later':
                if len(self.queued)==100:
                    self.queue_back.append(self.queue_after);self.queue_after=self.queued[-1]['position'];self.action_refresh(deliberate=False)
            elif action=='queue-earlier':
                if self.queue_back:self.queue_after=self.queue_back.pop();self.action_refresh(deliberate=False)
            elif action in ('stop','continue','seen','queue-cancel'):self.start_write(self.continuity_write(action,self.control_selection()))
            elif action in LIFECYCLE_ACTIONS:self.start_write(self.lifecycle_write(action,self.lifecycle_selection()))
            elif action=='tool-activity':
                if not self.session or not self.conversation or not self.read_authorized:
                    raise OperatorError('Open an authenticated conversation before inspecting receipts')
                from .tool_activity_screen import ToolActivityScreen
                self.push_screen(ToolActivityScreen(self.client,self.workspace,self.session.principal,(self.detail or {}).get('runs',[])))
            elif action in ('research-sources','research-claims'):
                if not self.session or not self.conversation or not self.read_authorized:
                    raise OperatorError('Open an authenticated conversation before inspecting research')
                from .research_screen import ResearchScreen
                from .research import selected_binding
                binding=selected_binding(self.artifact,self.history,self.selected_revision) if action=='research-claims' else None
                self.push_screen(ResearchScreen(self.client,self.workspace,self.session.principal,self.conversation,binding=binding))
            elif action=='memory':
                if not self.session or not self.conversation or not self.read_authorized:
                    raise OperatorError('Open an authenticated conversation before inspecting memory')
                from .memory_screen import MemoryScreen
                self.push_screen(MemoryScreen(self.client,self.workspace,self.session.principal,self.conversation))
            elif action=='working-files':
                if not self.session or not self.conversation or not self.read_authorized:
                    raise OperatorError('Open an authenticated conversation before editing working files')
                from .files_screen import WorkingFilesScreen
                self.push_screen(WorkingFilesScreen(self.client,self.workspace,self.session.principal,self.conversation))
            elif action=='download-document':self.start_write(self.download_original())
            elif action=='stage-document':
                if not self.session:raise OperatorError('Authenticated identity required for staging')
                documents=validate_documents(self.session.draft['documents']+stage_documents([self.query_one('#file-path',Input).value]))
                self.persist(documents=documents);self.render_attachments()
            elif action=='remove-document':
                selected=self.query_one('#staged-documents',Select).value
                if selected is not Select.NULL:
                    documents=copy.deepcopy(self.session.draft['documents']);documents.pop(int(selected))
                    self.persist(documents=documents);self.render_attachments()
            elif action=='refresh':self.action_refresh()
            elif action=='detach':self.action_quit()
            elif action in ('earlier','later'):
                count=len((self.detail or {}).get('messages',[]));maximum=max(0,(count-1)//40)
                self.page=min(maximum,self.page+1) if action=='earlier' else max(0,self.page-1);self.render_conversation()
            elif action=='stage-file':
                staged=stage_text_files([self.query_one('#file-path',Input).value])
                if not self.session:raise OperatorError('Authenticated identity required for staging')
                attachments=validate_snapshots(self.session.draft['attachments']+[s.payload() for s in staged])
                self.persist(attachments=attachments);self.render_attachments()
            elif action=='remove-file':
                selected=self.query_one('#attachments',Select).value
                if selected is not Select.NULL:
                    attachments=copy.deepcopy(self.session.draft['attachments']);attachments.pop(int(selected))
                    self.persist(attachments=attachments);self.render_attachments()
            elif action=='target-clear':self.persist(target=None);self.render_target()
            elif action=='target-use':
                if not self.artifact:raise OperatorError('Select a saved result and exact revision first')
                rid=self.selected_revision or self.artifact['current_revision_id']
                revision=next((r for r in self.history+[self.artifact['current_revision']] if r['id']==rid),None)
                if revision is None:raise OperatorError('Selected revision unavailable')
                self.persist(target={'artifact_id':self.artifact['id'],'revision_id':rid,'body_hash':revision['body_hash']});self.render_target()
            elif action=='abandon':
                if self.sending:raise OperatorError('Wait for the outstanding command')
                if not self.session:raise OperatorError('No restored draft')
                self.capture_edits(self.session.draft)
                self.session.abandon_rejected(self.session.draft)
                self.deliberate_refresh=False
                self.reset_consent();self.load_draft();self.write_notice=None
                self.status('Rejected attempt abandoned; draft and historical envelope retained. Deliberately Refresh, then Send or review again.')
            elif action=='inspect':self.inspect_pending()
            elif action in ('readback','replay'):self.start_write(self.recover(action))
            elif action in ('accept','dismiss'):self.start_write(self.review_write(action))
        except (OperatorError,ValueError,IndexError) as exc:self.status(str(exc) if isinstance(exc,OperatorError) else 'Selection unavailable')

    def inspect_pending(self):
        if not self.session or not self.pending_command:self.status('No pending command.');return
        data=self.session.inspect(self.session.draft)
        if data:
            record=data['record'];body=record['body']
            self.update_text('recovery','Retained '+record['action']+' · '+data['outcome']['state']+
                '\nCommand: '+record['command_id']+'\nFull exact envelope is in Details.'+
                '\nText: '+literal(body.get('text',body.get('title','')))+
                '\nSnapshots: '+', '.join(literal(a['filename']) for a in body.get('attachments',[])))
            shown=copy.deepcopy(data)
            if 'content_base64' in shown['record']['body']:shown['record']['body']['content_base64']='[Exact original bytes retained in private journal; omitted from display]'
            self.update_text('details',literal(json.dumps(shown,ensure_ascii=False,indent=2)))
        else:self.update_text('recovery','No journal envelope exists. Read back will release this pre-journal marker without sending.')

    def start_write(self,coroutine):
        if self.sending or self.storage_error:
            coroutine.close();self.status('A write is outstanding or private storage is locked.');return
        self.sending=True;self.write_notice=None
        self.run_worker(self.write_guard(coroutine),group='writes',exit_on_error=False)

    async def write_guard(self,coroutine):
        try:await coroutine
        except (OperatorError,KeyError,TypeError,ValueError) as exc:
            self.write_notice=(str(exc) if isinstance(exc,OperatorError) else 'Invalid readback')+' Draft retained; inspect Recovery. No automatic retry.'
            self.status(self.write_notice)
        finally:
            self.sending=False
            if self.session and self.query('#composer'):self.load_draft()
            self.action_refresh(deliberate=False)

    def capture_edits(self,draft):
        if self.session.draft is draft:
            self.persist(text=self.query_one('#composer',TextArea).text)

    async def execute(self,record):
        while self.read_lane.busy:await asyncio.sleep(.025)
        future=self.write_pool.submit(self.client.execute,record,lambda value:None)
        return await wait_future(future)

    def action_send(self,mode='follow'):
        if not self.session or not self.read_authorized:self.status('Authenticated scope read unavailable; Refresh before sending.');return
        if self.session.draft['stage']=='refresh_required':self.status('Deliberately Refresh before sending a new attempt.');return
        if self.pending_command:self.status('Retained command is locked. Inspect, Read back or Replay exact in Recovery.');return
        try:self.persist(text=self.query_one('#composer',TextArea).text)
        except OperatorError as exc:self.status(str(exc));return
        if self.session.draft['delivery'] and self.session.draft['delivery']['action']!=mode:self.status('Retained delivery has a different send mode. Use its original Send or Queue later control.');return
        if not self.session.draft['text'].strip() and not self.session.draft['delivery']:self.status('Write a message first.');return
        self.start_write(self.send_text(mode))

    async def send_text(self,mode='follow'):
        draft=self.session.draft
        if draft['delivery'] is None:
            snapshot=copy.deepcopy(draft)
            target=snapshot['target'];args=[draft['conversation'] or 'preflight',snapshot['text']]+([target['artifact_id'],target['revision_id'],target['body_hash']] if target else [])
            # Validate before creating a conversation or any upload.
            self.client.prepare(self.workspace,mode,args,expected_work_version=snapshot['expected_work_version'] or 1,
                attachments=snapshot['attachments'],principal_id=self.session.principal)
            draft['delivery']={k:snapshot[k] for k in ('text','attachments','documents','target','generation')}
            draft['delivery'].update(action=mode,refs=[],version=snapshot['expected_work_version'])
            self.session.save()
        delivery=draft['delivery'];generation=delivery['generation']
        if draft['conversation'] is None:
            record=self.session.prepare(draft,'chat',[delivery['text'].splitlines()[0][:240] or 'Conversation'],generation=generation)
            result=await self.execute(record);self.capture_edits(draft);self.session.complete(draft,result)
            if self.session.draft is draft:self.conversation=draft['conversation']
        while len(delivery['refs'])<len(delivery['documents']):
            document=delivery['documents'][len(delivery['refs'])]
            record=self.session.prepare(draft,'document',[draft['conversation']],generation=generation,document=document)
            result=await self.execute(record);self.capture_edits(draft);self.session.complete(draft,result)
        target=delivery['target']
        args=[draft['conversation'],delivery['text']]+([target['artifact_id'],target['revision_id'],target['body_hash']] if target else [])
        extras={'document_refs':delivery['refs']} if delivery['documents'] else {}
        record=self.session.prepare(draft,delivery['action'],args,generation=generation,
            expected_work_version=delivery['version'],attachments=delivery['attachments'],**extras)
        result=await self.execute(record);self.capture_edits(draft);self.session.complete(draft,result)
        self.status('Exact message readback confirmed. Queue admission and worker execution are separate.')

    async def recover(self,action):
        if not self.session or not self.pending_command:raise OperatorError('No pending command')
        draft=self.session.draft;data=self.session.inspect(draft)
        if data is None:
            self.session.recover_unprepared(draft);self.status('Pre-journal failure cleared. No request sent.');return
        cid=draft['pending']['command_id']
        if not self.read_authorized:raise OperatorError('Refresh authenticated scope before recovery')
        while self.read_lane.busy:await asyncio.sleep(.025)
        future=self.write_pool.submit(self.client.run,self.workspace,action,[cid],principal_id=self.session.principal)
        result=await wait_future(future);self.capture_edits(draft);self.session.complete(draft,result)
        self.show_lifecycle_receipt(data['record'],result)
        if self.session.draft is draft:self.conversation=draft['conversation']
        self.status('Retained command confirmed. Send explicitly to continue a created conversation.')

    async def review_write(self,action):
        if not self.session or not self.artifact or not self.read_authorized:raise OperatorError('Refresh and select an exact reviewed candidate')
        candidate=next((p for p in self.proposals if p['id']==self.selected_proposal),None)
        if not candidate or review_identity(self.artifact,candidate)!=self.review_key:raise OperatorError('Review identity changed; compare again')
        policy=candidate.get('review')
        removed=self.query_one('#ack-removed',Checkbox).value;older=self.query_one('#ack-older',Checkbox).value
        if action=='accept' and (not policy or (policy['removed_content_count'] and not removed) or (not policy['is_latest'] and not older)):
            raise OperatorError('Select each required acknowledgement for this exact candidate')
        draft=self.session.draft
        record=self.session.prepare(draft,action,[candidate['id'],self.artifact['id'],candidate['base_revision_id']],
            acknowledge_removed_content=removed if action=='accept' else False,
            acknowledge_older_proposal=older if action=='accept' else False)
        result=await self.execute(record);self.capture_edits(draft);self.session.complete(draft,result);self.reset_consent()


def main(argv=None):
    import argparse
    import os
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace',default=os.environ.get('WORKAGENT_WORKSPACE'))
    args=parser.parse_args(argv)
    if not args.workspace:parser.error('--workspace or WORKAGENT_WORKSPACE is required')
    try:WorkagentApp(OperatorClient(),args.workspace).run()
    except OperatorError as exc:parser.exit(1,literal(exc)+'\n')


if __name__=='__main__':main()
