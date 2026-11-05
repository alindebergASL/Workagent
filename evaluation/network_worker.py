"""Actual GeneralWorker entry point in a mount/PID jail. No evaluator imports.
Synthetic transport exercises plumbing only, never produces live A/B scores.
Official transport deliberately unavailable during the zero-provider continuation.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import errno
import ctypes
import socket

sys.path[:0] = ['/product', '/deps']

def h(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def inventory(root):
    return {str(p.relative_to(root)): h(p) for p in sorted(Path(root).rglob('*'))
            if p.is_file() and '__pycache__' not in str(p) and p.suffix != '.pyc'}

class BindingDenied(Exception):
    pass

def require(value, code):
    if not value:
        raise BindingDenied(code)

def restrict_network(cfg):
    """Kernel TCP allowlist, inherited by worker/tool children. No host admin HTTP."""
    libc=ctypes.CDLL(None,use_errno=True)
    class Ruleset(ctypes.Structure):
        _fields_=[('fs',ctypes.c_uint64),('net',ctypes.c_uint64)]
    class Port(ctypes.Structure):
        _fields_=[('access',ctypes.c_uint64),('port',ctypes.c_uint64)]
    # Linux x86_64 generic Landlock syscalls; fail closed on unsupported hosts.
    require(os.uname().machine=='x86_64','unsupported_landlock_architecture')
    abi=libc.syscall(444,0,0,1)
    require(abi>=4,'landlock_network_unavailable')
    rules=Ruleset(0,3)
    fd=libc.syscall(444,ctypes.byref(rules),ctypes.sizeof(rules),0)
    require(fd>=0,'landlock_ruleset_failed')
    try:
        for port in cfg['allowed_tcp_ports']:
            rule=Port(2,port)
            require(libc.syscall(445,fd,2,ctypes.byref(rule),0)==0,'landlock_rule_failed')
        require(libc.prctl(38,1,0,0,0)==0,'no_new_privs_failed')
        require(libc.syscall(446,fd,0)==0,'landlock_restrict_failed')
    finally:
        os.close(fd)
    with socket.socket() as s:
        s.settimeout(2)
        denied=s.connect_ex(('127.0.0.1',cfg['forbidden_listener_port']))
    require(denied in (errno.EACCES,errno.EPERM),'host_listener_not_denied')
    return {'abi':abi,'allowed_connect_tcp_ports':cfg['allowed_tcp_ports'],'host_listener_errno':denied,'bind_tcp':False,
        'limit':'Port allowlist, not IP firewall; HTTPS443 and DB port remain reachable. No evaluator may serve on those ports. UDP DNS remains available.'}

def probe(cfg):
    denied = {}
    for label, path in cfg['forbidden_paths'].items():
        try:
            Path(path).read_bytes()
        except OSError as exc:
            denied[label] = exc.errno in (errno.ENOENT, errno.EACCES, errno.EPERM)
        else:
            denied[label] = False
    denied['no_admin_environment'] = not any(k in os.environ for k in ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY']) and os.environ.get('HOME') == '/home/worker'
    denied['no_host_process'] = not Path('/proc/' + str(cfg['controller_pid'])).exists()
    denied['no_inherited_host_fds'] = all(not os.readlink(p).startswith('/home/') for p in Path('/proc/self/fd').iterdir() if p.name not in ('0','1','2') and p.exists())
    assert all(denied.values()), denied
    return denied

class ScriptedProvider:
    def __init__(self, cfg):
        import httpx
        from workagent.responses_transport import ResponsesTransport
        self.cfg = cfg
        self.calls = []
        self.transport = ResponsesTransport.synthetic(httpx.MockTransport(self.handle))
        self.transport._client.timeout = httpx.Timeout(.1)

    def handle(self, req):
        import httpx
        data = json.loads(req.content)
        self.calls.append({'method': req.method, 'path': req.url.path, 'request_sha256': hashlib.sha256(req.content).hexdigest()})
        if req.url.path.endswith('input_tokens'):
            return httpx.Response(200, json={'object':'response.input_tokens','input_tokens':700})
        assert req.method == 'POST'
        phase = data['metadata']['step_id']
        ctx = json.loads(data['input'][0]['content'])
        if phase == 'final':
            output = [{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps({'text':'Scripted zero-provider network worker diagnostic; NOT A/B quality.'})}]}]
        else:
            i = 0 if phase == 'selection' else int(phase.rsplit('_',1)[1])-1
            if self.cfg['variant'] == 'B0':
                decision = {'kind':'reply','text':'Scripted baseline readiness only; no research quality claim.'}
            elif i == 0:
                decision = {'kind':'research_capture','url':self.cfg['url'],'allow_browser':False}
            elif i == 1:
                ref = next(r for r in ctx['run_output_refs'] if r['kind'] == 'workspace_file')
                decision = {'kind':'files_read_range','ref':{'workspace_file_id':ref['id'],'version_id':ref['version'],'sha256':ref['sha256']},'offset':0,'limit':8192}
            elif i == 2:
                text = '# Readiness diagnostic\n\nScripted capture/read/export, not an independently scored model output.\n\nSource: '+self.cfg['url']+'\n'
                decision = {'kind':'files_create_draft','source':{'kind':'text','filename':'readiness.md','mime_type':'text/markdown','content':text,'sha256':hashlib.sha256(text.encode()).hexdigest()}}
            elif i == 3:
                ref = next(r for r in ctx['run_output_refs'] if r['kind'] == 'artifact_revision')
                decision = {'kind':'artifacts_export','input_ref':ref,'format':'markdown'}
            else:
                decision = {'kind':'reply','text':'Scripted diagnostic downloaded. Not an A/B result.'}
            value = {'goal':'Readiness diagnostic','success_criteria':[],'decision':decision}
            output = [{'type':'function_call','name':'choose_general_action','call_id':'call_'+phase,'arguments':json.dumps(value)}]
        return httpx.Response(200,json={'id':'resp_readiness_'+phase,'object':'response','model':'gpt-6.1-sol','service_tier':'default','metadata':data['metadata'],'status':'completed','error':None,'output':output,'usage':{'input_tokens':700,'output_tokens':200,'total_tokens':900,'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':50}}})

def main():
    cfg = json.load(sys.stdin)
    assert cfg['transport'] == 'synthetic', 'paid_admission_stopped'
    assert '/workagent_test_' in cfg['dsn']
    denials = probe(cfg)
    network = restrict_network(cfg)
    observed = inventory('/product/workagent')
    require(observed == cfg['source_manifest'], 'loaded_source_drift')
    require(all(h(path)==value for path,value in cfg['execution_files'].items()), 'execution_file_drift')
    require(inventory('/deps') == cfg['dependencies'], 'dependency_drift')
    require(not list(Path('/product/workagent').rglob('*.pyc')), 'bytecode_in_product')
    require(sys.pycache_prefix == '/pycache' and not list(Path('/pycache').iterdir()), 'bytecode_cache_not_isolated')
    from workagent.db import Database
    from workagent.service import Service, Principal
    from workagent.general_worker import GeneralWorker
    from workagent.capabilities import registry
    service = Service(Database(cfg['dsn']))
    service.db.check_runtime_role()
    with service.db.transaction() as c:
        grant = c.execute('SELECT data,active FROM provider_grants WHERE id=%s',(cfg['grant_id'],)).fetchone()
        run = c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(cfg['workspace'],cfg['run_id'])).fetchone()['data']
        require(grant['active'] and grant['data'] == cfg['grant'], 'grant_binding_drift')
        require(run == cfg['run_configuration'], 'run_configuration_drift')
        assert grant['data']['responses']['transport_mode'] == 'synthetic'
        assert run['consumer_sha256'] == cfg['grant']['consumer_sha256']
        if cfg['variant'] != 'B0':
            tg = c.execute('SELECT data FROM tool_grants WHERE run_id=%s',(cfg['run_id'],)).fetchone()['data']
            assert tg == cfg['tool_grant']
            for pin in tg['capabilities']:
                descriptor = registry.adapters()[pin['id']].descriptor.model_dump(mode='json')
                require(descriptor == cfg['descriptors'].get(pin['id']), 'descriptor_binding_drift')
    provider = ScriptedProvider(cfg)
    def hook(name):
        if cfg.get('interrupt') and name == 'after_tool_result':
            raise InterruptedError('readiness_restart_after_capture')
    worker = GeneralWorker(service,transport=provider.transport,state=Path('/state'),enable_responses=True,hook=hook)
    p = Principal(cfg['principal'])
    interrupted = False
    outcome = None
    try:
        # Each visit is production's own bounded execution/recovery path. No tiny token override.
        for _ in range(20):
            outcome = worker.work(p,cfg['workspace'],cfg['run_id'])
            if outcome.state != 'waiting':
                break
            time.sleep(.2)
    except InterruptedError:
        interrupted = True
        outcome = None
    receipt = {'kind':'scripted_actual_worker_not_AB','denials':denials,'source_manifest':observed,'grant_id':cfg['grant_id'],'run_id':cfg['run_id'],'provider_network_calls':0,'synthetic_calls':provider.calls,'state':outcome.state if outcome else 'interrupted','pid':os.getpid(),'python':sys.version,'input_files':inventory('/inputs'),'restart_interruption':interrupted,'controller_pid_visible':Path('/proc/'+str(cfg['controller_pid'])).exists()}
    receipt['execution_files'] = cfg['execution_files']
    receipt['dependencies_sha256'] = hashlib.sha256(json.dumps(cfg['dependencies'],sort_keys=True).encode()).hexdigest()
    receipt['bytecode_cache_isolated'] = sys.pycache_prefix == '/pycache'
    receipt['network_confinement'] = network
    receipt['namespace_ids'] = {name:os.readlink('/proc/self/ns/'+name) for name in ['pid','mnt','user','net']}
    receipt['process_start_ticks'] = Path('/proc/self/stat').read_text().split()[21]
    print(json.dumps(receipt,sort_keys=True))
    return 77 if interrupted else 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except BindingDenied as exc:
        print(json.dumps({'status':'denied','reason':str(exc),'provider_network_calls':0}))
        raise SystemExit(64)
