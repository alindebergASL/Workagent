"""Native consumer tests; in-memory transport, canonical backend contracts.

Office cases skip until the backend lane's canonical interface is integrated.
No model/converter substitutes, provider calls or live service are used here.
"""
import asyncio
import copy
import io
import json
from hashlib import sha256
from typing import Any
from collections.abc import Callable

import pytest
from textual.app import App
from textual.widgets import Collapsible, Input, Select, Static, TextArea
from workagent.operator_client import OperatorClient
from workagent.operator_journal import OperatorError
from workagent.tui.file_drafts import FileDraftSession, FileDraftStore
from workagent.tui.files import OFFICE_MIMES
from workagent.tui.files_screen import WorkingFilesScreen
from test_tui_files import FilesHTTP, controller, hash_, manifest


CHART = dict(category_column='Team', value_column='Amount', aggregation='sum',
             title='Amounts [literal]', x_label='Team', y_label='Amount')


@pytest.fixture
def office_interface():
    pytest.importorskip('workagent.office_models', reason='Canonical office backend is not integrated')
    from workagent.workspace_file_models import ImportOfficeDraft
    return ImportOfficeDraft


class OfficeHTTP(FilesHTTP):
    def __init__(self):
        super().__init__()
        self.contents['v1'] = 'Team,Amount\nA,2\nA,3\n'
        self.export_mutation: Callable[[dict], None] | None = None
        self.downloads = []
        self.response_mime: str | None = None
        self.raw = b'fixture export bytes'  # Transport fixture, not converter proof.

    def request(self, path, body=None) -> dict[str, Any]:
        if body is not None and path.endswith('/exports'):
            self.posts.append((path, copy.deepcopy(body)))
            cid = body['command_id']
            if cid not in self.receipts:
                result = manifest(body['version_id'], body['sha256'], body['format'])
                result.update(filename='export.' + body['format'], exporter_version='office-exports-v1',
                              fidelity='Bounded representation; no layout fidelity.',
                              annotations='explicit_omissions', omissions=['Formulas are not evaluated.'])
                result['blob'].update(mime_type=OFFICE_MIMES[body['format']], byte_length=len(self.raw),
                                      sha256=sha256(self.raw).hexdigest())
                if body['format'] == 'png':
                    result['chart'] = dict(input_sha256=body['sha256'], spec=copy.deepcopy(body['chart_spec']),
                                           rows=[dict(category='A', value='5', count=2)])
                if self.export_mutation:
                    self.export_mutation(result)
                self.receipts[cid] = result
            if self.lose_ack:
                self.lose_ack = False
                raise OperatorError('lost ack')
            return copy.deepcopy(self.receipts[cid])
        return super().request(path, body)

    def download_export(self, workspace, value, destination):
        self.downloads.append(copy.deepcopy(value))
        # Exercise the real bounded, exclusive download implementation against
        # fixture HTTP response bytes, not an in-memory "download succeeded" stub.
        outer = self
        class Response(io.BytesIO):
            headers = {'Content-Type': self.response_mime or value['blob']['mime_type']}
        class Opener:
            def open(self, request, timeout):
                assert request.full_url.endswith('/exports/export-a/download')
                return Response(outer.raw)
        client = OperatorClient.__new__(OperatorClient)
        client.base, client.token, client.opener = self.base, 'test-only', Opener()
        return client.download_export(workspace, value, destination)


def opened(tmp_path, client=None) -> Any:
    ctrl = controller(tmp_path, client or OfficeHTTP())
    ctrl.refresh()
    ctrl.open_file(ctrl.page.items[0])
    return ctrl


@pytest.mark.parametrize('format', ['docx', 'xlsx', 'pdf', 'png'])
def test_office_export_pins_saved_input_and_downloads_actual_bytes(tmp_path, office_interface, format):
    ctrl = opened(tmp_path)
    ctrl.session.edit(content='unsaved human text')
    envelope = ctrl.prepare('export', format, CHART if format == 'png' else None)
    assert envelope['path'] == '/workspace-a/files/file-a/exports'
    assert envelope['body']['sha256'] == hash_(ctrl.client.contents['v1'])
    assert controller(tmp_path, ctrl.client).session.draft['pending'] == envelope
    ctrl.send()
    assert ctrl.session.draft['content'] == 'unsaved human text'
    assert ctrl.session.draft['export']['format'] == format
    output = tmp_path / ('actual.' + format)
    ctrl.download(str(output))
    assert output.read_bytes() == ctrl.client.raw
    with pytest.raises(OperatorError):
        ctrl.download(str(output))
    ctrl.client.raw = b'x' * len(ctrl.client.raw)
    with pytest.raises(OperatorError, match='hash mismatch'):
        ctrl.download(str(tmp_path / ('bad.' + format)))
    assert not (tmp_path / ('bad.' + format)).exists()


@pytest.mark.parametrize('mutation,match', [
    (lambda m: m.update(format='pdf'), 'binding mismatch'),
    (lambda m: m.update(input_sha256='0' * 64), 'binding mismatch'),
    (lambda m: m.update(revision_id='other'), 'binding mismatch'),
    (lambda m: m.update(workspace_file_id='other'), 'binding mismatch'),
    (lambda m: m['chart'].update(input_sha256='0' * 64), 'chart exact binding'),
    (lambda m: m['chart']['spec'].update(title='other'), 'chart exact binding'),
    (lambda m: m.update(chart=None), 'chart exact binding'),
    (lambda m: m['blob'].update(mime_type='text/plain'), 'format/MIME mismatch'),
])
def test_export_readback_rejects_mismatched_receipt(tmp_path, office_interface, mutation, match):
    ctrl = opened(tmp_path)
    ctrl.client.export_mutation = mutation
    ctrl.prepare('export', 'png', CHART)
    with pytest.raises(OperatorError, match=match):
        ctrl.send()
    assert ctrl.session.draft['pending']['state'] == 'readback_unknown'
    assert ctrl.session.draft['export'] is None
    assert len(ctrl.client.posts) == 1
    with pytest.raises(OperatorError, match='pending'):
        ctrl.prepare('export', 'png', CHART)


def test_chart_replay_retains_exact_spec_and_unknown_never_auto_resends(tmp_path, office_interface):
    ctrl = opened(tmp_path)
    original = copy.deepcopy(ctrl.prepare('export', 'png', CHART))
    ctrl.client.lose_ack = True
    with pytest.raises(OperatorError, match='lost ack'):
        ctrl.send()
    restored = controller(tmp_path, ctrl.client)
    restored.session.edit(chart_spec={**CHART, 'aggregation': 'count', 'value_column': None}, export_format='pdf')
    restored.refresh()
    assert len(ctrl.client.posts) == 1
    with pytest.raises(OperatorError, match='No acknowledged receipt'):
        restored.readback()
    restored.send()
    assert ctrl.client.posts[0] == ctrl.client.posts[1]
    assert restored.session.draft['export_request']['body'] == original['body']
    assert restored.session.draft['export']['chart']['spec'] == CHART
    restored.download(str(tmp_path / 'chart.png'))
    changed = copy.deepcopy(restored.session.draft['export'])
    changed['chart']['spec']['aggregation'] = 'mean'
    restored.session.edit(export=changed)
    with pytest.raises(OperatorError, match='chart exact binding'):
        restored.download(str(tmp_path / 'tampered.png'))
    assert not (tmp_path / 'tampered.png').exists()
    assert len(ctrl.client.downloads) == 1


@pytest.mark.parametrize('format,spec', [('png', None), ('pdf', CHART),
    ('png', {**CHART, 'aggregation': 'count'}), ('png', {**CHART, 'value_column': None}),
    ('png', {**CHART, 'title': ''})])
def test_canonical_chart_validation_happens_before_pending_or_post(tmp_path, office_interface, format, spec):
    ctrl = opened(tmp_path)
    with pytest.raises(ValueError):
        ctrl.prepare('export', format, spec)
    assert ctrl.session.draft['pending'] is None
    assert not ctrl.client.posts


class ImportHTTP(OfficeHTTP):
    def __init__(self):
        super().__init__()
        self.contents = {'v1': 'Extracted office text', 'copy-v1': json.dumps(dict(
            office_version='office-v1', kind='document', paragraphs=['Imported paragraph'],
            annotations=['Layout omitted; no OCR.']))}
        self.import_mutation: Callable[[dict], None] | None = None
        self.provenance = dict(source_snapshot_id='v1', original_sha256=hash_('original DOCX bytes'),
                               extraction_sha256=hash_(self.contents['v1']), parser_version='document-v1',
                               transformation_version='office-v1')

    def file(self, version=None):
        version = version or self.head
        item = super().file(version)
        if version == 'v1':
            item.update(filename='source.docx', mime_type=OFFICE_MIMES['docx'], editable=False, storage='source_snapshot')
        else:
            item.update(workspace_file_id='copy-a', filename='editable.json', mime_type='application/json',
                        office_provenance=copy.deepcopy(self.provenance))
            item['current']['workspace_file_id'] = 'copy-a'
        return item

    def request(self, path, body=None) -> dict[str, Any]:
        if body is not None and path.endswith('/office-drafts'):
            self.posts.append((path, copy.deepcopy(body)))
            assert body['source'] == self.file('v1')['current']
            cid = body['command_id']
            if cid not in self.receipts:
                item = self.file('copy-v1')
                if self.import_mutation:
                    self.import_mutation(item)
                self.receipts[cid] = item
            if self.lose_ack:
                self.lose_ack = False
                raise OperatorError('lost ack')
            return copy.deepcopy(self.receipts[cid])
        if path.endswith('/source-snapshots/v1'):
            return dict(snapshot_id='v1', workspace_file_id='file-a', workspace_id='workspace-a',
                        conversation_id='conversation-a', version_number=1, parent_snapshot_id=None,
                        locator=dict(kind='document', document_id='document-a', sha256=self.provenance['original_sha256']),
                        observed_at='2026-10-28T00:00:00Z', version_at=None,
                        original_sha256=self.provenance['original_sha256'], extraction_sha256=self.provenance['extraction_sha256'],
                        original_byte_length=100, extraction_byte_length=len(self.contents['v1']), parser_version='document-v1',
                        extraction_status='partial', coverage=None, omissions=['Layout omitted; no OCR.'])
        result = super().request(path, body)
        if '/versions/' in path:
            result['newline'] = 'none'
        if '/versions/v1?' in path:
            result['source_snapshot_id'] = 'v1'
        return result


def test_import_copy_replay_and_exact_source_provenance(tmp_path, office_interface):
    client = ImportHTTP()
    ctrl = opened(tmp_path, client)
    original = copy.deepcopy(ctrl.session.draft)
    request = ctrl.prepare('import')
    assert request['path'] == '/workspace-a/work-areas/conversation-a/office-drafts'
    assert request['body']['source'] == original['base']['file']['current']
    assert request['body']['expected_work_version'] == 3
    client.lose_ack = True
    with pytest.raises(OperatorError, match='lost ack'):
        ctrl.send()
    restored = controller(tmp_path, client)
    restored.refresh()
    assert len(client.posts) == 1
    with pytest.raises(OperatorError, match='No acknowledged receipt'):
        restored.readback()
    assert 'Original unchanged' in restored.send()
    assert client.posts[0] == client.posts[1]
    assert restored.session.draft['base']['file']['workspace_file_id'] == 'copy-a'
    assert restored.session.draft['base']['file']['office_provenance'] == client.provenance
    assert restored.session.state['drafts']['file-a:v1']['content'] == original['content']
    assert client.contents['v1'] == original['content']
    restored.session.edit(content=restored.session.draft['content'].replace('Imported paragraph', 'Human edit'))
    restored.refresh()
    edit = restored.prepare('save')
    assert edit['path'] == '/workspace-a/files/copy-a/versions'
    assert edit['body']['base_version_id'] == 'copy-v1'
    assert edit['body']['base_sha256'] == hash_(client.contents['copy-v1'])


@pytest.mark.parametrize('mutation', [
    lambda i: i['office_provenance'].update(original_sha256='0' * 64),
    lambda i: i['office_provenance'].update(extraction_sha256='0' * 64),
    lambda i: i['office_provenance'].update(source_snapshot_id='other'),
    lambda i: i.update(office_provenance=None),
    lambda i: i.update(editable=False),
])
def test_import_rejects_wrong_provenance_without_losing_source(tmp_path, office_interface, mutation):
    client = ImportHTTP()
    ctrl = opened(tmp_path, client)
    client.import_mutation = mutation
    ctrl.prepare('import')
    with pytest.raises(OperatorError, match='provenance mismatch'):
        ctrl.send()
    assert ctrl.session.state['selected'] == 'file-a:v1'
    assert ctrl.session.draft['content'] == client.contents['v1']
    assert ctrl.session.draft['pending']['state'] == 'readback_unknown'


def test_import_readback_interruption_keeps_acknowledged_envelope(tmp_path, office_interface):
    client = ImportHTTP()
    ctrl = opened(tmp_path, client)
    ctrl.prepare('import')
    original_request = client.request
    copy_reads = 0
    def interrupted(path, body=None):
        nonlocal copy_reads
        if '/versions/copy-v1?' in path:
            copy_reads += 1
            if copy_reads == 2:
                raise OperatorError('copy read temporarily unavailable')
        return original_request(path, body)
    client.request = interrupted
    with pytest.raises(OperatorError, match='temporarily unavailable'):
        ctrl.send()
    restored = controller(tmp_path, client)
    assert restored.session.state['selected'] == 'file-a:v1'
    assert restored.session.draft['pending']['state'] == 'readback_unknown'
    assert restored.session.draft['pending']['receipt']['workspace_file_id'] == 'copy-a'
    assert 'Original unchanged' in restored.readback()
    assert len(client.posts) == 1


def test_old_drafts_migrate_without_changing_content_base_or_envelope(tmp_path):
    ctrl = opened(tmp_path, FilesHTTP())
    ctrl.session.edit(content='private unsaved\r\n')
    ctrl.prepare('export')
    old = copy.deepcopy(ctrl.session.state)
    for draft in old['drafts'].values():
        for key in ('chart_spec', 'export_format', 'export_request'):
            draft.pop(key)
    migrated = ctrl.session.store.validate(copy.deepcopy(old))
    for key, draft in old['drafts'].items():
        assert all(migrated['drafts'][key][field] == value for field, value in draft.items())
        assert migrated['drafts'][key]['export_format'] == 'txt'


@pytest.mark.parametrize('size', [(80, 24), (120, 40)])
def test_chart_form_persists_and_count_clears_value_column(tmp_path, size):
    class Host(App):
        pass
    async def scenario():
        client = FilesHTTP()
        app = Host()
        store = FileDraftStore(client.base, 'workspace-a', 'human-a', 'conversation-a', path=tmp_path / 'drafts')
        async with app.run_test(size=size) as pilot:
            screen = WorkingFilesScreen(client, 'workspace-a', 'human-a', 'conversation-a', store=store)
            await app.push_screen(screen)
            await app.workers.wait_for_complete(); await pilot.pause()
            screen.query_one('#wf-format', Select).value = 'png'
            await pilot.pause()
            assert not screen.query_one('#wf-chart', Collapsible).collapsed
            for suffix, value in [('category', 'Team'), ('value', 'Amount'), ('title', 'Totals'), ('x', 'Team'), ('y', 'Count')]:
                screen.query_one('#wf-chart-' + suffix, Input).value = value
            await pilot.pause()
            screen.query_one('#wf-chart-aggregation', Select).value = 'count'
            await pilot.pause()
            assert screen.file_session.draft['chart_spec']['value_column'] is None
            assert screen.query_one('#wf-chart-value', Input).disabled
            assert screen.file_session.draft['chart_spec']['aggregation'] == 'count'
            assert 'not computed' in str(screen.query_one('#wf-office-help', Static).render())
            assert 'never unsaved' in str(screen.query_one('#wf-export-help', Static).render())
            await pilot.press('escape')
        saved = FileDraftSession(FileDraftStore(client.base, 'workspace-a', 'human-a', 'conversation-a', path=tmp_path / 'drafts'))
        assert saved.draft['export_format'] == 'png'
        assert saved.draft['chart_spec'] == dict(category_column='Team', value_column=None,
            aggregation='count', title='Totals', x_label='Team', y_label='Count')
    asyncio.run(scenario())


def test_offscreen_export_manifest_details_and_unsaved_editor(tmp_path, office_interface):
    class Host(App):
        pass
    async def scenario():
        client, app = OfficeHTTP(), Host()
        store = FileDraftStore(client.base, 'workspace-a', 'human-a', 'conversation-a', path=tmp_path / 'drafts')
        async with app.run_test(size=(80, 24)) as pilot:
            screen = WorkingFilesScreen(client, 'workspace-a', 'human-a', 'conversation-a', store=store)
            await app.push_screen(screen)
            await app.workers.wait_for_complete(); await pilot.pause()
            screen.query_one('#wf-files', Select).value = '0'
            screen.start(screen.open_selected)
            await app.workers.wait_for_complete(); await pilot.pause()
            screen.file_session.edit(content='unsaved', export_format='png', chart_spec=CHART)
            screen.show_draft(); await pilot.pause()
            screen.start(lambda: screen.mutate(export=True))
            await app.workers.wait_for_complete(); await pilot.pause()
            assert screen.query_one('#wf-content', TextArea).text == 'unsaved'
            shown = json.loads(screen.query_one('#wf-manifest', TextArea).text)
            assert shown['chart']['rows'] == [dict(category='A', value='5', count=2)]
            assert shown['chart']['input_sha256'] == hash_(client.contents['v1'])
            assert shown['annotations'] == 'explicit_omissions'
            assert shown['omissions'] == ['Formulas are not evaluated.']
            assert 'Bounded representation' in str(screen.query_one('#wf-binding', Static).render())
            assert len(client.posts) == 1
            await pilot.press('escape')
    asyncio.run(scenario())


@pytest.mark.parametrize('aggregation,value_column', [('sum', 'Amount'), ('mean', 'Amount'), ('count', None)])
def test_each_aggregation_uses_canonical_nullable_column(tmp_path, office_interface, aggregation, value_column):
    ctrl = opened(tmp_path)
    spec = {**CHART, 'aggregation': aggregation, 'value_column': value_column}
    ctrl.prepare('export', 'png', spec)
    ctrl.send()
    assert ctrl.session.draft['export']['chart']['spec'] == spec
    ctrl.download(str(tmp_path / 'chart.png'))


def test_download_rejects_actual_mime_and_length_mismatch(tmp_path, office_interface):
    ctrl = opened(tmp_path)
    ctrl.prepare('export', 'docx')
    ctrl.send()
    ctrl.client.response_mime = 'text/plain'
    with pytest.raises(OperatorError, match='metadata mismatch'):
        ctrl.download(str(tmp_path / 'wrong-mime.docx'))
    assert not (tmp_path / 'wrong-mime.docx').exists()
    ctrl.client.response_mime = None
    ctrl.client.raw += b'oversize'
    with pytest.raises(OperatorError, match='metadata mismatch'):
        ctrl.download(str(tmp_path / 'wrong-length.docx'))
    assert not (tmp_path / 'wrong-length.docx').exists()


def test_original_office_export_verifies_source_provenance(tmp_path, office_interface):
    client = ImportHTTP()
    ctrl = opened(tmp_path, client)
    def attach_provenance(result):
        result.update(source_snapshot_id='v1', artifact_id=None, provenance=client.provenance)
    client.export_mutation = attach_provenance
    ctrl.prepare('export', 'docx')
    ctrl.send()
    ctrl.download(str(tmp_path / 'source.docx'))
    result = copy.deepcopy(ctrl.session.draft['export'])
    result['provenance']['original_sha256'] = '0' * 64
    ctrl.session.edit(export=result)
    with pytest.raises(OperatorError, match='provenance mismatch'):
        ctrl.download(str(tmp_path / 'bad-source.docx'))
    assert not (tmp_path / 'bad-source.docx').exists()


def test_offscreen_import_creates_separate_editable_json(tmp_path, office_interface):
    class Host(App):
        pass
    async def scenario():
        client, app = ImportHTTP(), Host()
        store = FileDraftStore(client.base, 'workspace-a', 'human-a', 'conversation-a', path=tmp_path / 'drafts')
        async with app.run_test(size=(80, 24)) as pilot:
            screen = WorkingFilesScreen(client, 'workspace-a', 'human-a', 'conversation-a', store=store)
            await app.push_screen(screen)
            await app.workers.wait_for_complete(); await pilot.pause()
            screen.query_one('#wf-files', Select).value = '0'
            screen.start(screen.open_selected)
            await app.workers.wait_for_complete(); await pilot.pause()
            assert screen.query_one('#wf-content', TextArea).read_only
            screen.start(screen.import_office)
            await app.workers.wait_for_complete(); await pilot.pause()
            editor = screen.query_one('#wf-content', TextArea)
            assert not editor.read_only
            assert json.loads(editor.text)['office_version'] == 'office-v1'
            assert 'Original unchanged' in str(screen.query_one('#wf-notice', Static).render())
            assert client.provenance['original_sha256'] in str(screen.query_one('#wf-binding', Static).render())
            assert screen.file_session.state['drafts']['file-a:v1']['content'] == client.contents['v1']
            await pilot.press('escape')
    asyncio.run(scenario())
