"""Narrow review regressions; PG tests require a real disposable restricted role."""
import asyncio
from datetime import timedelta
import pytest
import psycopg
from textual.app import App
from textual.widgets import Input, Select, TextArea
from test_domain import context, cmd, raises
from test_conversations import conversation
from test_memory_pg import remember, inspect
from test_tui_memory import MemoryHTTP
from workagent.models import now, new_id
from workagent.service import encoded
from workagent.memory.models import CorrectMemory, ReviewMemory
from workagent.operator_journal import OperatorError
from workagent.tui.memory_screen import MemoryScreen


@pytest.mark.parametrize('decision', ['accept', 'dispute'])
def test_review_exception_keeps_base_and_interval(context, decision):
    s, p, ws, _, _ = context
    cv = conversation(context)
    start = now() + timedelta(days=1)
    end = start + timedelta(days=7)
    base, _ = remember(context, cv, content='Ten minutes', valid_from=now()-timedelta(days=1))
    exception = s.correct_memory(p, ws, base.memory_id, cmd(CorrectMemory,
        expected_revision_id=base.revision_id, content='Five minutes', mode='temporary',
        valid_from=start, valid_until=end))
    reviewed = s.review_memory(p, ws, base.memory_id, cmd(ReviewMemory,
        expected_revision_id=exception.revision_id, decision=decision))
    current = inspect(context, reviewed).current
    assert current.exception_to_revision_id == base.revision_id
    assert current.supersedes_revision_id == exception.revision_id
    for at, text in [(start-timedelta(seconds=1), 'Ten minutes'), (start, 'Five minutes'), (end, 'Ten minutes')]:
        with s.db.transaction() as c:
            s._scope(c, p, ws)
            item = s._recall_memory(c, p, ws, cv.id, at=at).items[0]
            assert item.revision.content == text
            assert item.unresolved_conflict == (decision == 'dispute' and at == start)
    # SQL callers cannot silently detach a reviewed exception or alter its interval.
    for changes in [dict(exception_to_revision_id=None), dict(valid_until=(end+timedelta(days=1)).isoformat())]:
        forged = {**current.model_dump(mode='json'), **changes, 'revision_id': new_id(),
                  'supersedes_revision_id': current.revision_id}
        with pytest.raises(psycopg.Error), s.db.transaction() as c:
            c.execute('SELECT write_memory_revision(%s,%s,%s,%s,%s)',
                (ws, p.id, 'review', current.revision_id, encoded(forged)))
    # Rejecting only an exception is deliberately unsupported; expire is whole-item.
    raises('action_unresolved', lambda: s.review_memory(p, ws, base.memory_id,
        cmd(ReviewMemory, expected_revision_id=current.revision_id, decision='reject')))


@pytest.mark.parametrize('loss', ['denied', 'forgotten', 'history_denied', 'not_in_page'])
def test_native_refresh_reauthorizes_inspected_payload(loss):
    class Client(MemoryHTTP):
        changed = False
        def request(self, path, body=None):
            if self.changed and body is None:
                if '/memory?' in path:
                    return dict(items=[], has_more=True)
                if loss == 'denied':
                    raise OperatorError('not_found_or_not_authorized')
                if loss == 'forgotten':
                    self.current.update(status='forgotten', content=None, subject_key=None,
                        predicate_key=None, confidence_basis=None, applicability=None)
            result = super().request(path, body)
            if loss == 'history_denied' and not self.changed and 'revisions' in result:
                result['revisions'].insert(0, {**self.current, 'revision_id': 'old-work-area-revision',
                    'content': 'Revocable old project text'})
            return result
    async def check():
        client = Client()
        screen = MemoryScreen(client, 'ws-a', 'human-a', 'task-a')
        app = App()
        async with app.run_test(size=(80, 35)) as pilot:
            app.push_screen(screen)
            await pilot.pause(.2)
            screen.query_one('#memory-list', Select).value = 'memory-a'
            await screen.perform('inspect')
            assert screen.controller.selected
            screen.query_one('#memory-content', TextArea).load_text('Unsent correction')
            client.changed = True
            await screen.perform('refresh')
            if loss == 'not_in_page':
                assert screen.controller.selected['current']['revision_id'] == 'r1'
                assert screen.query_one('#memory-content', TextArea).text == 'Unsent correction'
            else:
                assert screen.controller.selected is None
                for field in ('content', 'details', 'usage'):
                    assert screen.query_one('#memory-'+field, TextArea).text == ''
                assert screen.query_one('#memory-subject', Input).value == ''
    asyncio.run(check())
