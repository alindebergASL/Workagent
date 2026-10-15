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


from .operator_journal import CommandJournal, OperatorError


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

    def request(self,path,body=None):
        req=urllib.request.Request(self.base+'/v1/workspaces'+path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json',
                     'X-Schema-Version':'workagent/v1','X-Request-Id':str(uuid.uuid4())},
            method='POST' if body is not None else 'GET')
        try:
            with self.opener.open(req,timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            try:
                code=json.load(exc).get('code','http_error')
                if not re.fullmatch('[a-z_]{1,80}',str(code)): code='http_error'
            except Exception:
                code='http_error'
            raise OperatorError(f'HTTP {exc.code}: {code}; inspect saved state before any new command') from None
        except (OSError,ValueError,http.client.HTTPException):
            raise OperatorError('Transport/readback unavailable; outcome may be unknown. No retry was sent') from None

    def all(self,path):
        items=[]; seen=set(); cursor=None
        while True:
            data=self.request(path+('?cursor='+identifier(cursor) if cursor else ''))
            items.extend(data['items']); cursor=data.get('next_cursor')
            if not cursor: return {'items':items,'next_cursor':None}
            if cursor in seen: raise OperatorError('Pagination did not advance')
            seen.add(cursor)

    def run(self,ws,action,args,*,command_id=None,announce=lambda x:None):
        root='/'+identifier(ws)
        if action in ('areas','conversations'):
            return self.all(root+('/work-areas' if action=='areas' else '/conversations'))
        if action in ('show','area','run','observation','artifact'):
            kind={'show':'conversations','area':'work-areas','run':'runs','observation':'observations','artifact':'artifacts'}[action]
            return self.request(root+'/'+kind+'/'+identifier(args[0]))
        if action in ('history','proposals'):
            return self.all(root+'/artifacts/'+identifier(args[0])+'/'+action)
        if action in ('replay','command'):
            if command_id is not None:
                raise OperatorError('Use replay ID or command ID without --command-id')
            data=self.journal.read(identifier(args[0]))
            record=data['record']
            self.validate_record(record,ws)
            if action=='command': return data
            return self.execute(record,announce)
        cid=identifier(command_id or str(uuid.uuid4()))
        # Refuse ID reuse before even fetching a new CAS version.
        self.journal.require_new(cid)
        version=None
        if action in ('follow','cancel','promote'):
            version=self.request(root+'/conversations/'+identifier(args[0]))['conversation']['work_version']
        path,fields=self.payload(action,args,version)
        if action in ('accept','dismiss'):
            proposals=self.all(root+'/artifacts/'+identifier(args[1])+'/proposals')['items']
            if not any(p['id']==args[0] and p['artifact_id']==args[1] for p in proposals):
                raise OperatorError('Proposal is not part of the inspected artifact')
        body={'schema_version':'workagent/v1','request_id':cid,'command_id':cid,**fields}
        record={'format':1,'command_id':cid,'base':self.base,'workspace':ws,
                'action':action,'args':list(args),'path':root+path,'body':body}
        self.journal.reserve(record) # durable, exclusive, BEFORE first POST
        return self.execute(record,announce)

    def payload(self,action,args,version):
        """Pure payload builder. Replay validates stored fields, never refreshes CAS."""
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

    def validate_record(self,record,ws):
        try:
            if (set(record)!={'format','command_id','base','workspace','action','args','path','body'} or
                    record['format']!=1 or record['base']!=self.base or record['workspace']!=ws):
                raise OperatorError('Command scope mismatch or corrupt record; replay refused')
            cid=identifier(record['command_id']); body=record['body']
            if not isinstance(body,dict) or not isinstance(record['args'],list) or not all(isinstance(a,str) for a in record['args']):
                raise OperatorError('Corrupt command envelope; replay refused')
            path,fields=self.payload(record['action'],record['args'],body.get('expected_work_version'))
            if (record['path']!='/'+identifier(ws)+path or
                    body!={'schema_version':'workagent/v1','request_id':cid,'command_id':cid,**fields}):
                raise OperatorError('Corrupt command envelope; replay refused')
        except (KeyError,TypeError,ValueError):
            raise OperatorError('Corrupt command envelope; replay refused') from None

    def execute(self,record,announce):
        cid=record['command_id']
        announce({'command_id':cid,'mode':'admission_only','state':'sending','automatic_retry':False,
                  'replay':'replay '+cid,'inspect':'command '+cid,
                  'journal':'Private disk record contains unredacted prompts and receipts, never the bearer token'})
        self.journal.outcome(cid,'outcome_unknown')
        try:
            saved=self.request(record['path'],record['body'])
            self.journal.outcome(cid,'readback_unknown',saved)
            observed=self.readback(record,saved)
            self.journal.outcome(cid,'confirmed',saved)
        except (OperatorError,KeyError,TypeError,ValueError) as exc:
            # The durable record already states the last confirmed boundary. Do
            # not delete it, refresh a precondition, or send another write.
            reason=str(exc) if isinstance(exc,OperatorError) else 'Invalid response'
            raise OperatorError(f'{reason}. Command {cid}: outcome/readback may be unknown. Inspect with command {cid}; explicit exact replay: replay {cid}. No automatic retry was sent') from None
        return {'command_id':cid,'mode':'admission_only','worker_execution':'separate',
                'receipt':saved,'readback':observed}

    def readback(self,record,saved):
        root='/'+record['workspace']; action=record['action']; args=record['args']
        if action in ('create','chat'):
            return self.request(root+('/work-areas/' if action=='create' else '/conversations/')+identifier(saved['id']))
        if action in ('follow','cancel','promote'):
            return self.request(root+'/conversations/'+identifier(args[0]))
        if action in ('accept','dismiss'):
            proposal,artifact,_=args
            observed={'artifact':self.request(root+'/artifacts/'+artifact),
                      'proposals':self.all(root+'/artifacts/'+artifact+'/proposals')}
            status='accepted' if action=='accept' else 'dismissed'
            if not any(p['id']==proposal and p['status']==status for p in observed['proposals']['items']):
                raise OperatorError('Mutation readback mismatch; do not resubmit')
            return observed
        return self.request(root+'/runs/'+identifier(saved['run']['id']))
