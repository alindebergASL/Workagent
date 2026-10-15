"""Guard current authority and evidence boundaries, never historical readiness wording."""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def section(path, heading, end_heading):
    text = (ROOT / path).read_text()
    return text.split(heading, 1)[1].split(end_heading, 1)[0]


def normalized(text):
    return " ".join(text.replace("**", "").split())


@pytest.mark.parametrize("name", ["PRODUCT_CONTRACT", "BUILD_PLAN", "WORK_CONTRACT", "PRODUCT_ACCEPTANCE"])
def test_each_canonical_contract_preserves_current_authority_and_evidence_scope(name):
    current = normalized(section(f"docs/{name}.md", "## Current delivery state", "\n## "))
    for boundary in [
        "#15", "does not establish broad product readiness",
        "Historical reports retain their original scope, failures and verdicts",
        "GENERAL_MODEL_AUTHORIZATION.md", "RUNTIME_STATUS.md",
        "Budget headroom is never independent authority", "no default merge/deployment",
        "external business", "expanded account/private-data access",
        "general agency", "extensible skills/tools", "scoped context/memory",
        "durable continuity", "authorized initiative", "optional Spaces", "Intelligent UI",
        "controlled engineering",  # Checked without case/format dependence below.
    ]:
        assert boundary.lower() in current.lower(), boundary
    # Current status must not falsely erase the already installed first slice.
    assert "prior live allowance is exhausted" not in current
    assert "Latest integrated candidate" in current


def test_current_authorization_preserves_cumulative_authority_not_old_slice_ceiling():
    current = normalized(section(
        "docs/GENERAL_MODEL_AUTHORIZATION.md", "## Current execution boundary",
        "## Prior execution boundary",
    ))
    for boundary in [
        "$40 cumulative ceiling", "not another $40", "bounded synthetic development",
        "existing approved model route", "per-run and aggregate accounting",
        "historical usage, reservations, unknown liabilities", "grant/attempt bindings",
        "Frozen failures stay frozen", "post-fix development tests are permitted",
        "Never silently replace", "repeat an unknown external request",
        "New paid routes", "private-account/data access", "external business effects",
        "default-branch merging", "production replacement", "STATUS.md",
        "not a project-wide stop",
    ]:
        assert boundary in current, boundary
    assert "NOT INSTALLED" not in current


@pytest.mark.parametrize(
    "path, heading",
    [
        ("docs/BUILD_PLAN.md", "## Execution boundary"),
        ("docs/PRODUCT_ACCEPTANCE.md", "## Live gate and release"),
    ],
    ids=["build-execution-boundary", "acceptance-live-gate"],
)
def test_each_active_execution_section_requires_existing_grant_activation(path, heading):
    current = normalized(section(path, heading, "\n## "))
    for boundary in [
        "first added-budget slice was installed and used",
        "APPROVED FOR PREPARATION, NOT INSTALLED", "alpha evaluation",
        "GENERAL_MODEL_AUTHORIZATION.md", "Parent must read back",
        "activate only after exact-candidate deterministic checks and review pass",
        "fresh route/account/pricing verification", "durable per-run and aggregate bounds",
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
