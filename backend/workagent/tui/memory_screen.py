"""Optional memory controls beside ordinary conversation, never a dashboard gate."""
import json
from textual.binding import Binding
from textual.screen import ModalScreen
from textual.containers import Horizontal, VerticalScroll
from textual.widgets import Button, Checkbox, Collapsible, Footer, Input, Select, Static, TextArea
from rich.text import Text

from ..operator_journal import OperatorError
from .memory import MemoryController
from .safe_text import literal
from .transport import ReadLane


class MemoryScreen(ModalScreen):
    BINDINGS = [Binding('escape', 'close', 'Back', priority=True)]
    CSS = '''
    MemoryScreen { background: $surface; }
    #memory-scroll { height: 1fr; }
    #memory-title, #memory-notice, #memory-summary { height: auto; padding: 0 1; }
    #memory-content { height: 5; min-height: 3; }
    #memory-details, #memory-usage { height: 8; }
    .memory-row { height: auto; min-height: 3; }
    .memory-row Button { min-width: 9; margin-right: 1; }
    #memory-notice { color: $accent; }
    '''

    def __init__(self, client, workspace, principal, conversation):
        super().__init__()
        self.controller = MemoryController(client, workspace, principal, conversation)
        self.lane = ReadLane()
        self.busy = False

    def compose(self):
        yield Static('Memory · explicit scope, human review · Esc back', markup=False, id='memory-title')
        yield Static('Loading authorized memories…', markup=False, id='memory-notice')
        with VerticalScroll(id='memory-scroll'):
            with Horizontal(classes='memory-row'):
                yield Button('Back', id='memory-back')
                yield Button('Refresh', id='memory-refresh')
                yield Button('New', id='memory-new')
            yield Select([('Current recall', 'current'), ('Candidates to review', 'candidate'),
                          ('Contested', 'contested'), ('Expired', 'expired')],
                         value='current', allow_blank=False, id='memory-filter')
            yield Select([], prompt='Memories available in this conversation', id='memory-list')
            yield Button('Inspect', id='memory-inspect')
            yield Static('Choose a memory or explicitly remember something for this task.', markup=False, id='memory-summary')
            yield TextArea('', id='memory-content')
            with Collapsible(title='Scope and record details', collapsed=True):
                yield Select([(x, x) for x in ('fact', 'preference', 'project_convention', 'episode', 'procedure')],
                             value='preference', allow_blank=False, id='memory-kind')
                yield Select([('This task', 'task'), ('Explicit work area', 'work_area'), ('Me within this workspace', 'user')],
                             value='task', allow_blank=False, id='memory-scope')
                yield Input(value=self.controller.conversation, placeholder='Exact scope ID (task/work area/user)', id='memory-scope-id')
                yield Input(placeholder='Subject key, e.g. writing', id='memory-subject')
                yield Input(placeholder='Predicate key, e.g. heading_style', id='memory-predicate')
                yield Input(placeholder='Why / qualitative basis', id='memory-basis')
                yield Input(placeholder='Applicability / exceptions', id='memory-applicability')
                yield Input(placeholder='Temporary correction from (ISO timestamp, optional)', id='memory-from')
                yield Input(placeholder='Temporary correction until (ISO timestamp, optional)', id='memory-until')
            with Horizontal(classes='memory-row'):
                yield Button('Remember', id='memory-remember')
                yield Button('Approve candidate', id='memory-review')
                yield Button('Correct', id='memory-correct')
            with Horizontal(classes='memory-row'):
                yield Button('Narrow scope', id='memory-narrow')
                yield Button('Expire', id='memory-expire')
                yield Button('Forget', id='memory-forget', variant='error')
            yield Checkbox('I intend to forget this derived memory; source files and sent history stay.', id='memory-confirm-forget')
            with Horizontal(classes='memory-row'):
                yield Button('Replay exact', id='memory-replay')
                yield Button('Resolve rejection', id='memory-resolve')
            with Collapsible(title='Provenance, revisions and usage', collapsed=True):
                yield TextArea('', read_only=True, id='memory-details')
                yield Input(placeholder='Run ID for why recalled', id='memory-run')
                yield Button('Why recalled', id='memory-why')
                yield TextArea('', read_only=True, id='memory-usage')
        yield Footer()

    def on_mount(self):
        self.start('refresh')

    def on_unmount(self):
        self.lane.close()
        self.controller.selected = None
        self.controller.pending = None

    def notice(self, text):
        self.query_one('#memory-notice', Static).update(Text(literal(text)))

    def value(self, name):
        return self.query_one('#memory-' + name, Input).value.strip()

    def start(self, action):
        if self.busy:
            self.notice('A memory operation is outstanding; no duplicate command sent.')
            return
        self.busy = True
        self.run_worker(self.perform(action), exit_on_error=False)

    async def perform(self, action):
        for widget in self.query('Input, Select, Button, Checkbox'):
            widget.disabled = True
        self.query_one('#memory-content', TextArea).read_only = True
        try:
            if action == 'refresh':
                status = str(self.query_one('#memory-filter', Select).value)
                page = await self.lane.read(self.controller.listing, None if status == 'current' else status)
                items = [x['revision'] for x in page['items']]
                self.query_one('#memory-list', Select).set_options([
                    (Text(literal((x['content'] or 'Forgotten')[:70] + ' · ' + x['status'])), x['memory_id']) for x in items])
                if not await self.lane.read(self.controller.reauthorize_selected):
                    self.clear_payload()
                    self.notice('Previously inspected memory is forgotten or unavailable. Payload cleared.')
                    return
                self.notice('Authorized memories loaded. Candidates do not guide later work until approved.')
            elif action == 'inspect':
                key = self.query_one('#memory-list', Select).value
                if key is Select.NULL:
                    raise OperatorError('Choose a memory first')
                detail = await self.lane.read(self.controller.inspect, str(key))
                self.show_detail(detail)
                self.notice('Inspected exact revision; changes use this base, not a silent refresh.')
            elif action == 'new':
                if self.controller.pending:
                    raise OperatorError('Resolve pending command first')
                self.clear_payload()
                self.notice('New explicit memory. Default scope is this task; broader scope must be chosen.')
            elif action == 'why':
                usage = await self.lane.read(self.controller.usage, self.value('run'))
                self.query_one('#memory-usage', TextArea).load_text(json.dumps(usage, ensure_ascii=False, indent=2))
                self.notice('Retained usage identities and selection reasons; not proof of model correctness.')
            elif action == 'resolve':
                self.controller.resolve_rejection()
                self.notice('Definitive rejection resolved. Inspect current state before another command.')
            else:
                if action != 'replay':
                    fields = self.fields(action)
                    await self.lane.read(self.controller.prepare, action, **fields)
                receipt = await self.lane.read(self.controller.send)
                self.clear_payload()
                detail = await self.lane.read(self.controller.inspect, receipt['memory_id'])
                self.show_detail(detail)
                if detail['current']['revision_id'] != receipt['revision_id']:
                    self.notice('Command receipt retained, but current revision changed. Inspect current state; no automatic reapply.')
                else:
                    self.notice('Read back saved state: ' + detail['current']['status'] + '. Source documents and already-sent history were not deleted.')
        except (OperatorError, ValueError, KeyError, TypeError) as exc:
            if action in ('refresh', 'inspect', 'why'):
                self.clear_payload()
            self.notice(str(exc) + ' No automatic retry. Unknown outcomes: Replay exact; rejected: resolve then inspect.')
        finally:
            self.busy = False
            for widget in self.query('Input, Select, Button, Checkbox'):
                widget.disabled = False
            self.query_one('#memory-content', TextArea).read_only = False

    def fields(self, action):
        scope = dict(scope_kind=str(self.query_one('#memory-scope', Select).value), scope_id=self.value('scope-id'))
        if action == 'remember':
            return dict(kind=str(self.query_one('#memory-kind', Select).value), **scope,
                        subject_key=self.value('subject'), predicate_key=self.value('predicate'),
                        content=self.query_one('#memory-content', TextArea).text,
                        confidence_basis=self.value('basis') or 'Explicit human statement', applicability=self.value('applicability'))
        if action == 'review':
            return dict(decision='accept')
        if action == 'correct':
            fields = dict(content=self.query_one('#memory-content', TextArea).text, mode='permanent')
            if self.value('until'):
                fields.update(valid_from=self.value('from') or None, valid_until=self.value('until'), mode='temporary')
            return fields
        if action == 'narrow':
            return scope
        if action == 'forget' and not self.query_one('#memory-confirm-forget', Checkbox).value:
            raise OperatorError('Confirm forgetting this derived memory first')
        return {}

    def clear_payload(self):
        self.controller.selected = None
        self.query_one('#memory-list', Select).set_options([])
        for key in ('content', 'details', 'usage'):
            self.query_one('#memory-' + key, TextArea).load_text('')
        for key in ('subject', 'predicate', 'basis', 'applicability', 'from', 'until'):
            self.query_one('#memory-' + key, Input).value = ''
        self.query_one('#memory-scope', Select).value = 'task'
        self.query_one('#memory-scope-id', Input).value = self.controller.conversation
        self.query_one('#memory-confirm-forget', Checkbox).value = False
        self.query_one('#memory-summary', Static).update('No inspected memory.')

    def show_detail(self, detail):
        current = detail['current']
        self.query_one('#memory-content', TextArea).load_text(current.get('content') or '')
        self.query_one('#memory-details', TextArea).load_text(json.dumps(detail, ensure_ascii=False, indent=2))
        for key, field in [('subject', 'subject_key'), ('predicate', 'predicate_key'), ('basis', 'confidence_basis'),
                           ('applicability', 'applicability'), ('scope-id', 'scope_id')]:
            self.query_one('#memory-' + key, Input).value = current.get(field) or ''
        self.query_one('#memory-kind', Select).value = current['kind']
        self.query_one('#memory-scope', Select).value = current['scope_kind']
        summary = (current['status'] + ' · ' + current['scope_kind'] + ':' + current['scope_id']
                   + '\nBasis: ' + (current.get('confidence_basis') or 'none')
                   + '\nSource refs: ' + str(len(current.get('source_refs', [])))
                   + '\nCandidate/inferred material is not authority. Conflicts require resolution.')
        self.query_one('#memory-summary', Static).update(Text(literal(summary)))

    def on_select_changed(self, event):
        event.stop()
        if event.select.id == 'memory-scope':
            if event.value == 'task':
                self.query_one('#memory-scope-id', Input).value = self.controller.conversation
            elif event.value == 'user':
                self.query_one('#memory-scope-id', Input).value = self.controller.principal

    def on_button_pressed(self, event):
        event.stop()
        action = (event.button.id or '').removeprefix('memory-')
        if action == 'back':
            self.action_close()
        else:
            self.start(action)

    def action_close(self):
        if self.busy or self.controller.pending:
            self.notice('Resolve outstanding memory operation before closing. No duplicate command will be sent.')
            return
        self.dismiss()
