"""Replay independent checks against retained synthetic live-model output.

No model/provider/network calls and no database. This verifies the saved proof
bundle, not all goals or the integrated product UI. Run with backend dependencies.
"""
import hashlib
import json
import random
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from workagent.models import Revision
from workagent.service import digest
from workagent.wasm_tool import run_wasm_tool, ToolRejected


def main():
    directory = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'evidence/flexible-work-13'
    manifest = json.loads((directory / 'manifest.json').read_text())
    for name, checksum in manifest['files'].items():
        assert Path(name).name == name
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == checksum, name

    def body(name):
        item = json.loads((directory / (name + '.json')).read_text())
        revision = Revision.model_validate(item['revision'])
        assert digest(revision.body) == revision.body_hash
        return revision.body.model_dump(mode='json')

    tool = body('rainwater')
    cases = [[80, 12, 75], [80, 0, 75], [3, 1, 50], [0, 100, 100],
             [10**9, 10**9, 100], [10**9, 10**9, 99], [999999999, 999999999, 1]]
    rng = random.Random(1309)
    cases += [[rng.randrange(10**9 + 1), rng.randrange(10**9 + 1), rng.randrange(101)] for _ in range(100)]
    for args in cases:
        assert run_wasm_tool(tool['code'], tool['entrypoint'], args)['value'] == args[0] * args[1] * args[2] // 100
    invalid = [[1, 1, 101], [-1, 1, 50], [1, -1, 50], [1, 1, -1]]
    for args in invalid:
        try:
            run_wasm_tool(tool['code'], tool['entrypoint'], args)
        except ToolRejected:
            pass
        else:
            raise AssertionError('Invalid-domain input was accepted')

    def rows(name):
        return {r['row_id']: {c['field_key']: c['value'] for c in r['cells']} for r in body(name)['rows']}

    original, current = rows('venues-original'), rows('venues-current')
    expected = {'Willow Hall': (80, '250.00', True, 15), 'Station Loft': (100, '200.00', False, 8),
                'River Centre': (70, '320.00', True, 12), 'Garden Room': (60, '180.00', True, 5)}
    assert len(original) == len(expected) == len(current)
    for row in original.values():
        assert (row['capacity'], row['hire_cost'], row['step_free'], row['travel_time']) == expected[row['venue']]
    for key, row in current.items():
        for field in ('venue', 'capacity', 'step_free', 'travel_time'):
            assert row[field] == original[key][field]
        assert row['hire_cost'] == ('350.00' if row['venue'] == 'Willow Hall' else original[key]['hire_cost'])
    willow = next(r for r in current.values() if r['venue'] == 'Willow Hall')
    assert willow['venue_notes'] == 'Human: ask Marta about a discount before any booking. Keep this note.'
    assert not [r for r in current.values() if r['capacity'] >= 70 and r['step_free'] and Decimal(r['hire_cost']) <= 300]
    view = body('custom-view')
    assert view['kind'] == 'custom_view' and view['actions'][0]['kind'] == 'read_binding'
    print(json.dumps({'manifest_files_verified': len(manifest['files']), 'arithmetic_cases': len(cases),
                      'invalid_domain_rejections': len(invalid), 'venue_rows': len(original),
                      'human_edit_preserved': True, 'eligible_after_obstacle': [], 'provider_calls': 0}))


if __name__ == '__main__':
    main()
