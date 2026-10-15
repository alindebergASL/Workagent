"""Believable example projects for the Space browser journey, before the stack starts.

Real Service, PostgreSQL and GeneralWorker with the backend tests' synthetic
provider transport (no live model, no network). Each piece of work is written by
the worker through its own receipt-bound path, from scripted decisions: this
proves mechanics and presentation, never agency or usefulness. The UI build
that shows it sets NEXT_PUBLIC_WORKAGENT_DEMO=1, which labels every page.

Usage (repo root, env file sourced so DATABASE_URL and MIGRATION_DATABASE_URL
are set): backend/.venv/bin/python web/scripts/space_demo_fixture.py <out.json> <state-dir>
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'backend/tests')]

from workagent.db import Database  # noqa: E402
from workagent.fixture import seed  # noqa: E402
from workagent.models import CreateWorkArea, PostMessage  # noqa: E402
from workagent.service import Service, Principal  # noqa: E402
from test_general_alpha_runtime import AlphaProvider  # noqa: E402
from test_general_responses import worker  # noqa: E402
from test_conversations import cmd, conversation  # noqa: E402
from hashlib import sha256  # noqa: E402
from workagent.models import ProviderGrant, GeneralAlphaResponsesBinding, new_id  # noqa: E402
from workagent.composition import POLICY, DECISION_SCHEMA  # noqa: E402
from workagent.general_schema import EXPLANATION_SCHEMA  # noqa: E402
from workagent.general_responses import consumer_hash, AUTHORIZATION_HASH  # noqa: E402
from workagent.provider_attempts import configure_grant  # noqa: E402

out, state = Path(sys.argv[1]), Path(sys.argv[2])
admin = os.environ['MIGRATION_DATABASE_URL']
service = Service(Database(os.environ['DATABASE_URL']))
me = (service, Principal('local-human'), 'local-workspace', [], admin)
s, p, ws = service, me[1], me[2]


def activate_many(ctx, cvs):
    """One synthetic grant (one per workspace and person) for these conversations."""
    _, principal, workspace, _, migration = ctx
    configure_grant(Database(migration), ProviderGrant(
        id=new_id(), workspace_id=workspace, principal_id=principal.id, profile='general-responses-v1',
        model='gpt-6.1-sol', consumer_sha256=consumer_hash(), expires_at=None, max_runs=10,
        max_received_output_tokens=16384, responses=GeneralAlphaResponsesBinding(
            runtime_extension='general-alpha-v1', project_id='proj_' + workspace,
            secret_reference='file:/synthetic/not-a-key', transport_mode='synthetic',
            instructions_sha256=sha256(POLICY.encode()).hexdigest(),
            schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest(),
            scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),
            authorization_sha256=AUTHORIZATION_HASH, conversation_ids=[cv.id for cv in cvs],
            generation_limit=50, count_limit=50, read_limit=500, input_limit=1000000,
            output_limit=409600, cost_limit_usd='20.00')))


def responsibility(goal, criteria, *, wait=None, next_action=None):
    return {'kind': 'record_responsibility', 'goal': goal, 'completion_criteria': criteria,
            'plan': {'current_outcome': 'Recorded; nothing sent externally.',
                     'next_action': next_action or {'kind': 'await_event', 'description': 'Wait for the reply.'},
                     'wait': wait, 'next_check_in_at': None, 'dependencies': []}}


def area(title, goal, kind):
    return s.create_work_area(p, ws, cmd(CreateWorkArea, title=title, goal=goal, kind=kind,
                                         selected_source_refs=[]))


def ask(cv_id, text, decisions, explanation, target=None, name='turn'):
    """One request, answered by the worker from the given scripted decisions."""
    cv = s.get_conversation(p, ws, cv_id).conversation
    q = s.post_message(p, ws, cv_id, cmd(PostMessage, expected_work_version=cv.work_version,
                                         text=text, target=target))
    fake = AlphaProvider(decisions, explanation=explanation)
    outcome = worker(me, fake, state / name).work(p, ws, q.run.id).state
    return q.run.id, outcome


def exact(artifact_id):
    a = s.get_artifact(p, ws, artifact_id)
    return {'artifact_id': a.id, 'revision_id': a.current_revision_id,
            'body_hash': a.current_revision.body_hash}


def para(i, text, kind='paragraph', checked=None):
    return {'block_id': f'b{i}', 'kind': kind, 'checked': checked, 'text': text}


PLAN = {'title': 'Workshop plan', 'blocks': [
    para(1, 'Two days, 40 people', 'heading'),
    para(2, 'A hands-on workshop on service design for small studio teams, held in '
            'Leeds on 23–24 October. Day one covers research and framing; day two is '
            'prototyping and a short show-and-tell.'),
    para(3, 'Before booking', 'heading'),
    para(4, 'Hold the venue with a refundable deposit', 'checklist', False),
    para(5, 'Confirm two facilitators for both days', 'checklist', True),
    para(6, 'Send the save-the-date once the venue confirms', 'checklist', False),
    para(7, 'Open question: whether to offer a remote seat. It would add a camera '
            'operator and roughly €400.'),
]}

FIELDS = [
    {'key': 'item', 'label': 'Item', 'type': 'text', 'editable': True, 'unit': None, 'scale': None, 'enum': None},
    {'key': 'cost', 'label': 'Cost', 'type': 'decimal', 'editable': True, 'unit': 'EUR', 'scale': 2, 'enum': None},
    {'key': 'notes', 'label': 'Notes', 'type': 'text', 'editable': True, 'unit': None, 'scale': None, 'enum': None},
]


def row(rid, item, cost, notes):
    return {'row_id': rid, 'cells': [{'field_key': 'item', 'value': item},
                                     {'field_key': 'cost', 'value': cost},
                                     {'field_key': 'notes', 'value': notes}]}


BUDGET = {'kind': 'structured_table', 'version': 'structured-table/v1', 'title': 'Budget',
          'notes': ['Quotes as of the first week of October; venue is provisional.'],
          'fields': FIELDS, 'rows': [
              row('venue', 'Venue, two days', '2400.00', 'Holds 50; deposit refundable until 10 Oct'),
              row('facilitators', 'Facilitators', '3200.00', 'Two people, both days'),
              row('materials', 'Materials and printing', '380.00', 'Cards, pens, wall paper'),
          ]}
BUDGET_WITH_CATERING = {**BUDGET, 'rows': BUDGET['rows'] + [
    row('catering', 'Catering', '1760.00', '40 people × 2 days at €22 per person')]}

NEWSLETTER = {'title': 'October issue outline', 'blocks': [
    para(1, 'Lead story: what we learned running three studio pilots this summer.'),
    para(2, 'Short items: the autumn workshop dates, a new case study, and one reader question.'),
    para(3, 'Draft by the 20th; send on the last Thursday of the month.'),
]}

workshop = area('Autumn workshop', 'Run a two-day service design workshop for 40 people '
                'in Leeds this October, within a €9,000 budget.', 'project')
newsletter = area('Monthly newsletter', 'Write and send the studio newsletter on the last '
                  'Thursday of each month.', 'workflow')
plain = conversation(me)
activate_many(me, [workshop, newsletter, plain])

publish = lambda body, target=None: {'kind': 'publish_artifact', 'target': target, 'body': body}  # noqa: E731
runs = {}
runs['plan'] = ask(workshop.id, 'Draft a plan for the workshop: what happens each day and what we need to book.',
                   [publish(PLAN)], 'I drafted a plan with what to book first; the venue is the open item.',
                   name='plan')
plan_id = s.get_conversation(p, ws, workshop.id).artifact_ids[0]
runs['budget'] = ask(workshop.id, 'Put the costs we know so far in a budget table.',
                     [publish(BUDGET)], 'Here are the known costs; catering isn’t in yet.', name='budget')
budget_id = next(a for a in s.get_conversation(p, ws, workshop.id).artifact_ids if a != plan_id)
budget_target = exact(budget_id)
runs['catering'] = ask(workshop.id, 'Add catering at €22 per person for both days.',
                       [publish(BUDGET_WITH_CATERING, budget_target)],
                       'I proposed adding catering; it brings the total to €7,740.',
                       target=budget_target, name='catering')
runs['venue'] = ask(workshop.id, 'Keep the venue booking moving until they confirm in writing.',
                    [responsibility('Get written confirmation of the venue booking',
                                    ['The venue confirms the dates and deposit in writing'],
                                    wait={'kind': 'person', 'reason': 'The venue hasn’t replied to the hold request.'}),
                     {'kind': 'reply', 'text': 'I’ve recorded it; it’s waiting on the venue.'}],
                    'I’ve recorded the venue follow-up; it’s waiting on their reply.', name='venue')
runs['plain'] = ask(plain.id, 'How long should breaks be in a full-day workshop?',
                    [{'kind': 'reply', 'text': 'About 15 minutes mid-morning and mid-afternoon, '
                      'with an hour for lunch, works for most groups.'}],
                    'About 15 minutes mid-morning and mid-afternoon, with an hour for lunch.',
                    name='plain')
runs['newsletter'] = ask(newsletter.id, 'Outline the October issue.', [publish(NEWSLETTER)],
                         'Here’s an outline for October.', name='newsletter')

detail = s.get_conversation(p, ws, workshop.id)
seed(admin, [], 'isolated-workspace', 'someone-else')
result = {
    'mode': 'real_service_postgresql_worker_with_synthetic_provider_transport',
    'live_provider_calls': 0,
    'workspace': ws,
    'workshop': {'conversation_id': workshop.id, 'plan_id': plan_id, 'budget_id': budget_id,
                 'assignment_ids': detail.assignment_ids},
    'newsletter': {'conversation_id': newsletter.id},
    'plain': {'conversation_id': plain.id},
    'worker_states': {k: v[1] for k, v in runs.items()},
}
out.write_text(json.dumps(result, indent=2))
print(json.dumps(result))
