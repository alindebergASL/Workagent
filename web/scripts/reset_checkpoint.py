"""Product-reset checkpoint 1 on the database the canonical demo retained
(real API, PostgreSQL and web; no dispatcher, no provider).

  python3 web/scripts/reset_checkpoint.py <demo .local env> <out dir> [prototype dir]
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
if not env_path.exists():
    raise SystemExit('Run the canonical demo first; this uses the database it retained')
env = launcher.environment(env_path)
stack = launcher.Stack(env)
try:
    stack.start(worker=False)
    subprocess.run(['node', str(ROOT / 'web/scripts/reset-checkpoint.mjs'),
                    str(ROOT / '.local/evidence/state.json'), out, *sys.argv[3:4]],
                   cwd=ROOT, env=env, check=True)
finally:
    stack.stop()
print('PASS: reset checkpoint evidence in', out)
