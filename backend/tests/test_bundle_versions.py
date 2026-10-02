"""A16 real PostgreSQL activation/version rollback; not live model ablation."""
import pytest
from test_domain import context, create, raises
from workagent.db import Database
from workagent.fixture import run_claimed
from workagent.runtime_config import activate, loader, BundleDenied, LEGACY_APPROVALS_SHA256


def test_candidate_inactive_then_version_activation_and_reproducible_rollback(context):
    s,p,ws,refs,admin=context
    # The proposed package exists on disk but the prior reviewed registry grants no activation.
    with pytest.raises(BundleDenied):
        loader(LEGACY_APPROVALS_SHA256).load('0.1.1')
    with s.db.transaction() as c:
        prior=c.execute('SELECT activation_id FROM runtime_configuration').fetchone()['activation_id']
    original=create(context)
    old_cap=s.claim_run(p,ws,original.run.id)
    old_context=s.worker_context(old_cap)
    assert old_context['bundle_version']=='0.1.0'
    changed=activate(Database(admin),version='0.1.1')
    try:
        # Existing runs retain the old reviewed registry/configuration, not a new approval set.
        assert s.worker_context(old_cap)==old_context
        run_claimed(s,old_cap)
        upgraded=create(context)
        new_cap=s.claim_run(p,ws,upgraded.run.id)
        new_context=s.worker_context(new_cap)
        assert new_context['bundle_version']=='0.1.1'
        assert new_context['bundle_manifest_sha256']!=old_context['bundle_manifest_sha256']
        assert 'human decisions' in new_context['instructions'][-1]['body']
        run_claimed(s,new_cap)
        rolled=activate(Database(admin),rollback=prior)
        assert rolled['previous_id']==changed['id'] and rolled['rollback_of']==prior
        resumed=create(context)
        resumed_cap=s.claim_run(p,ws,resumed.run.id)
        rolled_context=s.worker_context(resumed_cap)
        assert rolled_context['instructions']==old_context['instructions']
        assert rolled_context['source_manifest']==old_context['source_manifest']
        assert rolled_context['bundle_manifest_sha256']==old_context['bundle_manifest_sha256']
        # Rollback never rewinds current access generation or source revocation.
        with Database(admin).transaction() as c:
            c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
        activate(Database(admin),rollback=prior)
        raises('not_found_or_not_authorized',lambda:run_claimed(s,resumed_cap))
    finally:
        activate(Database(admin),rollback=prior)
