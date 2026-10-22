"""Operator results expose only closed domain codes, not private exception text."""
import pytest
from test_domain import context
from test_general_alpha_runtime import launch
from workagent.errors import DomainError
from workagent.responses_transport import TransportError
from workagent.responses_dispatcher import ResponsesDispatcher


@pytest.mark.parametrize('domain',[True,False])
def test_dispatcher_reports_safe_denial_reason(context,tmp_path,monkeypatch,domain):
    s,p,ws,_,_=context
    cv,g,q,fake,w=launch(context,tmp_path,[{'kind':'reply','text':'No provider call expected.'}])
    def fail(*args,**kwargs):
        if domain:raise DomainError('source_changed',current_version=987654321)
        raise TransportError('SYNTHETIC_PRIVATE_PROVIDER_DETAIL')
    monkeypatch.setattr(w,'work',fail)
    result=ResponsesDispatcher(w,workspace=ws,grant_id=g.id).once()
    row=next(r for r in result['results'] if r['run_id']==q.run.id)
    assert row['status']=='denied_or_deferred'
    if domain:assert row['reason']=='source_changed'
    else:assert 'reason' not in row
    assert '987654321' not in str(result)
    assert 'SYNTHETIC_PRIVATE_PROVIDER_DETAIL' not in str(result)
    assert not fake.calls
