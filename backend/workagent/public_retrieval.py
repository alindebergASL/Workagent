"""Bounded unauthenticated public HTTPS GET, never an authority source.

A disposable credential-free subprocess bounds DNS, TLS, headers and slow bodies
with one wall-clock deadline. Connect directly to the checked numeric address;
TLS still verifies the original hostname. No proxy, cookie jar, auth or JS engine.
"""
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
import base64
import http.client
import ipaddress
import json
import re
import socket
import ssl
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit, urljoin, quote

MAX_BYTES = 262144
MAX_TEXT = 20000
MAX_REDIRECTS = 3
TOTAL_SECONDS = 15
SOCKET_SECONDS = 5
# Conservative special-use exclusions supplement stdlib registries, whose
# classification can lag IANA (notably documentation/ORCHID/6to4 ranges).
SPECIAL_V4 = tuple(ipaddress.ip_network(value) for value in ('192.0.0.0/24', '192.88.99.0/24'))
SPECIAL_V6 = tuple(ipaddress.ip_network(value) for value in ('2001::/23', '2002::/16', '3fff::/20'))
GLOBAL_V6 = ipaddress.ip_network('2000::/3')


class Rejected(ValueError):
    pass


def destination(url):
    if (not isinstance(url, str) or not 1 <= len(url) <= 2048
            or re.search(r'[\s\x00-\x1f\x7f\\]', url)):
        raise Rejected('invalid_url')
    try:
        parts = urlsplit(url)
        if (parts.scheme != 'https' or not parts.hostname or parts.username is not None
                or parts.password is not None or parts.port not in (None, 443)):
            raise Rejected('https_public_only')
        host = parts.hostname.encode('idna').decode('ascii').lower()
        if '%' in host or host.endswith('.') or not re.fullmatch(r'[a-z0-9.:-]+', host):
            raise Rejected('invalid_host')
        # Empty explicit ports and ambiguous authorities fail closed too.
        authority = ('[' + host + ']' if ':' in host else host)
        if parts.netloc.lower() not in (authority, authority + ':443'):
            raise Rejected('invalid_host')
        path = quote(parts.path or '/', safe="/%:@!$&'()*+,;=-._~")
        query = quote(parts.query, safe="/%?:@!$&'()*+,;=-._~")
        return urlunsplit(('https', authority, path, query, '')), host, path + ('?' + query if query else '')
    except (ValueError, UnicodeError) as exc:
        if isinstance(exc, Rejected):
            raise
        raise Rejected('invalid_url') from None


def public_address(value):
    try:
        address = ipaddress.ip_address(value)
        if isinstance(address, ipaddress.IPv4Address):
            if any(address in network for network in SPECIAL_V4):
                return False
        elif address not in GLOBAL_V6 or any(address in network for network in SPECIAL_V6):
            return False
        return (address.is_global and not address.is_reserved and not address.is_multicast
                and not address.is_loopback and not address.is_link_local
                and not address.is_unspecified
                and not (isinstance(address, ipaddress.IPv6Address)
                         and (address.ipv4_mapped or address.sixtofour or address.teredo
                              or address in ipaddress.ip_network('64:ff9b::/96')
                              or address in ipaddress.ip_network('64:ff9b:1::/48'))))
    except ValueError:
        return False


def resolve(host):
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
    if not addresses or any(family not in (socket.AF_INET, socket.AF_INET6)
                            or not public_address(sockaddr[0])
                            for family, _, _, _, sockaddr in addresses):
        raise Rejected('non_public_destination')
    return addresses[0]


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address):
        self.tls_context = ssl.create_default_context()
        super().__init__(host, port=443, timeout=SOCKET_SECONDS, context=self.tls_context)
        self.address = address

    def connect(self):
        family, socktype, proto, _, sockaddr = self.address
        raw = socket.socket(family, socktype, proto)
        try:
            raw.settimeout(SOCKET_SECONDS)
            raw.connect(sockaddr)  # numeric sockaddr, NEVER a second resolver
            self.sock = self.tls_context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


class PageText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ignored = []
        self.parts = []
        self.title_parts = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'template', 'noscript'):
            self.ignored.append(tag)
        if tag == 'title':
            self.in_title = True
        if tag in ('p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'section') and not self.ignored:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if self.ignored and tag == self.ignored[-1]:
            self.ignored.pop()
        if tag == 'title':
            self.in_title = False
        if tag in ('p', 'div', 'li', 'tr') and not self.ignored:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)
            if self.in_title:
                self.title_parts.append(data)


def extract(body, content_type):
    # UTF-8 or ISO-8859-1 only; no arbitrary codec loading or decompression.
    charset = re.search(r'charset\s*=\s*["\']?([^\s;"\']+)', content_type, re.I)
    encoding = charset.group(1).lower() if charset else 'utf-8'
    if encoding not in ('utf-8', 'utf8', 'us-ascii', 'ascii', 'iso-8859-1', 'latin-1', 'windows-1252'):
        raise Rejected('unsupported_charset')
    decoded = body.decode(encoding, errors='replace')
    title = None
    if content_type.split(';')[0].strip().lower() in ('text/html', 'application/xhtml+xml'):
        parser = PageText()
        parser.feed(decoded)
        decoded = ''.join(parser.parts)
        title = ' '.join(''.join(parser.title_parts).replace('\x00', '').split())[:300] or None
    text = '\n'.join(' '.join(line.split()) for line in decoded.splitlines())
    text = re.sub(r'\n{3,}', '\n\n', text).strip().replace('\x00', '')
    return text[:MAX_TEXT], title, len(text) > MAX_TEXT


def empty_result(url):
    return {'requested_url': url, 'final_url': None, 'fetched_at': datetime.now(timezone.utc).isoformat(),
            'status': 'error', 'http_status': None, 'content_type': None, 'title': None,
            'text': '', 'text_sha256': sha256(b'').hexdigest(), 'truncated': False,
            'bytes_read': 0, 'redirects': [], 'error': None,
            'provenance': 'public_https_get', 'trust': 'untrusted_external_content',
            'limits': {'body_bytes': MAX_BYTES, 'text_characters': MAX_TEXT,
                       'redirects': MAX_REDIRECTS, 'total_seconds': TOTAL_SECONDS}}


def retrieve(url, *, retain_source=False):
    """Worker implementation; production callers MUST use subprocess wrappers."""
    result = empty_result(url)
    try:
        current = url
        for hop in range(MAX_REDIRECTS + 1):
            canonical, host, target = destination(current)
            address = resolve(host)
            result['final_url'] = canonical
            connection = PinnedHTTPS(host, address)
            try:
                connection.request('GET', target, headers={
                    'User-Agent': 'Workagent-PublicReader/1.0', 'Accept': 'text/html, text/plain, application/xhtml+xml, application/json',
                    'Accept-Encoding': 'identity', 'Connection': 'close'})
                response = connection.getresponse()
                result['http_status'] = response.status
                if response.status in (301, 302, 303, 307, 308):
                    if hop == MAX_REDIRECTS:
                        raise Rejected('redirect_limit')
                    location = response.getheader('Location')
                    if not location:
                        raise Rejected('invalid_redirect')
                    # Validate before retaining or contacting the next destination.
                    next_url, _, _ = destination(urljoin(canonical, location))
                    result['redirects'].append({'url': canonical, 'status': response.status, 'location': next_url})
                    current = next_url
                    continue
                if not 200 <= response.status < 300:
                    raise Rejected('http_error')
                content_type = response.getheader('Content-Type', '')
                result['content_type'] = content_type[:200].replace('\x00', '')
                if content_type.split(';')[0].strip().lower() not in (
                        'text/html', 'text/plain', 'application/xhtml+xml', 'application/json'):
                    raise Rejected('unsupported_content_type')
                if response.getheader('Content-Encoding', 'identity').strip().lower() != 'identity':
                    raise Rejected('unsupported_content_encoding')
                chunks, size = [], 0
                while size <= MAX_BYTES:
                    chunk = response.read1(min(16384, MAX_BYTES + 1 - size))
                    if not chunk:
                        if response.length not in (None, 0):
                            raise Rejected('network_error')  # incomplete declared body
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                body = b''.join(chunks)
                result['bytes_read'] = min(size, MAX_BYTES)
                text, title, shortened = extract(body[:MAX_BYTES], content_type)
                result.update(status='ok', text=text, title=title, truncated=size > MAX_BYTES or shortened,
                              text_sha256=sha256(text.encode('utf-8')).hexdigest())
                if retain_source:
                    retained = body[:MAX_BYTES]
                    omissions = []
                    if size > MAX_BYTES:
                        omissions.append('Body byte limit: hash identifies retained prefix, not the full response.')
                    if shortened:
                        omissions.append('Extracted text character limit reached; missing text is not evidence of absence.')
                    if not text:
                        omissions.append('No readable static text; this is not evidence that the source has no information.')
                    result.update(raw_base64=base64.b64encode(retained).decode('ascii'),
                        content_sha256=sha256(retained).hexdigest(), extractor_version='public-text-v2',
                        coverage={'body_complete':size <= MAX_BYTES, 'text_complete':not shortened and size <= MAX_BYTES,
                                  'omissions':omissions},
                        external_version={k:(response.getheader(h) or '')[:300].replace('\x00', '') or None
                                          for k,h in [('etag','ETag'),('last_modified','Last-Modified')]},
                        extraction_status='truncated' if result['truncated'] else 'extracted' if text else 'empty',
                        browser_used=False)
                return result
            finally:
                connection.close()
    except Rejected as exc:
        result['error'] = str(exc)
    except (TimeoutError, socket.timeout):
        result['error'] = 'timeout'
    except (OSError, ssl.SSLError, http.client.HTTPException, ValueError):
        result['error'] = 'network_error'
    return result


def fetch_public_url(url):
    # Validate even before subprocess launch. Neither child env nor transport
    # inherits application credentials, proxy configuration or ambient auth.
    result = empty_result(url)
    try:
        destination(url)
        completed = subprocess.run([sys.executable, '-I', __file__, '--fetch'], input=url.encode('utf-8'),
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env={}, timeout=TOTAL_SECONDS, check=True)
        return json.loads(completed.stdout)
    except Rejected as exc:
        result['error'] = str(exc)
    except subprocess.TimeoutExpired:
        result['error'] = 'timeout'
    except (subprocess.CalledProcessError, OSError, ValueError):
        result['error'] = 'reader_unavailable'
    return result


def fetch_public_source(url, *, allow_browser=False):
    """Exact retained bytes for the opt-in research broker; no credentials/proxy.

    Browser fallback renders only this fetched document offline. It never has a
    network interface or an account profile, and cannot bypass a fetch refusal.
    """
    result = empty_result(url)
    try:
        destination(url)
        completed = subprocess.run([sys.executable, '-I', __file__, '--source'], input=url.encode('utf-8'),
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env={}, timeout=TOTAL_SECONDS, check=True)
        result = json.loads(completed.stdout)
    except Rejected as exc:
        result['error'] = str(exc)
    except subprocess.TimeoutExpired:
        result['error'] = 'timeout'
    except (subprocess.CalledProcessError, OSError, ValueError):
        result['error'] = 'reader_unavailable'
    if (allow_browser and result['status'] == 'ok' and not result['text']
            and result['content_type'].split(';')[0].strip().lower() in ('text/html', 'application/xhtml+xml')
            and result['coverage']['body_complete']):
        from .public_browser import render
        rendered = render(base64.b64decode(result['raw_base64']))
        result['coverage']['omissions'].extend(rendered['omissions'])
        if rendered['status'] == 'ok':
            text, title, shortened = extract(rendered['dom'].encode('utf-8'), 'text/html; charset=utf-8')
            result.update(text=text, title=title, text_sha256=sha256(text.encode()).hexdigest(),
                          browser_used=True, extractor_version=rendered['extractor_version'],
                          extraction_status='truncated' if shortened else 'extracted' if text else 'empty',
                          truncated=result['truncated'] or shortened)
            result['coverage']['text_complete'] = False  # all external assets deliberately denied
        else:
            result['extraction_status'] = 'unavailable'
            result['coverage']['text_complete'] = False
    return result


if __name__ == '__main__':
    if sys.argv[1:] not in (['--fetch'], ['--source']):
        raise SystemExit(2)
    print(json.dumps(retrieve(sys.stdin.buffer.read(8193).decode('utf-8'),
                              retain_source=sys.argv[1:] == ['--source']), ensure_ascii=True))
