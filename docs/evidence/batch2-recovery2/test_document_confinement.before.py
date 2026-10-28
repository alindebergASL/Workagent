"""REAL jail probes. Parent executes outside nested shell sandbox; never mock/skip.

No DB/provider or optional parser packages needed for confinement probes.
"""
import json
import os
from pathlib import Path
import pytest
from workagent.document_sandbox import run_confined


def probe(tmp_path, code, *, timeout=15):
    script = tmp_path / 'probe.py'
    script.write_text(code)
    return run_confined(b'synthetic', 'probe', module_path=script, wall_seconds=timeout)


def test_real_jail_blocks_host_files_env_and_network(tmp_path, monkeypatch):
    secret = tmp_path / 'host-secret'
    secret.write_text('private host sentinel')
    marker = tmp_path / 'host-write'
    monkeypatch.setenv('DOCUMENT_TEST_SECRET', 'must-not-inherit')
    code, out, err = probe(tmp_path, f'''
import os, socket, pathlib, json
assert 'DOCUMENT_TEST_SECRET' not in os.environ
assert not pathlib.Path({str(secret)!r}).exists()
try:
 pathlib.Path({str(marker)!r}).write_text('bad')
 raise AssertionError('host write allowed')
except OSError: pass
s=socket.socket(); s.settimeout(1)
try:
 s.connect(('1.1.1.1',53))
 raise AssertionError('network allowed')
except OSError: pass
assert not pathlib.Path('/home/ubuntu').exists()
for target in ('/root-write-test', '/usr/workagent-write-test'):
 try:
  pathlib.Path(target).write_text('must be read-only')
  raise AssertionError('read-only mount was writable')
 except OSError: pass
print(json.dumps({{'confined':True}}))
''')
    assert code == 0, err.decode(errors='replace')
    assert json.loads(out) == {'confined': True}
    assert not marker.exists() and secret.read_text() == 'private host sentinel'


def test_real_process_fd_and_memory_limits(tmp_path):
    code, out, err = probe(tmp_path, '''
import os, resource, signal, json
assert resource.getrlimit(resource.RLIMIT_NOFILE)==(32,32)
assert resource.getrlimit(resource.RLIMIT_NPROC)==(16,16)
assert resource.getrlimit(resource.RLIMIT_AS)==(536870912,536870912)
try:
 x=bytearray(1024*1024*1024)
 raise AssertionError('memory unbounded')
except MemoryError: pass
children=[]
try:
 for i in range(32):
  try: pid=os.fork()
  except BlockingIOError: break
  if pid==0:
   signal.pause(); os._exit(0)
  children.append(pid)
 else: raise AssertionError('process limit not enforced')
finally:
 for pid in children: os.kill(pid,signal.SIGKILL)
 for pid in children: os.waitpid(pid,0)
print(json.dumps({'bounded':True}))
''')
    assert code == 0, err.decode(errors='replace')
    assert json.loads(out)['bounded']


def test_real_cpu_bomb_stopped(tmp_path):
    code, out, err = probe(tmp_path, 'print("started",flush=True)\nwhile True: pass')
    assert out == b'started\n' and code in (-9,137), err.decode(errors='replace')


def test_real_wall_timeout_stopped(tmp_path):
    with pytest.raises(TimeoutError):
        probe(tmp_path, 'import time; time.sleep(60)', timeout=1)

@pytest.mark.parametrize('stream', ['stdout','stderr'])
def test_real_output_bomb_stopped(tmp_path, stream):
    with pytest.raises(ValueError, match='parser_output_limit'):
        probe(tmp_path, f'import sys\nwhile True: sys.{stream}.write("x"*65536); sys.{stream}.flush()')


def test_inheritable_host_descriptor_is_closed(tmp_path):
    secret=tmp_path/'descriptor-secret'
    secret.write_bytes(b'never inherited')
    fd=os.open(secret,os.O_RDONLY)
    # High descriptor avoids the child's legitimate stdin/stdout/stderr slots.
    import fcntl
    high=fcntl.fcntl(fd,fcntl.F_DUPFD,100)
    os.set_inheritable(high,True)
    try:
        code,out,err=probe(tmp_path,f'''import os
try:
 os.fstat({high})
 raise AssertionError('inherited host descriptor')
except OSError: pass
print('closed')
''')
        assert code==0,err.decode(errors='replace')
        assert out.strip()==b'closed'
    finally:
        os.close(high); os.close(fd)
