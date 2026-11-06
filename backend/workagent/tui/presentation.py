"""Readable inert products and server policy; JSON belongs only in Details."""
import json
from .safe_text import literal


def prose(value):
    if value is None:return 'unknown'
    if isinstance(value,bool):return 'yes' if value else 'no'
    if isinstance(value,dict):return '\n'.join(literal(k.replace('_',' '))+': '+prose(v) for k,v in value.items())
    if isinstance(value,list):return '\n'.join(prose(v) for v in value)
    return literal(value)


def body_text(body):
    if not isinstance(body,dict):return prose(body)
    lines=[literal(body.get('title','Untitled'))]
    if 'blocks' in body:
        for block in body['blocks']:
            prefix={'heading':'\n','checklist':'[x] ' if block.get('checked') else '[ ] ',
                    'protected_note':'Human protected note: '}.get(block.get('kind'),'')
            lines.append(prefix+literal(block.get('text','')))
    elif body.get('kind') in ('structured_table','table'):
        fields=body.get('fields') or [{'key':k,'label':k} for k in body.get('columns',[])]
        # Stacked rows retain every cell at 80 columns without shrinking/truncation.
        for index,row in enumerate(body.get('rows',[]),1):
            cells={c['field_key']:c['value'] for c in row['cells']} if 'cells' in row else row
            lines.append('\nRow '+str(index))
            for field in fields:
                lines.append(literal(field['label'])+': '+prose(cells.get(field['key']))+
                             (' '+literal(field['unit']) if field.get('unit') else ''))
        lines.extend('Note: '+literal(n) for n in body.get('notes',[]))
        if 'source_csv' in body:lines.extend(['\nRetained source CSV',literal(body['source_csv'])])
    elif body.get('kind')=='custom_view':
        lines.extend([literal(body.get('fallback','')), '\nSource (inert; never executed)',prose(body.get('source',{}))])
    elif 'content' in body:lines.extend([literal(body.get('filename','')),literal(body['content'])])
    else:lines.append(prose({k:v for k,v in body.items() if k!='title'}))
    return '\n'.join(lines)


def revision_label(revision,current_id):
    current=revision['id']==current_id
    return ('Current saved' if current else 'Earlier')+' · revision '+str(revision['revision_number'])+' · '+literal(revision['author_kind'])+' · '+literal(revision.get('created_at',''))


def proposal_label(proposal):
    policy=proposal.get('review') or {}
    return ('Latest candidate' if policy.get('is_latest') else 'Earlier candidate')+' · '+literal(proposal['status'])+' · '+literal(proposal.get('created_at',''))+' · '+literal(proposal.get('reason',''))


def review_identity(current,proposal):
    return json.dumps([current['current_revision_id'],current['current_revision']['body_hash'],
                      proposal['id'],proposal['base_revision_id'],proposal['body_hash'],
                      proposal['status'],proposal.get('review')],sort_keys=True)


def comparison_text(current,base,proposal):
    policy=proposal.get('review')
    lines=['CURRENT SAVED · '+literal(current['current_revision']['author_kind']),
           body_text(current['current_revision']['body']), '\nEXACT PROPOSAL BASE',body_text(base['body']),
           '\nPROPOSED · '+proposal_label(proposal),body_text(proposal['body'])]
    if policy is None:lines.append('Server review policy unavailable. Acceptance disabled.')
    else:
        lines.append('\nServer structural review: '+str(policy['removed_content_count'])+
                     ' total removed/replaced members; '+str(len(policy['removed_content']))+' displayed samples.')
        lines.extend(literal(item['path'])+': '+literal(item['before']) for item in policy['removed_content'])
        if proposal['base_revision_id']!=current['current_revision_id']:
            lines.append('STALE: base differs from current saved revision. Acceptance cannot rebase this candidate.')
    return '\n\n'.join(lines)


def execution_text(execution,detail=None,context=None):
    lines=['Workspace execution: '+literal(execution.get('state','unknown'))+
           ' · server checked '+literal(execution.get('checked_at','unknown'))]
    runs={r['run_id']:r for r in execution.get('runs',[])}
    latest=max((detail or {}).get('runs',[]),key=lambda r:r.get('observed_at',''),default=None)
    if latest:
        status=runs.get(latest['id'])
        lines.append('This conversation: '+(prose(status) if status else 'not in bounded execution sample; current execution unknown'))
        provenance=latest.get('execution') or {}
        lines.append('Model: '+prose(provenance.get('model','unknown'))+' · reservation: '+
                     prose(provenance.get('reservation','not exposed'))+' · usage: '+prose(provenance.get('usage','unknown')))
    if latest:
        turn=next((t for t in (detail or {}).get('turns',[]) if t['run_id']==latest['id']),None)
        if turn:
            lines.append('Provider observation: '+prose(turn.get('provider_observation','unknown')))
            for step in turn.get('response_steps',[]):
                lines.append('Phase '+prose(step['phase'])+': '+prose(step['state'])+
                             ' · reserved USD '+prose(step.get('reserved_cost_usd'))+
                             ' (reservation, not billing) · billed USD '+prose(step.get('billed_cost_usd')))
            adaptive=turn.get('adaptive')
            if adaptive:
                lines.append('Shared reserved USD '+prose(adaptive.get('shared_reserved_cost_usd'))+
                             ' (not billing) · outcome '+prose(adaptive.get('outcome')))
    for item in (context or {}).get('responsibilities',[]):
        lines.append('Responsibility: '+prose(item.get('lifecycle') or 'details omitted by server'))
    if (context or {}).get('truncated'):lines.append('Work context is a bounded sample; some work is omitted.')
    return '\n'.join(lines)
