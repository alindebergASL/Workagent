#!/usr/bin/env python3
"""Supported loopback live stack, supervised by user systemd; no provider-route fallback.

Provision the database, authority and private worker state explicitly beforehand.
Stopping/restarting services never recreates or deletes any of those resources.
This launcher neither installs grants nor changes their historical bindings.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import urllib.request

COMPONENTS = ('api', 'worker', 'web')


def absolute(value):
    p = Path(value)
    if not p.is_absolute() or '..' in p.parts or any(x in str(p) for x in ('\n','\r','%','$','"','\\')):
        raise ValueError('absolute non-traversing paths required')
    return p


def private(path, directory=False):
    p = absolute(path)
    st = p.stat()
    if p.is_symlink() or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise ValueError('private owner-only resource required')
    if not (p.is_dir() if directory else p.is_file()):
        raise ValueError('resource type mismatch')
    return p


def load_config(path):
    c = json.loads(private(path).read_text())
    expected = {'name','root','python','node','env_file','authority_record','state_dir','workspace','grant_id','api_port','web_port'}
    if set(c) != expected:
        raise ValueError('explicit service configuration fields required')
    if not re.fullmatch(r'workagent-[a-z0-9-]{1,48}',c['name']):
        raise ValueError('invalid service name')
    for key in ('workspace','grant_id'):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}',c[key]):
            raise ValueError('invalid scope')
    for key in ('root','python','node','env_file','authority_record','state_dir'):
        if not absolute(c[key]).exists():
            raise ValueError('required retained resource missing')
    private(c['env_file']); private(c['state_dir'],directory=True)
    for key in ('api_port','web_port'):
        if type(c[key]) is not int or not 1024<=c[key]<=65535:
            raise ValueError('invalid loopback port')
    if c['api_port']==c['web_port']:
        raise ValueError('ports must differ')
    return c


def environment(c, component):
    # Allowlist, not ambient environment inheritance. Provider credential is read
    # only by the canonical worker from its explicitly approved file reference.
    e = {k:os.environ[k] for k in ('PATH','HOME','LANG','TZ') if k in os.environ}
    values = {}
    for line in private(c['env_file']).read_text().splitlines():
        words = shlex.split(line,comments=True)
        if words and words[0]=='export':words=words[1:]
        if not words:continue
        if len(words)!=1 or '=' not in words[0]:raise ValueError('invalid environment file')
        k,v=words[0].split('=',1); values[k]=v
    keys = ('LOCAL_BEARER_TOKEN','LOCAL_PRINCIPAL_ID')
    if component!='web':keys+=('DATABASE_URL',)
    e.update({k:values[k] for k in keys if k in values})
    if len(e.get('LOCAL_BEARER_TOKEN',''))<32 or (component!='web' and not e.get('DATABASE_URL')):
        raise ValueError('runtime credentials missing')
    e.update(LOCAL_TEST_MODE='true',WORKAGENT_FIXTURE_MODE='false',PYTHONUNBUFFERED='1',
        WORKAGENT_WEB_ORIGIN=f"http://127.0.0.1:{c['web_port']}",
        FRONTEND_ORIGIN=f"http://127.0.0.1:{c['web_port']}",
        WORKAGENT_BACKEND_URL=f"http://127.0.0.1:{c['api_port']}",
        NEXT_PUBLIC_WORKAGENT_API_BASE='/api/domain',
        NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION='1')
    if component!='web':
        e['WORKAGENT_EXECUTION_STATUS']=str(Path(c['state_dir'])/'execution.json')
    return e


def command(c, component, once=False):
    root=Path(c['root']); py=c['python']
    if component=='api':
        argv=[py,'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port',str(c['api_port']),'--no-access-log']
    elif component=='worker':
        argv=[py,'-m','workagent.responses_dispatcher','--general-responses',
            '--workspace',c['workspace'],'--grant-id',c['grant_id'],
            '--authority-record',c['authority_record'],'--state-dir',c['state_dir'],
            '--once' if once else '--serve']
    elif component=='web':
        argv=[c['node'],str(root/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',str(c['web_port'])]
    else:raise ValueError('unknown component')
    return argv,root/('web' if component=='web' else 'backend'),environment(c,component)


def build_command(c):
    """Next public capabilities are compile-time, not start-time settings.

    Compile the owner's existing frontend against the real domain contract.
    Neither database, human bearer nor provider credentials belong in a build.
    """
    root=Path(c['root'])
    allowed=('PATH','HOME','LANG','TZ','NEXT_PUBLIC_WORKAGENT_API_BASE',
             'NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION')
    env={k:v for k,v in environment(c,'web').items() if k in allowed}
    return [c['node'],str(root/'web/node_modules/next/dist/bin/next'),'build','--webpack'],root/'web',env


def units(c, path):
    name=c['name']; root=Path(c['root'])
    launcher=root/'scripts/dev_service.py'
    def quote(v):return '"'+str(v)+'"'
    common=f"[Unit]\nPartOf={name}.target\nAfter=network.target\nStartLimitIntervalSec=0\n[Service]\nType=simple\nRestart=always\nRestartSec=5\nUMask=0077\nNoNewPrivileges=true\nTimeoutStopSec=30\nKillMode=control-group\n"
    out={f'{name}.target':f"[Unit]\nDescription=Workagent private development runtime\nWants={' '.join(name+'-'+x+'.service' for x in COMPONENTS)}\n[Install]\nWantedBy=default.target\n"}
    for component in COMPONENTS:
        out[f'{name}-{component}.service']=common+'ExecStart='+ ' '.join(map(quote,[c['python'],launcher,'run','--config',path,'--component',component]))+'\n'
    return out


def control(*args):
    subprocess.run(['systemctl','--user',*args],check=True)


def status(c):
    services={}
    for component in COMPONENTS:
        p=subprocess.run(['systemctl','--user','is-active',c['name']+'-'+component+'.service'],capture_output=True,text=True)
        services[component]=p.stdout.strip()
    e=environment(c,'api')
    headers={'Authorization':'Bearer '+e['LOCAL_BEARER_TOKEN'],'X-Schema-Version':'workagent/v1','X-Request-Id':'development-readiness'}
    url=f"http://127.0.0.1:{c['api_port']}/v1/workspaces/{c['workspace']}/execution"
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=5) as response:
            execution=json.load(response)
    except Exception:
        execution={'can_advance_authorized_work':False,'state':'unavailable'}
    # Process liveness alone never satisfies readiness. Authenticated runtime
    # authority + fresh dispatcher progress are required independently.
    return {'services':services,'ready':all(v=='active' for v in services.values()) and execution.get('can_advance_authorized_work') is True,'execution':execution}


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['build','install','start','stop','restart','status','run'])
    p.add_argument('--config',type=Path,required=True)
    p.add_argument('--component',choices=COMPONENTS)
    p.add_argument('--once',action='store_true',help='One canonical worker visit for diagnosis; no alternate executor')
    a=p.parse_args(); path=absolute(a.config); c=load_config(path)
    if a.action=='build':
        argv,cwd,env=build_command(c)
        subprocess.run(argv,cwd=cwd,env=env,check=True)
    elif a.action=='run':
        if not a.component or (a.once and a.component!='worker'):raise ValueError('component required')
        argv,cwd,env=command(c,a.component,a.once)
        os.chdir(cwd);os.execvpe(argv[0],argv,env)
    elif a.action=='install':
        destination=Path.home()/'.config/systemd/user';destination.mkdir(parents=True,exist_ok=True)
        for name,text in units(c,path).items():
            dest=destination/name
            if dest.exists() and dest.read_text()!=text:raise ValueError('existing unit differs; inspect before replacement')
        for name,text in units(c,path).items():
            (destination/name).write_text(text)
        control('daemon-reload')
        print(json.dumps({'installed':c['name'],'started':False,'resources_retained':True}))
    elif a.action=='status':
        result=status(c);print(json.dumps(result));return 0 if result['ready'] else 2
    elif a.component:
        control(a.action,c['name']+'-'+a.component+'.service')
    elif a.action in ('stop','restart'):
        # Waiting only on the target can return while PartOf services still
        # stop. Account/identity changes require every named service quiescent.
        control('stop',c['name']+'.target',*[c['name']+'-'+x+'.service' for x in COMPONENTS])
        if a.action=='restart':control('start',c['name']+'.target')
    else:
        control('start',c['name']+'.target')
    return 0


if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        # No exception strings: configuration may contain DSNs or bearer values.
        print(json.dumps({'state':'blocked','failure_category':'development_service_configuration'}),file=sys.stderr)
        sys.exit(2)
