"""PDF export entrypoint, executed only inside the fresh rootless namespace.
The DOCX codec remains a separate child with its original, narrower limits.
"""
import base64
import io
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
import unicodedata
import zipfile

PDF_BYTES = 16_000_000
FONTS = {
    'latin': ('DejaVu Serif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 0x41),
    'han': ('WenQuanYi Zen Hei', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 0x96ea),
    'emoji': ('Noto Color Emoji', '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', 0x1f30d),
}


class Refused(Exception):
    pass


def limits():
    for kind, value in [(resource.RLIMIT_AS, 2 * 1024**3), (resource.RLIMIT_CPU, 15),
                        (resource.RLIMIT_FSIZE, 24 * 1024**2), (resource.RLIMIT_NOFILE, 128)]:
        resource.setrlimit(kind, (value, value))


def run_bounded(argv, body, deadline, output_limit):
    # Spool bounded child output inside private /tmp, not unbounded PIPE capture.
    with tempfile.TemporaryFile() as source, tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        source.write(body)
        source.seek(0)
        try:
            child = subprocess.Popen(argv, stdin=source, stdout=out, stderr=err, start_new_session=True)
        except OSError:
            raise Refused('pdf_renderer_unavailable')
        try:
            while True:
                if os.fstat(out.fileno()).st_size > output_limit or os.fstat(err.fileno()).st_size > 16384:
                    raise Refused('pdf_child_output_limit')
                if time.monotonic() >= deadline:
                    raise Refused('pdf_render_timeout')
                if child.poll() is not None:
                    break
                time.sleep(.02)
            out.seek(0)
            return child.returncode, out.read(output_limit + 1)
        finally:
            # Also terminate descendants on error/success, including a renderer
            # wrapper that exits early. Namespace teardown is the outer backstop.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()


def checked_pdf(path):
    if not path.is_file():
        raise Refused('pdf_invalid_output')
    if path.stat().st_size > PDF_BYTES:
        raise Refused('pdf_output_limit')
    data = path.read_bytes()
    if not re.match(rb'%PDF-1\.[0-9]\r?\n', data) or not re.search(rb'%%EOF\s*$', data[-64:]):
        raise Refused('pdf_invalid_output')
    # LibreOffice's fixed Writer PDF export emits a classic cross-reference table.
    # Check its offset/trailer, not just a plausible magic prefix on partial output.
    tail = re.search(rb'startxref\s+(\d+)\s+%%EOF\s*$', data[-128:])
    if not tail or len(tail[1]) > 10:
        raise Refused('pdf_invalid_output')
    offset = int(tail[1])
    if data[offset:offset+5] != b'xref\n' or not re.search(rb'trailer\s*<<.*?/Root\s+\d+\s+\d+\s+R', data[offset:], re.S):
        raise Refused('pdf_invalid_output')
    return data


def font_charsets(deadline):
    coverage = {}
    for key, (family, path, probe) in FONTS.items():
        try:
            code, output = run_bounded(['/usr/bin/fc-match', '-f', '%{family}\n%{file}\n%{charset}\n', family], b'', deadline, 65536)
        except Refused as error:
            if str(error) == 'pdf_renderer_unavailable':
                raise Refused('pdf_fonts_unavailable')
            raise
        try:
            names, filename, charset = output.decode('utf-8').splitlines()
            # fc-match exits zero even for a missing family and substitutes one.
            if code or family not in names.split(',') or filename != path or not Path(path).is_file():
                raise ValueError('font substituted')
            ranges = []
            for token in charset.split():
                if not re.fullmatch(r'[0-9a-f]{1,6}(?:-[0-9a-f]{1,6})?', token):
                    raise ValueError('invalid charset')
                bounds = [int(n, 16) for n in token.split('-')]
                low, high = bounds[0], bounds[-1]
                if not 0 <= low <= high <= 0x10ffff:
                    raise ValueError('invalid range')
                ranges.append((low, high))
            if not any(low <= probe <= high for low, high in ranges):
                raise ValueError('missing required glyph')
            coverage[key] = ranges
        except (ValueError, UnicodeError):
            raise Refused('pdf_fonts_unavailable')
    return coverage


def check_text(text, coverage):
    # Bounded qualification, not a promise for every Unicode script or emoji
    # sequence. Refuse shaping/control/combining sequences rather than dropping
    # them or silently producing missing-glyph boxes. Never normalize the text.
    for char in set(text):
        cp, category = ord(char), unicodedata.category(char)
        if char in '\t\r\n':
            continue
        if 0x20 <= cp <= 0x24f and category[0] not in 'CM':
            key = 'latin'
        elif 0x2000 <= cp <= 0x206f and category[0] in 'PZ':
            key = 'latin'
        elif 0x3400 <= cp <= 0x4dbf or 0x4e00 <= cp <= 0x9fff:
            key = 'han'
        elif 0x1f300 <= cp <= 0x1faff and category == 'So':
            key = 'emoji'
        else:
            raise Refused('pdf_unsupported_text')
        if not any(low <= cp <= high for low, high in coverage[key]):
            raise Refused('pdf_missing_glyph')


def map_generated_fonts(data, codec):
    # Only called for our codec's bounded output. Reuse its strict ZIP/XML
    # preflight (duplicates, trailing records, inflated bounds, DTDs, etc.).
    # Preserve namespace prefixes and every other part/element/attribute/text.
    codec['preflight'](data)
    from lxml import etree
    q = codec['q']
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(out, 'w', allowZip64=False) as target:
        for entry in source.infolist():
            part = source.read(entry)
            if entry.filename == 'word/document.xml':
                root = etree.fromstring(part, etree.XMLParser(resolve_entities=False, no_network=True))
                for props in root.iter(q('rPr')):
                    fonts = props.find(q('rFonts'))
                    if fonts is None:
                        fonts = etree.Element(q('rFonts'))
                        props.insert(0, fonts)
                    fonts.set(q('ascii'), FONTS['latin'][0])
                    fonts.set(q('hAnsi'), FONTS['latin'][0])
                    fonts.set(q('eastAsia'), FONTS['han'][0])
                part = etree.tostring(root, encoding='UTF-8', xml_declaration=True, standalone=True)
                if len(part) > codec['ENTRY']:
                    raise Refused('pdf_codec_refused')
            target.writestr(entry, part)
    result = out.getvalue()
    if len(result) > 2_000_000:
        raise Refused('pdf_codec_refused')
    return result


def intermediate():
    # Same codec/limits, in the dedicated venv child. DOCX export is unchanged;
    # only this private PDF intermediate receives the rendering font policy.
    import runpy
    codec = runpy.run_path('/codec.py')
    raw = sys.stdin.buffer.read(4_500_001)
    if len(raw) > 4_500_000:
        raise Refused('pdf_codec_refused')
    request = json.loads(raw)
    result = codec['export_document'](request['document'])
    data = map_generated_fonts(base64.b64decode(result['base64'], validate=True), codec)
    print(json.dumps({'base64': base64.b64encode(data).decode('ascii')}))


def main():
    limits()
    deadline = time.monotonic() + 25
    raw = sys.stdin.buffer.read(4_500_001)
    if len(raw) > 4_500_000:
        raise Refused('pdf_codec_refused')
    request = json.loads(raw)
    if not isinstance(request, dict) or set(request) != {'op', 'document'} or request['op'] != 'export':
        raise Refused('pdf_codec_refused')
    if not os.access('/usr/bin/soffice', os.X_OK):
        raise Refused('pdf_renderer_unavailable')
    check_text(request['document']['body']['dataStream'], font_charsets(deadline))
    code, output = run_bounded(['/venv/bin/python', '-I', '/render.py', '--intermediate'], raw, min(deadline, time.monotonic() + 12), 6_000_000)
    try:
        result = json.loads(output)
    except (ValueError, UnicodeError):
        raise Refused('pdf_codec_unavailable')
    if code or result.get('error'):
        raise Refused('pdf_codec_refused')
    data = base64.b64decode(result['base64'], validate=True)
    if len(data) > 2_000_000 or not data.startswith(b'PK'):
        raise Refused('pdf_codec_refused')
    Path('/tmp/source.docx').write_bytes(data)
    # Fixed input/options; no raw Office upload, links, macros or HTML injection.
    code, _ = run_bounded(['/usr/bin/soffice', '-env:UserInstallation=file:///tmp/lo-profile',
                           '--headless', '--convert-to', 'pdf:writer_pdf_Export',
                           '--outdir', '/tmp', '/tmp/source.docx'], b'', deadline, 65536)
    if code:
        raise Refused('pdf_render_failed')
    pdf = checked_pdf(Path('/tmp/source.pdf'))
    print(json.dumps({'base64': base64.b64encode(pdf).decode('ascii')}))


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--intermediate']:
            intermediate()
        else:
            main()
    except Refused as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'pdf_render_failed'}))
        sys.exit(1)
