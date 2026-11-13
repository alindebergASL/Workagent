"""PDF export entrypoint, executed only inside the fresh rootless namespace.
The DOCX codec remains a separate child with its original, narrower limits.
"""
import base64
import io
import json
import math
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
for _suffix in ('Bold', 'Italic', 'BoldItalic'):
    FONTS['latin_' + _suffix] = ('DejaVu Serif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-' + _suffix + '.ttf', 0x41)
BULLETS = ('●', '•', '○', '■', '▪')


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
            query = family + (':style=' + key[6:].replace('BoldItalic', 'Bold Italic') if key.startswith('latin_') else '')
            code, output = run_bounded(['/usr/bin/fc-match', '-f', '%{family}\n%{file}\n%{charset}\n', query], b'', deadline, 65536)
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


def check_text(text, coverage, marker=False):
    # Bounded qualification, not a promise for every Unicode script or emoji
    # sequence. Refuse shaping/control/combining sequences rather than dropping
    # them or silently producing missing-glyph boxes. Never normalize the text.
    for char in set(text):
        cp, category = ord(char), unicodedata.category(char)
        if char in '\t\r\n':
            continue
        if marker and char in BULLETS:
            key = 'latin'
        elif 0x20 <= cp <= 0x24f and category[0] not in 'CM':
            key = 'latin'
        elif 0x2000 <= cp <= 0x206f and category[0] in 'PZ':
            key = 'latin'
        elif 0x3400 <= cp <= 0x4dbf or 0x4e00 <= cp <= 0x9fff:
            key = 'han'
        elif 0x1f300 <= cp <= 0x1faff and category == 'So':
            key = 'emoji'
        else:
            raise Refused('pdf_unsupported_text')
        # Bold/italic marker and body faces must have glyphs too; checking only
        # regular body text misses symbols emitted by numbering definitions.
        for face in coverage if key == 'latin' else [key]:
            if key == 'latin' and not face.startswith('latin'):
                continue
            if not any(low <= cp <= high for low, high in coverage[face]):
                raise Refused('pdf_missing_glyph')


def validate_document(document):
    """Independent PDF policy before the DOCX child or LibreOffice conversion.

    The codec still validates its native mapping (including effective marker
    inheritance/conflicts). This boundary refuses PDF-unmapped native fields.
    """
    def only(value, keys):
        if not isinstance(value, dict) or set(value) - set(keys):
            raise Refused('unsupported_pdf_formatting')
    def text(value):
        only(value, ['bl', 'it', 'ul', 'fs', 'cl', 'ff', 'eastAsiaFontFamily', 'lang', 'altLang'])
        for key in ('bl', 'it'):
            if key in value and (type(value[key]) is not int or value[key] not in (0, 1)):
                raise Refused('unsupported_pdf_formatting')
        if 'ul' in value:
            only(value['ul'], ['s'])
            if type(value['ul'].get('s')) is not int or value['ul']['s'] not in (0, 1):
                raise Refused('unsupported_pdf_formatting')
        if value.get('cl'):
            only(value['cl'], ['rgb'])
            if value['cl'].get('rgb') and not re.fullmatch(r'#[a-fA-F0-9]{6}', value['cl']['rgb']):
                raise Refused('unsupported_pdf_formatting')
        if 'fs' in value and (type(value['fs']) not in (int, float) or not .1 <= value['fs'] <= 1000 or not float(value['fs'] * 2).is_integer()):
            raise Refused('unsupported_pdf_font_size')
    def paragraph(value):
        only(value, ['horizontalAlign', 'textStyle', 'paragraphMarkTextStyle'])
        if type(value.get('horizontalAlign', 1)) is not int or value.get('horizontalAlign', 1) not in range(6):
            raise Refused('unsupported_pdf_formatting')
        text(value.get('textStyle', {})); text(value.get('paragraphMarkTextStyle', {}))
    geometry = ['pageSize', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHeader', 'marginFooter']
    defaults = dict(documentFlavor=2, autoHyphenation=1, doNotHyphenateCaps=0, consecutiveHyphenLimit=2,
                    defaultHeaderId='', defaultFooterId='', evenPageHeaderId='', evenPageFooterId='',
                    firstPageHeaderId='', firstPageFooterId='', evenAndOddHeaders=0, useFirstPageHeaderFooter=0)
    only(document, ['id', 'title', 'body', 'documentStyle', 'lists', 'locale', 'appVersion', 'revision', 'rev',
                    'disabled', 'zoomRatio', 'documentFlavor', 'settings', 'resources', 'tableSource', 'drawings',
                    'headers', 'footers', 'notes', 'noteSettings', 'footnotes', 'endnotes', 'drawingsOrder', 'headerFooterDrawingsOrder'])
    for key in ('tableSource', 'drawings', 'headers', 'footers', 'notes', 'noteSettings', 'footnotes', 'endnotes', 'drawingsOrder', 'headerFooterDrawingsOrder'):
        if document.get(key):
            raise Refused('unsupported_pdf_formatting')
    for item in document.get('resources', []):
        only(item, ['name', 'data'])
        if item.get('name') not in ('DOC_OBJECT_PERMISSION_PLUGIN', 'DOC_WORD_STYLES_PLUGIN', 'DOC_NOTE_PLUGIN') or item.get('data') not in ('', '[]', '{}'):
            raise Refused('unsupported_pdf_formatting')
    style = document['documentStyle']
    only(style, geometry + ['textStyle', 'defaultParagraphStyle', 'renderConfig'] + list(defaults))
    if any(style.get(k, v) != v for k, v in defaults.items()):
        raise Refused('unsupported_pdf_formatting')
    config = style.get('renderConfig', {})
    only(config, ['zeroWidthParagraphBreak', 'vertexAngle', 'centerAngle', 'background'])
    if any(config.get(k, 0) != 0 for k in ('zeroWidthParagraphBreak', 'vertexAngle', 'centerAngle')) or config.get('background', {'rgb': '#ccc'}) != {'rgb': '#ccc'}:
        raise Refused('unsupported_pdf_formatting')
    text(style.get('textStyle', {})); paragraph(style.get('defaultParagraphStyle', {}))
    body = document['body']
    only(body, ['dataStream', 'paragraphs', 'textRuns', 'sectionBreaks', 'customRanges', 'customDecorations', 'customBlocks', 'tables', 'customParagraphs', 'customTable', 'customSectionBreaks'])
    for key in ('customRanges', 'customDecorations', 'customBlocks', 'tables', 'customParagraphs', 'customTable', 'customSectionBreaks'):
        if body.get(key):
            raise Refused('unsupported_pdf_formatting')
    sections = body.get('sectionBreaks', [])
    if len(sections) > 1:
        raise Refused('unsupported_pdf_formatting')
    for section in sections:
        only(section, geometry + ['startIndex', 'sectionId'])
    for run in body.get('textRuns', []):
        only(run, ['st', 'ed', 'ts']); text(run['ts'])
    page = {**style, **(sections[0] if sections else {})}
    size = page.get('pageSize', {'width': 794, 'height': 1123})
    only(size, ['width', 'height'])
    for value in [size.get('width'), size.get('height')] + [page[k] for k in geometry[1:] if k in page]:
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 100000:
            raise Refused('unsupported_pdf_list_layout')
    markers = []
    identities = {}; counts = {}; cursor = 0; run_cursor = 0
    runs = body.get('textRuns', [])
    for p in body['paragraphs']:
        only(p, ['startIndex', 'paragraphId', 'paragraphStyle', 'bullet'])
        paragraph(p.get('paragraphStyle', {}))
        while run_cursor < len(runs) and runs[run_cursor]['ed'] <= cursor:
            run_cursor += 1
        if 'bullet' not in p:
            cursor = p['startIndex'] + 1
            continue
        item = p['bullet']
        only(item, ['listId', 'listType', 'nestingLevel', 'startNumber', 'textStyle'])
        if type(item.get('nestingLevel')) is not int or item['nestingLevel'] != 0:
            raise Refused('unsupported_document_list')
        for key in ('listId', 'listType'):
            if not isinstance(item.get(key), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', item[key]) or item[key] in ('__proto__', 'constructor', 'prototype'):
                raise Refused('unsupported_document_list')
        kind = item['listType']
        template = document.get('lists', {}).get(kind)
        level = dict(bulletAlignment=1, startNumber=0, glyphFormat='%1.' if kind == 'ORDER_LIST' else ' %1',
                     **({'glyphType': 2} if kind == 'ORDER_LIST' else {'glyphSymbol': '●'}))
        if template is not None:
            only(template, ['listType', 'nestingLevel'])
            if not isinstance(template.get('nestingLevel'), list) or not 1 <= len(template['nestingLevel']) <= 9:
                raise Refused('unsupported_document_list')
            kind = template['listType']; level = template['nestingLevel'][0]
        only(level, ['bulletAlignment', 'startNumber', 'glyphFormat', 'glyphType', 'glyphSymbol', 'textStyle', 'paragraphProperties', 'isLegal'])
        if kind not in ('ORDER_LIST', 'BULLET_LIST') or type(level.get('bulletAlignment')) is not int or level['bulletAlignment'] != 1 or level.get('isLegal', False) is not False:
            raise Refused('unsupported_document_list')
        if kind == 'ORDER_LIST':
            valid = level.get('glyphType') == 2 and not level.get('glyphSymbol') and level.get('glyphFormat') == '%1.'
        else:
            valid = level.get('glyphSymbol') in BULLETS and level.get('glyphFormat') in (' %1', '%1')
        if not valid:
            raise Refused('unsupported_document_list')
        for offset in (level.get('startNumber'), item.get('startNumber', 0)):
            if type(offset) is not int or not 0 <= offset <= 999999:
                raise Refused('unsupported_document_list')
        if identities.setdefault(item['listId'], item['listType']) != item['listType']:
            raise Refused('unsupported_document_list')
        text(level.get('textStyle', {})); text(item.get('textStyle', {}))
        props = level.get('paragraphProperties', {})
        only(props, ['indentStart', 'hanging'])
        for unit in props.values():
            only(unit, ['v', 'u'])
            if type(unit.get('u', 0)) is not int or unit.get('u', 0) != 0 or type(unit.get('v')) not in (int, float) or not 0 <= unit['v'] <= 100000:
                raise Refused('unsupported_pdf_list_layout')
        if props.get('hanging', {}).get('v', 0) > props.get('indentStart', {}).get('v', 0):
            raise Refused('unsupported_pdf_list_layout')
        ps = {**style.get('defaultParagraphStyle', {}), **p.get('paragraphStyle', {})}
        effective = {'fs': 11, **style.get('textStyle', {}), **ps.get('textStyle', {})}
        if run_cursor < len(runs) and runs[run_cursor]['st'] <= cursor < runs[run_cursor]['ed']:
            effective.update(runs[run_cursor]['ts'])
        if cursor == p['startIndex']:
            effective.update(ps.get('paragraphMarkTextStyle', {}))
        effective.update(item.get('textStyle', {})); effective.update(level.get('textStyle', {}))
        count = item['startNumber'] + 1 if 'startNumber' in item else counts.get(item['listId'], level['startNumber']) + 1
        counts[item['listId']] = count
        if kind == 'ORDER_LIST' and not 1 <= count <= 32767:
            raise Refused('unsupported_pdf_list_number')
        base_size = ps.get('textStyle', {}).get('fs', style.get('textStyle', {}).get('fs', 11))
        body_size = 0; covered = cursor; i = run_cursor
        while i < len(runs) and runs[i]['st'] < p['startIndex']:
            run = runs[i]
            if run['st'] > covered:
                body_size = max(body_size, base_size)
            body_size = max(body_size, run['ts'].get('fs', base_size))
            covered = min(p['startIndex'], run['ed']); i += 1
        if covered < p['startIndex']:
            body_size = max(body_size, base_size)
        # Reserve one body em for left overhang in the pinned faces, including
        # later runs that may begin a wrapped line. Marker style is independent.
        gutter = ((len(str(count)) + 1 if kind == 'ORDER_LIST' else 1) * effective['fs'] + body_size + 6) / .75
        implicit = 21 if template is None else 0
        left, hanging = (props.get(k, {}).get('v', implicit) for k in ('indentStart', 'hanging'))
        if left - hanging + max(hanging, gutter) + 48 >= size['width'] - page.get('marginLeft', 96) - page.get('marginRight', 96):
            raise Refused('unsupported_pdf_list_layout')
        markers.append('0123456789.' if kind == 'ORDER_LIST' else level['glyphSymbol'])
        cursor = p['startIndex'] + 1
    return ''.join(markers)


def map_generated_fonts(data, codec):
    # Only called for our codec's bounded output. Reuse its strict ZIP/XML
    # preflight (duplicates, trailing records, inflated bounds, DTDs, etc.).
    # Preserve namespace prefixes and every other part/element/attribute/text.
    codec['preflight'](data)
    from lxml import etree
    q = codec['q']
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(out, 'w', allowZip64=False) as target:
        parser = etree.XMLParser(resolve_entities=False, no_network=True)
        document = etree.fromstring(source.read('word/document.xml'), parser)
        numbering = etree.fromstring(source.read('word/numbering.xml'), parser)
        nums = {e.get(q('numId')): e for e in numbering.findall(q('num'))}
        abstracts = {e.get(q('abstractNumId')): e for e in numbering.findall(q('abstractNum'))}
        active = set(); counts = {}; gutters = {}
        section = document.find('.//' + q('sectPr'))
        size, margins = section.find(q('pgSz')), section.find(q('pgMar'))
        available = (int(size.get(q('w'))) - int(margins.get(q('left'))) - int(margins.get(q('right')))) / 20
        for p in document.iter(q('p')):
            np = p.find('./' + q('pPr') + '/' + q('numPr'))
            if np is None:
                continue
            num_id = np.find(q('numId')).get(q('val'))
            num = nums[num_id]; abstract_id = num.find(q('abstractNumId')).get(q('val'))
            active.add(abstract_id); level = abstracts[abstract_id].find(q('lvl'))
            start = level.find(q('start')).get(q('val'))
            override = num.find('./' + q('lvlOverride') + '/' + q('startOverride'))
            if override is not None:
                start = override.get(q('val'))
            count = counts.get(num_id, int(start) - 1) + 1; counts[num_id] = count
            ordered = level.find(q('numFmt')).get(q('val')) == 'decimal'
            if ordered and not 1 <= count <= 32767:
                raise Refused('unsupported_pdf_list_number')
            label = str(count) + '.' if ordered else level.find(q('lvlText')).get(q('val'))
            # Effective common numbering size overrides paragraph-mark size.
            mark_size = p.find('./' + q('pPr') + '/' + q('rPr') + '/' + q('sz'))
            level_size = level.find('./' + q('rPr') + '/' + q('sz'))
            marker_size = level_size if level_size is not None else mark_size
            points = int(marker_size.get(q('val'))) / 2 if marker_size is not None else 11
            # The codec emits effective body styles directly on each run, with
            # 11pt as its default. Paragraph-mark rPr controls the marker only.
            body_size = 0
            for run in p.findall(q('r')):
                if not any(run.find(q(tag)) is not None for tag in ('t', 'tab', 'br')):
                    continue
                sz = run.find('./' + q('rPr') + '/' + q('sz'))
                body_size = max(body_size, int(sz.get(q('val'))) / 2 if sz is not None else 11)
            # One em per label glyph plus one body em and a 6pt clear gap.
            # The pinned DejaVu Serif faces' global xMin is above -1em; include
            # all body runs so wrapped-line overhang also stays in the gutter.
            gutters[abstract_id] = max(gutters.get(abstract_id, 0), math.ceil((len(label) * points + body_size + 6) * 20))
        for abstract_id, gutter in gutters.items():
            level = abstracts[abstract_id].find(q('lvl'))
            pp = level.find(q('pPr'))
            if pp is None:
                pp = etree.Element(q('pPr'))
                rpr = level.find(q('rPr'))
                level.insert(list(level).index(rpr) if rpr is not None else len(level), pp)
            ind = pp.find(q('ind'))
            if ind is None:
                ind = etree.SubElement(pp, q('ind'))
            left, hanging = int(ind.get(q('left'), '0')), int(ind.get(q('hanging'), '0'))
            origin = left - hanging
            hanging = max(hanging, gutter); left = origin + hanging
            if origin < 0 or left / 20 + 36 >= available:
                raise Refused('unsupported_pdf_list_layout')
            ind.set(q('left'), str(left)); ind.set(q('hanging'), str(hanging))
            tabs = etree.Element(q('tabs')); tab = etree.SubElement(tabs, q('tab'))
            tab.set(q('val'), 'num'); tab.set(q('pos'), str(left)); pp.insert(0, tabs)
        for entry in source.infolist():
            part = source.read(entry)
            if entry.filename in ('word/document.xml', 'word/styles.xml', 'word/numbering.xml'):
                root = numbering if entry.filename == 'word/numbering.xml' else etree.fromstring(part, parser)
                scopes = [abstracts[k] for k in active] if entry.filename == 'word/numbering.xml' else [root]
                for props in (p for scope in scopes for p in scope.iter(q('rPr'))):
                    fonts = props.find(q('rFonts'))
                    if fonts is None:
                        fonts = etree.Element(q('rFonts'))
                        props.insert(0, fonts)
                    for name in ('asciiTheme', 'hAnsiTheme', 'eastAsiaTheme'):
                        fonts.attrib.pop(q(name), None)
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
    validate_document(request['document'])
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
    markers = validate_document(request['document'])
    if not os.access('/usr/bin/soffice', os.X_OK):
        raise Refused('pdf_renderer_unavailable')
    coverage = font_charsets(deadline)
    check_text(request['document']['body']['dataStream'], coverage)
    check_text(markers, coverage, marker=True)
    code, output = run_bounded(['/venv/bin/python', '-I', '/render.py', '--intermediate'], raw, min(deadline, time.monotonic() + 12), 6_000_000)
    try:
        result = json.loads(output)
    except (ValueError, UnicodeError):
        raise Refused('pdf_codec_unavailable')
    if code or result.get('error'):
        raise Refused(result['error'] if result.get('error') in ('unsupported_pdf_list_number', 'unsupported_pdf_list_layout', 'unsupported_pdf_formatting', 'unsupported_pdf_font_size', 'unsupported_document_list') else 'pdf_codec_refused')
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
