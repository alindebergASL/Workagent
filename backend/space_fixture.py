"""Reproducible disposable Space journey; no live transport is constructed.

launch creates a NEW dev_db database, seeds an empty synthetic workspace, starts
loopback API + production web, runs the browser/HTTP/PTY journey, and stops both.
Fixture work uses the existing explicitly synthetic httpx.MockTransport factory.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import time
import uuid

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/'.local/budget-preparation/space-fixes'
LEGACY_EVIDENCE=ROOT/'.local/budget-preparation/space-implementation'
PYTHON=ROOT/'backend/.venv/bin/python'


def environment(directory):
    if not any(directory.resolve().is_relative_to(root.resolve()) for root in (EVIDENCE,LEGACY_EVIDENCE)):
        raise RuntimeError('Fixture directory must be in the owned Space evidence area')
    env=os.environ.copy()
    env.pop('PYTHONPATH',None); env.pop('PYTHONHOME',None)
    for line in (directory/'disposable.env').read_text().splitlines():
        key,value=shlex.split(line.removeprefix('export '))[0].split('=',1)
        env[key]=value
    # This file is created only by launch/dev_db, never supplied from retained state.
    marker=json.loads((directory/'fixture.json').read_text())
    if env['DATABASE_URL'].rsplit('/',1)[-1]!=marker['database'] or not marker['database'].startswith('workagent_test_'):
        raise RuntimeError('Disposable fixture identity mismatch')
    env.update(WORKAGENT_OPERATOR_JOURNAL=str(directory/'commands'),
        WORKAGENT_WORKSPACE=marker['workspace'],WORKAGENT_OPERATOR_URL=marker['api'],
        WORKAGENT_BACKEND_URL=marker['api'],WORKAGENT_WEB_ORIGIN=marker['web'],FRONTEND_ORIGIN=marker['web'],
        NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION='1',NEXT_PUBLIC_WORKAGENT_API_MODE='real')
    return env,marker


def port():
    with socket.socket() as s: s.bind(('127.0.0.1',0)); return s.getsockname()[1]


def launch():
    directory=EVIDENCE/('journey-'+uuid.uuid4().hex[:10]); directory.mkdir(parents=True)
    env=os.environ.copy(); env.pop('PYTHONPATH',None); env.pop('PYTHONHOME',None)
    from dev_db import provision
    database=provision(directory/'disposable.env')
    marker={'database':database,'workspace':'space-fixture-'+uuid.uuid4().hex[:10],
        'api':f'http://127.0.0.1:{port()}','web':f'http://127.0.0.1:{port()}',
        'evidence':'CONTROLLED SYNTHETIC FIXTURE, NOT MODEL USEFULNESS','provider_network_calls':0}
    (directory/'fixture.json').write_text(json.dumps(marker,indent=2))
    env,marker=environment(directory); os.environ.update(env)
    from workagent.fixture import seed
    seed(env['MIGRATION_DATABASE_URL'],[],marker['workspace'])
    children=[]; handles=[]
    try:
        for name,command,cwd in [
            ('api',[str(PYTHON),'-m','uvicorn','workagent.api:create_app','--factory','--host','127.0.0.1','--port',marker['api'].rsplit(':',1)[-1]],ROOT/'backend'),
            ('web',['node',str(ROOT/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',marker['web'].rsplit(':',1)[-1]],ROOT/'web')]:
            log=(directory/(name+'.log')).open('w'); handles.append(log)
            children.append(subprocess.Popen(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT))
        from workagent.operator_client import OperatorClient
        import urllib.request
        for _ in range(100):
            try:
                OperatorClient().run(marker['workspace'],'areas',[])
                urllib.request.urlopen(marker['web'],timeout=2).close(); break
            except Exception:
                if any(p.poll() is not None for p in children): raise RuntimeError('Owned local service exited; inspect logs')
                time.sleep(.2)
        else: raise RuntimeError('Local services did not become ready')
        subprocess.run([str(PYTHON),str(ROOT/'backend/space_replay_check.py'),str(directory)],cwd=ROOT/'backend',env=env,check=True)
        result=subprocess.run(['node','scripts/space-journey.mjs',str(directory)],cwd=ROOT/'web',env=env)
        if result.returncode: raise RuntimeError('Controlled journey failed; inspect evidence')
        print('CONTROLLED journey passed:',directory)
    finally:
        for child in children:
            child.terminate()
        for child in children:
            try: child.wait(timeout=8)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        for h in handles: h.close()
        (directory/'process-cleanup.json').write_text(json.dumps({'owned_pids':[p.pid for p in children],'exit_codes':[p.returncode for p in children],'stopped':all(p.poll() is not None for p in children)},indent=2))


def action(directory,action,identifier=None,variant=None):
    env,marker=environment(directory); os.environ.update(env)
    if action=='pty':
        import pty,fcntl,termios,struct,select
        master,slave=pty.openpty(); env['TERM']='xterm-256color'
        proc=subprocess.Popen([str(PYTHON),'-m','workagent.operator_tui','interactive'],stdin=slave,stdout=slave,stderr=slave,env=env,cwd=ROOT/'backend')
        os.close(slave); chunks=[]
        def drain(seconds):
            until=time.monotonic()+seconds
            while time.monotonic()<until:
                if select.select([master],[],[],.1)[0]:
                    try: chunks.append(os.read(master,65536))
                    except OSError: break
        try:
            fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',30,110,0,0)); drain(.8)
            os.write(master,b'\x1b[B\n'); drain(.5)
            os.write(master,(':use '+identifier+'\n').encode()); drain(.5)
            os.write(master,b':prompt "CONTROLLED PTY: confirm the saved scope without execution"\n'); drain(.6)
            os.write(master,b'r'); drain(.5)
            fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',15,45,0,0)); os.kill(proc.pid,28); drain(.3)
            os.write(master,b'q'); proc.wait(timeout=5); drain(.2)
            transcript=b''.join(chunks).decode(errors='replace')
            (directory/'tui-pty.txt').write_text(transcript)
            from workagent.operator_client import OperatorClient
            detail=OperatorClient().run(marker['workspace'],'show',[identifier])
            admitted=[m for m in detail['messages'] if m['author_kind']=='human' and m['text']=='CONTROLLED PTY: confirm the saved scope without execution']
            assert proc.returncode==0 and 'admission_only' in transcript and len(admitted)==1, f'PTY verification failed (exit {proc.returncode}); inspect tui-pty.txt'
            (directory/'tui-pty-readback.json').write_text(json.dumps({'conversation_id':identifier,'message':admitted[0],'turns':detail['turns']},indent=2))
            print(json.dumps({'pty_exit':proc.returncode,'resize':[45,15],'actual_http_prompt':True}))
        finally:
            if proc.poll() is None: proc.kill(); proc.wait()
            os.close(master)
        return
    # Existing test fixture authority, ONLY a new disposable synthetic grant.
    sys.path.insert(0,str(ROOT/'backend/tests'))
    from test_general_alpha_runtime import activate,AlphaProvider
    from test_general_responses import worker
    from workagent.service import Service,Principal
    from workagent.db import Database
    service=Service(Database()); principal=Principal('local-human'); ws=marker['workspace']
    context=(service,principal,ws,[],env['MIGRATION_DATABASE_URL'])
    if action=='activate':
        cv=service.get_conversation(principal,ws,identifier).conversation
        grant=activate(context,cv)
        print(json.dumps({'fixture_only':True,'conversation_id':cv.id,'grant_id':grant.id}))
    elif action=='work':
        run=service.get_run(principal,ws,identifier)
        assert run.profile=='general-responses-v1' and run.state=='queued'
        detail=service.get_conversation(principal,ws,run.conversation_id)
        message=next(m for m in detail.messages if m.run_id==identifier and m.author_kind=='human')
        if message.target:
            artifact=service.get_artifact(principal,ws,message.target.artifact_id)
            body=artifact.current_revision.body.model_dump(mode='json')
        else:
            body={'title':'Synthetic service launch offer','blocks':[
                {'block_id':'offer','kind':'paragraph','checked':None,'text':'CONTROLLED FIXTURE: A two-week service design pilot for independent studios. Deliver one offer page and one onboarding interview; exclude ongoing support.'},
                {'block_id':'rationale','kind':'paragraph','checked':None,'text':'Rationale: a narrow pilot limits delivery risk while testing whether clients value the outcome. Interview three prospective clients before quoting a fixed fee.'},
                {'block_id':'human','kind':'paragraph','checked':None,'text':'Human constraints: no weekend work; no promises of revenue.'}]}
        if variant == 'table':
            body={'kind':'structured_table','version':'structured-table/v1','title':'Pilot next actions','notes':[],
                'fields':[{'key':'audience','label':'Audience','type':'text','editable':True,'unit':None,'scale':None,'enum':None},
                          {'key':'scope','label':'Scope','type':'text','editable':True,'unit':None,'scale':None,'enum':None},
                          {'key':'action','label':'Next action','type':'text','editable':True,'unit':None,'scale':None,'enum':None}],
                'rows':[{'row_id':'pilot','cells':[{'field_key':'audience','value':'Independent studios'},
                    {'field_key':'scope','value':'Bounded one-week pilot, never weekend support'},
                    {'field_key':'action','value':'Interview three prospective clients before quoting a fixed fee.'}]}]}
        elif variant: body['blocks'][0]['text']='CONTROLLED FIXTURE: '+variant+' service design pilot. One offer page, no ongoing support and no weekend work.'
        decision={'kind':'publish_artifact','target':message.target.model_dump(mode='json') if message.target else None,'body':body,
            'work_area':{'title':'Synthetic service launch','goal':'Develop a bounded offer and validate demand before launch','kind':'project'}}
        from workagent.composition import AlphaDecision
        AlphaDecision.model_validate({'goal':'Controlled fixture','success_criteria':[],'decision':decision})
        fake=AlphaProvider([decision],explanation='CONTROLLED FIXTURE: a narrow pilot limits delivery risk; validate demand before committing. Saved work is a draft, not a verified business outcome.')
        result=worker(context,fake,directory).work(principal,ws,identifier)
        assert result.state=='partial'
        # Request metadata and counts, never credentials or request headers.
        (directory/('controlled-'+identifier+'.json')).write_text(json.dumps({'run_id':identifier,'state':result.state,'transport':'httpx.MockTransport only','fixture_decision':decision,'calls':fake.calls},indent=2))
        print(json.dumps({'run_id':identifier,'state':result.state,'transport':'controlled_mock_only'}))
    else: raise RuntimeError('Unknown fixture action')


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('action',choices=['launch','activate','work','pty']); p.add_argument('--directory',type=Path); p.add_argument('identifier',nargs='?'); p.add_argument('--variant')
    a=p.parse_args()
    if a.action=='launch': launch()
    else: action(a.directory,a.action,a.identifier,a.variant)
