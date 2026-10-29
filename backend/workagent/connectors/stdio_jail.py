"""Fixed reviewed MCP server only, in a no-network read-only Linux jail.

No caller-controlled executable, arguments, environment, paths or host mounts.
Only pinned SDK dependencies and four reviewed synthetic modules are exposed.
Credentials are deliberately not passed to the subprocess. This transport is
synthetic-only; it cannot connect to a private provider from the isolated network.
"""
import importlib.metadata
from pathlib import Path
import shutil
import sys

# Explicit distribution allowlist; no venv, home, repo or site-packages mount.
DISTRIBUTIONS = (
    'mcp', 'mcp-types', 'pydantic', 'pydantic-core', 'annotated-types',
    'typing-extensions', 'typing-inspection', 'anyio', 'idna', 'sniffio',
    'httpx', 'httpcore', 'httpx2', 'httpcore2', 'h11', 'certifi', 'truststore',
    'starlette', 'sse-starlette', 'uvicorn', 'click', 'python-multipart',
    'jsonschema', 'jsonschema-specifications', 'attrs', 'referencing', 'rpds-py',
    'pyjwt', 'cryptography', 'cffi', 'pycparser', 'opentelemetry-api',
)
MODULES = ('registry.py', 'oauth.py', 'synthetic_server.py', 'stdio_bootstrap.py')


def parameters(*, source_directory=None):
    """Internal path seam is for tests only, never an HTTP/model argument."""
    from mcp import StdioServerParameters
    if importlib.metadata.version('mcp') != '2.3.0' or importlib.metadata.version('mcp-types') != '2.3.0':
        raise ValueError('MCP SDK pin mismatch')
    bwrap, prlimit = shutil.which('bwrap'), shutil.which('prlimit')
    interpreter = Path('/usr/bin') / f'python{sys.version_info.major}.{sys.version_info.minor}'
    if not bwrap or not prlimit or not interpreter.exists():
        raise ValueError('isolated stdio unavailable')
    directory = Path(source_directory) if source_directory else Path(__file__).parent
    mounts = {}
    for name in DISTRIBUTIONS:
        try:
            dist = importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            if name == 'sniffio':
                continue  # Current AnyIO no longer needs sniffio.
            raise ValueError('isolated SDK dependency unavailable') from None
        for file in dist.files or ():
            top = file.parts[0]
            if top in ('.', '..') or top.endswith('.pth'):
                continue
            source = Path(dist.locate_file(top)).resolve()
            if not source.exists() or source.name != top:
                raise ValueError('invalid SDK dependency path')
            mounts[top] = source
    args = ['--unshare-all', '--unshare-user', '--disable-userns', '--new-session',
            '--die-with-parent', '--cap-drop', 'ALL', '--clearenv',
            '--setenv', 'PATH', '/usr/bin', '--setenv', 'LANG', 'C.UTF-8',
            '--setenv', 'PYTHONDONTWRITEBYTECODE', '1',
            '--size', '1048576', '--tmpfs', '/', '--ro-bind', '/usr', '/usr']
    for path in ('/lib', '/lib64'):
        if Path(path).exists():
            args += ['--ro-bind', path, path]
    # No procfs: bubblewrap's PID1 can retain its launch environment even
    # after --clearenv sanitizes the executed child. Expose no process memory.
    args += ['--dir', '/proc', '--dev', '/dev', '--size', '8388608', '--tmpfs', '/tmp',
             '--dir', '/packages', '--dir', '/app', '--dir', '/app/workagent',
             '--dir', '/app/workagent/connectors']
    for top, source in sorted(mounts.items()):
        args += ['--ro-bind', str(source), '/packages/' + top]
    for name in MODULES:
        path = directory / name
        if not path.is_file() or path.is_symlink():
            raise ValueError('reviewed server unavailable')
        args += ['--ro-bind', str(path.resolve()), '/app/workagent/connectors/' + name]
    args += ['--remount-ro', '/', '--chdir', '/tmp', '--', prlimit,
             '--cpu=8:8', '--as=805306368:805306368', '--fsize=1048576:1048576',
             '--nofile=64:64', '--nproc=32:32', '--core=0:0',
             str(interpreter), '-I', '-S', '-B', '/app/workagent/connectors/stdio_bootstrap.py']
    return StdioServerParameters(command=bwrap, args=args, env={})
