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


def authorize(context,message,target,*,c=None,attempt_id=None,phase=None,config=None):
    selected=target.model_dump(mode='json')
    from .composition import continuity_enabled
    if config and continuity_enabled(config):
        from .service import encoded
        if c.execute('SELECT saved_work_target_permitted(%s,%s,%s,false) ok',
                     (attempt_id,phase,encoded(selected))).fetchone()['ok']:
            return
        raise DomainError('not_found_or_not_authorized')
    if message.author_kind!='human' or (message.target is not None and message.target.model_dump(mode='json')!=selected):
        raise DomainError('not_found_or_not_authorized')
    if not any(item['target']==selected for item in context.get('saved_work',{}).get('items',[])):
        raise DomainError('not_found_or_not_authorized')


def discover(c,run,decision):
    # The same bounded, scoped query is recomputed by the SQL receipt guard.
    result=c.execute('SELECT saved_work_page(r,%s,%s) page FROM runs r WHERE workspace_id=%s AND id=%s',
        (decision.after_artifact_id,decision.limit,run.workspace_id,run.id)).fetchone()['page']
    return {'capability':'discover_saved_work','version':'1','result':result}


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


def revalidate_reads(service,c,p,run,cv):
    from .general_responses import exact_target
    from .models import ExactTarget
    rows=c.execute("SELECT e.data->'capability_result'->'result'->'target' AS target FROM responses_events e "
        "JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s "
        "AND e.kind='tool_result' AND e.data->'capability_result'->>'capability'='read_saved_work'",
        (run.workspace_id,run.id)).fetchall()
    for row in rows:
        exact_target(service,c,p,run.workspace_id,cv,ExactTarget.model_validate(row['target']))


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
