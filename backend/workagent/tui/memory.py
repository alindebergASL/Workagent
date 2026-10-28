"""Private scoped-memory HTTP controller. Payloads are not cached on disk.

A failed mutation retains its exact envelope in this screen, never auto-retries.
Human review and correction always use the revision actually inspected.
"""
import copy
from urllib.parse import urlencode
from uuid import uuid4

from ..operator_client import identifier
from ..operator_journal import OperatorError, DomainRejection


class MemoryController:
    def __init__(self, client, workspace, principal, conversation):
        self.client = client
        self.endpoint = client.base
        self.workspace = identifier(workspace)
        self.principal = identifier(principal)
        self.conversation = identifier(conversation)
        self.root = '/' + self.workspace + '/memory'
        self.selected = None
        self.pending = None
        self.receipt = None

    def authorize(self):
        if (self.client.base != self.endpoint
                or self.client.identity(self.workspace) != self.principal):
            self.selected = None
            raise OperatorError('Authenticated memory scope changed; reconnect')

    def listing(self, status=None):
        self.authorize()
        fields = {'conversation_id': self.conversation}
        if status:
            fields['status'] = status
        return self.client.request(self.root + '?' + urlencode(fields))

    def inspect(self, memory_id):
        self.authorize()
        result = self.client.request(self.root + '/' + identifier(memory_id))
        self.selected = result
        return result

    def prepare(self, action, **fields):
        """Prepare against the revision inspected, not a later list refresh."""
        if self.pending:
            raise OperatorError('Resolve the pending memory command before another write')
        self.authorize()
        key = str(uuid4())
        body = dict(schema_version='workagent/v1', request_id=key, command_id=key, **fields)
        if action in ('remember', 'candidates'):
            path = self.root + '/' + action
        else:
            if not self.selected:
                raise OperatorError('Inspect the exact memory before changing it')
            current = self.selected['current']
            path = self.root + '/' + identifier(current['memory_id']) + '/' + action
            body['expected_revision_id'] = current['revision_id']
        self.pending = dict(path=path, body=copy.deepcopy(body), state='prepared')
        self.receipt = None
        return copy.deepcopy(self.pending)

    def send(self):
        self.authorize()
        if not self.pending:
            raise OperatorError('No pending memory command')
        if self.pending['state'] == 'rejected':
            raise OperatorError('Command rejected; refresh before preparing a new command')
        first = self.pending['state'] == 'prepared'
        self.pending['state'] = 'outcome_unknown'
        try:
            receipt = self.client.request(self.pending['path'], copy.deepcopy(self.pending['body']))
        except DomainRejection:
            if first:
                self.pending['state'] = 'rejected'
            raise
        self.receipt = receipt
        self.pending = None
        # Never retain a forgotten payload in the screen controller.
        self.selected = None
        return receipt

    def reauthorize_selected(self):
        """Recheck the exact item; absence from a bounded list is not erasure.

        Keep the inspected CAS base and unsent draft on successful readback.
        """
        if not self.selected:
            return True
        current = self.selected['current']
        try:
            self.authorize()
            fresh = self.client.request(self.root + '/' + identifier(current['memory_id']))
        except OperatorError:
            self.selected = None
            raise
        authorized_ids = {r['revision_id'] for r in fresh['revisions']}
        retained_ids = {r['revision_id'] for r in self.selected['revisions']}
        # Details includes history, so every retained revision needs reauthorization.
        # Clearing also fences stale forms; successful refresh never rebases CAS.
        if (fresh['current']['status'] == 'forgotten' or
                current['revision_id'] not in authorized_ids or
                not retained_ids.issubset(authorized_ids)):
            self.selected = None
            return False
        return True

    def resolve_rejection(self):
        if not self.pending or self.pending['state'] != 'rejected':
            raise OperatorError('Unknown outcome requires exact replay, not a new command')
        self.pending = None
        self.selected = None

    def usage(self, run_id):
        self.authorize()
        return self.client.request('/' + self.workspace + '/runs/' + identifier(run_id) + '/memory-usage')
