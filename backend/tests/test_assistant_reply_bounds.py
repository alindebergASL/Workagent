"""Pure DTO regression: model-valid replies survive durable serialization intact."""
import pytest
from pydantic import TypeAdapter, ValidationError

from workagent.general_schema import GeneralExplanation, Reply
from workagent.composition import publication_text
from workagent.model_base import Text
from workagent.models import ConversationMessage, PostMessage, TextResult, TurnResult


def message(text, author_kind='assistant', **kwargs):
    provenance = dict(author_id='general-worker', evidence_origin='controlled_transport')
    if author_kind == 'human':
        provenance = dict(author_id='human', evidence_origin='human')
    elif author_kind == 'system':
        provenance = dict(author_id='responsibility-runtime', evidence_origin='runtime',
                          responsibility_origin=dict(assignment_id='assignment', wake_id='wake', work_version=1))
    return ConversationMessage(id='message', conversation_id='conversation', run_id='run',
                               sequence=1, author_kind=author_kind, text=text, **provenance, **kwargs)


@pytest.mark.parametrize('length', [10000, 10001, 12000])
@pytest.mark.parametrize('dto', ['result', 'message'])
def test_schema_valid_assistant_text_roundtrips_intact(length, dto):
    text = 'é' * (length - 2) + '\n終'
    assert Reply(kind='reply', text=text).text == text
    assert GeneralExplanation(text=text).text == text
    value = TextResult(text=text) if dto == 'result' else message(text)
    assert type(value).model_validate_json(value.model_dump_json()).text == text


def test_nested_durable_turn_roundtrips_maximum_reply():
    text = 'x' * 12000
    value = message(text, result=TurnResult(results=[TextResult(text=text)]))
    saved = ConversationMessage.model_validate_json(value.model_dump_json())
    assert saved.text == saved.result.results[0].text == text


@pytest.mark.parametrize('length', [10001, 12000])
def test_answered_publication_uses_full_reply_without_truncation(length):
    reply = Reply(kind='reply', text='x' * length)
    text = publication_text(dict(terminal_outcome='answered', decision=reply.model_dump()),
                            GeneralExplanation(text='Separate final explanation.').text)
    saved = message(text, result=TurnResult(results=[TextResult(text=text)]))
    assert saved.text == saved.result.results[0].text == reply.text


@pytest.mark.parametrize('length', [0, 12001])
@pytest.mark.parametrize('factory', [TextResult, GeneralExplanation,
                                   lambda text: Reply(kind='reply', text=text), message])
def test_assistant_text_rejects_outside_schema_bounds(length, factory):
    with pytest.raises(ValidationError):
        factory(text='x' * length)


@pytest.mark.parametrize('author_kind', ['human', 'system'])
def test_stored_non_assistant_text_keeps_original_bound(author_kind):
    assert message('x' * 10000, author_kind).text == 'x' * 10000
    with pytest.raises(ValidationError):
        message('x' * 10001, author_kind)


def test_human_post_and_shared_text_keep_original_bound():
    data = dict(schema_version='workagent/v1', request_id='request', command_id='command',
                expected_work_version=1)
    assert PostMessage(text='x' * 10000, **data).text == 'x' * 10000
    assert TypeAdapter(Text).validate_python('x' * 10000) == 'x' * 10000
    with pytest.raises(ValidationError):
        PostMessage(text='x' * 10001, **data)
    with pytest.raises(ValidationError):
        TypeAdapter(Text).validate_python('x' * 10001)


def test_assignment_cannot_widen_non_assistant_text():
    value = message('x' * 10000, 'human')
    with pytest.raises(ValidationError):
        value.text = 'x' * 10001
    assert value.text == 'x' * 10000


def test_author_assignment_cannot_reclassify_oversized_reply():
    value = message('x' * 12000)
    with pytest.raises(ValidationError):
        value.author_kind = 'human'
    assert value.author_kind == 'assistant'
    assert value.text == 'x' * 12000
