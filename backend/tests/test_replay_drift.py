"""Replay reauthorizes current access without reapplying historical freshness."""
from test_domain import context, cmd, raises
from workagent.models import CreateAssignment, new_id
from workagent.db import Database


def test_committed_create_replays_after_source_drift_but_not_revocation(context):
    service,principal,ws,refs,admin=context
    original=cmd(CreateAssignment,goal='One logical operation',completion_criteria=['Private plan'],selected_source_refs=refs)
    receipt=service.create_assignment(principal,ws,original)
    with Database(admin).transaction() as c:
        c.execute("UPDATE sources SET data=jsonb_set(data,'{external_version}','\"changed-version\"'::jsonb) WHERE workspace_id=%s AND id=%s",(ws,refs[0].source_id))
    replay=service.create_assignment(principal,ws,original.model_copy(update={'request_id':new_id()}))
    assert replay==receipt
    raises('command_conflict',lambda:service.create_assignment(principal,ws,original.model_copy(update={'goal':'Different intent'})))
    raises('source_changed',lambda:service.create_assignment(principal,ws,original.model_copy(update={'command_id':new_id()})))
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    raises('not_found_or_not_authorized',lambda:service.create_assignment(principal,ws,original))
