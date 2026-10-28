"""Closed service result validation. Guest output remains untrusted evidence."""
import re
from . import profiles as P
from .runner_protocol import unblob


def validate(value, profile_sha256):
    fields = {'version','profile','profile_sha256','runtime_version','image','status','exit_code',
              'code_sha256','inputs','stdout','stderr','elapsed_ms','resources','omissions','outputs','cleanup_verified'}
    if not isinstance(value, dict) or set(value) != fields or value['profile_sha256'] != profile_sha256:
        raise ValueError('unrecognized_service_result')
    if not re.fullmatch('[0-9a-f]{64}', profile_sha256): raise ValueError('missing_profile_pin')
    if value['status'] not in {'succeeded','failed','wall_limit','cpu_limit','output_limit','cancelled','unavailable'}:
        raise ValueError('invalid_status')
    if value['exit_code'] is not None and type(value['exit_code']) is not int: raise ValueError('invalid_exit')
    if value['status'] == 'succeeded' and value['exit_code'] != 0: raise ValueError('invalid_exit')
    for key in ('stdout','stderr'):
        if not isinstance(value[key], str) or len(value[key].encode()) > 3 * P.STREAM_BYTES:
            raise ValueError('stream_limit')
    if type(value['elapsed_ms']) is not int or not 0 <= value['elapsed_ms'] <= 60000: raise ValueError('time_limit')
    resources = value['resources']
    if (not isinstance(resources, dict) or set(resources) != {'cpu_usec','memory_peak_bytes','oom_kill','pids_peak'}
            or any(type(v) is not int or v < 0 for v in resources.values())):
        raise ValueError('invalid_resources')
    if (not isinstance(value['omissions'], list) or len(value['omissions']) > 20
            or any(not isinstance(v,str) or len(v)>500 for v in value['omissions'])):
        raise ValueError('invalid_omissions')
    if not isinstance(value['outputs'], list) or len(value['outputs']) > P.OUTPUT_FILES: raise ValueError('output_limit')
    names = set(); size = 0
    for item in value['outputs']:
        raw = unblob(item); size += len(raw)
        if item['name'] in names: raise ValueError('duplicate_output')
        names.add(item['name'])
    if size > P.OUTPUT_BYTES or (value['status'] != 'succeeded' and value['outputs']):
        raise ValueError('output_limit')
    return value
