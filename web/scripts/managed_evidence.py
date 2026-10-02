"""IR-L2 evidence: run the backend's no-inference Responses journey on a fresh
disposable database (real PostgreSQL and product worker, synthetic HTTPX
transport, zero provider calls), then check the real UI against its records.

  python3 web/scripts/managed_evidence.py <new .local env path> <out dir>
"""
import importlib.util
import json
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('workagent_launcher', ROOT / 'scripts/workagent.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

env_path, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
if env_path.exists():
    raise SystemExit('Use a new env path so the evidence starts from a fresh database')
env = launcher.environment(env_path)
values = dict(token.split('=', 1) for line in env_path.read_text().splitlines()
              for token in shlex.split(line) if '=' in token)
out.mkdir(parents=True, exist_ok=True)
# The journey seeds its own workspace and grant, so it needs the migration owner;
# the API and web processes keep the launcher's runtime-only environment.
journey = subprocess.run(
    [str(ROOT / 'backend/.venv/bin/python'), '-m', 'workagent.responses_journey',
     '--state-dir', str(out / 'worker-state')],
    cwd=ROOT / 'backend', env={**env, 'MIGRATION_DATABASE_URL': values['MIGRATION_DATABASE_URL']},
    check=True, capture_output=True, text=True).stdout
record = json.loads(journey)
assert record['provider_inference_calls'] == 0
(out / 'journey.json').write_text(json.dumps(record, indent=2) + '\n')
stack = launcher.Stack(env)
try:
    stack.start(worker=False)
    subprocess.run(['node', str(ROOT / 'web/scripts/managed-recommendation.mjs'),
                    str(out / 'journey.json'), str(out)], cwd=ROOT, env=env, check=True)
finally:
    stack.stop()
print('PASS: managed recommendation evidence in', out)
