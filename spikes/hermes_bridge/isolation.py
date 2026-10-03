"""Pre-import experimental containment. Linux; not a hostile-code sandbox."""
import ctypes
import errno
import os
from pathlib import Path
import socket
import sys


def isolate(run, upstream, repo):
    run = Path(run).resolve()
    assert Path(os.environ['HOME']).resolve() == run / 'home'
    assert Path(os.environ['HERMES_HOME']).resolve() == run / 'home/hermes'
    assert not any(k.endswith(('API_KEY', 'TOKEN', 'SECRET')) for k in os.environ)
    os.chdir(run)
    # Kernel block INET/INET6 socket creation, including C SDKs/libpq. UNIX is
    # reserved for the separate disposable PostgreSQL cluster and event loops.
    lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    class Arg(ctypes.Structure):
        _fields_ = [('arg', ctypes.c_uint), ('op', ctypes.c_int), ('a', ctypes.c_uint64), ('b', ctypes.c_uint64)]
    ctx = lib.seccomp_init(0x7fff0000)
    assert ctx
    # All non-UNIX socket families denied, not just Python's network API.
    assert lib.seccomp_rule_add(ctx, 0x50000 | errno.EPERM,
        lib.seccomp_syscall_resolve_name(b'socket'), 1, Arg(0, 1, socket.AF_UNIX, 0)) == 0
    # No exec from imported frameworks, including lazy installs, git, native helpers.
    for name in (b'execve', b'execveat'):
        assert lib.seccomp_rule_add(ctx, 0x50000 | errno.EPERM,
            lib.seccomp_syscall_resolve_name(name), 0) == 0
    assert lib.seccomp_load(ctx) == 0
    denied = []
    source_roots = [Path(upstream).resolve()] + [Path(repo).resolve() / d for d in
        ('backend', 'runtime', 'fixtures', 'agent', 'spikes/hermes_bridge')]
    source_files = {Path(repo).resolve() / f for f in ('pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini')}
    def within(p, root):
        return p == root or root in p.parents
    def audit(event, args):
        if event in ('subprocess.Popen', 'os.system', 'os.posix_spawn'):
            denied.append(event); raise PermissionError('subprocess disabled')
        if event == 'socket.connect':
            target = args[1]
            if not isinstance(target, str) or not target.startswith(str(run / 'pgsock') + '/'):
                denied.append(event); raise PermissionError('socket target disabled')
        if event == 'open' and isinstance(args[0], (str, bytes, os.PathLike)):
            p = Path(os.fsdecode(args[0])).resolve()
            mode, flags = args[1:3]
            write = isinstance(mode, str) and any(c in mode for c in 'wax+')
            write = write or isinstance(flags, int) and bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT))
            allowed = p == Path('/dev/null') or within(p, run) or (not write and (
                p in source_files or any(within(p, r) for r in source_roots) or
                any(within(p, Path(r)) for r in ('/usr', '/lib', '/lib64', '/etc', '/proc', '/dev'))))
            # Never load checkout .envs or host credential/memory files.
            if not within(p, run) and (p.name.startswith('.env') or p.name == '.op.env'):
                allowed = False
            if not allowed:
                denied.append('open:' + str(p)); raise PermissionError('file outside isolated scope: ' + str(p))
    sys.addaudithook(audit)
    for family in (socket.AF_INET, socket.AF_INET6):
        try:
            socket.socket(family)
        except PermissionError:
            pass
        else:
            raise AssertionError('network filter failed')
    return denied


def bootstrap(upstream):
    """Stop import-time discovery BEFORE run_agent import; leave loop/dispatch real."""
    sys.path.insert(0, str(upstream))
    from hermes_cli import env_loader
    env_loader.load_hermes_dotenv = lambda *a, **k: []
    from tools import registry
    registry.discover_builtin_tools = lambda *a, **k: []
    from hermes_cli import plugins
    plugins.discover_plugins = lambda *a, **k: None
    from run_agent import AIAgent
    return AIAgent
