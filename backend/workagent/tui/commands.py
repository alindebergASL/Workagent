"""Additive format-4 command grammar. Formats 1–3 remain frozen."""
from ..operator_journal import OperatorError


def build(client, ws, action, args, *, command_id, principal_id, expected_work_version=None,
          attachments=None, document_refs=None, document=None):
    from ..operator_client import identifier
    from ..models import PostMessage, IngestDocument
    from ..checkpoint_models import StopRun, ContinueRun, CancelQueuedMessage
    from ..work_event_models import AttentionSeen
    cid=identifier(command_id); ws=identifier(ws); principal=identifier(principal_id)
    if not isinstance(args,(list,tuple)) or not all(isinstance(x,str) for x in args):
        raise OperatorError('Invalid command arguments')
    envelope={'schema_version':'workagent/v1','request_id':cid,'command_id':cid}
    counts={'seen':2,'stop':2,'continue':3,'queue-cancel':3,'document':1}
    try:
        if action in ('follow','queue'):
            path,fields=client.payload('follow',args,expected_work_version)
            fields['attachments']=attachments or []
            fields['document_refs']=document_refs or []
            PostMessage.model_validate({**envelope,**fields})
            if action=='queue':path=path.removesuffix('/messages')+'/queued-messages'
        else:
            if action not in counts or len(args)!=counts[action]:raise ValueError()
            conversation=identifier(args[0]);root='/conversations/'+conversation
            if action=='seen':
                path='/attention/seen';fields={'conversation_id':conversation,'cursor':args[1]};model=AttentionSeen
            elif action=='stop':
                path=root+'/stop';fields={'expected_work_version':expected_work_version,'run_id':identifier(args[1])};model=StopRun
            elif action=='continue':
                path=root+'/continue';fields={'expected_work_version':expected_work_version,'checkpoint_id':identifier(args[1]),'checkpoint_hash':args[2]};model=ContinueRun
            elif action=='queue-cancel':
                path=root+'/queued-messages/'+identifier(args[1])+'/cancel';fields={'expected_queue_version':int(args[2])};model=CancelQueuedMessage
            else:
                from ..document_models import DocumentInput
                fields=DocumentInput.model_validate(document).model_dump()
                if fields!=document:raise ValueError()
                path=root+'/documents';model=IngestDocument
            model.model_validate({**envelope,**fields})
        body={**envelope,**fields}
        client.wire_body(body,document_upload=action=='document')
    except (ValueError,TypeError,KeyError):
        raise OperatorError('Invalid exact continuity command; refresh and inspect its required fields') from None
    return {'format':4,'command_id':cid,'base':client.base,'workspace':ws,'principal_id':principal,
            'action':action,'args':list(args),'path':'/'+ws+path,'body':body}


def validate(client,record,ws,principal):
    try:
        b=record['body'];action=record['action']
        rebuilt=build(client,ws,action,record['args'],command_id=record['command_id'],principal_id=principal,
            expected_work_version=b.get('expected_work_version'),attachments=b.get('attachments'),
            document_refs=b.get('document_refs'),document={k:b[k] for k in ('filename','mime_type','content_base64','sha256')} if action=='document' else None)
        if type(record['format']) is not int or rebuilt!=record:raise OperatorError('Exact command scope/body mismatch')
    except (KeyError,TypeError,ValueError):raise OperatorError('Corrupt format-4 command; replay refused') from None


def readback(client,record,saved):
    from ..operator_client import identifier
    action=record['action'];args=record['args'];body=record['body']
    root='/'+record['workspace'];conversation=args[0];path=root+'/conversations/'+identifier(conversation)
    if action=='document':
        from ..document_models import DocumentDetail
        detail=DocumentDetail.model_validate(saved).model_dump(mode='json')
        observed=client.request(path+'/documents/'+identifier(detail['document_id']))
        if (observed!=saved or detail['conversation_id']!=conversation or detail['workspace_id']!=record['workspace'] or
            detail['owner_id']!=record['principal_id'] or any(detail[k]!=body[k] for k in ('filename','mime_type','sha256'))):
            raise OperatorError('Exact uploaded document readback mismatch')
        return observed
    if action=='seen':
        from ..work_event_models import AttentionSeenResult
        result=AttentionSeenResult.model_validate(saved)
        # A concurrent seen command may have advanced the monotonic server cursor.
        if result.conversation_id!=conversation:raise OperatorError('Attention receipt mismatch')
        return client.request(root+'/attention?conversation_id='+identifier(conversation))
    if action in ('stop','continue'):
        if action=='stop' and saved.get('id')!=body['run_id']:raise OperatorError('STOP run receipt mismatch')
        observed=client.request(root+'/runs/'+identifier(saved['id']))
        if observed.get('id')!=saved['id'] or observed.get('conversation_id')!=conversation:
            raise OperatorError('Exact run readback mismatch')
        return observed
    if action in ('queue','queue-cancel'):
        from ..checkpoint_models import QueuedMessage
        item=QueuedMessage.model_validate(saved).model_dump(mode='json')
        if item['conversation_id']!=conversation or item['owner_id']!=record['principal_id']:raise OperatorError('Queue scope mismatch')
        if action=='queue':
            # New default fields in backend DTOs are allowed; every sent field is exact.
            if any(item['intent'].get(k,[] if k=='document_refs' else None)!=v for k,v in body.items()):raise OperatorError('Queue intent mismatch')
        elif item['id']!=args[1] or item['state']!='cancelled':raise OperatorError('Queue cancellation mismatch')
        page=client.request(path+'/queued-messages?after='+str(item['position']-1))
        if not any(q['id']==item['id'] and q['intent']==saved['intent'] for q in page['items']):raise OperatorError('Exact queued message readback unavailable')
        return page
    raise OperatorError('Unsupported command readback')
