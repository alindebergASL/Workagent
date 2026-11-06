"""Install a NEW root-owned fixed compute snapshot from trusted offline inputs.

This is an operator command, never a model/API capability. Source rootfs must be
exported from the image digest in profiles.py; source runtime must match the lock.
No Docker daemon change, package installation, host-policy change or service start.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
sys.dont_write_bytecode = True


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime-source', required=True)
    p.add_argument('--rootfs-source', required=True)
    p.add_argument('--destination', required=True)
    args = p.parse_args()
    if os.geteuid() != 0: raise SystemExit('root install required')
    dest = Path(args.destination)
    if dest.exists(): raise SystemExit('new installation directory required')
    dest.mkdir(mode=0o755); dest.chmod(0o755)
    runtime = Path(args.runtime_source)
    shutil.copyfile(runtime / 'runsc', dest / 'runsc'); (dest / 'runsc').chmod(0o755)
    shutil.copytree(runtime / 'gvisor-bin', dest / 'gvisor-bin', symlinks=True)
    fs = dest / 'rootfs'; shutil.copytree(args.rootfs_source, fs, symlinks=True)
    for name in ('inputs', 'outputs'): (fs / name).mkdir(exist_ok=True)
    # Fixed stdlib-only package set, built before running any untrusted code.
    site = fs / 'usr/local/lib/python3.12/site-packages'
    shutil.rmtree(site); site.mkdir()
    for path in (fs / 'usr/local/bin').glob('pip*'): path.unlink()
    code = Path(__file__).parent / 'workagent/sandbox'
    (dest / 'sandbox').mkdir()
    for path in code.glob('*.py'): shutil.copyfile(path, dest / 'sandbox' / path.name)
    # New owned snapshot only: never chmod/chown an existing host tree.
    for path in [dest, *dest.rglob('*')]:
        if not path.is_symlink(): path.chmod(stat.S_IMODE(path.stat().st_mode) & ~0o022)
    sys.path.insert(0, str(dest))
    from sandbox.installation import manifest
    from sandbox import profiles as P
    trees = manifest(dest, fs)
    checksum = lambda v: hashlib.sha256(json.dumps(v, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    lock = json.loads((code / 'runtime-lock.json').read_text())
    for key in ('runsc', 'sidecars', 'rootfs'):
        if checksum(trees[key]) != lock[key + '_tree_sha256']:
            raise SystemExit('immutable runtime lock mismatch: ' + key)
    pins = {'image': P.IMAGE, 'runtime_version': P.RUNTIME_VERSION, 'trees': trees}
    (dest / 'pins.json').write_text(json.dumps(pins, sort_keys=True, separators=(',', ':')))
    print(json.dumps({'installed':str(dest), 'profile_sha256':hashlib.sha256((dest/'pins.json').read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
