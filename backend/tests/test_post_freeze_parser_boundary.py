"""Actual pure parser -> terminal/collector/worker boundary, no network or DB."""
from copy import deepcopy
from hashlib import sha256
from types import SimpleNamespace as N
from unittest.mock import MagicMock,patch
import pytest
from test_responses_transport import selection,final_request,response,SYNTHETIC
from workagent.responses_transport import parse_response
from workagent.responses_ledger import parsed_data
from workagent.general_responses import terminal_failure_bound,terminal_response_failure,TERMINAL_OUTPUT_ISSUES
from workagent.general_worker import GeneralWorker
from workagent.errors import DomainError
from post_freeze_packets import require_observed


INDETERMINATE={
    'correlation':'response_correlation_mismatch','envelope':'response_contract_mismatch',
    'unknown_status':'invalid_terminal_response','missing_status':'invalid_terminal_response',
    'usage':'invalid_usage','missing_usage':'invalid_terminal_response',
    'completed_error':'invalid_terminal_response','invalid_json':'invalid_json',
}


def damage_document(doc,case):
    doc=deepcopy(doc)
    if case=='correlation':doc.update(status='in_progress',metadata={'request_id':'other'})
    elif case=='envelope':doc.update(status='in_progress',object='not_response')
    elif case=='unknown_status':doc['status']='unrecognized'
    elif case=='missing_status':doc.pop('status')
    elif case=='usage':doc.update(status='in_progress',usage={'input_tokens':'not-integer'})
    elif case=='missing_usage':doc['usage']=None
    elif case=='completed_error':doc['error']={'code':'server_error'}
    else:raise AssertionError(case)
    return doc


def parsed_case(case,phase='selection'):
    req=selection() if phase=='selection' else final_request()
    doc=response(metadata=req.metadata.model_dump())
    if phase=='final':doc['output']=[dict(type='message',role='assistant',content=[dict(type='output_text',text='{"title":"Retained"}')])]
    if case in INDETERMINATE:
        if case=='invalid_json':
            # Actual schema argument parsing after the completed response; still
            # deliberately conservative, as invalid_json is not allowlisted.
            if phase=='selection':doc['output'][-1]['arguments']='{'
            else:doc['output'][0]['content'][0]['text']='{'
        else:doc=damage_document(doc,case)
    elif case in ('incomplete','failed','cancelled','queued','in_progress'):doc['status']=case
    elif case=='refused':doc['output']=[dict(type='message',role='assistant',content=[dict(type='refusal',refusal='No.')])]
    elif case=='invalid_output':doc['output']=None
    elif case=='unfinished_output_item':doc['output'][0]['status']='in_progress'
    elif case=='invalid_function_call':doc['output']=[dict(type='function_call',name='wrong',arguments='{}',call_id='call_x')]
    elif case=='invalid_reasoning_item':doc['output']=[dict(type='reasoning',id=3,summary=[])]
    elif case=='invalid_message':doc['output']=[dict(type='message',role='user',content=[])]
    elif case=='unsupported_output_item':doc['output']=[dict(type='not_supported')]
    elif case=='expected_single_scoped_call':doc['output']=[]
    elif case=='expected_structured_output':doc['output']=[]
    elif case=='schema_validation_failed':
        if phase=='selection':doc['output'][-1]['arguments']='{"source_id":false}'
        else:doc['output'][0]['content'][0]['text']='{"title":false}'
    else:raise AssertionError(case)
    parsed=parse_response(doc,req,SYNTHETIC,require_correlation=True)
    step=dict(request_sha256=req.sha256,count_sha256=sha256(req.count_body()).hexdigest(),metadata=req.metadata.model_dump())
    common=dict(request_sha256=req.sha256,metadata=req.metadata.model_dump())
    events=dict(count_send={},count_result=dict(common,count_sha256=step['count_sha256']),dispatch={},
        identity=dict(common,response_id=parsed.response_id),result=parsed_data(parsed))
    return req,parsed,step,events


@pytest.mark.parametrize('phase',['selection','final'])
@pytest.mark.parametrize('case',list(INDETERMINATE))
def test_actual_parser_indeterminate_denies_terminal_worker_and_collector(case,phase):
    req,parsed,step,events=parsed_case(case,phase)
    assert parsed.state=='malformed' and parsed.issue==INDETERMINATE[case]
    assert not terminal_failure_bound(step,events)
    with pytest.raises(DomainError,match='action_unresolved'):require_observed(step,events)
    w=GeneralWorker.__new__(GeneralWorker);w.service=MagicMock();run=N(state='running');w.service.get_run.return_value=run
    w._terminal_readback=MagicMock()
    before=deepcopy(events)
    with patch('workagent.general_responses.stop_terminal_response') as stop:
        for _ in range(2):assert w._terminal_or_pending(None,'ws','run',None,None,phase,parsed) is run
    stop.assert_not_called();w._terminal_readback.assert_not_called()
    assert events==before


@pytest.mark.parametrize('case',sorted(TERMINAL_OUTPUT_ISSUES))
def test_actual_parser_allowlist_reached_only_after_terminal_correlation(case):
    phase='final' if case=='expected_structured_output' else 'selection'
    _,parsed,step,events=parsed_case(case,phase)
    assert parsed.state=='malformed' and parsed.issue==case
    assert terminal_failure_bound(step,events);require_observed(step,events)
    events['result']['issue']='future_unreviewed_parser_issue'
    assert not terminal_failure_bound(step,events)
    with pytest.raises(DomainError):require_observed(step,events)


@pytest.mark.parametrize('state',['incomplete','failed','cancelled','refused','queued','in_progress'])
def test_actual_parser_terminal_and_pending_controls(state):
    _,parsed,step,events=parsed_case(state)
    known=state not in ('queued','in_progress')
    assert terminal_failure_bound(step,events)==known
    assert terminal_response_failure(parsed.state,parsed.issue)==known
    if known:require_observed(step,events)
    else:
        with pytest.raises(DomainError):require_observed(step,events)
