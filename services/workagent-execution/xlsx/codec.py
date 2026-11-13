"""Bounded XLSX codec. Production entry is the namespace worker, never in-process.
No extraction, formula evaluation, cached results, file links or network requests.
"""
import base64
import datetime
import io
import json
import math
import re
import resource
import struct
import sys
import zipfile
import zlib
from pathlib import PurePosixPath

resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_FSIZE, (24 * 1024 * 1024, 24 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
import openpyxl
from defusedxml.ElementTree import iterparse, fromstring
from openpyxl.formula.tokenizer import Tokenizer, TokenizerError
from openpyxl.formula.translate import Translator
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import range_boundaries, get_column_letter, column_index_from_string
from openpyxl.utils.datetime import to_excel, WINDOWS_EPOCH
from openpyxl.workbook.properties import CalcProperties
assert openpyxl.DEFUSEDXML

BYTES, INFLATED, ENTRY, CELLS = 2_000_000, 20_000_000, 5_000_000, 50_000
POLICY = ['Original bytes remain available. Native exchange preserves a bounded subset, not full Excel fidelity.',
          'Formula caches are discarded; supported formulas recalculate in the editor and on Excel open. Shared formulas expand to equivalent individual formulas.',
          'Charts, images, comments, hyperlinks, validation, conditional formatting, tables, names, print settings, protection and advanced styles are not carried into native exports.',
          'Date/time conversion uses the 1900 epoch with millisecond precision; the Excel fictitious leap day is refused. Empty grid padding can differ on reopen.']
FUNCTIONS = set('SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK IF IFERROR AND OR NOT ROUND ROUNDUP ROUNDDOWN ABS INT MOD POWER SQRT SUMIF SUMIFS COUNTIF COUNTIFS AVERAGEIF AVERAGEIFS CONCAT CONCATENATE LEFT RIGHT MID LEN TRIM UPPER LOWER DATE YEAR MONTH DAY TODAY'.split())
class FormulaTokenizer(Tokenizer):
    # openpyxl's tokenizer recognizes signed exponents only for single-digit
    # mantissas. Keep ordinary Excel numeric constants as one operand.
    SN_RE = re.compile(r'^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)[Ee]$')

def need(ok, message):
    if not ok:
        raise ValueError(message)
def field(value, limit=20000):
    need(isinstance(value, str) and len(value) <= limit and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', value), 'Unsupported or oversized text')
    return value

def bounds(ref):
    a, b, c, d = range_boundaries(ref.replace('$', ''))
    need(all(isinstance(v, int) for v in (a, b, c, d)) and 1 <= a <= c <= 200 and 1 <= b <= d <= 10000 and (c-a+1)*(d-b+1) <= CELLS, 'XLSX range exceeds 10,000 rows / 200 columns / 50,000 cells')
    return a, b, c, d

def formula(value, budget=None):
    field(value, 2000)
    need(value.startswith('=') and len(value) > 1, 'Invalid formula')
    try: tokens = FormulaTokenizer(value).items
    except (TokenizerError, IndexError): raise ValueError('Malformed formula') from None
    cost = 0; complexity = 0; stack = []
    for token in tokens:
        kind, sub, text = token.type, token.subtype, token.value
        if kind == 'WHITE-SPACE': continue
        if kind == 'OPERAND':
            if sub == 'TEXT': continue # Unicode and formula-like strings are literal.
            if sub == 'NUMBER':
                need(bool(re.fullmatch(r'(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?', text)) and math.isfinite(float(text)), 'Invalid formula number')
            elif sub in ('LOGICAL', 'RANGE') and text.isascii() and text.upper() in ('TRUE', 'FALSE'): continue
            else:
                # Full-token recognition, never an ASCII-only search for names.
                match = re.fullmatch(r"(?:(?:'(?:[^'\[\]\\/*?:]|'')+'|[A-Za-z_][A-Za-z_0-9.]*)!)?(\$?[A-Za-z]{1,3}\$?[1-9][0-9]*(?::\$?[A-Za-z]{1,3}\$?[1-9][0-9]*)?)", text)
                need(sub == 'RANGE' and match is not None, 'Named-reference or unsupported formula token')
                a,b,c,d = bounds(match[1]); cost += (c-a+1)*(d-b+1)
                complexity += text.count(':')
        elif kind in ('FUNC', 'PAREN'):
            if sub == 'OPEN':
                need(kind == 'PAREN' or text[:-1].isascii() and text[:-1].upper() in FUNCTIONS, 'Unsupported formula function')
                stack.append(kind)
            else:
                need(sub == 'CLOSE' and stack and stack.pop() == kind, 'Malformed formula')
            complexity += 1
        else:
            need((kind == 'OPERATOR-INFIX' and text in ('+', '-', '*', '/', '^', '&', '=', '<', '>', '<=', '>=', '<>'))
                 or (kind == 'OPERATOR-PREFIX' and text in ('+', '-'))
                 or (kind == 'OPERATOR-POSTFIX' and text == '%')
                 or (kind == 'SEP' and sub == 'ARG' and text == ',' and stack and stack[-1] == 'FUNC'), 'Unsupported formula token')
            complexity += 1
    need(not stack and tokens, 'Malformed formula')
    need(complexity <= 200, 'Formula complexity limit')
    need(cost <= 50000, 'Formula reference complexity limit')
    if budget is not None:
        budget[0] += cost; need(budget[0] <= 200000, 'Workbook formula reference limit (200,000 cells)')
    return value

def read_member(z, entry, data, total):
    # ZipExtFile stops at the advertised size. Use ZipFile's structural checks,
    # but verify the entire raw stream ourselves with bounded output chunks.
    with z.open(entry): pass # local filename, supported flags, overlap
    header = struct.unpack_from('<4s5H3I2H', data, entry.header_offset)
    _, _, flags, method, _, _, crc, compressed, size, name_len, extra_len = header
    need(flags == entry.flag_bits and method == entry.compress_type, 'ZIP local/central mismatch')
    start = entry.header_offset + 30 + name_len + extra_len
    end = start + entry.compress_size
    need(0 <= entry.compress_size <= BYTES and end <= z.start_dir and end <= len(data), 'ZIP compressed bounds')
    if flags & 8:
        need(crc in (0, entry.CRC) and compressed in (0, entry.compress_size) and size in (0, entry.file_size), 'ZIP local/central mismatch')
        descriptor = end + (4 if data[end:end+4] == b'PK\x07\x08' else 0)
        need(descriptor + 12 <= entry._end_offset and struct.unpack_from('<III', data, descriptor) == (entry.CRC, entry.compress_size, entry.file_size), 'ZIP data descriptor mismatch')
        need(descriptor + 12 == entry._end_offset, 'ZIP unreported stream tail')
    else:
        need((crc, compressed, size) == (entry.CRC, entry.compress_size, entry.file_size), 'ZIP local/central mismatch')
        need(end == entry._end_offset, 'ZIP unreported stream tail')
    raw = bytearray(); checksum = 0
    inflater = zlib.decompressobj(-15) if method == 8 else None
    position = start; pending = b''
    while position < end or pending:
        if not pending:
            pending = data[position:min(position+65536, end)]; position += len(pending)
        limit = min(65536, ENTRY-len(raw)+1, INFLATED-total[0]+1)
        chunk = inflater.decompress(pending, limit) if inflater else pending[:limit]
        pending = inflater.unconsumed_tail if inflater else pending[len(chunk):]
        total[0] += len(chunk)
        need(len(raw)+len(chunk) <= ENTRY and total[0] <= INFLATED, 'ZIP actual inflated entry/total limit')
        raw.extend(chunk); checksum = zlib.crc32(chunk, checksum)
        if inflater and inflater.eof:
            need(not inflater.unused_data and not pending and position == end, 'ZIP compressed stream tail')
            break
    need(not inflater or inflater.eof, 'Truncated ZIP compressed stream')
    need(len(raw) == entry.file_size and checksum == entry.CRC, 'ZIP size/CRC inconsistency')
    return raw

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CONTENT = 'http://schemas.openxmlformats.org/package/2006/content-types'
WORKSHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'

def worksheet_parts(parts):
    def xml(name, root):
        need(name in parts, 'Missing XLSX package part')
        element = fromstring(parts[name]); need(element.tag == root, 'Invalid XLSX package root')
        return element
    types = xml('[Content_Types].xml', '{'+CONTENT+'}Types')
    overrides = {}; defaults = {}
    for el in types:
        if el.tag == '{'+CONTENT+'}Override':
            name = el.get('PartName', '')
            need(name.startswith('/') and name[1:] in parts and name not in overrides, 'Ambiguous XLSX content type')
            overrides[name] = el.get('ContentType')
        else:
            ext = el.get('Extension')
            need(el.tag == '{'+CONTENT+'}Default' and ext and ext not in defaults, 'Ambiguous XLSX content type')
            defaults[ext] = el.get('ContentType')
    def part_type(name): return overrides.get('/'+name, defaults.get(name.rsplit('.', 1)[-1]))
    need(part_type('xl/workbook.xml') == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'Unsupported workbook content type')
    def relationships(name, directory):
        result = {}
        for el in xml(name, '{'+PACKAGE_REL+'}Relationships'):
            rid, target = el.get('Id'), el.get('Target', '')
            need(el.tag == '{'+PACKAGE_REL+'}Relationship' and rid and rid not in result, 'Ambiguous XLSX relationship')
            if el.get('Type') in (REL+'/worksheet', REL+'/officeDocument'):
                need(el.get('TargetMode', 'Internal') == 'Internal' and target and not re.search(r'[\\%?#:]', target), 'Invalid worksheet relationship')
                target = target[1:] if target.startswith('/') else directory+target
                need(target in parts and str(PurePosixPath(target)) == target and '..' not in PurePosixPath(target).parts, 'Invalid worksheet target')
            result[rid] = (el.get('Type'), target)
        return result
    package_rels = relationships('_rels/.rels', '')
    need([target for kind,target in package_rels.values() if kind == REL+'/officeDocument'] == ['xl/workbook.xml'], 'Ambiguous workbook relationship')
    rels = relationships('xl/_rels/workbook.xml.rels', 'xl/')
    wb = xml('xl/workbook.xml', '{'+MAIN+'}workbook')
    groups = wb.findall('{'+MAIN+'}sheets'); need(len(groups) == 1, 'Ambiguous workbook sheets')
    result = set(); ids = set(); names = set(); refs = set()
    for el in groups[0]:
        rid, sid, name = el.get('{'+REL+'}id'), el.get('sheetId'), el.get('name', '').lower()
        need(el.tag == '{'+MAIN+'}sheet' and rid in rels and rid not in refs and sid and sid not in ids and name and name not in names, 'Ambiguous worksheet identity')
        kind,target = rels[rid]
        need(kind == REL+'/worksheet' and part_type(target) == WORKSHEET_TYPE and target not in result, 'Invalid worksheet part type/relationship')
        result.add(target); ids.add(sid); names.add(name); refs.add(rid)
    need(1 <= len(result) <= 20, 'Worksheet count limit')
    need(result == {name for name in parts if part_type(name) == WORKSHEET_TYPE}
         and refs == {rid for rid,(kind,_) in rels.items() if kind == REL+'/worksheet'}, 'Ambiguous worksheet parts')
    return result

def preflight(data):
    need(len(data) <= BYTES and data[:4] == b'PK\x03\x04', 'Choose an unencrypted XLSX under 2 MB')
    warnings = set(POLICY)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        infos = z.infolist()
        need(1 <= len(infos) <= 256, 'Archive entry limit')
        names = set(); total = [0]; parts = {}
        for entry in infos:
            name = entry.filename
            need(name not in names and name == entry.orig_filename and str(PurePosixPath(name)) == name.rstrip('/') and not name.startswith('/') and '\\' not in name and ':' not in name and '..' not in PurePosixPath(name).parts, 'Duplicate or unsafe ZIP path')
            names.add(name)
            need(not entry.flag_bits & 1 and entry.compress_type in (0, 8) and entry.file_size <= ENTRY, 'Encrypted/unsupported ZIP entry or entry too large')
            lower = name.lower()
            need(not any(x in lower for x in ('vbaproject', 'activex', 'externallinks/', 'embeddings/', 'connections.xml', 'querytables/', 'customui/')), 'Macros, external data or active content unsupported')
            parts[name] = read_member(z, entry, data, total)
        worksheets = worksheet_parts(parts)
        cells = 0; styles = 0; merges = 0; merge_cells = 0; strings = 0
        for name, raw in parts.items():
            if name.lower().endswith(('.xml', '.rels')) or name in worksheets:
                worksheet = name in worksheets; seen_cells = set(); root = None
                occupied = set(); merged = []; current_cell = None
                for event, el in iterparse(io.BytesIO(raw), events=('start', 'end')):
                    tag = el.tag.rsplit('}', 1)[-1]
                    if event == 'start':
                        if root is None:
                            root = el.tag
                            need((root == '{'+MAIN+'}worksheet') == worksheet and (tag != 'worksheet' or worksheet), 'Worksheet root/type mismatch')
                        need(len(el.attrib) <= 40 and all(len(v) <= 20000 for v in el.attrib.values()), 'XML attribute limit')
                        if tag == 'Relationship':
                            need(el.get('TargetMode') != 'External' or el.get('Type', '').endswith('/hyperlink'), 'External relationships unsupported')
                            target = el.get('Target', '')
                            need(not any(x in target.lower() for x in ('vbaproject', 'activex', 'oleobject')), 'Active relationship unsupported')
                        if tag == 'Override':
                            need(not any(x in el.get('ContentType', '').lower() for x in ('macroenabled', 'vba', 'activex')), 'Macro-enabled XLSX unsupported')
                        if worksheet and tag in ('dimension', 'mergeCell'):
                            a,b,c,d = bounds(el.get('ref', ''))
                            if tag == 'mergeCell':
                                need(not any(a <= cc and c >= aa and b <= dd and d >= bb for aa,bb,cc,dd in merged), 'Overlapping merges unsupported')
                                merged.append((a,b,c,d))
                                merges += 1; merge_cells += (c-a+1)*(d-b+1)
                                need(merges <= 1000 and merge_cells <= CELLS, 'Merge expansion limit')
                        if tag == 'si':
                            strings += 1; need(strings <= CELLS, 'Shared-string limit')
                        if worksheet and tag == 'row': need(1 <= int(el.get('r', '0')) <= 10000, 'Row limit')
                        if worksheet and tag == 'c':
                            ref = el.get('r', '')
                            need(bool(re.fullmatch(r'[A-Z]{1,3}[1-9][0-9]*', ref)), 'Noncanonical cell address')
                            current_cell = ref; bounds(ref); need(ref not in seen_cells, 'Duplicate cell address'); seen_cells.add(ref)
                            cells += 1; need(cells <= CELLS, '50,000 stored-cell limit')
                        if worksheet and tag in ('v', 'f', 'is') and current_cell: occupied.add(current_cell)
                        if tag in ('xf', 'font', 'fill', 'border', 'numFmt'):
                            styles += 1; need(styles <= 4000, 'Style complexity limit')
                        if worksheet and tag == 'f': need(el.get('t', 'normal') in ('normal', 'shared'), 'Array/data-table formulas unsupported')
                        if tag in ('drawing', 'legacyDrawing', 'hyperlink', 'dataValidation', 'conditionalFormatting', 'tablePart', 'definedName', 'sheetProtection', 'autoFilter', 'pane', 'extLst'):
                            warnings.add('Not retained: ' + tag)
                    else:
                        if el.text: field(el.text, 20000)
                        if worksheet and tag == 'c': current_cell = None
                        el.clear()
                if worksheet:
                    for ref in occupied:
                        x,y,_,_ = bounds(ref)
                        need(not any(a <= x <= c and b <= y <= d and (x,y) != (a,b) for a,b,c,d in merged), 'Merge would discard cell content')
    return warnings

def rgb(color):
    return '#' + color.rgb[-6:] if color and color.type == 'rgb' else None

def native_style(cell, warnings):
    f, a = cell.font, cell.alignment
    s = {'bl': int(bool(f.bold)), 'it': int(bool(f.italic))}
    if f.name: s['ff'] = f.name
    if f.sz: s['fs'] = f.sz
    if rgb(f.color): s['cl'] = {'rgb': rgb(f.color)}
    if cell.fill.patternType == 'solid' and rgb(cell.fill.fgColor): s['bg'] = {'rgb': rgb(cell.fill.fgColor)}
    if a.horizontal in ('left', 'center', 'right'): s['ht'] = {'left': 1, 'center': 2, 'right': 3}[a.horizontal]
    if a.vertical in ('top', 'center', 'bottom'): s['vt'] = {'top': 1, 'center': 2, 'bottom': 3}[a.vertical]
    if a.wrap_text: s['tb'] = 3
    if cell.number_format != 'General': s['n'] = {'pattern': field(cell.number_format, 200)}
    if any(getattr(cell.border, x).style for x in ('left', 'right', 'top', 'bottom')) or f.underline or f.strike or a.textRotation:
        warnings.add('Borders, underline, strike and rotated text are not retained.')
    if f.color and f.color.type != 'rgb' or cell.fill.patternType not in (None, 'solid'):
        warnings.add('Theme/indexed colors and patterned fills are not retained.')
    return s

def import_book(data):
    warnings = preflight(data)
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=False, keep_links=False, rich_text=False)
    need(wb.epoch == WINDOWS_EPOCH, '1904 date-epoch workbooks are refused; convert to the 1900 epoch before import. Original not adopted.')
    book = {'id': 'preview', 'name': 'Imported XLSX', 'appVersion': '1.4.0', 'locale': 'enUS', 'styles': {}, 'sheetOrder': [], 'sheets': {}}
    total = 0; formulas = 0; budget = [0]
    for i, ws in enumerate(wb.worksheets):
        sid = 'sheet' + str(i+1); book['sheetOrder'].append(sid)
        need(ws.max_row <= 10000 and ws.max_column <= 200, 'Sheet bounds')
        sheet = {'id': sid, 'name': field(ws.title, 31), 'rowCount': max(200, ws.max_row), 'columnCount': max(26, ws.max_column), 'cellData': {}, 'mergeData': [], 'rowData': {}, 'columnData': {}, 'defaultColumnWidth': 110, 'defaultRowHeight': 24}
        book['sheets'][sid] = sheet
        if ws.sheet_state != 'visible': warnings.add('Hidden sheets are imported as visible.')
        for cell in ws._cells.values(): # Sparse: never expand a dimension-only rectangle.
            if cell.value is None and not cell.has_style: continue
            total += 1; need(total <= CELLS, '50,000 stored-cell limit')
            v = cell.value; out = {}
            if cell.data_type == 'f':
                formulas += 1; need(formulas <= 2000, '2,000-formula limit'); out['f'] = formula(v, budget)
            elif isinstance(v, bool): out.update(v=v, t=3)
            elif isinstance(v, (datetime.datetime, datetime.date, datetime.time, datetime.timedelta)):
                need(not isinstance(v, (datetime.datetime, datetime.date)) or (v.year, v.month, v.day) != (1900, 2, 28), 'Ambiguous Excel 1900 leap-day date refused')
                out.update(v=to_excel(v, wb.epoch) if not isinstance(v, datetime.timedelta) else v.total_seconds()/86400, t=2)
            elif isinstance(v, (int, float)):
                need(math.isfinite(v), 'Nonfinite number'); out.update(v=v, t=2)
            elif v is not None:
                out.update(v=field(v), t=1)
                if cell.data_type == 'e': warnings.add('Excel error cells import as literal error text; formula errors recalculate.')
            if cell.has_style: out['s'] = native_style(cell, warnings)
            sheet['cellData'].setdefault(str(cell.row-1), {})[str(cell.column-1)] = out
        for merge in ws.merged_cells.ranges:
            a,b,c,d = bounds(str(merge)); sheet['mergeData'].append({'startRow':b-1,'endRow':d-1,'startColumn':a-1,'endColumn':c-1})
        for r, dim in ws.row_dimensions.items():
            need(1 <= r <= 10000, 'Row dimension limit')
            sheet['rowData'][str(r-1)] = {**({'h': dim.height * 4/3} if dim.height else {}), **({'hd': 1} if dim.hidden else {})}
        for key, dim in ws.column_dimensions.items():
            a, b = dim.min or column_index_from_string(key), dim.max or column_index_from_string(key)
            need(1 <= a <= b <= 200, 'Column dimension limit')
            for c in range(a, b+1): sheet['columnData'][str(c-1)] = {**({'w': dim.width * 7 + 5} if dim.width else {}), **({'hd': 1} if dim.hidden else {})}
    warnings.add('Column widths use approximate Excel-to-pixel conversion. Rich text is imported as plain text; theme colors and advanced layout may differ.')
    return {'book': book, 'warnings': sorted(warnings), 'cells': total}

def export_book(book):
    wb = openpyxl.Workbook(); wb.remove(wb.active); wb.calculation = CalcProperties(calcId=0, fullCalcOnLoad=True, forceFullCalc=True)
    warnings = set(POLICY); total = 0; formulas = 0; merge_area = 0; budget = [0]
    need(1 <= len(book['sheetOrder']) <= 20 and len(set(book['sheetOrder'])) == len(book['sheetOrder']), 'Sheet limit')
    for sid in book['sheetOrder']:
        sheet = book['sheets'][sid]; name = field(sheet['name'], 31)
        need(not re.search(r'[\\/*?:\[\]]', name) and name.lower() not in [s.lower() for s in wb.sheetnames], 'Unsupported/duplicate Excel tab name')
        need(1 <= sheet['rowCount'] <= 10000 and 1 <= sheet['columnCount'] <= 200, 'Sheet bounds')
        ws = wb.create_sheet(name); masters = {}
        for r, row in sheet.get('cellData', {}).items():
            for c, cell in row.items():
                if cell and cell.get('si') and cell.get('f'):
                    need(cell['si'] not in masters, 'Ambiguous shared formula')
                    masters[cell['si']] = (cell['f'], f'{get_column_letter(int(c)+1)}{int(r)+1}')
        for r, row in sheet.get('cellData', {}).items():
            for c, cell in row.items():
                if cell is None: continue
                total += 1; need(total <= CELLS, '50,000 stored-cell limit')
                rr, cc = int(r)+1, int(c)+1
                need(1 <= rr <= sheet['rowCount'] and 1 <= cc <= sheet['columnCount'], 'Cell bounds')
                dest = ws.cell(rr, cc); v = cell.get('v'); f = cell.get('f')
                if cell.get('si') and not f:
                    need(cell['si'] in masters, 'Missing shared-formula anchor')
                    master, origin = masters[cell['si']]; f = Translator(master, origin=origin).translate_formula(dest.coordinate)
                if f:
                    formulas += 1; need(formulas <= 2000, '2,000-formula limit'); dest.value = formula(f, budget)
                elif cell.get('p'):
                    need(False, 'Rich-text cells must be converted to plain text before XLSX export; original remains available')
                elif v is not None:
                    if cell.get('t') == 3:
                        need(v in (0,1,False,True), 'Invalid boolean'); dest.value = bool(v)
                    elif isinstance(v, str):
                        dest.value = field(v); dest.data_type = 's' # Univer type 4 is FORCE_STRING, never an Excel error.
                    else:
                        need(isinstance(v, (int,float,bool)) and math.isfinite(v), 'Invalid scalar'); dest.value = v
                s = cell.get('s', {})
                if isinstance(s, str):
                    need(s in book.get('styles', {}), 'Missing native style'); s = book['styles'][s]
                if s:
                    if set(s) - {'bl','it','ff','fs','cl','bg','ht','vt','tb','n'}: warnings.add('Advanced native styles are omitted.')
                    color = lambda key: s.get(key, {}).get('rgb', '').lstrip('#') or None
                    dest.font = Font(name=s.get('ff', 'Calibri'), size=s.get('fs', 11), bold=bool(s.get('bl')), italic=bool(s.get('it')), color=color('cl'))
                    if color('bg'): dest.fill = PatternFill('solid', fgColor=color('bg'))
                    dest.alignment = Alignment(horizontal={1:'left',2:'center',3:'right'}.get(s.get('ht')), vertical={1:'top',2:'center',3:'bottom'}.get(s.get('vt')), wrap_text=s.get('tb') == 3)
                    dest.number_format = field(s.get('n', {}).get('pattern', 'General'), 200)
        merges = sheet.get('mergeData', []); need(len(merges) <= 1000, 'Merge limit')
        for m in merges:
            ref = f"{get_column_letter(m['startColumn']+1)}{m['startRow']+1}:{get_column_letter(m['endColumn']+1)}{m['endRow']+1}"; a,b,c,d = bounds(ref)
            merge_area += (c-a+1)*(d-b+1); need(merge_area <= CELLS, 'Merge expansion limit')
            need(c <= sheet['columnCount'] and d <= sheet['rowCount'], 'Merge outside sheet')
            for row in ws.iter_rows(min_row=b,max_row=d,min_col=a,max_col=c):
                for cell in row: need(cell.coordinate == f'{get_column_letter(a)}{b}' or cell.value is None, 'Merge would discard cell content')
            ws.merge_cells(ref)
        for r, dim in sheet.get('rowData', {}).items():
            need(0 <= int(r) < 10000, 'Row dimension limit')
            if dim.get('h'): ws.row_dimensions[int(r)+1].height = dim['h'] * 3/4
            ws.row_dimensions[int(r)+1].hidden = bool(dim.get('hd'))
        for c, dim in sheet.get('columnData', {}).items():
            need(0 <= int(c) < 200, 'Column dimension limit')
            d = ws.column_dimensions[get_column_letter(int(c)+1)]
            if dim.get('w'): d.width = max(0, (dim['w']-5)/7)
            d.hidden = bool(dim.get('hd'))
    output = io.BytesIO(); wb.save(output); data = output.getvalue()
    need(len(data) <= BYTES, 'Export exceeds 2 MB; no file produced')
    preflight(data)
    return {'base64': base64.b64encode(data).decode(), 'warnings': sorted(warnings)}

def main():
    raw = sys.stdin.buffer.readline(4_500_001); need(len(raw) <= 4_500_000, 'Worker input limit')
    request = json.loads(raw)
    if request.get('op') == 'import': result = import_book(base64.b64decode(request['base64'], validate=True))
    elif request.get('op') == 'export': result = export_book(request['book'])
    else: raise ValueError('Unsupported codec operation')
    encoded = json.dumps(result, ensure_ascii=True, separators=(',', ':'))
    need(len(encoded) <= 6_000_000, 'Worker output limit')
    print(encoded)
if __name__ == '__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'error': str(e)[:240]})); sys.exit(1)
