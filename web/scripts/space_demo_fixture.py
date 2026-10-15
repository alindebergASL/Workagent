"""Believable example projects for the Space browser journey, before the stack starts.

Real Service, PostgreSQL and GeneralWorker with the backend tests' synthetic
provider transport (no live model, no network). Each piece of work is written by
the worker through its own receipt-bound path, from scripted decisions: this
proves mechanics and presentation, never agency or usefulness. The UI build
that shows it sets NEXT_PUBLIC_WORKAGENT_DEMO_MODE=1, which labels every page.

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
from workagent.models import CreateWorkArea, HumanSave, PostMessage, Workspace  # noqa: E402
from workagent.service import Service, Principal, encoded  # noqa: E402
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
# A change proposed to the plan, then the person edits the plan themselves:
# the proposal was made for an earlier version, so it is outdated.
plan_target = exact(plan_id)
REMOTE = {**PLAN, 'blocks': PLAN['blocks'] + [para(8, 'Remote seat: one camera operator on day two only.')]}
runs['remote'] = ask(workshop.id, 'Add a short section on the remote seat.',
                     [publish(REMOTE, plan_target)], 'I proposed a short remote-seat section.',
                     target=plan_target, name='remote')
EDITED = {**PLAN, 'blocks': [b if b['block_id'] != 'b5' else {**b, 'text': 'Confirm two facilitators for both days (Priya and Tom)'}
                             for b in PLAN['blocks']]}
s.human_save(p, ws, plan_id, cmd(HumanSave, expected_current_revision_id=plan_target['revision_id'], body=EDITED))
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

# A second personal workspace for the same person, listed after the first
# (workspaces are listed by id). Its work must open in it, never be looked up
# in the first one.
second = 'personal-work'
with Database(admin).transaction() as c:
    w = Workspace(id=second, name='Personal work', owner_id=p.id)
    c.execute('INSERT INTO workspaces(id,data) VALUES (%s,%s)', (w.id, encoded(w)))
    c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'owner')", (w.id, p.id))
first_ws, first_me = ws, me
ws, me = second, (service, p, second, [], admin)
open_day = area('Spring open day', 'Plan the studio open day in March for about 60 visitors.', 'project')
chat = conversation(me)
# A materially different project: an investigation that compares evidence.
supplier = area('Supplier choice', 'Choose a print supplier for the open day materials, '
                'weighing price against how quickly they can deliver.', 'project')
activate_many(me, [open_day, chat, supplier])
OPEN_DAY = {'title': 'Open day schedule', 'blocks': [
    para(1, 'Doors at 10:00; short talks at 11:00 and 14:00; studio tours every hour.'),
    para(2, 'Ask two volunteers to run the welcome desk.', 'checklist', False),
]}
runs['open_day'] = ask(open_day.id, 'Draft a schedule for the open day.', [publish(OPEN_DAY)],
                       'Here’s a first schedule; the talks are the fixed points.', name='open_day')
runs['open_day_handover'] = ask(
    open_day.id, 'Keep track of the volunteer sign-ups until two have confirmed.',
    [responsibility('Get two volunteers for the welcome desk', ['Two volunteers have confirmed'],
                    wait={'kind': 'person', 'reason': 'Waiting for volunteers to reply.'}),
     {'kind': 'reply', 'text': 'I’ve recorded it; it’s waiting on the volunteers.'}],
    'I’ve recorded the volunteer follow-up.', name='open_day_handover')
runs['chat'] = ask(chat.id, 'What time should the first talk start?',
                   [{'kind': 'reply', 'text': 'Eleven works well: people have arrived and looked around.'}],
                   'Eleven works well.', name='chat')
def field(key, label, type_, unit=None, scale=None):
    return {'key': key, 'label': label, 'type': type_, 'editable': True, 'unit': unit,
            'scale': scale, 'enum': None}


def srow(rid, name, price, days, note):
    return {'row_id': rid, 'cells': [{'field_key': 'supplier', 'value': name},
                                     {'field_key': 'price', 'value': price},
                                     {'field_key': 'days', 'value': days},
                                     {'field_key': 'notes', 'value': note}]}


EVIDENCE = {'kind': 'structured_table', 'version': 'structured-table/v1', 'title': 'Supplier evidence',
            'notes': ['Quotes for 40 workbooks and 200 cards, collected this week.'],
            'fields': [field('supplier', 'Supplier', 'text'),
                       field('price', 'Quote', 'decimal', 'EUR', 2),
                       field('days', 'Delivery', 'integer', 'days'),
                       field('notes', 'Notes', 'text')],
            'rows': [srow('north', 'Northprint', '640.00', 12, 'Recycled stock; samples were good'),
                     srow('quay', 'Quayside Press', '520.00', 18, 'Cheapest; slower in October'),
                     srow('lark', 'Lark & Co', '715.00', 6, 'Fastest; has printed for us before')]}
runs['evidence'] = ask(supplier.id, 'Collect the three supplier quotes into a table.', [publish(EVIDENCE)],
                       'I put the three quotes side by side.', name='evidence')
evidence_id = s.get_conversation(p, ws, supplier.id).artifact_ids[0]
evidence = s.get_artifact(p, ws, evidence_id)
# What matters most, saved: the person's assumption the comparison reads.
PRIORITIES = {'kind': 'structured_table', 'version': 'structured-table/v1', 'title': 'Priorities',
              'notes': ['How much price counts against delivery time, as a share.'],
              'fields': [field('weight', 'Weight on price', 'integer', '%')],
              'rows': [{'row_id': 'weights', 'cells': [{'field_key': 'weight', 'value': 50}]}]}
runs['priorities'] = ask(supplier.id, 'Keep how much price matters as a saved setting.', [publish(PRIORITIES)],
                         'I saved price and speed as equally important for now.', name='priorities')
priorities_id = next(a for a in s.get_conversation(p, ws, supplier.id).artifact_ids if a != evidence_id)
priorities = s.get_artifact(p, ws, priorities_id)
generation = next(w.access_generation for w in s.list_workspaces(p).items if w.id == ws)
COMPARE_JS = (
    'const $=(id)=>document.getElementById(id);let rows=[];'
    'function render(){const w=Number($("weight").value)/100;'
    '$("weightLabel").textContent=Math.round(w*100)+"% price, "+Math.round((1-w)*100)+"% speed";'
    'if(!rows.length)return;const maxP=Math.max(...rows.map(r=>r.price)),maxD=Math.max(...rows.map(r=>r.days));'
    'const scored=rows.map(r=>({...r,score:w*(1-r.price/maxP)+(1-w)*(1-r.days/maxD)})).sort((a,b)=>b.score-a.score);'
    '$("list").replaceChildren(...scored.map((r,i)=>{const li=document.createElement("li");'
    'li.textContent=(i===0?"Best fit: ":"")+r.supplier+" \u00b7 \u20ac"+r.price.toFixed(0)+" \u00b7 "+r.days+" days";return li;}));}'
    'async function load(){try{const r=await workagent.request("read",{});'
    'const pr=await workagent.request("read_priorities",{});'
    'const saved=Number(pr.body.rows[0].cells.find(x=>x.field_key==="weight").value);'
    '$("weight").value=String(saved);$("saved").textContent="Saved priority: "+saved+"% on price.";'
    'rows=r.body.rows.map(row=>{const c=Object.fromEntries(row.cells.map(x=>[x.field_key,x.value]));'
    'return {supplier:c.supplier,price:Number(c.price),days:Number(c.days)};});'
    '$("state").textContent="Using the saved quotes.";render();}'
    'catch(e){$("state").textContent="Couldn\u2019t read the saved quotes.";}}'
    '$("weight").addEventListener("input",render);workagent.ready().then(load);')
COMPARE = {'kind': 'custom_view', 'version': 'custom-view/v1', 'title': 'Supplier comparison',
           'source': {'html': '<main><p id="saved"></p><label>Try another weighting (not saved) <input id="weight" type="range" min="0" max="100" value="50"></label>'
                              ' <span id="weightLabel"></span><ol id="list"></ol><p id="state">Reading saved quotes.</p></main>',
                      'css': 'main{padding:12px;font:15px system-ui}li{margin:4px 0}#state,#saved{color:#666;font-size:13px}',
                      'js': COMPARE_JS},
           'fallback': 'Lark & Co is fastest (6 days, EUR 715); Quayside Press is cheapest (EUR 520, 18 days); '
                       'Northprint sits between (EUR 640, 12 days).',
           'access_generation': generation,
           'bindings': [{'name': 'quotes', 'artifact_id': evidence.id, 'revision_id': evidence.current_revision_id,
                         'body_hash': evidence.current_revision.body_hash},
                        {'name': 'priorities', 'artifact_id': priorities.id,
                         'revision_id': priorities.current_revision_id,
                         'body_hash': priorities.current_revision.body_hash}],
           'actions': [{'name': 'read', 'kind': 'read_binding', 'binding': 'quotes',
                        'payload_schema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
                       {'name': 'read_priorities', 'kind': 'read_binding', 'binding': 'priorities',
                        'payload_schema': {'type': 'object', 'properties': {}, 'additionalProperties': False}}]}
runs['compare'] = ask(supplier.id, 'Help me weigh price against speed.', [publish(COMPARE)],
                      'Here is a comparison you can weigh yourself; it reads the saved quotes.', name='compare')
FINDINGS = {'title': 'Findings so far', 'blocks': [
    para(1, 'What we know', 'heading'),
    para(2, 'Lark & Co can deliver in 6 days; the others need two to three weeks.'),
    para(3, 'Quayside Press is EUR 195 cheaper than Lark & Co but has been slow in October before.'),
    para(4, 'Ask Northprint whether they can match a 10-day delivery.', 'checklist', False),
    # Workagent keeps the person's constraints as a note; it quotes them but isn't theirs.
    para(5, 'You asked for: under EUR 700, delivered within two weeks.', 'protected_note'),
]}
runs['findings'] = ask(supplier.id, 'Write down what we know so far.', [publish(FINDINGS)],
                       'I wrote up what the quotes show and the open question.', name='findings')
supplier_detail = s.get_conversation(p, ws, supplier.id)
compare_id = next(a for a in supplier_detail.artifact_ids if a not in (evidence_id, priorities_id)
                  and getattr(s.get_artifact(p, ws, a).current_revision.body, 'kind', None) == 'custom_view')
findings_id = next(a for a in supplier_detail.artifact_ids
                   if a not in (evidence_id, compare_id, priorities_id))
# The person corrects the findings themselves; Workagent then proposes a change
# to that version: a live proposal against the person's own edit.
FINDINGS_EDITED = {**FINDINGS, 'blocks': [
    b if b['block_id'] != 'b3' else
    {**b, 'text': 'Quayside Press is EUR 195 cheaper than Lark & Co; they were late twice last October.'}
    for b in FINDINGS['blocks']]}
findings_first = exact(findings_id)
s.human_save(p, ws, findings_id, cmd(HumanSave, expected_current_revision_id=findings_first['revision_id'],
                                     body=FINDINGS_EDITED))
findings_target = exact(findings_id)
FINDINGS_PROPOSED = {**FINDINGS_EDITED, 'blocks': [
    b if b['block_id'] != 'b2' else
    {**b, 'text': 'Lark & Co can deliver in 6 days; Northprint says 10 days is possible for EUR 40 more.'}
    for b in FINDINGS_EDITED['blocks']] + [para(6, 'Decide by Friday so printing can start on Monday.',
                                                'checklist', False)]}
runs['findings_change'] = ask(supplier.id, 'Northprint can do 10 days for EUR 40 more; update the findings.',
                              [publish(FINDINGS_PROPOSED, findings_target)],
                              'I proposed updating the findings with Northprint’s offer.',
                              target=findings_target, name='findings_change')
open_detail = s.get_conversation(p, ws, open_day.id)
second_ids = {'workspace': second, 'conversation_id': open_day.id,
              'artifact_id': open_detail.artifact_ids[0],
              'assignment_ids': open_detail.assignment_ids,
              'chat_id': chat.id}
ws, me = first_ws, first_me
result = {
    'mode': 'real_service_postgresql_worker_with_synthetic_provider_transport',
    'live_provider_calls': 0,
    'workspace': ws,
    'workshop': {'conversation_id': workshop.id, 'plan_id': plan_id, 'budget_id': budget_id,
                 'assignment_ids': detail.assignment_ids},
    'newsletter': {'conversation_id': newsletter.id},
    'plain': {'conversation_id': plain.id},
    'second': second_ids,
    'supplier': {'workspace': second, 'conversation_id': supplier.id, 'evidence_id': evidence_id,
                 'compare_id': compare_id, 'findings_id': findings_id,
                 'priorities_id': priorities_id},
    'worker_states': {k: v[1] for k, v in runs.items()},
}
out.write_text(json.dumps(result, indent=2))
print(json.dumps(result))
