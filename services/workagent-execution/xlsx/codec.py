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
from copy import deepcopy
from xml.etree.ElementTree import Element, SubElement, tostring
from pathlib import PurePosixPath

resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_FSIZE, (24 * 1024 * 1024, 24 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
import openpyxl
from defusedxml.ElementTree import iterparse, fromstring
from openpyxl.reader.excel import ExcelReader
from openpyxl.formula.tokenizer import Tokenizer, TokenizerError
from openpyxl.formula.translate import Translator
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import range_boundaries, get_column_letter, column_index_from_string
from openpyxl.utils.datetime import to_excel, WINDOWS_EPOCH
from openpyxl.workbook.properties import CalcProperties
from openpyxl.worksheet.datavalidation import DataValidation
assert openpyxl.DEFUSEDXML

BYTES, INFLATED, ENTRY, CELLS = 2_000_000, 20_000_000, 5_000_000, 50_000
POLICY = ['Original bytes remain available. Native exchange preserves a bounded subset, not full Excel fidelity.',
          'Formula caches are discarded; supported formulas recalculate in the editor and on Excel open. Shared formulas expand to equivalent individual formulas.',
          'Bounded literal dropdowns and modern in-cell boolean/blank checkboxes are preserved. Checkbox formulas, merges, custom values and inherited row/column controls are refused. Legacy drawing controls and conditional checkbox styles are unsupported.',
          'Reference/name/custom validation is not retained; no validation formulas are evaluated. Checkbox insertion defaults do not replace saved values.',
          'Dropdown colors/chips and render-mode presentation are not retained. Error/prompt settings are carried; Excel and native warning dialogs may differ.',
          'Images, comments, hyperlinks, tables, names, print settings, protection and advanced styles are not carried into native exports.',
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

CONTROL_RESOURCE = 'SHEET_DATA_VALIDATION_PLUGIN'
EMPTY_RESOURCES = {'SHEET_RANGE_PROTECTION_PLUGIN', 'SHEET_AuthzIoMockService_PLUGIN', 'SHEET_WORKSHEET_PROTECTION_PLUGIN', 'SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN', 'SHEET_DEFINED_NAME_PLUGIN', 'SHEET_RANGE_THEME_MODEL_PLUGIN'}
ERROR_STYLES = {0: 'information', 1: 'stop', 2: 'warning'}
MESSAGE_LIMITS = {'errorTitle': 32, 'error': 225, 'promptTitle': 32, 'prompt': 255}

def inline_list(options):
    need(isinstance(options, list) and 1 <= len(options) <= 100, 'Unsupported inline-list options')
    for option in options:
        field(option, 200)
        # No quoting convention reliably escapes separators inside Excel inline
        # lists. Refuse rather than reinterpret or create hidden helper sheets.
        need(option and option == option.strip() and not re.search(r'[,;"\x00-\x1f\x7f]|_x[0-9a-fA-F]{4}_', option), 'Ambiguous inline-list option (separator, quote, control, edge whitespace or XML escape)')
        need(len(option.encode('utf-16-le')) // 2 <= 200, 'Inline-list option exceeds 200 UTF-16 units')
    encoded = '"' + ','.join(options) + '"'
    need(len(encoded.encode('utf-16-le')) // 2 <= 255, 'Inline-list source exceeds 255 UTF-16 units including quotes')
    return encoded

def validation_message(value, limit):
    field(value, limit)
    need(len(value.encode('utf-16-le')) // 2 <= limit and not re.search(r'_x[0-9a-fA-F]{4}_', value), 'Nonrepresentable validation message')
    return value

def validation_ranges(ref, occupied, budget):
    refs = ref.split(); need(refs, 'Validation requires bounded cell ranges')
    result = []
    for item in refs:
        need(bool(re.fullmatch(r'\$?[A-Z]{1,3}\$?[1-9][0-9]*(?::\$?[A-Z]{1,3}\$?[1-9][0-9]*)?', item)), 'Invalid validation range')
        a,b,c,d = bounds(item)
        budget[0] += 1; budget[1] += (c-a+1)*(d-b+1)
        need(budget[0] <= 1000 and budget[1] <= 100000, 'Validation range/area limit')
        need(not any(a <= cc and c >= aa and b <= dd and d >= bb for aa,bb,cc,dd in occupied), 'Overlapping validation ranges refused')
        occupied.append((a,b,c,d)); result.append({'startRow': b-1, 'endRow': d-1, 'startColumn': a-1, 'endColumn': c-1})
    return result

def import_validations(ws, sheet, sid, warnings):
    rules = []
    for index, dv in enumerate(ws.data_validations.dataValidation):
        source = dv.formula1
        if dv.type != 'list' or not isinstance(source, str) or not source.startswith('"') or not source.endswith('"') or dv.formula2 is not None or dv.operator is not None or dv.imeMode not in (None, 'noControl'):
            warnings.add('Unsupported validation not retained: only literal inline lists without extra operators/formulas are supported (no reference, name, external or custom formulas).')
            continue
        options = source[1:-1].split(','); need(inline_list(options) == source, 'Nonrepresentable inline list')
        ranges = validation_ranges(str(dv.sqref), [], [0, 0])
        rule = {'uid': f'xlsx-{sid}-{index+1}', 'type': 'list', 'formula1': json.dumps(options, ensure_ascii=True), 'ranges': ranges,
                'allowBlank': bool(dv.allowBlank), 'showDropDown': not bool(dv.showDropDown),
                'showErrorMessage': bool(dv.showErrorMessage), 'showInputMessage': bool(dv.showInputMessage) and not bool(ws.data_validations.disablePrompts),
                'errorStyle': {v:k for k,v in ERROR_STYLES.items()}[dv.errorStyle or 'stop']}
        for key, limit in MESSAGE_LIMITS.items():
            value = getattr(dv, key)
            if value is not None: rule[key] = validation_message(value, limit)
        for r in ranges:
            sheet['rowCount'] = max(sheet['rowCount'], r['endRow']+1)
            sheet['columnCount'] = max(sheet['columnCount'], r['endColumn']+1)
        rules.append(rule)
    return rules

def export_validations(book):
    result = {}; names = set(); count = 0; budget = [0, 0]
    resources = book.get('resources', [])
    need(isinstance(resources, list) and len(resources) <= 16, 'Unsupported native resources')
    for resource in resources:
        need(isinstance(resource, dict) and set(resource) == {'name', 'data'}, 'Unsupported native resource')
        name, data = resource['name'], resource['data']
        need(name not in names and isinstance(data, str) and len(data) <= 500000, 'Invalid native resource'); names.add(name)
        if name == 'SHEET_WORKAGENT_CHARTS_PLUGIN':
            native_charts(book)
            continue
        if name == 'SHEET_CONDITIONAL_FORMATTING_PLUGIN':
            native_conditionals(book)
            continue
        if name != CONTROL_RESOURCE:
            need(name in EMPTY_RESOURCES and data in ('', '{}', '[]'), 'Unsupported native resource'); continue
        controls = json.loads(data) if data else {}
        need(isinstance(controls, dict), 'Invalid native controls')
        for sid, rules in controls.items():
            need(sid in book['sheetOrder'] and sid not in ('__proto__', 'constructor', 'prototype') and isinstance(rules, list), 'Invalid control sheet')
            sheet = book['sheets'][sid]; occupied = []; ids = set(); result[sid] = []
            for rule in rules:
                count += 1; need(count <= 256, 'Validation rule limit')
                need(isinstance(rule, dict) and not set(rule) - {'uid','type','ranges','formula1','formula2','allowBlank','showDropDown','showErrorMessage','error','errorTitle','errorStyle','showInputMessage','prompt','promptTitle','renderMode'}, 'Unsupported native validation')
                uid = rule.get('uid')
                need(isinstance(uid, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', uid) and uid not in ids and uid not in ('__proto__', 'constructor', 'prototype'), 'Invalid/duplicate validation ID'); ids.add(uid)
                checkbox = rule.get('type') == 'checkbox'
                need(checkbox or rule.get('type') == 'list', 'Unsupported native controls')
                if checkbox:
                    need(rule.get('formula1') in (None,'','TRUE','true','1') and rule.get('formula2') in (None,'','FALSE','false','0'), 'Custom checkbox values cannot be exported')
                    need(rule.get('allowBlank', True) and rule.get('showDropDown', True)
                         and not rule.get('showErrorMessage', False) and not rule.get('showInputMessage', False)
                         and not any(rule.get(k) for k in MESSAGE_LIMITS) and 'renderMode' not in rule
                         and rule.get('errorStyle', 2) == 2, 'Unsupported checkbox validation flags')
                    source = None
                else: source = inline_list(json.loads(rule['formula1']))
                for key in ('allowBlank', 'showDropDown', 'showErrorMessage', 'showInputMessage'):
                    need(key not in rule or isinstance(rule[key], bool), 'Invalid validation boolean')
                need(rule.get('errorStyle', 2) in ERROR_STYLES, 'Invalid error style')
                dv = DataValidation(type='list', formula1=source, allowBlank=rule.get('allowBlank', True),
                    showDropDown=not rule.get('showDropDown', True), showErrorMessage=rule.get('showErrorMessage', True),
                    showInputMessage=rule.get('showInputMessage', False), errorStyle=ERROR_STYLES[rule.get('errorStyle', 2)])
                for key, limit in MESSAGE_LIMITS.items():
                    if key in rule: setattr(dv, key, validation_message(rule[key], limit))
                ranges = rule.get('ranges'); need(isinstance(ranges, list) and ranges, 'Validation requires ranges')
                for r in ranges:
                    need(isinstance(r, dict) and not set(r) - {'startRow','endRow','startColumn','endColumn','rangeType','startAbsoluteRefType','endAbsoluteRefType','unitId','sheetId'}, 'Invalid validation range')
                    need(all(type(r.get(k)) is int and r[k] >= 0 for k in ('startRow','endRow','startColumn','endColumn')), 'Invalid validation coordinates')
                    need(r['endRow'] < sheet['rowCount'] and r['endColumn'] < sheet['columnCount'] and r.get('unitId', book['id']) == book['id'] and r.get('sheetId', sid) == sid and r.get('rangeType', 0) == 0, 'Validation outside sheet')
                    ref = f"{get_column_letter(r['startColumn']+1)}{r['startRow']+1}:{get_column_letter(r['endColumn']+1)}{r['endRow']+1}"
                    validation_ranges(ref, occupied, budget); dv.add(ref)
                result[sid].append(rule if checkbox else dv)
    return result

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
FP = 'http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag'
FP_REL = 'http://schemas.microsoft.com/office/2022/11/relationships/FeaturePropertyBag'
FP_TYPE = 'application/vnd.ms-excel.featurepropertybag+xml'
FP_URI = '{C7286773-470A-42A8-94C5-96B5CB345126}'

# The Python worker repeats the shared sheet-charts.mjs contract at its trust
# boundary. JS validates again on adoption; neither accepts opaque chart payloads.
CHART_RESOURCE = 'SHEET_WORKAGENT_CHARTS_PLUGIN'
CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
DRAW = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
ART = 'http://schemas.openxmlformats.org/drawingml/2006/main'
CHART_TYPE = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
DRAW_TYPE = 'application/vnd.openxmlformats-officedocument.drawing+xml'
CHART_POLICY = 'Bounded clustered vertical column and standard line charts preserve plain titles and same-sheet rectangular header/label/series references (8 charts, 100 data rows, 4 series). Unsupported charts/drawing objects are refused. Chart caches are discarded; cells remain the source. Position, size, colors, legends and other presentation are not preserved; exports use deterministic anchors. Hidden source rows are included.'

def native_charts(book):
    resources = [r for r in book.get('resources', []) if r.get('name') == CHART_RESOURCE]
    need(len(resources) <= 1, 'Duplicate chart resource')
    charts = json.loads(resources[0]['data']) if resources else []
    need(isinstance(charts, list) and len(charts) <= 8, 'Chart count limit (8)')
    ids = set()
    for c in charts:
        need(isinstance(c, dict) and set(c) == {'id','title','type','sheetId','range'}, 'Invalid native chart')
        for key in ('id','sheetId'):
            v = c[key]
            need(isinstance(v,str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',v) and v not in ('__proto__','constructor','prototype'), 'Invalid chart ID')
        need(c['id'] not in ids, 'Duplicate chart ID'); ids.add(c['id'])
        field(c['title'],160); need(len(c['title'].encode('utf-16-le'))//2 <= 160, 'Chart title limit')
        need(c['type'] in ('bar','line') and c['sheetId'] in book['sheetOrder'], 'Unsupported chart type/sheet')
        r=c['range']; keys={'startRow','endRow','startColumn','endColumn'}
        need(isinstance(r,dict) and set(r)==keys and all(type(r[k]) is int and 0<=r[k]<=9007199254740991 for k in keys), 'Invalid chart range')
        need(1<=r['endRow']-r['startRow']<=100 and 1<=r['endColumn']-r['startColumn']<=4, 'Chart range limit (100 rows / 4 series)')
        s=book['sheets'][c['sheetId']]
        need(r['endRow']<s['rowCount'] and r['endColumn']<s['columnCount'], 'Chart outside sheet')
        need(not any(m['startRow']<=r['endRow'] and m['endRow']>=r['startRow'] and m['startColumn']<=r['endColumn'] and m['endColumn']>=r['startColumn'] for m in s.get('mergeData',[])), 'Merged chart source unsupported')
    return charts

def chart_reference(value, sheet_name):
    # No names, unions, dynamic formulas, external books or 3D references.
    m=re.fullmatch(r"(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z_0-9.]*))!(\$?[A-Z]{1,3}\$?[1-9][0-9]*(?::\$?[A-Z]{1,3}\$?[1-9][0-9]*)?)", value or '')
    need(m and (m[1].replace("''", "'") if m[1] else m[2]) == sheet_name, 'Chart requires contiguous same-sheet cell references')
    return bounds(m[3])

def chart_xml(raw, sheet_name):
    root=fromstring(raw); q=lambda n:'{'+CHART+'}'+n
    need(root.tag==q('chartSpace'), 'Invalid chart namespace/root')
    # Exact namespace AND placement checks precede openpyxl's local-name reader.
    schema={
      'chartSpace':'chart style roundedCorners spPr txPr date1904 lang',
      'chart':'title autoTitleDeleted plotArea legend plotVisOnly dispBlanksAs showDLblsOverMax',
      'title':'tx overlay layout spPr txPr', 'tx':'rich strRef',
      'plotArea':'layout barChart lineChart catAx valAx spPr',
      'barChart':'barDir grouping varyColors ser gapWidth overlap axId',
      'lineChart':'grouping varyColors ser marker smooth axId',
      'ser':'idx order tx spPr marker cat val smooth',
      'cat':'numRef strRef', 'val':'numRef', 'numRef':'f numCache', 'strRef':'f strCache',
      'numCache':'formatCode ptCount pt', 'strCache':'ptCount pt', 'pt':'v',
      'catAx':'axId scaling delete axPos majorGridlines minorGridlines numFmt majorTickMark minorTickMark tickLblPos spPr txPr crossAx crosses crossesAt auto lblAlgn lblOffset noMultiLvlLbl',
      'valAx':'axId scaling delete axPos majorGridlines minorGridlines numFmt majorTickMark minorTickMark tickLblPos spPr txPr crossAx crosses crossesAt crossBetween majorUnit minorUnit',
      'scaling':'orientation', 'legend':'legendPos layout overlay spPr txPr',
      'layout':'manualLayout', 'manualLayout':'layoutTarget xMode yMode wMode hMode x y w h',
      'marker':'symbol size spPr', 'majorGridlines':'spPr', 'minorGridlines':'spPr',
    }
    def walk(el):
        local=el.tag.removeprefix('{'+CHART+'}')
        need(el.tag==q(local) and all('}' not in k for k in el.attrib), 'Shadowed chart namespace/attribute')
        if local in ('spPr','txPr','rich'):
            for a in el.iter():
                if a is el: continue
                need(a.tag.startswith('{'+ART+'}') and a.tag.rsplit('}',1)[-1] not in ('hlinkClick','hlinkMouseOver','fld') and all('}' not in k or k=='{http://www.w3.org/XML/1998/namespace}space' for k in a.attrib), 'Unsupported chart presentation semantics')
            return
        attrs={'pt':{'idx'},'numFmt':{'formatCode','sourceLinked'},'f':set(),'v':set(),'formatCode':set()}.get(local, set() if local in schema else {'val'})
        need(set(el.attrib)<=attrs, 'Unsupported chart attributes')
        if local in ('numCache','strCache'): need(len(el.findall(q('pt')))<=100, 'Chart cache point limit')
        allowed=schema.get(local,'').split(); seen=set()
        for child in el:
            name=child.tag.removeprefix('{'+CHART+'}')
            need(name in allowed and (name not in seen or local in ('barChart','lineChart') and name in ('ser','axId') or local in ('numCache','strCache') and name=='pt'), 'Unsupported or duplicate chart element')
            seen.add(name); walk(child)
    walk(root)
    one=lambda el,path: el.find('/'.join(q(p) for p in path.split('/')))
    def val(el,path,default=None):
        x=one(el,path); return x.get('val') if x is not None else default
    need(val(root,'date1904','0') in ('0','false'), '1904 chart dates unsupported')
    chart=one(root,'chart'); need(chart is not None, 'Missing chart')
    plot=one(chart,'plotArea'); need(plot is not None, 'Missing plot area')
    kinds=[e for e in plot if e.tag in (q('barChart'),q('lineChart'))]
    need(len(kinds)==1, 'Combo/unsupported charts refused'); kind=kinds[0]; bar=kind.tag==q('barChart')
    need(val(kind,'grouping','clustered' if bar else 'standard')==('clustered' if bar else 'standard') and (not bar or val(kind,'barDir')=='col'), 'Only clustered vertical column / standard line charts supported')
    need(val(kind,'smooth','0') in ('0','false') and val(chart,'dispBlanksAs','gap')=='gap', 'Smooth/zero-filled/connected-gap charts unsupported')
    need(val(chart,'plotVisOnly','1') in ('0','1','true','false'), 'Invalid chart visibility boolean')
    canonical_id=lambda value: isinstance(value,str) and re.fullmatch(r'0|[1-9][0-9]{0,9}',value) and int(value)<=4294967295
    axes=[e for e in plot if e.tag in (q('catAx'),q('valAx'))]
    axids=[e.get('val') for e in kind.findall(q('axId'))]
    need(len(axes)==2 and {e.tag for e in axes}=={q('catAx'),q('valAx')} and len(axids)==2 and all(canonical_id(v) for v in axids) and len(set(axids))==2 and set(axids)=={val(e,'axId') for e in axes}, 'Secondary/ambiguous chart axes unsupported')
    for ax in axes:
        need(val(ax,'crossAx') in set(axids)-{val(ax,'axId')} and val(ax,'scaling/orientation','minMax')=='minMax' and val(ax,'delete','0') in ('0','false'), 'Unsupported chart axes')
    title=''; parsed_title=''; t=one(chart,'title')
    if t is not None:
        rich=one(t,'tx/rich'); need(rich is not None and len(one(t,'tx'))==1, 'Formula-linked chart titles unsupported')
        need(all(e.tag in ('{'+ART+'}bodyPr','{'+ART+'}lstStyle','{'+ART+'}p') for e in rich) and len(rich.findall('{'+ART+'}bodyPr'))==1 and len(rich.findall('{'+ART+'}lstStyle'))<=1, 'Rich chart titles unsupported')
        paragraphs=rich.findall('{'+ART+'}p')
        # openpyxl serializes plain newlines as separate DrawingML paragraphs.
        # Keep empty paragraphs (including leading/trailing lines), but retain
        # the single plain run restriction within each paragraph.
        need(1<=len(paragraphs)<=161, 'Chart title paragraph limit')
        lines=[]; parsed_lines=[]
        for p in paragraphs:
            runs=p.findall('{'+ART+'}r')
            need(len(runs)<=1 and all(e.tag in ('{'+ART+'}pPr','{'+ART+'}r','{'+ART+'}endParaRPr') for e in p), 'Rich chart titles unsupported')
            if not runs:
                lines.append(''); parsed_lines.append(''); continue
            texts=runs[0].findall('{'+ART+'}t')
            need(len(texts)==1 and all(e.tag in ('{'+ART+'}rPr','{'+ART+'}t') for e in runs[0]) and not len(texts[0]), 'Rich chart titles unsupported')
            lines.append(texts[0].text or '')
            # Installed openpyxl converts an empty <a:t/> to the string 'None'.
            # Check that exact parser result against raw XML; never globally
            # normalize literal 'None' text, nor adopt it for an empty line.
            parsed_lines.append('None' if texts[0].text is None else texts[0].text)
        parsed_title='\n'.join(parsed_lines)
        title=field('\n'.join(lines),160); need(len(title.encode('utf-16-le'))//2<=160, 'Chart title limit')
        need(val(chart,'autoTitleDeleted','0') in ('0','false'), 'Deleted chart title unsupported')
    series=kind.findall(q('ser')); need(1<=len(series)<=4, 'Chart series limit (4)')
    refs=[]; geometry=None; indexes=set()
    for i,s in enumerate(series):
        need(val(s,'order')==str(i) and val(s,'idx') not in indexes and canonical_id(val(s,'idx')), 'Ambiguous chart series order'); indexes.add(val(s,'idx'))
        need(val(s,'smooth','0') in ('0','false'), 'Smooth charts unsupported')
        tx=one(s,'tx/strRef/f'); cats=one(s,'cat'); nums=one(s,'val/numRef/f')
        need(tx is not None and len(one(s,'tx'))==1 and cats is not None and len(cats)==1 and nums is not None, 'Chart requires header/label/numeric series references')
        cat=one(cats[0],'f'); need(cat is not None, 'Chart labels require cell references')
        refs.append((tx.text,cat.text,nums.text))
        h=chart_reference(tx.text,sheet_name); l=chart_reference(cat.text,sheet_name); v=chart_reference(nums.text,sheet_name)
        need(h[0]==h[2]==v[0]==v[2] and h[1]==h[3]==v[1]-1 and l[0]==l[2] and l[1]==v[1] and l[3]==v[3] and v[0]==l[0]+i+1, 'Incompatible chart header/label/series geometry')
        g=(l[0],h[1],l[3]); need(geometry in (None,g), 'Incompatible chart series ranges'); geometry=g
    a,b,d=geometry; need(1<=d-b<=100, 'Chart row limit (100)')
    return {'title':title,'parsedTitle':parsed_title,'type':'bar' if bar else 'line','range':{'startRow':b-1,'endRow':d-1,'startColumn':a-1,'endColumn':a+len(series)-1},'refs':refs,'visibleOnly':val(chart,'plotVisOnly','1') not in ('0','false')}

def chart_parts(parts, descriptors):
    import posixpath
    types=fromstring(parts['[Content_Types].xml'])
    overrides={e.get('PartName','')[1:]:e.get('ContentType') for e in types if e.tag=='{'+CONTENT+'}Override'}
    relationships={}
    for name,raw in parts.items():
        if not name.endswith('.rels'): continue
        root=fromstring(raw); need(root.tag=='{'+PACKAGE_REL+'}Relationships','Invalid relationship namespace')
        base=posixpath.dirname(posixpath.dirname(name))+'/' if name!='_rels/.rels' else ''
        rels={}
        for e in root:
            need(e.tag=='{'+PACKAGE_REL+'}Relationship' and not len(e) and set(e.attrib)<= {'Id','Type','Target','TargetMode'}, 'Shadowed relationship')
            rid=e.get('Id'); need(rid and rid not in rels,'Duplicate relationship ID')
            target=e.get('Target',''); mode=e.get('TargetMode','Internal'); kind=e.get('Type')
            if kind in (REL+'/chart',REL+'/drawing'):
                need(mode=='Internal' and target and not re.search(r'[\\%?#:]',target),'Unsafe chart/drawing relationship')
                target=posixpath.normpath(target.lstrip('/') if target.startswith('/') else base+target)
                need(target.startswith('xl/') and target in parts and overrides.get(target)==(CHART_TYPE if kind==REL+'/chart' else DRAW_TYPE),'Invalid chart/drawing target/type')
            rels[rid]=(kind,target)
        relationships[name]=rels
    def rels_for(path): return relationships.get(posixpath.dirname(path)+'/_rels/'+posixpath.basename(path)+'.rels',{})
    used_draw=set(); used_chart=set(); result={}; count=0
    for desc in descriptors:
        sheet=fromstring(parts[desc['path']]); drawings=[]
        for parent in sheet.iter():
            for e in parent:
                if e.tag.rsplit('}',1)[-1]=='drawing':
                    need(parent is sheet and e.tag=='{'+MAIN+'}drawing' and set(e.attrib)=={'{'+REL+'}id'} and not len(e),'Shadowed worksheet drawing')
                    drawings.append(e)
        need(len(drawings)<=1,'Multiple worksheet drawings unsupported')
        result[desc['path']]=[]
        for e in drawings:
            kind,path=rels_for(desc['path']).get(e.get('{'+REL+'}id'),(None,None))
            need(kind==REL+'/drawing' and path not in used_draw,'Invalid/shared drawing'); used_draw.add(path)
            drawing=fromstring(parts[path]); need(drawing.tag=='{'+DRAW+'}wsDr','Invalid drawing namespace')
            # No images, shapes, groups, controls, AlternateContent or shadow nodes.
            allowed={'wsDr':'absoluteAnchor oneCellAnchor twoCellAnchor','absoluteAnchor':'pos ext graphicFrame clientData','oneCellAnchor':'from ext graphicFrame clientData','twoCellAnchor':'from to graphicFrame clientData','from':'col colOff row rowOff','to':'col colOff row rowOff','graphicFrame':'nvGraphicFramePr xfrm graphic','nvGraphicFramePr':'cNvPr cNvGraphicFramePr','cNvGraphicFramePr':'graphicFrameLocks','xfrm':'off ext','graphic':'graphicData','graphicData':'chart'}
            def check(node):
                local=node.tag.rsplit('}',1)[-1]; ns=ART if local in ('graphic','graphicData','off','graphicFrameLocks') else CHART if local=='chart' else DRAW
                # a:xfrm children use DrawingML; spreadsheet xfrm itself uses xdr.
                need(node.tag=='{'+ns+'}'+local or local=='ext' and node.tag=='{'+ART+'}ext','Shadowed drawing namespace')
                need(all('}' not in k or local=='chart' and k=='{'+REL+'}id' for k in node.attrib),'Shadowed drawing attribute')
                if local=='chart': need(set(node.attrib)=={'{'+REL+'}id'}, 'Invalid chart relationship identity')
                seen=set()
                for child in node:
                    tag=child.tag.rsplit('}',1)[-1]
                    need(tag in allowed.get(local,'').split() and (tag not in seen or local=='wsDr'),'Unsupported drawing object/structure')
                    seen.add(tag); check(child)
            check(drawing)
            # Match the installed parser's anchor order, not arbitrary XML order.
            for anchor_type in ('absoluteAnchor','oneCellAnchor','twoCellAnchor'):
                for anchor in drawing.findall('{'+DRAW+'}'+anchor_type):
                    refs=anchor.findall('.//{'+CHART+'}chart'); need(len(refs)==1,'Unsupported drawing object')
                    graphic=anchor.find('.//{'+ART+'}graphicData'); need(graphic is not None and graphic.get('uri')==CHART,'Invalid chart graphic URI')
                    kind,target=rels_for(path).get(refs[0].get('{'+REL+'}id'),(None,None))
                    need(kind==REL+'/chart' and target not in used_chart,'Invalid/shared chart relationship'); used_chart.add(target)
                    count+=1; need(count<=8,'Chart count limit (8)')
                    result[desc['path']].append(chart_xml(parts[target],desc['name']))
    need(used_chart=={p for p,t in overrides.items() if t==CHART_TYPE} and used_draw=={p for p,t in overrides.items() if t==DRAW_TYPE},'Orphan/unsupported chart or drawing part')
    need(used_chart=={target for rs in relationships.values() for kind,target in rs.values() if kind==REL+'/chart'} and used_draw=={target for rs in relationships.values() for kind,target in rs.values() if kind==REL+'/drawing'},'Unbound chart/drawing relationship')
    need(sum(kind==REL+'/chart' for rs in relationships.values() for kind,_ in rs.values())==len(used_chart) and sum(kind==REL+'/drawing' for rs in relationships.values() for kind,_ in rs.values())==len(used_draw), 'Duplicate chart/drawing relationship target')
    return result

def loaded_chart_matches(chart, expected):
    from openpyxl.chart import BarChart, LineChart
    need(type(chart)==(BarChart if expected['type']=='bar' else LineChart) and len(chart._charts)==1, 'Loaded chart type mismatch')
    title='\n'.join((p.r[0].t or '') if p.r else '' for p in chart.title.tx.rich.p) if chart.title else ''
    need(len(chart._axes)==2 and chart.x_axis.axId!=chart.y_axis.axId and chart.x_axis.crossAx==chart.y_axis.axId and chart.y_axis.crossAx==chart.x_axis.axId and chart.visible_cells_only==expected['visibleOnly'] and chart.display_blanks=='gap', 'Loaded chart axes/visibility mismatch')
    refs=[(s.tx.strRef.f, (s.cat.numRef or s.cat.strRef).f, s.val.numRef.f) for s in chart.ser]
    need(title==expected['parsedTitle'] and refs==expected['refs'] and chart.grouping==('clustered' if expected['type']=='bar' else 'standard') and (expected['type']!='bar' or chart.type=='col'), 'Loaded chart semantics mismatch')

def integer(value, limit, message='Invalid checkbox metadata index'):
    need(isinstance(value, str) and re.fullmatch(r'0|[1-9][0-9]*', value) and len(value) <= 10, message)
    result = int(value); need(result < limit, message); return result

def checkbox_ranges(cells):
    # Compress horizontal runs, then identical runs on consecutive rows. Never
    # expand sheet dimensions or row/column styles into implicit cells.
    rows = {}
    for row, col in sorted(cells): rows.setdefault(row, []).append(col)
    result = []; active = {}
    for row, cols in rows.items():
        runs = []
        for col in cols:
            if runs and col == runs[-1][1]+1: runs[-1][1] = col
            else: runs.append([col, col])
        following = {}
        for start, end in runs:
            previous = active.get((start, end))
            if previous is not None and previous['endRow'] == row-1: previous['endRow'] = row
            else:
                previous = {'startRow':row,'endRow':row,'startColumn':start,'endColumn':end}
                result.append(previous); need(len(result) <= 1000, 'Checkbox range limit')
            following[start, end] = previous
        active = following
    return result

def checkbox_metadata(parts, worksheets):
    """Read only schema-validated explicit cell controls, before openpyxl loses XFs.

    MS-XLSX XFComplements maps xfComplement.i through an array of bag IDs;
    Checkbox/default is an insertion setting, never a persisted cell value.
    """
    rels = fromstring(parts['xl/_rels/workbook.xml.rels'])
    def target(kind):
        matches = [el for el in rels if el.get('Type') == kind]
        need(len(matches) <= 1, 'Duplicate checkbox/style relationship')
        if not matches: return None
        el = matches[0]; value = el.get('Target', '')
        need(el.get('TargetMode', 'Internal') == 'Internal' and value and not re.search(r'[\\%?#:]', value), 'Invalid checkbox/style relationship')
        value = value[1:] if value.startswith('/') else 'xl/'+value
        need(value in parts and str(PurePosixPath(value)) == value and '..' not in PurePosixPath(value).parts, 'Missing or unsafe checkbox/style part')
        return value
    feature, style = target(FP_REL), target(REL+'/styles')
    feature_relationships = []
    for name, raw in parts.items():
        if name.endswith('.rels'):
            feature_relationships.extend(name for e in fromstring(raw) if e.get('Type') == FP_REL)
    need(feature_relationships == (['xl/_rels/workbook.xml.rels'] if feature else []), 'Conflicting checkbox relationships')
    types = fromstring(parts['[Content_Types].xml'])
    feature_parts = [e.get('PartName','')[1:] for e in types if e.get('ContentType') == FP_TYPE]
    need(feature_parts == ([feature] if feature else []), 'Ambiguous feature property bag content type')
    if not style:
        need(not feature and 'xl/styles.xml' not in parts, 'Missing checkbox/style relationship'); return {}
    # openpyxl reads this canonical styles part, so reject aliases rather than
    # resolve control metadata against different styles than the cell reader.
    need(style == 'xl/styles.xml' and any(e.get('PartName') == '/'+style and e.get('ContentType') == 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml' for e in types), 'Unsupported styles part mapping')
    root = fromstring(parts[style]); need(root.tag == '{'+MAIN+'}styleSheet', 'Invalid styles root')
    # openpyxl's style deserializers use local names, including collection
    # replacement. A foreign or misplaced collection can reorder XF indices.
    collections = {'cellXfs','cellStyleXfs','fonts','fills','borders','numFmts','cellStyles','dxfs','tableStyles','colors'}
    seen = set()
    for parent in root.iter():
        for child in parent:
            local = child.tag.rsplit('}',1)[-1]
            if local in collections:
                need(parent is root and child.tag == '{'+MAIN+'}'+local and local not in seen,
                     'Shadowed style collection')
                seen.add(local)
            if local in ('xf','extLst','ext'):
                need(child.tag == '{'+MAIN+'}'+local, 'Shadowed style metadata')
            if parent.tag in ('{'+MAIN+'}cellXfs','{'+MAIN+'}cellStyleXfs'):
                need(child.tag == '{'+MAIN+'}xf', 'Invalid style collection child')
            if local == 'xf':
                identity_attributes(child, {k:k for k in ('xfId','fontId','fillId','borderId','numFmtId')})
                need(not any(e.tag.rsplit('}',1)[-1] in ('xfId','fontId','fillId','borderId','numFmtId') for e in child),
                     'Nested style identity')
    groups = root.findall('{'+MAIN+'}cellXfs'); need(len(groups) == 1, 'Ambiguous cell styles')
    xfs = groups[0]; need(0 < len(xfs) <= 4000 and all(x.tag == '{'+MAIN+'}xf' for x in xfs), 'Invalid cell styles')
    need('count' not in xfs.attrib or integer(xfs.get('count'), 4001) == len(xfs), 'Invalid style count')
    bases = root.findall('{'+MAIN+'}cellStyleXfs'); need(len(bases) <= 1, 'Ambiguous base styles')
    for xf in xfs:
        if 'xfId' in xf.attrib: integer(xf.get('xfId'), len(bases[0]) if bases else 0, 'Invalid base style index')
    recognized = []
    for index, xf in enumerate(xfs):
        extensions = xf.findall('{'+MAIN+'}extLst/{'+MAIN+'}ext')
        matches = [ext for ext in extensions if ext.get('uri') == FP_URI or any(e.tag.rsplit('}',1)[-1] == 'xfComplement' for e in ext.iter())]
        if matches:
            need(len(matches) == 1 and len(matches[0]) == 1 and matches[0].get('uri') == FP_URI, 'Ambiguous checkbox style extension')
            ref = matches[0][0]
            need(ref.tag == '{'+FP+'}xfComplement' and set(ref.attrib) == {'i'} and not len(ref), 'Invalid checkbox style namespace/schema')
            recognized.append((index, ref.get('i')))
    # Conditional and named/base-style controls require inheritance/evaluation
    # semantics outside this slice. Do not claim to have carried them.
    all_refs = [e for e in root.iter() if e.tag.rsplit('}',1)[-1] == 'xfComplement']
    need(len(all_refs) == len(recognized), 'Conditional or inherited checkbox styles unsupported')
    need(not recognized or feature, 'Missing checkbox feature property bag')
    if not feature: return {}
    bags_root = fromstring(parts[feature])
    need(bags_root.tag == '{'+FP+'}FeaturePropertyBags' and not bags_root.attrib, 'Invalid feature property bag root')
    bags = list(bags_root); need(1 <= len(bags) <= 4000, 'Feature property bag limit')
    need(sum(1 for _ in bags_root.iter()) <= 16000, 'Feature property element limit')
    need(all(not (el.text or '').strip() for el in bags_root.iter() if el.tag in ('{'+FP+'}FeaturePropertyBags','{'+FP+'}bag','{'+FP+'}a'))
         and all(not (el.tail or '').strip() for el in bags_root.iter()), 'Invalid feature property text')
    mapper = []; links = {}
    for index, bag in enumerate(bags):
        kind = bag.get('type')
        need(bag.tag == '{'+FP+'}bag' and kind in ('Checkbox','XFControls','XFComplement','XFComplements'), 'Unsupported feature property bag')
        need(set(bag.attrib) == ({'type','extRef'} if kind == 'XFComplements' else {'type'}), 'Unsupported feature property attributes')
        if kind == 'Checkbox':
            need(len(bag) <= 1, 'Unsupported checkbox properties')
            if len(bag):
                prop = bag[0]
                need(prop.tag == '{'+FP+'}i' and prop.attrib == {'k':'default'} and not len(prop), 'Invalid checkbox default')
                integer(prop.text, 3, 'Invalid checkbox default')
        elif kind == 'XFComplements':
            need(not mapper and bag.get('extRef') == 'XFComplementsMapperExtRef' and len(bag) == 1, 'Ambiguous checkbox mapper')
            array = bag[0]
            need(array.tag == '{'+FP+'}a' and array.attrib == {'k':'MappedFeaturePropertyBags'} and 1 <= len(array) <= 4000, 'Invalid checkbox mapper array')
            for ref in array:
                need(ref.tag == '{'+FP+'}bagId' and not ref.attrib and not len(ref), 'Invalid checkbox mapper reference')
                mapper.append(integer(ref.text, len(bags)))
        else:
            key = 'CellControl' if kind == 'XFControls' else 'XFControls'
            need(len(bag) == 1, 'Unsupported checkbox feature combination')
            ref = bag[0]
            need(ref.tag == '{'+FP+'}bagId' and ref.attrib == {'k':key} and not len(ref), 'Invalid checkbox bag reference')
            links[index] = integer(ref.text, len(bags))
    need(mapper, 'Missing checkbox mapper')
    # Validate every edge, including unused bags. Fixed type progression rules
    # out cycles without recursive traversal of attacker-controlled graphs.
    for index, dest in links.items():
        expected = 'Checkbox' if bags[index].get('type') == 'XFControls' else 'XFControls'
        need(bags[dest].get('type') == expected, 'Invalid/cyclic checkbox bag reference')
    need(all(bags[i].get('type') == 'XFComplement' for i in mapper), 'Invalid checkbox mapper target')
    checkbox_styles = set()
    for index, mapping in recognized:
        integer(mapping, len(mapper)); checkbox_styles.add(index)
    need(0 not in checkbox_styles, 'Default/inherited checkbox style unsupported')
    result = {}
    for name in worksheets:
        sheet = fromstring(parts[name]); cells = set(); ranges = []
        parents = {child:parent for parent in sheet.iter() for child in parent}
        for el in sheet.iter():
            if el.tag in ('{'+MAIN+'}row','{'+MAIN+'}col'):
                value = el.get('s') if el.tag.endswith('}row') else el.get('style')
                if value is not None: need(integer(value, len(xfs)) not in checkbox_styles, 'Inherited row/column checkbox styles unsupported')
            elif el.tag == '{'+MAIN+'}c':
                index = integer(el.get('s','0'), len(xfs))
                if index not in checkbox_styles: continue
                a,b,_,_ = bounds(el.get('r',''))
                parent = parents.get(el)
                need(parent is not None and parent.tag == '{'+MAIN+'}row' and parent.get('r') == str(b)
                     and parents.get(parent) is sheet.find('{'+MAIN+'}sheetData'), 'Invalid checkbox cell placement')
                need(el.get('t') in (None,'n','b') and all(e.tag == '{'+MAIN+'}v' for e in el) and len(el) <= 1, 'Checkbox formula/rich/nonboolean cell unsupported')
                if len(el): need(el.get('t') == 'b' and el[0].text in ('0','1') and not el[0].attrib and not len(el[0]), 'Checkbox requires boolean or blank value')
                cells.add((b-1,a-1))
            elif el.tag == '{'+MAIN+'}mergeCell': ranges.append(('merge', bounds(el.get('ref',''))))
            elif el.tag == '{'+MAIN+'}dataValidation':
                ranges.extend(('validation', bounds(ref)) for ref in el.get('sqref','').split())
        for row,col in cells:
            need(not any(a <= col+1 <= c and b <= row+1 <= d for _,(a,b,c,d) in ranges), 'Checkbox overlap with validation/merge unsupported')
        if cells: result[name] = checkbox_ranges(cells)
    return result

def add_checkbox_parts(data, controls):
    # Only the fresh openpyxl output is transformed; no original ZIP members
    # are passed through. Clone each base XF once, preserving ordinary cells.
    with zipfile.ZipFile(io.BytesIO(data)) as z: parts = {n:z.read(n) for n in z.namelist()}
    styles = fromstring(parts['xl/styles.xml']); xfs = styles.find('{'+MAIN+'}cellXfs'); clones = {}
    for index, cells in controls.items():
        name = f'xl/worksheets/sheet{index}.xml'; sheet = fromstring(parts[name])
        sheet_data = sheet.find('{'+MAIN+'}sheetData')
        rows = {int(row.get('r')):row for row in sheet_data}
        existing = {cell.get('r') for cell in sheet_data.iter('{'+MAIN+'}c')}
        for ref in sorted(cells - existing, key=lambda ref: (bounds(ref)[1],bounds(ref)[0])):
            col,row,_,_ = bounds(ref)
            if row not in rows:
                rows[row] = Element('{'+MAIN+'}row', r=str(row)); sheet_data.append(rows[row])
            SubElement(rows[row], '{'+MAIN+'}c', r=ref)
        sheet_data[:] = sorted(sheet_data, key=lambda row:int(row.get('r')))
        for row in sheet_data: row[:] = sorted(row, key=lambda cell:bounds(cell.get('r'))[0])
        found = set()
        for cell in sheet.iter('{'+MAIN+'}c'):
            ref = cell.get('r')
            if ref not in cells: continue
            found.add(ref); base = int(cell.get('s','0'))
            if base not in clones:
                clone = deepcopy(xfs[base]); clones[base] = len(xfs); xfs.append(clone)
                ext = SubElement(SubElement(clone, '{'+MAIN+'}extLst'), '{'+MAIN+'}ext', uri=FP_URI)
                SubElement(ext, '{'+FP+'}xfComplement', i='0')
            cell.set('s', str(clones[base]))
        need(found == cells, 'Missing exported checkbox cell')
        parts[name] = tostring(sheet)
    xfs.set('count',str(len(xfs))); parts['xl/styles.xml'] = tostring(styles)
    root = Element('{'+FP+'}FeaturePropertyBags')
    SubElement(root, '{'+FP+'}bag', type='Checkbox')
    SubElement(SubElement(root, '{'+FP+'}bag', type='XFControls'), '{'+FP+'}bagId', k='CellControl').text = '0'
    SubElement(SubElement(root, '{'+FP+'}bag', type='XFComplement'), '{'+FP+'}bagId', k='XFControls').text = '1'
    mapper = SubElement(root, '{'+FP+'}bag', type='XFComplements', extRef='XFComplementsMapperExtRef')
    SubElement(SubElement(mapper, '{'+FP+'}a', k='MappedFeaturePropertyBags'), '{'+FP+'}bagId').text = '2'
    part = 'xl/featurePropertyBag/featurePropertyBag.xml'; parts[part] = tostring(root)
    rels = fromstring(parts['xl/_rels/workbook.xml.rels'])
    SubElement(rels, '{'+PACKAGE_REL+'}Relationship', Id='workagentCheckbox', Type=FP_REL, Target='featurePropertyBag/featurePropertyBag.xml')
    parts['xl/_rels/workbook.xml.rels'] = tostring(rels)
    types = fromstring(parts['[Content_Types].xml'])
    SubElement(types, '{'+CONTENT+'}Override', PartName='/'+part, ContentType=FP_TYPE)
    parts['[Content_Types].xml'] = tostring(types)
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, raw in parts.items(): z.writestr(name, raw)
    return out.getvalue()

def identity_attributes(el, expected):
    # Serialisable.from_tree strips namespaces and also consumes child local
    # names. Refuse alternate spellings of identities we validate separately.
    for key in el.attrib:
        local = key.rsplit('}', 1)[-1]
        if local in expected:
            need(key == expected[local], 'Shadowed XLSX identity attribute')

def worksheet_parts(parts):
    def xml(name, root):
        need(name in parts, 'Missing XLSX package part')
        element = fromstring(parts[name]); need(element.tag == root, 'Invalid XLSX package root')
        return element
    types = xml('[Content_Types].xml', '{'+CONTENT+'}Types')
    overrides = {}; defaults = {}
    for el in types:
        need(not len(el), 'Nested content type identity')
        identity_attributes(el, {k:k for k in ('PartName','ContentType','Extension')})
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
            need(not len(el), 'Nested relationship identity')
            identity_attributes(el, {k:k for k in ('Id','Type','Target','TargetMode')})
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
    for parent in wb.iter():
        for child in parent:
            local = child.tag.rsplit('}',1)[-1]
            if local in ('workbook','sheets','sheet'):
                need(child.tag == '{'+MAIN+'}'+local and
                     ((local == 'sheets' and parent is wb) or
                      (local == 'sheet' and parent.tag == '{'+MAIN+'}sheets' and parent in list(wb))),
                     'Shadowed workbook sheet structure')
    groups = wb.findall('{'+MAIN+'}sheets'); need(len(groups) == 1, 'Ambiguous workbook sheets')
    result = []; descriptors = []; ids = set(); names = set(); refs = set()
    for el in groups[0]:
        need(not len(el), 'Nested worksheet identity')
        identity_attributes(el, {'name':'name','sheetId':'sheetId','id':'{'+REL+'}id','state':'state'})
        rid, sid, name = el.get('{'+REL+'}id'), el.get('sheetId'), el.get('name', '').lower()
        need(el.tag == '{'+MAIN+'}sheet' and rid in rels and rid not in refs and sid and sid not in ids and name and name not in names, 'Ambiguous worksheet identity')
        kind,target = rels[rid]
        need(kind == REL+'/worksheet' and part_type(target) == WORKSHEET_TYPE and target not in result, 'Invalid worksheet part type/relationship')
        descriptors.append({'path':target, 'name':el.get('name'), 'id':rid, 'sheetId':int(sid)})
        result.append(target); ids.add(sid); names.add(name); refs.add(rid)
    need(1 <= len(result) <= 20, 'Worksheet count limit')
    need(set(result) == {name for name in parts if part_type(name) == WORKSHEET_TYPE}
         and refs == {rid for rid,(kind,_) in rels.items() if kind == REL+'/worksheet'}, 'Ambiguous worksheet parts')
    return descriptors

# Conditional highlights are author rules, never calculated cell styles. The
# expression language below is a closed set: import reconstructs the entire
# template and compares it byte-for-byte; it never evaluates a supplied formula.
CF_RESOURCE = 'SHEET_CONDITIONAL_FORMATTING_PLUGIN'
CF_POLICY = 'Conditional highlights: six numeric comparisons (>, >=, <, <=, between, not-between) and six case-sensitive text comparisons with unambiguous literals are preserved. Numeric equality, blank/error text operators, ambiguous literals, scales, bars, icons and other expressions/differential styles are refused.'
CF_INPUT_POLICY = 'Conditional exports refuse precision loss or CR/CRLF normalization in rule text and covered cell inputs. If a rule covers a formula, inputs across all tabs must serialize exactly; LF, tabs and ordinary Unicode remain supported.'
CF_ERRORS = ('#DIV/0!', '#NAME?', '#VALUE!', '#NUM!', '#N/A', '#CYCLE!', '#REF!', '#SPILL!', '#CALC!', '#ERROR!', '#GETTING_DATA', '#NULL!')
CF_NUM = {'greaterThan':'>','greaterThanOrEqual':'>=','lessThan':'<','lessThanOrEqual':'<=','between':None,'notBetween':None}
CF_TEXT = ('equal','notEqual','beginsWith','endsWith','containsText','notContainsText')

def cf_object(value, keys, required=()):
    need(isinstance(value, dict) and not set(value)-set(keys) and set(required)<=set(value), 'Unsupported conditional formatting fields')

def cf_id(value):
    need(isinstance(value,str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',value) and value not in ('__proto__','constructor','prototype'), 'Invalid conditional formatting identity')

def cf_number(value):
    need(type(value) in (int,float) and math.isfinite(value) and abs(value)<=999999999999999
         and (value==0 or abs(value)>=2.2250738585072014e-308) and float(format(value,'.15g'))==value, 'Conditional numeric threshold needs 15 significant digits, magnitude below 10^15 and no subnormal values')
    return format(value,'.15g')

def cf_literal(value):
    field(value,200)
    # Native converts numbers with JS String(), booleans via its internal 0/1
    # representation, errors to their names, and whitespace-only strings to ''.
    # These literals cannot match any of those coercions in either engine.
    need(value and any((c.isalpha() and c not in 'eE') or c in '\"<>&*?~' for c in value)
         and not any(value in x for x in ('TRUE','FALSE',*CF_ERRORS))
         and not re.search(r'_x[0-9a-fA-F]{4}_',value),
         'Conditional text literal is ambiguous across Excel/native coercion; include distinctive text, quotes, XML or wildcard characters')
    need(len(value.encode('utf-16-le'))//2<=200, 'Conditional text literal exceeds 200 UTF-16 units')
    return '"'+value.replace('"','""')+'"'

def cf_formula(rule, ref):
    op=rule.get('operator'); value=rule.get('value')
    if rule.get('subType')=='number':
        need(op in CF_NUM, 'Conditional numeric equality/not-equality unsupported: native uses floating-point tolerance')
        if op in ('between','notBetween'):
            need(isinstance(value,list) and len(value)==2, 'Conditional comparison needs two thresholds')
            a,b=map(cf_number,value); need(value[0]<=value[1], 'Crossed conditional thresholds')
            compare=f'AND({ref}>={a},{ref}<={b})'
            if op=='notBetween': compare=f'NOT({compare})'
        else: compare=f'{ref}{CF_NUM[op]}{cf_number(value)}'
        nonnumber='FALSE'
        if op in ('greaterThan','greaterThanOrEqual','notBetween'):
            nonnumber='NOT(OR('+','.join(f'EXACT({ref},"{e}")' for e in CF_ERRORS)+'))'
        return f'IFERROR(IF(OR(ISNUMBER({ref}),ISBLANK({ref})),{compare},{nonnumber}),FALSE)'
    need(rule.get('subType')=='text' and op in CF_TEXT, 'Conditional blank/error text operators unsupported: native whitespace/error coercion differs')
    literal=cf_literal(value)
    if op in ('equal','notEqual'): expr=f'EXACT({ref},{literal})'
    elif op in ('beginsWith','endsWith'): expr=f'EXACT({"LEFT" if op=="beginsWith" else "RIGHT"}({ref},LEN({literal})),{literal})'
    else: expr=f'ISNUMBER(FIND({literal},{ref}))'
    expr=f'IFERROR({expr},FALSE)'
    return f'NOT({expr})' if op in ('notEqual','notContainsText') else expr

def parse_cf_formula(text, ref):
    need(isinstance(text,str) and len(text)<=2000, 'Conditional expression limit')
    # Extract only literal candidates, then require the complete known grammar.
    if text.startswith('IFERROR(IF(OR(ISNUMBER('):
        nums=re.findall(r'(?<=[<>=])(-?(?:[0-9]+(?:\.[0-9]+)?)(?:e[+-]?[0-9]+)?)',text)
        for op in CF_NUM:
            if len(nums)!=(2 if op in ('between','notBetween') else 1): continue
            values=[float(n) for n in nums]
            rule={'type':'highlightCell','subType':'number','operator':op,'value':values if len(values)==2 else values[0]}
            if cf_formula(rule,ref)==text: return rule
    else:
        literals=re.findall(r'"((?:[^"]|"")*)"',text)
        if literals:
            value=literals[0].replace('""','"')
            for op in CF_TEXT:
                rule={'type':'highlightCell','subType':'text','operator':op,'value':value}
                if cf_formula(rule,ref)==text: return rule
    need(False, 'Unsupported conditional expression; use the bounded Workagent comparison templates (Excel built-ins differ on case, blanks and errors)')

def cf_ranges(text, budget):
    need(isinstance(text,str) and text and len(text)<=30000, 'Invalid conditional ranges')
    refs=text.split(); result=[]; seen=set()
    for ref in refs:
        need(re.fullmatch(r'[A-Z]{1,3}[1-9][0-9]*(?::[A-Z]{1,3}[1-9][0-9]*)?',ref) and ref not in seen, 'Invalid/duplicate conditional range'); seen.add(ref)
        a,b,c,d=bounds(ref); budget[0]+=1; budget[1]+=(c-a+1)*(d-b+1)
        need(budget[0]<=1000 and budget[1]<=100000, 'Conditional range/area limit')
        result.append({'startRow':b-1,'endRow':d-1,'startColumn':a-1,'endColumn':c-1})
    # openpyxl stores sqref as a set, ordered by column then row. Disallow an
    # ambiguous anchor instead of silently moving a relative expression.
    need(refs==sorted(refs,key=lambda x:bounds(x)), 'Conditional ranges must be in canonical column/row order')
    return result

def cf_ref(r):
    a=f"{get_column_letter(r['startColumn']+1)}{r['startRow']+1}"
    b=f"{get_column_letter(r['endColumn']+1)}{r['endRow']+1}"
    return a if a==b else a+':'+b

def cf_color(value):
    need(isinstance(value,str), 'Conditional color must be RGB')
    if re.fullmatch(r'#[0-9a-fA-F]{3}',value): value='#'+''.join(c*2 for c in value[1:])
    m=re.fullmatch(r'rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)',value)
    if m:
        need(all(int(c)<=255 for c in m.groups()), 'Invalid conditional RGB color')
        value='#'+''.join(f'{int(c):02X}' for c in m.groups())
    need(re.fullmatch(r'#[0-9a-fA-F]{6}',value), 'Conditional color must be opaque RGB')
    return 'FF'+value[1:].upper()

def cf_dxf(style):
    cf_object(style,('bg','cl','bl','it','ul','st'))
    root=Element('{'+MAIN+'}dxf')
    if any(k in style for k in ('cl','bl','it','ul','st')):
        font=SubElement(root,'{'+MAIN+'}font')
        for key,tag in (('bl','b'),('it','i'),('ul','u'),('st','strike')):
            if key not in style: continue
            value=style[key]
            if key in ('ul','st'): cf_object(value,('s',),('s',)); value=value['s']
            need(type(value) is int and value in (0,1), 'Invalid conditional font flag')
            SubElement(font,'{'+MAIN+'}'+tag,{'val':('single' if value else 'none') if key=='ul' else str(value)})
        if 'cl' in style:
            cf_object(style['cl'],('rgb',),('rgb',)); SubElement(font,'{'+MAIN+'}color',{'rgb':cf_color(style['cl']['rgb'])})
    if 'bg' in style:
        cf_object(style['bg'],('rgb',),('rgb',))
        fill=SubElement(root,'{'+MAIN+'}fill'); pattern=SubElement(fill,'{'+MAIN+'}patternFill',{'patternType':'solid'})
        SubElement(pattern,'{'+MAIN+'}fgColor',{'rgb':cf_color(style['bg']['rgb'])})
    return root

def read_cf_dxf(root):
    need(root.tag=='{'+MAIN+'}dxf' and not root.attrib, 'Unsupported conditional differential style')
    style={}; seen=set()
    for el in root:
        tag=el.tag
        need(tag in ('{'+MAIN+'}font','{'+MAIN+'}fill') and tag not in seen and not el.attrib, 'Unsupported/duplicate conditional differential format'); seen.add(tag)
        if tag.endswith('}font'):
            used=set()
            for child in el:
                name=child.tag.removeprefix('{'+MAIN+'}')
                need(child.tag=='{'+MAIN+'}'+name and name in ('b','i','u','strike','color') and name not in used and not len(child), 'Unsupported conditional font'); used.add(name)
                if name=='color':
                    need(set(child.attrib)=={'rgb'} and re.fullmatch(r'(?:FF|00)[0-9A-Fa-f]{6}',child.get('rgb','')), 'Conditional theme/indexed/transparent colors unsupported')
                    style['cl']={'rgb':'#'+child.get('rgb')[-6:].upper()}
                elif name=='u':
                    need(not set(child.attrib)-{'val'} and child.get('val','single') in ('single','none'), 'Unsupported conditional underline')
                    style['ul']={'s':int(child.get('val','single')=='single')}
                else:
                    need(not set(child.attrib)-{'val'} and child.get('val','1') in ('1','0','true','false'), 'Invalid conditional boolean')
                    value=int(child.get('val','1') in ('1','true'))
                    style[{'b':'bl','i':'it','strike':'st'}[name]]={'s':value} if name=='strike' else value
        else:
            need(len(el)==1 and el[0].tag=='{'+MAIN+'}patternFill' and el[0].attrib=={'patternType':'solid'}, 'Unsupported conditional fill')
            pattern=el[0]; need(len(pattern)==1 and pattern[0].tag=='{'+MAIN+'}fgColor' and not len(pattern[0]) and set(pattern[0].attrib)=={'rgb'} and re.fullmatch(r'(?:FF|00)[0-9A-Fa-f]{6}',pattern[0].get('rgb','')), 'Unsupported conditional fill color')
            style['bg']={'rgb':'#'+pattern[0].get('rgb')[-6:].upper()}
    need(all(not (e.text or '').strip() and not (e.tail or '').strip() for e in root.iter()), 'Conditional style contains text')
    return style

def native_conditionals(book):
    data={}; budget=[0,0]; count=0
    for resource in book.get('resources',[]):
        if resource.get('name')==CF_RESOURCE: data=json.loads(resource['data']) if resource['data'] else {}
    need(isinstance(data,dict), 'Invalid conditional resource'); result={}
    controls={}
    for resource in book.get('resources',[]):
        if resource.get('name')==CONTROL_RESOURCE: controls=json.loads(resource['data'] or '{}')
    for sid,entries in data.items():
        cf_id(sid); need(isinstance(entries,list), 'Invalid conditional sheet rules')
        if not entries and sid not in book['sheets']: continue
        need(sid in book['sheetOrder'], 'Conditional rule belongs to missing sheet')
        sheet=book['sheets'][sid]; ids=set(); result[sid]=[]
        for index,entry in enumerate(entries,1):
            count+=1; need(count<=256,'Conditional rule limit')
            cf_object(entry,('cfId','ranges','stopIfTrue','rule'),('cfId','ranges','stopIfTrue','rule'))
            cf_id(entry['cfId']); need(entry['cfId'] not in ids,'Duplicate conditional identity'); ids.add(entry['cfId'])
            need(type(entry['stopIfTrue']) is bool,'Invalid conditional stopIfTrue')
            rule=entry['rule']
            need(isinstance(rule,dict) and rule.get('type')=='highlightCell','Conditional scales, data bars and icon sets are not supported in XLSX exchange')
            cf_object(rule,('type','subType','operator','value','style'),('type','subType','operator','style'))
            dxf=cf_dxf(rule['style']); ranges=entry['ranges']; need(isinstance(ranges,list) and ranges,'Conditional ranges required')
            for r in ranges:
                cf_object(r,('startRow','endRow','startColumn','endColumn','rangeType','startAbsoluteRefType','endAbsoluteRefType','unitId','sheetId'))
                need(all(type(r.get(k)) is int and r[k]>=0 for k in ('startRow','endRow','startColumn','endColumn')), 'Invalid conditional range')
                need(r['endRow']<sheet['rowCount'] and r['endColumn']<sheet['columnCount'] and r.get('rangeType',0)==0 and r.get('unitId',book['id'])==book['id'] and r.get('sheetId',sid)==sid and all(r.get(k,0) in (0,1,2,3) for k in ('startAbsoluteRefType','endAbsoluteRefType')), 'Conditional range ownership/bounds mismatch')
            refs=sorted((cf_ref(r) for r in ranges),key=lambda x:bounds(x)); sqref=' '.join(refs)
            canonical=cf_ranges(sqref,budget); expression=cf_formula(rule,refs[0].split(':')[0])
            for r in canonical:
                for control in controls.get(sid,[]):
                    if control.get('type')=='checkbox':
                        need(not any(r['startRow']<=q['endRow'] and r['endRow']>=q['startRow'] and r['startColumn']<=q['endColumn'] and r['endColumn']>=q['startColumn'] for q in control['ranges']), 'Conditional checkbox styles unsupported')
                if rule['subType']=='number':
                    for row,values in sheet.get('cellData',{}).items():
                        if not r['startRow']<=int(row)<=r['endRow']: continue
                        for col,cell in values.items():
                            if not r['startColumn']<=int(col)<=r['endColumn'] or not cell: continue
                            need(not (cell.get('t')==4 and cell.get('v') in CF_ERRORS) and not (cell.get('v')=='' and not cell.get('f')), 'Conditional numeric rules cannot exchange forced error text or literal empty text')
            result[sid].append({'ranges':canonical,'sqref':sqref,'formula':expression,'priority':index,'stop':entry['stopIfTrue'],'dxf':dxf,'rule':rule})
    return result

def conditional_parts(parts, descriptors):
    paths={s['path'] for s in descriptors}; result={p:[] for p in paths}; dxfs=[]; budget=[0,0]; count=0
    for name,raw in parts.items():
        if not name.endswith('.xml'): continue
        root=fromstring(raw); parents={c:p for p in root.iter() for c in p}
        for el in root.iter():
            local=el.tag.rsplit('}',1)[-1]
            if local in ('dxfs','dxf'):
                parent=parents.get(el)
                need(name=='xl/styles.xml' and root.tag=='{'+MAIN+'}styleSheet' and el.tag=='{'+MAIN+'}'+local and parent is not None and (parent is root if local=='dxfs' else parent.tag=='{'+MAIN+'}dxfs' and parents.get(parent) is root), 'Shadowed/misplaced conditional differential styles')
                if local=='dxfs':
                    need(not set(el.attrib)-{'count'} and len(el)<=256 and all(c.tag=='{'+MAIN+'}dxf' for c in el) and (el.get('count') is None or el.get('count')==str(len(el))), 'Invalid differential style count/schema')
                    dxfs=list(el)
            if local in ('conditionalFormatting','cfRule'):
                parent=parents.get(el)
                need(name in paths and el.tag=='{'+MAIN+'}'+local and parent is not None and (parent is root if local=='conditionalFormatting' else parent.tag=='{'+MAIN+'}conditionalFormatting' and parents.get(parent) is root), 'Shadowed/misplaced conditional formatting')
                if local=='conditionalFormatting':
                    need(set(el.attrib)=={'sqref'} and len(el)>0 and all(c.tag=='{'+MAIN+'}cfRule' for c in el) and not (el.text or '').strip(), 'Unsupported conditional container')
                    for rule in el:
                        count+=1; need(count<=256, 'Conditional rule limit')
                        need(not set(rule.attrib)-{'type','priority','dxfId','stopIfTrue'} and rule.get('type')=='expression', 'Unsupported conditional rule: Excel built-ins, scales, bars and icons require different semantics')
                        priority=integer(rule.get('priority'),2147483648,'Invalid conditional priority'); need(priority>0,'Invalid conditional priority')
                        index=integer(rule.get('dxfId'),256,'Invalid conditional differential style index')
                        need(rule.get('stopIfTrue','0') in ('0','1','true','false') and not (rule.text or '').strip() and not (rule.tail or '').strip(), 'Invalid conditional rule flags/text')
                        need(len(rule)==1 and rule[0].tag=='{'+MAIN+'}formula' and not rule[0].attrib and not len(rule[0]) and not (rule[0].tail or '').strip(), 'Unsupported conditional formula schema')
                        ranges=cf_ranges(el.get('sqref'),budget); expression=rule[0].text
                        native=parse_cf_formula(expression,el.get('sqref').split()[0].split(':')[0])
                        result[name].append({'ranges':ranges,'sqref':el.get('sqref'),'formula':expression,'priority':priority,'stop':rule.get('stopIfTrue','0') in ('1','true'),'dxfId':index,'rule':native})
    styles=[read_cf_dxf(d) for d in dxfs]
    from openpyxl.styles.differential import DifferentialStyle
    for rules in result.values():
        need(len({r['priority'] for r in rules})==len(rules), 'Duplicate conditional priority')
        for r in rules:
            need(r['dxfId']<len(styles),'Dangling conditional differential style index')
            r['rule']['style']=styles[r['dxfId']]; r['parsedDxf']=DifferentialStyle.from_tree(dxfs[r['dxfId']])
        rules.sort(key=lambda r:r['priority'])
    return result

def import_conditionals(ws, expected, sheet):
    loaded=[]
    for container in ws.conditional_formatting:
        for rule in ws.conditional_formatting[container]: loaded.append((str(container.sqref),rule))
    loaded.sort(key=lambda pair:pair[1].priority)
    need(len(loaded)==len(expected),'Loaded conditional rule count mismatch'); result=[]
    for (sqref,rule),spec in zip(loaded,expected):
        need(sqref==spec['sqref'] and rule.type=='expression' and rule.formula==[spec['formula']] and rule.priority==spec['priority'] and bool(rule.stopIfTrue)==spec['stop'] and rule.dxfId==spec['dxfId'] and rule.dxf==spec['parsedDxf'], 'Loaded conditional rule/style interpretation mismatch')
        result.append({'cfId':f'xlsx-cf-{rule.priority}','ranges':spec['ranges'],'stopIfTrue':spec['stop'],'rule':spec['rule']})
        for r in spec['ranges']:
            sheet['rowCount']=max(sheet['rowCount'],r['endRow']+1); sheet['columnCount']=max(sheet['columnCount'],r['endColumn']+1)
    return result

def add_conditional_parts(data, rules):
    if not any(rules.values()): return data
    with zipfile.ZipFile(io.BytesIO(data)) as z: parts={n:z.read(n) for n in z.namelist()}
    descriptors=worksheet_parts(parts); styles=fromstring(parts['xl/styles.xml'])
    need(styles.find('{'+MAIN+'}dxfs') is None,'Unexpected export differential styles')
    dxfs=Element('{'+MAIN+'}dxfs'); index=0
    # OOXML styleSheet sequence places dxfs before tableStyles/colors/extLst.
    position=next((i for i,e in enumerate(styles) if e.tag.rsplit('}',1)[-1] in ('tableStyles','colors','extLst')),len(styles)); styles.insert(position,dxfs)
    for sheet,ruleset in zip(descriptors,rules.values()):
        # caller supplies every sheet in sheetOrder, including empty buckets.
        root=fromstring(parts[sheet['path']])
        position=next((i for i,e in enumerate(root) if e.tag.rsplit('}',1)[-1] in ('dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','drawing','legacyDrawing','extLst')),len(root))
        for spec in ruleset:
            dxfs.append(spec['dxf']); container=Element('{'+MAIN+'}conditionalFormatting',{'sqref':spec['sqref']})
            rule=SubElement(container,'{'+MAIN+'}cfRule',{'type':'expression','priority':str(spec['priority']),'dxfId':str(index),'stopIfTrue':str(int(spec['stop']))})
            SubElement(rule,'{'+MAIN+'}formula').text=spec['formula']; index+=1; root.insert(position,container); position+=1
        parts[sheet['path']]=tostring(root)
    dxfs.set('count',str(index)); parts['xl/styles.xml']=tostring(styles)
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for name,raw in parts.items(): z.writestr(name,raw)
    return out.getvalue()

def preflight(data):
    need(len(data) <= BYTES and data[:4] == b'PK\x03\x04', 'Choose an unencrypted XLSX under 2 MB')
    warnings = set(POLICY + [CHART_POLICY, CF_POLICY, CF_INPUT_POLICY])
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
        descriptors = worksheet_parts(parts)
        worksheets = [sheet['path'] for sheet in descriptors]
        cells = 0; styles = 0; merges = 0; merge_cells = 0; strings = 0
        validation_count = 0; validation_budget = [0, 0]
        placements = {'worksheet':None, 'sheetData':'worksheet', 'row':'sheetData', 'c':'row',
                      'v':'c', 'f':'c', 'is':'c', 'cols':'worksheet', 'col':'cols',
                      'mergeCells':'worksheet', 'mergeCell':'mergeCells',
                      'dataValidations':'worksheet', 'dataValidation':'dataValidations'}
        for name, raw in parts.items():
            if name.lower().endswith(('.xml', '.rels')) or name in worksheets:
                worksheet = name in worksheets; seen_cells = set(); root = None
                occupied = set(); merged = []; current_cell = None
                identity_counts = {}; stack = []; validation_occupied = []; validation_groups = 0; validation_children = set()
                for event, el in iterparse(io.BytesIO(raw), events=('start', 'end')):
                    tag = el.tag.rsplit('}', 1)[-1]
                    if event == 'start':
                        parent = stack[-1] if stack else None; stack.append(el.tag)
                        if root is None:
                            root = el.tag
                            need((root == '{'+MAIN+'}worksheet') == worksheet and (tag != 'worksheet' or worksheet), 'Worksheet root/type mismatch')
                        need(len(el.attrib) <= 40 and all(len(v) <= 20000 for v in el.attrib.values()), 'XML attribute limit')
                        if worksheet:
                            if tag in placements:
                                expected = placements[tag]
                                need(el.tag == '{'+MAIN+'}'+tag and
                                     parent == ('{'+MAIN+'}'+expected if expected else None),
                                     'Shadowed worksheet cell structure')
                                identity_attributes(el, {k:k for k in ('r','s','t','style','ref','sqref')})
                            if parent == '{'+MAIN+'}row':
                                need(el.tag == '{'+MAIN+'}c', 'Invalid worksheet row child')
                            if tag in ('sheetData','cols','mergeCells'):
                                identity_counts[tag] = identity_counts.get(tag, 0)+1
                                need(identity_counts[tag] == 1, 'Duplicate worksheet structure')
                        if el.tag == '{'+MAIN+'}dataValidations':
                            validation_groups += 1
                            need(worksheet and parent == '{'+MAIN+'}worksheet' and validation_groups == 1, 'Invalid validation container')
                        if el.tag == '{'+MAIN+'}dataValidation':
                            need(worksheet and parent == '{'+MAIN+'}dataValidations', 'Invalid validation schema')
                            validation_count += 1; need(validation_count <= 256, 'Validation rule limit')
                            need(not set(el.attrib) - {'type','operator','errorStyle','imeMode','allowBlank','showDropDown','showInputMessage','showErrorMessage','errorTitle','error','promptTitle','prompt','sqref'}, 'Unsupported validation attributes')
                            for key in ('allowBlank','showDropDown','showInputMessage','showErrorMessage'):
                                need(key not in el.attrib or el.get(key) in ('0','1','true','false'), 'Invalid validation boolean')
                            validation_ranges(el.get('sqref', ''), validation_occupied, validation_budget)
                            validation_children = set()
                        elif parent == '{'+MAIN+'}dataValidations':
                            need(False, 'Invalid validation container child')
                        elif parent == '{'+MAIN+'}dataValidation':
                            need(el.tag in ('{'+MAIN+'}formula1', '{'+MAIN+'}formula2') and el.tag not in validation_children and not el.attrib, 'Invalid validation formula schema')
                            validation_children.add(el.tag)
                        elif len(stack) >= 3 and stack[-3] == '{'+MAIN+'}dataValidation':
                            need(False, 'Nested validation formula content refused')
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
                        if tag in ('legacyDrawing', 'legacyDrawingHF', 'controls', 'control', 'hyperlink', 'tablePart', 'definedName', 'sheetProtection', 'autoFilter', 'pane', 'extLst') or tag == 'dataValidation' and el.tag != '{'+MAIN+'}dataValidation':
                            warnings.add('Unsupported extension metadata is not retained; recognized in-cell checkbox controls are mapped.' if tag == 'extLst' else 'Not retained: ' + tag)
                    else:
                        if el.text: field(el.text, 20000)
                        if worksheet and tag == 'c': current_cell = None
                        stack.pop()
                        el.clear()
                if worksheet:
                    for ref in occupied:
                        x,y,_,_ = bounds(ref)
                        need(not any(a <= x <= c and b <= y <= d and (x,y) != (a,b) for a,b,c,d in merged), 'Merge would discard cell content')
        checkboxes = checkbox_metadata(parts, worksheets)
        charts = chart_parts(parts, descriptors)
        conditional = conditional_parts(parts, descriptors)
    return warnings, [{**sheet, 'checkboxes':checkboxes.get(sheet['path'], []), 'charts':charts[sheet['path']], 'conditional':conditional[sheet['path']]} for sheet in descriptors]

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
    warnings, descriptors = preflight(data)
    reader = ExcelReader(io.BytesIO(data), data_only=False, keep_links=False, rich_text=False)
    reader.read(); wb = reader.wb
    loaded = [{'name':sheet.name, 'id':sheet.id, 'sheetId':sheet.sheetId, 'path':rel.target}
              for sheet, rel in reader.parser.find_sheets()]
    need(loaded == [{k:sheet[k] for k in ('name','id','sheetId','path')} for sheet in descriptors]
         and [ws.title for ws in wb.worksheets] == [sheet['name'] for sheet in descriptors],
         'Loaded worksheet identity/order mismatch')
    checkboxes = [sheet['checkboxes'] for sheet in descriptors]
    need(wb.epoch == WINDOWS_EPOCH, '1904 date-epoch workbooks are refused; convert to the 1900 epoch before import. Original not adopted.')
    book = {'id': 'preview', 'name': 'Imported XLSX', 'appVersion': '1.4.0', 'locale': 'enUS', 'styles': {}, 'sheetOrder': [], 'sheets': {}}
    total = 0; formulas = 0; budget = [0]; controls = {}; charts = []; conditional = {}
    for i, ws in enumerate(wb.worksheets):
        sid = 'sheet' + str(i+1); book['sheetOrder'].append(sid)
        need(ws.max_row <= 10000 and ws.max_column <= 200, 'Sheet bounds')
        sheet = {'id': sid, 'name': field(ws.title, 31), 'rowCount': max(200, ws.max_row), 'columnCount': max(26, ws.max_column), 'cellData': {}, 'mergeData': [], 'rowData': {}, 'columnData': {}, 'defaultColumnWidth': 110, 'defaultRowHeight': 24}
        book['sheets'][sid] = sheet
        expected = descriptors[i]['charts']
        need(len(ws._charts) == len(expected), 'Loaded chart count mismatch')
        for parsed, spec in zip(ws._charts, expected):
            loaded_chart_matches(parsed, spec)
            r=spec['range']
            if spec['visibleOnly']:
                need(not any(dim.hidden and r['startRow']+1 <= row <= r['endRow']+1 for row,dim in ws.row_dimensions.items()) and not any(dim.hidden for dim in ws.column_dimensions.values()), 'Charts excluding hidden source rows/columns unsupported')
            sheet['rowCount']=max(sheet['rowCount'], r['endRow']+1)
            sheet['columnCount']=max(sheet['columnCount'], r['endColumn']+1)
            charts.append({k:spec[k] for k in ('title','type','range')} | {'id':f'xlsx-chart-{len(charts)+1}', 'sheetId':sid})
        cf = import_conditionals(ws, descriptors[i]['conditional'], sheet)
        if cf: conditional[sid] = cf
        rules = import_validations(ws, sheet, sid, warnings)
        check_positions = {(row,col) for r in checkboxes[i] for row in range(r['startRow'],r['endRow']+1) for col in range(r['startColumn'],r['endColumn']+1)}
        if checkboxes[i]:
            rules.append({'uid':f'xlsx-{sid}-checkbox','type':'checkbox','formula1':'1','formula2':'0','ranges':checkboxes[i]})
        if rules: controls[sid] = rules
        if ws.sheet_state != 'visible': warnings.add('Hidden sheets are imported as visible.')
        for cell in ws._cells.values(): # Sparse: never expand a dimension-only rectangle.
            if cell.value is None and not cell.has_style: continue
            total += 1; need(total <= CELLS, '50,000 stored-cell limit')
            v = cell.value; out = {}
            if cell.data_type == 'f':
                formulas += 1; need(formulas <= 2000, '2,000-formula limit'); out['f'] = formula(v, budget)
            elif isinstance(v, bool):
                # Univer's checkbox renderer compares 0/1; t=3 retains boolean
                # semantics, and export writes actual Excel boolean cells.
                out.update(v=int(v) if (cell.row-1,cell.column-1) in check_positions else v, t=3)
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
    if controls:
        book['resources'] = [{'name': CONTROL_RESOURCE, 'data': json.dumps(controls, ensure_ascii=True, separators=(',', ':'))}]
        export_validations(book) # Combined checkbox/dropdown rule/range/area caps.
    if charts:
        book.setdefault('resources', []).append({'name':CHART_RESOURCE,'data':json.dumps(charts,ensure_ascii=True,separators=(',', ':'))})
        native_charts(book)
    if conditional:
        book.setdefault('resources', []).append({'name':CF_RESOURCE,'data':json.dumps(conditional,ensure_ascii=True,separators=(',', ':'))})
        native_conditionals(book)
    warnings.add('Column widths use approximate Excel-to-pixel conversion. Rich text is imported as plain text; theme colors and advanced layout may differ.')
    return {'book': book, 'warnings': sorted(warnings), 'cells': total}

def conditional_export_fidelity(book, data, conditional):
    """Check actual serialized inputs before releasing an XLSX with live rules.

    A formula under a rule can depend on any tab, transitively. Rather than add
    a dependency/evaluation engine, require every stored workbook input to
    survive the real parser in that case. Uncovered literals in a workbook
    without a covered formula retain the existing exchange policy.
    """
    if not any(conditional.values()): return
    covered={}
    formula_inputs=False
    for sid,rules in conditional.items():
        positions=covered[sid]=set()
        for spec in rules:
            for r in spec['ranges']:
                positions.update((row,col) for row in range(r['startRow'],r['endRow']+1)
                                 for col in range(r['startColumn'],r['endColumn']+1))
        sheet=book['sheets'][sid]
        for row,values in sheet.get('cellData',{}).items():
            for col,cell in values.items():
                if cell and (int(row),int(col)) in positions and (cell.get('f') or cell.get('si')):
                    formula_inputs=True
    # This is the same bounded, credentialless import parser; no evaluation.
    reopened=import_book(data)['book']
    for sid,new_sid in zip(book['sheetOrder'],reopened['sheetOrder']):
        for row,values in book['sheets'][sid].get('cellData',{}).items():
            for col,cell in values.items():
                if not cell or not (formula_inputs or (int(row),int(col)) in covered.get(sid,set())): continue
                parsed=reopened['sheets'][new_sid]['cellData'].get(str(row),{}).get(str(col),{})
                if cell.get('f'):
                    same=cell['f']==parsed.get('f')
                elif cell.get('si'): continue # caches are not source inputs
                else:
                    value=cell.get('v'); same=value==parsed.get('v')
                need(same, 'Conditional export refused: cell/formula input changes during XLSX serialization (precision or text normalization). Covered formulas require exact inputs across all tabs.')
    # Raw formula templates must still describe the submitted rule, including
    # CR versus LF and CRLF. Checking only preflight of the output misses this.
    actual=native_conditionals(reopened)
    for sid,new_sid in zip(book['sheetOrder'],reopened['sheetOrder']):
        before=conditional.get(sid,[]); after=actual.get(new_sid,[])
        need(len(before)==len(after) and all(a['formula']==b['formula'] for a,b in zip(before,after)),
             'Conditional export refused: rule text changes during XLSX serialization (CR/CRLF normalization). Use LF or tab text instead.')

def export_book(book):
    validations = export_validations(book)
    wb = openpyxl.Workbook(); wb.remove(wb.active); wb.calculation = CalcProperties(calcId=0, fullCalcOnLoad=True, forceFullCalc=True)
    warnings = set(POLICY + [CHART_POLICY, CF_POLICY, CF_INPUT_POLICY]); total = 0; formulas = 0; merge_area = 0; budget = [0]
    need(1 <= len(book['sheetOrder']) <= 20 and len(set(book['sheetOrder'])) == len(book['sheetOrder']), 'Sheet limit')
    checkbox_cells = {}
    for index, sid in enumerate(book['sheetOrder'], 1):
        sheet = book['sheets'][sid]; name = field(sheet['name'], 31)
        need(not re.search(r'[\\/*?:\[\]]', name) and name.lower() not in [s.lower() for s in wb.sheetnames], 'Unsupported/duplicate Excel tab name')
        need(1 <= sheet['rowCount'] <= 10000 and 1 <= sheet['columnCount'] <= 200, 'Sheet bounds')
        ws = wb.create_sheet(name); masters = {}
        checks = []
        for dv in validations.get(sid, []):
            if isinstance(dv, dict): checks.extend(dv['ranges'])
            else: ws.add_data_validation(dv)
        selected = set()
        for check in checks:
            for row in range(check['startRow'],check['endRow']+1):
                for col in range(check['startColumn'],check['endColumn']+1):
                    selected.add((row,col)); need(len(selected) <= CELLS, '50,000 checkbox cell limit')
        stored = {(int(r),int(c)) for r,values in sheet.get('cellData',{}).items() for c,cell in values.items() if cell is not None}
        total += len(selected - stored); need(total <= CELLS, '50,000 stored-cell limit')
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
                if (rr-1,cc-1) in selected:
                    need(not any(cell.get(k) is not None for k in ('f','si','p')) and (v is None or type(v) is bool or type(v) in (int,float) and v in (0,1) and cell.get('t') in (2,3)), 'Checkbox requires literal boolean/blank; formula/rich/custom values unsupported')
                    need(v is None or cell.get('t') in (None,2,3), 'Checkbox value type unsupported')
                    if v is not None: v = bool(v)
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
            need(not any(a <= col+1 <= c and b <= row+1 <= d for row,col in selected), 'Checkbox merge unsupported')
            for row in ws.iter_rows(min_row=b,max_row=d,min_col=a,max_col=c):
                for cell in row: need(cell.coordinate == f'{get_column_letter(a)}{b}' or cell.value is None, 'Merge would discard cell content')
            ws.merge_cells(ref)
        if selected:
            checkbox_cells[index] = set()
            for row,col in selected:
                dest = ws.cell(row+1,col+1)
                checkbox_cells[index].add(dest.coordinate)
        for r, dim in sheet.get('rowData', {}).items():
            need(0 <= int(r) < 10000, 'Row dimension limit')
            if dim.get('h'): ws.row_dimensions[int(r)+1].height = dim['h'] * 3/4
            ws.row_dimensions[int(r)+1].hidden = bool(dim.get('hd'))
        for c, dim in sheet.get('columnData', {}).items():
            need(0 <= int(c) < 200, 'Column dimension limit')
            d = ws.column_dimensions[get_column_letter(int(c)+1)]
            if dim.get('w'): d.width = max(0, (dim['w']-5)/7)
            d.hidden = bool(dim.get('hd'))
    from openpyxl.chart import BarChart, LineChart, Reference
    for index, spec in enumerate(native_charts(book)):
        ws=wb[book['sheets'][spec['sheetId']]['name']]; r=spec['range']
        chart=BarChart() if spec['type']=='bar' else LineChart()
        if spec['title']:
            chart.title=spec['title']
            # A run-free paragraph round-trips as empty in openpyxl; <a:t/>
            # would be coerced to literal 'None' on its next load/save.
            for paragraph in chart.title.tx.rich.p:
                if paragraph.r[0].t == '': paragraph.r=[]
        if spec['type']=='bar': chart.type='col'; chart.grouping='clustered'; chart.overlap=0
        else: chart.grouping='standard'; chart.smooth=False
        chart.visible_cells_only=False; chart.display_blanks='gap'
        chart.x_axis.axPos='b'; chart.y_axis.axPos='l'
        chart.add_data(Reference(ws,min_col=r['startColumn']+2,max_col=r['endColumn']+1,min_row=r['startRow']+1,max_row=r['endRow']+1),titles_from_data=True)
        chart.set_categories(Reference(ws,min_col=r['startColumn']+1,min_row=r['startRow']+2,max_row=r['endRow']+1))
        ws.add_chart(chart, f'G{1+index*16}')
    output = io.BytesIO(); wb.save(output); data = output.getvalue()
    if checkbox_cells: data = add_checkbox_parts(data, checkbox_cells)
    conditional = native_conditionals(book)
    data = add_conditional_parts(data, {sid:conditional.get(sid,[]) for sid in book['sheetOrder']})
    need(len(data) <= BYTES, 'Export exceeds 2 MB; no file produced')
    preflight(data)
    conditional_export_fidelity(book, data, conditional)
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
