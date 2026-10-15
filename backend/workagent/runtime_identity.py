"""Auditable runtime identity independent of documentation and frontend commits.

This is evidence, not authority. Different runtime bytes still require a new grant
or existing owner-installed successor approval; historical bindings never change.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path


def manifest(root):
    root=Path(root)
    files=sorted([*root.glob('backend/workagent/*.py'),*root.glob('backend/migrations/*.sql'),
        *root.glob('backend/requirements*.txt'),*root.glob('contracts/**/*.json')])
    if not files:raise ValueError('runtime files missing')
    hashes={str(p.relative_to(root)):sha256(p.read_bytes()).hexdigest() for p in files}
    canonical=json.dumps(hashes,sort_keys=True,separators=(',',':')).encode()
    return {'version':'workagent-runtime-identity-v1','runtime_sha256':sha256(canonical).hexdigest(),'files':hashes}


def compare(before,after):
    a=before['files'];b=after['files']
    changed=sorted(k for k in a.keys()|b.keys() if a.get(k)!=b.get(k))
    return {'runtime_identical':not changed,'changed_runtime_files':changed,
        'authority_effect':'none; historical grant/attempt bindings are immutable'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2])
    p.add_argument('--compare',type=Path)
    a=p.parse_args();result=manifest(a.root)
    if a.compare:result=compare(json.loads(a.compare.read_text()),result)
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
