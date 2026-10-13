"""Guard load-bearing current docs, not product/runtime acceptance evidence."""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def section(path, heading, end_heading):
    text = (ROOT / path).read_text()
    return text.split(heading, 1)[1].split(end_heading, 1)[0]


@pytest.mark.parametrize("name", ["PRODUCT_CONTRACT", "BUILD_PLAN", "WORK_CONTRACT", "PRODUCT_ACCEPTANCE"])
def test_each_canonical_contract_preserves_current_authority_and_evidence_scope(name):
    current = section(f"docs/{name}.md", "## Current delivery state", "\n## ")
    assert "#15" in current
    assert "does not establish broad product readiness" in current
    assert "Historical reports retain their original scope, failures and verdicts" in current
    assert "prior live allowance is exhausted" in current
    assert "not yet activated" in current
    assert "GENERAL_MODEL_AUTHORIZATION.md" in current
    assert "Budget headroom is never independent authority" in current
    assert "no default merge/deployment" in current
    assert "external business" in current
    assert "expanded account/private-data access" in current


def test_current_authorization_retains_every_independent_bound_and_activation_gate():
    current = section("docs/GENERAL_MODEL_AUTHORIZATION.md", "## Current execution boundary", "## Historical approvals")
    for boundary in [
        "10 runs", "4 selection steps + one final response per run", "30 generation",
        "30 token-count requests", "280 same-ID retrievals", "600,000 input / 245,760 output",
        "$4 additional reservation ceiling", "$20 cumulative ceiling", "$5.93640 reserved",
        "$3.42992 carry", "Original count-only unknown retained", "Failed attempts count",
        "no silent replacement generation", "store:true", "NOT INSTALLED",
        "deterministic checks", "pricing verification is mandatory", "No child or frontend handoff may spend",
        "account/business", "expanded private-data access", "default merge or deployment",
    ]:
        assert boundary in current, boundary


@pytest.mark.parametrize(
    "path, heading",
    [
        ("docs/BUILD_PLAN.md", "## Execution boundary"),
        ("docs/PRODUCT_ACCEPTANCE.md", "## Live gate and release"),
    ],
    ids=["build-execution-boundary", "acceptance-live-gate"],
)
def test_each_active_execution_section_requires_existing_grant_activation(path, heading):
    current = " ".join(section(path, heading, "\n## ").split())
    for boundary in [
        "APPROVED, NOT INSTALLED",
        "alpha evaluation",
        "GENERAL_MODEL_AUTHORIZATION.md",
        "Parent must read back",
        "activate only after exact-candidate deterministic checks and review pass",
        "fresh route/account/pricing verification",
        "durable per-run and aggregate bounds",
        "all inherited reservations and unknown liabilities",
        "Request fresh authority only for scope expansion or an exhausted bound",
    ]:
        assert boundary in current, boundary
    assert "request one consolidated" not in current
    assert "requires a new consolidated grant before" not in current


def test_product_keeps_broad_agency_optional_methods_and_authoritative_work():
    text = (ROOT / "docs/PRODUCT_CONTRACT.md").read_text()
    assert "including unfamiliar combinations" in text
    assert "optional skills, never mandatory flows" in text
    assert "Neither skill text nor available tools grant permission" in text
    assert "Memory\nsupplies scoped context, never competing authoritative commitments" in text
    assert "a paused handover is not ownership" in text
