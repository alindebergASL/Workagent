"""Parent-authored actual TCP/restricted-PG acceptance (no model calls)."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import pytest
from test_workspace_files_parent_http import tcp, checked, command, create_work
from test_domain import context


def remember(client, ws, cv, **changes):
    fields = dict(kind='preference', scope_kind='task', scope_id=cv['id'],
                  subject_key='reports', predicate_key='heading_style', content='Use concise headings',
                  confidence_basis='Explicit human preference', applicability='Ordinary project summaries')
    fields.update(changes)
    return checked(client.post(f'/v1/workspaces/{ws}/memory/remember', json=command(**fields)), 201)


def inspect(client, ws, receipt):
    return checked(client.get(f'/v1/workspaces/{ws}/memory/{receipt["memory_id"]}'))


def page(client, ws, cv, **params):
    return checked(client.get(f'/v1/workspaces/{ws}/memory', params=dict(conversation_id=cv['id'], **params)))


def test_parent_tcp_remember_review_race_forget_restart(tcp):
    client, ctx, start, stop, tmp = tcp
    _, _, ws, _, _ = ctx
    cv = create_work(client, ws)
    receipt = remember(client, ws, cv)
    initial = inspect(client, ws, receipt)['current']
    assert initial['status'] == 'active' and initial['origin'] == 'human_explicit'
    assert initial['reviewed_by_principal_id'] is None
    root = f'/v1/workspaces/{ws}/memory'
    # Procedures require exact observed evidence since B3.4a; a prose claim is
    # not proof. Retain the real TCP review/CAS journey with valid provenance.
    from test_procedure_memory_pg import evidence, details
    service, principal, _, _, _ = ctx
    _, observed = evidence(ctx, service.get_conversation(principal, ws, cv['id']).conversation)
    fields = dict(kind='procedure', scope_kind='task', scope_id=cv['id'], subject_key='analysis',
                  predicate_key='denominator_check', content='Verify units and denominator before calculating',
                  applicability='Current data joins after checking present inputs',
                  procedure=details(observed.evidence).model_dump(mode='json'),
                  confidence_basis='Proposed from synthetic local observation')
    candidate_body = command(**fields)
    candidate = checked(client.post(root + '/candidates', json=candidate_body), 201)
    assert candidate['status'] == 'candidate'
    assert candidate['memory_id'] not in [x['revision']['memory_id'] for x in page(client, ws, cv)['items']]
    assert candidate['memory_id'] in [x['revision']['memory_id'] for x in page(client, ws, cv, status='candidate')['items']]
    # Untrusted source text cannot turn a proposal into an accepted record.
    forged = client.post(root + '/candidates', json=command(**fields, status='active', origin='human_reviewed'))
    assert forged.status_code == 422
    review = command(expected_revision_id=candidate['revision_id'], decision='accept')
    accepted = checked(client.post(root + '/' + candidate['memory_id'] + '/review', json=review))
    assert accepted['status'] == 'active'
    stale = client.post(root + '/' + candidate['memory_id'] + '/review', json=command(
        expected_revision_id=candidate['revision_id'], decision='accept'))
    assert stale.status_code == 409
    # Two real requests race from one inspected base. Exactly one applies.
    def correct(i):
        return client.post(root + '/' + receipt['memory_id'] + '/correct', json=command(
            expected_revision_id=receipt['revision_id'], content='Full headings ' + str(i), mode='permanent'))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(correct, (1, 2)))
    assert sorted(r.status_code for r in results) == [200, 409]
    latest = inspect(client, ws, receipt)['current']
    assert latest['supersedes_revision_id'] == receipt['revision_id']
    forget_body = command(expected_revision_id=latest['revision_id'])
    forgotten = checked(client.post(root + '/' + receipt['memory_id'] + '/forget', json=forget_body))
    assert forgotten['status'] == 'forgotten'
    assert checked(client.post(root + '/' + receipt['memory_id'] + '/forget', json=forget_body)) == forgotten
    detail = inspect(client, ws, receipt)
    assert all(x['content'] is None and x['subject_key'] is None for x in detail['revisions'])
    assert 'Full headings' not in json.dumps(detail)
    assert receipt['memory_id'] not in [x['revision']['memory_id'] for x in page(client, ws, cv)['items']]
    # A new inferred proposal from the same forgotten fact is suppressed.
    reextract = client.post(root + '/candidates', json=command(kind='preference', scope_kind='task', scope_id=cv['id'],
        subject_key='reports', predicate_key='heading_style', content='Use concise headings'))
    assert reextract.status_code in (404, 409, 422)
    stop(); start()
    assert inspect(client, ws, receipt)['current']['status'] == 'forgotten'
    assert inspect(client, ws, accepted)['current']['status'] == 'active'
    (tmp / 'memory-tcp-journey.json').write_text(json.dumps(dict(evidence='actual TCP + restricted PostgreSQL',
        explicit_active=True, inferred_candidate=True, stale_status=stale.status_code,
        race_statuses=sorted(r.status_code for r in results), forgotten_after_restart=True,
        reextract_status=reextract.status_code, product_provider_calls=0), indent=2))


def test_parent_tcp_scope_noninterference_dispute_and_temporary(tcp):
    client, ctx, _, _, _ = tcp
    _, _, ws, _, _ = ctx
    a, b = create_work(client, ws), create_work(client, ws)
    empty = page(client, ws, b, query='confidential')
    receipt = remember(client, ws, a, subject_key='confidential', predicate_key='timing', content='15 minutes')
    assert page(client, ws, b, query='confidential') == empty
    first = page(client, ws, a)
    assert len(first['items']) == 1
    conflicting = remember(client, ws, a, subject_key='confidential', predicate_key='timing', content='20 minutes')
    both = page(client, ws, a)['items']
    assert len(both) == 2 and all(x['unresolved_conflict'] for x in both)
    assert all(x['revision']['status'] == 'contested' for x in both)
    root = f'/v1/workspaces/{ws}/memory'
    checked(client.post(root + '/' + conflicting['memory_id'] + '/expire',
                        json=command(expected_revision_id=conflicting['revision_id'])))
    current = datetime.now(timezone.utc)
    exception = checked(client.post(root + '/' + receipt['memory_id'] + '/correct', json=command(
        expected_revision_id=receipt['revision_id'], content='10 minutes this week only', mode='temporary',
        valid_from=(current - timedelta(minutes=1)).isoformat(), valid_until=(current + timedelta(minutes=10)).isoformat())))
    item = page(client, ws, a)['items'][0]['revision']
    assert item['revision_id'] == exception['revision_id'] and item['exception_to_revision_id'] == receipt['revision_id']
    # Reject caller-controlled scope promotion/move and authority parameters.
    denied = client.post(root + '/' + receipt['memory_id'] + '/narrow', json=command(
        expected_revision_id=exception['revision_id'], scope_kind='user', scope_id='local-human'))
    assert denied.status_code in (404, 409, 422)
    assert page(client, ws, b) == empty
