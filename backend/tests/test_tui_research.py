"""Deterministic HTTP fixtures/offscreen Textual checks, NOT native PTY proof.

Requires the canonical B3.2a backend contracts to be integrated. No paid calls.
"""
import asyncio
import copy
from dataclasses import FrozenInstanceError
from hashlib import sha256
from urllib.parse import parse_qs, urlsplit
import pytest
from textual.app import App
from textual.widgets import Button, Select, Static, TextArea

pytest.importorskip('workagent.research_models', reason='B3.2a canonical backend lane not integrated')
from workagent.operator_journal import OperatorError
from workagent.tui.research import ArtifactBinding, ResearchController, selected_binding, claims_text, snapshot_text
from workagent.tui.research_screen import ResearchScreen


def digest(text):
    return sha256(text.encode()).hexdigest()


def snapshot(sid='snapshot-a'):
    text = '[bold]literal[/bold] café\x1b[31m\u202eevidence'
    coverage = dict(body_complete=False, text_complete=True, omissions=['bounded body'])
    locator = dict(kind='public_source', blob_id='blob-a', sha256=digest('raw'), mime_type='text/html',
        title='[red]Source[/red]', url='https://example.org/start', final_url='https://example.org/final',
        status_code=200, redirects=[dict(url='https://example.org/start', status=302, location='/final')],
        fetched_at='2026-10-28T00:00:00Z', extractor_version='extractor-v1', coverage=coverage,
        external_version=dict(etag='v1', last_modified=None), extraction_status='truncated', browser_used=False,
        text=text, text_sha256=digest(text), run_id='run-a', tool_attempt_id='attempt-a')
    return dict(snapshot_id=sid, workspace_file_id='file-a', workspace_id='ws-a', conversation_id='cv-a',
        version_number=1, parent_snapshot_id=None, locator=locator, observed_at='2026-10-28T00:00:00Z',
        version_at=None, original_sha256=digest('raw'), extraction_sha256=digest(text), original_byte_length=3,
        extraction_byte_length=len(text.encode()), parser_version='extractor-v1', extraction_status='truncated',
        coverage=coverage, omissions=['bounded body'])


def claims():
    ref = dict(workspace_file_id='file-a', snapshot_id='snapshot-a', text_sha256=snapshot()['extraction_sha256'],
        start=0, end=6, quote='[bold]', relation='supports')
    claim = dict(artifact_id='artifact-a', revision_id='revision-old', body_hash=digest('body'), claim='Claim literal [red]x[/red]',
        evidence=[ref], claim_id='claim-a', workspace_id='ws-a', conversation_id='cv-a', run_id='run-a',
        tool_attempt_id='attempt-a', created_at='2026-10-28T00:00:00Z', semantic_status='conflict')
    return dict(artifact_id='artifact-a', revision_id='revision-old', body_hash=digest('body'), items=[dict(claim=claim,
        freshness='potentially_stale', newer_snapshot_ids=['snapshot-new'], coverage=['truncated'])])


class ResearchHTTP:
    base = 'http://127.0.0.1:9000'
    def __init__(self):
        self.principal = 'human-a'
        self.source = snapshot()
        self.result = claims()
        self.paths = []
        self.denied = False
        self.bad_range = False

    def identity(self, workspace):
        return self.principal

    def request(self, path, body=None):
        assert body is None, 'research must never write'
        self.paths.append(path)
        if self.denied:
            raise OperatorError('secret server response')
        url = urlsplit(path)
        if '/work-areas/' in url.path:
            after = parse_qs(url.query).get('after')
            return dict(items=[] if after else [copy.deepcopy(self.source)], next_after=None if after else 'snapshot-a')
        if '/research/snapshots/' in url.path:
            return copy.deepcopy(self.source)
        if url.path.endswith('/research/claims'):
            assert '/artifacts/artifact-a/revisions/revision-old/' in url.path
            assert parse_qs(url.query)['body_hash'] == [digest('body')]
            return copy.deepcopy(self.result)
        if '/versions/' in url.path:
            query = parse_qs(url.query)
            assert query['sha256'] == [self.source['extraction_sha256']]
            assert url.path.endswith('/files/file-a/versions/snapshot-a')
            raw = self.source['locator']['text'].encode()
            offset = int(query['offset'][0])
            return dict(ref=dict(workspace_file_id='file-a', version_id='snapshot-a', sha256=digest(raw.decode())),
                text=raw[offset:].decode(), offset=offset, next_offset=len(raw), byte_length=len(raw),
                chunk_sha256='0'*64 if self.bad_range else sha256(raw[offset:]).hexdigest(), omitted_ranges=[],
                source_snapshot_id='snapshot-a', has_utf8_bom=False, newline='none')
        raise AssertionError(path)


def controller(client=None):
    return ResearchController(client or ResearchHTTP(), 'ws-a', 'human-a', 'cv-a')


def binding():
    return ArtifactBinding('artifact-a', 'revision-old', digest('body'))


def test_canonical_metadata_claims_and_exact_read_routes():
    ctrl = controller()
    page = ctrl.listing()
    assert page.next_after == 'snapshot-a'
    assert ctrl.listing(page.next_after).items == []
    source = ctrl.snapshot('snapshot-a')
    metadata = snapshot_text(source)
    for expected in ('snapshot-a', digest('raw'), source.extraction_sha256, 'https://example.org/start',
                     'https://example.org/final', '2026-10-28', 'extractor-v1', 'partial', 'bounded body'):
        assert expected in metadata
    source, part = ctrl.source_range(source)
    assert part.text == ctrl.client.source['locator']['text']
    text = claims_text(ctrl.claims(binding()))
    for expected in ('conflict', 'potentially_stale', 'partial', 'snapshot-new', 'Unicode character range [0, 6)',
                     'not claim truth', 'not semantic verification'):
        assert expected in text
    ctrl.client.result['items'][0]['claim'].update(semantic_status='unsupported', evidence=[])
    assert 'unsupported' in claims_text(ctrl.claims(binding()))


@pytest.mark.parametrize('change', ['workspace', 'revision', 'hash', 'claim-scope', 'snapshot', 'range'])
def test_reject_mismatched_scope_identity_and_hash(change):
    ctrl = controller()
    if change == 'workspace':
        ctrl.client.source['workspace_id'] = 'other'
        call = lambda: ctrl.listing()
    elif change == 'snapshot':
        ctrl.client.source['snapshot_id'] = 'other'
        call = lambda: ctrl.snapshot('snapshot-a')
    elif change == 'range':
        source = ctrl.snapshot('snapshot-a')
        ctrl.client.bad_range = True
        call = lambda: ctrl.source_range(source)
    else:
        if change == 'revision':
            ctrl.client.result['revision_id'] = 'revision-new'
        elif change == 'hash':
            ctrl.client.result['body_hash'] = '0'*64
        else:
            ctrl.client.result['items'][0]['claim']['conversation_id'] = 'other'
        call = lambda: ctrl.claims(binding())
    with pytest.raises(OperatorError):
        call()


def test_binding_requires_real_saved_revision_and_is_immutable():
    with pytest.raises(OperatorError):
        selected_binding(None, [], None)
    artifact = dict(id='artifact-a', current_revision_id='revision-new', current_revision=dict(id='revision-new', body_hash=digest('new')))
    old = dict(id='revision-old', body_hash=digest('body'))
    exact = selected_binding(artifact, [old], 'revision-old')
    assert exact == binding()
    with pytest.raises(FrozenInstanceError):
        exact.revision_id = 'revision-new'
    with pytest.raises(OperatorError):
        selected_binding(artifact, [], 'missing')


@pytest.mark.parametrize('size', [(100, 42), (40, 24)])
def test_offscreen_refresh_preserves_draft_pin_literal_and_revoke_clear(size):
    async def check():
        client = ResearchHTTP()
        app = App()
        async with app.run_test(size=size) as pilot:
            human = TextArea('unsent human draft', id='human-draft')
            await app.screen.mount(human)
            screen = ResearchScreen(client, 'ws-a', 'human-a', 'cv-a', binding=binding())
            await app.push_screen(screen)
            await pilot.pause(.3)
            assert screen.page is not None
            screen.query_one('#research-citations', Select).value = '0'
            await screen.perform('cite')
            source_text = screen.query_one('#research-content', TextArea).text
            assert '[bold]literal[/bold]' in source_text
            assert '\\u001b' in source_text and '\\u202e' in source_text
            assert '\x1b' not in source_text and '\u202e' not in source_text
            assert screen.part.source_snapshot_id == 'snapshot-a'
            await screen.perform('refresh')
            assert screen.binding == binding()
            assert screen.snapshot_id == 'snapshot-a'
            assert human.text == 'unsent human draft'
            for button in screen.query(Button):
                assert button.region.width <= size[0]
            client.denied = True
            await screen.perform('refresh')
            assert screen.page is screen.snapshot is screen.part is None
            assert not screen.citations
            for key in ('metadata', 'content', 'claims'):
                assert screen.query_one('#research-' + key, TextArea).text == ''
            assert 'secret' not in str(screen.query_one('#research-notice', Static).render())
            assert screen.binding == binding() and human.text == 'unsent human draft'
            client.denied = False
            client.principal = 'other-human'
            await screen.perform('refresh')
            assert screen.page is None
    asyncio.run(check())


def test_actual_shell_research_entry_blocks_send_and_preserves_composer(tmp_path, monkeypatch):
    from test_tui_composer import FakeClient
    from workagent.tui.app import WorkagentApp
    from textual.widgets import TabbedContent
    monkeypatch.setenv('LOCAL_BEARER_TOKEN', 'x'*40)
    monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL', str(tmp_path/'journal'))
    monkeypatch.setenv('WORKAGENT_TUI_DRAFTS', str(tmp_path/'drafts'))
    async def check():
        client, research = FakeClient(), ResearchHTTP()
        research.source.update(workspace_id='workspace', conversation_id='c1')
        original = client.request
        client.request = lambda path, body=None: research.request(path, body) if '/research/' in path else original(path, body)
        app = WorkagentApp(client, 'workspace')
        async with app.run_test(size=(80, 24)) as pilot:
            await app.workers.wait_for_complete()
            app.query_one('#work', Select).value = 'c1'
            await pilot.pause(); await app.workers.wait_for_complete()
            composer = app.query_one('#composer', TextArea)
            composer.load_text('unsent conversation')
            await pilot.pause()
            app.query_one('#panels', TabbedContent).active = 'files-panel'
            await pilot.pause()
            await pilot.click('#research-sources')
            await app.workers.wait_for_complete(); await pilot.pause()
            assert isinstance(app.screen, ResearchScreen)
            assert app.screen.page is not None
            await pilot.press('ctrl+enter', 'f5', 'ctrl+r')
            await app.workers.wait_for_complete()
            assert not client.calls
            assert composer.text == 'unsent conversation'
            await pilot.press('escape')
            assert composer.text == 'unsent conversation'
    asyncio.run(check())


def test_file_detail_entry_preserves_exact_draft(tmp_path):
    from workagent.tui.file_drafts import FileDraftStore
    from workagent.tui.files_screen import WorkingFilesScreen
    async def check():
        client = ResearchHTTP()
        original = client.request
        item = dict(workspace_file_id='file-a', workspace_id='ws-a', conversation_id='cv-a', filename='source.txt',
            mime_type='text/plain', storage='source_snapshot', editable=False, byte_length=client.source['extraction_byte_length'],
            current=dict(workspace_file_id='file-a', version_id='snapshot-a', sha256=client.source['extraction_sha256']))
        def request(path, body=None):
            if path.endswith('/conversations/cv-a'):
                return dict(conversation=dict(work_version=1))
            if '/work-areas/cv-a/files?' in path:
                return dict(items=[item], next_after=None)
            return original(path, body)
        client.request = request
        store = FileDraftStore(client.base, 'ws-a', 'human-a', 'cv-a', path=tmp_path/'drafts')
        app = App()
        async with app.run_test(size=(80, 30)) as pilot:
            screen = WorkingFilesScreen(client, 'ws-a', 'human-a', 'cv-a', store=store)
            await app.push_screen(screen)
            await app.workers.wait_for_complete()
            screen.query_one('#wf-content', TextArea).load_text('human file draft')
            await pilot.pause()
            before = copy.deepcopy(screen.file_session.state)
            screen.query_one('#wf-files', Select).value = '0'
            screen.on_button_pressed(Button.Pressed(screen.query_one('#wf-research', Button)))
            await app.workers.wait_for_complete(); await pilot.pause()
            detail = app.screen
            assert isinstance(detail, ResearchScreen)
            assert detail.snapshot.snapshot_id == 'snapshot-a'
            await detail.perform('refresh')
            assert screen.file_session.state == before
            assert screen.query_one('#wf-content', TextArea).text == 'human file draft'
    asyncio.run(check())
