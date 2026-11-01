"""Fresh-store current-schema dispatch, not adoption of historical installations.

Uses real restricted PostgreSQL, native export and confined office conversion.
No product-model/provider calls. Existing grants are not rewritten.
"""
from hashlib import sha256
import pytest
from test_domain import context, cmd, raises
from test_workspace_file_gateway_pg import install, call
from workagent.models import CreateConversation, new_id
from workagent.workspace_file_models import CreateWorkspaceFile, WorkingText
from workagent.capabilities.models import InputRef
from workagent.capabilities.broker import CapabilityBroker
from workagent.capabilities import registry
from workagent.db import Database


@pytest.mark.parametrize('name,format,filename', [
    ('artifacts.export', 'csv', 'field-notes.csv'),
    ('artifacts.export.office', 'png', 'field-notes.png'),
])
def test_fresh_exact_pin_named_export_dispatch_and_replay(context, name, format, filename):
    s, p, ws, _, admin = context
    cv = s.create_conversation(p, ws, cmd(CreateConversation, selected_source_refs=[]))
    text = 'team,hours\na,0.1\na,0.2\nb,1.5\n'
    file = s.create_workspace_file(p, ws, cv.id, cmd(CreateWorkspaceFile,
        expected_work_version=cv.work_version, source=WorkingText(filename='field-notes.csv',
        mime_type='text/csv', content=text, sha256=sha256(text.encode()).hexdigest())))
    ref = InputRef(kind='workspace_file', id=file.workspace_file_id,
                   version=file.current.version_id, sha256=file.current.sha256)
    cap, grant, q = install(context, cv, [ref], [name])
    descriptor = registry.adapters()[name].descriptor
    pin_before = grant.model_dump(mode='json')
    with Database(admin).transaction() as c:
        installed = c.execute('SELECT descriptor FROM capability_installations WHERE id=%s AND version=%s',
                              (name, descriptor.version)).fetchone()['descriptor']
        assert installed == descriptor.model_dump(mode='json')
        assert c.execute('SELECT data FROM tool_grants WHERE id=%s', (grant.id,)).fetchone()['data'] == pin_before
    args = dict(kind='artifacts_export' if name == 'artifacts.export' else 'artifacts_export_office',
                input_ref=ref.model_dump(mode='json'), format=format)
    if format == 'png':
        args['chart_spec'] = dict(category_column='team', value_column='hours', aggregation='sum',
                                  title='Hours by team', x_label='Team', y_label='Hours')
    request = call(cap, q, name, args, [ref])
    broker = CapabilityBroker(s, cap)
    observed = broker.call(request)
    assert observed.status == 'observed', observed.error
    assert observed.implementation_sha256 == descriptor.implementation_sha256
    assert observed.output['result']['filename'] == filename
    assert broker.call(request) == observed
    manifest, raw = s.download_export(p, ws, observed.output['result']['export_id'])
    assert manifest.filename == filename and manifest.tool_attempt_id == observed.attempt_id
    assert sha256(raw).hexdigest() == manifest.blob.sha256
    if format == 'csv':
        assert raw == text.encode()
    else:
        assert raw.startswith(b'\x89PNG\r\n\x1a\n') and manifest.chart.rows[0].value == '0.3'
    with Database(admin).transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM tool_attempts WHERE run_id=%s AND call_id=%s',
                         (q.run.id, request.call_id)).fetchone()['n'] == 1
        assert c.execute('SELECT data FROM tool_grants WHERE id=%s', (grant.id,)).fetchone()['data'] == pin_before
        c.execute('UPDATE tool_grants SET active=false WHERE id=%s', (grant.id,))
    # Revoke affects a fresh call; no replay/effect follows the authority change.
    from workagent.errors import DomainError
    with pytest.raises(DomainError):
        broker.call(request.model_copy(update={'call_id': new_id()}))
