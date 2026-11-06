"""Unit-only issuer/recipient orchestration. No DB, authority or provider effects.
Real SQL certificate semantics are reused from retained accepted PG evidence;
these mocks test driver sequencing/readback/retry, NOT real issuer issuance.
"""
import json
from decimal import Decimal
from pathlib import Path
import sys
import pytest
ROOT=Path(__file__).resolve().parents[4]
sys.path[:0]=[str(ROOT/'evaluation'),str(ROOT/'backend')]
import install_recipient_funding as I

PLAN=dict(blind_id='review-unit',database='workagent_test_review_unit')
HASH='a'*64
ID='b35c-review-unit-phase-1'
EXPECTED=dict(id=ID,target_database=PLAN['database'],target_binding_sha256=HASH,amount_usd=2)

@pytest.mark.parametrize('fault',['issuer_readback','recipient_install','recipient_readback','none'])
def test_issue_phase_exact_order_and_retry(tmp_path,monkeypatch,fault):
    (tmp_path/PLAN['blind_id']).mkdir()
    monkeypatch.setattr(I,'OUT',tmp_path)
    monkeypatch.setattr(I,'install_gate',lambda p,b:dict(binding=dict(binding_sha256=HASH)))
    history=[]; issued=set(); received=set(); fail=[fault]
    def pg(database,sql):
        if 'issue_exact(' in sql:
            history.append('issue')
            assert database==I.PRIMARY
            assert all(I.q(x) in sql for x in (ID,PLAN['database'],HASH,'2'))
            issued.add(ID)
            return ''
        if 'test_budget_correction.certificates c WHERE' in sql:
            history.append('issuer_readback')
            assert database==I.PRIMARY and ID in issued
            data=dict(EXPECTED)
            if fail[0]=='issuer_readback':
                fail[0]=None;data['target_binding_sha256']='b'*64
            return json.dumps(data)
        if 'install_certificate(' in sql:
            history.append('receive')
            assert database==PLAN['database'] and ID in issued
            assert all(I.q(x) in sql for x in (ID,I.PRIMARY,PLAN['database'],HASH,'2'))
            assert f'{I.ISSUER_OID}::oid' in sql
            if fail[0]=='recipient_install':
                fail[0]=None;raise RuntimeError('injected_unit_recipient_interruption')
            received.add(ID)
            return ''
        if 'study_funding.certificates c WHERE' in sql:
            history.append('recipient_readback')
            assert database==PLAN['database'] and ID in received
            data=dict(EXPECTED,issuer_database=I.PRIMARY,issuer_oid=str(I.ISSUER_OID))
            if fail[0]=='recipient_readback':
                fail[0]=None;data['amount_usd']=3
            return json.dumps(data)
        assert 'encumbered' in sql and database==I.PRIMARY
        history.append('totals')
        return json.dumps(dict(released=31.546260,allocated=2,encumbered=70.059700))
    monkeypatch.setattr(I,'pg',pg)
    if fault!='none':
        with pytest.raises((AssertionError,RuntimeError)):
            I.issue_phase(PLAN,{},1,Decimal('2'))
        assert issued=={ID}
        assert not (tmp_path/PLAN['blind_id']/'phase-1-certificate.json').exists()
        if fault=='issuer_readback':assert received==set() and 'receive' not in history
        if fault=='recipient_install':assert received==set()
    result=I.issue_phase(PLAN,{},1,Decimal('2'))
    assert issued==received=={ID}
    path=tmp_path/PLAN['blind_id']/'phase-1-certificate.json'
    prior=path.read_bytes()
    assert result['issuer']['amount_usd']==result['recipient']['amount_usd']=='2'
    assert result['billed_usd'] is None and result['provider_calls']==0
    I.issue_phase(PLAN,{},1,Decimal('2'))
    assert path.read_bytes()==prior
    assert history[-5:]==['issue','issuer_readback','receive','recipient_readback','totals']
    assert issued==received=={ID}
