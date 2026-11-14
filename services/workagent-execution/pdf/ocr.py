"""Explicit English OCR. Production entrypoint ONLY inside the PDF bwrap namespace.
All metadata, raster and OCR processing stays here; never consult the text layer.
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
SIDE = 2400
PIXELS = 30_000_000
RASTER_BYTES = SIDE * SIDE + 100
TESSDATA = '/usr/share/tesseract-ocr/5/tessdata'
DEADLINE_SECONDS = 50

class Refused(Exception):
    pass

def limits():
    for kind, value in [(resource.RLIMIT_AS, 512 * 1024**2), (resource.RLIMIT_CPU, 10),
                        (resource.RLIMIT_FSIZE, 17_000_000), (resource.RLIMIT_NOFILE, 64)]:
        resource.setrlimit(kind, (value, value))

def run(argv, deadline, limit, *, raster=None, ocr=False):
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        try:
            child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                env={'LANG': 'C.UTF-8', 'HOME': '/tmp', 'OMP_THREAD_LIMIT': '1'}, start_new_session=True)
        except OSError:
            raise Refused('pdf_ocr_runtime_unavailable')
        try:
            while True:
                if os.fstat(out.fileno()).st_size > limit or os.fstat(err.fileno()).st_size > 16384:
                    raise Refused('pdf_ocr_output_limit')
                if raster is not None and raster.exists() and raster.stat().st_size > RASTER_BYTES:
                    raise Refused('pdf_ocr_raster_limit')
                if time.monotonic() >= deadline: raise Refused('pdf_ocr_timeout')
                if child.poll() is not None: break
                time.sleep(.01)
            out.seek(0); err.seek(0)
            output, errors = out.read(limit + 1), err.read(16385)
            if len(output) > limit or len(errors) > 16384: raise Refused('pdf_ocr_output_limit')
            if raster is not None and raster.exists() and raster.stat().st_size > RASTER_BYTES:
                raise Refused('pdf_ocr_raster_limit')
            if b'password' in errors.lower(): raise Refused('pdf_encrypted_not_supported')
            if child.returncode in (-signal.SIGKILL, -signal.SIGXCPU, -signal.SIGXFSZ):
                raise Refused('pdf_ocr_resource_limit')
            if child.returncode: raise Refused('pdf_ocr_failed' if ocr else 'pdf_ocr_render_failed')
            # Tesseract's automatic resolution estimate is informational. Empty
            # page diagnostics are handled by the meaningful-text refusal below.
            # Do not suppress arbitrary warnings or accept stderr-blind success.
            benign = rb'(?:Estimating resolution as [0-9]{1,6}|Empty page!!)'
            if errors and (not ocr or any(not re.fullmatch(benign, line) for line in errors.splitlines())):
                raise Refused('pdf_ocr_diagnostics')
            return output
        finally:
            try: os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            child.wait()

def raster_pixels(path):
    # Only the bounded P5 output of pdftoppm is accepted, parsed in isolation.
    if not path.is_file(): raise Refused('pdf_ocr_invalid_raster')
    if path.stat().st_size > RASTER_BYTES: raise Refused('pdf_ocr_raster_limit')
    with path.open('rb') as source: header = source.read(100)
    match = re.match(rb'P5\n([0-9]{1,6}) ([0-9]{1,6})\n255\n', header)
    if not match: raise Refused('pdf_ocr_invalid_raster')
    width, height = map(int, match.groups())
    if not 1 <= width <= SIDE or not 1 <= height <= SIDE: raise Refused('pdf_ocr_raster_limit')
    if path.stat().st_size != match.end() + width * height: raise Refused('pdf_ocr_invalid_raster')
    return width * height

def map_pages(raw_pages):
    parts = []
    for raw in raw_pages:
        if len(raw) > TEXT_BYTES: raise Refused('pdf_text_limit')
        try: text = raw.decode('utf-8', errors='strict')
        except UnicodeError: raise Refused('pdf_unsupported_text')
        if re.search(r'[\x00-\x08\x0b-\x1f\x7f]', text): raise Refused('pdf_unsupported_text')
        # Conservative meaningful recognition, not a claim that blanks and
        # failed OCR can be distinguished. Punctuation/noise alone is refused.
        if sum(c.isalnum() for c in text) < 3: raise Refused('pdf_ocr_page_without_text')
        parts.append(text[:-1] if text.endswith('\n') else text)
    text = '\n\n'.join(parts)
    if len(text.encode('utf-8')) > TEXT_BYTES: raise Refused('pdf_text_limit')
    if text.count('\n') + 1 > 10000: raise Refused('pdf_paragraph_limit')
    return {'text': text, 'pages': len(parts)}

def extract(request):
    if not isinstance(request, dict) or set(request) != {'op', 'base64', 'mode'} or request['op'] != 'import':
        raise Refused('invalid_pdf_input')
    if request['mode'] != 'ocr-eng': raise Refused('invalid_pdf_mode')
    encoded = request['base64']
    if not isinstance(encoded, str) or len(encoded) > ((PDF_BYTES + 2) // 3) * 4: raise Refused('pdf_input_limit')
    try: data = base64.b64decode(encoded, validate=True)
    except ValueError: raise Refused('invalid_pdf_bytes')
    if len(data) > PDF_BYTES: raise Refused('pdf_input_limit')
    if not re.match(rb'%PDF-(?:1\.[0-9]|2\.0)\r?\n', data) or not re.search(rb'%%EOF\s*$', data[-1024:]):
        raise Refused('pdf_malformed')
    if not all(os.access(p, os.X_OK) for p in ['/usr/bin/pdfinfo', '/usr/bin/pdftoppm', '/usr/bin/tesseract']):
        raise Refused('pdf_ocr_runtime_unavailable')
    if not os.access(TESSDATA + '/eng.traineddata', os.R_OK): raise Refused('pdf_ocr_runtime_unavailable')
    deadline = time.monotonic() + DEADLINE_SECONDS
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / 'source.pdf'; path.write_bytes(data)
        info = run(['/usr/bin/pdfinfo', '-enc', 'UTF-8', str(path)], deadline, 65536)
        encrypted = re.findall(rb'^Encrypted:\s+(yes|no)\b', info, re.M)
        counts = re.findall(rb'^Pages:\s+(\d+)\s*$', info, re.M)
        if not encrypted or not counts: raise Refused('pdf_malformed')
        if encrypted[-1] == b'yes': raise Refused('pdf_encrypted_not_supported')
        pages = int(counts[-1])
        if not 1 <= pages <= 5: raise Refused('pdf_ocr_page_limit')
        raw_pages, pixels, total_text = [], 0, 0
        for page in range(1, pages + 1):
            prefix = Path(directory) / 'page'; raster = prefix.with_suffix('.pgm')
            run(['/usr/bin/pdftoppm', '-f', str(page), '-l', str(page), '-singlefile', '-gray',
                 '-scale-to', str(SIDE), str(path), str(prefix)], deadline, 1024, raster=raster)
            pixels += raster_pixels(raster)
            if pixels > PIXELS: raise Refused('pdf_ocr_raster_limit')
            raw = run(['/usr/bin/tesseract', str(raster), 'stdout', '--tessdata-dir', TESSDATA,
                       '-l', 'eng', '--psm', '3'], deadline, TEXT_BYTES - total_text, ocr=True)
            total_text += len(raw) + (2 if page > 1 else 0)
            if total_text > TEXT_BYTES: raise Refused('pdf_text_limit')
            raw_pages.append(raw)
            map_pages(raw_pages)  # Refuse any empty/failed page and paragraph overflow immediately.
            raster.unlink()  # Only this invocation's temporary output; retain source PDF externally.
        return map_pages(raw_pages)

def main():
    limits()
    raw = sys.stdin.buffer.read(21_334_001)
    if len(raw) > 21_334_000: raise Refused('pdf_input_limit')
    print(json.dumps(extract(json.loads(raw)), ensure_ascii=True))

if __name__ == '__main__':
    try: main()
    except Refused as error:
        print(json.dumps({'error': str(error)})); sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'pdf_ocr_failed'})); sys.exit(1)
