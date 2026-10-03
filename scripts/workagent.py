#!/usr/bin/env python3
"""Loopback-only local setup, serve, and real UI/API/PostgreSQL restart demonstration."""
from pathlib import Path
import argparse
import json
import os
import shlex
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / 'backend/.venv/bin/python'


def run(args, cwd=ROOT, env=None):
    subprocess.run([str(a) for a in args], cwd=cwd, env=env, check=True)


def setup():
    run(['uv', 'venv', '--allow-existing', '--python', '/usr/bin/python3', ROOT / 'backend/.venv'])
    run(['uv', 'pip', 'sync', '--python', PYTHON, '--require-hashes', ROOT / 'backend/requirements.lock'])
    run(['npm', 'ci', '--ignore-scripts'], ROOT / 'contracts')
    run(['pnpm', 'install', '--frozen-lockfile'], ROOT / 'web')
    run(['pnpm', 'exec', 'playwright', 'install', 'chromium'], ROOT / 'web')
    run(['pnpm', 'build'], ROOT / 'web', {**os.environ, 'NEXT_PUBLIC_WORKAGENT_API_BASE': '/api/domain'})


def environment(path):
    fresh = not path.exists()
    if fresh:
        run([PYTHON, ROOT / 'backend/dev_db.py', '--env-file', path])
    env = dict(os.environ)
    for line in path.read_text().splitlines():
        tokens = shlex.split(line)
        if tokens and tokens[0] == 'export':
            tokens = tokens[1:]
        if not tokens:
            continue
        if len(tokens) != 1 or '=' not in tokens[0]:
            raise RuntimeError('Invalid local environment file')
        key, value = tokens[0].split('=', 1)
        env[key] = value
    env.update({'LOCAL_TEST_MODE': 'true', 'WORKAGENT_WEB_ORIGIN': 'http://127.0.0.1:3000',
                'WORKAGENT_BACKEND_URL': 'http://127.0.0.1:8000', 'NEXT_PUBLIC_WORKAGENT_API_BASE': '/api/domain'})
    # Fixture seed/web/API/worker processes must not inherit host model keys.
    for name in list(env):
        if name.endswith('API_KEY') or name in {'ANTHROPIC_AUTH_TOKEN', 'OPENAI_ACCESS_TOKEN'}:
            env.pop(name, None)
    if fresh:
        run([PYTHON, '-m', 'workagent.fixture', 'seed', '--records', ROOT / 'fixtures/actor/solo-v0.1/initial_records.json'], ROOT / 'backend', env)
    # Administrative credential belongs only to provisioning/explicit operator CLI.
    env.pop("MIGRATION_DATABASE_URL", None)
    return env


def free_ports():
    for port in (8000, 3000):
        with socket.socket() as s:
            if s.connect_ex(('127.0.0.1', port)) == 0:
                raise RuntimeError(f'Local port {port} is occupied; stop its owner before continuing. No process was killed.')


class Stack:
    def __init__(self, env):
        self.env, self.children, self.logs = env, [], []

    def start(self, worker=False):
        free_ports()
        logdir = ROOT / '.local/logs'
        logdir.mkdir(parents=True, exist_ok=True)
        commands = [('api', [PYTHON, '-m', 'workagent'], ROOT / 'backend'),
                    ('web', ['pnpm', 'start'], ROOT / 'web')]
        if worker:
            commands.append(('dispatcher', [PYTHON, '-m', 'workagent.dispatcher', '--general-controlled'], ROOT / 'backend'))
        for name, command, cwd in commands:
            log = (logdir / f'{name}.log').open('ab')
            self.logs.append(log)
            self.children.append(subprocess.Popen([str(a) for a in command], cwd=cwd, env=self.env,
                                                  stdout=log, stderr=log, start_new_session=True))
        deadline = time.monotonic() + 45
        url = 'http://127.0.0.1:3000/api/domain/v1/workspaces'
        while time.monotonic() < deadline:
            if any(p.poll() is not None for p in self.children):
                raise RuntimeError('Local service exited; inspect .local/logs (not public).')
            try:
                request = urllib.request.Request(url, headers={'X-Workagent-Client': 'local-ui'})
                with urllib.request.urlopen(request, timeout=2) as response:
                    if response.status == 200 and json.load(response)['items']:
                        return
            except (OSError, ValueError, KeyError):
                time.sleep(0.2)
        raise RuntimeError('Local readiness deadline exceeded; inspect .local/logs.')

    def stop(self):
        for process in self.children:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
        for process in self.children:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
        for log in self.logs:
            log.close()
        self.children, self.logs = [], []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['setup', 'serve', 'demo', 'faults'])
    parser.add_argument('--env', type=Path, default=ROOT / '.local/app.env')
    parser.add_argument('--skip-setup', action='store_true', help='Use already tested installed dependencies and production build')
    args = parser.parse_args()
    if args.command == 'setup' or (args.command == 'demo' and not args.skip_setup):
        setup()
    if args.command == 'setup':
        return
    if not PYTHON.exists() or not (ROOT / 'web/.next/BUILD_ID').exists():
        raise RuntimeError('Run python3 scripts/workagent.py setup first.')
    free_ports()
    if args.command == 'faults':
        args.env = args.env.with_suffix('.faults.env')
    env = environment(args.env.resolve())
    stack = Stack(env)
    try:
        stack.start(worker=args.command == 'serve')
        if args.command == 'demo':
            run(['node', ROOT / 'web/scripts/real-journey.mjs'], ROOT, env)
            run(['node', ROOT / 'web/scripts/agent-first-journey.mjs'], ROOT, env)
            stack.stop()  # API and web really exit; PostgreSQL and immutable rows remain.
            stack.start()
            run(['node', ROOT / 'web/scripts/real-journey.mjs', '--reopen'], ROOT, env)
            run(['node', ROOT / 'web/scripts/agent-first-journey.mjs', '--reopen'], ROOT, env)
            stack.stop()
            run([sys.executable, ROOT / 'scripts/workagent.py', 'faults', '--env', args.env, '--skip-setup'])
            metadata = {'git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                        'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()),
                        'mode': 'real_ui_api_postgresql_with_deterministic_fixture_computation',
                        'runtime_provider': 'not_observed', 'process_restart': 'api_and_web',
                        'database_recreated_between_phases': False}
            (ROOT / '.local/evidence/demo.json').write_text(json.dumps(metadata, indent=2) + '\n')
            print('PASS: .local/evidence contains saved bodies, task readback and desktop/mobile restart evidence. Database retained.')
        elif args.command == 'faults':
            run(['node', ROOT / 'web/scripts/fault-regressions.mjs'], ROOT, {**env, 'WORKAGENT_TEST_ENV_FILE': str(args.env.resolve())})
        else:
            print('Workagent: http://127.0.0.1:3000 — private local fixture mode; Ctrl-C stops processes, not saved work.', flush=True)
            while True:
                if any(p.poll() is not None for p in stack.children):
                    raise RuntimeError('A service exited; stopping this stack. Saved work retained.')
                time.sleep(1)
    finally:
        stack.stop()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
