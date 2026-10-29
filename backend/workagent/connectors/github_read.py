"""Bounded GET-only GitHub public API. Source strings are inert evidence.

No cache, credentials, proxies, netrc, retries, redirects or returned URL traversal.
A clean isolated child shares public_retrieval's DNS validation and pinned TLS.
"""
import base64
from hashlib import sha256, sha1
import json
from pathlib import Path
import re
import runpy
import subprocess
import sys
from datetime import datetime, timezone

MAX_BYTES = 262144
TOTAL_SECONDS = 15
HOST = 'api.github.com'
SLUG = r'[A-Za-z0-9][A-Za-z0-9_-]{0,38}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}'
PATH = re.compile(r'^/repos/' + SLUG + r'/(?:issues\?state=all&page=[1-5]&per_page=(?:[1-9]|1[0-9]|20)|releases\?page=[1-5]&per_page=(?:[1-9]|1[0-9]|20)|commits\?per_page=1|readme\?ref=[a-f0-9]{40}|issues/[1-9][0-9]{0,9}|releases/[1-9][0-9]{0,9})$')


def endpoint(request):
    root = '/repos/' + request.repository
    if request.kind == 'github_discover':
        tail = ('/commits?per_page=1' if request.resource == 'readme' else
                '/issues?state=all&page=' + str(request.page) + '&per_page=' + str(request.per_page)
                if request.resource == 'issues' else
                '/releases?page=' + str(request.page) + '&per_page=' + str(request.per_page))
    else:
        tail = '/readme?ref=' + request.commit if request.resource == 'readme' else '/' + request.resource + '/' + str(request.number)
    path = root + tail
    if not PATH.fullmatch(path):
        raise ValueError('invalid endpoint')
    return path


def _bounded_int(value, maximum):
    return min(int(value), maximum) if isinstance(value, str) and re.fullmatch(r'[0-9]{1,12}', value) else None


def retrieve(path):
    if not isinstance(path, str) or not PATH.fullmatch(path):
        return {'status': 'denied'}
    transport = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'public_retrieval.py'))
    connection = None
    try:
        connection = transport['PinnedHTTPS'](HOST, transport['resolve'](HOST))
        connection.request('GET', path, headers={'Accept': 'application/vnd.github+json',
            'Accept-Encoding': 'identity', 'User-Agent': 'Workagent-public-read-v1', 'X-GitHub-Api-Version': '2022-11-28'})
        response = connection.getresponse()
        if response.status == 429 or (response.status == 403 and (response.getheader('X-RateLimit-Remaining') == '0' or response.getheader('Retry-After') is not None)):
            return {'status': 'rate_limited', 'retry_after_seconds': _bounded_int(response.getheader('Retry-After'), 86400),
                    'reset_epoch_seconds': _bounded_int(response.getheader('X-RateLimit-Reset'), 4102444800)}
        if response.status == 404: return {'status': 'not_found'}
        if response.status in (401, 403) or 300 <= response.status < 400: return {'status': 'denied'}
        if response.status != 200 or response.getheader('Content-Encoding', 'identity') != 'identity': return {'status': 'unavailable'}
        if response.getheader('Content-Type', '').split(';')[0] != 'application/json': return {'status': 'unavailable'}
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES: return {'status': 'unavailable'}
        etag = response.getheader('ETag')
        if etag is not None and (len(etag) > 512 or any(ord(c) < 32 or ord(c) > 126 for c in etag)): etag = None
        link = response.getheader('Link', '')
        has_more = isinstance(link, str) and len(link) <= 8192 and bool(re.search(r';\s*rel="next"(?:\s*,|\s*$)', link))
        return {'status': 'available', 'raw_base64': base64.b64encode(raw).decode(), 'has_more': has_more,
                'etag': etag, 'content_type': response.getheader('Content-Type'), 'observed_at': datetime.now(timezone.utc).isoformat()}
    except transport['Rejected']:
        return {'status': 'denied'}
    except Exception:
        return {'status': 'unavailable'}
    finally:
        if connection is not None: connection.close()


def fetch(request):
    path = endpoint(request)
    try:
        child = subprocess.run([sys.executable, '-I', __file__, '--get'], input=path.encode(),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={}, timeout=TOTAL_SECONDS, check=True)
        return {**json.loads(child.stdout), 'source': 'live_public'}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {'status': 'unavailable', 'source': 'live_public'}


def evidence(request, response):
    """Exact raw response plus bounded extraction; no source-authored authority."""
    raw = base64.b64decode(response['raw_base64'], validate=True)
    if len(raw) > MAX_BYTES: raise ValueError('bounded response required')
    value = json.loads(raw)
    digest = sha256(raw).hexdigest()
    blob_sha = None
    omissions = []
    if request.resource == 'readme' and request.kind == 'github_discover':
        if not isinstance(value, list) or len(value) != 1 or not re.fullmatch(r'[a-f0-9]{40}', value[0].get('sha', '')):
            raise ValueError('exact commit discovery required')
        extracted = {'commit': value[0]['sha'], 'notice': 'README availability and body require an exact commit read.'}
    elif request.resource == 'readme':
        if not isinstance(value, dict) or value.get('encoding') != 'base64': raise ValueError('readme encoding')
        content = base64.b64decode(''.join(value['content'].split()), validate=True)
        blob_sha = sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
        if value.get('sha') != blob_sha: raise ValueError('blob hash mismatch')
        extracted = {'name': value.get('name'), 'text': content.decode('utf-8'), 'blob_sha': blob_sha}
    else:
        rows = value if request.kind == 'github_discover' else [value]
        if not isinstance(rows, list) or len(rows) > (request.per_page if request.kind == 'github_discover' else 1): raise ValueError('bounded rows')
        if any(not isinstance(row, dict) for row in rows): raise ValueError('object rows required')
        if request.kind == 'github_read' and rows[0].get('number' if request.resource == 'issues' else 'id') != request.number:
            raise ValueError('resource identity mismatch')
        keys = ('id', 'number', 'title', 'name', 'body', 'state', 'tag_name', 'created_at', 'updated_at', 'published_at')
        extracted = [{k: row[k] for k in keys if k in row} for row in rows]
        if request.kind == 'github_discover':
            for item in extracted:
                body = item.get('body')
                if isinstance(body, str) and len(body) > 2000:
                    item['body'] = body[:2000]
                    omissions.append('Body excerpt limited to 2000 characters for record '+str(item.get('number') or item.get('id'))+'; full API response retained, exact read available.')
        if request.resource == 'issues':
            for item, row in zip(extracted, rows):
                item['record_type'] = 'pull_request' if 'pull_request' in row else 'issue'
    provenance = {'repository': request.repository, 'resource': request.resource, 'response_sha256': digest,
        'observed_at': response['observed_at'], 'etag': response.get('etag'),
        'commit': getattr(request, 'commit', None), 'blob_sha': blob_sha,
        'source_updated_at': value.get('updated_at') if isinstance(value, dict) and request.resource != 'readme' else None,
        'version_kind': 'commit_and_blob' if getattr(request, 'commit', None) else 'retained_response'}
    text = json.dumps({'provenance': provenance, 'evidence': extracted}, ensure_ascii=False, separators=(',', ':'))
    if len(text.encode()) > 200000: raise ValueError('bounded extraction')
    url = 'https://' + HOST + endpoint(request)
    material = dict(requested_url=url, final_url=url, status='ok', http_status=200,
        content_type=response.get('content_type', 'application/json'), title='GitHub ' + request.repository + ' ' + request.resource,
        fetched_at=response['observed_at'], redirects=[], raw_base64=response['raw_base64'], content_sha256=digest,
        text=text, text_sha256=sha256(text.encode()).hexdigest(), extractor_version='github-public-read-v1',
        coverage={'body_complete': True, 'text_complete': not omissions, 'omissions': omissions},
        external_version={'etag': response.get('etag'), 'last_modified': None}, extraction_status='extracted', browser_used=False)
    return material


if __name__ == '__main__':
    if sys.argv[1:] != ['--get']: raise SystemExit(2)
    print(json.dumps(retrieve(sys.stdin.buffer.read(2049).decode('ascii'))))
