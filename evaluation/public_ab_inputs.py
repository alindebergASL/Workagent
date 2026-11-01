#!/usr/bin/env python3
"""Evaluator-only public A/B preparation. Never mount this module into product.

Only unauthenticated HTTPS GETs to the fixed official URL catalog are allowed.
No provider, search, judge, DB, grant, installed service or product calls.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PREP = ROOT / '.local/batch3/b35c/preparation'
PUBLIC = PREP / 'public-inputs'
PRIVATE = PREP / 'evaluator'
BINDINGS = ROOT / 'docs/evidence/batch3-b35c/functional/INPUT_BINDINGS.json'
CATALOG = {
    'pathlib311': 'https://docs.python.org/3.11/library/pathlib.html',
    'pathlib312': 'https://docs.python.org/3.12/library/pathlib.html',
    'datetime310': 'https://docs.python.org/3.10/library/datetime.html',
    'datetime311': 'https://docs.python.org/3.11/library/datetime.html',
    'wai-writing': 'https://www.w3.org/WAI/tips/writing/',
    'wai-evaluation': 'https://www.w3.org/WAI/test-evaluate/preliminary/',
    'python311-release': 'https://www.python.org/downloads/release/python-3110/',
    'python312-release': 'https://www.python.org/downloads/release/python-3120/',
}

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def canonical(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()

def put(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else canonical(data))

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.ignore = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.ignore += 1
        if tag in ('p', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'li', 'dt', 'dd', 'br'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.ignore -= 1
        if tag in ('p', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'li', 'dt', 'dd'): self.parts.append('\n')
    def handle_data(self, data):
        if not self.ignore: self.parts.append(data)
    def text(self):
        return '\n'.join(' '.join(line.split()) for line in ''.join(self.parts).splitlines() if line.strip()) + '\n'

def extract(raw):
    parser = Text()
    parser.feed(raw.decode('utf-8'))
    return parser.text()

class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        from urllib.parse import urlsplit
        u = urlsplit(newurl)
        if u.scheme != 'https' or u.hostname not in {'docs.python.org', 'www.python.org', 'www.w3.org'}:
            raise ValueError('Redirect outside official HTTPS hosts')
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def fetch():
    if (PRIVATE / 'FREEZE.json').exists():
        raise ValueError('Frozen package: do not overwrite; later live refresh must be separately recorded')
    opener = urllib.request.build_opener(OfficialRedirect())
    for sid, url in CATALOG.items():
        dest = PRIVATE / 'retrieval' / sid
        if dest.with_suffix('.json').exists():
            print('Retained', sid)
            continue
        started = datetime.now(timezone.utc).isoformat()
        request = urllib.request.Request(url, headers={'User-Agent': 'WorkagentPublicEvidence/1.0'}, method='GET')
        with opener.open(request, timeout=60) as r:
            raw = r.read(5_000_001)
            if len(raw) > 5_000_000: raise ValueError('Source exceeds preparation safety bound')
            receipt = {'id': sid, 'requested_url': url, 'final_url': r.url,
                       'retrieved_at': started, 'completed_at': datetime.now(timezone.utc).isoformat(),
                       'http_status': r.status, 'content_type': r.headers.get('Content-Type'),
                       'etag': r.headers.get('ETag'), 'last_modified': r.headers.get('Last-Modified'),
                       'raw_sha256': sha(raw), 'raw_bytes': len(raw),
                       'method': 'GET', 'phase': 'frozen-public-source-preparation'}
        text = extract(raw).encode()
        receipt['text_sha256'] = sha(text)
        put(dest.with_suffix('.html'), raw)
        put(dest.with_suffix('.txt'), text)
        put(dest.with_suffix('.json'), receipt)
        print(sid, receipt['http_status'], receipt['raw_bytes'], receipt['raw_sha256'])

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['fetch', 'build', 'verify', 'self-test'])
    args = p.parse_args()
    if args.command == 'fetch': fetch()
    else:
        import runpy
        module = runpy.run_path(str(PRIVATE / 'authoring.py'))
        module[args.command.replace('-', '_')]()

if __name__ == '__main__': main()
