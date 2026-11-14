"""Text-layer extraction. Production entrypoint is ONLY the PDF bwrap worker.
No rendering, OCR, attachment handling, JavaScript or external resource fetches.
"""
import base64
import json
import os
from pathlib import Path
import re
import resource
import signal
import subprocess
import sys
import tempfile
import time

PDF_BYTES = 16_000_000
TEXT_BYTES = 200_000
PAGES = 200

class Refused(Exception):
    pass

def run(argv, deadline, limit):
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err, env={'LANG': 'C.UTF-8', 'HOME': '/tmp'}, start_new_session=True)
        try:
            while True:
                if os.fstat(out.fileno()).st_size > limit or os.fstat(err.fileno()).st_size > 16384:
                    raise Refused('pdf_extraction_output_limit')
                if time.monotonic() >= deadline:
                    raise Refused('pdf_extract_timeout')
                if child.poll() is not None:
                    break
                time.sleep(.01)
            out.seek(0); err.seek(0)
            output, errors = out.read(limit + 1), err.read(16385)
            if len(output) > limit or len(errors) > 16384:
                raise Refused('pdf_extraction_output_limit')
            if b'Incorrect password' in errors or b'password' in errors.lower():
                raise Refused('pdf_encrypted_not_supported')
            # Poppler sometimes recovers damaged files; do not adopt that partial text.
            if child.returncode in (-signal.SIGKILL, -signal.SIGXCPU, -signal.SIGXFSZ):
                raise Refused('pdf_extract_resource_limit')
            if child.returncode or errors:
                raise Refused('pdf_malformed')
            return output
        finally:
            try: os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            child.wait()

def map_text(raw, pages):
    if len(raw) > TEXT_BYTES:
        raise Refused('pdf_text_limit')
    try: extracted = raw.decode('utf-8', errors='strict')
    except UnicodeError: raise Refused('pdf_unsupported_text')
    # Poppler emits one FF per page (including the last), LF line endings.
    # Remove only that final FF and one terminal LF per page. Every remaining
    # LF becomes a native paragraph boundary; join pages with TWO LF (a blank
    # paragraph). Never trim spaces, join hyphenated lines or normalize Unicode.
    if not extracted.endswith('\f') or extracted.count('\f') != pages:
        raise Refused('pdf_incomplete_extraction')
    parts = extracted[:-1].split('\f')
    text = '\n\n'.join(p[:-1] if p.endswith('\n') else p for p in parts)
    if re.search(r'[\x00-\x08\x0b-\x1f\x7f]', text):
        raise Refused('pdf_unsupported_text')
    if len(text.encode('utf-8')) > TEXT_BYTES:
        raise Refused('pdf_text_limit')
    if text.count('\n') + 1 > 10000:
        raise Refused('pdf_paragraph_limit')
    if not any(c.isalnum() for c in text):
        raise Refused('pdf_ocr_not_supported')
    # A text-bearing page must not mask a scanned or blank page. This is
    # deliberately conservative; text inside images on otherwise text-bearing
    # pages is still outside the text-layer-only contract.
    if any(not any(c.isalnum() for c in page) for page in parts):
        raise Refused('pdf_page_without_text')
    return {'text': text, 'pages': pages}

def extract(request):
    if not isinstance(request, dict) or set(request) != {'op', 'base64'} or request['op'] != 'import':
        raise Refused('invalid_pdf_input')
    encoded = request['base64']
    if not isinstance(encoded, str) or len(encoded) > ((PDF_BYTES + 2) // 3) * 4:
        raise Refused('pdf_input_limit')
    try: data = base64.b64decode(encoded, validate=True)
    except ValueError: raise Refused('invalid_pdf_bytes')
    if len(data) > PDF_BYTES: raise Refused('pdf_input_limit')
    # All inspection of PDF syntax, even this envelope check, is inside isolation.
    if not re.match(rb'%PDF-(?:1\.[0-9]|2\.0)\r?\n', data) or not re.search(rb'%%EOF\s*$', data[-1024:]):
        raise Refused('pdf_malformed')
    deadline = time.monotonic() + 20
    with tempfile.TemporaryDirectory() as directory:
        path = str(Path(directory) / 'source.pdf')
        Path(path).write_bytes(data)
        info = run(['/usr/bin/pdfinfo', '-enc', 'UTF-8', path], deadline, 65536)
        # Match mandatory fields from the end: untrusted metadata can contain LF.
        encrypted = re.findall(rb'^Encrypted:\s+(yes|no)\b', info, re.M)
        counts = re.findall(rb'^Pages:\s+(\d+)\s*$', info, re.M)
        if not encrypted or not counts: raise Refused('pdf_malformed')
        if encrypted[-1] == b'yes': raise Refused('pdf_encrypted_not_supported')
        pages = int(counts[-1])
        if not 1 <= pages <= PAGES: raise Refused('pdf_page_limit')
        raw = run(['/usr/bin/pdftotext', '-enc', 'UTF-8', '-eol', 'unix', path, '-'], deadline, TEXT_BYTES)
        return map_text(raw, pages)

def main():
    for kind, value in [(resource.RLIMIT_AS, 512 * 1024**2), (resource.RLIMIT_CPU, 8),
                        (resource.RLIMIT_FSIZE, 17_000_000), (resource.RLIMIT_NOFILE, 64)]:
        resource.setrlimit(kind, (value, value))
    raw = sys.stdin.buffer.read(21_334_001)
    if len(raw) > 21_334_000: raise Refused('pdf_input_limit')
    print(json.dumps(extract(json.loads(raw)), ensure_ascii=True))

if __name__ == '__main__':
    try: main()
    except Refused as error:
        print(json.dumps({'error': str(error)})); sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'pdf_extract_failed'})); sys.exit(1)
