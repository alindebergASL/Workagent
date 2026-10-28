"""HTTP-only operator client. No database, worker, provider or grant imports.

Credentials are environment-only. No redirect, proxy discovery or write retries.
A command's ID is emitted before sending; readback failure is ambiguous, not a
reason to issue another command. The operator may explicitly replay exact IDs.
"""
import http.client
import json
import os
import re
import urllib.error
import urllib.request
import uuid


from .operator_journal import CommandJournal, OperatorError, ReadUnavailable, DomainRejection, valid_rejection


def identifier(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}',value) or value=='..':
        raise OperatorError('Invalid identifier')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise OperatorError('Redirect refused')


class OperatorClient:
    def __init__(self):
        self.base=os.environ.get('WORKAGENT_OPERATOR_URL','http://127.0.0.1:8000')
        self.token=os.environ.get('LOCAL_BEARER_TOKEN','')
        if not re.fullmatch(r'http://(127\.0\.0\.1|localhost):[0-9]{1,5}',self.base) or len(self.token)<32:
            raise OperatorError('Private local API environment is required')
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        self.journal=CommandJournal()

    @staticmethod
    def wire_body(body, *, document_upload=False):
        # Keep historical JSON whitespace/ASCII escaping byte-for-byte on replay.
        # Preflight measures these actual UTF-8 wire bytes, including escapes.
        raw=json.dumps(body).encode('utf-8')
        if len(raw)>(8*1024*1024 if document_upload else 256000):
            raise OperatorError('Encoded request exceeds the '+('8 MiB document' if document_upload else '256,000 byte')+' API limit')
        return raw

    def identity(self,ws):
        """Require authenticated server identity; never substitute an object owner.

        Hosts must expose this header after authentication. Missing identity
        fails closed; test transports can implement the same trusted contract.
        """
        self.identity_execution=None
        identity=self.request('/identity')
        if 'principal_id' in identity and set(identity)!={'principal_id'}:
            raise OperatorError('Authenticated identity response is invalid')
        principal=identity.get('principal_id') or getattr(self,'authenticated_principal',None)
        header=getattr(self,'authenticated_principal',None)
        if header and principal!=header:raise OperatorError('Authenticated identity mismatch')
        if not principal:
            raise OperatorError('Authenticated principal identity unavailable; drafts and writes are locked')
        return identifier(principal)

    def request(self,path,body=None):
        req=urllib.request.Request(self.base+('/v1/identity' if path=='/identity' else '/v1/workspaces'+path),
            data=self.wire_body(body,document_upload=bool(re.fullmatch(r'/[^/]+/conversations/[^/]+/documents',path))) if body is not None else None,
            headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json',
                     'X-Schema-Version':'workagent/v1','X-Request-Id':body['request_id'] if body is not None else str(uuid.uuid4())},
            method='POST' if body is not None else 'GET')
        try:
            with self.opener.open(req,timeout=15) as response:
                headers=getattr(response,'headers',{})
                principal=headers.get('X-Workagent-Principal')
                self.authenticated_principal=identifier(principal) if principal else None
                raw=response.read(8*1024*1024+1)
                if len(raw)>8*1024*1024:raise OperatorError('HTTP response exceeds client read bound')
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            try:
                response=json.loads(exc.read(65536))
                rejection={'status':exc.code,'response':response}
                if (body is not None and exc.headers.get('X-Request-Id')==body.get('request_id')
                        and valid_rejection(rejection,body.get('request_id'),path=path)):
                    raise DomainRejection(rejection)
                code=response.get('code','http_error')
                if not re.fullmatch('[a-z_]{1,80}',str(code)): code='http_error'
            except DomainRejection:
                raise
            except Exception:
                code='http_error'
            error=ReadUnavailable if body is None and (exc.code>=500 or exc.code in (408,429)) else OperatorError
            raise error(f'HTTP {exc.code}: {code}; inspect saved state before any new command') from None
        except (OSError,ValueError,http.client.HTTPException) as exc:
            error=ReadUnavailable if body is None and not isinstance(exc,ValueError) else OperatorError
            raise error('Transport/readback unavailable; outcome may be unknown. No retry was sent') from None

    def download_document(self,ws,conversation,document,destination):
        from .document_models import MAX_ORIGINAL
        from .operator_attachments import save_download
        path='/'+identifier(ws)+'/conversations/'+identifier(conversation)+'/documents/'+identifier(document)
        detail=self.request(path)
        req=urllib.request.Request(self.base+'/v1/workspaces'+path+'/download',headers={
            'Authorization':'Bearer '+self.token,'X-Schema-Version':'workagent/v1','X-Request-Id':str(uuid.uuid4())})
        try:
            with self.opener.open(req,timeout=15) as response:
                raw=response.read(MAX_ORIGINAL+1)
                if (len(raw)!=detail['byte_length'] or len(raw)>MAX_ORIGINAL or
                    response.headers.get('Content-Type','').split(';')[0]!=detail['mime_type']):
                    raise OperatorError('Original download metadata mismatch')
        except (OSError,ValueError,http.client.HTTPException):raise OperatorError('Authorized original download unavailable; nothing saved') from None
        save_download(destination,raw,detail['sha256'])
        return detail

    def browse(self,path):
        """Finite UI discovery. A server cursor is visible when the sample ends."""
        items=[];seen=set();cursor=None
        for _ in range(16):
            data=self.request(path+('?cursor='+identifier(cursor) if cursor else ''))
            items.extend(data['items']);cursor=data.get('next_cursor')
            if not cursor:return {'items':items,'next_cursor':None}
            if cursor in seen:raise OperatorError('Pagination did not advance')
            seen.add(cursor)
        return {'items':items,'next_cursor':cursor}

    def all(self,path):
        items=[]; seen=set(); cursor=None
        while True:
            data=self.request(path+('?cursor='+identifier(cursor) if cursor else ''))
            items.extend(data['items']); cursor=data.get('next_cursor')
            if not cursor: return {'items':items,'next_cursor':None}
            if cursor in seen: raise OperatorError('Pagination did not advance')
            seen.add(cursor)

    def run(self,ws,action,args,*,command_id=None,announce=lambda x:None,
            acknowledge_removed_content=False,acknowledge_older_proposal=False,
            expected_work_version=None,attachments=None,principal_id=None,document_refs=None,document=None):
        if (principal_id is not None or expected_work_version is not None or attachments is not None or document_refs is not None or document is not None) and action not in ('replay','command','readback'):
            if principal_id is None:raise OperatorError('Authenticated principal required for explicit-version commands')
            record=self.prepare(ws,action,args,command_id=command_id,
                expected_work_version=expected_work_version,attachments=attachments,document_refs=document_refs,document=document,
                principal_id=principal_id,acknowledge_removed_content=acknowledge_removed_content,
                acknowledge_older_proposal=acknowledge_older_proposal)
            self.journal.reserve(record)
            return self.execute(record,announce)
        acknowledgements=self.acknowledgements(action,acknowledge_removed_content,acknowledge_older_proposal)
        root='/'+identifier(ws)
        if action in ('areas','conversations'):
            return self.all(root+('/work-areas' if action=='areas' else '/conversations'))
        if action in ('show','area','run','observation','artifact'):
            kind={'show':'conversations','area':'work-areas','run':'runs','observation':'observations','artifact':'artifacts'}[action]
            return self.request(root+'/'+kind+'/'+identifier(args[0]))
        if action in ('history','proposals'):
            return self.all(root+'/artifacts/'+identifier(args[0])+'/'+action)
        if action=='review':
            return self.review(root,args)
        if action in ('replay','command','readback'):
            if command_id is not None:
                raise OperatorError('Use replay ID or command ID without --command-id')
            data=self.journal.read(identifier(args[0]))
            record=data['record']
            self.validate_record(record,ws,principal_id=principal_id)
            if action=='command': return data
            if action=='readback':
                saved=data['outcome'].get('receipt')
                if saved is None:raise OperatorError('No retained receipt; inspect or explicitly replay the exact command')
                observed=self.readback(record,saved)
                self.journal.outcome(record['command_id'],'confirmed',saved)
                return {'command_id':record['command_id'],'receipt':saved,'readback':observed}
            return self.execute(record,announce)
        cid=identifier(command_id or str(uuid.uuid4()))
        # Refuse ID reuse before even fetching a new CAS version.
        self.journal.require_new(cid)
        version=None
        if action in ('follow','cancel','promote'):
            version=self.request(root+'/conversations/'+identifier(args[0]))['conversation']['work_version']
        path,fields=self.payload(action,args,version,**acknowledgements)
        if action in ('accept','dismiss'):
            proposals=self.all(root+'/artifacts/'+identifier(args[1])+'/proposals')['items']
            if not any(p['id']==args[0] and p['artifact_id']==args[1] for p in proposals):
                raise OperatorError('Proposal is not part of the inspected artifact')
        body={'schema_version':'workagent/v1','request_id':cid,'command_id':cid,**fields}
        record={'format':2,'command_id':cid,'base':self.base,'workspace':ws,
                'action':action,'args':list(args),'path':root+path,'body':body}
        self.journal.reserve(record) # durable, exclusive, BEFORE first POST
        return self.execute(record,announce)

    @staticmethod
    def acknowledgements(action,removed,older):
        if type(removed) is not bool or type(older) is not bool:
            raise OperatorError('Review acknowledgements must be explicit booleans')
        if action!='accept' and (removed or older):
            raise OperatorError('Review acknowledgements are only valid for a new accept command')
        return {'acknowledge_removed_content':removed,'acknowledge_older_proposal':older}

    def review(self,root,args):
        """Read exact candidate/base and the server's policy, never infer consent."""
        if len(args)!=3: raise OperatorError('Arguments: review proposal artifact revision')
        proposal,artifact,revision=map(identifier,args)
        proposals=self.all(root+'/artifacts/'+artifact+'/proposals')['items']
        candidate=next((p for p in proposals if p['id']==proposal and p['artifact_id']==artifact),None)
        if candidate is None:
            raise OperatorError('Proposal is not part of the inspected artifact')
        if candidate.get('base_revision_id')!=revision or candidate.get('status')!='pending':
            raise OperatorError('Proposal base/status changed; inspect the exact candidate again')
        if not isinstance(candidate.get('review'),dict):
            raise OperatorError('Server review policy unavailable; review refused')
        base=self.request(root+'/artifacts/'+artifact+'?revision_id='+revision)
        if (base.get('id')!=artifact or base.get('current_revision_id')!=revision or
                base.get('current_revision',{}).get('id')!=revision):
            raise OperatorError('Artifact base changed; review refused')
        return {'proposal':candidate,'base':base,'review':candidate['review'],
                'next_action':'Compare the full candidate and base before accept. Select each acknowledgement explicitly; accepting does not complete the goal or publish externally.'}

    def payload(self,action,args,version,*,acknowledge_removed_content=False,acknowledge_older_proposal=False):
        """Format-2 builder. Defaults are explicit; replay sends the stored body."""
        acknowledgements=self.acknowledgements(action,acknowledge_removed_content,acknowledge_older_proposal)
        path,fields=self.payload_v1(action,args,version)
        if action=='accept': fields.update(acknowledgements)
        return path,fields

    def payload_v1(self,action,args,version):
        """FROZEN format-1 validation grammar. Never add new fields/defaults here.

        This reconstructs only an expected value for validation. The original
        journal body (including absent flags and empty attachments) is sent.
        """
        counts={'create':3,'chat':1,'follow':2,'cancel':1,'promote':4,'accept':3,'dismiss':3,'revise':4}
        if action not in counts or (len(args)!=counts[action] and not (action=='follow' and len(args)==5)):
            raise OperatorError('Invalid command arguments')
        if action=='create':
            title,goal,kind=args
            return '/work-areas',{'title':title,'goal':goal,'kind':kind,'selected_source_refs':[]}
        if action=='chat':
            return '/conversations',{'title':args[0],'selected_source_refs':[]}
        if action in ('follow','cancel','promote'):
            if type(version) is not int or version < 0: raise OperatorError('Invalid saved CAS version')
            conversation=identifier(args[0]); path='/conversations/'+conversation
            if action=='cancel':
                return path+'/cancel',{'expected_work_version':version}
            if action=='promote':
                return '/work-areas/'+conversation,{'expected_work_version':version,'title':args[1],'goal':args[2],'kind':args[3]}
            target=None
            if len(args)>2:
                target={'artifact_id':identifier(args[2]),'revision_id':identifier(args[3]),'body_hash':args[4]}
                if not re.fullmatch('[a-f0-9]{64}',args[4]): raise OperatorError('Exact target hash required')
            return path+'/messages',{'expected_work_version':version,'text':args[1],'target':target,'attachments':[]}
        if action in ('accept','dismiss'):
            proposal,artifact,revision=map(identifier,args)
            fields={'expected_current_revision_id':revision}
            if action=='dismiss': fields['resolution']='dismiss'
            return '/proposals/'+proposal+'/'+action,fields
        artifact,revision,version,text=args
        return '/artifacts/'+identifier(artifact)+'/request-revision',{'base_revision_id':identifier(revision),'expected_work_version':int(version),'instruction':text}

    def prepare(self,ws,action,args,*,command_id=None,expected_work_version=None,
                attachments=None,principal_id,acknowledge_removed_content=False,
                acknowledge_older_proposal=False,document_refs=None,document=None):
        """Format 3: caller-displayed CAS, snapshots and authenticated principal.

        Pure preflight: does not reserve an ID or perform HTTP. A UI can persist
        its pending pointer, reserve this exact record, then execute it once.
        """
        from .tui.lifecycle import ACTIONS
        if action in ACTIONS:
            from .tui.lifecycle import build
            if attachments or document_refs is not None or document is not None or acknowledge_removed_content or acknowledge_older_proposal:
                raise OperatorError('Lifecycle controls cannot carry message or review fields')
            return build(self,ws,action,args,command_id=command_id or str(uuid.uuid4()),principal_id=principal_id,
                         expected_work_version=expected_work_version)
        if action in ('seen','stop','continue','queue','queue-cancel','document') or document_refs is not None:
            from .tui.commands import build
            if acknowledge_removed_content or acknowledge_older_proposal:raise OperatorError('Review consent is not valid for this command')
            return build(self,ws,action,args,command_id=command_id or str(uuid.uuid4()),principal_id=principal_id,
                expected_work_version=expected_work_version,attachments=attachments,document_refs=document_refs,document=document)
        if not isinstance(args,(list,tuple)) or not all(isinstance(value,str) for value in args):
            raise OperatorError('Invalid command arguments')
        if action=='chat' and (len(args)!=1 or not args[0] or len(args[0])>240):
            raise OperatorError('Conversation title must contain 1–240 characters')
        principal=identifier(principal_id); ws=identifier(ws)
        cid=identifier(command_id or str(uuid.uuid4()))
        if action not in ('chat','follow','accept','dismiss'):
            raise OperatorError('Unsupported conversational mutation')
        path,fields=self.payload(action,args,expected_work_version,
            acknowledge_removed_content=acknowledge_removed_content,
            acknowledge_older_proposal=acknowledge_older_proposal)
        if action=='follow':
            from .operator_attachments import validate_snapshots
            if type(expected_work_version) is not int or expected_work_version<1:
                raise OperatorError('Displayed work version required; refresh explicitly')
            if not isinstance(args[1],str) or not args[1].strip() or len(args[1])>10000:
                raise OperatorError('Message must contain text and at most 10,000 characters')
            fields['attachments']=validate_snapshots(attachments or [])
        elif attachments:
            raise OperatorError('Attachments require a message')
        body={'schema_version':'workagent/v1','request_id':cid,'command_id':cid,**fields}
        self.wire_body(body)
        return {'format':3,'command_id':cid,'base':self.base,'workspace':ws,
                'principal_id':principal,'action':action,'args':list(args),'path':'/'+ws+path,'body':body}

    def validate_v3(self,record,ws,principal_id):
        try:
            if type(record.get('format')) is not int:raise OperatorError('Invalid command format')
            body=record['body']
            rebuilt=self.prepare(ws,record['action'],record['args'],command_id=record['command_id'],
                expected_work_version=body.get('expected_work_version'),attachments=body.get('attachments'),
                principal_id=principal_id,
                acknowledge_removed_content=body.get('acknowledge_removed_content',False),
                acknowledge_older_proposal=body.get('acknowledge_older_proposal',False))
            if rebuilt!=record:raise OperatorError('Command principal/scope/body mismatch; replay refused')
        except (KeyError,TypeError,ValueError):
            raise OperatorError('Corrupt format-3 command; replay refused') from None

    def validate_record(self,record,ws,*,principal_id=None):
        if record.get('format')==5:
            from .tui.lifecycle import validate
            return validate(self,record,ws,principal_id)
        if record.get('format')==4:
            from .tui.commands import validate
            return validate(self,record,ws,principal_id)
        if record.get('format')==3:
            return self.validate_v3(record,ws,principal_id)

        try:
            if (set(record)!={'format','command_id','base','workspace','action','args','path','body'} or
                    record['format'] not in (1,2) or record['base']!=self.base or record['workspace']!=ws):
                raise OperatorError('Command scope mismatch or corrupt record; replay refused')
            cid=identifier(record['command_id']); body=record['body']
            if not isinstance(body,dict) or not isinstance(record['args'],list) or not all(isinstance(a,str) for a in record['args']):
                raise OperatorError('Corrupt command envelope; replay refused')
            if record['format']==1:
                path,fields=self.payload_v1(record['action'],record['args'],body.get('expected_work_version'))
            else:
                acknowledgements={}
                if record['action']=='accept':
                    acknowledgements={key:body[key] for key in ('acknowledge_removed_content','acknowledge_older_proposal')}
                path,fields=self.payload(record['action'],record['args'],body.get('expected_work_version'),**acknowledgements)
            if (record['path']!='/'+identifier(ws)+path or
                    body!={'schema_version':'workagent/v1','request_id':cid,'command_id':cid,**fields}):
                raise OperatorError('Corrupt command envelope; replay refused')
        except (KeyError,TypeError,ValueError):
            raise OperatorError('Corrupt command envelope; replay refused') from None

    def execute(self,record,announce):
        cid=record['command_id']
        retained=self.journal.read(cid)
        if retained['record']!=record:raise OperatorError('Dispatch differs from exact reserved journal record')
        prior=retained['outcome']
        if prior['state'] in ('rejected','abandoned_rejection'):
            raise OperatorError('Definitively rejected command; explicitly abandon, refresh and send a new attempt')
        announce({'command_id':cid,'mode':'admission_only','state':'sending','automatic_retry':False,
                  'replay':'replay '+cid,'inspect':'command '+cid,
                  'journal':'Private disk record contains unredacted prompts and receipts, never the bearer token'})
        self.journal.outcome(cid,'outcome_unknown')
        try:
            try:
                saved=self.request(record['path'],record['body'])
            except DomainRejection as exc:
                # A later rejection cannot settle an earlier ambiguous POST.
                if prior['state']=='prepared':
                    self.journal.outcome(cid,'rejected',rejection=exc.rejection)
                    raise OperatorError(str(exc)+'; explicit abandonment is available in Recovery') from None
                raise
            self.journal.outcome(cid,'readback_unknown',saved)
            observed=self.readback(record,saved)
            self.journal.outcome(cid,'confirmed',saved)
        except (OperatorError,KeyError,TypeError,ValueError) as exc:
            # The durable record already states the last confirmed boundary. Do
            # not delete it, refresh a precondition, or send another write.
            if self.journal.read(cid)['outcome']['state']=='rejected':
                raise OperatorError(f'Command {cid} rejected. Inspect and explicitly abandon in Recovery, then Refresh and Send again. No retry was sent') from None
            reason=str(exc) if isinstance(exc,OperatorError) else 'Invalid response'
            raise OperatorError(f'{reason}. Command {cid}: outcome/readback may be unknown. Inspect with command {cid}; explicit exact replay: replay {cid}. No automatic retry was sent') from None
        return {'command_id':cid,'mode':'admission_only','worker_execution':'separate',
                'receipt':saved,'readback':observed}

    def readback(self,record,saved):
        root='/'+record['workspace']; action=record['action']; args=record['args']
        if record['format']==5:
            from .tui.lifecycle import readback
            return readback(self,record,saved)
        if record['format']==4 and action!='follow':
            from .tui.commands import readback
            return readback(self,record,saved)
        if action in ('create','chat'):
            return self.request(root+('/work-areas/' if action=='create' else '/conversations/')+identifier(saved['id']))
        if action in ('follow','cancel','promote'):
            observed=self.request(root+'/conversations/'+identifier(args[0]))
            if action=='follow' and record['format'] in (3,4):
                message=saved.get('message',{}); body=record['body']
                retained=next((m for m in observed.get('messages',[]) if m.get('id')==message.get('id')),None)
                if (not message.get('id') or retained!=message or message.get('text')!=body['text'] or
                    message.get('target')!=body['target'] or
                    [{k:a.get(k) for k in ('filename','mime_type','content')} for a in message.get('attachments',[])]!=body['attachments']):
                    raise OperatorError('Exact message readback mismatch; draft retained')
                if record['format']==4 and [{k:d[k] for k in ('document_id','sha256')} for d in message.get('document_refs',[])]!=body['document_refs']:
                    raise OperatorError('Exact document references readback mismatch; draft retained')
            return observed
        if action in ('accept','dismiss'):
            proposal,artifact,_=args
            observed={'artifact':self.request(root+'/artifacts/'+artifact),
                      'proposals':self.all(root+'/artifacts/'+artifact+'/proposals')}
            status='accepted' if action=='accept' else 'dismissed'
            if not any(p['id']==proposal and p['status']==status for p in observed['proposals']['items']):
                raise OperatorError('Mutation readback mismatch; do not resubmit')
            return observed
        return self.request(root+'/runs/'+identifier(saved['run']['id']))
