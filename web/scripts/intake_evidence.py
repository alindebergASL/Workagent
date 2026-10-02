"""Run the intake outcome evidence on a fresh disposable database, with a real
API/web restart between the two phases. No dispatcher and no provider: fixture
work is advanced explicitly; the unknown state uses a synthetic attempt.

  python3 web/scripts/intake_evidence.py <new .local env path> <out dir>
"""
import importlib.util
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('workagent_launcher', ROOT / 'scripts/workagent.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

env_path, out = Path(sys.argv[1]).resolve(), str(Path(sys.argv[2]).resolve())
if env_path.exists():
    raise SystemExit('Use a new env path so the evidence starts from a fresh database')
env = launcher.environment(env_path)
# The operator grant needs the migration owner. Only the evidence script gets
# it; the API and web processes keep the launcher's runtime-only environment.
owner = next(token.split('=', 1)[1]
             for line in env_path.read_text().splitlines()
             for token in shlex.split(line)
             if token.startswith('MIGRATION_DATABASE_URL='))
script = str(ROOT / 'web/scripts/intake-states.mjs')
for phase in ([], ['--reopen']):
    stack = launcher.Stack(env)
    try:
        stack.start(worker=False)
        subprocess.run(['node', script, out, *phase], cwd=ROOT,
                       env={**env, 'MIGRATION_DATABASE_URL': owner}, check=True)
    finally:
        stack.stop()
print('PASS: intake evidence in', out)
