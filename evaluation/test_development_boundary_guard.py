"""Synthetic unit tests, NOT verification of current checkout/runtime sources.

python3 -B evaluation/test_development_boundary_guard.py -v
Static representative snippets live in fixtures/development_boundary_sources.json;
mutations run in scratch. No worker/test imports, PG or provider I/O. Only the
separate guard CLI audits real checkout sources and reports missing anchors.
"""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
from unittest.mock import patch

try:
    from . import development_boundary_guard as guard
except ImportError:
    import development_boundary_guard as guard


FIXTURE_PATH = Path('evaluation/fixtures/development_boundary_sources.json')
# Publication-dependency regression: do not add these runtime files to the test bundle.
UNPUBLISHED_SOURCE_PATHS = (
    'backend/tests/retained_read_visits.py',
    'backend/tests/test_retained_read_gateway_pg.py',
    'backend/tests/test_gateway_target_rejection.py',
    'evaluation/test_general_claim_recovery.py',
    'evaluation/test_timing_recovery.py',
    'evaluation/study_source_amendment.py',
)


class BoundaryGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = json.loads(guard.DEFAULT_INVENTORY.read_text())
        cls.files = {r['path'] for e in cls.inventory['boundaries'] for r in e['sources']}
        fixture = json.loads((Path(__file__).resolve().parents[1] / FIXTURE_PATH).read_text())
        snippets = fixture['sources']
        # Fail closed on fixture/inventory mismatch; never skip absent sources or
        # fall back to reading a possibly unpublished checkout source.
        if set(snippets) != cls.files:
            raise ValueError('synthetic_fixture_source_set_mismatch')
        cls.originals = {name: ('# SYNTHETIC UNIT FIXTURE; NOT LIVE SOURCE PROOF\n'
                               + '\n'.join(lines) + '\n').encode('utf-8')
                         for name, lines in snippets.items()}

    def setUp(self):
        scratch = Path(os.environ.get('TMPDIR', Path.home() / '.hermes/cache/scratch'))
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='workagent-boundary-', dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = deepcopy(self.inventory)
        # Unit-only pins describe synthetic bytes, never the real checkout.
        for entry in self.data['boundaries']:
            for ref in entry['sources']:
                ref['sha256'] = hashlib.sha256(self.originals[ref['path']]).hexdigest()
        for name, raw in self.originals.items():
            target = guard.source(self.root, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)

    def run_audit(self, claims=None):
        return guard.audit(self.root, self.data, claims)

    def entry(self, identity):
        return next(e for e in self.data['boundaries'] if e['id'] == identity)

    def mutate(self, name, old, new):
        path = self.root / name
        text = path.read_text()
        self.assertIn(old, text)
        path.write_text(text.replace(old, new))

    def assert_drift(self, result, prefix):
        self.assertIn(result['status'], ('AUDIT_DRIFT', 'AUTHORITY_DRIFT', 'TECHNICAL_DRIFT'))
        self.assertTrue(any(e.startswith(prefix) for e in result['errors']), result['errors'])

    def test_synthetic_snippets_cover_inventory_anchors(self):
        result = self.run_audit()
        self.assertEqual(result['status'], 'PASS', result['errors'])
        self.assertEqual(result['engineering_changes_informational'], [])
        self.assertEqual(result['source_hash_changes_informational'], [])
        self.assertEqual(set(result['checked_files']), self.files)
        self.assertEqual(set(guard.REQUIRED), {e['id'] for e in self.inventory['boundaries']})

    def test_unit_bootstrap_without_unpublished_checkout_sources(self):
        # Only a named leaf subset runs in the child, never this regression or the
        # full suite. The outer workflow runs the entire suite in both Python modes.
        checkout = self.root / 'unit-only-checkout'
        bundle = ('evaluation/test_development_boundary_guard.py',
                  'evaluation/development_boundary_guard.py', str(guard.INVENTORY_PATH),
                  str(FIXTURE_PATH))
        for name in bundle:
            target = checkout / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((guard.ROOT / name).read_bytes())
        self.assertTrue(set(UNPUBLISHED_SOURCE_PATHS).issubset(self.files))
        for name in self.files:
            self.assertFalse((checkout / name).exists(), name)
        leaves = ('test_synthetic_snippets_cover_inventory_anchors',
                  'test_expired_grant_reuse_check_removal_detected',
                  'test_read_only_audit_has_no_process_network_or_write_effects')
        result = subprocess.run(
            [sys.executable, '-B', *(['-O'] if sys.flags.optimize else []),
             str(checkout / bundle[0]), *('BoundaryGuardTests.' + name for name in leaves), '-v'],
            cwd=checkout, capture_output=True, text=True, timeout=30,
            env={'PYTHONDONTWRITEBYTECODE': '1', 'TMPDIR': str(self.root)})
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('Ran 3 tests', result.stderr)
        self.assertNotIn('skipped', result.stderr)
        for name in self.files:
            self.assertFalse((checkout / name).exists(), name)

    def test_arbitrary_trial_settings_are_not_owner_gates(self):
        result = self.run_audit([{'boundary': 'trial-budget', 'requires_new_owner_approval': True}])
        self.assert_drift(result, 'setting_promoted_to_owner_gate:trial-budget')

    def test_justified_setting_adjustment_needs_no_new_approval(self):
        self.assertEqual(guard.exit_code(self.run_audit([{'boundary': 'trial-budget',
                          'requires_new_owner_approval': False}]), authority_only=True), 0)

    def test_owner_accounting_review_is_not_weakened(self):
        self.assertEqual(guard.exit_code(self.run_audit([{'boundary': 'installed-accounting-review',
                          'requires_new_owner_approval': False}]), authority_only=True), 0)
        self.assert_drift(self.run_audit([{'boundary': 'installed-accounting-review',
                          'requires_new_owner_approval': True}]),
                          'setting_promoted_to_owner_gate:installed-accounting-review')
        self.entry('installed-accounting-review')['category'] = 'engineering_setting'
        self.assert_drift(self.run_audit(), 'authority_classification_drift:installed-accounting-review')

    def test_withdrawn_micro_pilot_is_not_revived_even_without_approval(self):
        self.assert_drift(self.run_audit([{'boundary': 'micro-pilot',
                          'requires_new_owner_approval': False}]), 'withdrawn_requirement_revived:micro-pilot')

    def test_six_visits_and_each_visit_progress_are_not_owner_limits(self):
        for identity in ('natural-visit-count', 'per-visit-progress'):
            with self.subTest(boundary=identity):
                self.assert_drift(self.run_audit([{'boundary': identity,
                    'requires_new_owner_approval': True}]), 'setting_promoted_to_owner_gate:' + identity)

    def test_grant_lifetime_not_silently_promoted(self):
        self.entry('fixture-lifetime')['category'] = 'owner_limit'
        self.assert_drift(self.run_audit(), 'authority_classification_drift:fixture-lifetime')

    def test_expired_grant_reuse_check_removal_detected(self):
        self.mutate('evaluation/live_tool_authority.py', 'and g.expires_at>now()', '')
        self.assert_drift(self.run_audit(), 'boundary_anchor_drift:grant-no-renewal')

    def test_unknown_observe_cannot_be_replaced_by_fresh_call_unnoticed(self):
        self.mutate('evaluation/study_controller.py', 'result = self.adapter.observe(key)',
                    'result = self.adapter.call(key)')
        self.assert_drift(self.run_audit(), 'boundary_anchor_drift:unknown-no-replay')

    def test_official_pending_stop_removal_detected(self):
        self.mutate('evaluation/study_application.py',
                    "raise Hold('installed_run_pending_observation:' + state['current_run'])", 'pass')
        self.assert_drift(self.run_audit(), 'boundary_anchor_drift:official-no-lease-surgery')

    def test_capacity_change_is_detected_but_is_not_an_approval_gate(self):
        # Exercise a historical observation without requiring current engineering
        # code to retain that value. The CLI separately reads actual checkout sources.
        ref = self.entry('normal-model-capacity')['sources'][0]
        (self.root / ref['path']).write_text('\n'.join(ref['anchors']))
        self.mutate('evaluation/prepare_live_study.py', 'normal_output_tokens=8192',
                    'normal_output_tokens=81920')
        result = self.run_audit()
        self.assertIn('boundary_anchor_drift:normal-model-capacity:evaluation/prepare_live_study.py',
                      result['engineering_changes_informational'])
        self.assertEqual(guard.exit_code(result, authority_only=True), 0)
        self.assertFalse(any('normal-model-capacity' in e for e in result['errors']))

    def test_unrelated_hash_change_does_not_freeze_code(self):
        self.mutate('evaluation/prepare_live_study.py', 'import json',
                    'import json\n# Unrelated harmless implementation comment.')
        result = self.run_audit()
        self.assertEqual(guard.exit_code(result, authority_only=True), 0)
        self.assertIn('evaluation/prepare_live_study.py', result['source_hash_changes_informational'])

    def test_aggregate_ceiling_cannot_be_rewritten_as_remaining_budget(self):
        self.entry('cumulative-budget')['value'] = '100 USD available'
        self.assert_drift(self.run_audit(), 'owner_ceiling_drift')

    def test_safety_classification_cannot_be_demoted(self):
        self.entry('unknown-no-replay')['category'] = 'engineering_setting'
        self.assert_drift(self.run_audit(), 'authority_classification_drift:unknown-no-replay')

    def test_missing_required_boundary_detected(self):
        self.data['boundaries'].remove(self.entry('source-amendment'))
        self.assert_drift(self.run_audit(), 'authority_classification_drift:source-amendment')

    def test_malformed_category_with_claim_returns_drift_not_crash(self):
        self.entry('trial-budget')['category'] = []
        self.assert_drift(self.run_audit([{'boundary': 'trial-budget',
                          'requires_new_owner_approval': True}]), 'boundary_category:trial-budget')

    def test_duplicate_boundary_detected(self):
        self.data['boundaries'].append(deepcopy(self.entry('trial-budget')))
        self.assert_drift(self.run_audit(), 'duplicate_boundary:trial-budget')

    def test_missing_source_fails_without_exception_payload(self):
        (self.root / 'evaluation/live_tool_authority.py').unlink()
        result = self.run_audit()
        self.assert_drift(result, 'unreadable_or_invalid_source:grant-no-renewal')
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_path_traversal_and_private_surface_refused(self):
        for path in ('../secret.py', '/etc/passwd', '.local/private.json', 'backend/.venv/config.json',
                     'backend/.venv-office/config.json', 'backend/.venv-docs/config.json'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                guard.source(self.root, path)

    def test_symlink_escape_refused(self):
        path = self.root / 'evaluation/escape.py'
        path.symlink_to(guard.ROOT / 'evaluation/development_boundary_guard.py')
        with self.assertRaisesRegex(ValueError, 'source_escape'):
            guard.source(self.root, 'evaluation/escape.py')

    def test_claim_types_and_unknown_boundaries_fail_closed(self):
        for claim in ({'boundary': 'trial-budget', 'requires_new_owner_approval': 'false'},
                      {'boundary': 'invented', 'requires_new_owner_approval': False},
                      {'boundary': [], 'requires_new_owner_approval': False}):
            with self.subTest(claim=claim):
                self.assertEqual(guard.exit_code(self.run_audit([claim]), authority_only=True), 1)

    def test_read_only_audit_has_no_process_network_or_write_effects(self):
        with patch('socket.socket.connect', side_effect=AssertionError('no networking')), \
             patch('subprocess.Popen', side_effect=AssertionError('no subprocess')), \
             patch.object(Path, 'write_text', side_effect=AssertionError('no writes')), \
             patch.object(Path, 'write_bytes', side_effect=AssertionError('no writes')):
            self.assertEqual(guard.exit_code(self.run_audit(), authority_only=True), 0)
        self.assertEqual({name: hashlib.sha256((self.root/name).read_bytes()).hexdigest()
                          for name in self.files},
                         {name: hashlib.sha256(raw).hexdigest() for name, raw in self.originals.items()})


    def cli(self, *args, optimized=False):
        script = self.root / 'evaluation/development_boundary_guard.py'
        script.write_bytes((guard.ROOT / 'evaluation/development_boundary_guard.py').read_bytes())
        (self.root / guard.INVENTORY_PATH).write_text(json.dumps(self.data))
        return subprocess.run([sys.executable, '-B', *(['-O'] if optimized else []),
                               str(script), *args], cwd=self.root.parent,
                              env={'PYTHONDONTWRITEBYTECODE': '1'}, capture_output=True, text=True)

    def test_synthetic_cli_needs_no_local_inventory(self):
        self.assertFalse((self.root / '.local').exists())
        result = self.cli('--authority-only')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(json.loads(result.stdout)['boundaries'], len(guard.REQUIRED))
        self.assertNotIn('.local', str(guard.INVENTORY_PATH))

    def test_cli_missing_unpublished_sources_remain_technical_drift(self):
        for name in UNPUBLISHED_SOURCE_PATHS:
            (self.root / name).unlink()
        expected = {'unreadable_or_invalid_source:' + entry['id']
                    for entry in self.data['boundaries']
                    if any(ref['path'] in UNPUBLISHED_SOURCE_PATHS for ref in entry['sources'])}
        for optimized in (False, True):
            for arguments, expected_exit in (((), 1), (('--authority-only',), 0)):
                with self.subTest(optimized=optimized, arguments=arguments):
                    result = self.cli(*arguments, optimized=optimized)
                    self.assertEqual(result.returncode, expected_exit, result.stderr + result.stdout)
                    report = json.loads(result.stdout)
                    self.assertEqual(report['status'], 'TECHNICAL_DRIFT')
                    self.assertEqual(set(report['technical_drift']), expected)
                    self.assertEqual(report['inventory_errors'], [])
                    self.assertEqual(report['authority_errors'], [])
                    self.assertTrue(set(UNPUBLISHED_SOURCE_PATHS).isdisjoint(report['checked_files']))

    def test_root_selects_that_checkouts_inventory(self):
        (self.root / guard.INVENTORY_PATH).write_text(json.dumps(self.data))
        with patch('sys.argv', ['guard', '--root', str(self.root), '--authority-only']), \
             patch('builtins.print') as output:
            self.assertEqual(guard.main(), 0)
        self.assertEqual(json.loads(output.call_args.args[0])['boundaries'], len(guard.REQUIRED))

    def test_technical_drift_is_not_authority_drift_or_ci_gate(self):
        self.mutate('evaluation/study_controller.py', 'result = self.adapter.observe(key)',
                    'result = self.adapter.call(key)')
        result = self.run_audit()
        self.assertEqual(result['status'], 'TECHNICAL_DRIFT')
        self.assertTrue(result['technical_drift'])
        self.assertEqual(result['authority_errors'], [])
        self.assertEqual(guard.exit_code(result), 1)
        self.assertEqual(guard.exit_code(result, authority_only=True), 0)

    def test_reservation_literals_are_technical_not_owner_authority(self):
        for identity in ('normal-model-capacity', 'reservation-accounting'):
            for ref in self.entry(identity)['sources']:
                (self.root / ref['path']).write_text('\n'.join(ref['anchors']))
        self.mutate('evaluation/prepare_live_study.py', 'normal_input_tokens=50000',
                    'normal_input_tokens=60000')
        self.mutate('evaluation/recipient_funding.sql', "'50000'", "'60000'")
        result = self.run_audit()
        self.assertTrue(any('reservation-accounting' in e for e in result['technical_drift']))
        self.assertEqual(result['authority_errors'], [])
        self.assertEqual(guard.exit_code(result, authority_only=True), 0)
        # This is detection, not a claim that the changed economic assumptions are coherent.

    def test_all_engineering_observations_can_change_without_new_approval(self):
        for entry in self.data['boundaries']:
            if entry['category'] != 'engineering_setting':
                continue
            for ref in entry['sources']:
                path = self.root / ref['path']
                text = path.read_text()
                for anchor in ref['anchors']:
                    text = text.replace(anchor, '# revised engineering observation')
                path.write_text(text)
        result = self.run_audit()
        self.assertTrue(result['engineering_changes_informational'])
        self.assertEqual(result['authority_errors'], [])
        self.assertEqual(guard.exit_code(result, authority_only=True), 0)

    def test_each_known_classification_is_protected(self):
        for identity, category in guard.REQUIRED.items():
            with self.subTest(identity=identity):
                entry = self.entry(identity)
                entry['category'] = 'owner_limit' if category != 'owner_limit' else 'engineering_setting'
                self.assert_drift(self.run_audit(), 'authority_classification_drift:' + identity)
                entry['category'] = category

    def test_fixture_safety_removal_is_technical_not_an_approval_claim(self):
        self.mutate('backend/tests/test_domain.py',
                    'if runtime_id[:3] != admin_id[:3] or runtime_id[3] == admin_id[3]:',
                    'if False:')
        result = self.run_audit()
        self.assert_drift(result, 'boundary_anchor_drift:generic-fixture-prefix')
        self.assertEqual(result['authority_errors'], [])

    def test_source_document_edit_is_review_not_a_claim_of_lost_permission(self):
        self.mutate('docs/GENERAL_MODEL_AUTHORIZATION.md',
                    'model-testing ceiling from $50 to **$100 total**, including all historical',
                    'model-testing ceiling: revised document text')
        result = self.run_audit()
        self.assertTrue(any('cumulative-budget' in e for e in result['technical_drift']))
        self.assertEqual(result['authority_errors'], [])

    def test_optimized_cli_rejects_negative_claims_and_demotions(self):
        claim_file = self.root / 'claims.json'
        claim_file.write_text(json.dumps([{'boundary': 'trial-budget', 'requires_new_owner_approval': True}]))
        result = self.cli('--authority-only', '--claims', str(claim_file), optimized=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['status'], 'AUTHORITY_DRIFT')
        self.entry('unknown-no-replay')['category'] = 'engineering_setting'
        result = self.cli('--authority-only', optimized=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('authority_classification_drift:unknown-no-replay', json.loads(result.stdout)['authority_errors'])

    def test_optimized_cli_reports_negative_source_mutation(self):
        self.mutate('evaluation/live_tool_authority.py', 'and g.expires_at>now()', '')
        result = self.cli(optimized=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['status'], 'TECHNICAL_DRIFT')
        self.assertEqual(self.cli('--authority-only', optimized=True).returncode, 0)

    def test_malformed_inventory_is_never_ignored_by_ci(self):
        for data in (None, [], {'schema_version': 1, 'boundaries': {}}, {'boundaries': []}):
            with self.subTest(data=data):
                result = guard.audit(self.root, data)
                self.assertEqual(guard.exit_code(result, authority_only=True), 1)
                self.assertIn('inventory_schema', result['inventory_errors'])
        for ref in (None, {}, {'path': 'evaluation/test.py', 'anchors': [], 'sha256': 'bad'}):
            self.entry('trial-budget')['sources'] = [ref]
            self.assertIn('source_schema:trial-budget', self.run_audit()['inventory_errors'])

    def test_private_in_repo_symlink_is_refused_before_read(self):
        private = self.root / '.local'
        private.mkdir()
        target = private / 'synthetic-private.json'
        target.write_text('{}')
        (self.root / 'evaluation/private.json').symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'private_or_dependency_source'):
            guard.source(self.root, 'evaluation/private.json')

    def test_invalid_input_cli_fails_without_private_error_payload(self):
        result = self.cli('--authority-only', '--inventory', str(self.root / 'missing.json'))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['errors'], ['invalid_input'])
        self.assertNotIn(str(self.root), result.stdout)


if __name__ == '__main__':
    unittest.main()
