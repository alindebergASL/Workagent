"""Backend half of the attachment parity vectors: each vector the frontend
admits must validate as AttachmentInput with the same MIME and exact content,
and each it refuses must fail. Usage (repo root):
backend/.venv/bin/python web/scripts/attachment-parity.py"""
import json, pathlib, sys
root = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'backend'))
from workagent.message_models import AttachmentInput  # noqa: E402

vectors = json.loads((root / 'web/test/fixtures/attachment-vectors.json').read_text())['vectors']
failures = []
for v in vectors:
    raw = bytes.fromhex(v['hex'])
    try:
        content = raw.decode('utf-8')  # strict; keeps a BOM as U+FEFF
        mime = 'text/csv' if v['name'].endswith('.csv') else 'text/plain'
        a = AttachmentInput(filename=v['name'], mime_type=mime, content=content)
        admitted, exact = True, a.content.encode('utf-8') == raw and a.mime_type == v.get('mime', mime)
    except Exception:
        admitted, exact = False, True
    if admitted != v['ok'] or not exact:
        failures.append(v['name'])
print(json.dumps({'vectors': len(vectors), 'failures': failures}))
sys.exit(1 if failures else 0)
