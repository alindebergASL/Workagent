"""Real retained mapping preflight; no installed writes or network effects."""
from copy import deepcopy
import json
from pathlib import Path
from unittest.mock import patch
import pytest
import amend_selection_recovery as S
import amend_gateway_recovery as G
import install_recipient_funding as I


def candidate():
    return json.loads(S.CANDIDATE.read_bytes())


def test_real_successor_preflight():
    m=candidate()
    plans,bindings=G.exact_targets(m, source_amendment=m)
    assert len(plans)==len(bindings)==12
    assert len({p['database_oid'] for p in plans})==12


def test_legacy_mapping_does_not_grandfather_successor():
    with patch.object(S.AM,'load',lambda:None),pytest.raises(AssertionError):
        I.mapping()


def test_normal_observer_mapping_requires_exact_approved_successor(tmp_path,monkeypatch):
    manifest=tmp_path/'manifest.json';marker=tmp_path/'approved.sha256'
    monkeypatch.setattr(S.AM,'MANIFEST',manifest)
    monkeypatch.setattr(S.AM,'APPROVAL',marker)
    manifest.write_bytes(S.CANDIDATE.read_bytes())
    with pytest.raises(AssertionError):I.mapping()
    marker.write_text(S.digest(manifest.read_bytes())+'\n')
    plans,bindings=I.mapping()
    assert len(plans)==len(bindings)==12
    from study_controller import Hold
    marker.write_text('0'*64+'\n')
    with pytest.raises(Hold,match='approval_hash'):I.mapping()


@pytest.mark.parametrize('fault',['current_source','historical_source','predecessor_manifest',
    'successor_pin','delta_before','delta_after','historical_inventory','authority'])
def test_unbound_drift_denied(fault):
    m=deepcopy(candidate())
    rel='backend/workagent/general_responses.py'
    targets={
        'current_source':G.ROOT/rel,
        'historical_source':G.ROOT/m['successor']['historical_snapshot']/'general_responses.py',
        'predecessor_manifest':G.ROOT/m['successor']['predecessor_manifest'],
        'authority':G.OUT/'recipient-plans-file-target.json',
    }
    if fault=='successor_pin':m['files'][rel]='0'*64
    if fault=='delta_before':m['successor']['product_delta']['general_responses.py']['before']='0'*64
    if fault=='delta_after':m['successor']['product_delta']['general_responses.py']['after']='0'*64
    if fault=='historical_inventory':m['successor']['predecessor_execution_sources']['B1']='0'*64
    original=Path.read_bytes
    def read(path):
        raw=original(path)
        return raw+b'\n# unbound source drift\n' if path==targets.get(fault) else raw
    with patch.object(Path,'read_bytes',read),pytest.raises(AssertionError):
        G.exact_targets(m, source_amendment=m)
