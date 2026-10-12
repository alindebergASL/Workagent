"""Pure guidance regressions, not proof of generated-view/UI compliance."""
import importlib
import re

import pytest

from workagent.flexible_policy import FLEXIBLE_POLICY


def test_saved_and_temporary_criteria_have_separate_visible_labels():
    assert 'distinguish original saved-assessment criteria from temporary/current filter criteria' in FLEXIBLE_POLICY
    assert 'Display these criteria separately with clear labels' in FLEXIBLE_POLICY
    assert 'Label filter controls as temporary/current filters, not changes to the original task' in FLEXIBLE_POLICY


def test_saved_assessment_label_is_concise_and_adjacent_to_every_display():
    assert 'Label each displayed saved assessment adjacent to its text' in FLEXIBLE_POLICY
    assert 'including row/card/detail displays' in FLEXIBLE_POLICY
    assert 'concise saved/current labels' in FLEXIBLE_POLICY
    assert 'shared original-criteria summary' in FLEXIBLE_POLICY
    assert 'make clear which summary applies to each assessment' in FLEXIBLE_POLICY
    assert 'rather than repeating full criteria in every row' in FLEXIBLE_POLICY
    assert 'a distant page-level notice alone is insufficient' in FLEXIBLE_POLICY


def test_agent_chooses_proportionate_work_shape_without_fixed_artifact_sequence():
    assert 'Choose a proportionate supported work shape based on the user goal' in FLEXIBLE_POLICY
    assert 'no prescribed artifact sequence' in FLEXIBLE_POLICY
    assert 'do not require a table followed by a custom view' in FLEXIBLE_POLICY


def test_prose_corrections_preserve_meaningful_controls_and_ordinary_editing():
    assert 'When correcting prose, preserve meaningful user-adjustable controls and ordinary editing' in FLEXIBLE_POLICY
    assert 'do not replace useful interaction with static explanation' in FLEXIBLE_POLICY


def test_example_values_do_not_become_closed_options_by_default():
    assert 'Do not turn example or observed values into closed options unless the task requires a closed set' in FLEXIBLE_POLICY


def test_presentation_starts_with_result_or_useful_next_decision():
    assert 'Present the result or useful next decision first' in FLEXIBLE_POLICY


def test_optional_history_does_not_hide_material_context():
    assert 'Full historical prose may be placed in optional details' in FLEXIBLE_POLICY
    assert 'Keep material uncertainty, action consequences and human notes discoverable' in FLEXIBLE_POLICY
    assert 'surface decision-relevant caveats beside the result or action' in FLEXIBLE_POLICY


def test_unknown_original_criteria_stay_unknown_without_inference():
    assert 'Use original criteria only when explicitly recorded in the supplied saved context' in FLEXIBLE_POLICY
    assert 'If any original criterion is missing or ambiguous, show it as unknown' in FLEXIBLE_POLICY
    assert 'never infer it from saved assessment prose, row values, filter defaults or current controls' in FLEXIBLE_POLICY


def test_filter_changes_recompute_only_separately_labeled_local_match():
    assert 'When filters change, recompute only local match status from the bound data and current filters' in FLEXIBLE_POLICY
    assert 'label it as a local match against current filters, separate from the saved assessment' in FLEXIBLE_POLICY
    assert 'Missing data must remain unknown, not silently match or fail' in FLEXIBLE_POLICY


def test_filtering_neither_rewrites_saved_work_nor_claims_reassessment():
    assert 'Preserve the original task, saved criteria, saved assessment prose and human notes unchanged' in FLEXIBLE_POLICY
    assert 'Never imply that changing filters recomputes or updates the original task or saved assessment' in FLEXIBLE_POLICY
    assert 'Explain that filters affect only this temporary view and local match status' in FLEXIBLE_POLICY


def test_general_guidance_is_generic_without_fixture_values():
    guidance = FLEXIBLE_POLICY.split('\n\n', 1)[1]
    assert 'Never hardcode fixture-specific criteria or amounts' in guidance
    assert not re.search(r'\d|[$£€]', guidance)
    assert not re.search(r'\b(?:venue|repair|rainwater)\b', guidance, re.IGNORECASE)


@pytest.mark.parametrize('module', ['workagent.general_responses', 'workagent.adaptive'])
def test_both_generation_policies_include_the_shared_guidance(module):
    policy = importlib.import_module(module).POLICY
    assert policy.endswith(FLEXIBLE_POLICY)
    assert policy.count(FLEXIBLE_POLICY) == 1


def test_existing_sandbox_and_human_save_boundaries_remain():
    assert 'No fetch, credentials, provider, arbitrary target, save or approval action exists' in FLEXIBLE_POLICY
    assert 'Read actions return the exact saved document or structured table, not the latest replacement' in FLEXIBLE_POLICY
    assert 'Preserve stable identities and human work; changes become proposals, never accepted' in FLEXIBLE_POLICY
    assert 'Artifact creation is useful draft work, not verification' in FLEXIBLE_POLICY
    assert 'DOM state is ephemeral; durable changes use trusted shell human-save/proposal controls' in FLEXIBLE_POLICY
