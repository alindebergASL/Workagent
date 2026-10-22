"""Review regression: budget-stop must not re-enter projection overflow."""
from unittest.mock import patch
import pytest
from test_domain import context
from test_conversations import conversation, post
from test_same_turn_draft_binding import activate_home, early_rows, receipts
from test_sustained_continuity import draft
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker, totals
from test_adaptive_execution import finish_safe_visits
from workagent.conversations import profile
from workagent.service import canonical


@pytest.mark.parametrize('restart', [False, True], ids=['same-visit', 'restart-after-commit'])
def test_early_draft_context_overflow_settles_without_rewriting_or_resending(context,tmp_path,restart):
    from test_sustained_continuity import Interrupted
    from test_runtime import expire
    from workagent.service import Service
    s,p,ws,_,_=context
    cv=conversation(context)
    grant=activate_home(context,cv,max_steps=3)
    q=post(context,cv,'Prepare a document and continue if context capacity permits.')
    selected=draft('Useful retained draft')
    selected['body']['blocks'][0]['text']='Retained preparation. '*200
    provider=AlphaProvider([selected,{'kind':'reply','text':'Only if context fits.'}])
    materialize=s._materialize_general_context
    capacity=[]
    def bounded_profile(name):
        value=profile(name)
        if capacity:value['max_context_bytes']=capacity[0]
        return value
    def capture_baseline(*args,**kwargs):
        value=materialize(*args,**kwargs)
        # Establish a fixed small test cap just above the real initial baseline.
        # It remains unchanged for every subsequent validation and restart.
        if not capacity:capacity.append(len(canonical(value[0]).encode())+256)
        return value
    with patch('workagent.conversations.profile',side_effect=bounded_profile), patch.object(s,'_materialize_general_context',side_effect=capture_baseline):
        ctx=context
        if restart:
            general_context=s._general_context
            def crash_before_revalidation(*args,**kwargs):
                # A separate transaction sees only the committed early material.
                # Interrupt before staging's first post-commit context check.
                if early_rows(s,ws,q.run.id):
                    raise Interrupted()
                return general_context(*args,**kwargs)
            with patch.object(s,'_general_context',side_effect=crash_before_revalidation), pytest.raises(Interrupted):
                finish_safe_visits(context,worker(context,provider,tmp_path),q.run.id)
            retained=early_rows(s,ws,q.run.id)
            before_restart=receipts(s,ws,q.run.id)
            calls_restart,budget_restart=list(provider.calls),totals(s,grant)
            with s.db.transaction() as c:
                frozen=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
            assert len(retained)==1
            assert s.get_run(p,ws,q.run.id).state=='running'
            expire(context,q.run.id)
            ctx=(Service(s.db),*context[1:])
        result=finish_safe_visits(ctx,worker(ctx,provider,tmp_path),q.run.id)
        assert result.state=='partial' and result.stop_reason=='budget_limit'
        if restart:
            assert early_rows(s,ws,q.run.id)==retained
            assert receipts(s,ws,q.run.id)==before_restart
            assert provider.calls==calls_restart and totals(s,grant)==budget_restart
            with s.db.transaction() as c:
                assert c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']==frozen
        rows=early_rows(s,ws,q.run.id)
        assert len(rows)==1
        assert s.get_artifact(p,ws,rows[0]['artifact_id']).current_revision.body.title=='Useful retained draft'
        assert not any(m.author_kind=='assistant' for m in s.get_conversation(p,ws,cv.id).messages)
        calls,budget,before=list(provider.calls),totals(s,grant),receipts(s,ws,q.run.id)
        assert worker(context,provider,tmp_path).work(p,ws,q.run.id).state=='partial'
        assert provider.calls==calls and totals(s,grant)==budget and receipts(s,ws,q.run.id)==before
        assert early_rows(s,ws,q.run.id)==rows


@pytest.mark.parametrize('already_omitted', [False, True])
def test_early_draft_shares_capacity_with_optional_history(context,tmp_path,already_omitted):
    from workagent.general_worker import GeneralWorker, ControlledTransport
    s,p,ws,_,_=context
    cv=conversation(context)
    # Real durable history, including human corrections, before standing admission.
    for index in range(2):
        old=post(context,cv,f'Earlier instruction {index}: '+('Keep prior details. '*210))
        GeneralWorker(s,transport=ControlledTransport()).work(p,ws,old.run.id)
        cv=s.get_conversation(p,ws,cv.id).conversation
    activate_home(context,cv,max_steps=3)
    intent='Prepare the current document. Preserve this exact current intent Ω.'
    q=post(context,cv,intent)
    with s.db.transaction() as c:
        baseline,_=s._materialize_general_context(c,p,q.run,cv)
    capacity=len(canonical(baseline).encode())+(-1000 if already_omitted else 256)
    def bounded_profile(name):
        return {**profile(name),'max_context_bytes':capacity}
    selected=draft('History yields space to new preparation')
    selected['body']['blocks'][0]['text']='Retained preparation. '*200
    projections=[]
    original=s.conversation_worker_context
    def capture(cap):
        value=original(cap)
        projections.append(value)
        return value
    provider=AlphaProvider([selected,{'kind':'reply','text':'Prepared with a bounded history window.'}])
    with patch('workagent.conversations.profile',side_effect=bounded_profile), patch.object(s,'conversation_worker_context',side_effect=capture):
        result=finish_safe_visits(context,worker(context,provider,tmp_path),q.run.id)
    assert result.state=='ready'
    initial=next(x for x in projections if not x.get('published_preparations'))
    projected=next(x for x in projections if x.get('published_preparations'))
    assert (initial['history_window']['omitted_messages']>0)==already_omitted
    # Packing can replace a large older message with a small one, so byte use
    # must fall even when the number of omitted messages stays the same.
    assert len(canonical(projected['messages']).encode())<len(canonical(initial['messages']).encode())
    assert len(canonical(projected).encode())<=capacity
    assert projected['messages'][-1]['text']==intent
    assert projected['messages'][-1]['id']==q.message.id
    assert projected['history_window']['omitted_messages']==4-(len(projected['messages'])-1)
    rows=early_rows(s,ws,q.run.id)
    assert len(rows)==1
    assert projected['published_preparations'][0]['artifact_id']==rows[0]['artifact_id']
    assert len(s.get_conversation(p,ws,cv.id).messages)==6
