"""Verify the retained final calculation through real HTTP; no provider calls.
Run from repository root with the private closure disposable-PG env sourced and
PYTHONPATH=backend:backend/tests. Fails on missing evidence/role/schema mismatch.
"""
import csv
import io
import json
import os
from pathlib import Path
from hashlib import sha256
from fractions import Fraction
from workagent.db import Database
from workagent.capabilities.registry import adapters
from test_compute_http_pg import http_api

root = Path(__file__).resolve().parents[3]
local = root / '.local/batch3/b31a'
proof = local / 'closure-final-pg-proof'
target = json.loads((proof/'download-target.json').read_text())
assert '/workagent_test_' in os.environ['DATABASE_URL']
db = Database(); db.check_runtime_role()
with db.transaction() as c:
    role = c.execute('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
    migrations = c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    assert {r['name']:r['checksum'] for r in migrations} == {
        p.name:sha256(p.read_bytes()).hexdigest() for p in (root/'backend/migrations').glob('*.sql')}
    descriptor = c.execute("SELECT descriptor FROM capability_installations WHERE id='compute.python' AND version='1' AND enabled").fetchone()['descriptor']
    assert descriptor == adapters()['compute.python'].descriptor.model_dump(mode='json')
# Same actual TCP fixture used by the acceptance test; finalizer stops only its PID.
server = http_api.__wrapped__()
try:
    client = next(server)
    path = f"/v1/workspaces/{target['workspace_id']}/exports/{target['export_id']}/download"
    headers = {'Authorization':'Bearer '+os.environ['LOCAL_BEARER_TOKEN'],
               'X-Schema-Version':'workagent/v1', 'X-Request-Id':'compute-calculation-final'}
    result = client.get(path, headers=headers)
    assert result.status_code == 200
    digest = sha256(result.content).hexdigest()
    assert digest == target['sha256'] == result.headers['x-content-sha256']
    assert result.content == (proof/'summary.csv').read_bytes()
    rows = list(csv.DictReader(io.StringIO(result.text)))
    expected = [('2026-10-27','North',Fraction(1500,1000)*Fraction(11,10)),
                ('2026-10-28','North',(Fraction(225,100)+Fraction(1,10))*Fraction(11,10)),
                ('2026-10-28','South',Fraction(500,1000)*Fraction(9,10))]
    assert [(r['local_day'],r['region'],Fraction(r['mass_kg'])) for r in rows] == expected
    assert [r['notes'] for r in rows] == ['Retain early observation','Human annotation alpha | Decimal precision','Human annotation beta']
    assert client.get(path).status_code == 401
    assert client.get(path.replace(target['workspace_id'],'no-such-workspace'),headers=headers).status_code == 404
    receipt = {'http_status':200,'sha256':digest,'rows':rows,'independent_fraction_oracle':True,
               'anonymous_status':401,'cross_workspace_status':404,
               'role':role,'migration_count':len(migrations),'migration_checksums_verified':True,
               'compute_descriptor':descriptor,'transport':'real authenticated loopback TCP uvicorn'}
    (local/'http-calculation-verified.json').write_text(json.dumps(receipt,indent=2))
    print(json.dumps({k:v for k,v in receipt.items() if k!='compute_descriptor'},indent=2))
finally:
    server.close()
