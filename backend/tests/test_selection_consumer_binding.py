from pathlib import Path
from unittest.mock import patch
from workagent.general_responses import consumer_hash as general
from workagent.responses_worker import consumer_hash as generic

def test_new_rejection_policy_is_bound_by_both_consumers():
    old=Path.read_bytes
    before=(general(),generic())
    def changed(path):
        raw=old(path)
        return raw+b'\n# policy tamper\n' if path.name=='selection_rejection.py' else raw
    with patch.object(Path,'read_bytes',changed):
        after=(general(),generic())
    assert all(a!=b for a,b in zip(before,after))
