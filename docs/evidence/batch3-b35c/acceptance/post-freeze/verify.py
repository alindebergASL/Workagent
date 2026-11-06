"""Verify reviewed bytes at this increment; no provider or database operations."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[5]
manifest=json.loads(Path(__file__).with_name('MANIFEST.json').read_text())
for group in ('files','migrations'):
    for name,expected in manifest[group].items():
        actual=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
        if actual!=expected:raise SystemExit('Hash mismatch: '+name)
print(json.dumps(dict(status='PASS',source_and_evidence_files=len(manifest['files']),unchanged_migrations=len(manifest['migrations']),paid_calls=0,scope='Exact reviewed corrective increment; not product acceptance')))
