"""Trusted installation inspection; no workload paths are ever passed here."""
import os
from pathlib import Path
import stat
from .runner_protocol import digest


def secure(path):
    for p in (path, *path.parents):
        s = p.lstat()
        if s.st_uid != 0 or (not stat.S_ISLNK(s.st_mode) and s.st_mode & 0o022):
            raise RuntimeError('root_owned_nonwritable_installation_required')


def tree(root):
    secure(root)
    entries = {}
    for p in [root, *sorted(root.rglob('*'))]:
        s = p.lstat()
        if s.st_uid != 0 or (not stat.S_ISLNK(s.st_mode) and s.st_mode & 0o022):
            raise RuntimeError('root_owned_nonwritable_installation_required')
        value = {'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid}
        if p.is_symlink(): value.update(kind='symlink', target=os.readlink(p))
        elif p.is_file(): value.update(kind='file', sha256=digest(p.read_bytes()))
        elif p.is_dir(): value.update(kind='directory')
        else: raise RuntimeError('unexpected_installation_node')
        entries[str(p.relative_to(root))] = value
    return entries


def manifest(runtime, rootfs):
    runtime, rootfs = Path(runtime), Path(rootfs)
    return {'runsc': tree(runtime / 'runsc'), 'sidecars': tree(runtime / 'gvisor-bin'),
            'rootfs': tree(rootfs), 'service': tree(runtime / 'sandbox')}
