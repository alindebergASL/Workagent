"""Durable conversation state machine; no widgets, workers, DB or providers."""
import copy
from uuid import uuid4
from ..operator_journal import OperatorError
from .drafts import DraftStore, new_draft


class Session:
    def __init__(self,client,workspace,principal,*,store=None):
        self.client=client; self.workspace=workspace; self.principal=principal
        self.store=store or DraftStore(client.base,workspace,principal)
        self.state=self.store.load() or {'selected':'__new__','drafts':{'__new__':new_draft()}}
        self.store.save(self.state)
        self.durable_state=copy.deepcopy(self.state)

    @property
    def key(self):return self.state['selected']

    @property
    def draft(self):return self.state['drafts'][self.key]

    def save(self):
        try:self.store.save(self.state)
        except OperatorError:
            # Never leave an in-memory cleared pending marker after a failed
            # durable transition. Disk and memory retain the last safe boundary.
            self.state=copy.deepcopy(self.durable_state)
            raise
        self.durable_state=copy.deepcopy(self.state)

    def select(self,key):
        if key not in self.state['drafts']:
            draft=new_draft();draft['conversation']=None if key=='__new__' else key
            self.state['drafts'][key]=draft
        self.state['selected']=key;self.save()

    def edit(self,**values):
        draft=self.draft
        if any(draft[k]!=v for k,v in values.items()):
            draft.update(copy.deepcopy(values));draft['generation']+=1;self.save()

    def displayed(self,version,*,deliberate=False):
        # A selected target is never silently updated by a refresh.
        if self.draft['stage']=='refresh_required':
            if not deliberate:return
            self.draft['stage']='created' if self.draft['conversation'] else 'draft'
        self.draft['expected_work_version']=version;self.save()

    def prepare(self,draft,action,args,*,generation=None,**kwargs):
        if draft['stage']=='refresh_required':raise OperatorError('Deliberately Refresh before a new attempt')
        if draft['pending']:raise OperatorError('Resolve the retained command before a fresh send')
        cid=str(uuid4())
        record=self.client.prepare(self.workspace,action,args,command_id=cid,
                                  principal_id=self.principal,**kwargs)
        # Pure validation precedes the pending marker; disk failures here cannot POST.
        draft['pending']={'command_id':cid,'action':action,
                          'generation':draft['generation'] if generation is None else generation}
        draft['stage']={'chat':'creating','follow':'following'}.get(action,'reviewing')
        self.save()
        try:self.client.journal.reserve(record)
        except OperatorError:
            # Only absence proves this was a pre-journal failure. Corrupt/unsafe
            # storage remains locked, as does any reserved envelope.
            if self.client.journal.find(cid) is None:
                draft['pending']=None;draft['stage']='created' if draft['conversation'] else 'draft';self.save()
            raise
        return record

    def complete(self,draft,result):
        pending=draft['pending']
        if not pending or result['command_id']!=pending['command_id']:
            raise OperatorError('Command readback identity mismatch')
        data=self.inspect(draft)
        if (data is None or data['outcome']['state']!='confirmed' or
                result.get('receipt')!=data['outcome'].get('receipt') or 'readback' not in result):
            raise OperatorError('Exact confirmed journal/readback required before clearing a draft')
        if pending['action']=='chat':
            conversation=result['receipt']['id']
            detail=result['readback']['conversation']
            if detail['id']!=conversation or result['receipt']['owner_id']!=self.principal:
                raise OperatorError('Created conversation identity mismatch; retained command locked')
            draft['conversation']=conversation;draft['expected_work_version']=detail['work_version']
            old_key=next(k for k,v in self.state['drafts'].items() if v is draft)
            self.state['drafts'][conversation]=draft
            if old_key!=conversation:del self.state['drafts'][old_key]
            if self.key==old_key:self.state['selected']=conversation
            if draft['delivery'] is not None:draft['delivery']['version']=detail['work_version']
            draft['stage']='created'
        elif pending['action']=='document':
            delivery=draft['delivery']
            if delivery is None:raise OperatorError('Retained upload lifecycle missing')
            index=len(delivery['refs']);receipt=result['receipt']
            if (index>=len(delivery['documents']) or receipt['sha256']!=delivery['documents'][index]['sha256'] or
                receipt['conversation_id']!=draft['conversation']):raise OperatorError('Upload lifecycle mismatch')
            delivery['refs'].append({'document_id':receipt['document_id'],'sha256':receipt['sha256']})
            draft['stage']='created'
        else:
            # Generation includes attachment/target edits; equal text alone does
            # not authorize clearing a draft changed away and back during I/O.
            if pending['action'] in ('follow','queue') and draft['generation']==pending['generation']:
                draft['text']='';draft['attachments']=[];draft['documents']=[];draft['generation']+=1
            if pending['action'] in ('follow','queue'):draft['delivery']=None
            draft['stage']='draft'
        draft['pending']=None;self.save()

    def inspect(self,draft):
        pending=draft['pending']
        if not pending:return None
        data=self.client.journal.find(pending['command_id'])
        if data is not None:
            self.client.validate_record(data['record'],self.workspace,principal_id=self.principal)
            record=data['record']
            if record['action']!=pending['action'] or ((record['action'] in ('follow','queue','document','stop','continue','seen','queue-cancel') or record['format']==5) and record['args'][0]!=draft['conversation']):
                raise OperatorError('Pending command/conversation binding mismatch')
            if record['action']=='document':
                delivery=draft['delivery']
                if delivery is None or len(delivery['refs'])>=len(delivery['documents']):raise OperatorError('Pending upload lifecycle missing')
                exact=delivery['documents'][len(delivery['refs'])]
                if any(record['body'].get(k)!=v for k,v in exact.items()):raise OperatorError('Pending upload differs from retained original')
        return data

    def recover_unprepared(self,draft):
        if self.inspect(draft) is not None:return False
        draft['pending']=None;draft['stage']='created' if draft['conversation'] else 'draft';self.save()
        return True

    def abandon_rejected(self,draft):
        data=self.inspect(draft)
        if not data or data['outcome']['state'] not in ('rejected','abandoned_rejection'):
            raise OperatorError('Only a verified definitive rejection can be abandoned; unknown effects stay locked')
        self.client.journal.outcome(data['record']['command_id'],'abandoned_rejection')
        draft['pending']=None
        draft['expected_work_version']=None
        draft['delivery']=None
        draft['stage']='refresh_required'
        self.save()
