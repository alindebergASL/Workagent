"""Compact model input; explicit count rejection is not an unknown send."""
import copy
import json
import httpx
import pytest
from test_domain import context, raises
from test_conversations import conversation, post
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker, totals
from test_adaptive_execution import finish_safe_visits
from test_runtime import expire
from test_cancelled_unsent_admission import journal
from workagent.adaptive import continuation_context
from workagent.composition import discovery
from workagent.general_responses import has_unresolved_attempt


def test_discovery_projection_omits_only_duplicate_schemas():
    retained={'capability_result':{'capability':'discover_capabilities','version':'1','result':discovery(True)}}
    original=copy.deepcopy(retained)
    projected=continuation_context({'messages':[]},[retained],8)['adaptive']['observations'][0]
    actual=projected['capability_result']['result']
    expected=copy.deepcopy(original['capability_result']['result'])
    for cap in expected['capabilities']:cap.pop('input_schema',None)
    assert actual==expected
    assert retained==original
    assert len(json.dumps(projected)) < len(json.dumps(retained))/2
    # User/tool text resembling schemas is not indiscriminately stripped.
    other={'capability_result':{'capability':'inspect_json','result':{'input_schema':{'user':'content'}}}}
    assert continuation_context({},[other],8)['adaptive']['observations']==[other]


class CountProvider(AlphaProvider):
    def __init__(self,fail_at,unknown):
        super().__init__([{'kind':'discover_capabilities'},{'kind':'reply','text':'Fresh user turn answered.'}])
        self.counts=0;self.fail_at=fail_at;self.unknown=unknown

    def handle(self,request):
        if request.url.path.endswith('input_tokens'):
            self.counts+=1
            if self.counts==self.fail_at:
                self.calls.append((request.method,request.url.path))
                if self.unknown:raise httpx.ReadError('synthetic unknown count')
                return httpx.Response(200,json={'object':'response.input_tokens','input_tokens':50001})
        return super().handle(request)


@pytest.mark.parametrize('fail_at',[1,2])
@pytest.mark.parametrize('unknown',[False,True])
def test_fresh_human_turn_after_known_count_rejection_only(context,tmp_path,fail_at,unknown):
    s,p,ws,_,_=context
    cv=conversation(context);g=activate(context,cv)
    q=post(context,cv,'Synthetic discovery then answer.')
    fake=CountProvider(fail_at,unknown);w=worker(context,fake,tmp_path)
    for _ in range(5):
        w.work(p,ws,q.run.id)
        before=journal(s,ws,q.run.id)
        if any(e['kind']=='problem' for e in before[2]):break
        expire(context,q.run.id)
    else:pytest.fail('count rejection was not retained')
    calls=list(fake.calls);budget=totals(s,g)
    # No automatic retry or new background admission is authorized by this proof.
    with s.db.transaction() as c:assert has_unresolved_attempt(c,ws,cv.id)
    expire(context,q.run.id);w.work(p,ws,q.run.id)
    assert fake.calls==calls and journal(s,ws,q.run.id)==before
    cv=s.get_conversation(p,ws,cv.id).conversation
    if unknown:
        raises('action_unresolved',lambda:post(context,cv,'A fresh smaller request.'))
        assert journal(s,ws,q.run.id)==before and totals(s,g)==budget
        return
    new=post(context,cv,'A fresh smaller request.')
    assert s.get_run(p,ws,q.run.id).state=='cancelled'
    assert new.run.id!=q.run.id and journal(s,ws,q.run.id)==before
    assert totals(s,g)==budget and fake.calls==calls
    assert finish_safe_visits(context,w,new.run.id).state=='ready'
    assert journal(s,ws,q.run.id)==before
    assert totals(s,g)['unknown_usage_steps']==0
    with s.db.transaction() as c:assert not has_unresolved_attempt(c,ws,cv.id)
