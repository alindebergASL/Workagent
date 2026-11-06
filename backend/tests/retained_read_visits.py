"""Bounded test lifecycle through production once; no authority clone or renewal."""
import time
import pytest
from workagent.models import now
from workagent.general_worker import GENERAL_CLAIM_SECONDS
from workagent.responses_ledger import observations
from workagent.file_input_rejection import tools_unresolved, valid as valid_file_rejection
from workagent.responses_io import operation_key
from workagent.service import digest

# Eight ordinary selection phases + final, with three legitimately empty visits.
# Each run has one45-minute wall bound; paired runs use NEW two-hour authority.
# Claims do not reset the wall bound; only immutable rows count progress.
MAX_VISITS=12
MAX_SECONDS=45*60
MAX_EMPTY_VISITS=3
MAX_EXPIRY_WAIT=GENERAL_CLAIM_SECONDS+60
PENDING="""SELECT d.workspace_id,d.run_id,r.data FROM run_dispatches d
    JOIN runs r ON r.workspace_id=d.workspace_id AND r.id=d.run_id
    WHERE d.acknowledged_at IS NULL AND r.data->>'profile' IN (%s,%s,%s)
    AND (%s::text IS NULL OR d.workspace_id=%s) ORDER BY d.cursor LIMIT 100"""


def known_rejection(c, aid, step, rows):
    """Checkpoint known-rejection semantics, with exact stored phase/result binding.

    This permits ordinary once to revalidate a receipt; it authorizes no action.
    076 rows are admitted by its immutable SQL guard. 078 uses its production SQL
    validator, including any separate historical no-effect resolution.
    """
    events={r['kind']:r['data'] for r in rows}
    required={'count_send','count_result','dispatch','identity','result'}
    if not required<=events.keys() or {'corrected_readback','cancelled_unapplied','cancel','tool_result'} & events.keys():return False
    result=events['result'];identity=events['identity'];count=events['count_result']
    if (result.get('usage') is None or result.get('request_sha256')!=step['request_sha256']
        or result.get('metadata')!=step['metadata'] or not identity.get('response_id')
        or result.get('response_id')!=identity['response_id']
        or count.get('request_sha256')!=step['request_sha256']
        or count.get('count_sha256')!=step['count_sha256'] or count.get('input_tokens') is None):return False
    if 'file_input_rejection' in events:
        return 'selection_rejection' not in events and valid_file_rejection(c,aid,step['phase'],events['file_input_rejection'])
    rejection=events.get('selection_rejection',{})
    result_id=next(r['id'] for r in rows if r['kind']=='result')
    return bool(result.get('state')=='malformed' and result.get('issue')=='schema_validation_failed'
        and rejection.get('version')=='selection-rejection/v1'
        and rejection.get('attempt_id')==aid and rejection.get('phase')==step['phase']
        and rejection.get('result_event_id')==result_id
        and rejection.get('result_sha256')==digest(result)
        and rejection.get('request_sha256')==step['request_sha256']
        and rejection.get('response_id')==identity['response_id'])


def visit_state(ctx, worker, run_id, *, terminal=None):
    """Read stop conditions/progress only; ordinary once owns authorization."""
    service, principal, ws, *_ = ctx
    assert ws and worker.phases is not None, 'exact workspace and Responses worker required'
    with service.db.transaction() as c:
        pending=c.execute(PENDING,('general-responses-v1',)*3+(ws,ws)).fetchall()
        identities=[(r['workspace_id'],r['run_id'],r['data']['principal_id']) for r in pending]
        if terminal is None:
            assert identities==[(ws,run_id,principal.id)], 'sole pending target required'
            fence=pending[0]['data']['fence']
        else:
            assert terminal.state in ('ready','partial','cancelled')
            assert identities in ([],[(ws,run_id,principal.id)]), 'sole pending target required'
            fence=terminal.fence
        attempt=c.execute('SELECT id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,run_id)).fetchone()
        progress=set()
        if attempt:
            aid=attempt['id'];status=observations(c,aid)
            steps=c.execute('SELECT phase,request_sha256,count_sha256,metadata FROM responses_steps WHERE attempt_id=%s',(aid,)).fetchall()
            events=c.execute('SELECT id,phase,kind,data FROM responses_events WHERE attempt_id=%s',(aid,)).fetchall()
            for observation in status:
                if observation.state=='invalid':
                    step=next((s for s in steps if s['phase']==observation.phase),None)
                    assert step is not None and known_rejection(c,aid,step,[e for e in events if e['phase']==observation.phase]), 'unbound invalid provider result; stop without retry'
                else:
                    assert observation.state not in ('count_unknown','outcome_unknown','counting','dispatching'), 'unresolved provider I/O; stop without retry'
            progress.update(('prepared',digest(r)) for r in steps)
            progress.update(('observed',digest(r)) for r in events)
            held={(r['classid']<<32)|r['objid'] for r in c.execute("SELECT classid,objid FROM pg_locks WHERE locktype='advisory' AND granted AND objsubid=1 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())").fetchall()}
            assert not any(operation_key(aid,s['phase'],kind,f)&((1<<64)-1) in held for s in steps for kind in ('count_send','dispatch','read','cancel') for f in range(1,fence+1)), 'active I/O; stop without retry'
        assert not tools_unresolved(c,ws,run_id), 'unresolved native effect; stop without retry'
        native=c.execute("SELECT e.attempt_id,e.kind,e.data FROM tool_attempt_events e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s AND e.kind='observation'",(ws,run_id)).fetchall()
        progress.update(('native_observation',digest(r)) for r in native)
        return progress


def finish_natural_visits(ctx, worker, run_id):
    """Finite overall convergence; legitimate empty deferrals do not reset bounds."""
    service, principal, workspace, *_ = ctx
    assert workspace, 'exact workspace required'
    deadline=time.monotonic()+MAX_SECONDS
    retained=set();empty=0;first_visit=True
    def within_wall():
        assert time.monotonic()<deadline, 'ordinary once overall wall watchdog exhausted'
    for _ in range(MAX_VISITS):
        within_wall()
        run=service.get_run(principal,workspace,run_id)
        if run.state in ('ready','partial','cancelled'):return run
        before=visit_state(ctx,worker,run_id)
        assert retained<=before, 'retained history regressed between visits'
        fence,expiry=run.fence,run.lease_expires_at
        # One initial delivery may resume genuine saved state through the SAME
        # production once -> work path. This is only a routing hint: work locks
        # and validates the saved capability/receipt/current authority itself.
        state=getattr(worker.phases,'state',None)
        resume_saved=bool(first_visit and state is not None and state.load(workspace,run_id))
        first_visit=False
        started=time.monotonic()
        while not resume_saved and run.state=='running' and run.lease_expires_at and run.lease_expires_at>now():
            within_wall()
            assert time.monotonic()-started<MAX_EXPIRY_WAIT, 'natural claim expiry wait exceeded test bound'
            time.sleep(max(0,min(10,(run.lease_expires_at-now()).total_seconds())))
            run=service.get_run(principal,workspace,run_id)
            assert (run.fence,run.lease_expires_at)==(fence,expiry), 'claim changed while test waited'
        current=visit_state(ctx,worker,run_id)
        assert before<=current, 'retained history regressed while waiting'
        before=current;within_wall()
        counts=worker.once(workspace=workspace)
        assert set(counts)=={'completed','deferred','denied'} and sum(counts.values())==1, 'once must account for sole target'
        assert not counts['denied'], 'ordinary once denied target; no retry'
        result=service.get_run(principal,workspace,run_id)
        terminal=result.state in ('ready','partial','cancelled')
        after=visit_state(ctx,worker,run_id,terminal=result if terminal else None)
        assert before<=after, 'retained history regressed during ordinary once'
        within_wall()
        if terminal:
            assert counts['completed']==1
            return result
        assert counts['deferred']==1
        empty=empty+1 if before==after else 0
        assert empty<=MAX_EMPTY_VISITS, 'ordinary once consecutive empty deferrals exhausted'
        retained=after
        print(f'Ordinary once deferred: {run_id} fence={result.fence} progress={before<after} empty_visits={empty}',flush=True)
    pytest.fail('Synthetic retained-read run exhausted overall visit watchdog')
