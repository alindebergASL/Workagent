"""Privileged fixed-profile Unix service. No app imports, database, credentials or host-shell API.

Install a root-owned reviewed snapshot; start in a delegated systemd unit with
DelegateSubgroup=supervisor. All gVisor children remain in that unit's cgroup.
The socket's OS permissions are the service credential (local trusted app only).
"""
import argparse
import json
import os
from pathlib import Path
import select
import selectors
import shutil
import signal
import socket
import stat
import subprocess
import time
import uuid
from . import profiles as P
from .runner_protocol import blob, digest, encode, receive, request, unblob, NAME


class Runner:
    def __init__(self, runtime, rootfs, state, pins):
        self.runtime, self.rootfs, self.state = map(Path, (runtime, rootfs, state))
        self.pins = json.loads(Path(pins).read_text())
        # Immutable root-owned installation, exact trees including symlinks/modes.
        from .installation import manifest
        from .installation import secure
        secure(Path(pins))
        if self.pins['trees'] != manifest(self.runtime, self.rootfs):
            raise RuntimeError('profile_digest_mismatch')
        self.profile_hash = digest(Path(pins).read_bytes())
        if self.pins['image'] != P.IMAGE or self.pins['runtime_version'] != P.RUNTIME_VERSION:
            raise RuntimeError('unsupported_installation')
        version = subprocess.check_output([str(self.runtime / 'runsc'), '--version'], env={}, timeout=5).decode()
        if 'runsc version ' + P.RUNTIME_VERSION + '\n' not in version:
            raise RuntimeError('unsupported_runtime')
        relative = Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1]
        cg = Path('/sys/fs/cgroup' + relative)
        if cg.name != 'supervisor' or not cg.parent.name.startswith('workagent-compute'):
            raise RuntimeError('delegated_service_required')
        self.cg = cg.parent
        (self.cg / 'cgroup.subtree_control').write_text('+cpu +memory +pids')
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.state.stat().st_uid != 0 or self.state.stat().st_mode & 0o077:
            raise RuntimeError('private_state_required')
        self.cleanup_old()

    def argv(self):
        return [str(self.runtime / 'runsc'), '--root=' + str(self.state / 'runsc'),
                '--network=none', '--directfs=false', '--overlay2=none', '--platform=systrap',
                '--host-uds=none', '--host-fifo=none', '--host-settings=check', '--fdlimit=256',
                '--sidecar-release-enforcement-policy=ALWAYS']

    def command(self, *args):
        return subprocess.run([*self.argv(), *args], env={}, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)

    def cleanup(self, identity, directory):
        cg = self.cg / identity
        if cg.exists():
            (cg / 'cgroup.kill').write_text('1')
            deadline = time.monotonic() + 5
            while 'populated 1' in (cg / 'cgroup.events').read_text():
                if time.monotonic() > deadline:
                    raise RuntimeError('cleanup_failed')
                time.sleep(.02)
        self.command('delete', '--force', identity)
        if cg.exists():
            cg.rmdir()
        out = directory / 'outputs'
        if out.exists() and os.path.ismount(out):
            subprocess.run(['/usr/bin/umount', str(out)], check=True, timeout=5,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={})
        if directory.exists():
            shutil.rmtree(directory)

    def cleanup_old(self):
        # Never resume/replay submitted code after service restart.
        for directory in self.state.glob('wa-compute-*'):
            if directory.is_dir() and not directory.is_symlink():
                self.cleanup(directory.name, directory)

    def run(self, value, connection):
        value = request(value)
        identity = 'wa-compute-' + uuid.uuid4().hex
        directory = self.state / identity
        directory.mkdir(mode=0o700)
        inputs = directory / 'inputs'; inputs.mkdir(mode=0o755); inputs.chmod(0o755)
        outputs = directory / 'outputs'; outputs.mkdir()
        started = time.monotonic()
        cg = self.cg / identity
        process = None
        stdout, stderr = bytearray(), bytearray()
        status = 'failed'; exit_code = None; omitted = []; files = []
        usage = {'cpu_usec': 0, 'memory_peak_bytes': 0, 'oom_kill': 0, 'pids_peak': 0}
        try:
            cg.mkdir()
            limits = {'memory.max': str(P.MEMORY_BYTES), 'memory.swap.max': '0',
                      'pids.max': str(P.HOST_PIDS), 'cpu.max': '100000 100000'}
            for name, text in limits.items():
                (cg / name).write_text(text)
                if (cg / name).read_text().strip() != text:
                    raise RuntimeError('limit_not_installed')
            subprocess.run(['/usr/bin/mount', '-t', 'tmpfs', '-o',
                            f'size={P.DISK_BYTES},nr_inodes=256,mode=0777,nosuid,nodev,noexec',
                            'tmpfs', str(outputs)], check=True, timeout=5, env={},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            (inputs / 'main.py').write_text(value['code'])
            for item in value['inputs']:
                (inputs / item['name']).write_bytes(unblob(item))
            for path in inputs.iterdir():
                path.chmod(0o444)
            relative = '/' + str(cg.relative_to('/sys/fs/cgroup'))
            (directory / 'config.json').write_text(json.dumps(P.spec(self.rootfs, inputs, outputs, relative)))
            process = subprocess.Popen([*self.argv(), 'run', '--bundle=' + str(directory), identity],
                env={}, cwd=directory, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, start_new_session=True, close_fds=True)
            with selectors.DefaultSelector() as selector:
                for pipe, target in ((process.stdout, stdout), (process.stderr, stderr)):
                    os.set_blocking(pipe.fileno(), False)
                    selector.register(pipe, selectors.EVENT_READ, target)
                while selector.get_map() or process.poll() is None:
                    self.sample(cg, usage)
                    if usage['cpu_usec'] >= P.CPU_SECONDS * 1000000:
                        status = 'cpu_limit'; omitted.append('aggregate CPU limit including runtime overhead'); break
                    if time.monotonic() - started > P.WALL_SECONDS:
                        status = 'wall_limit'; omitted.append('execution stopped at wall limit'); break
                    if select.select([connection], [], [], 0)[0]:
                        # Client disconnect/cancellation or unexpected extra bytes.
                        status = 'cancelled'; omitted.append('client disconnected or cancelled'); break
                    excessive = False
                    for key, _ in selector.select(.03):
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                        else:
                            room = P.STREAM_BYTES - len(stdout) - len(stderr)
                            key.data.extend(chunk[:room])
                            if len(chunk) > room:
                                excessive = True
                    if excessive:
                        status = 'output_limit'; omitted.append('stdout/stderr truncated; process tree stopped'); break
                else:
                    exit_code = process.wait(timeout=1)
                    status = 'succeeded' if exit_code == 0 else 'failed'
            self.sample(cg, usage)
            # Stop ALL descendants before inspecting any output, including setsid children.
            (cg / 'cgroup.kill').write_text('1')
            process.wait(timeout=5)
            exit_code = process.returncode
            self.sample(cg, usage)
            self.command('delete', '--force', identity)
            deadline = time.monotonic() + 5
            while 'populated 1' in (cg / 'cgroup.events').read_text():
                if time.monotonic() > deadline:
                    raise RuntimeError('cleanup_failed')
                time.sleep(.02)
            if status == 'succeeded':
                files, dropped = self.collect(outputs)
                omitted.extend(dropped)
            elif any(outputs.iterdir()):
                omitted.append('files from unsuccessful execution not published')
        except (OSError, subprocess.SubprocessError, RuntimeError):
            status = 'unavailable'; files = []; omitted = ['confinement unavailable or cleanup failed; no host fallback']
        finally:
            if process is not None:
                if process.poll() is None:
                    if cg.exists():
                        (cg / 'cgroup.kill').write_text('1')
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                process.wait(timeout=5)
                process.stdout.close(); process.stderr.close()
            self.cleanup(identity, directory)  # On failure, service exits: never serve incomplete cleanup.
        return {'version': 1, 'profile': P.PROFILE, 'profile_sha256': self.profile_hash,
                'runtime_version': P.RUNTIME_VERSION, 'image': P.IMAGE,
                'status': status, 'exit_code': exit_code, 'code_sha256': digest(value['code'].encode()),
                'inputs': [{k: v for k, v in b.items() if k != 'base64'} for b in value['inputs']],
                'stdout': stdout.decode('utf-8', errors='replace'), 'stderr': stderr.decode('utf-8', errors='replace'),
                'elapsed_ms': int((time.monotonic() - started) * 1000), 'resources': usage,
                'omissions': omitted, 'outputs': files, 'cleanup_verified': True}

    @staticmethod
    def sample(cg, usage):
        cpu = dict(line.split() for line in (cg / 'cpu.stat').read_text().splitlines())
        mem = dict(line.split() for line in (cg / 'memory.events').read_text().splitlines())
        usage['cpu_usec'] = int(cpu['usage_usec'])
        usage['memory_peak_bytes'] = int((cg / 'memory.peak').read_text())
        usage['oom_kill'] = int(mem['oom_kill'])
        usage['pids_peak'] = max(usage['pids_peak'], int((cg / 'pids.current').read_text()))

    @staticmethod
    def collect(directory):
        files = []; omissions = []; total = 0
        for path in sorted(directory.iterdir()):
            info = path.lstat()
            if not NAME.fullmatch(path.name) or path.suffix == '.py' or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                omissions.append('unsafe/non-regular output omitted'); continue
            if len(files) >= P.OUTPUT_FILES or total + info.st_size > P.OUTPUT_BYTES:
                omissions.append('output file/byte limit; file omitted'); continue
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as f:
                raw = f.read(P.OUTPUT_BYTES + 1)
            if len(raw) != info.st_size:
                raise RuntimeError('output_changed')
            total += len(raw); files.append(blob(path.name, raw))
        return files, sorted(set(omissions))


def main():
    parser = argparse.ArgumentParser()
    for name in ('runtime', 'rootfs', 'state', 'pins', 'socket'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--client-uid', type=int, required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('privileged_service_required')
    runner = Runner(args.runtime, args.rootfs, args.state, args.pins)
    endpoint = Path(args.socket)
    if endpoint.exists(): endpoint.unlink()
    with socket.socket(socket.AF_UNIX) as server:
        server.bind(str(endpoint)); endpoint.chmod(0o600); os.chown(endpoint, args.client_uid, -1)
        server.listen(1)
        while True:
            connection, _ = server.accept()
            with connection:
                connection.settimeout(5)
                try:
                    value = request(receive(connection))
                except (OSError, ValueError, EOFError, KeyError, TypeError, RecursionError):
                    continue
                result = runner.run(value, connection)
                try:
                    connection.sendall(encode(result))
                except OSError:
                    pass


if __name__ == '__main__':
    main()
