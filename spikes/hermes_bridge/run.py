"""Stdlib-only supervisor; inherits no host environment into probe."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PIN = 'f97608f178d1ffeca59860195ab7da295f7c8e5f'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--quick', action='store_true', help='Run bridge + comparison, omit existing regression suite')
    p.add_argument('--upstream', default='/home/ubuntu/workagent-upstream-review/hermes-agent')
    args = p.parse_args()
    upstream = Path(args.upstream).resolve()
    pin = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
    assert pin == PIN, (pin, PIN)
    assert not subprocess.check_output(['git', '-C', str(upstream), 'status', '--porcelain'], text=True).strip()
    run = HERE / '.runs' / str(os.getpid())
    (run / 'home/hermes').mkdir(parents=True, mode=0o700)
    run.chmod(0o700)
    (run / 'home/hermes/config.yaml').write_text(json.dumps({
        'model': {'context_length':65536},
        'tools': {'tool_search': {'enabled':'off'}},
        'compression': {'enabled':False},
        'memory': {'memory_enabled':False, 'user_profile_enabled':False}}))
    env = {'WORKAGENT_SOURCE_SHA': subprocess.check_output(
               ['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip(),
           'WORKAGENT_TRACKED_DIRTY': str(bool(subprocess.check_output(
               ['git', '-C', str(REPO), 'status', '--porcelain', '--untracked-files=no'], text=True).strip())).lower(),
           'PATH': '/usr/bin:/bin', 'HOME': str(run / 'home'),
           'HERMES_HOME': str(run / 'home/hermes'), 'TMPDIR': str(run),
           'XDG_CONFIG_HOME': str(run / 'home/config'), 'XDG_CACHE_HOME': str(run / 'home/cache'),
           'XDG_DATA_HOME': str(run / 'home/data'), 'LANG': 'C.UTF-8',
           'PYTHONDONTWRITEBYTECODE': '1', 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1'}
    pg = Path('/usr/lib/postgresql/16/bin')
    (run / 'pgsock').mkdir()
    subprocess.run([str(pg / 'initdb'), '-D', str(run / 'pgdata'), '-U', 'bridge_admin',
                    '--auth=trust', '--no-locale', '--encoding=UTF8'], env=env, cwd=run, check=True, capture_output=True)
    subprocess.run([str(pg / 'pg_ctl'), '-D', str(run / 'pgdata'), '-l', str(run / 'postgres.log'),
                    '-o', f"-k {run / 'pgsock'} -c listen_addresses=''", '-w', 'start'],
                   env=env, cwd=run, check=True, capture_output=True)
    try:
        result = subprocess.run([str(HERE / '.venv/bin/python'), '-I', '-B', '-u', str(HERE / 'probe.py'),
                                 str(run), str(upstream), str(REPO)] + (['--quick'] if args.quick else []), cwd=run, env=env,
                                capture_output=True, text=True, timeout=540)
    except subprocess.TimeoutExpired as exc:
        print(exc.stdout); print(exc.stderr); raise
    finally:
        subprocess.run([str(pg / 'pg_ctl'), '-D', str(run / 'pgdata'), '-m', 'immediate', '-w', 'stop'],
                       env=env, cwd=run, check=True, capture_output=True)
        assert not (run / 'pgdata/postmaster.pid').exists(), 'disposable cluster still running'
    (run / 'stdout.txt').write_text(result.stdout)
    (run / 'stderr.txt').write_text(result.stderr)
    print(result.stdout)
    print(result.stderr, file=sys.stderr)
    print('run_dir=' + str(run))
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
