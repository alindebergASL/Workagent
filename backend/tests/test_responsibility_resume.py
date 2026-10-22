"""Human resume distinguishes rejected output from unresolved provider I/O."""
import pytest
import httpx
from test_domain import context,cmd
from test_responsibility_execution import setup,edit,dispatch,admitted,answer,SequenceProvider
from test_general_responses import totals
from workagent.responsibility_models import ControlResponsibility


def control(ctx,aid,operation):
    s,p,ws,_,_=ctx
    detail=s.get_responsibility(p,ws,aid)
    return s.control_responsibility(p,ws,aid,cmd(ControlResponsibility,
        expected_work_version=detail.assignment.work_version,operation=operation))


@pytest.mark.parametrize('lost',[False,True])
def test_explicit_resume_after_rejected_result_not_unknown_send(context,tmp_path,lost):
    s,p,ws,_,_=context
    cv,art,a,g,_=setup(context);edit(context,art)
    bad=SequenceProvider([{'kind':'reply','text':42}])
    original=bad.handle
    if lost:
        def lose(request):
            if request.method=='POST' and request.url.path=='/v1/responses':
                raise httpx.ReadTimeout('synthetic response loss',request=request)
            return original(request)
        bad.handle=lose
    d,bad,w=dispatch(context,tmp_path,g,bad)
    d.once(); rows=admitted(s,ws);assert len(rows)==1
    old_id=rows[0]['run_id'];before=totals(s,g)
    with s.db.transaction() as c:
        old_events=c.execute('SELECT e.* FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.id',(old_id,)).fetchall()
    d.once();assert totals(s,g)==before  # No automatic regeneration.
    control(context,a.id,'pause')
    resume=control(context,a.id,'resume')
    assert resume.lifecycle.run_id is None
    assert resume.lifecycle.execution_status=='not_admitted'
    resumed,fake,_=dispatch(context,tmp_path/'resumed',g,SequenceProvider([answer]))
    for _ in range(5):
        resumed.once()
        if s.get_responsibility(p,ws,a.id).lifecycle.execution_status=='settled':break
    if lost:
        assert len(admitted(s,ws))==1
        assert fake.calls==[] and totals(s,g)==before
    else:
        assert len(admitted(s,ws))==2
        assert s.get_responsibility(p,ws,a.id).lifecycle.execution_status=='settled'
        assert any(m.author_kind=='assistant' and 'Revision plan' in m.text for m in s.get_conversation(p,ws,cv.id).messages)
    with s.db.transaction() as c:
        assert c.execute('SELECT e.* FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.id',(old_id,)).fetchall()==old_events
    assert s.get_run(p,ws,old_id).state=='cancelled'


@pytest.mark.parametrize('damage',['running','count_missing','identity_missing','usage_missing',
    'result_missing','wrong_id','wrong_hash','wrong_metadata','cancel','problem','wrong_issue','later_unknown'])
def test_rejected_receipt_release_is_fail_closed(damage):
    from copy import deepcopy
    from workagent.general_responses import cancelled_rejection_is_settled
    metadata={'request_id':'r','attempt_id':'a','step_id':'selection'}
    step={'phase':'selection','request_sha256':'hash','metadata':metadata}
    events={'count_send':{},'count_result':{'request_sha256':'hash'},'dispatch':{},
        'identity':{'response_id':'response','request_sha256':'hash'},
        'result':{'state':'malformed','issue':'schema_validation_failed','response_id':'response',
                  'request_sha256':'hash','metadata':metadata,'usage':{'input_tokens':1,'output_tokens':1}}}
    class Rows:
        def __init__(self,rows):self.rows=rows
        def fetchone(self):return self.rows[0]
        def fetchall(self):return self.rows
    class Connection:
        def __init__(self):self.state='cancelled';self.steps=[deepcopy(step)];self.events=deepcopy(events)
        def execute(self,query,args):
            if 'FROM provider_attempts' in query:return Rows([{'state':self.state}])
            if 'FROM responses_steps' in query:return Rows(self.steps)
            values=self.events if args[1]=='selection' else {'dispatch':{}}
            return Rows([{'kind':k,'data':v} for k,v in values.items()])
    c=Connection()
    assert cancelled_rejection_is_settled(c,'a')
    if damage=='running':c.state='running'
    elif damage=='count_missing':del c.events['count_result']
    elif damage=='identity_missing':del c.events['identity']
    elif damage=='usage_missing':c.events['result']['usage']=None
    elif damage=='result_missing':del c.events['result']
    elif damage=='wrong_id':c.events['result']['response_id']='different'
    elif damage=='wrong_hash':c.events['result']['request_sha256']='different'
    elif damage=='wrong_metadata':c.events['result']['metadata']={}
    elif damage in ('cancel','problem'):c.events[damage]={}
    elif damage=='wrong_issue':c.events['result']['issue']='invalid_reasoning_item'
    elif damage=='later_unknown':c.steps.append({**step,'phase':'selection_2'})
    assert not cancelled_rejection_is_settled(c,'a')
