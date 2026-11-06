"""Bounded byte protocol shared by the trusted service and application client."""
import base64
import hashlib
import json
import re
import struct
import time
from . import profiles as P

NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,70}\.(?:txt|md|csv|json|py)\Z')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(name, raw):
    return {'name': name, 'sha256': digest(raw), 'bytes': len(raw),
            'base64': base64.b64encode(raw).decode('ascii')}


def unblob(value):
    if not isinstance(value, dict) or set(value) != {'name', 'sha256', 'bytes', 'base64'}:
        raise ValueError('invalid_blob')
    if not isinstance(value['name'], str) or not NAME.fullmatch(value['name']):
        raise ValueError('invalid_name')
    raw = base64.b64decode(value['base64'], validate=True)
    if type(value['bytes']) is not int or len(raw) != value['bytes'] or digest(raw) != value['sha256']:
        raise ValueError('invalid_digest')
    return raw


def request(value):
    if not isinstance(value, dict) or set(value) != {'version', 'profile', 'code', 'inputs'}:
        raise ValueError('invalid_request')
    if value['version'] != 1 or type(value['version']) is not int or value['profile'] != P.PROFILE:
        raise ValueError('unsupported_profile')
    if not isinstance(value['code'], str) or not 0 < len(value['code'].encode()) <= P.CODE_BYTES:
        raise ValueError('code_limit')
    inputs = value['inputs']
    if not isinstance(inputs, list) or len(inputs) > 8:
        raise ValueError('input_limit')
    names = ['main.py']; size = 0
    for item in inputs:
        raw = unblob(item)
        if item['name'] in names:
            raise ValueError('duplicate_name')
        names.append(item['name']); size += len(raw)
    if size > P.INPUT_BYTES:
        raise ValueError('input_limit')
    return value


def unique(pairs):
    result = {}
    for k, v in pairs:
        if k in result:
            raise ValueError('duplicate_key')
        result[k] = v
    return result


def encode(value):
    data = json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
    if len(data) > P.WIRE_BYTES:
        raise ValueError('wire_limit')
    return struct.pack('!I', len(data)) + data


def receive(sock):
    deadline = time.monotonic() + 5
    def read(n):
        data = bytearray()
        while len(data) < n:
            remaining = deadline - time.monotonic()
            if remaining <= 0: raise TimeoutError('request_deadline')
            sock.settimeout(remaining)
            chunk = sock.recv(n - len(data))
            if not chunk:
                raise EOFError('disconnected')
            data.extend(chunk)
        return data
    size = struct.unpack('!I', read(4))[0]
    if size > P.WIRE_BYTES:
        raise ValueError('wire_limit')
    return json.loads(read(size), object_pairs_hook=unique)
