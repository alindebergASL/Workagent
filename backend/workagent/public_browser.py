"""Fail-closed offline HTML browser fallback; separate disposable Linux jail.

The pinned browser renders captured public HTML only. No navigation, clicks,
remote assets, cookies, credentials, host downloads or application filesystem.
Operator installation is explicit; absence never falls back to a host browser.
"""
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import tempfile
import time
import uuid

WALL_SECONDS = 12
OUTPUT_LIMIT = 1048576
PROFILE = 'public-offline-browser-v1'
OMISSIONS = ['Offline browser: external scripts, images, frames, navigation and all network are denied; rendering may be incomplete.',
             'No account state, clicks, forms or downloads; inline script output is untrusted evidence, not verified claims.']


def installed():
    path = os.environ.get('WORKAGENT_PUBLIC_BROWSER_DIR')
    if not path: raise OSError('browser_not_installed')
    root = Path(path).resolve(strict=True)
    lock = json.loads(Path(__file__).with_name('public_browser_lock.json').read_text())
    for name, expected in lock['files'].items():
        file = root / name
        if file.is_symlink() or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise OSError('browser_pin_mismatch')
    return root, lock


def jail_argv(input_path, root, lock):
    bwrap, prlimit = shutil.which('bwrap'), shutil.which('prlimit')
    if not bwrap or not prlimit: raise OSError('confinement_unavailable')
    args = [bwrap, '--unshare-all', '--unshare-user', '--disable-userns', '--new-session',
            '--die-with-parent', '--cap-drop', 'ALL', '--clearenv',
            '--size', '1048576', '--tmpfs', '/', '--ro-bind', '/usr', '/usr']
    for lib in ('/lib', '/lib64'):
        if Path(lib).exists(): args += ['--ro-bind', lib, lib]
    args += ['--proc', '/proc', '--dev', '/dev', '--size', '67108864', '--tmpfs', '/tmp',
             '--dir', '/browser', '--ro-bind', str(input_path), '/input',
             '--ro-bind', str(Path(__file__).with_name('public_browser_runner.py')), '/runner.py']
    # Mount only pinned runtime files, never the whole browser cache/home.
    for name in lock['files']:
        args += ['--ro-bind', str(root / name), '/browser/' + name]
    args += ['--remount-ro', '/', '--chdir', '/tmp', '--', prlimit,
             '--cpu=8:8', '--fsize=1048576:1048576', '--nofile=128:128',
             '--nproc=96:96', '--core=0:0', '/usr/bin/python3', '-I', '-S', '-B', '/runner.py']
    return args


def render(raw):
    result = {'status':'unavailable', 'dom':'', 'extractor_version':PROFILE,
              'omissions':list(OMISSIONS)}
    if not isinstance(raw, bytes) or len(raw) > 262144:
        result['omissions'].append('Browser input limit.'); return result
    try:
        root, lock = installed()
        with tempfile.TemporaryDirectory(prefix='workagent-public-browser-') as directory:
            source = Path(directory) / 'source'; source.write_bytes(raw)
            unit = 'workagent-public-browser-' + uuid.uuid4().hex
            # A real cgroup bounds aggregate browser memory/processes; V8 heap
            # flags or per-process rlimits alone do not establish this boundary.
            control_env = {'XDG_RUNTIME_DIR':'/run/user/' + str(os.getuid())}
            args = ['systemd-run', '--user', '--quiet', '--wait', '--pipe', '--collect',
                    '--unit=' + unit, '-p', 'MemoryMax=536870912', '-p', 'MemorySwapMax=0',
                    '-p', 'TasksMax=96', '-p', 'RuntimeMaxSec=12', '-p', 'CPUQuota=100%',
                    '-p', 'KillMode=control-group', '--', *jail_argv(source, root, lock)]
            process = subprocess.Popen(args, env=control_env, cwd=directory,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                start_new_session=True, close_fds=True)
            output, errors = bytearray(), bytearray()
            deadline = time.monotonic() + WALL_SECONDS
            try:
                with selectors.DefaultSelector() as selector:
                    for pipe, target in ((process.stdout,output),(process.stderr,errors)):
                        os.set_blocking(pipe.fileno(),False); selector.register(pipe,selectors.EVENT_READ,target)
                    while selector.get_map():
                        if time.monotonic() > deadline: raise TimeoutError()
                        for key,_ in selector.select(.05):
                            chunk = os.read(key.fileobj.fileno(),65536)
                            if not chunk: selector.unregister(key.fileobj)
                            else: key.data.extend(chunk)
                            if len(output)+len(errors)>OUTPUT_LIMIT: raise ValueError('output_limit')
                code = process.wait(timeout=max(.01,deadline-time.monotonic()))
                if code: raise ValueError('browser_failed')
                material = json.loads(output)
                dom = material['dom']
                if not isinstance(dom,str) or len(dom.encode())>262144: raise ValueError('invalid_output')
                result.update(status='ok', dom=dom,
                    extractor_version=PROFILE + ':' + hashlib.sha256(json.dumps(lock,sort_keys=True).encode()).hexdigest())
                return result
            finally:
                # systemd owns descendants outside our process group; explicitly
                # stop this unique unit on output/time/exception exits as well.
                subprocess.run(['systemctl','--user','stop',unit], env=control_env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5, check=False)
                try: os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError: pass
                process.wait(); process.stdout.close(); process.stderr.close()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, TimeoutError):
        result['omissions'].append('Pinned browser unavailable, confined rendering failed or resource limit reached; no host fallback.')
        return result
