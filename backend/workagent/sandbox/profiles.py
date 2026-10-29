"""Fixed, versioned compute envelope. Never accept limits/paths/argv from a job."""
PROFILE = 'python-analysis-v1'
RUNTIME_VERSION = 'release-20261026.0'
IMAGE = 'python@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c'
PYTHON_VERSION = '3.12.12'
PACKAGES = ('stdlib',)  # -I -S: no site packages, no runtime installation.
WALL_SECONDS = 30
CPU_SECONDS = 5
MEMORY_BYTES = 512 * 1024 * 1024
HOST_PIDS = 128
GUEST_PIDS = 32
DISK_BYTES = 32 * 1024 * 1024
STREAM_BYTES = 128 * 1024
INPUT_BYTES = 1024 * 1024
OUTPUT_BYTES = 1024 * 1024
OUTPUT_FILES = 8
CODE_BYTES = 65536
WIRE_BYTES = 3 * 1024 * 1024


def spec(rootfs, inputs, outputs, cgroup):
    return {
        'ociVersion': '1.0.2', 'root': {'path': str(rootfs), 'readonly': True},
        'process': {
            'terminal': False, 'user': {'uid': 65534, 'gid': 65534},
            'args': ['/usr/local/bin/python3', '-I', '-S', '-B', '/inputs/main.py'],
            'env': ['PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8', 'TZ=UTC'],
            'cwd': '/outputs', 'noNewPrivileges': True,
            'capabilities': {k: [] for k in ('bounding', 'effective', 'inheritable', 'permitted', 'ambient')},
            'rlimits': [{'type': k, 'soft': v, 'hard': v} for k, v in (
                ('RLIMIT_CPU', CPU_SECONDS), ('RLIMIT_NPROC', GUEST_PIDS),
                ('RLIMIT_FSIZE', OUTPUT_BYTES), ('RLIMIT_NOFILE', 64), ('RLIMIT_CORE', 0))],
        },
        'mounts': [
            {'destination': '/proc', 'type': 'proc', 'source': 'proc', 'options': ['nosuid', 'nodev', 'noexec']},
            {'destination': '/inputs', 'type': 'bind', 'source': str(inputs), 'options': ['rbind', 'ro', 'nosuid', 'nodev', 'noexec']},
            {'destination': '/outputs', 'type': 'bind', 'source': str(outputs), 'options': ['rbind', 'rw', 'nosuid', 'nodev', 'noexec']},
            {'destination': '/tmp', 'type': 'tmpfs', 'source': 'tmpfs', 'options': ['size=8388608', 'nr_inodes=128', 'nosuid', 'nodev', 'noexec']},
            {'destination': '/dev', 'type': 'tmpfs', 'source': 'tmpfs', 'options': ['size=1048576', 'nosuid', 'noexec']},
        ],
        'linux': {
            'namespaces': [{'type': n} for n in ('pid', 'network', 'ipc', 'uts', 'mount')],
            'cgroupsPath': cgroup,
            'resources': {'memory': {'limit': MEMORY_BYTES, 'swap': MEMORY_BYTES},
                          'pids': {'limit': HOST_PIDS}, 'cpu': {'quota': 100000, 'period': 100000}},
        },
    }
