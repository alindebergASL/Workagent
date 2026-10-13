"""Product-direction guardrails, not evidence of implemented adaptive UI."""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize('name', ['PRODUCT_CONTRACT', 'WORK_CONTRACT', 'BUILD_PLAN', 'PRODUCT_ACCEPTANCE'])
def test_adaptive_ui_direction_preserves_scope_and_authority_in_each_contract(name):
    text = (ROOT / 'docs' / f'{name}.md').read_text()
    assert '## Adaptive, intelligent UI' in text
    current = ' '.join(text.split('## Adaptive, intelligent UI', 1)[1].split('\n## ', 1)[0].split())
    for requirement in ['required direction', 'not implementation evidence',
                        'no new permissions', 'no new live-evaluation budget',
                        'no default merge or deployment authority']:
        assert requirement in current, (name, requirement)


def test_reference_is_user_direction_not_a_capability_or_workflow_ceiling():
    text = (ROOT / 'docs/PRODUCT_CONTRACT.md').read_text()
    for exact_user_requirement in [
        'ChatGPT’s Intelligent UI is a key interaction reference for WorkAgent.',
        'Simple answers must remain simple',
        'A generated button is not evidence that its action exists.',
        'Keep skills, tools and presentation components separately extensible.',
        'This strengthens the existing broad mission; it does not replace it with a UI-only milestone.',
    ]:
        assert exact_user_requirement in text


def test_acceptance_exercises_authority_continuity_and_effort_not_richness():
    text = ' '.join((ROOT / 'docs/PRODUCT_ACCEPTANCE.md').read_text().split())
    for requirement in ['keyboard', 'screen-reader', 'active inputs', 'reopen',
                        'same authoritative work', 'lost acknowledgement',
                        'permission revocation', 'less effort', 'unfamiliar combinations',
                        'illustrative examples', 'NOT TESTED']:
        assert requirement in text, requirement


def test_build_sequence_preserves_owners_current_blockers_and_product_breadth():
    text = ' '.join((ROOT / 'docs/BUILD_PLAN.md').read_text().split())
    for requirement in ['Hermes', 'Claude', 'existing runtime and frontend',
                        'current review blockers', 'not a disconnected prototype',
                        'not a UI-only milestone', 'no required dashboard request']:
        assert requirement in text, requirement
