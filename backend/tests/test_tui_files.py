"""Offscreen and in-memory HTTP tests: no provider, socket or database."""
import asyncio
import copy
from hashlib import sha256
from urllib.parse import urlsplit, parse_qs
import pytest
from textual.app import App
from textual.widgets import TextArea, Input, Static, Select
from workagent.operator_journal import OperatorError
from workagent.tui.file_drafts import FileDraftSession, FileDraftStore
from workagent.tui.files import FilesController, editor_content
from workagent.tui.files_screen import WorkingFilesScreen
from workagent.workspace_file_models import WorkspaceFile


def hash_(s):
    return sha256(s.encode()).hexdigest()


class FilesHTTP:
    base = 'http://127.0.0.1:9000'
    def __init__(self):
        self.contents = {'v1': '\ufeffhello\r\nworld\n'}
        self.head = 'v1'
        self.posts = []
        self.receipts = {}
        self.lose_ack = False
        self.bad_hash = False
        self.version = 3
        self.principal = 'human-a'

    def identity(self, ws):
        return self.principal

    def file(self, version=None):
        version = version or self.head
        return dict(workspace_file_id='file-a', workspace_id='workspace-a', conversation_id='conversation-a',
                    filename='notes.md', mime_type='text/markdown', storage='artifact_revision', editable=True,
                    current=dict(workspace_file_id='file-a', version_id=version, sha256=hash_(self.contents[version])),
                    byte_length=len(self.contents[version].encode()))

    def request(self, path, body=None):
        url = urlsplit(path)
        if body is not None:
            self.posts.append((path, copy.deepcopy(body)))
            cid = body['command_id']
            if cid not in self.receipts:
                content = body.get('content', body.get('source', {}).get('content'))
                if content is not None:
                    self.contents['saved'] = content
                    self.head = 'saved'
                    self.receipts[cid] = self.file('saved')
                else:
                    self.receipts[cid] = manifest(body['version_id'], body['sha256'], body['format'])
            if self.lose_ack:
                self.lose_ack = False
                raise OperatorError('lost ack')
            return copy.deepcopy(self.receipts[cid])
        if url.path.endswith('/conversations/conversation-a'):
            return {'conversation': {'work_version': self.version}}
        if url.path.endswith('/work-areas/conversation-a/files'):
            return {'items': [self.file()], 'next_after': None}
        if '/versions/' in url.path:
            version = url.path.rsplit('/', 1)[1]
            raw = self.contents[version].encode()
            query = parse_qs(url.query)
            assert query['sha256'] == [hash_(self.contents[version])]
            offset = int(query['offset'][0])
            end = min(len(raw), offset + int(query['limit'][0]))
            while True:
                try:
                    text = raw[offset:end].decode()
                    break
                except UnicodeDecodeError:
                    end -= 1
            return dict(ref=self.file(version)['current'], text=text, offset=offset, next_offset=end,
                byte_length=len(raw), chunk_sha256='0'*64 if self.bad_hash else sha256(raw[offset:end]).hexdigest(),
                omitted_ranges=[dict(start=a, end=b, sha256=sha256(raw[a:b]).hexdigest()) for a,b in ((0,offset),(end,len(raw))) if a<b],
                has_utf8_bom=raw.startswith(b'\xef\xbb\xbf'), newline='mixed')
        raise AssertionError(path)


def manifest(version='v1', input_hash=None, format='txt'):
    return dict(export_id='export-a', workspace_id='workspace-a', conversation_id='conversation-a', artifact_id='file-a',
        revision_id=version, input_sha256=input_hash or hash_('\ufeffhello\r\nworld\n'), workspace_file_id='file-a', source_snapshot_id=None,
        format=format, filename='export.' + ('md' if format == 'markdown' else format), blob=dict(kind='generated_blob', blob_id='blob-a', sha256=hash_('export bytes'), byte_length=12,
        mime_type='text/plain'), created_at='2026-10-28T00:00:00Z', annotations='not_present', omissions=[])


def controller(tmp_path, client=None):
    client = client or FilesHTTP()
    store = FileDraftStore(client.base, 'workspace-a', 'human-a', 'conversation-a', path=tmp_path/'drafts')
    return FilesController(client, FileDraftSession(store))


def test_exact_lost_ack_reopen_replay_and_old_version_readback(tmp_path):
    ctrl = controller(tmp_path)
    ctrl.refresh()
    ctrl.open_file(ctrl.page.items[0])
    ctrl.session.edit(content='human saved', base={**ctrl.session.draft['base'], 'normalize': True})
    envelope = copy.deepcopy(ctrl.prepare('save'))
    ctrl.client.lose_ack = True
    with pytest.raises(OperatorError, match='lost ack'):
        ctrl.send()
    restored = controller(tmp_path, ctrl.client)
    assert restored.session.draft['pending'] == {**envelope, 'state': 'outcome_unknown'}
    with pytest.raises(OperatorError, match='pending'):
        restored.prepare('save')
    with pytest.raises(OperatorError, match='No acknowledged receipt'):
        restored.readback()
    restored.send()
    assert ctrl.client.posts[0] == ctrl.client.posts[1]
    assert restored.session.draft['base']['file']['current']['version_id'] == 'saved'
    old = next(k for k in restored.session.state['drafts'] if k.endswith(':v1'))
    restored.session.select(old)
    assert restored.session.draft['content'] == 'human saved'
    assert restored.session.draft['proposal']['receipt']['current']['version_id'] == 'saved'
    ctrl.client.contents['later'] = 'new unrelated head'
    ctrl.client.head = 'later'
    restored.session.edit(pending=restored.session.draft['proposal'])
    restored.readback()
    assert restored.session.draft['base']['file']['current']['version_id'] == 'saved'


def test_refresh_never_rebases_and_mixed_requires_consent(tmp_path):
    ctrl = controller(tmp_path)
    ctrl.refresh(); ctrl.open_file(ctrl.page.items[0])
    original = ctrl.session.draft['content']
    assert editor_content(original, original.replace('\r\n','\n'), 'mixed') == original
    assert editor_content('a\r\nb', 'a\nb!', 'crlf') == 'a\r\nb!'
    ctrl.session.edit(content='unsent edit')
    ctrl.client.contents['v2'] = 'other edit'; ctrl.client.head = 'v2'
    ctrl.refresh()
    assert ctrl.session.draft['content'] == 'unsent edit'
    assert ctrl.session.draft['base']['file']['current']['version_id'] == 'v1'
    with pytest.raises(OperatorError, match='Mixed line endings'):
        ctrl.prepare('save')
    assert not ctrl.client.posts
    ctrl.session.edit(base={**ctrl.session.draft['base'], 'normalize': True})
    ctrl.prepare('save')
    assert ctrl.session.draft['pending']['body']['base_version_id'] == 'v1'


def test_stale_hash_scope_and_utf8_bounds_preserve_draft(tmp_path):
    ctrl = controller(tmp_path)
    ctrl.session.edit(content='unsent new file')
    ctrl.refresh()
    ctrl.client.bad_hash = True
    with pytest.raises(OperatorError, match='hash mismatch'):
        ctrl.open_file(ctrl.page.items[0])
    assert ctrl.session.draft['content'] == 'unsent new file'
    ctrl.client.bad_hash = False
    ctrl.client.contents['v1'] = '雪' * 20000
    ctrl.open_file(WorkspaceFile.model_validate(ctrl.client.file()))
    assert ctrl.session.draft['content'] == '雪' * 20000
    ctrl.client.principal = 'different-human'
    with pytest.raises(OperatorError, match='scope changed'):
        ctrl.refresh()
    with pytest.raises(OperatorError):
        ctrl.session.edit(content='x' * 200001)
    assert ctrl.session.draft['content'] == '雪' * 20000


@pytest.mark.parametrize('format', ['txt','markdown','csv','json'])
def test_export_exact_saved_version(tmp_path, format):
    ctrl = controller(tmp_path)
    ctrl.refresh(); ctrl.open_file(ctrl.page.items[0])
    ctrl.session.edit(content='unsent text')
    record = ctrl.prepare('export', format)
    assert record['body']['version_id'] == 'v1'
    assert record['body']['sha256'] != hash_('unsent text')
    ctrl.send()
    assert ctrl.session.draft['content'] == 'unsent text'
    assert ctrl.session.draft['export']['format'] == format


@pytest.mark.parametrize('size', [(80,24), (120,40)])
def test_offscreen_editor_roundtrip_and_responsive_http(tmp_path, size):
    class Host(App):
        def compose(self):
            yield TextArea('conversation unsent', id='composer')
    async def scenario():
        client = FilesHTTP(); app = Host()
        store = FileDraftStore(client.base, 'workspace-a', 'human-a', 'conversation-a', path=tmp_path/'drafts')
        async with app.run_test(size=size) as pilot:
            screen = WorkingFilesScreen(client, 'workspace-a', 'human-a', 'conversation-a', store=store)
            await app.push_screen(screen)
            await app.workers.wait_for_complete(); await pilot.pause()
            screen.query_one('#wf-files', Select).value = '0'
            screen.start(screen.open_selected)
            await app.workers.wait_for_complete(); await pilot.pause()
            assert screen.file_session.draft['content'] == '\ufeffhello\r\nworld\n'
            editor = screen.query_one('#wf-content', TextArea)
            editor.focus(); editor.move_cursor((1,5))
            await pilot.press('!')
            assert '!' in screen.file_session.draft['content']
            saved = screen.file_session.draft['content']
            await pilot.press('ctrl+r')
            await app.workers.wait_for_complete(); await pilot.pause()
            assert screen.file_session.draft['content'] == saved
            assert editor.region.width <= size[0]
            await pilot.press('escape'); await pilot.pause()
            assert app.query_one('#composer', TextArea).text == 'conversation unsent'
            reopened = FileDraftSession(FileDraftStore(client.base, 'workspace-a', 'human-a', 'conversation-a', path=tmp_path/'drafts'))
            assert reopened.draft['content'] == saved
    asyncio.run(scenario())


def test_download_bytes_hash_and_no_follow(tmp_path, monkeypatch):
    import io
    from workagent.operator_client import OperatorClient
    monkeypatch.setenv('LOCAL_BEARER_TOKEN', 'x'*40)
    client = OperatorClient()
    class Response(io.BytesIO):
        headers = {'Content-Type': 'text/plain; charset=utf-8'}
    class Opener:
        raw = b'export bytes'
        def open(self, request, timeout):
            assert request.full_url.endswith('/v1/workspaces/workspace-a/exports/export-a/download')
            return Response(self.raw)
    client.opener = Opener()
    destination = tmp_path/'download.txt'
    client.download_export('workspace-a', manifest(), str(destination))
    assert destination.read_bytes() == b'export bytes'
    with pytest.raises(OperatorError):
        client.download_export('workspace-a', manifest(), str(destination))
    client.opener.raw = b'bad checksum'
    with pytest.raises(OperatorError, match='hash mismatch'):
        client.download_export('workspace-a', manifest(), str(tmp_path/'bad.txt'))
    assert not (tmp_path/'bad.txt').exists()
    client.opener.raw = b'export bytes'
    (tmp_path/'link').symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(OperatorError):
        client.download_export('workspace-a', manifest(), str(tmp_path/'link'/'escape.txt'))
    assert not (tmp_path/'escape.txt').exists()


def test_create_envelope_is_durable_before_post_and_validated(tmp_path):
    ctrl = controller(tmp_path)
    ctrl.refresh()
    ctrl.session.edit(filename='new.json', content='{"human": "雪"}')
    record = ctrl.prepare('save')
    restored = controller(tmp_path, ctrl.client)
    assert restored.session.draft['pending'] == record
    assert record['path'] == '/workspace-a/work-areas/conversation-a/files'
    assert record['body']['source']['kind'] == 'text'
    assert record['body']['source']['mime_type'] == 'application/json'
    assert record['body']['expected_work_version'] == 3
    assert not ctrl.client.posts
    ctrl.send()
    assert ctrl.session.draft['content'] == '{"human": "雪"}'


def test_actual_shell_files_tab_preserves_composer_and_keys(tmp_path, monkeypatch):
    from test_tui_composer import FakeClient
    from workagent.tui.app import WorkagentApp
    from textual.widgets import TabbedContent
    monkeypatch.setenv('LOCAL_BEARER_TOKEN', 'x'*40)
    monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL', str(tmp_path/'journal'))
    monkeypatch.setenv('WORKAGENT_TUI_DRAFTS', str(tmp_path/'drafts'))
    async def scenario():
        client = FakeClient()
        files = FilesHTTP()
        files.principal = 'human'
        original = client.request
        def request(path, body=None):
            if '/files' in path or '/versions/' in path:
                result = files.request(path.replace('/workspace/', '/workspace-a/').replace('/c1/', '/conversation-a/'), body)
                if 'items' in result:
                    for item in result['items']:
                        item.update(workspace_id='workspace', conversation_id='c1')
                return result
            return original(path, body)
        client.request = request
        app = WorkagentApp(client, 'workspace')
        async with app.run_test(size=(80,24)) as pilot:
            await app.workers.wait_for_complete(); await pilot.pause()
            app.query_one('#work', Select).value = 'c1'
            await pilot.pause(); await app.workers.wait_for_complete(); await pilot.pause()
            composer = app.query_one('#composer', TextArea)
            composer.load_text('unsent conversation')
            await pilot.pause()
            app.query_one('#panels', TabbedContent).active = 'files-panel'
            await pilot.pause()
            await pilot.click('#working-files')
            await pilot.pause(); await app.workers.wait_for_complete(); await pilot.pause()
            screen = app.screen
            assert isinstance(screen, WorkingFilesScreen)
            editor = screen.query_one('#wf-content', TextArea)
            editor.focus(); await pilot.press('h','i')
            assert screen.file_session.draft['content'] == 'hi'
            await pilot.press('ctrl+enter')
            await app.workers.wait_for_complete(); await pilot.pause()
            # File command may fail fixture scope validation; composer must never send.
            assert not client.calls
            await pilot.press('escape'); await pilot.pause()
            assert composer.text == 'unsent conversation'
    asyncio.run(scenario())


def test_blocked_http_does_not_block_ui(tmp_path):
    import threading
    class Host(App):
        pass
    async def scenario():
        client = FilesHTTP(); app = Host()
        started, release = threading.Event(), threading.Event()
        original = client.request
        def request(path, body=None):
            started.set()
            assert release.wait(5)
            return original(path, body)
        client.request = request
        store = FileDraftStore(client.base, 'workspace-a', 'human-a', 'conversation-a', path=tmp_path/'drafts')
        async with app.run_test(size=(80,24)) as pilot:
            screen = WorkingFilesScreen(client, 'workspace-a', 'human-a', 'conversation-a', store=store)
            await app.push_screen(screen)
            for _ in range(50):
                if started.is_set(): break
                await asyncio.sleep(.01)
            try:
                assert started.is_set()
                await pilot.press('escape')
                assert 'Wait for file operation' in str(screen.query_one('#wf-notice', Static).render())
            finally:
                release.set()
            await app.workers.wait_for_complete()
    asyncio.run(scenario())
