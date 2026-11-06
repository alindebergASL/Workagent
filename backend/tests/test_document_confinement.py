"""REAL jail probes. Parent executes outside nested shell sandbox; never mock/skip.

No DB/provider or optional parser packages needed for confinement probes.
"""
import json
import os
from pathlib import Path
import signal
import time
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


def test_real_cpu_bomb_stopped(tmp_path, record_property):
    # RLIMIT_CPU counts scheduled CPU, not elapsed time. Give this proof alone
    # scheduling headroom; the production wall guard remains 15 seconds. A wall
    # timeout is still a failure here, NEVER alternative CPU-enforcement evidence.
    started = time.monotonic()
    code, out, err = probe(tmp_path, '''
import json, resource, time
print(json.dumps({'cpu_limit': resource.getrlimit(resource.RLIMIT_CPU)}), flush=True)
while time.process_time() < 4.5:
 pass
print(json.dumps({'cpu_seconds': time.process_time()}), flush=True)
while True: pass
''', timeout=60)
    elapsed = time.monotonic() - started
    limits, consumed = [json.loads(line) for line in out.splitlines()]
    assert limits == {'cpu_limit': [5, 5]}
    assert 4.5 <= consumed['cpu_seconds'] < 5
    assert code in (-signal.SIGKILL, 128 + signal.SIGKILL), err.decode(errors='replace')
    record_property('cpu_limit_seconds', 5)
    record_property('observed_cpu_seconds', consumed['cpu_seconds'])
    record_property('exit_code', code)
    record_property('elapsed_wall_seconds', elapsed)
    record_property('test_wall_guard_seconds', 60)


def process_tree(pid):
    """Host-side identities only: never trust namespace PIDs from probe output."""
    result = {}
    pending = [pid]
    while pending:
        current = pending.pop()
        path = Path('/proc') / str(current)
        try:
            fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            # starttime avoids treating a reused PID as a surviving descendant.
            result[current] = (fields[19], fields[0], int(fields[3]), int(fields[1]))
            pending.extend(int(p) for p in (path / 'task' / str(current) / 'children').read_text().split())
        except FileNotFoundError:
            pass
    return result


def test_real_wall_timeout_stopped(tmp_path, monkeypatch, record_property):
    # Observe, but do not replace, the actual process-group SIGKILL. Include a
    # detached grandchild with closed pipes: EOF/pipe closure must not save it.
    real_killpg = os.killpg
    trees = []

    def observed_killpg(pid, sig):
        trees.append((pid, sig, process_tree(pid)))
        return real_killpg(pid, sig)

    monkeypatch.setattr(os, 'killpg', observed_killpg)
    started = time.monotonic()
    with pytest.raises(TimeoutError, match='parser_timeout'):
        probe(tmp_path, '''
import os, time
if os.fork() == 0:
 os.setsid()
 for fd in (0, 1, 2): os.close(fd)
 time.sleep(60)
 os._exit(0)
time.sleep(60)
''', timeout=5)
    elapsed = time.monotonic() - started
    assert len(trees) == 1
    launcher, sig, tree = trees[0]
    assert sig == signal.SIGKILL
    # The detached leaf proves fork+setsid ran before the wall guard fired.
    detached = [pid for pid, (_, state, session, _) in tree.items()
                if pid != launcher and session == pid and state != 'Z'
                and not any(info[3] == pid for info in tree.values())]
    assert detached, tree
    deadline = time.monotonic() + 3
    while True:
        survivors = {}
        for pid, (birth, _, _, _) in tree.items():
            current = process_tree(pid).get(pid)
            if current and current[0] == birth and current[1] not in ('Z', 'X'):
                survivors[pid] = current
        if not survivors or time.monotonic() >= deadline:
            break
        time.sleep(0.02)
    assert not survivors
    assert elapsed >= 5
    record_property('wall_guard_seconds', 5)
    record_property('elapsed_wall_seconds', elapsed)
    record_property('observed_processes', len(tree))
    record_property('live_survivors', len(survivors))

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
