"""Fail-closed Linux document jail; the service never imports optional parsers."""
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

from .document_models import Extraction, LIMITS, MAX_ORIGINAL

OUTPUT_LIMIT = 1024 * 1024
WALL_SECONDS = 15
PACKAGES = ('pypdf', 'docx', 'openpyxl', 'defusedxml', 'lxml', 'et_xmlfile', 'typing_extensions.py')


def unavailable(raw, reason, status='unavailable'):
    return Extraction(status=status, reason=reason, text='',
                      text_sha256=hashlib.sha256(b'').hexdigest(),
                      original_sha256=hashlib.sha256(raw).hexdigest(),
                      limits=LIMITS, coverage={'omissions': ['extraction unavailable; original retained']})


def package_dir():
    candidates = sorted((Path(__file__).resolve().parents[1] / '.venv-docs/lib').glob('python*/site-packages'))
    return candidates[0] if len(candidates) == 1 else None


def jail_argv(input_path, module_path, kind, packages=None):
    """Same launcher for extraction and adversarial tests; no arbitrary host mount."""
    bwrap, prlimit = shutil.which('bwrap'), shutil.which('prlimit')
    if not bwrap or not prlimit or not Path('/usr/bin/python3').exists():
        raise OSError('confinement_unavailable')
    argv = [bwrap, '--unshare-all', '--unshare-user', '--disable-userns', '--new-session', '--die-with-parent', '--cap-drop', 'ALL',
            '--clearenv', '--setenv', 'PATH', '/usr/bin', '--setenv', 'LANG', 'C.UTF-8',
            '--setenv', 'OPENBLAS_NUM_THREADS', '1', '--size', '1048576', '--tmpfs', '/', '--ro-bind', '/usr', '/usr']
    for root in ('/lib', '/lib64'):
        if Path(root).exists():
            argv += ['--ro-bind', root, root]
    argv += ['--proc', '/proc', '--dev', '/dev', '--size', '20971520', '--tmpfs', '/tmp', '--dir', '/packages',
             '--ro-bind', str(input_path), '/input', '--ro-bind', str(module_path), '/parser.py']
    if packages is not None:
        # Never mount a venv/repo/home wholesale (may contain keys or application code).
        for name in PACKAGES:
            source = packages / name
            if source.exists():
                argv += ['--ro-bind', str(source.resolve()), '/packages/' + name]
    argv += ['--remount-ro', '/', '--chdir', '/tmp', '--', prlimit, '--cpu=5:5', '--as=536870912:536870912',
             '--fsize=1048576:1048576', '--nofile=32:32', '--nproc=16:16', '--core=0:0',
             '/usr/bin/python3', '-I', '-S', '-B', '/parser.py', kind]
    return argv


def run_confined(raw, kind, *, module_path=None, packages=None, wall_seconds=WALL_SECONDS):
    """Bound both pipes concurrently and kill the entire jail on every early exit.

    module_path is an internal testing seam, never supplied by an HTTP command.
    """
    if len(raw) > MAX_ORIGINAL:
        raise ValueError('input_limit')
    module_path = module_path or Path(__file__).with_name('document_parser.py')
    with tempfile.TemporaryDirectory(prefix='workagent-document-') as directory:
        input_path = Path(directory) / 'original'
        input_path.write_bytes(raw)
        argv = jail_argv(input_path, module_path, kind, packages)
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, close_fds=True, start_new_session=True,
                                   env={}, cwd=directory)
        output, errors = bytearray(), bytearray()
        deadline = time.monotonic() + wall_seconds
        try:
            with selectors.DefaultSelector() as selector:
                for pipe, target in ((process.stdout, output), (process.stderr, errors)):
                    os.set_blocking(pipe.fileno(), False)
                    selector.register(pipe, selectors.EVENT_READ, target)
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError('parser_timeout')
                    for key, _ in selector.select(min(remaining, 0.1)):
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                        else:
                            key.data.extend(chunk)
                            if len(output) + len(errors) > OUTPUT_LIMIT:
                                raise ValueError('parser_output_limit')
            returncode = process.wait(timeout=max(0.01, deadline - time.monotonic()))
            return returncode, bytes(output), bytes(errors)
        finally:
            # Also reap descendants which closed their output pipes early.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            process.stdout.close()
            process.stderr.close()


def parse_document(raw, kind):
    try:
        code, output, errors = run_confined(raw, kind, packages=package_dir())
        if code:
            # Namespace failures must never fall back to parsing in the service.
            reason = 'confinement_unavailable' if b'bwrap:' in errors else 'parser_resource_limit'
            return unavailable(raw, reason, 'unavailable' if reason == 'confinement_unavailable' else 'failed')
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError('duplicate JSON key')
                result[key] = value
            return result
        result = Extraction.model_validate(json.loads(output, object_pairs_hook=unique))
        if result.original_sha256 != hashlib.sha256(raw).hexdigest():
            raise ValueError('parser_hash_mismatch')
        return result
    except (TimeoutError, subprocess.TimeoutExpired):
        return unavailable(raw, 'parser_timeout', 'failed')
    except (OSError, subprocess.SubprocessError):
        return unavailable(raw, 'confinement_unavailable')
    except (ValueError, TypeError, RecursionError):
        return unavailable(raw, 'invalid_or_excessive_parser_output', 'failed')
