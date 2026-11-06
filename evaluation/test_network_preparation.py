"""Regression controls for scoped review findings; no provider or DB access."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
PREP=ROOT/'.local/batch3/b35c/preparation'
spec=importlib.util.spec_from_file_location('network_harness',ROOT/'evaluation/network_harness.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

class PreparationTests(unittest.TestCase):
    def test_stale_bytecode_ignored_in_real_jail(self):
        # Reuse independently authored reproducer, untouched, containing stale pyc.
        fake=PREP/'review/bytecode-product'
        self.assertTrue(list(fake.rglob('*.pyc')))
        with tempfile.TemporaryDirectory(dir=PREP) as state:
            cmd=h.jail(PREP/'public-inputs/B1/episode-1',Path(state),fake)
            code="import sys,json;sys.path.insert(0,'/product');import workagent;print(json.dumps({'value':workagent.VALUE,'cache':sys.pycache_prefix}))"
            p=subprocess.run(cmd[:-1]+['-c',code],capture_output=True,text=True,timeout=30)
            self.assertEqual(p.returncode,0,p.stderr)
            self.assertEqual(json.loads(p.stdout),{'value':'fresh','cache':'/pycache'})

    def test_readable_directory_is_not_denial(self):
        with tempfile.TemporaryDirectory(dir=PREP) as state:
            cmd=h.jail(PREP/'public-inputs/B1/episode-1',Path(state),ROOT/'backend/workagent')
            code="import runpy;w=runpy.run_path('/worker.py');w['probe']({'forbidden_paths':{'directory':'/inputs'},'controller_pid':99999999})"
            p=subprocess.run(cmd[:-1]+['-c',code],capture_output=True,text=True,timeout=30)
            self.assertNotEqual(p.returncode,0)
            self.assertIn("'directory': False",p.stderr)

    def test_exact_new_execution_binding_and_named_denials(self):
        out=PREP/'network-13'
        env=json.loads((out/'execution-environment.json').read_text())
        self.assertEqual(env['launcher_sha256'],h.digest(ROOT/'evaluation/network_harness.py'))
        self.assertEqual(env['files']['/worker.py'],h.digest(ROOT/'evaluation/network_worker.py'))
        for variant in ('B1','M1'):
            slot=out/variant
            for name,reason in [('source','loaded_source_drift'),('grant','grant_binding_drift'),('descriptor','descriptor_binding_drift'),('run','run_configuration_drift')]:
                r=json.loads((slot/f'wrong-{name}.stdout').read_text())
                self.assertEqual(r,{'status':'denied','reason':reason,'provider_network_calls':0})
                self.assertEqual((slot/f'wrong-{name}.stderr').read_text(),'')
            receipts=[json.loads(p.read_text()) for p in sorted(slot.glob('visit-*.stdout'))]
            self.assertEqual(len({(r['namespace_ids']['pid'],r['process_start_ticks']) for r in receipts}),len(receipts))
            self.assertTrue(all(r['bytecode_cache_isolated'] and r['execution_files']==env['files'] for r in receipts))
            self.assertTrue(all(r['network_confinement']['host_listener_errno']==13 for r in receipts))
            self.assertEqual(receipts[-1]['synthetic_calls'],[])
            self.assertEqual(receipts[-1]['state'],'ready')
            self.assertTrue(all(all(r['denials'].values()) for r in receipts))

    def test_full_denominator_remains_unexecuted(self):
        plan=json.loads((PREP/'network-13/plan.json').read_text())
        self.assertEqual(len(plan['episodes']),72)
        self.assertEqual(len({r['blind_id'] for r in plan['episodes']}),12)
        self.assertTrue(all(r['status']=='UNEXECUTED' and r['provider_grant'] is None and r['request_sha256'] is None for r in plan['episodes']))
        self.assertFalse(plan['paid_admission'])

if __name__=='__main__':unittest.main()
