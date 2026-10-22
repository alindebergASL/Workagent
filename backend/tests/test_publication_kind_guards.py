"""Exercise selected/staged publication kind guards independently."""
from types import SimpleNamespace

import pytest

from test_flexible_work import table
from test_local_rejection_settlement import readiness_document
from workagent.errors import DomainError
from workagent.flexible_models import DraftObservation
from workagent.product_models import PublishArtifact
from workagent.products import Products


@pytest.mark.parametrize('reverse', [False, True])
@pytest.mark.parametrize('mismatch', ['selected', 'staged'])
def test_each_publication_kind_guard(reverse, mismatch):
    before, different = table(), readiness_document()
    if reverse:
        before, different = different, before
    base_body = PublishArtifact(kind='publish_artifact', body=before).body
    other_body = PublishArtifact(kind='publish_artifact', body=different).body
    selected = other_body if mismatch == 'selected' else base_body
    staged = other_body if mismatch == 'staged' else base_body
    operation = PublishArtifact(kind='publish_artifact', body=selected)
    # No usable DB: refusal must occur before any publication side effect.
    with pytest.raises(DomainError) as denied:
        Products()._publish_product(None, None, None, None, operation,
                                    SimpleNamespace(body=base_body), staged,
                                    None, DraftObservation(), 'forged')
    assert denied.value.code.value == 'unsupported_operation'
