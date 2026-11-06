"""Restricted-PG invocation of the integrated resolver; parent serial execution."""
from unittest.mock import patch
import pytest
from test_native_retained_projection_pg import (context,approved_disposable_release,legacy_grant,
    AMENDMENT,PREDECESSOR)
from workagent.capabilities import policy,registry,boundary_policy,implementation_releases as releases
from workagent.db import Database
from workagent.errors import DomainError
from workagent.service import encoded


def unchanged(c,ws,rid):
    return {
        'provider':c.execute('SELECT to_jsonb(a) v FROM provider_attempts a WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchall(),
        'native':c.execute('SELECT to_jsonb(a) v FROM tool_attempts a WHERE workspace_id=%s AND run_id=%s',(ws,rid)).fetchall(),
        'costs':c.execute('SELECT to_jsonb(e) v FROM tool_cost_entries e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s',(ws,rid)).fetchall(),
    }


def test_pg_batched_resolver_partial_then_complete_current_release(context):
    s,_,ws,_,admin=context;g,q,_=legacy_grant(context,['files.list','files.read_range'])
    owner=Database(admin);identity=releases.execution_identity()
    # Existing owner binding API creates only a deliberately incomplete NEW grant.
    with owner.transaction() as c:
        row=c.execute('SELECT * FROM tool_grants WHERE id=%s',(g.id,)).fetchone()
        releases._binding(c,row,registry.adapters()['files.list'].descriptor.model_dump(mode='json'),identity,AMENDMENT,PREDECESSOR)
    with s.db.transaction() as c:
        before=unchanged(c,ws,q.run.id)
        with pytest.raises(DomainError):policy.require_run_tools(c,q.run)
    releases.install_transition(owner,[g.id],amendment_sha256=AMENDMENT,predecessor_source_sha256=PREDECESSOR)
    with s.db.transaction() as c,patch.object(boundary_policy,'execution_identity',wraps=boundary_policy.execution_identity) as compute:
        policy.require_run_tools(c,q.run)
        assert compute.call_count==1
        assert unchanged(c,ws,q.run.id)==before
        for source,consumer in [('0'*64,identity['consumer_sha256']),(identity['source_sha256'],'0'*64)]:
            assert c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',(g.id,'files.list',source,consumer)).fetchone()['d'] is None
        assert c.execute('SELECT count(*) n FROM tool_grant_implementation_bindings WHERE grant_id=%s',(g.id,)).fetchone()['n']==2


@pytest.mark.parametrize('damage',['revoke','generation','reduction'])
def test_pg_batched_resolver_reads_current_authority_again(context,damage):
    s,_,ws,_,admin=context;g,q,_=legacy_grant(context,['files.list','files.read_range'])
    owner=Database(admin)
    releases.install_transition(owner,[g.id],amendment_sha256=AMENDMENT,predecessor_source_sha256=PREDECESSOR)
    with s.db.transaction() as c:
        policy.require_run_tools(c,q.run)
        assert policy.grant(c,ws,q.run.id).resource_selectors==g.resource_selectors
        before=unchanged(c,ws,q.run.id)
    with owner.transaction() as c:
        if damage=='revoke':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
        elif damage=='generation':c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
        else:c.execute('INSERT INTO tool_scope_reductions(grant_id,selector) VALUES(%s,%s)',(g.id,encoded(g.resource_selectors[0])))
    with s.db.transaction() as c:
        if damage=='reduction':
            # Grant still permits tools, but its CURRENT scoped resources are empty.
            policy.require_run_tools(c,q.run)
            assert policy.grant(c,ws,q.run.id).resource_selectors==[]
        else:
            with pytest.raises(DomainError):policy.require_run_tools(c,q.run)
        assert unchanged(c,ws,q.run.id)==before
