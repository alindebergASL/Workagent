"""One isolated actual product-worker visit. No evaluator/controller imports."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
sys.path[:0] = ['/product', '/deps', '/']
from network_worker import require, inventory, h, restrict_network, BindingDenied
from study_transport import attach_transport, require_live_release


def main():
    cfg = json.load(sys.stdin)
    if cfg['transport'] == 'official_api':
        require_live_release()
    require(cfg['transport'] in ('controlled_http', 'official_api'), 'unknown_transport')
    require(inventory('/product/workagent') == cfg['source_manifest'], 'loaded_source_drift')
    require(inventory('/inputs') == cfg['input_files'], 'episode_input_drift')
    require(all(h(p) == expected for p, expected in cfg['execution_files'].items()), 'execution_file_drift')
    require(inventory('/deps') == cfg['dependencies'], 'dependency_drift')
    require(not any('__pycache__' not in p.parts for p in Path('/deps').rglob('*.pyc')), 'sourceless_dependency_bytecode')
    require(not list(Path('/product/workagent').rglob('*.pyc')), 'product_bytecode')
    require(sys.pycache_prefix == '/pycache' and not list(Path('/pycache').iterdir()), 'cache_not_isolated')
    network = restrict_network(cfg)
    from workagent.db import Database
    from workagent.service import Service, Principal
    from workagent.general_worker import GeneralWorker
    service = Service(Database(cfg['dsn']))
    service.db.check_runtime_role()
    with service.db.transaction() as c:
        row = c.execute('SELECT data,active FROM provider_grants WHERE id=%s', (cfg['grant_id'],)).fetchone()
        require(row and row['active'] and row['data'] == cfg['grant'], 'grant_binding_drift')
        run = c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s', (cfg['workspace'], cfg['run_id'])).fetchone()
        require(run and run['data'] == cfg['run_configuration'], 'run_configuration_drift')
        if 'tool_grant' in cfg:
            from workagent.capabilities import registry
            tool = c.execute('SELECT data FROM tool_grants WHERE run_id=%s',(cfg['run_id'],)).fetchone()
            require(tool and tool['data'] == cfg['tool_grant'], 'tool_grant_drift')
            for pin in cfg['tool_grant']['capabilities']:
                require(registry.adapters()[pin['id']].descriptor.model_dump(mode='json') == cfg['descriptors'][pin['id']], 'descriptor_drift')
    transport = attach_transport(service, cfg, credential=cfg.pop('credential',None))
    def hook(name):
        if cfg.get('interrupt') and name == 'after_tool_result':
            raise InterruptedError('controlled_restart_boundary')
    worker = GeneralWorker(service, transport=transport, state=Path('/state'), enable_responses=True, hook=hook)
    status = 'interrupted'
    try:
        for _ in range(20):  # polling visit bound, NOT model choices or acceptance
            result = worker.work(Principal(cfg['principal']), cfg['workspace'], cfg['run_id'])
            status = result.state
            if status != 'waiting':
                break
            time.sleep(.1)
    except InterruptedError:
        pass
    finally:
        transport.close()
    print(json.dumps({'state': status, 'pid': os.getpid(), 'start_ticks': Path('/proc/self/stat').read_text().split()[21],
        'namespace_ids': {n: os.readlink('/proc/self/ns/' + n) for n in ('pid', 'mnt', 'user')},
        'source_manifest_sha256': hashlib.sha256(json.dumps(cfg['source_manifest'], sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(),
        'network': network, 'input_files': cfg['input_files'], 'evidence_level': 'scripted_actual_worker' if cfg['transport'] == 'controlled_http' else 'unscored_live_worker'}))

if __name__ == '__main__':
    try:
        main()
    except BindingDenied as exc:
        print(json.dumps({'state': 'denied', 'reason': str(exc)}))
        raise SystemExit(64)
