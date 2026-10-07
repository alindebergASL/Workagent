#!/usr/bin/env python3
"""Isolated adaptive product QA: real HTTP/PostgreSQL/Wasmtime; synthetic provider ONLY.

Existing saved demo on 3000/8000 is never touched. New fixture env/output required
for prepare; run/reopen retain exactly that DB. No key lookup or live transport.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'backend/tests'), str(ROOT / 'scripts')]
from workagent.db import Database
from workagent.service import Service, Principal
from verify_general_model_journey import dump, owner_dsn, _stack

environment, Stack, PYTHON, run = _stack.environment, _stack.Stack, _stack.PYTHON, _stack.run

WS = 'local-workspace'
ORIGIN = 'http://127.0.0.1:3120'
ASK = 'Build an invoice-total calculator multiplying quantity by unit price in cents. Test 3 items at 1250 cents. Give me a usable tool.'
FOLLOW = 'For nonnegative quantities, use repeated addition instead of multiplication. Preserve my human note and propose the change rather than replacing my saved version.'
NOTE = 'Human: these prices are cents; keep this note.'


def env_for(path):
    env = environment(path)
    env.update(WORKAGENT_WEB_ORIGIN=ORIGIN, WORKAGENT_BACKEND_URL='http://127.0.0.1:8120')
    env['NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION']='1'
    return env


def context(env, path=None):
    db = Database(env['DATABASE_URL']); db.check_runtime_role()
    return Service(db), Principal(env['LOCAL_PRINCIPAL_ID']), WS, [], owner_dsn(path) if path else None


class IsolatedStack(Stack):
    def start(self, worker=False):
        assert not worker
        for port in (3120, 8120):
            with socket.socket() as s:
                if s.connect_ex(('127.0.0.1', port)) == 0:
                    raise RuntimeError(f'Port {port} occupied; no process changed')
        logs = ROOT / '.local/adaptive-stack'; logs.mkdir(parents=True, exist_ok=True)
        commands = [('api', [PYTHON, '-m', 'uvicorn', 'workagent.api:app', '--host', '127.0.0.1', '--port', '8120', '--no-proxy-headers'], ROOT/'backend'),
                    ('web', ['pnpm', 'exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', '3120'], ROOT/'web')]
        for name, command, cwd in commands:
            log = (logs/f'{name}.log').open('ab'); self.logs.append(log)
            self.children.append(subprocess.Popen([str(x) for x in command], cwd=cwd, env=self.env, stdout=log, stderr=log, start_new_session=True))
        deadline = time.monotonic()+45
        while time.monotonic() < deadline:
            if any(p.poll() is not None for p in self.children):
                raise RuntimeError('Owned service exited; inspect private adaptive-stack logs')
            try:
                request = urllib.request.Request(ORIGIN+'/api/domain/v1/workspaces', headers={'X-Workagent-Client':'local-ui'})
                with urllib.request.urlopen(request, timeout=2) as response:
                    if response.status == 200 and json.load(response)['items']: return
            except (OSError, ValueError, KeyError):
                time.sleep(.2)
        raise RuntimeError('Readiness deadline exceeded')


def install(path, out, env):
    from test_adaptive_execution import activate
    s,p,ws,_,admin = ctx = context(env,path)
    ids = json.loads((out/'conversation-ids.json').read_text())
    assert set(ids)=={'tool'} and not (out/'grant.json').exists()
    d = s.get_conversation(p,ws,ids['tool']); assert not d.messages and not d.runs
    grant = activate(ctx,d.conversation)
    assert grant.responses.transport_mode=='synthetic'
    from workagent.responses_dispatcher import general_status
    actual = general_status(s.db,ws,grant.id)
    assert actual['active'] and actual['conversation_ids']==[ids['tool']]
    dump(out/'grant.json',{'grant_id':grant.id,'mode':'synthetic','status':actual,'admission_setup':'Operator-scoped after real conversation create; not automatic standing authority.'})


def consume(env,out):
    from test_adaptive_execution import AdaptiveProvider
    from workagent.general_worker import GeneralWorker
    from workagent.responses_dispatcher import ResponsesDispatcher, serve, general_status
    class RecordedFixture(AdaptiveProvider):
        def __init__(self):
            super().__init__(); self.events=[]
        def handle(self,request):
            assert request.url.host=='synthetic.invalid'
            body=json.loads(request.content) if request.method=='POST' else None
            phase=body.get('metadata',{}).get('step_id') if body else None
            if phase=='selection_2' and request.url.path.endswith('/responses'): time.sleep(2)
            result=super().handle(request)
            if body and request.url.path.endswith('/responses') and phase != 'final':
                ctx=self.contexts[-1]
                message=next(m for m in ctx['messages'] if m['run_id']==ctx['run_id'] and m['author_kind']=='human')
                if message.get('target') and ctx.get('adaptive',{}).get('observations'):
                    import httpx
                    payload=result.json(); call=payload['output'][0]; value=json.loads(call['arguments'])
                    value['decision']['code']='(module (func (export "total") (param $q i64) (param $p i64) (result i64) (local $r i64) (block $done (loop $add local.get $q i64.eqz br_if $done local.get $r local.get $p i64.add local.set $r local.get $q i64.const 1 i64.sub local.set $q br $add)) local.get $r))'
                    call['arguments']=json.dumps(value); self.responses[payload['id']]=payload
                    result=httpx.Response(200,json=payload)
            self.events.append({'method':request.method,'path':request.url.path,'phase':phase})
            dump(out/'transport.json',{'mode':'synthetic_mock_transport_not_model_intelligence','live_provider_calls':0,'events':self.events,'contexts':self.contexts})
            return result
    s,*_=context(env); fake=RecordedFixture()
    worker=GeneralWorker(s,transport=fake.transport(),state=out/'private-state',enable_responses=True)
    grant=json.loads((out/'grant.json').read_text())['grant_id']
    dispatcher=ResponsesDispatcher(worker,workspace=WS,grant_id=grant)
    def verify():
        actual=general_status(s.db,WS,grant)
        assert actual['active'] and actual['mode']=='synthetic'
    serve(dispatcher,verify,.15)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['prepare','install','consume','run','serve','status'])
    parser.add_argument('--env',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    a=parser.parse_args(); path=a.env.resolve();out=a.output.resolve()
    if a.mode=='prepare':
        assert not path.exists() and not out.exists(), 'Fresh fixture only; no reset'
        out.mkdir(parents=True,mode=0o700)
        env=env_for(path)
        dump(out/'manifest.json',{'mode':'synthetic_provider_real_local_execution','live_provider_calls':0,'origin':ORIGIN,'prompt':ASK,'followup':FOLLOW,'human_note':NOTE})
        print('Prepared NEW isolated adaptive fixture; no provider calls');return
    assert path.exists() and (out/'manifest.json').exists()
    env=env_for(path)
    if a.mode=='install': install(path,out,env);return
    if a.mode=='consume': consume(env,out);return
    if a.mode=='status':
        from workagent.responses_dispatcher import general_status
        s,*_=context(env);grant=json.loads((out/'grant.json').read_text())['grant_id']
        dump(out/'status.json',general_status(s.db,WS,grant));print('Retained status read back');return
    stack=IsolatedStack(env)
    try:
        stack.start()
        if a.mode=='serve':
            print('Isolated review service ready at '+ORIGIN,flush=True)
            while all(p.poll() is None for p in stack.children):time.sleep(1)
        else:
            run(['node',ROOT/'scripts/verify_adaptive_product.mjs',out,path],env=env)
            stack.stop();stack.start()
            run(['node',ROOT/'scripts/verify_adaptive_product.mjs',out,path,'reopen'],env=env)
            print('PASS: adaptive desktop/mobile journey and actual process restart')
    finally:stack.stop()

if __name__=='__main__':
    try: main()
    except KeyboardInterrupt: pass
