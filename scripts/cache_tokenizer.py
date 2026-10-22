"""Explicit installation-only fetch of public, hash-pinned tokenizer data.

Run with PYTHONPATH=backend. Runtime request packing never downloads this file.
"""
from hashlib import sha256
import os
from pathlib import Path
import tempfile
from urllib.request import urlopen
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from workagent.request_packing import TOKENIZER_URL, TOKENIZER_PATH, TOKENIZER_SHA256


def main():
    target=TOKENIZER_PATH
    if target.exists() and sha256(target.read_bytes()).hexdigest()==TOKENIZER_SHA256:
        print('Verified local o200k tokenizer:',target)
        return
    with urlopen(TOKENIZER_URL,timeout=30) as response:
        raw=response.read(6*1024*1024+1)
    if sha256(raw).hexdigest()!=TOKENIZER_SHA256:
        raise RuntimeError('Tokenizer checksum mismatch')
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent,delete=False) as temp:
        name=Path(temp.name)
        temp.write(raw)
    try:
        os.chmod(name,0o644)
        os.replace(name,target)
    finally:
        name.unlink(missing_ok=True)
    print('Installed verified local o200k tokenizer:',target)


if __name__=='__main__':main()
