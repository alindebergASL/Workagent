#!/usr/bin/env python3
"""Fresh-DB production-UI flexible lifecycle; isolated from saved review services.

Uses Claude's real controlled-consumer browser journey, then stops and restarts
all three owned processes before reopening. Zero model calls. Preserves its DB.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
# Load the local launcher, not the backend package with the same name.
import workagent as launcher


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--web-port', type=int, default=3160)
    parser.add_argument('--api-port', type=int, default=8160)
    args = parser.parse_args()
    assert not args.env.exists() and not args.output.exists(), 'New fixture only; no reset'
    for port in (args.web_port, args.api_port):
        with socket.socket() as sock:
            assert sock.connect_ex(('127.0.0.1', port)) != 0, 'Port occupied; no process changed'
    args.output.mkdir(parents=True, mode=0o700)
    env = launcher.environment(args.env.resolve())
    origin = f'http://127.0.0.1:{args.web_port}'
    env.update(WORKAGENT_WEB_ORIGIN=origin, FRONTEND_ORIGIN=origin,
               WORKAGENT_BACKEND_URL=f'http://127.0.0.1:{args.api_port}')
    children, logs = [], []

    def stop():
        for process in children:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
        for process in children:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
        for log in logs:
            log.close()
        children.clear(); logs.clear()

    def start():
        commands = [
            ('api', [launcher.PYTHON, '-m', 'uvicorn', 'workagent.api:app', '--host', '127.0.0.1', '--port', str(args.api_port), '--no-proxy-headers'], ROOT/'backend'),
            ('web', ['pnpm', 'exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', str(args.web_port)], ROOT/'web'),
            ('consumer', [launcher.PYTHON, '-m', 'workagent.dispatcher', '--general-controlled'], ROOT/'backend'),
        ]
        for name, command, cwd in commands:
            log = (args.output/(name+'.private.log')).open('ab'); logs.append(log)
            children.append(subprocess.Popen([str(x) for x in command], cwd=cwd, env=env, stdout=log, stderr=log, start_new_session=True))
        deadline = time.monotonic()+45
        while time.monotonic() < deadline:
            assert all(p.poll() is None for p in children), 'Owned process exited'
            try:
                request = urllib.request.Request(origin+'/api/domain/v1/workspaces', headers={'X-Workagent-Client':'local-ui'})
                with urllib.request.urlopen(request, timeout=2) as response:
                    if response.status == 200 and json.load(response)['items']:
                        return
            except (OSError, ValueError, KeyError):
                time.sleep(.2)
        raise RuntimeError('Owned stack readiness deadline exceeded')

    head = subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip()
    try:
        start()
        launcher.run(['node', ROOT/'web/scripts/flexible-journey.mjs', args.output.resolve(), 'create'], env=env)
        first_pids = [p.pid for p in children]
        stop(); start()
        assert not set(first_pids).intersection(p.pid for p in children)
        launcher.run(['node', ROOT/'web/scripts/flexible-journey.mjs', args.output.resolve(), 'reopen'], env=env)
        assert subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip() == head
        (args.output/'verification.json').write_text(json.dumps({
            'git_commit':head, 'passed':True, 'origin':origin,
            'mode':'fresh_postgresql_production_ui_continuous_controlled_consumer',
            'processes_restarted':['api','web','consumer'], 'provider_calls':0,
            'database_reset':False, 'human_experience_acceptance':'not_tested',
        }, indent=2)+'\n')
        print('PASS: fresh-DB flexible product lifecycle and all-process restart')
    finally:
        stop()


if __name__ == '__main__':
    main()
