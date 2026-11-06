"""No generated Python executes here: byte transport only, fail closed."""
import os
import select
import socket
import struct
import time
import json
from . import profiles as P
from .runner_protocol import encode, request, unique, unblob, digest
from .results import validate


class SandboxUnavailable(Exception):
    pass


class SandboxCancelled(Exception):
    pass


class SandboxOutcomeUnknown(Exception):
    """Submission may have executed; never label missing receipt as unavailable."""
    pass


def run(code, inputs, *, authorized, endpoint=None, profile_sha256=None):
    payload = request({'version': 1, 'profile': P.PROFILE, 'code': code, 'inputs': inputs})
    endpoint = endpoint or os.environ.get('WORKAGENT_COMPUTE_SOCKET')
    profile_sha256 = profile_sha256 or os.environ.get('WORKAGENT_COMPUTE_PROFILE_SHA256')
    if not endpoint or not profile_sha256:
        raise SandboxUnavailable('compute service not configured')
    deadline = time.monotonic() + P.WALL_SECONDS + 15
    submitted = False
    try:
        with socket.socket(socket.AF_UNIX) as sock:
            sock.settimeout(3)
            if not authorized(): raise SandboxCancelled()
            sock.connect(endpoint)
            submitted = True  # Even a partial send has an uncertain outcome.
            sock.sendall(encode(payload))
            data = bytearray(); size = None
            sock.setblocking(False)
            while size is None or len(data) < size + 4:
                if not authorized(): raise SandboxCancelled()
                if time.monotonic() > deadline: raise SandboxUnavailable('service timeout')
                if not select.select([sock], [], [], .1)[0]: continue
                chunk = sock.recv(65536)
                if not chunk: raise SandboxUnavailable('service disconnected')
                data.extend(chunk)
                if size is None and len(data) >= 4:
                    size = struct.unpack('!I', data[:4])[0]
                    if size > P.WIRE_BYTES: raise SandboxUnavailable('response limit')
            result = validate(json.loads(data[4:], object_pairs_hook=unique), profile_sha256)
            if (result['version'] != 1 or result['profile'] != P.PROFILE
                    or result['image'] != P.IMAGE or result['runtime_version'] != P.RUNTIME_VERSION
                    or result['code_sha256'] != digest(code.encode()) or result['cleanup_verified'] is not True
                    or result['inputs'] != [{k:v for k,v in b.items() if k != 'base64'} for b in inputs]):
                raise SandboxUnavailable('invalid service receipt')
            for output in result['outputs']: unblob(output)
            if not authorized(): raise SandboxCancelled()
            return result
    except (OSError, ValueError, KeyError, TypeError, SandboxUnavailable) as exc:
        if submitted:
            raise SandboxOutcomeUnknown('submitted execution receipt unavailable') from exc
        raise SandboxUnavailable('service unavailable') from exc
