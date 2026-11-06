"""Current gateway -> actual worker processes -> authorized HTTP downloads.

Use a NEW ordinary dev_db.py fixture; never a study/retained database. Provider
responses are explicitly scripted MockTransport, not model/usefulness evidence.
This file is also the private-stdin worker subprocess entry point.
"""
from datetime import timedelta
from hashlib import sha256
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from test_domain import context, cmd, fixture_database_urls
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker
from test_current_gateway_pg import retained_rows
from workagent import current_gateway
from workagent.adaptive import contract
from workagent.api import Settings, create_app
from workagent.capabilities import registry, policy
from workagent.capabilities.models import ToolGrantV1, CapabilityPin
from workagent.db import Database
from workagent.models import CreateConversation, Conversation, PostMessage, MessageQueued, new_id, now
from workagent.service import Principal, Service
from workagent.workspace_file_models import CreateWorkspaceFile, EditWorkspaceFile, WorkingText

FILES = (
    ('field-notes.md', 'text/markdown', '# Field notes\n\nRetained café notes for human review.\n', 'markdown'),
    ('field-counts.csv', 'text/csv', 'team,count\nalpha,2\nbeta,3\n', 'csv'),
)
ROOT = Path(__file__).resolve().parents[2]


def working_text(name, mime, value):
    return WorkingText(filename=name, mime_type=mime, content=value, sha256=sha256(value.encode()).hexdigest())


def export_choice(ctx):
    # Consume only the preceding actual worker-visible observation and reference.
    observation = next(o for o in reversed(ctx['adaptive']['observations'])
                       if o['decision']['kind'] == 'files_create_draft')
    current = observation['capability_result']['result']['current']
    ref = next(r for r in ctx['run_output_refs'] if r['kind'] == 'workspace_file'
               and r['id'] == current['workspace_file_id'] and r['version'] == current['version_id']
               and r['sha256'] == current['sha256'])
    name = observation['decision']['source']['filename']
    fmt = next(f[3] for f in FILES if f[0] == name)
    return dict(kind='artifacts_export', input_ref=ref, format=fmt)


def choices():
    result = [dict(kind='discover_capabilities')]
    for name, mime, value, _ in FILES:
        result += [dict(kind='files_create_draft', source=working_text(name, mime, value).model_dump()), export_choice]
    return result + [dict(kind='reply', text='Two named drafts and exports retained for review.')]


class SavedProvider(AlphaProvider):
    """The synthetic server survives worker restart; no historical response invention."""
    def __init__(self, path):
        super().__init__(choices(), explanation='Controlled workflow retained Markdown and CSV; human edits preserved.')
        self.path = Path(path)
        if self.path.exists():
            saved = json.loads(self.path.read_text())
            self.calls, self.responses, self.contexts = saved['calls'], saved['responses'], saved['contexts']

    def handle(self, request):
        # Explicit MockTransport only: these paths never reach a provider socket.
        assert request.method in ('POST', 'GET')
        result = super().handle(request)
        self.path.write_text(json.dumps(dict(calls=self.calls, responses=self.responses, contexts=self.contexts)))
        self.path.chmod(0o600)
        return result


def child(config):
    # Revalidate exact fresh fixture routing before a database connection.
    dsn, _ = fixture_database_urls(config['fixture'])
    service = Service(Database(dsn)); service.db.check_runtime_role()
    actor = Principal(config['principal'])
    ctx = service, actor, config['workspace'], [], None
    fake = SavedProvider(config['provider_state'])

    class StoppedAfterDraft(Exception):
        pass

    def hook(name):
        if config['interrupt'] and name == 'after_tool_result' and len(fake.contexts) == 2:
            raise StoppedAfterDraft()

    try:
        result = worker(ctx, fake, Path(config['state_dir']), hook=hook).work(actor, config['workspace'], config['run'])
        return dict(state=result.state, pid=os.getpid())
    except StoppedAfterDraft:
        return dict(state='interrupted_after_committed_draft', pid=os.getpid())


def run_child(config, out):
    # Full venv argv0; no inherited provider secrets, no shell and no DSN argv.
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'PYTHONPATH': str(ROOT/'backend') + ':' + str(ROOT/'backend/tests'),
           'PYTHONUNBUFFERED': '1', 'LANG': 'C.UTF-8'}
    with out.open('wb') as log:
        process = subprocess.run([str(ROOT/'backend/.venv/bin/python'), str(Path(__file__).resolve()), '--worker'],
                                 input=json.dumps(config).encode(), stdout=log, stderr=subprocess.STDOUT,
                                 env=env, cwd=ROOT, timeout=1200, check=False)
    assert process.returncode == 0, f'Controlled worker failed; sanitized evidence: {out}'
    return json.loads(out.read_text().splitlines()[-1])


def test_current_gateway_http_admission_worker_restart_and_named_downloads(context, tmp_path):
    s, p, ws, _, owner = context
    # Fixture schema must be ordinary complete current provisioning, not split bootstrap.
    with s.db.transaction() as c:
        assert {r['name']:r['checksum'] for r in c.execute('SELECT name,checksum FROM public.schema_migrations')} == {
            f.name:sha256(f.read_bytes()).hexdigest() for f in (ROOT/'backend/migrations').glob('*.sql')}
    token = secrets.token_urlsafe(32)
    settings = Settings(s.db.dsn, True, token, p.id)
    headers = {'Authorization':'Bearer '+token, 'X-Schema-Version':'workagent/v1', 'X-Request-Id':new_id()}
    prefix = f'/v1/workspaces/{ws}'
    with TestClient(create_app(settings)) as client:
        def post(path, command, status):
            response = client.post(prefix+path, headers=headers, json=command.model_dump(mode='json'))
            assert response.status_code == status, (path, response.status_code)
            return response.json()
        cv = Conversation.model_validate(post('/conversations', cmd(CreateConversation, selected_source_refs=[]), 201))
        human = post(f'/work-areas/{cv.id}/files', cmd(CreateWorkspaceFile, expected_work_version=cv.work_version,
                     source=working_text('human-notes.md', 'text/markdown', '# Original human note\n')), 201)
        human_original = human['current']
        human_text = '# Original human note\n\nHuman correction: preserve café and exact bytes.\n'
        human = post(f'/files/{human["workspace_file_id"]}/versions', cmd(EditWorkspaceFile,
                     expected_work_version=cv.work_version, base_version_id=human['current']['version_id'],
                     base_sha256=human['current']['sha256'], content=human_text, sha256=sha256(human_text.encode()).hexdigest()), 201)
        instructions, schema = contract(SimpleNamespace(continuity_version='sustained-v1', memory_recall='off',
                                                       scope_tool_sha256=sha256(current_gateway.SCHEMA.material).hexdigest()))
        assert schema is current_gateway.SCHEMA
        with patch('test_general_alpha_runtime.POLICY', instructions), patch('test_general_alpha_runtime.DECISION_SCHEMA', schema):
            pg = activate(context, cv, continuity_version='sustained-v1', memory_recall='off', max_steps=8)
        request = cmd(PostMessage, expected_work_version=cv.work_version,
                      text='Create field-notes.md and field-counts.csv and retain named downloads. Preserve my human note.')
        q = MessageQueued.model_validate(post(f'/conversations/{cv.id}/messages', request, 202))
    ds = [registry.adapters()[name].descriptor for name in ('capabilities.discover_legacy','files.create_draft','artifacts.export')]
    grant = ToolGrantV1(id=new_id(), workspace_id=ws, principal_id=p.id, run_id=q.run.id, scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=[], effects=sorted({effect for d in ds for effect in d.effects}), privacy_classes=['workspace_private'],
        egress='none', expires_at=now()+timedelta(hours=1), access_generation=q.run.access_generation,
        budget_account_id=new_id(), allow_run_outputs=True)
    policy.install(Database(owner), grant, limits={'local_compute':20, 'rendering':5}, provider_grant_id=pg.id)
    config = dict(fixture={k:os.environ[k] for k in ('DATABASE_URL','MIGRATION_DATABASE_URL','LOCAL_TEST_MODE','WORKAGENT_TEST_DATABASE')},
                  principal=p.id, workspace=ws, run=q.run.id, provider_state=str(tmp_path/'provider.private.json'),
                  state_dir=str(tmp_path), interrupt=True)
    first = run_child(config, tmp_path/'worker-first.log')
    assert first['state'] == 'interrupted_after_committed_draft'
    prefix_rows = retained_rows(s, q.run.id)
    assert len(prefix_rows['native']) == 2
    config['interrupt'] = False
    resumed = run_child(config, tmp_path/'worker-resumed.log')
    assert resumed['state'] == 'ready' and resumed['pid'] != first['pid']
    saved = retained_rows(s, q.run.id)
    for table, rows in prefix_rows.items():
        assert all(row in saved[table] for row in rows), table
    assert len(saved['native']) == 5
    observed = [r['data'] for r in saved['native_events'] if r['kind']=='observation']
    assert len(observed) == 5 and all(o['status']=='observed' for o in observed)
    assert len(saved['steps']) == 7
    for step in saved['steps']:
        request_data = json.loads(step['request_bytes'])
        if step['phase'] != 'final':
            assert request_data['tools'][0]['parameters'] == current_gateway.SCHEMA.model.model_json_schema()
        kinds = [e['kind'] for e in saved['events'] if e['phase']==step['phase']]
        for kind in ('count_send','count_result','dispatch','identity','result'):
            assert kinds.count(kind) == 1, (step['phase'], kind, kinds)
    with s.db.transaction() as c:
        material_before = {table:c.execute(f'SELECT * FROM {table} WHERE workspace_id=%s ORDER BY id', (ws,)).fetchall()
                           for table in ('workspace_files','source_snapshots','artifacts','revisions','artifact_exports','generated_blobs','proposals')}
    assert len(material_before['artifact_exports']) == len(material_before['generated_blobs']) == 2
    assert material_before['proposals'] == []
    provider_before = (tmp_path/'provider.private.json').read_bytes()
    calls = json.loads(provider_before)['calls']
    assert sum(method == 'POST' and path.endswith('/responses') for method, path in calls) == 7
    assert sum(method == 'POST' and path.endswith('/input_tokens') for method, path in calls) == 7
    replay = run_child(config, tmp_path/'worker-completed-replay.log')
    assert replay['state'] == 'ready'
    assert (tmp_path/'provider.private.json').read_bytes() == provider_before
    assert retained_rows(s, q.run.id) == saved

    # New HTTP app/Service instance after both worker processes exit. No direct
    # service download shortcut: all assertions exercise ordinary client routes.
    downloads = []
    with TestClient(create_app(settings)) as client:
        response = client.get(prefix+f'/conversations/{cv.id}', headers=headers)
        assert response.status_code == 200 and response.json()['turns'][0]['adaptive']['outcome'] == 'answered'
        for name, mime, value, _ in FILES:
            draft = next(e['data']['capability_result']['result'] for e in saved['events']
                         if e['kind']=='tool_result' and e['data']['decision']['kind']=='files_create_draft'
                         and e['data']['decision']['source']['filename']==name)
            export = next(o['output']['result'] for o in observed if o['output']['result'].get('filename')==name
                          and 'export_id' in o['output']['result'])
            if name == FILES[0][0]:
                generated_markdown, markdown_export = draft, export
            for path in (f'/artifacts/{draft["workspace_file_id"]}/download', f'/exports/{export["export_id"]}/download'):
                response = client.get(prefix+path, headers=headers)
                assert response.status_code == 200
                assert response.headers['content-disposition'] == f'attachment; filename="{name}"'
                assert response.headers['content-type'].split(';')[0] == mime
                assert response.content == value.encode()
                assert response.headers['x-content-sha256'] == sha256(response.content).hexdigest()
                assert response.headers['x-content-type-options'] == 'nosniff'
                downloads.append(path)
                assert client.get(prefix+path, headers={k:v for k,v in headers.items() if k!='Authorization'}).status_code == 401
        href = human['current']
        response = client.get(prefix+f'/files/{human["workspace_file_id"]}/versions/{href["version_id"]}',
                              headers=headers, params={'sha256':href['sha256']})
        assert response.status_code == 200 and response.json()['text'] == human_text
        original = client.get(prefix+f'/files/{human["workspace_file_id"]}/versions/{human_original["version_id"]}',
                              headers=headers, params={'sha256':human_original['sha256']})
        assert original.status_code == 200 and original.json()['text'] == '# Original human note\n'
        files = client.get(prefix+f'/work-areas/{cv.id}/files', headers=headers)
        assert files.status_code == 200 and len(files.json()['items']) == 3
        assert next(f for f in files.json()['items'] if f['workspace_file_id']==human['workspace_file_id'])['current'] == href
    # A valid local client identity with no workspace membership is denied;
    # this is authorization, distinct from missing bearer authentication above.
    with TestClient(create_app(Settings(s.db.dsn, True, token, 'other-'+new_id()))) as other:
        for path in downloads:
            response = other.get(prefix+path, headers=headers)
            assert response.status_code == 404
            assert response.json()['code'] == 'not_found_or_not_authorized'
    assert retained_rows(s, q.run.id) == saved
    with s.db.transaction() as c:
        for table, rows in material_before.items():
            assert c.execute(f'SELECT * FROM {table} WHERE workspace_id=%s ORDER BY id', (ws,)).fetchall() == rows, table
        assert c.execute('SELECT data FROM tool_grants WHERE id=%s', (grant.id,)).fetchone()['data'] == grant.model_dump(mode='json')
    # Human edits the GENERATED Markdown after completion. Use the fresh
    # conversation work version and exact generated base, never the initial CV.
    edited_text = FILES[0][2] + '\nHuman amendment: keep this correction on return.\n'
    edited_sha = sha256(edited_text.encode()).hexdigest()
    generated_id = generated_markdown['workspace_file_id']
    generated_base = generated_markdown['current']
    with TestClient(create_app(settings)) as client:
        detail = client.get(prefix+f'/conversations/{cv.id}', headers=headers)
        assert detail.status_code == 200
        edit = cmd(EditWorkspaceFile, expected_work_version=detail.json()['conversation']['work_version'],
                   base_version_id=generated_base['version_id'], base_sha256=generated_base['sha256'],
                   content=edited_text, sha256=edited_sha)
        response = client.post(prefix+f'/files/{generated_id}/versions', headers=headers,
                               json=edit.model_dump(mode='json'))
        assert response.status_code == 201, response.status_code
        edited = response.json()['current']
        assert edited['version_id'] != generated_base['version_id'] and edited['sha256'] == edited_sha
    with s.db.transaction() as c:
        material_after_edit = {table:c.execute(f'SELECT * FROM {table} WHERE workspace_id=%s ORDER BY id', (ws,)).fetchall()
                               for table in material_before}
    for table, rows in material_before.items():
        if table == 'revisions':
            assert len(material_after_edit[table]) == len(rows) + 1
            assert all(row in material_after_edit[table] for row in rows)
            revision = next(row for row in material_after_edit[table] if row not in rows)
            assert revision['id'] == edited['version_id'] and revision['artifact_id'] == generated_id
            assert revision['data']['author_kind'] == 'human'
        elif table == 'artifacts':
            assert len(material_after_edit[table]) == len(rows)
            old_artifact = next(row for row in rows if row['id'] == generated_id)
            new_artifact = next(row for row in material_after_edit[table] if row['id'] == generated_id)
            assert new_artifact == dict(old_artifact, current_revision_id=edited['version_id'])
            assert [row for row in material_after_edit[table] if row['id'] != generated_id] == [
                row for row in rows if row['id'] != generated_id]
        else:
            assert material_after_edit[table] == rows, table
    assert retained_rows(s, q.run.id) == saved
    edited_replay = run_child(config, tmp_path/'worker-after-human-edit-replay.log')
    assert edited_replay['state'] == 'ready'
    assert edited_replay['pid'] != replay['pid']
    assert (tmp_path/'provider.private.json').read_bytes() == provider_before
    assert retained_rows(s, q.run.id) == saved
    # Return through another fresh client/Service. Current file is the human
    # revision; the immutable export and explicitly requested old revision remain
    # the exact model-generated bytes. Reading does not regenerate an export.
    with TestClient(create_app(settings)) as returned:
        path = prefix+f'/artifacts/{generated_id}/download'
        for params, expected in (({}, edited_text.encode()),
                                 ({'revision_id':generated_base['version_id']}, FILES[0][2].encode())):
            response = returned.get(path, headers=headers, params=params)
            assert response.status_code == 200
            assert response.content == expected
            assert response.headers['x-content-sha256'] == sha256(expected).hexdigest()
            assert response.headers['content-disposition'] == f'attachment; filename="{FILES[0][0]}"'
            assert response.headers['content-type'].split(';')[0] == FILES[0][1]
        response = returned.get(prefix+f'/exports/{markdown_export["export_id"]}/download', headers=headers)
        assert response.status_code == 200 and response.content == FILES[0][2].encode()
        assert response.headers['x-content-sha256'] == markdown_export['blob']['sha256']
        assert response.headers['content-disposition'] == f'attachment; filename="{FILES[0][0]}"'
        assert response.headers['content-type'].split(';')[0] == FILES[0][1]
    with s.db.transaction() as c:
        for table, rows in material_after_edit.items():
            assert c.execute(f'SELECT * FROM {table} WHERE workspace_id=%s ORDER BY id', (ws,)).fetchall() == rows, table
        assert c.execute('SELECT data FROM tool_grants WHERE id=%s', (grant.id,)).fetchone()['data'] == grant.model_dump(mode='json')
    assert retained_rows(s, q.run.id) == saved
    (tmp_path/'mechanism-proof.json').write_text(json.dumps(dict(
        scope='scripted-current-gateway-mechanism-not-model-usefulness', run_id=q.run.id,
        worker_processes=[first, resumed, replay, edited_replay], provider_creates=7, provider_counts=7, native_observations=5,
        request_sha256={row['phase']:sha256(row['request_bytes'].encode()).hexdigest() for row in saved['steps']},
        downloads=[dict(filename=name, mime_type=mime, sha256=sha256(value.encode()).hexdigest()) for name,mime,value,_ in FILES],
        human_version_id=href['version_id'], human_sha256=href['sha256'],
        generated_human_edit=dict(file_id=generated_id, previous_version_id=generated_base['version_id'],
                                  version_id=edited['version_id'], sha256=edited_sha, export_id=markdown_export['export_id'],
                                  historical_export_sha256=markdown_export['blob']['sha256'], completed_replay_unchanged=True),
        completed_replay_unchanged=True, unauthorized_downloads_denied=True), indent=2)+'\n')


def test_scripted_choices_validate_current_schema_and_scoped_export():
    for decision in choices():
        if not callable(decision):
            current_gateway.SCHEMA.model.model_validate(dict(goal='Controlled workflow', success_criteria=[], decision=decision))
    ref = dict(kind='workspace_file', id='file-1', version='version-1', sha256='a'*64)
    ctx = dict(run_output_refs=[ref], adaptive=dict(observations=[dict(
        decision=dict(kind='files_create_draft', source=dict(filename=FILES[0][0])),
        capability_result=dict(result=dict(current=dict(workspace_file_id=ref['id'], version_id=ref['version'], sha256=ref['sha256']))))]))
    decision = export_choice(ctx)
    current_gateway.SCHEMA.model.model_validate(dict(goal='Controlled workflow', success_criteria=[], decision=decision))
    assert decision['input_ref'] == ref and decision['format'] == 'markdown'


def test_synthetic_provider_restart_retains_exact_response_identity(tmp_path):
    path = tmp_path/'synthetic.json'
    first = SavedProvider(path)
    request = httpx.Request('POST', 'https://api.openai.com/v1/responses', json=dict(
        metadata=dict(step_id='selection'), input=[dict(content='{}')]))
    response = first.handle(request)
    second = SavedProvider(path)
    fetched = second.handle(httpx.Request('GET', 'https://api.openai.com/v1/responses/'+response.json()['id']))
    assert fetched.json() == response.json() and len(second.responses) == 1
    assert len(second.calls) == 2 and second.calls[-1][0] == 'GET'
    assert path.stat().st_mode & 0o777 == 0o600


def test_worker_subprocess_refuses_missing_fixture_before_io(tmp_path):
    process = subprocess.run([str(ROOT/'backend/.venv/bin/python'), str(Path(__file__).resolve()), '--worker'],
        input=json.dumps(dict(fixture={})), text=True, capture_output=True, cwd=ROOT, timeout=30,
        env={'PATH':'/usr/bin:/bin', 'PYTHONPATH':str(ROOT/'backend')+':'+str(ROOT/'backend/tests'), 'LANG':'C.UTF-8'})
    assert process.returncode == 1 and not process.stderr
    outcome = json.loads(process.stdout)
    assert outcome['error_type'] == 'RuntimeError'
    assert outcome['frames'][-1]['function'] == 'fixture_database_urls'
    assert not list(tmp_path.iterdir())


if __name__ == '__main__':
    assert sys.argv[1:] == ['--worker']
    try:
        print(json.dumps(child(json.load(sys.stdin))))
    except Exception as exc:
        # Traceback frames remain actionable; never emit DSNs/credentials/payloads.
        import traceback
        print(json.dumps(dict(error_type=type(exc).__name__, frames=[dict(file=Path(f.filename).name, line=f.lineno, function=f.name)
                         for f in traceback.extract_tb(exc.__traceback__)])))
        raise SystemExit(1)
