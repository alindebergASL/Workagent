"""A bounded continuity stop must publish retained work, not loop on validation."""
import pytest
from test_domain import context
from test_conversations import conversation, post
from test_sustained_continuity import activate, draft
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker, totals
from test_adaptive_execution import finish_safe_visits


@pytest.mark.parametrize('outcome', ['blocked', 'waiting_for_user', 'step_limit'])
def test_continuity_stop_publishes_draft_and_replays_without_new_sends(context, tmp_path, outcome):
    s, p, ws, _, _ = context
    cv = conversation(context)
    grant = activate(context, cv, max_steps=1 if outcome == 'step_limit' else 3)
    request = post(context, cv, 'Prepare an editable note and stop honestly if more work needs my input.')
    decisions = [draft('Retained preparation')]
    if outcome != 'step_limit':
        decisions.append(dict(kind='stop', outcome=outcome, text='The draft is retained; an owner decision is still required.'))
    fake = AlphaProvider(decisions, explanation='A preparation draft exists, not a completed external outcome.')
    w = worker(context, fake, tmp_path)
    run = finish_safe_visits(context, w, request.run.id)
    assert run.state == 'partial' and run.stop_reason == outcome
    detail = s.get_conversation(p, ws, cv.id)
    assert len(detail.artifact_ids) == 1
    assert detail.messages[-1].author_kind == 'assistant'
    assert detail.messages[-1].model_receipt is not None
    assert len(detail.messages[-1].result.results) == 2
    saved = s.get_artifact(p, ws, detail.artifact_ids[0])
    assert saved.current_revision.body.title == 'Retained preparation'
    calls, budget = list(fake.calls), totals(s, grant)
    replay = worker(context, fake, tmp_path).work(p, ws, run.id)
    assert replay.state == 'partial' and replay.stop_reason == outcome
    assert fake.calls == calls and totals(s, grant) == budget
    assert s.get_conversation(p, ws, cv.id) == detail
    assert s.get_artifact(p, ws, detail.artifact_ids[0]).current_revision == saved.current_revision
