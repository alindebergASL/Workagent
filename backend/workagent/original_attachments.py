"""Original immutable attachment ranges; no path, network or resupply fallback."""
from hashlib import sha256
from .errors import DomainError, deny


def material(service,c,p,run,cv,decision):
    from .retained_results import authorize
    # The production caller has checked the current capability/fence and frozen
    # context. Bind discovery to that snapshot, never arbitrary message IDs.
    service._conversation(c,p,run.workspace_id,cv.id,True)
    if run.principal_id!=p.id or run.conversation_id!=cv.id or cv.owner_id!=p.id:
        deny()
    snapshot=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                       (run.workspace_id,run.id)).fetchone()
    offered=(snapshot or {}).get('data',{}).get('evidence_context',{}).get('attachments',{}).get('items',[])
    if not any(all(item.get(k)==getattr(decision,k) for k in ('message_id','ref','sha256')) for item in offered):
        deny()
    messages=service._conversation_messages(c,run.workspace_id,cv.id)
    message=next((m for m in messages if m.id==decision.message_id and m.author_kind=='human' and m.evidence_origin=='human'),None)
    if message is None: deny()
    authorize(service,c,p,run,cv,message.run_id)
    attachment=next((a for a in message.attachments if a.ref==decision.ref and a.sha256==decision.sha256),None)
    if attachment is None: deny()
    raw=attachment.content.encode('utf-8')
    if sha256(raw).hexdigest()!=decision.sha256 or len(raw)!=attachment.byte_length:
        raise DomainError('source_changed')
    return raw


def descriptor():
    from .composition import CapabilityDescriptor
    from .retained_results import ReadAttachment
    return CapabilityDescriptor(name='read_attachment',availability='available',
        scope='Original attachments offered in this run frozen evidence_context; same conversation and exact target',
        effects=['read_context'],input_schema=ReadAttachment.model_json_schema(),handler='read_attachment',
        reason='Original UTF-8 byte ranges, including omitted bodies; shared 8 pages / 32768 bytes with read_result.').model_dump(mode='json')


def projection(c,ws,messages):
    """Called only after conversation/source authorization; never infer from prose."""
    latest=next((m for m in reversed(messages) if m.author_kind in ('human','system')),None)
    if latest is None: return []
    snapshot=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,latest.run_id)).fetchone()
    if not snapshot: return []
    # Defense in depth: only immutable identities actually in this conversation.
    identities={(m.id,a.ref,a.sha256) for m in messages if m.author_kind=='human' for a in m.attachments}
    reads=c.execute('SELECT phase,data FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s ORDER BY created_at,phase',
                    (ws,latest.run_id)).fetchall()
    result=[]
    for item in snapshot['data'].get('evidence_context',{}).get('attachments',{}).get('items',[]):
        identity=tuple(item[k] for k in ('message_id','ref','sha256'))
        if identity not in identities: continue
        chunks=[]
        for row in reads:
            d=row['data']['decision']; page=row['data']['result']
            if d.get('kind')=='read_attachment' and tuple(d.get(k) for k in ('message_id','ref','sha256'))==identity:
                chunks.append({'phase':row['phase'],**{k:page[k] for k in ('offset','next_offset','chunk_sha256')}})
        result.append({'run_id':latest.run_id,**{k:item[k] for k in ('message_id','ref','sha256','filename','body_omitted','omission_reason')},'chunks':chunks})
    return result
