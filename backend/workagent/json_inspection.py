"""Bounded inspection of supplied JSON data, never code or ambient resources.

The broker supplies the exact current-message attachment. Decimal tokens remain
exact; output is canonical JSON text rather than lossy machine-number values.
"""
from decimal import Decimal
import json
import re

INPUT_BYTES=200000
OUTPUT_BYTES=16384


class Rejected(ValueError):
    pass


def _pairs(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise Rejected('invalid_json')
        value[key]=item
    return value


def _constant(_):
    raise Rejected('invalid_json')


def _canonical(value,depth=0,budget=None):
    if budget is None:budget=[10000]
    budget[0]-=1
    if depth>32 or budget[0]<0:raise Rejected('structure_limit')
    if isinstance(value,dict):
        return '{'+','.join(_canonical(k,depth+1,budget)+':'+_canonical(v,depth+1,budget) for k,v in sorted(value.items()))+'}'
    if isinstance(value,list):return '['+','.join(_canonical(v,depth+1,budget) for v in value)+']'
    if isinstance(value,str):
        if '\x00' in value:raise Rejected('invalid_json')
        value.encode('utf-8')  # Reject unpaired surrogates, including escaped ones.
        return json.dumps(value,ensure_ascii=False)
    if isinstance(value,Decimal):
        if not value.is_finite() or abs(value.adjusted())>308 or len(value.as_tuple().digits)>100:
            raise Rejected('number_limit')
        return format(abs(value) if value==0 else value,'f')
    if type(value) is int:
        if len(str(abs(value)))>100:raise Rejected('number_limit')
        return str(value)
    return json.dumps(value,allow_nan=False)


def inspect_json(attachment,path):
    result={'attachment':{k:attachment[k] for k in ('ref','sha256')},'path':list(path),
            'status':'invalid_input','reason':None,'selected_json':None,
            'value_bytes':None,'limit_bytes':OUTPUT_BYTES}
    try:
        content=attachment['content']
        if len(content.encode('utf-8'))>INPUT_BYTES:raise Rejected('input_limit')
        value=json.loads(content,parse_float=Decimal,parse_constant=_constant,object_pairs_hook=_pairs)
        _canonical(value)  # Validate the whole supplied document, not just a convenient fragment.
        for key in path:
            if isinstance(value,dict) and key in value:value=value[key]
            elif isinstance(value,list) and re.fullmatch(r'0|[1-9][0-9]*',key) and len(key)<=9 and int(key)<len(value):
                value=value[int(key)]
            else:
                result.update(status='not_found');return result
        selected=_canonical(value);size=len(selected.encode('utf-8'))
        result.update(status='complete' if size<=OUTPUT_BYTES else 'size_limit',
                      selected_json=selected if size<=OUTPUT_BYTES else None,value_bytes=size)
    except Rejected as exc:result['reason']=str(exc)
    except (ValueError,UnicodeError,RecursionError,ArithmeticError):result['reason']='invalid_json'
    return result
