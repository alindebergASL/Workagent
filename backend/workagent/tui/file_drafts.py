"""Private per-work-area file drafts, separate from the conversation composer.

Reuse the hardened atomic/no-follow/CAS storage instead of storing credentials or
reopening local source paths. A pending exact command is retained with the draft.
"""
import copy
from pathlib import Path
from .drafts import DraftStore
from ..operator_journal import OperatorError, digest


from ..workspace_file_models import MAX_FILE_BYTES

MAX_TEXT_BYTES = MAX_FILE_BYTES


EXPORT_FORMATS = ('txt', 'markdown', 'csv', 'json', 'docx', 'xlsx', 'pdf', 'png')


def new_chart_draft():
    # Incomplete form values are retained locally; canonical ChartSpec validates
    # only when preparing a command, not on every keystroke.
    return dict(category_column='', value_column=None, aggregation='sum',
                title='', x_label='', y_label='')


def new_file_draft():
    return dict(filename='notes.md', mime_type='text/markdown', content='',
                base=None, proposal=None, export=None, generation=0, pending=None,
                export_format='txt', chart_spec=new_chart_draft(), export_request=None)


class FileDraftStore(DraftStore):
    def __init__(self, endpoint, workspace, principal, conversation, *, path=None):
        from ..operator_client import identifier
        identifier(conversation)
        super().__init__(endpoint, workspace, principal, path=path)
        if path is None:
            self.path = str(Path(self.path) / 'files')
        self.scope['conversation'] = conversation
        self.key = digest(self.scope)

    def record_limit(self, record):
        # File text and exact pending/confirmed envelopes are bounded separately
        # from the composer's historical 1 MiB ordinary-metadata allowance.
        return self.read_limit

    def validate(self, state):
        if (not isinstance(state, dict) or set(state) != {'selected', 'drafts'} or
                not isinstance(state['drafts'], dict) or len(state['drafts']) > 64 or
                state['selected'] not in state['drafts']):
            raise OperatorError('Corrupt private file draft state')
        for key, draft in state['drafts'].items():
            if isinstance(draft, dict):
                # Additive migration: never rewrite text, bases or old envelopes.
                for field in ('export_format', 'chart_spec', 'export_request'):
                    draft.setdefault(field, copy.deepcopy(new_file_draft()[field]))
            if (not isinstance(key, str) or not isinstance(draft, dict) or
                    set(draft) != set(new_file_draft()) or
                    not isinstance(draft['filename'], str) or len(draft['filename']) > 180 or
                    draft['mime_type'] not in ('text/plain', 'text/markdown', 'text/csv', 'application/json') or
                    not isinstance(draft['content'], str) or
                    len(draft['content'].encode('utf-8')) > MAX_TEXT_BYTES or
                    type(draft['generation']) is not int or draft['generation'] < 0):
                raise OperatorError('Invalid or excessive private file draft')
            if draft['export_format'] not in EXPORT_FORMATS:
                raise OperatorError('Invalid retained export format')
            chart = draft['chart_spec']
            if (not isinstance(chart, dict) or set(chart) != set(new_chart_draft()) or
                    chart['aggregation'] not in ('sum', 'count', 'mean') or
                    any(not isinstance(chart[k], str) or len(chart[k]) > limit for k, limit in
                        (('category_column', 100), ('title', 200), ('x_label', 100), ('y_label', 100))) or
                    (chart['value_column'] is not None and
                     (not isinstance(chart['value_column'], str) or len(chart['value_column']) > 100))):
                raise OperatorError('Invalid retained chart configuration')
            for field in ('base', 'proposal', 'export', 'pending', 'export_request'):
                if draft[field] is not None and not isinstance(draft[field], dict):
                    raise OperatorError('Invalid retained exact file binding')
        return state


class FileDraftSession:
    def __init__(self, store):
        self.store = store
        self.state = store.load() or {'selected': '__new__', 'drafts': {'__new__': new_file_draft()}}
        self.store.save(self.state)
        self.durable = copy.deepcopy(self.state)

    @property
    def draft(self):
        return self.state['drafts'][self.state['selected']]

    def save(self):
        try:
            self.store.save(self.state)
        except OperatorError:
            self.state = copy.deepcopy(self.durable)
            raise
        self.durable = copy.deepcopy(self.state)

    def edit(self, **values):
        if any(self.draft[k] != v for k, v in values.items()):
            self.draft.update(copy.deepcopy(values))
            self.draft['generation'] += 1
            self.save()

    def select(self, key, *, initial=None):
        if key not in self.state['drafts']:
            self.state['drafts'][key] = copy.deepcopy(initial or new_file_draft())
        self.state['selected'] = key
        self.save()
