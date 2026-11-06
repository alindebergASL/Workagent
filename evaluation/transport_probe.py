"""Runs only in harness bwrap. Constructs real requests, never sends them.

The deterministic output is a custody receipt, NOT a task solution, model output,
application tool execution, or full database-backed memory/lifecycle proof.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import sys
import resource


def main():
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024 * 1024, 4 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    sys.path[:0] = ["/product", "/deps"]
    variant = sys.argv[1]
    if variant not in ("B0", "B1", "M1"):
        raise ValueError("invalid_variant")
    if variant == "B0":
        from workagent.retained_results import POLICY, SCHEMA
    else:
        from workagent.capabilities.delegation_composition import POLICY, SCHEMA
    from workagent.responses_transport import build_tool_selection, RequestMetadata

    inputs = Path('/inputs')
    spec = json.loads((inputs / 'episode.json').read_text())
    episode = spec['episode']
    state = Path('/state')
    identity = json.loads((state / 'identity.json').read_text())
    with sqlite3.connect(state / 'continuity.sqlite') as db:
        db.execute('CREATE TABLE IF NOT EXISTS episodes (number INTEGER PRIMARY KEY, context TEXT NOT NULL)')
        history = db.execute('SELECT context FROM episodes ORDER BY number').fetchall()
        assert len(history) == episode - 1
        supplied = {p.name: {'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
                            'bytes': p.stat().st_size}
                    for p in inputs.iterdir() if p.is_file()}
        permitted_project=spec.get('permitted_history_project')
        if permitted_project!=spec['project']:
            raise ValueError('explicit_permitted_history_contract_required')
        context = {'current': spec, 'files': supplied,
                   'raw_history': [json.loads(row[0]) for row in history
                                   if json.loads(row[0])['project']==permitted_project]}
        # B1 receives the same explicit lesson in raw history. Only M1 projects it
        # in the memory channel. This is a transport treatment, not SQL recall.
        lessons = [x.get('reviewed_lesson') for x in context['raw_history']
                   if x.get('reviewed_lesson')]
        if variant == 'M1':
            context['memory_context'] = lessons if episode < 6 else []
        metadata = RequestMetadata(request_id='offline-request', attempt_id='offline-attempt', step_id=str(episode))
        request = build_tool_selection(instructions=POLICY, source_context=json.dumps(context, sort_keys=True),
                                       read_schema=SCHEMA, metadata=metadata,
                                       policy='adaptive-local-v1')
        (state / f'request-{episode}.json').write_bytes(request.body)
        (state / f'count-request-{episode}.json').write_bytes(request.count_body())
        # Exercise actual filesystem reads and output persistence; no claimed task solving.
        (state / f'input-receipt-{episode}.json').write_text(json.dumps(supplied, sort_keys=True))
        db.execute('INSERT INTO episodes VALUES (?,?)', (episode, json.dumps(spec, sort_keys=True)))
        db.commit()
    denials = {}
    evaluator=sys.argv[2]
    for key, path in [('oracle_file', evaluator+'/oracles/custody.json'),
                      ('evaluator_manifest', evaluator+'/manifest.json'),
                      ('repo_file', '/home/ubuntu/workagent-continuation-20261026/AGENTS.md'),
                      ('host_root', '/proc/1/root'+evaluator+'/oracles/custody.json'),
                      ('host_env', '/proc/875172/environ')]:
        try:
            with open(path, 'rb') as f:
                f.read(1)
        except OSError:
            denials[key] = True
        else:
            denials[key] = False
    # Traversal and environment probes actually executed inside the namespace.
    denials['path_traversal'] = not (inputs / '../../home/ubuntu').exists()
    denials['ambient_credentials'] = set(os.environ) <= {'PATH', 'LANG', 'LC_CTYPE', 'PWD'}
    denials['no_other_processes'] = not Path('/proc/875172').exists()
    with socket.socket() as s:
        s.settimeout(.1)
        denials['host_loopback_network'] = s.connect_ex(('127.0.0.1', 8152)) != 0
    print(json.dumps({'episode': episode, 'store_id': identity['store_id'], 'previous_episodes': len(history),
                      'denials': denials, 'provider_calls': 0, 'policy_sha256': hashlib.sha256(POLICY.encode()).hexdigest(),
                      'schema_sha256': hashlib.sha256(SCHEMA.material).hexdigest(),
                      'model': json.loads(request.body)['model'], 'request_sha256': request.sha256,
                      'memory_projection_count': len(context.get('memory_context', [])),
                      'mode': 'deterministic_transport_only', 'child_python': sys.version,
                      'pid': os.getpid()}, sort_keys=True))


if __name__ == '__main__':
    main()
