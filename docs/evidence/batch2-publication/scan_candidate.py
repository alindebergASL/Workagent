"""Content-free publication scan; never examines .local or private fixture files.
Run from the repository root. Reads explicit tracked/unignored candidate paths only.
Potential matches require human classification; no matched values are emitted.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess

PATTERNS = {
    'credential_url': r'(?:postgres(?:ql)?|https?)://[^\s/\"\']+:[^\s/\"\']+@',
    'private_key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'provider_key': r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{35,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})',
    'literal_credential': r'(?i)(?:api_key|secret|password|bearer|token)\s*[=:]\s*[\"\'][^\"\'\n]{12,}[\"\']',
    'restricted_customer': r'(?i)\bcisco\b',
}

def scan(data):
    text=data.decode('utf-8',errors='replace')
    return [{'kind':kind,'line':text.count('\n',0,m.start())+1} for kind,rx in PATTERNS.items() for m in re.finditer(rx,text)]

if __name__=='__main__':
    # Positive and benign controls ensure a broken scanner cannot silently pass.
    assert any(x['kind']=='provider_key' for x in scan(('ghp_'+'x'*36).encode()))
    assert any(x['kind']=='credential_url' for x in scan(b'postgresql://user:password@localhost/db'))
    assert scan(b'ordinary synthetic test evidence')==[]
    names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
    files=sorted(set(p for p in names if p and '.local' not in Path(p).parts))
    assert not any(Path(p).name.endswith('.env') for p in files)
    hits=[]; hashes={}
    for name in files:
        p=Path(name)
        if not p.is_file():continue
        data=p.read_bytes();hashes[name]=hashlib.sha256(data).hexdigest()
        if b'\0' in data[:8192]:continue
        hits.extend({'path':name,**hit} for hit in scan(data))
    print(json.dumps({'files':len(hashes),'positive_controls':2,'negative_controls':1,'potential_matches':hits},indent=2))
