"""Zero-provider actual-worker readiness launcher; never admits a paid request.
Mount only product, fixed dependencies, this entrypoint and one episode's inputs.
Read-only source/request/grant binding + a restarted restricted-SQL worker probe.
"""
from datetime import timedelta
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import shutil
import socket
from urllib.parse import urlparse
import sys
from types import SimpleNamespace
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
PREP = REPO/'.local/batch3/b35c/preparation'

def digest(p): return sha256(Path(p).read_bytes()).hexdigest()
def inventory(root):
    return {str(p.relative_to(root)):digest(p) for p in sorted(Path(root).rglob('*')) if p.is_file() and '__pycache__' not in str(p) and p.suffix != '.pyc'}
def save(p, value):
    with Path(p).open('x') as f: json.dump(value,f,sort_keys=True,indent=2);f.write('\n')

def jail(inputs, state, product):
    for p in (inputs,state,product):
        assert p.is_dir() and not p.is_symlink()
        assert not any(x.is_symlink() for x in p.rglob('*')), 'symlink_not_allowed'
    command = ['/usr/bin/bwrap','--unshare-all','--share-net','--die-with-parent','--new-session',
        '--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64',
        '--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/pycache','--clearenv','--setenv','PATH','/usr/bin',
        '--setenv','LANG','C.UTF-8','--setenv','HOME','/home/worker','--setenv','WORKAGENT_RESEARCH_ENABLED','1',
        '--ro-bind',str(Path.home()/'.cache/workagent/o200k_base.tiktoken'),'/home/worker/.cache/workagent/o200k_base.tiktoken',
        '--ro-bind',str(product),'/product/workagent',
        '--ro-bind',str(REPO/'backend/migrations'),'/product/migrations',
        '--ro-bind',str(REPO/'backend/requirements-office.lock'),'/product/requirements-office.lock',
        '--ro-bind',str(REPO/'backend/requirements-connectors.lock'),'/product/requirements-connectors.lock',
        '--ro-bind',str(REPO/'runtime/general-responses-v1.json'),'/runtime/general-responses-v1.json',
        '--ro-bind',str(REPO/'runtime/general-b1-v1.json'),'/runtime/general-b1-v1.json',
        '--ro-bind',str(REPO/'runtime/bundles.py'),'/runtime/bundles.py',
        '--ro-bind',str(REPO/'runtime/__init__.py'),'/runtime/__init__.py',
        '--ro-bind',str(REPO/'backend/.venv/lib/python3.12/site-packages'),'/deps',
        '--ro-bind',str(REPO/'evaluation/network_worker.py'),'/worker.py',
        '--ro-bind',str(inputs),'/inputs','--bind',str(state),'/state',
        '--ro-bind','/etc/resolv.conf','/etc/resolv.conf','--ro-bind','/etc/hosts','/etc/hosts',
        '--ro-bind','/etc/ssl/certs','/etc/ssl/certs','--chdir','/state',
        '--','/usr/bin/python3','-I','-B','-X','pycache_prefix=/pycache','/worker.py']
    return command

def binding_plan(out):
    schedule = json.loads((PREP/'evaluator/schedule.json').read_text())['trajectories']
    sources = {v: inventory(REPO/('.local/batch3/b35b/baseline/workagent' if v=='B0' else 'backend/workagent')) for v in ('B0','B1','M1')}
    rows=[]
    for trial in schedule:
        for ep in trial['episodes']:
            inputs=REPO/ep['input_directory']
            assert digest(inputs/'prompt.md')==ep['prompt_sha256']
            assert digest(REPO/ep['oracle_path'])==ep['oracle_sha256']
            rows.append({'blind_id':trial['blind_id'],'variant':trial['variant'],'episode':ep['episode'],
                'inputs':inventory(inputs),'input_directory':ep['input_directory'],
                'source_manifest_sha256':sha256(json.dumps(sources[trial['variant']],sort_keys=True).encode()).hexdigest(),
                'memory_recall':'reviewed-v1' if trial['variant']=='M1' else 'off',
                'status':'UNEXECUTED','provider_grant':None,'request_sha256':None,
                'binding_rule':'child verifies exact loaded source, grant, run_configuration and descriptors before worker; actual request bytes bound after build; no placeholder is send authority'})
    assert len(rows)==72 and len({r['blind_id'] for r in rows})==12
    save(out/'plan.json',{'paid_admission':False,'new_allocation_usd':'0','episodes':rows,'sources':sources,
        'normal_transport':{'input':50000,'output':8192,'model':'gpt-6.1-sol'},
        'scope':'original full A/B; these are prepared bindings, not execution receipts'})

def prepare(ctx,variant):
    from test_conversations import conversation, post
    from test_general_alpha_runtime import activate
    from test_memory_full_tools import config
    from workagent.adaptive import contract
    from workagent.capabilities import registry, policy, research_adapters as R
    from workagent.capabilities.models import ToolGrantV1, CapabilityPin
    from workagent.models import now, new_id
    from workagent.db import Database
    s,p,ws,_,admin=ctx
    cv=conversation(ctx)
    mode='reviewed-v1' if variant=='M1' else 'off'
    instructions,schema=contract(SimpleNamespace(**config(mode)['responses']))
    with patch('test_general_alpha_runtime.POLICY',instructions),patch('test_general_alpha_runtime.DECISION_SCHEMA',schema):
        pg=activate(ctx,cv,continuity_version='sustained-v1',max_steps=8,memory_recall=mode)
    # Exercise real current-episode ingress, but scripted outputs remain diagnostics.
    inputs=PREP/'public-inputs/B1/episode-1'
    ingress={'prompt':(inputs/'prompt.md').read_text(),
        'public_sources':[json.loads(p.read_text()) for p in sorted(inputs.glob('*.source.json'))]}
    message=json.dumps(ingress,ensure_ascii=False,sort_keys=True)
    q=post(ctx,cv,message)
    req=R.ResearchCapture(kind='research_capture',url='https://www.w3.org/WAI/tips/writing/',allow_browser=False)
    ds=[registry.adapters()[n].descriptor for n in ['research.capture','files.read_range','files.create_draft','artifacts.export']]
    tg=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=R.input_refs(req),effects=['read','draft','local_compute'],privacy_classes=['public','workspace_private'],egress='public_https',
        expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)
    policy.install(Database(admin),tg,limits={'local_compute':20,'rendering':5,'extraction':10},provider_grant_id=pg.id)
    with s.db.transaction() as c:
        cfg=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
    return {'transport':'synthetic','dsn':str(s.db.dsn),'variant':variant,'principal':p.id,'workspace':ws,'run_id':q.run.id,
        'grant_id':pg.id,'grant':pg.model_dump(mode='json'),'run_configuration':cfg,'tool_grant':tg.model_dump(mode='json'),
        'descriptors':{d.id:d.model_dump(mode='json') for d in ds},'url':req.url,'controller_pid':os.getpid(),
        'ingress_sha256':sha256(message.encode()).hexdigest()},q

def readiness(out):
    sys.path[:0]=[str(REPO/'backend'),str(REPO/'backend/tests')]
    from test_domain import context
    from test_runtime import expire
    listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1)
    forbidden_port=listener.getsockname()[1]
    dependencies=inventory(REPO/'backend/.venv/lib/python3.12/site-packages')
    assert not any('__pycache__' not in str(p) for p in (REPO/'backend/.venv/lib/python3.12/site-packages').rglob('*.pyc')), 'sourceless_dependency_bytecode'
    execution_files={'/usr/bin/python3':digest(Path('/usr/bin/python3').resolve()),
        '/worker.py':digest(REPO/'evaluation/network_worker.py'),
        '/home/worker/.cache/workagent/o200k_base.tiktoken':digest(Path.home()/'.cache/workagent/o200k_base.tiktoken')}
    execution_files.update({'/product/migrations/'+p.name:digest(p) for p in (REPO/'backend/migrations').glob('*.sql')})
    for name in ['general-responses-v1.json','general-b1-v1.json','bundles.py','__init__.py']:
        execution_files['/runtime/'+name]=digest(REPO/'runtime'/name)
    for name in ['requirements-office.lock','requirements-connectors.lock']:
        execution_files['/product/'+name]=digest(REPO/'backend'/name)
    # Bind system Python sources/extensions actually available, not ambient pyc.
    execution_files.update({str(p):digest(p) for p in Path('/usr/lib/python3.12').rglob('*') if p.is_file() and not p.is_symlink() and '__pycache__' not in str(p) and p.suffix!='.pyc'})
    save(out/'execution-environment.json',{'files':execution_files,'dependencies':dependencies,
        'launcher_sha256':digest(REPO/'evaluation/network_harness.py'),'bwrap_sha256':digest('/usr/bin/bwrap'),
        'kernel':subprocess.check_output(['uname','-srvm'],text=True).strip()})
    forbidden={'oracle':str(PREP/'evaluator/oracles/B1/episode-1.json'),
        'evaluator_authoring':str(PREP/'evaluator/authoring.py'),
        'future_episode':str(PREP/'public-inputs/B1/episode-4/prompt.md'),
        'host_proc_root':'/proc/1/root'+str(PREP/'evaluator/oracles/B1/episode-1.json'),
        'host_environment':f'/proc/{os.getpid()}/environ','parent_fd':f'/proc/{os.getpid()}/fd/0',
        'operator_home':'/home/ubuntu/.hermes/config.yaml','repo':str(REPO/'AGENTS.md')}
    # A real readable evaluator canary opened in controller tests fd/process escape.
    with (PREP/'evaluator/oracles/B1/episode-1.json').open('rb') as canary:
        assert canary.read(1)
        for variant in ['B1','M1']:
            slot=out/variant;slot.mkdir();state=slot/'state';state.mkdir(mode=0o700)
            ctx=context.__wrapped__();cfg,q=prepare(ctx,variant)
            staged=slot/'product'
            shutil.copytree(REPO/'backend/workagent',staged,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
            db_port=urlparse(cfg['dsn']).port or 5432
            assert forbidden_port not in [443,db_port]
            cfg.update(forbidden_paths=forbidden,source_manifest=inventory(staged),execution_files=execution_files,dependencies=dependencies,
                allowed_tcp_ports=[443,db_port],forbidden_listener_port=forbidden_port)
            inputs=PREP/'public-inputs/B1/episode-1'
            command=jail(inputs,state,staged)
            save(slot/'launch-binding.json',{k:v for k,v in cfg.items() if k!='dsn'})
            save(slot/'command.json',command)
            # Fail closed on mismatches before any provider slot is consumed.
            for bad,field,reason in [('wrong-source','source_manifest','loaded_source_drift'),('wrong-grant','grant','grant_binding_drift'),('wrong-descriptor','descriptors','descriptor_binding_drift'),('wrong-run','run_configuration','run_configuration_drift')]:
                tampered=json.loads(json.dumps(cfg))
                if field=='source_manifest':tampered[field]['__init__.py']='0'*64
                elif field=='grant':tampered[field]['consumer_sha256']='0'*64
                elif field=='descriptors':tampered[field]['research.capture']['implementation_sha256']='0'*64
                else:tampered[field]['consumer_sha256']='0'*64
                p=subprocess.run(command,input=json.dumps(tampered),text=True,capture_output=True,timeout=45,close_fds=True)
                (slot/(bad+'.stderr')).write_text(p.stderr)
                (slot/(bad+'.stdout')).write_text(p.stdout)
                assert p.returncode==64 and json.loads(p.stdout)['reason']==reason, (bad,p.stderr[-1000:])
            with ctx[0].db.transaction() as c:
                assert c.execute('SELECT count(*) n FROM provider_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['n']==0
            ready_seen=False
            for visit in range(20):
                cfg['interrupt']=visit==0
                p=subprocess.run(command,input=json.dumps(cfg),text=True,capture_output=True,timeout=180,close_fds=True)
                (slot/f'visit-{visit}.stdout').write_text(p.stdout);(slot/f'visit-{visit}.stderr').write_text(p.stderr)
                assert p.returncode in (0,77),(p.returncode,p.stderr[-4000:])
                result=json.loads(p.stdout)
                assert all(result['denials'].values())
                if ready_seen:
                    assert result['state']=='ready' and not result['synthetic_calls'],'duplicate send'
                    break
                if result['state']=='ready':
                    ready_seen=True
                    continue
                assert result['state'] in ('interrupted','running')
                # Only expire a disposable fixture lease after proving no unmatched I/O.
                with ctx[0].db.transaction() as c:
                    events=c.execute('SELECT phase,kind FROM responses_events WHERE attempt_id IN (SELECT id FROM provider_attempts WHERE run_id=%s)',(q.run.id,)).fetchall()
                for phase in {r['phase'] for r in events}:
                    kinds={r['kind'] for r in events if r['phase']==phase}
                    assert ('count_send' not in kinds or 'count_result' in kinds) and ('dispatch' not in kinds or 'result' in kinds)
                expire(ctx,q.run.id) # disposable synthetic fixture, never installed authority
            else:
                raise AssertionError('diagnostic_visits_exhausted_not_success')
            s,principal,ws,_,_=ctx
            with s.db.transaction() as c:
                steps=c.execute('SELECT request_bytes,request_sha256,count_bytes,count_sha256 FROM responses_steps WHERE attempt_id IN (SELECT id FROM provider_attempts WHERE run_id=%s) ORDER BY phase',(q.run.id,)).fetchall()
                obs=c.execute("SELECT e.data FROM tool_attempt_events e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='observation' ORDER BY e.created_at",(q.run.id,)).fetchall()
                snaps=c.execute('SELECT count(*) n FROM source_snapshots WHERE workspace_id=%s',(ws,)).fetchone()['n']
            assert snaps==1
            for row in steps:
                assert sha256(row['request_bytes'].encode()).hexdigest()==row['request_sha256']
                assert sha256(row['count_bytes'].encode()).hexdigest()==row['count_sha256']
                assert json.loads(row['request_bytes'])['max_output_tokens']==8192
            first=json.loads(steps[0]['request_bytes'])
            request_context=json.loads(first['input'][0]['content'])
            incoming=next(m['text'] for m in request_context['messages'] if m['author_kind']=='human')
            assert sha256(incoming.encode()).hexdigest()==cfg['ingress_sha256'], 'actual_input_not_in_request'
            save(slot/'requests.json',steps)
            save(slot/'observations.json',obs)
            export=next(o['data']['output']['result']['export_id'] for o in obs if o['data'].get('output',{}).get('result',{}).get('export_id'))
            manifest,raw=s.download_export(principal,ws,export)
            assert sha256(raw).hexdigest()==manifest.blob.sha256
            (slot/'download.md').write_bytes(raw)
            save(slot/'proof.json',{'variant':variant,'requests':len(steps),'snapshots':snaps,'download_sha256':manifest.blob.sha256,
                'source_bound':True,'provider_network_calls':0,'live_AB_episodes':0,'restart':True,'replay_no_send':True,
                'readiness_only':True,'isolation':'mount+PID+user+IPC+UTS+cgroup namespaces, clear env, closed inherited fds; shared network for SQL and public HTTPS',
                'input_ingress_sha256':cfg['ingress_sha256'],
                'not_claimed':'IP firewall; TCP443 and SQL port allowed, UDP DNS available; no evaluator service on allowed ports'})
    listener.close()
    save(out/'PASS.json',{'kind':'zero-provider-networked-worker-readiness','variants':['B1','M1'],'paid_calls':0,'live_AB_episodes':0})

if __name__=='__main__':
    out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=False)
    binding_plan(out)
    readiness(out)
    print(json.dumps({'result':'PASS','output':str(out),'provider_calls':0,'AB_episodes':0}))
