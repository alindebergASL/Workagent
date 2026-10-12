"""Pure guidance regressions, not proof of generated-view/UI compliance."""
import importlib
import re

import pytest

from workagent.flexible_policy import FLEXIBLE_POLICY


def test_saved_and_temporary_criteria_have_separate_visible_labels():
    assert 'distinguish original saved-assessment criteria from temporary/current filter criteria' in FLEXIBLE_POLICY
    assert 'Display these criteria separately with clear labels' in FLEXIBLE_POLICY
    assert 'Label filter controls as temporary/current filters, not changes to the original task' in FLEXIBLE_POLICY


def test_saved_assessment_label_is_adjacent_to_every_display():
    assert 'Label each displayed saved assessment adjacent to its text' in FLEXIBLE_POLICY
    assert 'including row/card/detail displays' in FLEXIBLE_POLICY
    assert 'identify its original criteria there (or explicitly say they are unknown)' in FLEXIBLE_POLICY
    assert 'a distant page-level notice alone is insufficient' in FLEXIBLE_POLICY


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


def test_assessment_guidance_is_generic_without_fixture_amounts():
    guidance = FLEXIBLE_POLICY.split('\n\nGenerated views', 1)[1]
    assert 'Never hardcode fixture-specific criteria or amounts' in guidance
    assert not re.search(r'\d|[$£€]', guidance)


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
