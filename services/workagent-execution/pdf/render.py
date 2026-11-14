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


def list_level(document, item, depth):
    """The pinned native presets; custom definitions replace them in full."""
    kind = item['listType']
    templates = document.get('lists', {})
    if not isinstance(templates, dict):
        raise Refused('unsupported_document_list')
    template = templates.get(kind)
    if kind not in templates:
        if kind not in ('BULLET_LIST', 'ORDER_LIST', 'ORDER_LIST_1', 'ORDER_LIST_2', 'ORDER_LIST_3', 'ORDER_LIST_4', 'ORDER_LIST_5') or (kind == 'ORDER_LIST_2' and depth > 6):
            raise Refused('unsupported_document_list')
        glyph = 2 if kind == 'ORDER_LIST_2' else [4 if kind in ('ORDER_LIST_3', 'ORDER_LIST_4') else 3 if kind == 'ORDER_LIST_5' else 2, 2 if kind == 'ORDER_LIST_4' else 5, 7][depth % 3]
        pattern = ''.join(f'%{n+1}.' for n in range(depth+1)) if kind == 'ORDER_LIST_2' else f'%{depth+1}' + (')' if kind == 'ORDER_LIST_1' else '.')
        level = dict(bulletAlignment=1, startNumber=0, glyphFormat=f' %{depth+1}' if kind == 'BULLET_LIST' else pattern,
                     paragraphProperties={'indentStart': {'v': 21*(depth+1)}, 'hanging': {'v': 21}},
                     **({'glyphSymbol': BULLETS[(0, 2, 3)[depth % 3]]} if kind == 'BULLET_LIST' else {'glyphType': glyph}))
    else:
        if not isinstance(template, dict) or set(template) != {'listType', 'nestingLevel'} or template['listType'] not in ('ORDER_LIST', 'BULLET_LIST') or not isinstance(template['nestingLevel'], list) or not depth < len(template['nestingLevel']) <= 9:
            raise Refused('unsupported_document_list')
        level = template['nestingLevel'][depth]
    keys = {'bulletAlignment', 'startNumber', 'glyphFormat', 'glyphType', 'glyphSymbol', 'textStyle', 'paragraphProperties', 'isLegal'}
    if not isinstance(level, dict) or set(level) - keys or type(level.get('bulletAlignment')) is not int or level['bulletAlignment'] != 1 or level.get('isLegal', False) is not False:
        raise Refused('unsupported_document_list')
    if level.get('glyphSymbol'):
        valid = 'glyphType' not in level and level['glyphSymbol'] in BULLETS and level.get('glyphFormat') in (f' %{depth+1}', f'%{depth+1}')
    else:
        valid = type(level.get('glyphType')) is int and level['glyphType'] in (2, 3, 4, 5, 6, 7) and level.get('glyphFormat') in (f'%{depth+1}.', f'%{depth+1})', ''.join(f'%{n+1}.' for n in range(depth+1)))
    if not valid or type(level.get('startNumber')) is not int or not 0 <= level['startNumber'] <= 999999:
        raise Refused('unsupported_document_list')
    return level


def number_marker(value, glyph):
    if not 1 <= value <= 32767:
        raise Refused('unsupported_pdf_list_number')
    if glyph in (2, 3):
        return str(value).zfill(2 if glyph == 3 else 1)
    if glyph in (4, 5):
        # Univer/Word use a..z, aa, bb (not spreadsheet column notation).
        return chr((65 if glyph == 4 else 97) + (value-1) % 26) * ((value-1)//26+1)
    result = ''
    for amount, symbol in [(1000, 'M'), (900, 'CM'), (500, 'D'), (400, 'CD'), (100, 'C'), (90, 'XC'), (50, 'L'), (40, 'XL'), (10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]:
        result += symbol * (value // amount); value %= amount
    return result if glyph == 6 else result.lower()


def validate_document(document, marker_records=None):
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
        if type(item.get('nestingLevel')) is not int or not 0 <= item['nestingLevel'] <= 8:
            raise Refused('unsupported_document_list')
        for key in ('listId', 'listType'):
            if not isinstance(item.get(key), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', item[key]) or item[key] in ('__proto__', 'constructor', 'prototype'):
                raise Refused('unsupported_document_list')
        depth = item['nestingLevel']
        levels = [list_level(document, item, n) for n in range(depth+1)]
        level = levels[depth]
        if 'startNumber' in item and (type(item['startNumber']) is not int or not 0 <= item['startNumber'] <= 999999):
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
        sequence = counts.setdefault(item['listId'], {})
        for n in range(depth):
            sequence.setdefault(n, levels[n]['startNumber'] + 1)
        sequence[depth] = item['startNumber'] + 1 if 'startNumber' in item else sequence.get(depth, level['startNumber']) + 1
        for n in list(sequence):
            if n > depth:
                del sequence[n]
        def replacement(match):
            n = int(match[1]) - 1
            if levels[n].get('glyphSymbol'):
                raise Refused('unsupported_document_list')
            return number_marker(sequence[n], levels[n]['glyphType'])
        label = level.get('glyphSymbol') or re.sub(r'%([1-9])', replacement, level['glyphFormat'])
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
        gutter = (1.5 * len(label) * effective['fs'] + body_size + 6) / .75
        left, hanging = (props.get(k, {}).get('v', 0) for k in ('indentStart', 'hanging'))
        if left - hanging + max(hanging, gutter) + 48 >= size['width'] - page.get('marginLeft', 96) - page.get('marginRight', 96):
            raise Refused('unsupported_pdf_list_layout')
        markers.append(label)
        if marker_records is not None:
            marker_records.append(label)
        cursor = p['startIndex'] + 1
    return ''.join(markers)


def map_generated_fonts(data, codec, marker_records=None):
    # Only called for our codec's bounded output. Reuse its strict ZIP/XML
    # preflight (duplicates, trailing records, inflated bounds, DTDs, etc.).
    # Preserve namespace prefixes and every other part/element/attribute/text.
    codec['preflight'](data)
    if marker_records is None:
        marker_records = []
        validate_document(codec['import_document'](data)['document'], marker_records)
    labels = iter(marker_records)
    from lxml import etree
    q = codec['q']
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(out, 'w', allowZip64=False) as target:
        parser = etree.XMLParser(resolve_entities=False, no_network=True)
        document = etree.fromstring(source.read('word/document.xml'), parser)
        numbering = etree.fromstring(source.read('word/numbering.xml'), parser)
        nums = {e.get(q('numId')): e for e in numbering.findall(q('num'))}
        abstracts = {e.get(q('abstractNumId')): e for e in numbering.findall(q('abstractNum'))}
        active = set(); gutters = {}
        section = document.find('.//' + q('sectPr'))
        size, margins = section.find(q('pgSz')), section.find(q('pgMar'))
        available = (int(size.get(q('w'))) - int(margins.get(q('left'))) - int(margins.get(q('right')))) / 20
        for p in document.iter(q('p')):
            np = p.find('./' + q('pPr') + '/' + q('numPr'))
            if np is None:
                continue
            num_id = np.find(q('numId')).get(q('val'))
            num = nums[num_id]; abstract_id = num.find(q('abstractNumId')).get(q('val'))
            depth = np.find(q('ilvl')).get(q('val'))
            active.add(abstract_id)
            level = next(l for l in abstracts[abstract_id].findall(q('lvl')) if l.get(q('ilvl')) == depth)
            # Size the actual native marker. Do not reconstruct counters from
            # concrete Word numIds: several can share one abstract sequence.
            label = next(labels)
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
            # Reserve 1.5 em per marker glyph: bold W/M exceed one em in
            # the pinned faces. Add one body em and a 6pt clear gap.
            # The pinned DejaVu Serif faces' global xMin is above -1em; include
            # all body runs so wrapped-line overhang also stays in the gutter.
            gutters[(abstract_id, depth)] = max(gutters.get((abstract_id, depth), 0), math.ceil((1.5 * len(label) * points + body_size + 6) * 20))
        if next(labels, None) is not None:
            raise Refused('pdf_codec_refused')
        for (abstract_id, depth), gutter in gutters.items():
            level = next(l for l in abstracts[abstract_id].findall(q('lvl')) if l.get(q('ilvl')) == depth)
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


def export_intermediate(document, codec):
    markers = []
    validate_document(document, markers)
    try:
        result = codec['export_document'](document, _pdf_visible_markers=True)
    except ValueError as error:
        # Classify only known unmapped marker cases; other codec errors retain
        # their own failure path. PDF need not retain invisible editing marks.
        if str(error) in ('Unsupported marker formatting', 'Unsupported marker underline'):
            raise Refused('unsupported_pdf_marker_formatting') from error
        raise
    return map_generated_fonts(base64.b64decode(result['base64'], validate=True), codec, markers)


def intermediate():
    # Same codec/limits, in the dedicated venv child. DOCX export is unchanged;
    # only this private PDF intermediate receives the rendering font policy.
    import runpy
    codec = runpy.run_path('/codec.py')
    raw = sys.stdin.buffer.read(4_500_001)
    if len(raw) > 4_500_000:
        raise Refused('pdf_codec_refused')
    request = json.loads(raw)
    data = export_intermediate(request['document'], codec)
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
        raise Refused(result['error'] if result.get('error') in ('unsupported_pdf_list_number', 'unsupported_pdf_list_layout', 'unsupported_pdf_marker_formatting', 'unsupported_pdf_formatting', 'unsupported_pdf_font_size', 'unsupported_document_list') else 'pdf_codec_refused')
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
