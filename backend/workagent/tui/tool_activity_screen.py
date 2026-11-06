"""Secondary native tool receipt viewer. No execution or retry controls."""
from rich.text import Text
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import Button, Footer, Select, Static, TextArea, Input
from ..operator_journal import OperatorError
from .tool_activity import ToolActivityController, compute_result, receipt_text
from .safe_text import literal
from .transport import ReadLane


class ToolActivityScreen(ModalScreen):
    BINDINGS = [Binding('escape', 'close', 'Back', priority=True),
                Binding('ctrl+r', 'refresh', 'Refresh receipts', priority=True)]
    CSS = '''
    ToolActivityScreen { background: $surface; }
    #tool-scroll { height: 1fr; }
    #tool-notice { height: auto; }
    #tool-receipt { height: 26; }
    ToolActivityScreen Button { width: 100%; min-width: 0; margin: 0; }
    '''

    def __init__(self, client, workspace, principal, runs):
        super().__init__()
        self.client, self.workspace, self.principal = client, workspace, principal
        self.runs = runs
        self.controller = None
        self.page = None
        self.exports = {}
        self.lane = ReadLane()
        self.busy = False

    def compose(self):
        yield Static('Tool activity · recorded execution, not goal verification', markup=False, id='tool-notice')
        with VerticalScroll(id='tool-scroll'):
            yield Button('Back', id='tool-back')
            yield Select([(str(r.get('state', 'Run')) + ' · ' + r['id'], r['id']) for r in self.runs],
                         value=self.runs[-1]['id'] if self.runs else Select.BLANK, id='tool-run')
            yield Button('Read selected run', id='tool-refresh')
            yield Button('Next receipt page', id='tool-next')
            yield Select([], prompt='Recorded attempts', id='tool-attempt')
            yield TextArea('', read_only=True, soft_wrap=True, id='tool-receipt')
            yield Select([], prompt='Generated exports', id='tool-export')
            yield Input(placeholder='Absolute new download path (never overwrite)', id='tool-destination')
            yield Button('Download verified bytes', id='tool-download')
        yield Footer()

    def on_mount(self):
        self.start('refresh')

    def on_unmount(self):
        self.lane.close()
        self.page = None
        self.exports = {}

    def clear(self):
        self.page = None
        self.exports = {}
        self.query_one('#tool-attempt', Select).set_options([])
        self.query_one('#tool-export', Select).set_options([])
        self.query_one('#tool-receipt', TextArea).load_text('')

    def notice(self, value):
        self.query_one('#tool-notice', Static).update(Text(literal(value)))

    def start(self, action):
        if not self.busy:
            self.busy = True
            self.run_worker(self.perform(action), exit_on_error=False)

    async def perform(self, action):
        for widget in self.query('Button, Select'):
            widget.disabled = True
        try:
            run = self.query_one('#tool-run', Select).value
            if run not in [r['id'] for r in self.runs]:
                raise OperatorError('Select a known run')
            if action == 'download':
                key = self.query_one('#tool-export', Select).value
                if key not in self.exports or self.controller is None or self.controller.run != run:
                    raise OperatorError('Select an export from the current receipt')
                item, manifest = self.exports[key]
                destination = self.query_one('#tool-destination', Input).value
                await self.lane.read(self.controller.download, item, manifest, destination)
                self.notice('Downloaded actual bytes; SHA256 verified. No code was executed locally.')
                return
            after = self.page.next_after if action == 'next' and self.page else None
            if action == 'next' and not after:
                self.notice('No further receipts.')
                return
            self.clear()
            self.controller = ToolActivityController(self.client, self.workspace, self.principal, run)
            page = await self.lane.read(self.controller.listing, after)
            self.page = page
            self.query_one('#tool-attempt', Select).set_options([
                (i.capability_id + ' · ' + i.state + ' · ' + i.attempt_id, i.attempt_id) for i in page.items])
            self.notice(f'{len(page.items)} recorded attempts on this page. Select one to view actual output. No automatic retries.')
        except (OperatorError, ValueError, KeyError, TypeError, OSError):
            self.clear()
            self.notice('Receipt or download unavailable; visible output cleared. Refresh explicitly. No retry or overwrite.')
        finally:
            self.busy = False
            for widget in self.query('Button, Select'):
                widget.disabled = False

    def on_select_changed(self, event):
        event.stop()
        if event.value != event.select.value:
            return  # A queued initialization/reset event is no longer current.
        if (event.select.id == 'tool-run' and not self.busy and
                (self.controller is None or event.value != self.controller.run)):
            self.clear()
        if event.select.id == 'tool-attempt':
            self.exports = {}
            self.query_one('#tool-export', Select).set_options([])
            self.query_one('#tool-receipt', TextArea).load_text('')
            item = next((i for i in self.page.items if i.attempt_id == event.value), None) if self.page else None
            if item:
                self.query_one('#tool-receipt', TextArea).load_text(literal(receipt_text(item, self.workspace)))
                result = compute_result(item, self.workspace)
                self.exports = {m.export_id: (item, m) for m in result.outputs} if result else {}
                self.query_one('#tool-export', Select).set_options([
                    (Text(literal(m.filename + ' · ' + m.blob.sha256)), key) for key, (_, m) in self.exports.items()])

    def on_button_pressed(self, event):
        event.stop()
        action = (event.button.id or '').removeprefix('tool-')
        self.action_close() if action == 'back' else self.start(action)

    def action_refresh(self):
        self.start('refresh')

    def action_close(self):
        if not self.busy:
            self.dismiss()
