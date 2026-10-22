"""Controlled publication regression; requires disposable PostgreSQL, no provider."""
import pytest

from test_domain import context
from test_conversations import conversation, post
from workagent.general_schema import GeneralExplanation
from workagent.general_worker import ControlledTransport, GeneralWorker
from workagent.service import Service


@pytest.mark.parametrize('length', [10001, 12000])
def test_controlled_long_reply_persists_intact_and_replay_does_not_regenerate(context, length):
    service, principal, workspace, _, _ = context
    queued = post(context, conversation(context))
    text = GeneralExplanation(text='é' * (length - 1) + '終').text
    transport = ControlledTransport([dict(results=[dict(kind='text', text=text)])])
    worker = GeneralWorker(service, transport=transport)
    assert worker.work(principal, workspace, queued.run.id).state == 'ready'
    reader = Service(service.db)
    detail = reader.get_conversation(principal, workspace, queued.conversation.id)
    replies = [m for m in detail.messages if m.author_kind == 'assistant']
    assert len(replies) == 1
    assert replies[0].text == replies[0].result.results[0].text == text
    assert worker.work(principal, workspace, queued.run.id).state == 'ready'
    assert transport.calls == 1
    assert reader.get_conversation(principal, workspace, queued.conversation.id).messages == detail.messages


@pytest.mark.parametrize('length', [10001, 12000])
def test_receipted_long_reply_persists_intact_without_resend(context, tmp_path, length):
    import json
    import httpx
    from test_general_responses import activate, Provider, worker, totals
    service, principal, workspace, _, _ = context
    cv = conversation(context)
    grant = activate(context, [cv])
    text = 'é' * (length - 1) + '終'
    class LongReplyProvider(Provider):
        def handle(self, request):
            response = super().handle(request)
            if request.method == 'POST' and request.url.path.endswith('/responses'):
                data = response.json()
                if json.loads(request.content)['metadata']['step_id'] == 'final':
                    data['output'][0]['content'][0]['text'] = json.dumps({'text': text}, ensure_ascii=False)
                else:
                    data['output'][0]['arguments'] = json.dumps({'decision': {'kind': 'reply', 'text': text}}, ensure_ascii=False)
                self.responses[data['id']] = data
                return httpx.Response(200, json=data)
            return response
    provider = LongReplyProvider()
    queued = post(context, cv, 'Return the synthetic long reply.')
    runner = worker(context, provider, tmp_path)
    assert runner.work(principal, workspace, queued.run.id).state in ('ready', 'partial')
    reader = Service(service.db)
    detail = reader.get_conversation(principal, workspace, cv.id)
    replies = [m for m in detail.messages if m.author_kind == 'assistant']
    assert len(replies) == 1
    assert replies[0].text == replies[0].result.results[0].text == text
    calls, accounting = list(provider.calls), totals(service, grant)
    assert accounting['unknown_usage_steps'] == 0
    runner.work(principal, workspace, queued.run.id)
    assert provider.calls == calls and totals(service, grant) == accounting
    assert reader.get_conversation(principal, workspace, cv.id).messages == detail.messages
