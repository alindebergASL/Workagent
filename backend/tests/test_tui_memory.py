"""Native memory controller/offscreen checks; transport fixtures, not PG evidence."""
import asyncio
import copy
import pytest
from textual.app import App
from textual.widgets import Input, Select, TextArea
from workagent.operator_journal import OperatorError
from workagent.tui.memory import MemoryController
from workagent.tui.memory_screen import MemoryScreen


class MemoryHTTP:
    base = 'http://127.0.0.1:9000'
    def __init__(self):
        self.principal = 'human-a'
        self.posts = []
        self.receipts = {}
        self.lost_ack = False
        self.current = dict(memory_id='memory-a', revision_id='r1', workspace_id='ws-a', owner_id='human-a',
            kind='preference', scope_kind='task', scope_id='task-a', subject_key='writing', predicate_key='style',
            content='Use concise headings', status='active', confidence_basis='Explicit human statement', applicability='', source_refs=[])

    def identity(self, ws):
        return self.principal

    def request(self, path, body=None):
        if body is not None:
            self.posts.append((path, copy.deepcopy(body)))
            key = body['command_id']
            if key not in self.receipts:
                self.current['revision_id'] = 'r2'
                if path.endswith('/forget'):
                    self.current.update(content=None, subject_key=None, predicate_key=None, confidence_basis=None,
                                        applicability=None, status='forgotten')
                elif 'content' in body:
                    self.current['content'] = body['content']
                self.receipts[key] = {k: self.current[k] for k in ('memory_id', 'revision_id', 'status')}
            if self.lost_ack:
                self.lost_ack = False
                raise OperatorError('lost acknowledgement')
            return copy.deepcopy(self.receipts[key])
        if '/memory?' in path:
            return dict(items=[dict(revision=copy.deepcopy(self.current), why='task', unresolved_conflict=False)], has_more=False)
        return dict(current=copy.deepcopy(self.current), revisions=[copy.deepcopy(self.current)])


def test_exact_unknown_replay_retains_cas_and_rejects_new_write():
    client = MemoryHTTP()
    ctrl = MemoryController(client, 'ws-a', 'human-a', 'task-a')
    ctrl.inspect('memory-a')
    envelope = ctrl.prepare('correct', content='Use full headings', mode='permanent')
    client.lost_ack = True
    with pytest.raises(OperatorError, match='lost'):
        ctrl.send()
    assert ctrl.pending['state'] == 'outcome_unknown'
    with pytest.raises(OperatorError, match='pending'):
        ctrl.prepare('correct', content='different')
    with pytest.raises(OperatorError, match='Unknown'):
        ctrl.resolve_rejection()
    ctrl.send()
    assert client.posts[0] == client.posts[1]
    assert client.posts[0][1]['expected_revision_id'] == 'r1'
    assert envelope['body']['command_id'] == client.posts[1][1]['command_id']
    assert ctrl.pending is None and ctrl.selected is None


def test_identity_change_cannot_replay_or_inspect():
    client = MemoryHTTP()
    ctrl = MemoryController(client, 'ws-a', 'human-a', 'task-a')
    ctrl.inspect('memory-a')
    ctrl.prepare('forget')
    client.principal = 'different-human'
    with pytest.raises(OperatorError, match='scope changed'):
        ctrl.send()
    assert not client.posts and ctrl.selected is None


def test_scope_id_defaults_and_forget_clears_payload():
    async def check():
        client = MemoryHTTP()
        screen = MemoryScreen(client, 'ws-a', 'human-a', 'task-a')
        app = App()
        async with app.run_test(size=(100, 45)) as pilot:
            app.push_screen(screen)
            await pilot.pause(.15)
            assert screen.query_one('#memory-scope-id', Input).value == 'task-a'
            screen.query_one('#memory-list', Select).value = 'memory-a'
            await screen.perform('inspect')
            assert screen.query_one('#memory-content', TextArea).text == 'Use concise headings'
            with pytest.raises(OperatorError, match='Confirm'):
                screen.fields('forget')
            screen.controller.prepare('forget')
            await screen.perform('replay')
            assert screen.controller.pending is None
            assert 'Use concise headings' not in screen.query_one('#memory-details', TextArea).text
            assert screen.query_one('#memory-content', TextArea).text == ''
            screen.query_one('#memory-scope', Select).value = 'user'
            await pilot.pause()
            assert screen.query_one('#memory-scope-id', Input).value == 'human-a'
    asyncio.run(check())
