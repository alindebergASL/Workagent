#!/usr/bin/env python3
"""Offline evidence verification only; no network, DB queries or product imports."""
from pathlib import Path
from decimal import Decimal as D
import hashlib, json, unittest

ROOT = Path(__file__).resolve().parent
R = json.loads((ROOT/'current-reconciliation.json').read_text())
C = json.loads((ROOT/'proposed-tranche.json').read_text())

class EvidenceTests(unittest.TestCase):
    def test_scope_and_read_only(self):
        self.assertEqual(R['store_count'],len(R['stores']))
        self.assertEqual(len({s['identity']['database'] for s in R['stores']}),R['store_count'])
        self.assertEqual(R['store_count'],13)
        self.assertTrue(all(s['identity']['read_only']=='on' for s in R['stores']))
        self.assertEqual(R['provider_calls'],0)
        self.assertEqual(R['authority_changes'],0)
        self.assertFalse(R['billing_queried'])

    def test_primary_lineage(self):
        a = R['allocation']
        self.assertTrue(a['all_source_receipts_match'])
        self.assertTrue(a['all_archive_members_match'])
        self.assertEqual(len(a['source_receipt_checks']),34)
        self.assertEqual(len(a['archive_member_checks']),10)
        self.assertTrue(all(x.get('primary_accounting_fields_match',True) for x in a['source_receipt_checks']))
        self.assertEqual(D(a['retained_allocation_usd']),D('99.60596'))
        self.assertEqual(D(a['global_unallocated_usd']),D('.39404'))
        for x in a['campaign_additions']:
            current = next(s['campaign'][0] for s in R['stores'] if s.get('campaign') and s['campaign'][0]['id']==x['id'])
            self.assertEqual(D(x['allocation']),D(current['allocation']))
            self.assertEqual(D(x['prior_allocation']),D(current['prior_allocation']))
            self.assertEqual(x['linkage_sha256'],current['linkage_sha256'])

    def test_dedup_and_unknowns(self):
        self.assertEqual(R['deduplication']['conflicting_duplicate_events'],0)
        self.assertEqual(R['deduplication']['unique_events'],3958)
        self.assertEqual(R['deduplication']['duplicate_event_copies'],1273)
        self.assertEqual(R['union_totals']['unknown_usage_steps'],3)
        self.assertEqual(R['union_totals']['unmatched_count_steps'],7)
        self.assertEqual(D(R['union_totals']['reserved_cost_usd']),D('72.17292'))
        self.assertEqual(D(R['union_totals']['known_usage_calculated_usd']),D('14.7193575'))
        self.assertIsNone(R['union_totals']['billed_cost_usd'])

    def test_carry_matches_originals_not_extra_liability(self):
        self.assertEqual(len(R['carry_source_checks']),31)
        self.assertTrue(all(x['matches_source_dispatch'] for x in R['carry_source_checks']))
        self.assertTrue(all(s.get('official_grants_unchanged_since_Batch2_preflight',True) for s in R['stores']))

    def test_installed_remaining_and_exact_prompt(self):
        s = R['stores'][0]
        self.assertEqual(s['identity']['database'],'workagent_test_47b87fe3b82e')
        g = next(x for x in s['grants'] if x['active'])
        b = g['binding']; t = s['totals']
        self.assertEqual(D(b['cost_limit_usd'])-D(s['local_reserved_plus_carry_usd']),D('1.03460'))
        self.assertEqual(b['generation_limit']-t['counts']['dispatch'],5)
        self.assertEqual(b['count_limit']-t['counts']['count_send'],21)
        self.assertEqual(b['read_limit']-t['counts']['read'],268)
        profiles = s['active_grant_retained_request_profiles']
        self.assertEqual(len(profiles),1)
        self.assertEqual(profiles[0]['instructions_sha256'],b['instructions_sha256'])
        self.assertEqual(profiles[0]['instructions_sha256'],R['runtime_source'][0]['static_prompt_hashes']['composition.py:CONTINUITY_POLICY'])
        self.assertEqual(g['consumer_sha256'],R['runtime_source'][0]['on_disk_consumer_hash'])

    def test_campaign_gates_and_remainders(self):
        campaigns = [s for s in R['stores'] if s.get('campaign')]
        self.assertEqual(len(campaigns),2)
        self.assertEqual({s['campaign_uncommitted_usd'] for s in campaigns},{'0.52616','0.52700'})
        for s in campaigns:
            self.assertTrue(s['campaign'][0]['expired'])
            self.assertEqual(s['campaign_gate']['count_read_reserve_usd'],'.01')
            self.assertTrue(s['campaign_gate']['cancel_forbidden'])
            self.assertEqual(len(s['campaign_triggers']),3)
            self.assertTrue(all(t['tgenabled']=='O' for t in s['campaign_triggers']))

    def test_costs(self):
        expected = {'single_episode':(8,'1.65536','4.93536'),
                    'single_trajectory':(48,'9.93216','29.61216'),
                    'one_family':(288,'59.59296','177.67296'),
                    'A_B':(576,'119.18592','355.34592'),
                    'A_G':(2016,'417.15072','1243.71072')}
        self.assertEqual(C,R['costing'])
        self.assertFalse(C['executable'])
        self.assertEqual(C['auxiliary_paid_judge_search_calls'],0)
        self.assertEqual(D(C['per_generation_model_reserve_usd']),D('.20692'))
        for name,(calls,model,total) in expected.items():
            d = C['designs'][name]
            self.assertEqual(d['generations'],calls)
            self.assertEqual(d['count_sends'],calls)
            self.assertEqual(d['response_reads'],40*calls)
            self.assertEqual(d['cancels'],0)
            self.assertEqual(D(d['model_reserve_usd']),D(model))
            self.assertEqual(D(d['total_reserve_usd']),D(total))
            self.assertEqual(d['input_tokens'],calls*50000)
            self.assertEqual(d['output_tokens'],calls*8192)

    def test_public_price_receipts(self):
        receipts = json.loads((ROOT/'public-pricing-receipts.json').read_text())
        self.assertEqual(len(receipts),3)
        for x in receipts:
            self.assertEqual(x['http_status'],200)
            self.assertEqual(hashlib.sha256((ROOT/x['file']).read_bytes()).hexdigest(),x['sha256'])
        model = (ROOT/'public-model-current.txt').read_text()
        self.assertIn('| Cache writes | $2.5 | 1M tokens |',model)
        self.assertIn('| Output | $10 | 1M tokens |',model)

    def test_no_raw_credentials_or_receipt_bodies(self):
        # Whitelisted structure, not a claim of account-wide absence of secrets.
        prohibited = {'secret_reference','secure_secret_reference','request_bytes','count_bytes',
                      'response_id','response_body','authorization_header','principal_id','workspace_id','project_id'}
        def walk(x):
            if isinstance(x,dict):
                self.assertFalse(prohibited.intersection(x))
                for value in x.values(): walk(value)
            elif isinstance(x,list):
                for value in x: walk(value)
        # Lineage field labels can describe historical source documents; actual grants/events must be sanitized.
        for s in R['stores']: walk(s)
        for p in [ROOT/'current-reconciliation.json',ROOT/'proposed-tranche.json']:
            text = p.read_text()
            self.assertNotIn('postgresql://',text)
            self.assertNotIn('postgres://',text)
            self.assertNotIn('sk-proj-',text)

if __name__=='__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(EvidenceTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {'tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),
              'passed':result.wasSuccessful(),'evidence_sha256':hashlib.sha256((ROOT/'current-reconciliation.json').read_bytes()).hexdigest()}
    (ROOT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)
