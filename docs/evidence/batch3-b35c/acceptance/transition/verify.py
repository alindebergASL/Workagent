"""Verify this narrow exact-source proof; no database/provider calls."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[5]
manifest = json.loads(Path(__file__).with_name('MANIFEST.json').read_text())
for group in ('files', 'dependencies', 'migrations'):
    for name, expected in manifest[group].items():
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit('Hash mismatch: ' + name)
print(json.dumps(dict(status='PASS', files=len(manifest['files']),
    dependencies=len(manifest['dependencies']), migrations=len(manifest['migrations']),
    paid_calls=0, scope='F3 future-only guarded admission; not product acceptance')))
