"""Private, bounded, atomic local drafts. Contains content, never credentials.

The authenticated principal is supplied by the transport, never guessed from a
workspace owner or a bearer hash. One scope document makes Home creation and
selection transitions atomic. Command envelopes live in the separate journal.
"""
import copy
import os
import json
from pathlib import Path
from ..operator_journal import CommandJournal, OperatorError, digest, MAX_RECORDS


def new_draft():
    return dict(conversation=None, text='', attachments=[], target=None,
                generation=0, expected_work_version=None, pending=None, stage='draft',
                documents=[], delivery=None, continuity=None)


class DraftStore(CommandJournal):
    def __init__(self, endpoint, workspace, principal, *, path=None):
        if not all(isinstance(v,str) and v for v in (endpoint,workspace,principal)):
            raise OperatorError('Verified endpoint, workspace and principal required for drafts')
        self.scope=dict(endpoint=endpoint,workspace=workspace,principal=principal)
        self.key=digest(self.scope)
        self.last_digest=None
        self.path=str(path or os.environ.get('WORKAGENT_TUI_DRAFTS',
                      str(Path.home()/'.local/state/workagent-drafts')))

    read_limit = 32 * 1024 * 1024

    def record_limit(self,record):
        # Bound binary storage separately; ordinary draft metadata retains 1 MiB.
        state=copy.deepcopy(record.get('state',{}))
        for draft in state.get('drafts',{}).values():
            for doc in draft.get('documents',[]):doc.pop('content_base64',None)
            for doc in (draft.get('delivery') or {}).get('documents',[]):doc.pop('content_base64',None)
        if len(json.dumps(state).encode())>1024*1024:raise OperatorError('Ordinary draft state exceeds storage limit')
        return self.read_limit

    def validate(self, state):
        if not isinstance(state,dict) or set(state)!={'selected','drafts'}:
            raise OperatorError('Corrupt private drafts; restoration refused')
        if not isinstance(state['drafts'],dict) or len(state['drafts'])>64 or state['selected'] not in state['drafts']:
            raise OperatorError('Invalid or excessive private drafts')
        for key,draft in state['drafts'].items():
            if (not isinstance(key,str) or not isinstance(draft,dict) or set(draft)!=set(new_draft()) or
                not isinstance(draft['text'],str) or len(draft['text'])>10000 or
                type(draft['generation']) is not int or draft['generation']<0 or
                draft['stage'] not in ('draft','creating','created','following','reviewing','refresh_required')):
                raise OperatorError('Corrupt private draft; restoration refused')
            from ..operator_client import identifier
            try:
                identifier(key)
                if draft['conversation'] is not None:identifier(draft['conversation'])
            except (TypeError,OperatorError):
                if key!='__new__' or draft['conversation'] is not None:
                    raise OperatorError('Corrupt conversation draft identity') from None
            version=draft['expected_work_version']
            if version is not None and (type(version) is not int or not 1<=version<=2147483647):
                raise OperatorError('Corrupt displayed work version')
            if key!='__new__' and draft['conversation']!=key:
                raise OperatorError('Draft conversation key mismatch')
            from ..operator_attachments import validate_snapshots
            validate_snapshots(draft['attachments'])
            from ..operator_attachments import validate_documents
            validate_documents(draft['documents'])
            continuity=draft['continuity']
            if continuity is not None:
                if (not isinstance(continuity,dict) or set(continuity)!={'cursor','access_generation'} or
                    not isinstance(continuity['cursor'],str) or not 1<=len(continuity['cursor'])<=128 or
                    type(continuity['access_generation']) is not int or continuity['access_generation']<1):
                    raise OperatorError('Corrupt event scope')
            delivery=draft['delivery']
            if delivery is not None:
                if (not isinstance(delivery,dict) or set(delivery)!={'text','attachments','documents','target','generation','action','refs','version'} or
                    delivery['action'] not in ('follow','queue') or type(delivery['generation']) is not int or
                    not 0<=delivery['generation']<=draft['generation'] or not isinstance(delivery['text'],str) or
                    not delivery['text'].strip() or len(delivery['text'])>10000):raise OperatorError('Corrupt retained delivery')
                validate_documents(delivery['documents']);validate_snapshots(delivery['attachments'])
                from ..document_models import DocumentRef
                if not isinstance(delivery['refs'],list) or len(delivery['refs'])>len(delivery['documents']):raise OperatorError('Corrupt upload stages')
                try:
                    for i,ref in enumerate(delivery['refs']):
                        DocumentRef.model_validate(ref)
                        if ref['sha256']!=delivery['documents'][i]['sha256']:raise ValueError()
                    if delivery['target'] is not None:
                        from ..message_models import ExactTarget
                        ExactTarget.model_validate(delivery['target'])
                    if delivery['version'] is not None and (type(delivery['version']) is not int or delivery['version']<1):raise ValueError()
                except (ValueError,TypeError):raise OperatorError('Corrupt retained delivery scope') from None
            if draft['target'] is not None:
                from ..message_models import ExactTarget
                try:ExactTarget.model_validate(draft['target'])
                except ValueError:raise OperatorError('Corrupt draft target') from None
            if draft['pending'] is not None:
                pending=draft['pending']
                if (not isinstance(pending,dict) or set(pending)!={'command_id','action','generation'} or
                    pending['action'] not in ('chat','follow','accept','dismiss','document','queue','stop','continue','seen','queue-cancel','responsibility-pause','responsibility-resume','responsibility-takeover','conversation-cancel') or
                    type(pending['generation']) is not int or not 0<=pending['generation']<=draft['generation']):
                    raise OperatorError('Corrupt pending command identity')
                self.filename(pending['command_id'])
        return state

    def load(self):
        with self.directory() as fd:
            try:data=self._read(fd,self.key)
            except FileNotFoundError:
                self.last_digest=None
                return None
            record=data['record']
            if (set(record)!={'format','command_id','scope','state'} or record['format'] not in ('draft/v1','draft/v2') or
                    record['scope']!=self.scope):
                raise OperatorError('Private draft scope mismatch; restoration refused')
            state=copy.deepcopy(record['state'])
            if record['format']=='draft/v1':
                for draft in state['drafts'].values():
                    for key in ('documents','delivery','continuity'):
                        if key not in draft:draft[key]=copy.deepcopy(new_draft()[key])
            state=self.validate(state)
            self.last_digest=data['digest']
            return state

    def save(self,state):
        self.validate(state)
        record={'format':'draft/v2','command_id':self.key,'scope':self.scope,'state':state}
        with self.directory() as fd:
            try:
                previous=self._read(fd,self.key)
                if previous['record'].get('scope')!=self.scope or previous['digest']!=self.last_digest:
                    raise OperatorError('Draft changed in another session or scope; detach and reload before editing')
            except FileNotFoundError:
                if self.last_digest is not None:raise OperatorError('Private draft disappeared; save refused')
                if len(os.listdir(fd))>=MAX_RECORDS:raise OperatorError('Private draft store full')
            self._write(fd,self.key,{'record':record,'digest':digest(record),'outcome':{'state':'prepared'}},exclusive=False)
            self.last_digest=digest(record)
