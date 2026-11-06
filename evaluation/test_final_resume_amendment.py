"""Source-only continuation rejects drift before application/approval writes."""
from copy import deepcopy
import json
from types import SimpleNamespace
import pytest
import amend_final_resume as F


def test_reused_activation_keeps_original_implementation():
    # The exercised eight crash/tamper cases cover this exact helper, not a fork.
    assert F.D.activate_files.__module__=='amend_discovery_continuation'


@pytest.mark.parametrize('fault',['review','report','source','funding_origin','predecessor','snapshot'])
def test_denies_before_activation(tmp_path,monkeypatch,fault):
    out=tmp_path/'out';out.mkdir();campaign=tmp_path/'campaign';campaign.mkdir()
    monkeypatch.setattr(F,'ROOT',tmp_path);monkeypatch.setattr(F,'OUT',out)
    monkeypatch.setattr(F,'CAMPAIGN',campaign)
    source=tmp_path/'source.py';source.write_bytes(b'source')
    report=tmp_path/'review.md';report.write_bytes(b'exact review')
    snap=tmp_path/'snapshot';snap.mkdir();(snap/'old.py').write_bytes(b'old')
    old={'successor':{'historical':'funding-origin'},'execution_sources':{'B1':F.digest(F.canonical(F.inventory(snap)))}}
    prior=(F.canonical(old)+'\n').encode();(out/'PREDECESSOR.json').write_bytes(prior)
    monkeypatch.setattr(F,'PREDECESSOR',F.digest(prior))
    m={'files':{'source.py':F.digest(source.read_bytes())},'successor':deepcopy(old['successor']),
       'continuation':{'predecessor_sha256':F.digest(prior),'historical_snapshot':'snapshot'}}
    if fault=='funding_origin':m['successor']['historical']='replacement'
    if fault=='predecessor':m['continuation']['predecessor_sha256']='0'*64
    raw=(F.canonical(m)+'\n').encode();(out/'CANDIDATE.json').write_bytes(raw)
    review={'verdict':'PASS','manifest_sha256':F.digest(raw),'report':'review.md','report_sha256':F.digest(report.read_bytes())}
    if fault=='review':review['verdict']='HOLD'
    if fault=='report':report.write_bytes(b'changed')
    if fault=='source':source.write_bytes(b'changed')
    if fault=='snapshot':(snap/'old.py').write_bytes(b'changed')
    receipt=out/'review.json';receipt.write_text(F.canonical(review))
    def no_activation(*a,**kw):raise RuntimeError('activation_must_not_run')
    monkeypatch.setattr(F.D,'activate_files',no_activation)
    with pytest.raises(AssertionError):F.activate(receipt)
    assert not (out/'ACTIVATED.json').exists()
    assert not (campaign/'controller.lock').exists()
