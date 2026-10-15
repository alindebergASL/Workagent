"""Bounded, revision-bound reads of current work through the existing journal.

An index is discovery, not edit permission. Omitted bodies become editable only
once a complete broker read was retained by this attempt in an earlier step.
The normal capability/context/exact-target checks still run on every use.
"""
from .errors import DomainError

MAX_READ_BYTES=32768  # Aggregate body bytes retained by one run's read capability.


def index(service,c,p,ws,cv,projection):
    from .general_responses import exact_target
    from .models import ExactTarget
    from .service import canonical
    from .product_models import FileBody
    items=[]
    for item in projection['artifacts']:
        # IDs come only from the frozen, same-conversation, authorized projection.
        row,owner=service._artifact(c,p,ws,item['artifact_id'])
        revision=service._revision(c,p,ws,row,owner,item['revision_id'])
        if isinstance(revision.body,FileBody): continue
        target=ExactTarget(**{k:item[k] for k in ('artifact_id','revision_id','body_hash')})
        exact_target(service,c,p,ws,cv,target)
        size=len(canonical(revision.body).encode())
        items.append({'target':target.model_dump(mode='json'),'title':revision.body.title,
            'kind':getattr(revision.body,'kind','document'),'body_bytes':size,
            'in_projection':not item['body_omitted'],'readable':size<=MAX_READ_BYTES,
            'author_kind':item['author_kind']})
    return {'items':items,'omitted_items':projection['omissions']['artifacts'],
            'read_limit_bytes':MAX_READ_BYTES,'scope':'current_conversation_snapshot'}


def authorize(context,message,target):
    selected=target.model_dump(mode='json')
    if message.author_kind!='human' or (message.target is not None and message.target.model_dump(mode='json')!=selected):
        raise DomainError('not_found_or_not_authorized')
    if not any(item['target']==selected for item in context.get('saved_work',{}).get('items',[])):
        raise DomainError('not_found_or_not_authorized')


def reads(c,attempt_id,phase):
    from .adaptive import retained
    # Phase names are bounded selection/selection_2..4; never admit current/future.
    def number(value): return 1 if value=='selection' else int(value.rsplit('_',1)[1])
    return [o['capability_result']['result'] for o in retained(c,attempt_id)
        if number(o['phase'])<number(phase) and
        (o.get('capability_result') or {}).get('capability')=='read_saved_work']


def was_read(c,attempt_id,phase,target):
    selected=target.model_dump(mode='json')
    return any(r['status']=='complete' and r['target']==selected for r in reads(c,attempt_id,phase))


def result(c,attempt_id,phase,target,base):
    from .service import canonical
    size=len(canonical(base.body).encode())
    used=sum(r['body_bytes'] for r in reads(c,attempt_id,phase) if r['status']=='complete')
    complete=size<=MAX_READ_BYTES-used
    return {'capability':'read_saved_work','version':'1','result':{
        'target':target.model_dump(mode='json'),'status':'complete' if complete else 'size_limit',
        'body':base.body.model_dump(mode='json') if complete else None,
        'body_bytes':size,'limit_bytes':MAX_READ_BYTES,'remaining_bytes':max(0,MAX_READ_BYTES-used-size) if complete else MAX_READ_BYTES-used,
        'provenance':'canonical_current_revision','author_kind':base.author_kind}}
