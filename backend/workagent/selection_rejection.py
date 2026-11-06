"""Known terminal schema rejection is evidence, never an executable tool choice."""
import json
from hashlib import sha256
from .errors import DomainError

REASON=('Execution reached its configured selection phase limit after strict schema rejection. '
        'Rejected selections were not executed. Retained work and usage remain; the requested goal is incomplete.')
DETAIL=('This selection failed the unchanged strict schema and was NOT executed. '
        'Choose a NEW valid action. generated_text, when present, describes only the exact rejected UTF-8 bytes; '
        'its digest is computed by trusted code, not by the model. Reuse it only with those identical bytes. '
        'Changing Unicode or newlines changes the digest. This is not a file/reference hash or execution receipt.')

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)

def digest(value):
    return sha256(value.encode()).hexdigest()

def serialized_result(result):
    from .responses_ledger import parsed_data
    data=parsed_data(result)
    if result.rejection_diagnostic is not None:
        data['rejection_diagnostic']=result.rejection_diagnostic
    return data

def feedback(raw):
    doc=json.loads(raw)
    calls=[item for item in doc['output'] if item.get('type')=='function_call']
    if len(calls)!=1 or calls[0].get('name')!='choose_general_action':
        raise DomainError('action_unresolved')
    value=json.loads(calls[0]['arguments'])
    result={'code':'schema_validation_failed','detail':DETAIL,'generated_text':None}
    d=value.get('decision') if isinstance(value,dict) else None
    d=d if isinstance(d,dict) else {}
    source=d.get('source');source=source if isinstance(source,dict) else {}
    # Never infer an existing object's digest, or turn arguments into a DTO.
    if d.get('kind')=='files_create_draft' and source.get('kind')=='text' and isinstance(source.get('content'),str):
        text=source['content']
        result['generated_text']={'content':text,'utf8_bytes':len(text.encode()),'sha256':digest(text)}
    return result

def observation(request,result_row,raw,bound,worker_fence):
    from .responses_transport import parse_response,Provenance
    from .responses_ledger import parsed_data
    original=result_row['data'];doc=json.loads(raw)
    reproduced=parsed_data(parse_response(doc,request,Provenance(**original['provenance']),require_correlation=True))
    # Old results intentionally have no diagnostic; never rewrite them to add it.
    for record in (original,reproduced):
        if record['state']!='malformed' or record['issue']!='schema_validation_failed' or record['usage'] is None:
            raise DomainError('action_unresolved')
    if {k:v for k,v in reproduced.items() if k!='rejection_diagnostic'}!={k:v for k,v in original.items() if k!='rejection_diagnostic'}:
        raise DomainError('action_unresolved')
    number=1 if request.phase=='selection' else int(request.phase.split('_')[1])
    return dict(version='selection-rejection/v1',worker_fence=worker_fence,result_event_id=result_row['id'],
        result_sha256=digest(canonical(original)),request_sha256=request.sha256,
        response_id=original['response_id'],attempt_id=request.metadata.attempt_id,phase=request.phase,
        diagnostic_sha256=digest(raw),terminal_outcome='step_limit' if number==bound else 'continue',feedback=feedback(raw))

def valid(c,attempt_id,phase):
    """Read-only binding of the SQL-authenticated, known-unexecuted receipt.

    An event name alone is not proof. Keep the original malformed result and
    usage intact; this recognizes its disposition, not an executable choice.
    """
    step=c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s AND phase=%s',
        (attempt_id,phase)).fetchone()
    rows=c.execute('SELECT id,kind,data FROM responses_events WHERE attempt_id=%s AND phase=%s',
        (attempt_id,phase)).fetchall()
    events={r['kind']:r['data'] for r in rows}
    if (not step or not {'count_send','count_result','dispatch','identity','result','selection_rejection'}<=events.keys()
            or {'tool_result','file_input_rejection','corrected_readback','cancelled_unapplied','cancel','problem'} & events.keys()):
        return False
    result=events['result'];proof=events['selection_rejection'];identity=events['identity'];count=events['count_result']
    original=next(r for r in rows if r['kind']=='result')
    raw=result.get('rejection_diagnostic')
    if raw is None:
        imported=c.execute('SELECT diagnostic_bytes FROM selection_rejection_diagnostics WHERE result_event_id=%s',
            (original['id'],)).fetchone()
        raw=imported['diagnostic_bytes'] if imported else None
    if (result.get('state')!='malformed' or result.get('issue')!='schema_validation_failed'
            or not isinstance(result.get('usage'),dict) or result.get('value') is not None
            or result.get('call_id') is not None or result.get('output_items')!='[]'
            or not identity.get('response_id') or result.get('response_id')!=identity['response_id']
            or count.get('input_tokens') is None or count.get('count_sha256')!=step['count_sha256']
            or any(events[k].get('request_sha256')!=step['request_sha256'] or events[k].get('metadata')!=step['metadata']
                   for k in ('result','identity','count_result'))
            or proof.get('version')!='selection-rejection/v1' or proof.get('attempt_id')!=attempt_id
            or proof.get('phase')!=phase or proof.get('result_event_id')!=original['id']
            or proof.get('result_sha256')!=digest(canonical(result))
            or proof.get('request_sha256')!=step['request_sha256'] or proof.get('response_id')!=identity['response_id']
            or proof.get('terminal_outcome') not in ('continue','step_limit')
            or not isinstance(raw,str) or proof.get('diagnostic_sha256')!=digest(raw)):
        return False
    return not c.execute('SELECT 1 FROM tool_attempts t JOIN provider_attempts a '
        'ON a.workspace_id=t.workspace_id AND a.run_id=t.run_id WHERE a.id=%s AND t.call_id=%s',
        (attempt_id,phase)).fetchone()


def retain(ledger,request,cap):
    from .general_responses import check_pins
    from .responses_ledger import encoded
    with ledger.service.db.transaction() as c:
        run,_,_=ledger._auth(c,cap)
        config=check_pins(c,run)
        c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',(run.workspace_id,run.id))
        row=c.execute("SELECT id,data FROM responses_events WHERE attempt_id=%s AND phase=%s AND kind='result'",(ledger.receipt.attempt_id,request.phase)).fetchone()
        if not row:raise DomainError('action_unresolved')
        raw=row['data'].get('rejection_diagnostic')
        if raw is None:
            imported=c.execute('SELECT diagnostic_bytes FROM selection_rejection_diagnostics WHERE result_event_id=%s',(row['id'],)).fetchone()
            if not imported:raise DomainError('action_unresolved')
            raw=imported['diagnostic_bytes']
        previous=ledger._events(c,request.phase).get('selection_rejection')
        data=observation(request,row,raw,config['responses']['max_steps'],
            previous['worker_fence'] if previous else cap.fence)
        if previous is None:
            ledger.event(c,request.phase,'selection_rejection',data)
        elif previous!=data:
            raise DomainError('command_conflict')
        return data

def stop(service,cap,receipt,phase):
    from .responses_ledger import Ledger
    from .general_responses import check_pins
    from .outcomes import acknowledge
    from .run_checkpoints import record
    ledger=Ledger(service,receipt)
    with service.db.transaction() as c:
        run,_,_=ledger._auth(c,cap);config=check_pins(c,run)
        number=1 if phase=='selection' else int(phase.split('_')[1])
        rejection=ledger._events(c,phase).get('selection_rejection')
        if number!=config['responses']['max_steps'] or not rejection or rejection['terminal_outcome']!='step_limit':
            raise DomainError('action_unresolved')
        c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',(run.workspace_id,run.id))
        p,run,cv=service._check_capability(c,cap)
        service._validate_general_context(c,cap)
        run.state='partial';run.stop_reason='step_limit';run.unresolved=[REASON]
        run.used_units+=1;run.lease_expires_at=None
        run.execution.provider_observation='received'
        service._store_run(c,run)
        record(service,c,run,cv,'final','settlement')
        service._event(c,p,run.workspace_id,'selection_schema_rejected',run.id)
        acknowledge(c,run.workspace_id,run.id)
        return run
