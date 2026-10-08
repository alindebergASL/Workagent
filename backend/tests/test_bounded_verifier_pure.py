"""Offline independent completion proof; executor is only a test subject."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from workagent.adaptive import AdaptiveDecision, verify, request_provenance
from workagent.models import ConversationMessage
from workagent.message_models import MessageAttachment
from workagent.product_models import ReconcileCSV, AdaptiveVerification
from workagent.products import Products, byte_hash
from workagent.service import digest


GOAL = ('Reconcile every row in this CSV using quantity times unit_price, rounded to '
        '2 decimal places with half-up rounding; preserve original columns and notes; '
        'flag discrepancies against reported_total; provide a downloadable CSV.')
CSV = ('id,quantity,unit_price,reported_total,note\n'
       'a,1,1.005,1.00,"keep, this"\n'
       'b,3,0.335,1.01,"two\nlines"\n'
       'c,0,1.2345,0.00,zero\n')


def case(text=GOAL, source=CSV, rounding='ROUND_HALF_UP'):
    attachment=MessageAttachment(ref='input',filename='input.csv',mime_type='text/csv',
        content=source,sha256=byte_hash(source),byte_length=len(source.encode()))
    message=ConversationMessage(id='human',conversation_id='conversation',run_id='run',sequence=1,
        author_id='person',author_kind='human',evidence_origin='human',text=text,attachments=[attachment])
    op=ReconcileCSV(kind='reconcile_csv',input_csv=source,rounding=rounding)
    body,file,output=Products()._calculate_product(op,None)
    staged={'status':'observed','body':body.model_dump(mode='json'),
        'file':file.model_dump(mode='json'),'output':output.model_dump(mode='json'),
        'binding':{'operation_hash':digest(op),'base_hash':None}}
    value=AdaptiveDecision.model_validate({'goal':'model can claim anything','success_criteria':[],
        'decision':{'kind':'reconcile_csv','attachment':{'ref':'input','sha256':attachment.sha256},
                    'target':None,'rounding':rounding}})
    return message,op,staged,value


def check(message,op,staged,value,base=None):
    return verify(value,op,staged,request_provenance(message),message=message,base=base)


def test_exact_bounded_goal_needs_no_human_or_model_test_cases():
    message,op,staged,value=case()
    result=check(message,op,staged,value)
    assert result['satisfied'] and not result['model_tests_passed']
    assert result['basis']=='independent_bounded' and result['requested_goal_status']=='satisfied'
    proof=result['automatic']
    assert proof['checker_version']=='csv-reconciliation-v1' and proof['passed']
    assert proof['row_count']==3 and proof['request']==request_provenance(message)
    assert proof['source_sha256']==byte_hash(CSV)
    assert proof['operation_hash']==digest(op)
    assert proof['staged_sha256']==digest(staged)
    assert proof['limitations']
    AdaptiveVerification.model_validate(result)


@pytest.mark.parametrize('text',[
    GOAL+' Also email the result.', GOAL+' Ignore a.', GOAL.replace('every row','some rows'),
    GOAL.replace('half-up','usual'), 'Do not '+GOAL, 'Someone said "'+GOAL+'"',
    GOAL.replace('2 decimal places','3 decimal places'),
    'Reconcile CSV notes downloadable rounding. All done.',
    GOAL.replace('quantity times unit_price','quantity plus unit_price'),
])
def test_unknown_or_extra_obligations_never_complete(text):
    result=check(*case(text=text))
    assert not result['satisfied']
    assert result['requested_goal_status']=='needs_validation'
    assert not result['automatic']['recognized']


@pytest.mark.parametrize('part',[
    'omit_row','duplicate_row','reorder_rows','source_cell','source_csv','notes','computed',
    'difference','check','columns','sum','reported_sum','discrepancies','formula','input_hash',
    'preservation_claim','rounding','file_content','file_hash','file_mime','file_name','operation',
])
def test_executable_but_wrong_or_incomplete_result_fails(part):
    message,op,staged,value=case()
    if part=='omit_row': staged['body']['rows'].pop()
    elif part=='duplicate_row': staged['body']['rows'][1]=deepcopy(staged['body']['rows'][0])
    elif part=='reorder_rows': staged['body']['rows'].reverse()
    elif part=='source_cell': staged['body']['rows'][0]['note']='lost'
    elif part=='source_csv': staged['body']['source_csv']=CSV+'\n'
    elif part=='notes': staged['body']['notes']=['invented']
    elif part=='computed': staged['body']['rows'][0]['calculated_total']='1.00'
    elif part=='difference': staged['body']['rows'][0]['difference']='0.00'
    elif part=='check': staged['body']['rows'][0]['check']='matched'
    elif part=='columns': staged['body']['columns'].reverse()
    elif part=='sum': staged['output']['expected_sum']='2.01'
    elif part=='reported_sum': staged['output']['reported_sum']='2.02'
    elif part=='discrepancies': staged['output']['discrepancies']=[]
    elif part=='formula': staged['output']['formula']='untrusted formula'
    elif part=='input_hash': staged['output']['input_sha256']='0'*64
    elif part=='preservation_claim': staged['output']['source_values_preserved']=False
    elif part=='rounding': staged['body']['rounding']='ROUND_HALF_EVEN'
    elif part=='file_content':
        staged['file']['content']=staged['file']['content'].replace('1.01','1.00')
        staged['file']['content_sha256']=byte_hash(staged['file']['content'])
    elif part=='file_hash': staged['file']['content_sha256']='0'*64
    elif part=='file_mime': staged['file']['mime_type']='text/plain'
    elif part=='file_name': staged['file']['filename']='result.txt'
    elif part=='operation': staged['binding']['operation_hash']='0'*64
    result=check(message,op,staged,value)
    assert not result['satisfied']
    assert result['automatic']['recognized'] and result['automatic']['failures']


def test_requested_rounding_not_model_rounding():
    assert not check(*case(rounding='ROUND_HALF_EVEN'))['satisfied']
    assert check(*case(text=GOAL.replace('half-up','half-even'),rounding='ROUND_HALF_EVEN'))['satisfied']


def test_all_supplied_inputs_and_human_identity_required():
    message,op,staged,value=case()
    message.attachments.append(message.attachments[0].model_copy(update={'ref':'second'}))
    assert not check(message,op,staged,value)['satisfied']
    message.attachments.pop()
    message.author_kind='assistant'
    assert not check(message,op,staged,value)['satisfied']


def test_rejected_tool_cannot_complete():
    message,op,staged,value=case()
    staged.update(status='rejected',body=None,file=None,output=None)
    assert not check(message,op,staged,value)['satisfied']


def test_oracle_values_and_binding_hashes_are_not_model_feedback():
    from workagent.acceptance_checks import for_model
    message,op,staged,value=case()
    staged['body']['rows'][0]['calculated_total']='9.99'
    proof=check(message,op,staged,value)
    filtered=for_model({'verification':proof})['verification']['automatic']
    assert set(filtered)=={'recognized','passed','failures','scope'}
    assert filtered['failures'] and not filtered['passed']
    assert 'expected' not in str(filtered)


def test_historical_verification_still_decodes():
    old=AdaptiveVerification.model_validate({'satisfied':False,'checks':[]})
    assert old.automatic is None


def test_saved_table_uses_every_human_edited_cell_and_keeps_notes():
    from workagent.message_models import ExactTarget
    from workagent.product_models import TableBody
    message,_,staged,value=case()
    saved=TableBody.model_validate(staged['body'])
    saved.rows[0]['unit_price']='2.005'
    saved.rows[0]['note']='Human changed this, keep it.'
    saved.notes=['Human instruction: retain this note.']
    base=SimpleNamespace(id='revision',body=saved,body_hash=digest(saved))
    message.text=GOAL.replace('this CSV','the saved CSV')
    message.attachments=[]
    message.target=ExactTarget(artifact_id='artifact',revision_id=base.id,body_hash=base.body_hash)
    op=ReconcileCSV(kind='reconcile_csv',artifact_id='artifact',base_revision_id=base.id)
    body,file,output=Products()._calculate_product(op,base)
    staged=dict(status='observed',body=body.model_dump(mode='json'),file=file.model_dump(mode='json'),
        output=output.model_dump(mode='json'),binding={'base_hash':base.body_hash,'operation_hash':digest(op)})
    proof=check(message,op,staged,value,base)
    assert proof['satisfied'] and proof['automatic']['base_hash']==digest(saved)
    assert proof['automatic']['source_sha256']!=byte_hash(CSV)
    assert body.rows[0]['calculated_total']=='2.01' and body.notes==saved.notes
    staged['body']['notes']=[]
    assert not check(message,op,staged,value,base)['satisfied']


@pytest.mark.parametrize('rounding',['half-up','half-even'])
def test_integer_oracle_handles_ties_large_values_and_every_row(rounding):
    # Explicit independent cases plus a broad deterministic decimal input grid.
    from workagent.bounded_verifier import _oracle
    rows=[{'id':str(i),'quantity':str(quantity),'unit_price':price,'reported_total':'0.00'}
          for i,(quantity,price) in enumerate([(1,'0.005'),(1,'0.015'),(3,'0.335'),
              (1000000,'999999999.9999'),(0,'0.9999')])]
    mode='ROUND_HALF_UP' if rounding=='half-up' else 'ROUND_HALF_EVEN'
    calculated,_,_,_=_oracle(rows,mode)
    assert [r['calculated_total'] for r in calculated]==(
        ['0.01','0.02','1.01','999999999999900.00','0.00'] if rounding=='half-up'
        else ['0.00','0.02','1.00','999999999999900.00','0.00'])
    source='id,quantity,unit_price,reported_total,note\n'+''.join(
        f'{i},{i%7},{i//10000}.{i%10000:04d},0.00,keep {i}\n' for i in range(500))
    assert check(*case(text=GOAL.replace('half-up',rounding),source=source,rounding=mode))['satisfied']


def test_publication_rechecks_exact_staged_bytes():
    from workagent.bounded_verifier import recheck_completion
    from workagent.errors import DomainError
    message,op,staged,value=case()
    staged['verification']=check(message,op,staged,value)
    staged['terminal_outcome']='completed'
    assert recheck_completion(message,op,staged)['passed']
    staged['file']['content']+='\n'
    with pytest.raises(DomainError,match='action_unresolved'): recheck_completion(message,op,staged)


def test_no_model_selected_scope_or_verifier_is_admitted():
    from pydantic import ValidationError
    _,_,_,value=case()
    payload=value.model_dump(mode='json')
    payload['verifier']='csv-reconciliation-v1'
    with pytest.raises(ValidationError): AdaptiveDecision.model_validate(payload)


def test_additional_structured_human_obligations_are_not_ignored():
    from workagent.acceptance_checks import CSVAcceptance
    message,op,staged,value=case()
    message.acceptance_checks=CSVAcceptance(kind='csv_totals',expected_sum='999.00',mismatch_count=0)
    assert not check(message,op,staged,value)['satisfied']


@pytest.mark.parametrize('state,expected',[('running','pending'),('ready','completed'),('cancelled','cancelled')])
def test_staged_proof_is_not_overall_completion_until_publication(monkeypatch,state,expected):
    from workagent.products import adaptive_readback
    message,op,staged,value=case()
    staged.update(phase='selection',terminal_outcome='completed',goal=value.goal,success_criteria=[])
    staged['verification']=check(message,op,staged,value)
    monkeypatch.setattr('workagent.adaptive.retained',lambda *_:[staged])
    monkeypatch.setattr('workagent.responses_ledger.summary',lambda *_,**kw:{'reserved_cost_usd':'0'})
    class Connection:
        def execute(self,sql,args):
            result=({'data':{'responses':{'policy_version':'adaptive-local-v1','max_steps':4},'grant_id':'grant'}}
                    if 'run_configurations' in sql else {'value':value.model_dump()})
            return SimpleNamespace(fetchone=lambda:result)
    run=SimpleNamespace(workspace_id='ws',id='run',state=state,stop_reason=None)
    assert adaptive_readback(Connection(),run,{'id':'attempt'}).outcome==expected
