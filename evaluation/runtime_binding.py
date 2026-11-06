"""Exact offline child runtime binding; admission never trusts controller version."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def inventory(repo: Path, evaluator: Path):
    deps=repo/'backend/.venv/lib/python3.12/site-packages'
    rows=[]
    for p in sorted(deps.rglob('*')):
        if p.is_symlink():
            raise ValueError('dependency_symlink_not_bound')
        if p.is_file():
            rows.append({'path':str(p.relative_to(deps)),'sha256':sha(p)})
    canonical=lambda x:json.dumps(x,sort_keys=True,separators=(',',':')).encode()
    return {
      'controller':{'version':sys.version,'executable_sha256':sha(Path(sys.executable).resolve())},
      'child':{'version':subprocess.check_output(['/usr/bin/python3','--version'],text=True).strip(),
               'executable_sha256':sha(Path('/usr/bin/python3').resolve())},
      'bwrap':{'version':subprocess.check_output(['/usr/bin/bwrap','--version'],text=True).strip(),
               'executable_sha256':sha(Path('/usr/bin/bwrap'))},
      'dependencies':rows,'dependency_count':len(rows),
      'dependencies_sha256':hashlib.sha256(canonical(rows)).hexdigest(),
      'harness':{n:sha(repo/'evaluation'/n) for n in ('harness.py','transport_probe.py','runtime_binding.py')},
      'evaluator_generator_sha256':sha(evaluator/'author_cases.py'),
      'corpus_freeze_sha256':sha(evaluator/'freeze.json'),
      'replay':'exact frozen bytes; see evaluator seed record if present; original ZIP bytes/timestamps remain authoritative',
      'boundary':'fixed bwrap mounts, clear environment, no network; host kernel/system-library build captured separately',
      'kernel':subprocess.check_output(['/usr/bin/uname','-srvm'],text=True).strip(),
    }


def validate(expected, observed):
    if expected != observed:
        raise ValueError('runtime_or_dependency_drift')


if __name__=='__main__':
    repo=Path(__file__).resolve().parents[1]
    evaluator=Path(sys.argv[1]).resolve()
    path=evaluator/'runtime-lock.json'
    value=inventory(repo,evaluator)
    with path.open('x') as stream:json.dump(value,stream,sort_keys=True,indent=2)
    print(json.dumps({'lock':str(path),'sha256':sha(path),'dependencies':value['dependency_count'],'child':value['child']}))
