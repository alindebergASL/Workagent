"""Evaluator-side product adapter, executed with the selected arm's import tree.

Only disposable database provisioning is implemented here. Official installed-mode
setup is deliberately not implemented: admission must use existing compatible
funded grants, never clone synthetic fixtures into an installed database.
"""
from __future__ import annotations
from datetime import timedelta
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from network_harness import REPO as ROOT, inventory, jail
DEPS = ROOT/'backend/.venv/lib/python3.12/site-packages'
from study_controller import canonical, digest, Hold


def cmd(cls, **kwargs):
    from workagent.models import new_id
    return cls(schema_version='workagent/v1', request_id=new_id(), command_id=new_id(), **kwargs)


def load_env(path):
    return dict(line.removeprefix('export ').split('=', 1) for line in path.read_text().splitlines())


def fixture_grant(service, principal, workspace, conversations, mode, admin):
    """Disposable, synthetic authority only. Native token limits left unchanged."""
    from workagent.models import GeneralAlphaResponsesBinding, ProviderGrant, now, new_id
    from workagent.composition import POLICY, DECISION_SCHEMA
    from workagent.general_schema import EXPLANATION_SCHEMA
    from workagent.general_responses import consumer_hash, AUTHORIZATION_HASH
    from workagent.provider_attempts import configure_grant
    from workagent.db import Database
    if mode != 'B0':
        from types import SimpleNamespace
        from workagent.adaptive import contract
        from workagent.capabilities.delegation_composition import SCHEMA
        POLICY, DECISION_SCHEMA = contract(SimpleNamespace(continuity_version='sustained-v1',
            memory_recall='reviewed-v1' if mode == 'M1' else 'off', scope_tool_sha256=digest(SCHEMA.material)))
    assert '/workagent_test_' in admin
    extra = {} if mode == 'B0' else {'memory_recall': 'reviewed-v1' if mode == 'M1' else 'off'}
    options = GeneralAlphaResponsesBinding(project_id='proj_b35c_disposable', secret_reference='file:/not-mounted',
        transport_mode='synthetic', instructions_sha256=digest(POLICY), schema_sha256=digest(EXPLANATION_SCHEMA.material),
        scope_tool_sha256=digest(DECISION_SCHEMA.material), conversation_ids=conversations,
        authorization_sha256=AUTHORIZATION_HASH, runtime_extension='general-alpha-v1',
        continuity_version='sustained-v1', max_steps=8, generation_limit=256, count_limit=256,
        read_limit=4096, input_limit=12800000, output_limit=2097152, cost_limit_usd='20.00', **extra)
    grant = configure_grant(Database(admin), ProviderGrant(id=new_id(), workspace_id=workspace, principal_id=principal.id,
        model='gpt-6.1-sol', profile='general-responses-v1', consumer_sha256=consumer_hash(), expires_at=None,
        max_runs=10, max_received_output_tokens=16384, responses=options))
    return grant.model_dump(mode='json')


def open_trajectory(directory, payload, live_binding=None):
    expected = ROOT / ('.local/batch3/b35b/baseline/workagent' if payload['variant'] == 'B0' else 'backend/workagent')
    import workagent
    if inventory(Path(workagent.__file__).parent) != inventory(expected) or digest(canonical(inventory(expected))) != payload['source_manifest_sha256']:
        raise Hold('arm_source_drift')
    if payload['mode'] == 'official_api':
        from study_transport import require_live_release
        require_live_release()
        from study_binding import validate_context
        if live_binding is None:
            raise Hold('exact_installed_binding_required')
        validate_context(live_binding)
        # Supplied by the execution owner, not discovered or generated. This path
        # cannot create databases, install grants, allocate, or expand authority.
        from workagent.service import Service, Principal
        from workagent.db import Database
        if not live_binding or live_binding['blind_id'] != payload['blind_id']:
            raise Hold('exact_installed_binding_required')
        service = Service(Database(live_binding['database_url']))
        service.db.check_runtime_role()
        principal = Principal(live_binding['principal'])
        for ws, ids in ((live_binding['workspaces'][0],live_binding['conversations']),
                        (live_binding['workspaces'][1],[live_binding['other']])):
            for cid in ids:
                service.get_conversation(principal,ws,cid)
        for grant in (live_binding['grant'],live_binding['other_grant']):
            with service.db.transaction() as c:
                actual = c.execute('SELECT data,active FROM provider_grants WHERE id=%s',(grant['id'],)).fetchone()
            if not actual or not actual['active'] or actual['data'] != grant or grant['responses']['transport_mode'] != 'official_api':
                raise Hold('installed_grant_mismatch')
            recall = grant['responses'].get('memory_recall','off')
            if recall != payload['memory_recall']:
                raise Hold('installed_treatment_mismatch')
        connection = directory/'connection.json'
        with connection.open('x') as f:
            os.chmod(connection,0o600)
            f.write(canonical({'DATABASE_URL':live_binding['database_url']}))
        state = {k:live_binding[k] for k in ('workspaces','conversations','other','grant','other_grant','principal')}
        state.update(payload, artifacts=[],memory=[],episode=0,collected=0,visits=[],current_run=None)
        return state, {'id':payload['blind_id'],'variant':payload['variant'],'source_manifest_sha256':payload['source_manifest_sha256']}
    if payload['mode'] != 'controlled_http' or live_binding is not None:
        raise Hold('unsupported_setup_mode')
    env_file = directory / 'fixture.env'
    provision = subprocess.run([str(ROOT/'backend/.venv/bin/python'), str(ROOT/'backend/dev_db.py'), '--env-file', str(env_file)],
                               cwd=ROOT, env={'PATH':os.environ['PATH'], 'PYTHONPATH':str(ROOT/'backend')}, capture_output=True)
    if provision.returncode:
        raise Hold('disposable_provision_failed')
    env = load_env(env_file)
    from workagent.fixture import seed
    from workagent.service import Service, Principal
    from workagent.db import Database
    from workagent.models import CreateWorkArea, CreateConversation, new_id
    principal = Principal('local-human')
    records = json.loads((ROOT/'fixtures/actor/solo-v0.1/initial_records.json').read_text())
    workspaces = ['study-'+new_id(), 'other-'+new_id()]
    for ws in workspaces:
        seed(env['MIGRATION_DATABASE_URL'], records, ws, principal.id)
    service = Service(Database(env['DATABASE_URL']))
    area = service.create_work_area(principal, workspaces[0], cmd(CreateWorkArea, title='Synthetic editorial project', goal='Public source editorial work', kind='project', selected_source_refs=[]))
    conversations = [area.id]
    for _ in range(2):
        conversations.append(service.create_conversation(principal, workspaces[0], cmd(CreateConversation)).id)
    other = service.create_conversation(principal, workspaces[1], cmd(CreateConversation)).id
    grant = fixture_grant(service, principal, workspaces[0], conversations, payload['variant'], env['MIGRATION_DATABASE_URL'])
    # Same DB, distinct workspace and grant. Select runtime grant at ingress.
    other_grant = fixture_grant(service, principal, workspaces[1], [other], payload['variant'], env['MIGRATION_DATABASE_URL'])
    state = dict(payload, workspaces=workspaces, conversations=conversations, other=other, grant=grant,
                 other_grant=other_grant, principal=principal.id, artifacts=[], memory=[], episode=0,
                 collected=0, visits=[], current_run=None)
    return state, {'id': payload['blind_id'], 'variant': payload['variant'], 'source_manifest_sha256': payload['source_manifest_sha256']}


def context(directory, state):
    from workagent.service import Service, Principal
    from workagent.db import Database
    if state['mode'] == 'official_api':
        from study_transport import require_live_release
        require_live_release()
        env = json.loads((directory/'connection.json').read_text())
    else:
        env = load_env(directory/'fixture.env')
        if '/workagent_test_' not in env['DATABASE_URL'] or '/workagent_test_' not in env['MIGRATION_DATABASE_URL']:
            raise Hold('disposable_only')
    return Service(Database(env['DATABASE_URL'])), Principal(state['principal']), env


def transition(directory, state, payload):
    from workagent.models import HumanSave, Block
    service, principal, env = context(directory, state)
    ep = payload['episode']
    if ep != state['collected'] + 1:
        raise Hold('predecessor_episode_not_collected')
    if state['current_run']:
        previous = service.get_run(principal, state['workspace'], state['current_run'])
        if previous.state not in ('ready', 'partial'):
            raise Hold('predecessor_run_unsettled')
    inputs = (ROOT/payload['input_directory']).resolve()
    if not inputs.is_relative_to(ROOT/'.local/batch3/b35c/preparation/public-inputs') or inventory(inputs) != payload['input_files']:
        raise Hold('transition_input_drift')
    state['inputs'] = str(inputs)
    state['input_files'] = payload['input_files']
    state['episode'] = ep
    state['workspace'] = state['workspaces'][ep == 6]
    state['conversation'] = state['other'] if ep == 6 else state['conversations'][0 if ep < 5 else 1]
    events = []
    if ep == 2:
        prompt = (inputs/'prompt.md').read_text()
        paragraph = prompt.split('preserve it through future revisions of this artifact:\n\n', 1)[1].split('\n\n', 1)[0]
        procedure = prompt.split('I approve the following project-only procedural preference for review through the ordinary memory workflow if available: ', 1)[1].split(' This is not permission', 1)[0]
        if not state['artifacts']:
            raise Hold('no_artifact_to_human_edit')
        artifact = service.get_artifact(principal, state['workspace'], state['artifacts'][0])
        body = artifact.current_revision.body.model_copy(deep=True)
        body.blocks[0] = Block(block_id='human-protected', kind='protected_note', text=paragraph)
        saved = service.human_save(principal, state['workspace'], artifact.id, cmd(HumanSave, expected_current_revision_id=artifact.current_revision_id, body=body))
        events.append({'kind':'human_edit', 'artifact_id':artifact.id, 'revision_id':saved.current_revision_id, 'body_hash':saved.current_revision.body_hash})
        state['protected'] = paragraph
        if state['variant'] != 'B0':
            from workagent.memory.models import ProposeMemory, ReviewMemory
            proposal = service.propose_memory(principal, state['workspace'], cmd(ProposeMemory,
                kind='project_convention', scope_kind='work_area', scope_id=state['conversations'][0],
                subject_key='editorial', predicate_key='procedure', content=procedure))
            accepted = service.review_memory(principal, state['workspace'], proposal.memory_id,
                cmd(ReviewMemory, expected_revision_id=proposal.revision_id, decision='accept'))
            state['memory'].append(accepted.model_dump(mode='json'))
            events.append({'kind':'ordinary_memory_review', 'memory_id':accepted.memory_id, 'status':accepted.status})
        else:
            events.append({'kind':'baseline_no_memory_api', 'raw_human_edit_retained':True})
    if ep == 5 and state['variant'] != 'B0':
        from workagent.memory.models import BindMemoryScope
        cv = service.get_conversation(principal, state['workspace'], state['conversation']).conversation
        service.bind_memory_scope(principal, state['workspace'], cmd(BindMemoryScope, conversation_id=cv.id,
            work_area_id=state['conversations'][0], expected_work_version=cv.work_version))
        events.append({'kind':'explicit_project_scope_binding'})
    if ep == 6:
        if state['variant'] != 'B0':
            from workagent.memory.models import MemoryCAS
            for memory in state['memory']:
                forgotten = service.forget_memory(principal, state['workspaces'][0], memory['memory_id'],
                    cmd(MemoryCAS, expected_revision_id=memory['revision_id']))
                events.append({'kind':'forgotten', 'memory_id':forgotten.memory_id, 'status':forgotten.status})
        for aid in state['artifacts']:
            try:
                service.get_artifact(principal, state['workspace'], aid)
            except Exception as exc:
                from workagent.errors import DomainError
                if not isinstance(exc, DomainError) or exc.code.value != 'not_found_or_not_authorized':
                    raise
            else:
                raise Hold('other_project_artifact_access')
        events.append({'kind':'other_project', 'prior_artifacts_denied':len(state['artifacts'])})
    # Every execute constructs a new process/worker with persistent run state.
    events.append({'kind':'fresh_worker_visit', 'retained_state':True})
    state['transition_events'] = events
    return {'conversation_id':state['conversation'], 'workspace_id':state['workspace'], 'events':events}


def admit(directory, state, payload):
    from workagent.models import PostMessage
    from workagent.message_models import ExactTarget
    import psycopg
    service, principal, env = context(directory, state)
    if digest(payload['message']) != payload['message_sha256'] or payload['input_files'] != state['input_files']:
        raise Hold('ingress_drift')
    grant = state['other_grant'] if state['episode'] == 6 else state['grant']
    target = None
    if state['artifacts'] and state['episode'] in (2, 3, 4):
        artifact = service.get_artifact(principal, state['workspace'], state['artifacts'][0])
        target = ExactTarget(artifact_id=artifact.id, revision_id=artifact.current_revision_id, body_hash=artifact.current_revision.body_hash)
    cv = service.get_conversation(principal, state['workspace'], state['conversation']).conversation
    result = service.post_message(principal, state['workspace'], cv.id, cmd(PostMessage,
        expected_work_version=cv.work_version, text=payload['message'], target=target))
    state['current_run'] = result.run.id
    state['message_sha256'] = payload['message_sha256']
    state['active_grant'] = grant
    return {'run_id':result.run.id, 'message_sha256':payload['message_sha256'], 'conversation_id':cv.id}


def execute(directory, state, payload):
    service, principal, env = context(directory, state)
    episode_dir = directory / f"episode-{state['episode']}"
    episode_dir.mkdir(exist_ok=True)
    source = ROOT / ('.local/batch3/b35b/baseline/workagent' if state['variant'] == 'B0' else 'backend/workagent')
    product = directory/'product'
    if not product.exists():
        shutil.copytree(source, product, ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    if digest(canonical(inventory(product))) != state['source_manifest_sha256']:
        raise Hold('staged_arm_drift')
    worker_state = directory/'worker-state'
    worker_state.mkdir(mode=0o700, exist_ok=True)
    with service.db.transaction() as c:
        config = c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s', (state['workspace'],state['current_run'])).fetchone()['data']
    files = {'/worker.py': ROOT/'evaluation/study_worker.py', '/network_worker.py':ROOT/'evaluation/network_worker.py', '/study_transport.py':ROOT/'evaluation/study_transport.py'}
    from urllib.parse import urlsplit
    local_ports = [int(state['controlled_origin'].rsplit(':',1)[1])] if state['mode']=='controlled_http' else [443]
    cfg = dict(transport=state['mode'], controlled_origin=state.get('controlled_origin'),
        allowed_tcp_ports=[urlsplit(env['DATABASE_URL']).port or 5432, *local_ports], forbidden_listener_port=1,
        dsn=env['DATABASE_URL'], workspace=state['workspace'], principal=principal.id,
        run_id=state['current_run'], grant_id=state['active_grant']['id'], grant=state['active_grant'],
        run_configuration=config, source_manifest=inventory(product), input_files=state['input_files'],
        dependencies=state['environment']['dependencies'], execution_files=state['environment']['files'])
    if state['mode'] == 'official_api':
        cfg['credential'] = state.pop('_credential',None)
        if state['variant'] != 'B0':
            from workagent.capabilities import registry
            with service.db.transaction() as c:
                tool = c.execute('SELECT data FROM tool_grants WHERE run_id=%s',(state['current_run'],)).fetchone()
            if not tool:
                raise Hold('exact_existing_tool_authority_required:' + state['current_run'])
            cfg['tool_grant'] = tool['data']
            cfg['descriptors'] = {pin['id']:registry.adapters()[pin['id']].descriptor.model_dump(mode='json') for pin in tool['data']['capabilities']}
    visits = []
    for attempt in range(20):  # bounded diagnostic visits; exhaustion is a HOLD, not acceptance
        cfg['interrupt'] = state['mode']=='controlled_http' and state['episode'] == 3 and attempt == 0
        argv = jail(Path(state['inputs']), worker_state, product)
        i = argv.index(str(ROOT/'evaluation/network_worker.py'))
        argv[i] = str(files['/worker.py'])
        # Add readonly auxiliary modules before the executable in the retained jail.
        at = argv.index('--')
        argv[at:at] = ['--ro-bind', str(files['/network_worker.py']), '/network_worker.py', '--ro-bind', str(files['/study_transport.py']), '/study_transport.py']
        result = subprocess.run(argv, input=json.dumps(cfg), text=True, capture_output=True, cwd=ROOT, timeout=240)
        (episode_dir/f'worker-{attempt}.stdout').write_text(result.stdout)
        (episode_dir/f'worker-{attempt}.stderr').write_text(result.stderr)
        if result.returncode:
            raise Hold('isolated_worker_failed:' + str(episode_dir/f'worker-{attempt}.stderr'))
        receipt = json.loads(result.stdout)
        visits.append(receipt)
        if receipt['state'] in ('ready', 'partial'):
            break
        if receipt['state'] not in ('interrupted', 'running'):
            raise Hold('worker_unknown_no_replay')
        if state['mode'] == 'official_api':
            # No lease surgery or automatic resend in the installed path. Preserve
            # durable IDs for root's existing response observation/recovery tools.
            raise Hold('installed_run_pending_observation:' + state['current_run'])
        # Reuse network-13's disposable-only safe interruption procedure. Never
        # expire an installed lease, or a fixture with unmatched external I/O.
        from workagent.db import Database
        with service.db.transaction() as c:
            events = c.execute('SELECT phase,kind FROM responses_events WHERE attempt_id IN (SELECT id FROM provider_attempts WHERE run_id=%s)', (state['current_run'],)).fetchall()
        for phase in {r['phase'] for r in events}:
            kinds = {r['kind'] for r in events if r['phase'] == phase}
            if ('count_send' in kinds and 'count_result' not in kinds) or ('dispatch' in kinds and 'result' not in kinds):
                raise Hold('provider_outcome_unknown_no_replay')
        with Database(env['MIGRATION_DATABASE_URL']).transaction() as c:
            c.execute("UPDATE runs SET data=jsonb_set(data,'{lease_expires_at}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE workspace_id=%s AND id=%s", (state['workspace'],state['current_run']))
    run = service.get_run(principal, state['workspace'], state['current_run'])
    if run.state not in ('ready','partial'):
        raise Hold('unsettled_worker:' + run.state)
    state['visits'] = visits
    return {'status':run.state, 'run_id':run.id, 'visits':visits, 'unresolved':run.unresolved}


def collect(directory, state, payload):
    service, principal, env = context(directory, state)
    detail = service.get_conversation(principal, state['workspace'], state['conversation'])
    artifacts = []
    for aid in detail.artifact_ids:
        item = service.get_artifact(principal, state['workspace'], aid)
        body = item.current_revision.body.model_dump(mode='json')
        artifacts.append({'artifact_id':aid, 'revision_id':item.current_revision_id,
                          'body':body, 'body_sha256':digest(canonical(body))})
        if state['episode'] != 6 and aid not in state['artifacts']:
            state['artifacts'].append(aid)
    # Keep exact user-visible assistant messages even when there is no artifact.
    messages = [m.model_dump(mode='json') for m in detail.messages if m.run_id == state['current_run'] and m.author_kind != 'human']
    state['collected'] = state['episode']
    return {'blind_id':state['blind_id'], 'episode':state['episode'], 'artifacts':artifacts,
        'messages':messages, 'oracle_sha256':payload['oracle_sha256'],
        'message_sha256':state['message_sha256'], 'input_files':state['input_files'],
        'transitions':state['transition_events'], 'visits':state['visits'],
        'status':payload['outcome']['status'], 'evidence_level':'scripted_actual_product_SQL_and_HTTP_not_usefulness' if state['mode']=='controlled_http' else 'unscored_live_execution'}


def main():
    directory = Path(sys.argv[1]); request = json.load(sys.stdin)
    state_path = directory/'application.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else None
    op, payload = request['operation'], request['payload']
    if op == 'open_trajectory':
        payload['controlled_origin'] = request['controlled_origin']
        state, value = open_trajectory(directory, payload, request.get('live_binding'))
        state['environment'] = request['environment']
    else:
        if state['environment'] != request['environment']:
            raise Hold('application_environment_drift')
        if payload['trajectory']['id'] != state['blind_id'] or payload['trajectory']['variant'] != state['variant']:
            raise Hold('trajectory_drift')
        functions = {'transition':transition, 'ingress':admit, 'execute':execute, 'collect':collect}
        if op == 'execute' and state['mode'] == 'official_api':
            state['_credential'] = request.get('credential')
        value = functions[op](directory,state,payload)
    temporary = directory/'application.next'
    temporary.write_text(canonical(state))
    os.replace(temporary, state_path)
    print(canonical(value))

if __name__ == '__main__':
    main()
