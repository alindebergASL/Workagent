"""Offline harness controls; temp inputs are synthetic, never paid model outputs."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import canonical, digest, safe_file, external_root, stage_episode, load_study, files_manifest, write_new
from scoring import freeze_packet, score_packet, paired_effort

ROOT=Path(os.environ.get('B35B_EVALUATOR_ROOT','/home/ubuntu/workagent-evaluator-b35b-v2'))


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='b35b-controls-', dir=os.environ.get('TMPDIR', str(Path.home()/'.hermes/cache/scratch')))
        self.root=Path(self.tmp.name)
        self.root.chmod(0o700)
        self.addCleanup(self.tmp.cleanup)

    def test_repository_root_rejected(self):
        with self.assertRaises(ValueError):external_root(Path(__file__).resolve().parent)

    def test_runtime_dependency_drift_rejected(self):
        from runtime_binding import validate
        expected={'child':{'version':'pinned'},'dependencies_sha256':'original'}
        for changed in [{'child':{'version':'other'},'dependencies_sha256':'original'},
                        {'child':{'version':'pinned'},'dependencies_sha256':'changed'}]:
            with self.assertRaisesRegex(ValueError,'runtime_or_dependency_drift'):validate(expected,changed)
        validate(expected,dict(expected))

    def test_permission_mode_rejected(self):
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):external_root(self.root)

    def test_symlink_rejected(self):
        (self.root/'source').write_text('x');(self.root/'alias').symlink_to(self.root/'source')
        with self.assertRaises(ValueError):safe_file(self.root,'alias')

    def test_hardlink_rejected(self):
        (self.root/'source').write_text('x');os.link(self.root/'source',self.root/'alias')
        with self.assertRaises(ValueError):safe_file(self.root,'source')

    def test_traversal_absolute_unicode_and_subdirectory_rejected(self):
        for name in ['../oracles','/etc/passwd','a/b','é.json','..']:
            with self.subTest(name=name), self.assertRaises(ValueError):safe_file(self.root,name)

    def test_symlink_directory_manifest_rejected(self):
        (self.root/'dir').symlink_to(ROOT/'oracles',target_is_directory=True)
        with self.assertRaises(ValueError):files_manifest(self.root)

    def fixture(self,body=b'permitted source'):
        folder=self.root/'fixtures/case/1';folder.mkdir(parents=True)
        (folder/'source.txt').write_bytes(body)
        return {'case':'case','episode':1,'inputs':[{'name':'source.txt','sha256':digest(body)}]}

    def test_hash_drift_rejected_before_request(self):
        spec=self.fixture();(self.root/'fixtures/case/1/source.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError,'input_hash'):stage_episode(self.root,spec,self.root/'stage',[])

    def test_oracle_answer_injected_as_tool_input_rejected(self):
        secret=b'SECRET-TEST-ORACLE';spec=self.fixture(secret)
        with self.assertRaisesRegex(ValueError,'oracle_contamination'):stage_episode(self.root,spec,self.root/'stage',[secret])

    def test_hashed_permitted_source_staged_exactly(self):
        spec=self.fixture();result=stage_episode(self.root,spec,self.root/'stage',[])
        self.assertEqual(result[0]['sha256'],spec['inputs'][0]['sha256'])

    def test_no_overwrite_attempt(self):
        p=self.root/'record';write_new(p,b'first')
        with self.assertRaises(FileExistsError):write_new(p,b'replacement')
        self.assertEqual(p.read_bytes(),b'first')

    def test_study_frozen_and_correct_denominators(self):
        manifest=load_study(ROOT)
        schedule=json.loads((ROOT/'trajectories/schedule.json').read_text())
        self.assertEqual(len(schedule),63)
        primary=[t for t in schedule if t['repeat'] in (1,2)]
        self.assertEqual(len(primary),42)
        self.assertEqual(sum(len(t['episodes']) for t in primary),252)
        self.assertEqual(len({t['blind_id'] for t in schedule}),63)
        for family in 'ABCDEFG':
            self.assertEqual(len([t for t in primary if t['family']==family]),6)
        self.assertEqual(manifest['primary_episodes'],252)

    def test_no_oracles_in_fixture_request_or_memory_inputs(self):
        secrets=[bytes.fromhex(x) for x in json.loads((ROOT/'oracles/custody.json').read_text())['canaries_hex']]
        for p in (ROOT/'fixtures').rglob('*'):
            if p.is_file():self.assertFalse(any(s in p.read_bytes() for s in secrets))

    def test_mixed_order_not_all_baseline_then_treatment(self):
        schedule=json.loads((ROOT/'trajectories/schedule.json').read_text())
        blocks=[schedule[n:n+3] for n in range(0,len(schedule),3)]
        self.assertGreater(len({tuple(t['variant'] for t in block) for block in blocks}),1)
        self.assertTrue(all(set(t['variant'] for t in b)=={'B0','B1','M1'} for b in blocks))


class ScoringTests(CustodyTests):
    # No inheritance of custody tests: loaded explicitly below by the runner.
    def packet(self,text='protected'):
        source=self.root/'artifacts';source.mkdir();(source/'answer.md').write_text(text)
        oracle={'required_checks':['correct'],'fatal':['leak','human_loss'],
                'artifact_checks':{'must_contain':['protected'],'must_not_contain':['private-answer']}}
        task={'request':'Do the task','required_checks':oracle['required_checks'],'fatal':oracle['fatal'],'tolerance':'no quality loss'}
        packet=self.root/'packet';h=freeze_packet(source,['answer.md'],task,packet,oracle)
        verdict={'reviewer':'control specimen only','packet_sha256':h,'checks':{'correct':True},
                 'fatal':{'leak':False,'human_loss':False},'human_seconds':10,'steering_events':0,
                 'setup_seconds':2,'recall_review_seconds':3,'corrections':0,'notes':'control, not live score'}
        return packet,oracle,verdict

    def test_mechanical_checks_never_imply_judged_quality(self):
        packet,oracle,_=self.packet();self.assertEqual(score_packet(packet,oracle,None)['quality'],'not_scored')

    def test_artifact_change_after_freeze_fails(self):
        packet,oracle,verdict=self.packet();(packet/'artifact-1.md').write_text('altered')
        with self.assertRaises(ValueError):score_packet(packet,oracle,verdict)

    def test_incomplete_scoring_denominator_fails(self):
        packet,oracle,v=self.packet();v['checks']={}
        with self.assertRaises(ValueError):score_packet(packet,oracle,v)

    def test_fatal_never_averages_away(self):
        packet,oracle,v=self.packet();v['fatal']['leak']=True
        self.assertEqual(score_packet(packet,oracle,v)['quality'],'fatal_fail')

    def test_wrong_answer_control_fails(self):
        packet,oracle,v=self.packet('wrong')
        self.assertEqual(score_packet(packet,oracle,v)['quality'],'task_fail')

    def test_oracle_disclosure_control_fails(self):
        packet,oracle,v=self.packet('protected private-answer')
        self.assertEqual(score_packet(packet,oracle,v)['quality'],'fatal_fail')

    def test_bad_score_binding_fails(self):
        packet,oracle,v=self.packet();v['packet_sha256']='0'*64
        with self.assertRaises(ValueError):score_packet(packet,oracle,v)

    def test_blinding_removes_original_filename_and_variant_metadata(self):
        packet,oracle,v=self.packet()
        data=json.loads((packet/'packet.json').read_text())
        self.assertNotIn('variant',data);self.assertEqual(data['artifacts'][0]['name'],'artifact-1.md')

    def test_recall_review_cost_counted_in_pair(self):
        packet,oracle,v=self.packet();b=score_packet(packet,oracle,v)
        m=json.loads(json.dumps(b));m['verdict']['recall_review_seconds']=30
        result=paired_effort(b,m)
        self.assertEqual(result['comparison'],'descriptive_only_not_matched_or_adjudicated')
        self.assertEqual(result['effort_delta_seconds'],27)

    def test_missing_quality_cannot_win(self):
        self.assertEqual(paired_effort({'quality':'not_scored'},{'quality':'not_scored'})['comparison'],'inconclusive_or_quality_failure')

    def test_empty_oracle_substitution_fails(self):
        packet,oracle,v=self.packet()
        oracle['required_checks']=[];oracle['fatal']=[]
        v['checks']={};v['fatal']={}
        with self.assertRaisesRegex(ValueError,'oracle_changed'):score_packet(packet,oracle,v)

    def test_wrong_case_oracle_fails(self):
        packet,oracle,v=self.packet();oracle['case']='different-case'
        with self.assertRaisesRegex(ValueError,'oracle_changed'):score_packet(packet,oracle,v)

    def test_subset_fatal_oracle_fails(self):
        packet,oracle,v=self.packet();oracle['fatal']=['leak'];v['fatal']={'leak':False}
        with self.assertRaisesRegex(ValueError,'oracle_changed'):score_packet(packet,oracle,v)

    def test_faster_with_extra_repairs_never_wins(self):
        packet,oracle,v=self.packet();b=score_packet(packet,oracle,v)
        m=json.loads(json.dumps(b));m['verdict']['human_seconds']=0;m['verdict']['corrections']=10
        result=paired_effort(b,m)
        self.assertEqual(result['comparison'],'descriptive_only_not_matched_or_adjudicated')
        self.assertEqual(result['corrections_delta'],10)

    def test_posthoc_tolerance_not_supported(self):
        with self.assertRaises(TypeError):paired_effort({}, {}, -100)


if __name__=='__main__':
    suite=unittest.TestSuite()
    loader=unittest.TestLoader()
    suite.addTests(loader.loadTestsFromTestCase(CustodyTests))
    for name in ScoringTests.__dict__:
        if name.startswith('test_'):suite.addTest(ScoringTests(name))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
