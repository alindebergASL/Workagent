"""Prospective capacity only; real constructors, no PG/provider effects."""
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace as NS
import pytest
from workagent.general_worker import GENERAL_CLAIM_SECONDS
from workagent.models import now
from workagent.capabilities.models import InputRef
import retained_read_visits as visits
import test_native_retained_projection_pg as native


def test_finite_capacity_and_paired_fixture_headroom():
    assert GENERAL_CLAIM_SECONDS==600
    assert visits.MAX_EXPIRY_WAIT==GENERAL_CLAIM_SECONDS+60==660
    assert visits.MAX_SECONDS==45*60 and visits.MAX_VISITS==12 and visits.MAX_EMPTY_VISITS==3
    assert native.SYNTHETIC_TOOL_AUTHORITY_SECONDS==7200
    assert native.SYNTHETIC_TOOL_AUTHORITY_SECONDS>2*visits.MAX_SECONDS+visits.MAX_EXPIRY_WAIT


def test_new_grant_constructor_gets_two_hours_without_rewriting_old(monkeypatch):
    origin=now();installed=[]
    monkeypatch.setattr(native,'now',lambda:origin)
    monkeypatch.setattr(native,'Database',lambda dsn:('owner',dsn))
    def install(db,grant,**kw):
        assert db==('owner','synthetic-owner')
        assert kw==dict(limits={'local_compute':100,'rendering':20},provider_grant_id='provider')
        installed.append(grant.model_dump(mode='json'))
    monkeypatch.setattr(native.policy,'install',install)
    ctx=(None,NS(id='human'),'workspace',None,'synthetic-owner')
    ref=InputRef(kind='workspace_file',id='human-file',version='v1',sha256='a'*64)
    a=native.install(ctx,NS(id='conversation'),NS(run=NS(id='a',access_generation=1)),NS(id='provider'),ref)
    old=deepcopy(installed[0])
    b=native.install(ctx,NS(id='conversation'),NS(run=NS(id='b',access_generation=1)),NS(id='provider'),ref)
    assert a.id!=b.id and a.run_id=='a' and b.run_id=='b'
    assert a.expires_at==b.expires_at==origin+timedelta(hours=2)
    assert a.resource_selectors==b.resource_selectors==[ref]
    assert a.effects==b.effects==['read','draft','local_compute']
    assert a.privacy_classes==b.privacy_classes==['workspace_private'] and a.egress==b.egress=='none'
    assert a.access_generation==b.access_generation==1
    assert installed[0]==old and len(installed)==2
