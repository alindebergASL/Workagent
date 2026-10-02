#!/usr/bin/env python3
"""Generate versioned manifests; approval is a separate reviewed file, not generated."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', choices=['0.1.0', '0.1.1'], default='0.1.0')
    version = parser.parse_args().version
    directory = ROOT / ('agent/v' + version)
    paths = [
        'AGENTS.md', 'SOUL.md', 'skills/analyze-intake/SKILL.md',
        'skills/analyze-intake/references/method.md', 'skills/resume-work/SKILL.md',
    ]
    manifest = {
        'schema_version': 'workagent.bundle/v1', 'version': version,
        'files': {p: hashlib.sha256((directory / p).read_bytes()).hexdigest() for p in paths},
        'instructions': ['AGENTS.md', 'SOUL.md'],
        'skills': [
            {'id': 'analyze-intake', 'version': version,
             'description': 'Analyze selected intake evidence and propose a private plan/checklist.',
             'path': 'skills/analyze-intake/SKILL.md',
             'resources': ['skills/analyze-intake/references/method.md'],
             'tools': ['get_assignment', 'get_artifact', 'propose_artifact_revision']},
            {'id': 'resume-work', 'version': version,
             'description': 'Resume from durable state while preserving human edits and unresolved effects.',
             'path': 'skills/resume-work/SKILL.md', 'resources': [],
             'tools': ['get_assignment', 'get_artifact', 'get_task']},
        ],
        'capabilities': ['inspect-assignment', 'retrieve-permitted-evidence', 'propose-artifact-revision', 'reconcile-action'],
        'environment': 'none', 'scripts_enabled': False,
    }
    # JSON is a strict YAML subset; stdlib parser avoids implicit YAML coercion.
    path = directory / 'runtime.yaml'
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print('manifest_sha256=' + hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
