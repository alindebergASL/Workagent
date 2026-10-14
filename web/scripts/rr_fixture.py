"""Record real responsibilities for the browser journey, before the stack starts.

Real Service, PostgreSQL and GeneralWorker with the backend tests' synthetic
provider transport (no live model, no network): the worker records each
responsibility through its own receipt-bound path, as it would for a model
decision. Scripted decisions prove mechanics only, not agency.

Usage (repo root, env file sourced so DATABASE_URL and MIGRATION_DATABASE_URL
are set): backend/.venv/bin/python web/scripts/rr_fixture.py <out.json> <state-dir>
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'backend/tests')]

import os  # noqa: E402
import httpx  # noqa: E402
from workagent.db import Database  # noqa: E402
from workagent.fixture import seed  # noqa: E402
from workagent.service import Service, Principal  # noqa: E402
from hashlib import sha256  # noqa: E402
from test_general_alpha_runtime import AlphaProvider  # noqa: E402
from workagent.models import ProviderGrant, GeneralAlphaResponsesBinding, new_id  # noqa: E402
from workagent.composition import POLICY, DECISION_SCHEMA  # noqa: E402
from workagent.general_schema import EXPLANATION_SCHEMA  # noqa: E402
from workagent.general_responses import consumer_hash, AUTHORIZATION_HASH  # noqa: E402
from workagent.provider_attempts import configure_grant  # noqa: E402
from test_general_responses import worker  # noqa: E402
from test_conversations import conversation, post  # noqa: E402

out, state = Path(sys.argv[1]), Path(sys.argv[2])
dsn, admin = os.environ['DATABASE_URL'], os.environ['MIGRATION_DATABASE_URL']
service = Service(Database(dsn))


def decision(goal, criteria, *, wait=None, next_action=None):
    return {'kind': 'record_responsibility', 'goal': goal, 'completion_criteria': criteria,
            'plan': {'current_outcome': 'Recorded locally; nothing sent externally.',
                     'next_action': next_action or {'kind': 'await_event', 'description': 'Review a local human update.'},
                     'wait': wait, 'next_check_in_at': None, 'dependencies': []}}


class FailedFinalCount(AlphaProvider):
    """The final explanation's count fails: the recording stays, no explanation."""
    def handle(self, request):
        body = json.loads(request.content) if request.content else {}
        if request.url.path.endswith('/input_tokens') and body.get('tool_choice') == 'none':
            self.calls.append(('POST', request.url.path))
            return httpx.Response(500, json={'error': {'message': 'synthetic count failure'}})
        return super().handle(request)


def activate_many(ctx, cvs):
    """One synthetic grant (one per workspace and person) for these conversations."""
    s, p, ws, _, admin = ctx
    configure_grant(Database(admin), ProviderGrant(
        id=new_id(), workspace_id=ws, principal_id=p.id, profile='general-responses-v1',
        model='gpt-6.1-sol', consumer_sha256=consumer_hash(), expires_at=None, max_runs=10,
        max_received_output_tokens=16384, responses=GeneralAlphaResponsesBinding(
            runtime_extension='general-alpha-v1', project_id='proj_' + ws,
            secret_reference='file:/synthetic/not-a-key', transport_mode='synthetic',
            instructions_sha256=sha256(POLICY.encode()).hexdigest(),
            schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest(),
            scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),
            authorization_sha256=AUTHORIZATION_HASH, conversation_ids=[cv.id for cv in cvs],
            generation_limit=50, count_limit=50, read_limit=500, input_limit=1000000,
            output_limit=409600, cost_limit_usd='20.00')))


def record_all(ctx, cases):
    s, p, ws, _, _ = ctx
    cvs = [conversation(ctx) for _ in cases]
    activate_many(ctx, cvs)
    out = {}
    for cv, (name, ask, decisions, provider) in zip(cvs, cases):
        q = post(ctx, cv, ask)
        fake = provider(decisions, explanation='I recorded this locally; nothing was sent.')
        outcome = worker(ctx, fake, state / name).work(p, ws, q.run.id).state
        detail = s.get_conversation(p, ws, cv.id)
        out[name] = {'conversation_id': cv.id, 'assignment_id': detail.assignment_ids[0],
                     'run_id': q.run.id, 'worker_state': outcome,
                     'synthetic_provider_calls': len(fake.calls)}
    return out


me = (service, Principal('local-human'), 'local-workspace', [], admin)
result = {
    'mode': 'real_service_postgresql_worker_with_synthetic_provider_transport',
    'live_provider_calls': 0,
    **record_all(me, [
        ('waiting', 'Keep the venue hand-off current until the venue replies.', [
            decision('Keep the venue hand-off current',
                     ['The venue confirms the booking in writing'],
                     wait={'kind': 'person', 'reason': 'The venue has not replied.'}),
            {'kind': 'reply', 'text': 'I recorded it and will keep it current.'}], AlphaProvider),
        ('active', 'Carry the volunteer rota forward.', [
            decision('Prepare the volunteer rota', ['Every shift has a named volunteer'],
                     next_action={'kind': 'continue_work', 'description': 'Draft the first rota.'}),
            {'kind': 'reply', 'text': 'Recorded; nothing runs for it yet.'}], AlphaProvider),
        ('no_explanation', 'Hold the catering follow-up.', [
            decision('Follow up on the catering quote', ['A quote is received and reviewed'],
                     wait={'kind': 'person', 'reason': 'The caterer has not sent a quote.'}),
            {'kind': 'reply', 'text': 'Retained locally.'}], FailedFinalCount),
    ]),
}
# Another person's workspace: never visible to local-human.
seed(admin, [], 'isolated-workspace', 'someone-else')
other = (service, Principal('someone-else'), 'isolated-workspace', [], admin)
result.update({'other_workspace': record_all(other, [
    ('other', 'Track the other team budget.', [
        decision('Track the other team budget', ['The budget is approved'],
                 wait={'kind': 'person', 'reason': 'Finance has not replied.'}),
        {'kind': 'reply', 'text': 'Recorded.'}], AlphaProvider)])['other']})
out.write_text(json.dumps(result, indent=2))
print(json.dumps(result))
