"""Lossless storage, compact NEW model inputs, and whole-request estimates.

This never edits the frozen domain context, retained requests, or tool receipts.
The local o200k estimate is NOT the model's authoritative token count. The existing
provider count of the exact prepared bytes remains mandatory before generation.
No tokenizer download, model call or other network access occurs here.
"""
from copy import deepcopy
from functools import lru_cache
from hashlib import sha256
import base64
import json
import logging
from pathlib import Path

from .errors import DomainError
from .service import canonical, digest

TOKENIZER_URL='https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken'
TOKENIZER_SHA256='446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d'
TOKENIZER_PATH=Path.home()/'.cache'/'workagent'/'o200k_base.tiktoken'
# o200k_base pattern from pinned tiktoken 0.12.0 (MIT). Construct directly from
# the verified LOCAL ranks so tiktoken cannot fetch assets on a worker path.
_PATTERN='|'.join([
    r"[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
    r"[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
    r'\p{N}{1,3}',r' ?[^\s\p{L}\p{N}]+[\r\n/]*',r'\s*[\r\n]+',r'\s+(?!\S)',r'\s+',
])
_INACTIVE={'waiting_person','waiting_event','blocked','paused','cancelled','taken_over'}
_GROWTH_HEADROOM=8000
_NOTICE=('Model-input projection only. Full saved records and human edits are unchanged. '
         'A body_reference points to an identical complete body at that JSON pointer in THIS input, '
         'not to a network location or new permission. Summarized lifecycles are incomplete; '
         'read_context section=work_area returns the full already-scoped frozen projection. '
         'Omitted older messages are not remembered instructions. Current human steering wins.')


@lru_cache(maxsize=1)
def _encoder():
    try:
        raw=TOKENIZER_PATH.read_bytes()
    except OSError:
        return None
    if sha256(raw).hexdigest()!=TOKENIZER_SHA256:
        return None
    import tiktoken
    ranks={base64.b64decode(token):int(rank) for token,rank in (line.split() for line in raw.splitlines())}
    return tiktoken.Encoding(name='workagent_o200k_base',pat_str=_PATTERN,mergeable_ranks=ranks,
                            special_tokens={'<|endoftext|>':199999,'<|endofprompt|>':200018})


def estimate(text):
    encoder=_encoder()
    return len(encoder.encode_ordinary(text)) if encoder else len(text.encode('utf-8'))


def _measure(value):
    text=canonical(value)
    return {'utf8_bytes':len(text.encode('utf-8')),'estimated_tokens':estimate(text)}


def request_metrics(request):
    """Size-only evidence. Component estimates are not additive provider billing."""
    payload=json.loads(request.count_body())
    components={name:_measure(payload.get(name)) for name in ('instructions','tools','text')}
    history=payload.get('input',[])
    try:
        context=json.loads(history[0]['content'])
    except (IndexError,KeyError,TypeError,ValueError):
        context={}
    names=('messages','work_area_context','target_body','dependencies','durable_work','adaptive','composition','saved_work')
    if isinstance(context,dict):
        components.update({name:_measure(context.get(name)) for name in names})
        components['other_context']=_measure({k:v for k,v in context.items() if k not in names})
    components['continuation_history']=_measure(history[1:])
    total=_measure(payload)
    return {'request_sha256':request.sha256,'phase':request.phase,
            'estimator':'o200k_base_local_estimate' if _encoder() else 'utf8_byte_upper_bound',
            'provider_count_authoritative':True,'component_estimates_additive':False,
            'estimated_input_tokens':total['estimated_tokens'],'input_utf8_bytes':total['utf8_bytes'],
            'components':components}


def _deduplicate_bodies(context):
    """Only recognized body slots; never replace arbitrary human text/JSON keys."""
    seen={}
    def visit(parent,key,path):
        body=parent.get(key)
        if not isinstance(body,dict) or 'title' not in body or not ('kind' in body or isinstance(body.get('blocks'),list)):
            return
        material=canonical(body); checksum=digest(body)
        if checksum in seen and seen[checksum][1]==material:
            parent[key]={'body_reference':{'path':seen[checksum][0],'sha256':checksum}}
        else:
            seen[checksum]=(path,material)
    target=context.get('target_body')
    if isinstance(target,dict):visit(target,'body','#/target_body/body')
    for i,dependency in enumerate(context.get('dependencies',[])):
        visit(dependency,'content',f'#/dependencies/{i}/content')
    for i,artifact in enumerate(context.get('work_area_context',{}).get('artifacts',[])):
        visit(artifact,'body',f'#/work_area_context/artifacts/{i}/body')
    for i,observation in enumerate(context.get('adaptive',{}).get('observations',[])):
        result=(observation.get('capability_result') or {}).get('result',{})
        capability=(observation.get('capability_result') or {}).get('capability')
        if capability=='read_saved_work':
            visit(result,'body',f'#/adaptive/observations/{i}/capability_result/result/body')
        elif capability=='read_context' and result.get('section')=='target' and isinstance(result.get('value'),dict):
            visit(result['value'],'body',f'#/adaptive/observations/{i}/capability_result/result/value/body')
        elif capability=='read_context' and result.get('section')=='work_area' and isinstance(result.get('value'),dict):
            for j,artifact in enumerate(result['value'].get('artifacts',[])):
                visit(artifact,'body',f'#/adaptive/observations/{i}/capability_result/result/value/artifacts/{j}/body')


def project_context(context):
    projected=deepcopy({k:v for k,v in context.items() if k not in ('instructions','tools')})
    # Evidence bodies are available through read_context; send only their bounded
    # manifest initially, avoiding duplicate attachments/proposals in every prompt.
    evidence=projected.get('evidence_context')
    if evidence:
        for section,groups in (('attachments',('items','sources')),('work_area',('proposals',))):
            for group in groups:
                for item in evidence[section][group]:
                    if not item['body_omitted']:
                        item['body']=None
                        item['body_in_read_context']=True
            evidence[section]['read']={'kind':'read_context','section':section}
    # Full detail reads stay full in observations; summarize ONLY the initial index.
    for item in projected.get('work_area_context',{}).get('responsibilities',[]):
        life=item.get('lifecycle')
        if (not isinstance(life,dict) or life.get('state') not in _INACTIVE
            or item.get('assignment_id')==(projected.get('responsibility') or {}).get('assignment_id')):
            continue
        summary={k:deepcopy(life[k]) for k in ('state','outcome_status','next_check_in_at','check_in_due','blocker','execution_status') if k in life}
        shortened=[]
        for name in ('current_outcome','next_action','wait'):
            value=deepcopy(life.get(name))
            if name=='current_outcome' and isinstance(value,str):
                if len(value)>320:shortened.append(name);value=value[:320]
            elif isinstance(value,dict):
                field='description' if name=='next_action' else 'reason'
                text=value.get(field)
                if isinstance(text,str) and len(text)>160:
                    shortened.append(name+'.'+field);value[field]=text[:160]
            summary[name]=value
        summary['truncated_fields']=shortened
        item.update(lifecycle=None,lifecycle_omitted=True,lifecycle_summary=summary,
                    details={'kind':'read_context','section':'work_area'})
    _deduplicate_bodies(projected)
    projected['input_projection']={'version':'compact-input-v1','notice':_NOTICE}
    return projected


def _log(request,metrics,limit,ceiling):
    logger=logging.getLogger(__name__)
    # Worker entrypoints need not enable general HTTP/debug logging to retain
    # these size-only measurements. No prompts, body fragments or URLs are logged.
    if not logger.handlers:
        logger.addHandler(logging.StreamHandler())
        logger.setLevel(logging.INFO)
        logger.propagate=False
    logger.info(json.dumps({'event':'request_input_budget','run_id':request.metadata.request_id,
        'input_limit':limit,'estimated_packing_ceiling':ceiling,**metrics},sort_keys=True))


def prepare_selection(context,*,instructions,read_schema,metadata,policy='general-responses-v1',phase='selection',input_limit=None):
    """Budget ALL fields at each fresh step; leave immutable prepared steps alone."""
    from .responses_transport import MAX_INPUT_TOKENS,build_tool_selection
    limit=MAX_INPUT_TOKENS if input_limit is None else input_limit
    # 10% estimate/formatting margin plus room for the next tool/response history.
    ceiling=limit-max(2500,limit//10)-_GROWTH_HEADROOM
    projected=project_context(context)
    messages=projected.get('messages',[])
    current_run=projected.get('run_id')
    protected={id(m) for m in messages if m.get('run_id')==current_run and m.get('author_kind') in ('human','system')}
    human=next((m for m in reversed(messages) if m.get('author_kind')=='human'),None)
    if human is not None:protected.add(id(human))
    # Trim whole oldest assistant messages first, then old human/system history.
    candidates=[m for kind in ('assistant','system','human') for m in messages
                if m.get('author_kind')==kind and id(m) not in protected]
    for index in range(len(candidates)+1):
        request=build_tool_selection(instructions=instructions,source_context=canonical(projected),
            read_schema=read_schema,metadata=metadata,policy=policy,phase=phase)
        metrics=request_metrics(request)
        if metrics['estimated_input_tokens']<=ceiling:
            _log(request,metrics,limit,ceiling)
            return request
        if index==len(candidates):
            _log(request,metrics,limit,ceiling)
            raise DomainError('budget_exhausted')
        old=candidates[index]
        projected['messages']=[m for m in projected['messages'] if m is not old]
        window=projected.setdefault('history_window',{'policy':'whole-request-human-first-v1','omitted_messages':0,'notice':_NOTICE})
        window['omitted_messages']+=1


def check_final(request,*,input_limit=None):
    """Finals keep ALL provider output/reasoning items; never silently truncate."""
    from .responses_transport import MAX_INPUT_TOKENS
    limit=MAX_INPUT_TOKENS if input_limit is None else input_limit
    ceiling=limit-max(2500,limit//10)
    metrics=request_metrics(request)
    _log(request,metrics,limit,ceiling)
    if metrics['estimated_input_tokens']>ceiling:
        raise DomainError('budget_exhausted')
    return request
