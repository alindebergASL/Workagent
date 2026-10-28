"""Canonical metadata reads; event pages invalidate, never patch domain bodies."""
from urllib.parse import urlencode
from ..operator_journal import OperatorError
from ..work_event_models import WorkSnapshot, EventPage, AttentionPage
from .presentation import prose
from .safe_text import literal


def read(client,workspace,conversation,retained=None):
    root='/'+workspace;query='?'+urlencode({'conversation_id':conversation})
    snapshot=WorkSnapshot.model_validate(client.request(root+'/work-snapshot'+query)).model_dump(mode='json')
    if snapshot['conversation_id']!=conversation:raise OperatorError('Snapshot conversation scope mismatch')
    changed=bool(retained and retained['access_generation']!=snapshot['access_generation'])
    after=snapshot['snapshot_cursor'] if not retained or changed else retained['cursor']
    page=EventPage.model_validate(client.request(root+'/events?'+urlencode({
        'conversation_id':conversation,'after':after,'limit':100}))).model_dump(mode='json')
    if any(e['conversation_id']!=conversation for e in page['events']):raise OperatorError('Event conversation scope mismatch')
    if page['has_more'] and page['next_cursor']==after:raise OperatorError('Event cursor did not advance')
    if page['reset_required']:
        # A generation may change between reads. Discard this bundle and fetch a
        # fresh snapshot next time; never associate the reset cursor with old data.
        raise OperatorError('Event scope reset; Refresh to verify current access')
    attention=AttentionPage.model_validate(client.request(root+'/attention'+query)).model_dump(mode='json')
    return dict(snapshot=snapshot,events=page,attention=attention,generation_changed=changed,
                continuity={'cursor':page['next_cursor'],'access_generation':snapshot['access_generation']})


def status_text(snapshot,*,detail=None,checkpoints=()):
    run=snapshot['execution']
    lines=['NOW · '+literal(run['state'])+' · checked '+literal(snapshot['checked_at']),
           'Admission: '+literal(run['admission'])+' · worker observed live: '+prose(run['worker_live'])]
    if run['run_id']:lines.append('Displayed run: '+literal(run['run_id']))
    if run['reason']:lines.append('Server status category: '+literal(run['reason']))
    if run['phase']:lines.append('Phase: '+literal(run['phase']))
    if detail and detail.get('conversation',{}).get('id')==snapshot['conversation_id']:
        raw=next((r for r in detail.get('runs',[]) if r['id']==run['run_id']),None)
        turn=next((t for t in detail.get('turns',[]) if t['run_id']==run['run_id']),{})
        checkpoint=next((c for c in reversed(checkpoints) if c.get('run_id')==run['run_id'] and
            c.get('conversation_id')==snapshot['conversation_id'] and c.get('checkpoint_kind')=='settlement'),None)
        local=turn.get('retained_local_result') or {}
        diagnosis=None;action=None
        if run['state'] in ('cancelled','completed','idle') or raw and raw.get('state')=='cancelled':
            pass  # Terminal current state is not an older checkpoint's diagnosis.
        elif run['reason']=='unknown_external_outcome' or turn.get('provider_observation')=='outcome_unknown':
            diagnosis='Unknown external outcome: the provider effect is not settled.'
            action='Inspect the Details tab and Refresh observations. Do not replay provider work or start a replacement until its outcome is reconciled.'
        elif run['reason']=='invalid_response' or turn.get('provider_observation')=='invalid':
            diagnosis='Malformed or invalid provider response: no valid result was established.'
            action='Inspect the Details tab and Refresh observations. Do not replay the failed provider work; reconcile its result before another attempt.'
        elif local.get('status')=='rejected':
            diagnosis='Tool rejected the requested operation: '+prose(local.get('reason') or 'See the retained tool result in Details.')
            action='Inspect the Details tab for the rejection. Correct the input or choose a supported next step in the composer; Send is an explicit new request, not a retry.'
        elif raw and checkpoint and raw.get('stop_reason')=='step_limit' and checkpoint['data']['waiting']=='blocked' and checkpoint['data']['next_safe_action']=='await_person':
            diagnosis=('No new progress: this bounded slice is parked for a changed plan.' if checkpoint.get('assignment_id') is None else
                       'Slice parked: the checkpoint requires a person before further work.')
            action='Inspect the Details tab, then describe a different next step or changed input in the composer and Send explicitly. Continue is unavailable for this checkpoint.'
        if diagnosis:
            lines.extend(['Diagnosis: '+diagnosis, 'Safe next action: '+action,
                          'Retained work: open the Work tab to inspect saved results and proposals; no failure deletes them.'])
    for item in snapshot['responsibility']:
        lines.extend(['Responsibility now: '+literal(item['state']), 'Next action: '+prose(item['next_action']),
                      'Next check-in: '+prose(item['next_check_in_at'])])
        earlier=item['historical_observation']
        if earlier:lines.append('EARLIER CHECK-IN · '+prose(earlier['observed_at'])+'\n'+literal(earlier['text']))
    return '\n'.join(lines)


def can_stop(snapshot,detail):
    # Diagnostic states (stale/blocked/unknown) do not describe cancelability.
    # Bind the canonical current ID to its authorized raw conversation run.
    if not snapshot or not detail or detail['conversation']['id']!=snapshot['conversation_id']:return False
    run_id=snapshot['execution']['run_id']
    return bool(run_id and any(r['id']==run_id and r['state'] in ('queued','running') for r in detail['runs']))


def can_continue(checkpoint,snapshot):
    if not checkpoint or not snapshot or checkpoint.get('continuation_supported') is not True:return False
    data=checkpoint['data']
    return (checkpoint['conversation_id']==snapshot['conversation_id'] and
            checkpoint.get('run_id')==snapshot['execution']['run_id'] and checkpoint.get('checkpoint_kind')=='settlement' and
            data['waiting']=='none' and data['next_safe_action']=='continue_slice' and
            data['access_generation']==snapshot['access_generation'] and
            data['conversation_work_version']==snapshot['work_version'] and
            snapshot['execution']['state'] not in ('unknown','recovering','queued','running','awaiting_provider'))
