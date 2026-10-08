"""Offline finite oracle and wrong-but-executable repair fixtures, not live proof."""
from types import SimpleNamespace
import subprocess
import pytest
from test_bounded_verifier_pure import case, check
from workagent.bounded_verifier import recheck_completion
from workagent.product_models import RunWasm
from workagent.products import Products
from workagent.service import digest

GOAL = ('Build a reusable team-selection calculator for choosing k people from n candidates, '
        'for all integers 0 <= k <= n <= 60. Start with 60 candidates and 30 people. Keep my notes.')
# Numerator first overflows i64 despite every final answer fitting in i64.
BAD = '''(module (func (export "choose") (param $n i64) (param $k i64) (result i64)
 (local $r i64) (local $i i64) (local.set $r (i64.const 1))
 (local.set $i (i64.const 1))
 (block $end (loop $mul (br_if $end (i64.gt_s (local.get $i) (local.get $k)))
  (local.set $r (i64.mul (local.get $r) (i64.add (i64.sub (local.get $n) (local.get $k)) (local.get $i))))
  (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $mul)))
 (local.set $i (i64.const 1))
 (block $end (loop $div (br_if $end (i64.gt_s (local.get $i) (local.get $k)))
  (local.set $r (i64.div_s (local.get $r) (local.get $i)))
  (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $div))) (local.get $r)))'''
GOOD = '''(module (func (export "choose") (param $n i64) (param $k i64) (result i64)
 (local $r i64) (local $i i64) (local $a i64) (local $b i64) (local $t i64)
 (local.set $r (i64.const 1)) (local.set $i (i64.const 1))
 (block $end (loop $step (br_if $end (i64.gt_s (local.get $i) (local.get $k)))
  (local.set $a (local.get $r)) (local.set $b (local.get $i))
  (block $done (loop $gcd (br_if $done (i64.eqz (local.get $b)))
   (local.set $t (i64.rem_u (local.get $a) (local.get $b)))
   (local.set $a (local.get $b)) (local.set $b (local.get $t)) (br $gcd)))
  (local.set $r (i64.mul (i64.div_u (local.get $r) (local.get $a))
   (i64.div_u (i64.add (i64.sub (local.get $n) (local.get $k)) (local.get $i))
    (i64.div_u (local.get $i) (local.get $a)))))
  (local.set $i (i64.add (local.get $i) (i64.const 1))) (br $step))) (local.get $r)))'''


def team_case(code=GOOD, text=GOAL, base=None):
    message,_,_,value=case(text=text)
    message.attachments=[]
    if base:
        from workagent.message_models import ExactTarget
        message.target=ExactTarget(artifact_id='tool',revision_id=base.id,body_hash=base.body_hash)
    op=RunWasm(kind='run_wasm',code=code,entrypoint='choose',arguments=[60,30],
        input_form=[{'name':'n','label':'Candidates'},{'name':'k','label':'People'}],
        artifact_id='tool' if base else None,base_revision_id=base.id if base else None)
    body,file,output=Products()._calculate_product(op,base)
    staged=dict(status='observed',body=body.model_dump(mode='json'),file=file.model_dump(mode='json'),
                output=output.model_dump(mode='json'),binding={'operation_hash':digest(op),'base_hash':base.body_hash if base else None})
    from workagent.adaptive import AdaptiveDecision
    decision=op.model_dump(mode='json'); decision.pop('artifact_id'); decision.pop('base_revision_id')
    decision['input_form']=[{'name':f.name,'label':f.label} for f in op.input_form]
    decision['target']=message.target.model_dump(mode='json') if message.target else None
    value=AdaptiveDecision.model_validate(dict(goal='Build team calculator',success_criteria=[],decision=decision))
    return message,op,staged,value


def test_full_domain_wrong_then_correct_and_saved_notes():
    bad=team_case(BAD)
    proof=check(*bad)['automatic']
    assert not proof['passed'] and proof['failures']==['numerical_disagreement'] and proof['case_count']==1891
    body=Products()._calculate_product(bad[1],None)[0]
    body.notes=['Keep this human note']; body.title='My team calculator'
    base=SimpleNamespace(id='saved',body=body,body_hash=digest(body))
    message,op,staged,value=team_case(base=base)
    staged['verification']=check(message,op,staged,value,base)
    proof=recheck_completion(message,op,staged,base=base)
    assert proof['passed'] and proof['case_count']==1891 and proof['checker_version']=='team-selection-v1'
    assert staged['body']['notes']==body.notes and staged['body']['title']==body.title
    from workagent.acceptance_checks import for_model
    feedback=for_model(staged)['verification']['automatic']
    assert set(feedback)=={'recognized','passed','failures','scope','checker_version','case_count'}


@pytest.mark.parametrize('text',[GOAL+' Also email it.', 'Make a useful calculator.', GOAL.replace('60.', '61.')])
def test_unrecognized_goal_conservative(text):
    proof=check(*team_case(text=text))
    assert not proof['satisfied'] and not proof['automatic']['recognized']


@pytest.mark.parametrize('field',['value','code','notes','arguments','fields','hash'])
def test_exact_output_binding(field):
    message,op,staged,value=team_case()
    if field=='value': staged['output']['value']+=1
    elif field=='hash': staged['output']['code_sha256']='0'*64
    elif field=='fields': staged['body']['input_form'].reverse()
    elif field=='arguments': staged['body']['arguments']=[30,60]
    elif field=='notes': staged['body']['notes']=['invented']
    else: staged['body']['code']=BAD
    assert not check(message,op,staged,value)['satisfied']


def test_timeout_and_fresh_state(monkeypatch):
    # A global counter would contaminate the suite if instances were reused.
    from workagent.wasm_tool import run_wasm_tool
    code='(module (global $g (mut i64) (i64.const 0)) (func (export "f") (param i64 i64) (result i64) (global.set $g (i64.add (global.get $g) (i64.const 1))) (global.get $g)))'
    assert run_wasm_tool(code,'f',[0,0],_cases=[[0,0],[1,0]])==[1,1]
    def timeout(*args,**kwargs):
        assert kwargs['timeout']==15 and kwargs['env']=={}
        raise subprocess.TimeoutExpired('suite',15)
    monkeypatch.setattr('workagent.team_verifier.subprocess.run',timeout)
    assert check(*team_case())['automatic']['failures']==['bounded_execution']


@pytest.mark.parametrize('code,text,outcome',[(BAD,GOAL,'continue'),(GOOD,GOAL,'completed'),(GOOD,GOAL+' Also email it.','needs_validation')],ids=['wrong','correct','extra-clause'])
def test_adaptive_stage_routes_independent_result(monkeypatch,code,text,outcome):
    from workagent.adaptive import stage_metadata
    monkeypatch.setattr('workagent.adaptive.retained',lambda *_:[])
    message,op,staged,value=team_case(code,text)
    ledger=SimpleNamespace(receipt=SimpleNamespace(attempt_id='attempt'))
    result=stage_metadata(None,ledger,'selection',value,op,staged,4,message)
    assert result['terminal_outcome']==outcome
