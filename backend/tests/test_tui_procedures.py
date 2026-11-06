"""Offscreen native lesson fields/journal; actual PTY/HTTP proof is separate."""
import asyncio
import copy
import pytest
from textual.app import App
from textual.widgets import Input, Select, TextArea
from workagent.operator_journal import OperatorError
from workagent.tui.memory_screen import MemoryScreen
from test_tui_memory import MemoryHTTP


EVIDENCE = dict(kind='human_message', conversation_id='task-a', event_id='observed-correction', sha256='a'*64)
DETAILS = dict(evidence=[EVIDENCE], retrieval_terms=['duration'], excluded_terms=['legacy v1'],
               counterexamples=['Check current units; missing is not zero'], validation_notes='Observed correction, not causal benefit')


class LessonHTTP(MemoryHTTP):
    def request(self, path, body=None):
        if '/lesson-evidence?' in path:
            return dict(items=[dict(evidence=copy.deepcopy(EVIDENCE), label='Human statement: correct units', outcome='human_statement')])
        return super().request(path, body)


def test_native_proposal_evidence_inspection_rollback_and_clear():
    async def check():
        client = LessonHTTP()
        screen = MemoryScreen(client, 'ws-a', 'human-a', 'task-a')
        app = App()
        async with app.run_test(size=(100, 50)) as pilot:
            app.push_screen(screen)
            await pilot.pause(.2)
            with pytest.raises(OperatorError, match='observed evidence'):
                screen.fields('candidates')
            await screen.perform('evidence')
            screen.query_one('#memory-evidence-list', Select).value = '0'
            for key, value in [('terms','duration, sample mean'), ('excluded','legacy v1'), ('counterexamples','Missing is not zero | Check current units'), ('validation','Observed correction; no causal claim'), ('subject','analysis'), ('predicate','units'), ('basis','Human correction'), ('applicability','Duration summaries')]:
                screen.query_one('#memory-'+key, Input).value = value
            screen.query_one('#memory-content', TextArea).load_text('Inspect units and denominator before calculating')
            proposal = screen.fields('candidates')
            assert proposal['kind'] == 'procedure'
            assert proposal['procedure']['evidence'] == [EVIDENCE]
            assert proposal['procedure']['retrieval_terms'] == ['duration','sample mean']
            assert 'status' not in proposal and 'origin' not in proposal
            client.current.update(kind='procedure', procedure=DETAILS, origin='human_reviewed', reviewed_by_principal_id='human-a', revision_id='r2')
            earlier = dict(client.current, revision_id='r1', content='Earlier adopted lesson')
            candidate = dict(client.current, revision_id='r0', status='candidate', origin='agent_inferred')
            earlier['status'] = 'superseded'
            detail = dict(current=copy.deepcopy(client.current), revisions=[candidate, earlier, copy.deepcopy(client.current)], rollback_revision_ids=['r1'])
            screen.controller.selected = detail
            screen.show_detail(detail)
            target = screen.query_one('#memory-rollback-target', Select)
            target.value = 'r1'
            command = screen.controller.prepare('rollback', **screen.fields('rollback'))
            assert command['body']['expected_revision_id'] == 'r2'
            assert command['body']['target_revision_id'] == 'r1'
            assert screen.fields('correct')['procedure']['evidence'] == [EVIDENCE]
            screen.clear_payload()
            assert not screen.evidence_options and screen.inspected_procedure is None
            assert not screen.query_one('#memory-validation', Input).value
            assert 'Earlier adopted' not in screen.query_one('#memory-details', TextArea).text
            screen.controller.pending = None
    asyncio.run(check())
