"""B1 conversation evidence on a fresh disposable database: real API, PostgreSQL
and web; turns advance only through the controlled GeneralWorker (no provider).

  python3 web/scripts/conversation_evidence.py <new .local env path> <out dir>
"""
import importlib.util
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
stack = launcher.Stack(env)
try:
    stack.start(worker=False)
    subprocess.run(['node', str(ROOT / 'web/scripts/conversation-journey.mjs'), out],
                   cwd=ROOT, env=env, check=True)
finally:
    stack.stop()
print('PASS: conversation evidence in', out)
