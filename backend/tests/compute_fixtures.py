"""Synthetic non-invoice calculation; independent oracle is in the test module."""

def retain_evidence(name, value):
    import os, json
    from pathlib import Path
    if os.environ.get('COMPUTE_EVIDENCE_DIR'):
        dest = Path(os.environ['COMPUTE_EVIDENCE_DIR'])
        dest.mkdir(parents=True, exist_ok=True)
        (dest / (name + '.json')).write_text(json.dumps(value, indent=2, default=str))


def restart_owned_service():
    import os, socket, subprocess, time
    from workagent.sandbox.client import run
    unit = os.environ['COMPUTE_SYSTEMD_UNIT']
    assert unit.startswith('workagent-compute-b31a-')
    subprocess.run(['sudo','-n','systemctl','restart',unit], check=True, timeout=30)
    deadline = time.monotonic() + 20
    while True:
        try:
            with socket.socket(socket.AF_UNIX) as probe:
                probe.connect(os.environ['WORKAGENT_COMPUTE_SOCKET'])
            break
        except OSError:
            assert time.monotonic() < deadline
            time.sleep(.1)
    # Connect alone is not readiness: validate a real profile-bound job receipt.
    result = run("print('ready')", [], authorized=lambda: True)
    assert result['status'] == 'succeeded' and result['stdout'] == 'ready\n'
    retain_evidence('service-recovery', result)

READINGS = '''sample,station,quantity,unit,at,note
r1,A,1500,g,2026-10-28T00:30:00+00:00,Retain early observation
r2,A,2.25,kg,2026-10-28T08:00:00+00:00,Human annotation alpha
r3,B,,kg,2026-10-28T09:00:00+00:00,Null is not zero
r4,B,500,g,2026-10-28T09:00:00+00:00,Human annotation beta
r5,C,1,kg,2026-10-28T10:00:00+00:00,Unknown join key
r6,A,0.1,kg,2026-10-28T10:00:00+00:00,Decimal precision
'''
STATIONS = 'station,region,factor\nA,North,1.1\nB,South,0.9\n'
CALCULATE = '''import csv,json
from decimal import Decimal,ROUND_HALF_UP
from datetime import datetime
from zoneinfo import ZoneInfo
stations={r['station']:r for r in csv.DictReader(open('/inputs/stations.csv'))}
groups={}; omissions=[]
for r in csv.DictReader(open('/inputs/readings.csv')):
    if not r['quantity']:
        omissions.append({'sample':r['sample'],'reason':'null quantity excluded, not zero'}); continue
    station=stations.get(r['station'])
    if station is None:
        omissions.append({'sample':r['sample'],'reason':'missing station join key excluded'}); continue
    unit={'g':Decimal('0.001'),'kg':Decimal('1')}[r['unit']]
    amount=Decimal(r['quantity'])*unit*Decimal(station['factor'])
    day=datetime.fromisoformat(r['at']).astimezone(ZoneInfo('America/Los_Angeles')).date().isoformat()
    key=(day,station['region'])
    total,notes=groups.get(key,(Decimal(0),[]))
    groups[key]=(total+amount,notes+[r['note']])
with open('/outputs/summary.csv','w',newline='') as f:
    w=csv.writer(f,lineterminator='\\n');w.writerow(['local_day','region','mass_kg','notes'])
    for (day,region),(amount,notes) in sorted(groups.items()):
        w.writerow([day,region,str(amount.quantize(Decimal('.001'),rounding=ROUND_HALF_UP)),' | '.join(notes)])
with open('/outputs/coverage.json','w') as f:
    json.dump({'timezone':'America/Los_Angeles','null':'excluded not zero','unit':'kg','join':'inner; missing keys reported','omissions':omissions},f,sort_keys=True)
print('rows retained=4; groups=3; excluded=2')
'''
SOURCE = '''def normalize(values):
    return sorted(set(x.strip().casefold() for x in values if x.strip()))
'''
TESTS = '''import unittest
from transform import normalize
class SuppliedTests(unittest.TestCase):
    def test_unique(self): self.assertEqual(normalize([' A ', 'a', 'B']), ['a','b'])
    def test_empty(self): self.assertEqual(normalize(['', '  ']), [])
    def test_unicode(self): self.assertEqual(normalize(['STRASSE','Straße']), ['strasse'])
if __name__ == '__main__': unittest.main()
'''
TEST_DRIVER = '''import sys,unittest,json
sys.path.insert(0,'/inputs')
import test_transform
suite=unittest.defaultTestLoader.loadTestsFromModule(test_transform)
result=unittest.TextTestRunner().run(suite)
with open('/outputs/tests.json','w') as f: json.dump({'tests':result.testsRun,'passed':result.wasSuccessful()},f)
if not result.wasSuccessful(): sys.exit(1)
'''
