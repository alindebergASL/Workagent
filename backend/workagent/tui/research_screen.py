"""Optional native source/citation details, usable in a narrow terminal."""
from rich.text import Text
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import Button, Footer, Select, Static, TextArea
from ..operator_journal import OperatorError
from .research import ResearchController, claims_text, snapshot_text
from .safe_text import literal
from .transport import ReadLane


class ResearchScreen(ModalScreen):
    BINDINGS = [Binding('escape', 'close', 'Back', priority=True),
                Binding('ctrl+r', 'refresh', 'Refresh details', priority=True)]
    CSS = '''
    ResearchScreen { background: $surface; }
    #research-scroll { height: 1fr; }
    #research-title, #research-notice, #research-binding, #research-range-info { height: auto; padding: 0 1; }
    ResearchScreen Button { width: 100%; min-width: 0; margin: 0; }
    ResearchScreen Select { width: 100%; }
    #research-metadata { height: 14; }
    #research-content { height: 8; }
    #research-claims { height: 14; }
    '''

    def __init__(self, client, workspace, principal, conversation, *, binding=None, source_ref=None):
        super().__init__()
        self.controller = ResearchController(client, workspace, principal, conversation)
        self.binding = binding  # Frozen saved artifact + revision + body hash, never a moving head.
        self.source_ref = source_ref
        self.snapshot_id = source_ref.version_id if source_ref else None
        self.snapshot = self.part = self.page = None
        self.citations = {}
        self.lane = ReadLane()
        self.busy = False

    def compose(self):
        yield Static('Sources & citations · read only', markup=False, id='research-title')
        yield Static('Loading authorized research…', markup=False, id='research-notice')
        with VerticalScroll(id='research-scroll'):
            yield Button('Back', id='research-back')
            yield Button('Refresh details (no refetch)', id='research-refresh')
            yield Static(self.binding_text(), markup=False, id='research-binding')
            yield Select([], prompt='Sources (25 per page)', id='research-sources')
            yield Button('Next source page', id='research-next')
            yield Button('Inspect selected source', id='research-inspect')
            yield TextArea('', read_only=True, soft_wrap=True, id='research-metadata')
            yield Static('', markup=False, id='research-range-info')
            yield TextArea('', read_only=True, soft_wrap=True, id='research-content')
            yield Button('Next exact text range', id='research-range-next')
            yield TextArea('', read_only=True, soft_wrap=True, id='research-claims')
            yield Select([], prompt='Exact cited snapshots', id='research-citations')
            yield Button('Inspect cited source', id='research-cite')
        yield Footer()

    def binding_text(self):
        if not self.binding:
            return 'Source inspection only. Open a saved result’s Citations to inspect its exact revision.'
        b = self.binding
        return f'Artifact {b.artifact_id}\nRevision {b.revision_id}\nBody SHA256 {b.body_hash}\nRefresh never changes this revision or edits human work.'

    def on_mount(self):
        self.start('refresh')

    def on_unmount(self):
        self.lane.close()
        self.snapshot = self.part = self.page = None
        self.citations.clear()

    def notice(self, value):
        self.query_one('#research-notice', Static).update(Text(literal(value)))

    def clear_payload(self):
        self.snapshot = self.part = self.page = None
        self.citations = {}
        for key in ('sources', 'citations'):
            self.query_one('#research-' + key, Select).set_options([])
        for key in ('metadata', 'content', 'claims'):
            self.query_one('#research-' + key, TextArea).load_text('')
        self.query_one('#research-range-info', Static).update('')

    def start(self, action):
        if not self.busy:
            self.busy = True
            self.run_worker(self.perform(action), exit_on_error=False)

    async def perform(self, action):
        for widget in self.query('Button, Select'):
            widget.disabled = True
        try:
            after = self.page.next_after if action == 'next' and self.page else None
            if action == 'next' and not after:
                self.notice('End of source list; no more pages.')
                return
            offset = 0
            if action == 'inspect':
                key = self.query_one('#research-sources', Select).value
                item = next((s for s in self.page.items if s.snapshot_id == key), None) if self.page else None
                if item is None:
                    raise OperatorError('Choose a listed source first')
                from ..workspace_file_models import FileVersionRef
                self.snapshot_id = item.snapshot_id
                self.source_ref = FileVersionRef(workspace_file_id=item.workspace_file_id,
                    version_id=item.snapshot_id, sha256=item.extraction_sha256)
            elif action == 'cite':
                key = self.query_one('#research-citations', Select).value
                ref = self.citations.get(key)
                if ref is None:
                    raise OperatorError('Choose an exact cited snapshot first')
                from ..workspace_file_models import FileVersionRef
                self.snapshot_id = ref.snapshot_id
                self.source_ref = FileVersionRef(workspace_file_id=ref.workspace_file_id,
                    version_id=ref.snapshot_id, sha256=ref.text_sha256)
            elif action == 'range-next':
                if self.part is None or self.part.next_offset >= self.part.byte_length:
                    self.notice('No further text range. Inspect a source first.')
                    return
                offset = self.part.next_offset
            # Clear before HTTP, not just on rejection. No stale sensitive rows linger.
            self.clear_payload()
            self.notice('Reading authorized details…')
            page = await self.lane.read(self.controller.listing, after)
            claims = await self.lane.read(self.controller.claims, self.binding) if self.binding else None
            snapshot = part = None
            if self.snapshot_id:
                snapshot = await self.lane.read(self.controller.snapshot, self.snapshot_id, self.source_ref)
                snapshot, part = await self.lane.read(self.controller.source_range, snapshot, offset)
            # Commit visible rows only after every requested scoped read succeeded.
            self.page, self.snapshot, self.part = page, snapshot, part
            self.query_one('#research-sources', Select).set_options([
                (Text(literal((getattr(s.locator, 'title', None) or getattr(s.locator, 'url', s.locator.kind)) +
                    ' · ' + s.extraction_status + ' · ' + s.snapshot_id)), s.snapshot_id) for s in page.items])
            if claims:
                self.query_one('#research-claims', TextArea).load_text(literal(claims_text(claims)))
                self.citations = {str(n): ref for n, ref in enumerate(ref for item in claims.items for ref in item.claim.evidence)}
                self.query_one('#research-citations', Select).set_options([
                    (Text(literal(f'{ref.relation} · {ref.snapshot_id} · chars [{ref.start}, {ref.end})')), key)
                    for key, ref in self.citations.items()])
            if snapshot:
                self.query_one('#research-metadata', TextArea).load_text(literal(snapshot_text(snapshot)))
                self.query_one('#research-content', TextArea).load_text(literal(part.text))
                omitted = ', '.join(f'[{r.start}, {r.end}) SHA256 {r.sha256}' for r in part.omitted_ranges) or 'none'
                self.query_one('#research-range-info', Static).update(Text(literal(
                    f'UTF-8 bytes [{part.offset}, {part.next_offset}) of {part.byte_length}; end exclusive.\n'
                    f'Chunk SHA256 {part.chunk_sha256}\nOmitted byte ranges: {omitted}\n'
                    'Controls escaped for display; citation offsets refer to original Unicode text, not escaped display.')))
            self.notice(f'{len(page.items)} sources on this page; ' + ('more available.' if page.next_after else 'end of list.') +
                        ' Metadata refreshed only; no public fetch or draft changes.')
        except (OperatorError, ValueError, KeyError, TypeError, ImportError):
            self.clear_payload()
            # Error bodies can contain server/source content: never echo them here.
            self.notice('Research unavailable or exact binding/access check failed. Visible source and claim rows cleared. No automatic retry.')
        finally:
            self.busy = False
            for widget in self.query('Button, Select'):
                widget.disabled = False

    def on_select_changed(self, event):
        event.stop()

    def on_button_pressed(self, event):
        event.stop()
        action = (event.button.id or '').removeprefix('research-')
        if action == 'back':
            self.action_close()
        else:
            self.start(action)

    def action_refresh(self):
        self.start('refresh')

    def action_close(self):
        if not self.busy:
            self.dismiss()
