"""Working files inside the existing conversation shell; HTTP runs off-thread."""
import json
from textual.screen import ModalScreen
from textual.binding import Binding
from textual.containers import VerticalScroll, Horizontal
from textual.widgets import Button, Checkbox, Collapsible, Footer, Input, Select, Static, TextArea
from rich.text import Text
from ..operator_journal import OperatorError
from .file_drafts import FileDraftSession, FileDraftStore
from .files import FilesController, editor_content, normalized
from .transport import ReadLane
from .safe_text import literal


class WorkingFilesScreen(ModalScreen):
    BINDINGS = [Binding('escape', 'close', 'Back', priority=True),
                Binding('ctrl+s', 'save_file', 'Save file', priority=True),
                Binding('ctrl+r', 'refresh_files', 'Refresh list', priority=True),
                Binding('f5', 'save_file', show=False, priority=True),
                Binding('ctrl+enter', 'save_file', show=False, priority=True)]
    CSS = '''
    WorkingFilesScreen { background: $surface; }
    #wf-scroll { height: 1fr; }
    #wf-title, #wf-notice, #wf-binding, #wf-coverage { height: auto; padding: 0 1; }
    #wf-content, #wf-envelope { height: 10; min-height: 6; }
    #wf-notice { max-height: 5; overflow-y: auto; }
    .wf-row { height: 3; }
    .wf-row Button { min-width: 10; margin-right: 1; }
    #wf-notice { color: $accent; }
    '''

    def __init__(self, client, workspace, principal, conversation, *, store=None):
        super().__init__()
        self.client = client
        self.file_session = FileDraftSession(store or FileDraftStore(client.base, workspace, principal, conversation))
        self.controller = FilesController(client, self.file_session)
        self.lane = ReadLane()
        self.busy = False
        self.loading = False
        self.range_item = None
        self.range_part = None
        self.storage_failed = False

    def compose(self):
        yield Static('Working files · Ctrl+S save · Esc back', markup=False, id='wf-title')
        yield Static('Reading authorized file list…', markup=False, id='wf-notice')
        with VerticalScroll(id='wf-scroll'):
            with Horizontal(classes='wf-row'):
                yield Button('Back', id='wf-back')
                yield Button('Refresh list', id='wf-refresh')
                yield Button('Next page', id='wf-next')
                yield Button('New draft', id='wf-new')
            yield Select([], prompt='Working files (25 per page)', id='wf-files')
            with Horizontal(classes='wf-row'):
                yield Button('Open exact', id='wf-open')
                yield Button('Read range', id='wf-range')
                yield Button('Next range', id='wf-range-next')
            yield Select([], prompt='Retained drafts / older versions', id='wf-drafts')
            yield Button('Reopen draft', id='wf-reopen')
            yield Static('', markup=False, id='wf-binding')
            yield Static('', markup=False, id='wf-coverage')
            yield Input(placeholder='Safe filename: notes.md', id='wf-name')
            yield TextArea('', id='wf-content', show_line_numbers=True)
            yield Checkbox('Allow LF normalization of edited mixed line endings', id='wf-normalize')
            with Horizontal(classes='wf-row'):
                yield Button('Save human edit', id='wf-save')
                yield Button('Read back', id='wf-readback')
                yield Button('Replay exact', id='wf-replay')
            yield Button('Resolve rejection', id='wf-resolve')
            with Collapsible(title='Exact pending envelope (no credentials)', collapsed=True):
                yield TextArea('', read_only=True, id='wf-envelope')
            yield Select([(x, x) for x in ('txt', 'markdown', 'csv', 'json')], value='txt', allow_blank=False, id='wf-format')
            yield Button('Export saved version', id='wf-export')
            yield Input(placeholder='Absolute download destination (must not exist)', id='wf-destination')
            yield Button('Download export', id='wf-download')
        yield Footer()

    def on_mount(self):
        self.show_draft()
        self.start(self.refresh_listing)

    def on_unmount(self):
        self.lane.close()

    def notice(self, text):
        self.query_one('#wf-notice', Static).update(Text(literal(text)))

    def show_draft(self):
        self.loading = True
        self.range_item = self.range_part = None
        draft = self.file_session.draft
        base = draft['base']
        text = self.query_one('#wf-content', TextArea)
        if normalized(text.text) != normalized(draft['content']):
            with text.prevent(TextArea.Changed):
                text.load_text(draft['content'])
        name = self.query_one('#wf-name', Input)
        with name.prevent(Input.Changed):
            name.value = draft['filename']
        name.disabled = bool(base)
        text.read_only = bool(base and not base['file']['editable'])
        checkbox = self.query_one('#wf-normalize', Checkbox)
        with checkbox.prevent(Checkbox.Changed):
            checkbox.value = bool(base and base['normalize'])
        checkbox.disabled = not base or base['newline'] != 'mixed'
        selected = self.file_session.state['selected']
        picker = self.query_one('#wf-drafts', Select)
        picker.set_options([(Text(literal(d['filename'] + ' · ' + key)), key) for key, d in self.file_session.state['drafts'].items()])
        picker.value = selected
        if base:
            ref = base['file']['current']
            binding = f"File {ref['workspace_file_id']}\nVersion {ref['version_id']}\nSHA256 {ref['sha256']}"
        else:
            binding = 'New private draft; no saved version yet.'
        pending = draft['pending']
        if pending:
            binding += '\n' + pending.get('state', 'outcome_unknown').upper() + ' ' + pending['action'] + ' · ' + pending['body']['command_id']
        self.query_one('#wf-envelope', TextArea).load_text(json.dumps(pending, ensure_ascii=False, indent=2) if pending else 'No pending command.')
        if draft['export']:
            binding += '\nExport ' + draft['export']['filename'] + ' · SHA256 ' + draft['export']['blob']['sha256']
            binding += '\nExport omissions: ' + ('; '.join(draft['export']['omissions']) or 'none')
        self.query_one('#wf-binding', Static).update(Text(literal(binding)))
        coverage = f"Complete editor content: {len(draft['content'].encode())} UTF-8 bytes. No omitted bytes."
        if base and base.get('visible_bytes', 0) < base.get('total_bytes', 0):
            coverage = f"Read-only preview: bytes 0–{base['visible_bytes']} of {base['total_bytes']}; remaining bytes omitted. Use Read range / Next range."
        if base and base.get('source_omissions') is not None:
            coverage += ' Extraction omissions: ' + ('; '.join(base['source_omissions']) or 'none')
        if base:
            coverage += ' Original newline: ' + base['newline'] + '. BOM retained.'
        if base and base['newline'] == 'mixed':
            coverage += ' Editing normalizes mixed endings to LF only with explicit consent.'
        self.query_one('#wf-coverage', Static).update(Text(literal(coverage)))
        self.loading = False

    def on_text_area_changed(self, event):
        if event.text_area.id != 'wf-content':
            return
        event.stop()
        if self.loading or self.range_item or self.busy:
            return
        draft = self.file_session.draft
        base = draft['base']
        self.persist(content=editor_content(draft['content'], event.text_area.text, base['newline'] if base else 'lf'))

    def on_input_changed(self, event):
        event.stop()
        if event.input.id == 'wf-name' and not self.loading and not self.busy:
            self.persist(filename=event.value)

    def on_checkbox_changed(self, event):
        event.stop()
        if event.checkbox.id == 'wf-normalize' and not self.loading and not self.busy:
            base = self.file_session.draft['base']
            if base:
                self.persist(base={**base, 'normalize': event.value})

    def on_select_changed(self, event):
        event.stop()  # Never bubble file selectors into conversation navigation.

    def persist(self, **values):
        try:
            self.file_session.edit(**values)
        except OperatorError as exc:
            self.storage_failed = True
            self.notice(str(exc) + ' Editor locked; reconnect to restore durable content.')
            self.query_one('#wf-content', TextArea).read_only = True

    def start(self, function):
        if self.busy or self.storage_failed:
            self.notice('File operation outstanding or private storage locked.')
            return
        self.busy = True
        self.query_one('#wf-content', TextArea).read_only = True
        self.query_one('#wf-name', Input).disabled = True
        self.run_worker(self.perform(function), exit_on_error=False)

    async def perform(self, function):
        try:
            await function()
        except (OperatorError, ValueError, KeyError, TypeError) as exc:
            self.notice(str(exc) + ' Draft and pending envelope retained. No automatic retry.')
        finally:
            self.busy = False
            if not self.range_item:
                self.show_draft()

    async def refresh_listing(self, after=None):
        page = await self.lane.read(self.controller.refresh, after)
        self.query_one('#wf-files', Select).set_options([(Text(literal(i.filename + ' · ' + i.current.version_id)), str(n)) for n, i in enumerate(page.items)])
        self.notice(f'Listed {len(page.items)} files; ' + ('more omitted — Next page.' if page.next_after else 'end of list.') +
                    f' Conversation version {self.controller.version}. Selected draft stays pinned.')

    def selected_file(self):
        selected = self.query_one('#wf-files', Select).value
        if selected is Select.NULL or self.controller.page is None:
            raise OperatorError('Select a listed file first')
        return self.controller.page.items[int(selected)]

    async def open_selected(self):
        item = self.selected_file()
        await self.lane.read(self.controller.open_file, item)
        self.notice('Exact file loaded; edits are private until Save human edit.')

    async def range_read(self, item=None, next=False):
        item = item or (self.range_item if next else self.selected_file())
        if item is None:
            raise OperatorError('Read a range first')
        offset = self.range_part.next_offset if next and self.range_part else 0
        await self.lane.read(self.controller.authorize)
        part = await self.lane.read(self.controller.read_range, item.current, offset)
        self.range_item, self.range_part = item, part
        text = self.query_one('#wf-content', TextArea)
        with text.prevent(TextArea.Changed):
            text.load_text(part.text)
        text.read_only = True
        self.query_one('#wf-binding', Static).update(Text(f'File {part.ref.workspace_file_id}\nVersion {part.ref.version_id}\nSHA256 {part.ref.sha256}'))
        self.query_one('#wf-coverage', Static).update(Text(f'Read-only bytes {part.offset}–{part.next_offset} of {part.byte_length}. Omitted: ' +
            (', '.join(f'{r.start}–{r.end} sha256={r.sha256}' for r in part.omitted_ranges) or 'none')))
        self.notice('Bounded range; original evidence is immutable. Reopen draft returns to unsent work.')

    async def mutate(self, export=False):
        if self.range_item:
            raise OperatorError('Reopen an editable draft before saving/exporting')
        format = self.query_one('#wf-format', Select).value
        await self.lane.read(self.controller.prepare, 'export' if export else 'save', format)
        self.notice(await self.lane.read(self.controller.send))

    async def recover(self, replay=False):
        self.notice(await self.lane.read(self.controller.send if replay else self.controller.readback))

    async def resolve_rejection(self):
        self.notice(await self.lane.read(self.controller.resolve_rejection))

    async def download(self):
        manifest = self.file_session.draft['export']
        if not manifest:
            raise OperatorError('Export an exact saved version first')
        destination = self.query_one('#wf-destination', Input).value
        await self.lane.read(self.controller.authorize)
        await self.lane.read(self.client.download_export, self.controller.scope['workspace'], manifest, destination)
        self.notice('Downloaded actual bytes; SHA256 verified. Saved to ' + destination)

    def action_close(self):
        if self.busy:
            self.notice('Wait for file operation to finish; exact pending envelope is already retained.')
        else:
            self.dismiss()

    def action_refresh_files(self):
        self.start(self.refresh_listing)

    def action_save_file(self):
        self.start(self.mutate)

    def on_button_pressed(self, event):
        event.stop()
        action = event.button.id
        if action == 'wf-back':
            self.action_close()
            return
        if self.busy or self.storage_failed:
            return
        try:
            if action == 'wf-new':
                self.file_session.select('__new__')
                self.show_draft()
            elif action == 'wf-reopen':
                key = self.query_one('#wf-drafts', Select).value
                if key is not Select.NULL:
                    self.file_session.select(key)
                    self.show_draft()
            else:
                handlers = {'wf-refresh': self.refresh_listing, 'wf-next': lambda: self.refresh_listing(self.controller.page.next_after if self.controller.page else None),
                    'wf-open': self.open_selected, 'wf-range': self.range_read,
                    'wf-range-next': lambda: self.range_read(next=True), 'wf-save': self.mutate,
                    'wf-export': lambda: self.mutate(export=True), 'wf-readback': self.recover,
                    'wf-replay': lambda: self.recover(replay=True), 'wf-download': self.download,
                    'wf-resolve': self.resolve_rejection}
                if action in handlers:
                    self.start(handlers[action])
        except (OperatorError, ValueError) as exc:
            self.notice(str(exc))
