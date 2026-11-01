"""Optional46 routing only; real once and fake rows/clock from accepted helper tests."""
from types import SimpleNamespace as NS
import pytest
from test_retained_read_visits import f
import retained_read_visits as h
from workagent.errors import DomainError
from workagent.general_worker import GeneralWorker,GENERAL_CLAIM_SECONDS


def saved(f):
    reads=[]
    def load(ws,rid):
        assert (ws,rid)==('ws','b');reads.append((ws,rid));return {'worker':{'opaque':'real state is validated only by production work'}}
    f.worker.phases.state=NS(load=load)
    assert f.worker.once.__func__ is GeneralWorker.once
    return reads


def test_saved_visit_enters_real_once_without_sleep_or_renewal(f):
    reads=saved(f);original=(f.run.fence,f.run.lease_expires_at)
    def work(*a):f.calls+=1;assert f.t==0;f.run.state='ready';return f.run
    f.worker.work=work
    assert h.finish_natural_visits(f.ctx,f.worker,'b').state=='ready'
    assert reads==[('ws','b')] and f.calls==1 and f.t==0 and (f.run.fence,f.run.lease_expires_at)==original


@pytest.mark.parametrize('progress',[False,True])
def test_first_saved_deferral_falls_back_to_natural_expiry_once(f,progress):
    reads=saved(f);original=(f.run.fence,f.run.lease_expires_at)
    def work(*a):
        f.calls+=1
        if f.calls==1:
            assert f.t==0
            if progress:f.events.append(dict(id=6,phase='selection',kind='tool_result',data={'retained':True}))
            raise DomainError('action_unresolved')
        assert f.t==GENERAL_CLAIM_SECONDS and (f.run.fence,f.run.lease_expires_at)==original
        f.run.state='ready';return f.run
    f.worker.work=work
    assert h.finish_natural_visits(f.ctx,f.worker,'b').state=='ready'
    assert f.calls==2 and reads==[('ws','b')] and f.t==GENERAL_CLAIM_SECONDS


@pytest.mark.parametrize('kind',['stale','revoked','unknown','native','other'])
def test_saved_presence_cannot_launder_denial_unknown_or_other_target(f,kind):
    saved(f)
    if kind=='unknown':f.phase_state='outcome_unknown'
    elif kind=='native':f.native_unknown=True
    elif kind=='other':f.extra=True
    def work(*a):f.calls+=1;raise DomainError('not_found_or_not_authorized' if kind=='revoked' else 'source_changed')
    f.worker.work=work
    with pytest.raises(AssertionError):h.finish_natural_visits(f.ctx,f.worker,'b')
    assert f.t==0 and f.calls==int(kind in ('stale','revoked'))
