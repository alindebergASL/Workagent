"""A recording's own version change must not invalidate unchanged waiting work."""
import httpx
import pytest
from test_domain import context, cmd
from test_responsibility_action import record
from test_general_alpha_runtime import launch, AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_runtime import expire
from workagent.models import PostMessage
from workagent.responsibility_models import ControlResponsibility
from workagent.errors import DomainError


@pytest.mark.parametrize('human_control',[None,'pause','cancel','pause_then_resume'])
def test_recording_survives_only_own_bookkeeping_refresh(context,tmp_path,human_control):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[record,{'kind':'reply','text':'First handover recorded.'}])
    w.phases.transport._client.timeout=httpx.Timeout(.5)
    finish_safe_visits(context,w,q.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    first=detail.assignment_ids[0]
    q2=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=detail.conversation.work_version,
        text='Keep the first handover waiting. Record a separate second handover.'))
    s.reconcile_responsibility(p,ws,first)
    fake2=AlphaProvider([record,{'kind':'reply','text':'Second handover recorded.'}])
    w2=worker(context,fake2,tmp_path);w2.phases.transport._client.timeout=httpx.Timeout(.5)
    def interrupt(name):
        if name=='after_tool_result':
            s.reconcile_responsibility(p,ws,first)
            raise RuntimeError('restart after scheduler bookkeeping refresh')
    w2.phases.hook=interrupt
    with pytest.raises(RuntimeError,match='scheduler bookkeeping'):
        finish_safe_visits(context,w2,q2.run.id)
    assignments=s.get_conversation(p,ws,cv.id).assignment_ids
    assert len(assignments)==2
    def retained():
        with s.db.transaction() as c:
            frozen=c.execute('SELECT data FROM run_contexts WHERE run_id=%s',(q2.run.id,)).fetchone()['data']
            requests={r['phase']:r['request_bytes'] for r in c.execute(
                'SELECT phase,request_bytes FROM responses_steps s JOIN provider_attempts a '
                'ON a.id=s.attempt_id WHERE a.run_id=%s',(q2.run.id,)).fetchall()}
        return frozen,requests
    frozen,requests=retained()
    if human_control:
        operations=['pause','resume'] if human_control=='pause_then_resume' else [human_control]
        for operation in operations:
            a=s.get_responsibility(p,ws,first)
            s.control_responsibility(p,ws,first,cmd(ControlResponsibility,
                expected_work_version=a.assignment.work_version,operation=operation))
    expire(context,q2.run.id)
    resumed=worker(context,fake2,tmp_path);resumed.phases.transport._client.timeout=httpx.Timeout(.5)
    if human_control:
        before=list(fake2.calls)
        with pytest.raises(DomainError) as caught:resumed.work(p,ws,q2.run.id)
        assert caught.value.code.value=='source_changed'
        assert fake2.calls==before
    else:
        assert finish_safe_visits(context,resumed,q2.run.id).state in ('partial','ready')
        assert s.get_responsibility(p,ws,first).lifecycle.state=='waiting_person'
        assert s.get_conversation(p,ws,cv.id).assignment_ids==assignments
        before=list(fake2.calls)
        resumed.work(p,ws,q2.run.id)
        assert fake2.calls==before
    frozen_after,requests_after=retained()
    assert frozen_after==frozen
    assert all(requests_after[phase]==body for phase,body in requests.items())
