"""Bounded inert office values. Shared by the service and fixed confined converter."""
import json
import re
from decimal import Decimal

VERSION = 'office-v1'
OMISSIONS = ['Rich formatting, layout, comments, tracked changes, drawings and embedded objects are not preserved.',
             'No OCR or vision was performed; PDF imports use only the text layer.',
             'Tables, merged cells, date formatting, headers and footers are simplified or omitted; dates become ISO text. XLSX numbers use spreadsheet numeric precision; caches are omitted from exported XLSX.', 'Formulas are not evaluated; caches are imported or user-supplied observations, never computed results.']
ADDRESS = re.compile(r'[A-Z]{1,2}[1-9][0-9]{0,2}\Z')
DECIMAL = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]{1,3})?\Z')
TOKEN = re.compile(r'\$?[A-Z]{1,2}\$?[1-9][0-9]{0,2}|(?:SUM|AVERAGE|MIN|MAX|COUNT)(?=\()|(?:[0-9]+(?:\.[0-9]+)?)|[+*/^(),:\-]')


def decimal(value):
    if not isinstance(value, str) or len(value) > 80 or not DECIMAL.fullmatch(value):
        raise ValueError('invalid numeric value')
    n = Decimal(value)
    if not n.is_finite() or abs(n) > Decimal('1e100'):
        raise ValueError('numeric range')
    return n


def formula(value):
    # No strings, names, sheet/workbook/external refs, DDE, URLs or dynamic functions.
    if not isinstance(value, str) or not value.startswith('=') or len(value) > 512:
        raise ValueError('unsupported formula')
    expression = value[1:]
    if not expression or ''.join(TOKEN.findall(expression)) != expression:
        raise ValueError('unsupported formula')
    tokens = TOKEN.findall(expression)
    if len(tokens)>200: raise ValueError('unsupported formula')
    pos = 0
    def expr(depth=0):
        nonlocal pos
        if depth>20: raise ValueError('unsupported formula')
        atom(depth+1)
        while pos<len(tokens) and tokens[pos] in ('+','-','*','/','^'):
            pos+=1
            atom(depth+1)
    def atom(depth):
        nonlocal pos
        if depth>20 or pos>=len(tokens): raise ValueError('unsupported formula')
        token=tokens[pos]; pos+=1
        if token in ('+','-'):
            atom(depth+1)
        elif token=='(':
            expr(depth+1)
            if pos>=len(tokens) or tokens[pos]!=')': raise ValueError('unsupported formula')
            pos+=1
        elif token in ('SUM','AVERAGE','MIN','MAX','COUNT'):
            if pos>=len(tokens) or tokens[pos]!='(': raise ValueError('unsupported formula')
            pos+=1; expr(depth+1)
            while pos<len(tokens) and tokens[pos]==',':
                pos+=1; expr(depth+1)
            if pos>=len(tokens) or tokens[pos]!=')': raise ValueError('unsupported formula')
            pos+=1
        elif re.fullmatch(r'\$?[A-Z]{1,2}\$?[1-9][0-9]{0,2}',token):
            if pos<len(tokens) and tokens[pos]==':':
                pos+=1
                if pos>=len(tokens) or not re.fullmatch(r'\$?[A-Z]{1,2}\$?[1-9][0-9]{0,2}',tokens[pos]):
                    raise ValueError('unsupported formula')
                pos+=1
        elif not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?',token):
            raise ValueError('unsupported formula')
    expr()
    if pos!=len(tokens): raise ValueError('unsupported formula')
    return value


def text(value, size=32767):
    if not isinstance(value, str) or len(value) > size or any(ord(c) < 32 and c not in '\t\n\r' for c in value):
        raise ValueError('bounded text required')
    return value


def validate(value):
    if not isinstance(value, dict) or value.get('office_version') != VERSION:
        raise ValueError('office version required')
    kind = value.get('kind')
    keys = {'office_version', 'kind', 'annotations', 'paragraphs' if kind == 'document' else 'sheets'}
    if set(value) != keys or not isinstance(value['annotations'], list) or len(value['annotations']) > 100:
        raise ValueError('office shape')
    for note in value['annotations']: text(note, 10000)
    if kind == 'document':
        if not isinstance(value['paragraphs'], list) or len(value['paragraphs']) > 2000:
            raise ValueError('paragraph limit')
        for paragraph in value['paragraphs']: text(paragraph)
    elif kind == 'workbook':
        if not isinstance(value['sheets'], list) or not 1 <= len(value['sheets']) <= 10:
            raise ValueError('sheet limit')
        names, total = set(), 0
        for sheet in value['sheets']:
            if not isinstance(sheet, dict) or set(sheet) != {'name', 'cells'}:
                raise ValueError('sheet shape')
            name = text(sheet['name'], 31)
            if not name or name.lower() in names or any(c in name for c in '[]:*?/\\') or name.startswith("'") or name.endswith("'"):
                raise ValueError('sheet name')
            names.add(name.lower())
            if not isinstance(sheet['cells'], list): raise ValueError('cell list')
            total += len(sheet['cells'])
            if total > 10000: raise ValueError('cell limit')
            seen = set()
            for cell in sheet['cells']:
                if not isinstance(cell, dict) or set(cell) != {'address', 'kind', 'value', 'cached_value'}:
                    raise ValueError('cell shape')
                address = cell['address']
                if not isinstance(address, str) or not ADDRESS.fullmatch(address) or address in seen:
                    raise ValueError('cell address')
                seen.add(address)
                k, v, cache = cell['kind'], cell['value'], cell['cached_value']
                if k == 'string': text(v)
                elif k == 'number': decimal(v)
                elif k == 'boolean':
                    if type(v) is not bool: raise ValueError('boolean required')
                elif k == 'blank':
                    if v is not None: raise ValueError('blank required')
                elif k == 'formula': formula(v)
                else: raise ValueError('cell kind')
                if k != 'formula' and cache is not None: raise ValueError('cache on nonformula')
                if cache is not None and type(cache) is not bool: text(cache)
    else:
        raise ValueError('office kind')
    if len(json.dumps(value, ensure_ascii=False).encode()) > 200000:
        raise ValueError('office size')
    return value
