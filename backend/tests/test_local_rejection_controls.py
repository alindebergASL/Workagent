"""Kind rejection preserves authority, legacy admission and publication guards."""
from types import SimpleNamespace

import pytest

from test_domain import context, cmd
from test_conversations import post
from test_flexible_edit_recovery import setup
from test_flexible_work import DraftProvider, publish, table
from test_general_responses import worker, totals
from test_local_rejection_settlement import readiness_document, journal
from workagent.adaptive import rejection_diagnostic
from workagent.errors import DomainError
from workagent.flexible_models import DraftObservation
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.models import HumanSave
from workagent.product_models import PublishArtifact
from workagent.products import Products


@pytest.mark.parametrize('reverse', [False, True])
def test_pure_kind_rejection_and_publication_guard(reverse):
    before, after = table(), readiness_document()
    if reverse:
        before, after = after, before
    saved = PublishArtifact(kind='publish_artifact', body=before)
    operation = PublishArtifact(kind='publish_artifact', body=after)
    base = SimpleNamespace(body=saved.body)
    products = Products()
    with pytest.raises(ValueError) as rejected:
        products._calculate_product(operation, base)
    assert rejection_diagnostic(rejected.value)['code'] == 'artifact_kind_rejected'
    # No DB or authority stub: the strict guard must fire before any writes.
    with pytest.raises(DomainError) as denied:
        products._publish_product(None, None, None, None, operation, base,
                                  operation.body, None, DraftObservation(), 'forged')
    assert denied.value.code.value == 'unsupported_operation'


def test_nonadaptive_kind_change_stays_fail_closed(context, tmp_path):
    s, p, ws, _, _ = context
    art, grant, q = setup(context, adaptive=False)
    fake = DraftProvider(readiness_document(), False)
    with pytest.raises(DomainError) as denied:
        worker(context, fake, tmp_path).work(p, ws, q.run.id)
    assert denied.value.code.value == 'unsupported_operation'
    assert ('selection', 'tool_result') not in journal(s, ws, q.run.id)
    assert totals(s, grant)['request_counts']['dispatch'] == 1
    assert s.get_artifact(p, ws, art.id).current_revision == art.current_revision
    assert not s.proposals(p, ws, art.id).items


def test_controlled_kind_change_stays_fail_closed(context):
    s, p, ws, _, _ = context
    cv, _, art = publish(context, table())
    with pytest.raises(DomainError) as denied:
        q = post(context, cv, 'Change the kind', operation={
            'kind': 'publish_artifact', 'body': readiness_document(),
            'artifact_id': art.id, 'base_revision_id': art.current_revision_id})
        GeneralWorker(s, transport=ControlledTransport()).work(p, ws, q.run.id)
    assert denied.value.code.value == 'unsupported_operation'
    assert s.get_artifact(p, ws, art.id).current_revision == art.current_revision
    assert not s.proposals(p, ws, art.id).items


def test_publication_rechecks_kind_after_forged_stage(context, tmp_path, monkeypatch):
    s, p, ws, _, _ = context
    art, grant, q = setup(context)
    fake = DraftProvider(readiness_document(), True)
    monkeypatch.setattr(s, '_calculate_product',
                        lambda operation, base: (operation.body, None, DraftObservation()))
    with pytest.raises(DomainError) as denied:
        worker(context, fake, tmp_path).work(p, ws, q.run.id)
    assert denied.value.code.value == 'unsupported_operation'
    assert s.get_artifact(p, ws, art.id).current_revision == art.current_revision
    assert not s.proposals(p, ws, art.id).items
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM product_observations '
                         'WHERE workspace_id=%s AND run_id=%s', (ws, q.run.id)).fetchone()['n'] == 0


@pytest.mark.parametrize('boundary', ['stale', 'revoked'])
@pytest.mark.parametrize('timing', ['before_retention', 'replay'])
def test_kind_rejection_revalidates_authority(context, tmp_path, monkeypatch, boundary, timing):
    from workagent.db import Database
    s, p, ws, _, admin = context
    art, grant, q = setup(context)
    fake = DraftProvider(readiness_document(), True)

    def change_authority():
        if boundary == 'stale':
            body = art.current_revision.body.model_copy(deep=True)
            body.title = 'New human title'
            s.human_save(p, ws, art.id, cmd(HumanSave,
                expected_current_revision_id=art.current_revision_id, body=body))
        else:
            with Database(admin).transaction() as c:
                c.execute('UPDATE memberships SET active=false '
                          'WHERE workspace_id=%s AND principal_id=%s', (ws, p.id))

    original = s._calculate_product
    if timing == 'before_retention':
        def calculate(operation, base):
            change_authority()
            return original(operation, base)
        monkeypatch.setattr(s, '_calculate_product', calculate)
    else:
        def hook(point):
            if point == 'after_tool_result':
                raise RuntimeError('interrupt after retained kind rejection')
        with pytest.raises(RuntimeError, match='interrupt after retained'):
            worker(context, fake, tmp_path, hook=hook).work(p, ws, q.run.id)
        retained = journal(s, ws, q.run.id)
        assert retained['selection', 'tool_result']['status'] == 'rejected'
        change_authority()

    with pytest.raises(DomainError) as denied:
        worker(context, fake, tmp_path).work(p, ws, q.run.id)
    assert denied.value.code.value in ('source_changed', 'version_conflict', 'not_found_or_not_authorized')
    after = journal(s, ws, q.run.id)
    if timing == 'before_retention':
        assert ('selection', 'tool_result') not in after
    else:
        assert after == retained
    assert totals(s, grant)['request_counts']['dispatch'] == 1
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM proposals WHERE workspace_id=%s '
                         'AND artifact_id=%s', (ws, art.id)).fetchone()['n'] == 0
