"""Local-HTTP scripted diagnostics only. Never loads provider credentials."""
from __future__ import annotations
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import threading
import shutil

from network_harness import REPO as ROOT
from study_controller import Controller, Hold, canonical, digest


class LocalProvider:
    def __init__(self, directory):
        self.directory = directory
        self.calls = []
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                raw = self.rfile.read(int(self.headers['Content-Length']))
                data = json.loads(raw)
                owner.calls.append({'path': self.path, 'sha256': digest(raw), 'request': data})
                with (owner.directory/'http-calls.jsonl').open('a') as f:
                    f.write(canonical(owner.calls[-1])+'\n')
                    f.flush(); os.fsync(f.fileno())
                if self.path == '/v1/responses/input_tokens':
                    result = {'object':'response.input_tokens', 'input_tokens':700}
                elif self.path == '/v1/responses':
                    phase = data['metadata']['step_id']
                    ctx = json.loads(data['input'][0]['content'])
                    if phase == 'final':
                        output = [{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps({'text':'Scripted transport diagnostic; no quality claim.'})}]}]
                    else:
                        index = 0 if phase == 'selection' else int(phase.rsplit('_',1)[1])-1
                        if index == 0:
                            decision = {'kind':'read_context','section':'messages'}
                        elif index == 1 and ctx.get('target_body') is None:
                            decision = {'kind':'publish_artifact','target':None,'body':{'title':'Scripted transport output',
                                'blocks':[{'block_id':'diagnostic','kind':'paragraph','checked':None,
                                           'text':'Scripted plumbing result, not research or usefulness evidence.'}]}}
                        else:
                            decision = {'kind':'reply','text':'Scripted diagnostic; human state retained.'}
                        value = {'goal':'Scripted mechanism check','success_criteria':[], 'decision':decision}
                        output = [{'type':'function_call','name':'choose_general_action','call_id':'call_'+phase,'arguments':json.dumps(value)}]
                    result = {'id':'resp_study_'+digest(raw)[:24],'object':'response','model':'gpt-6.1-sol',
                        'service_tier':'default','metadata':data['metadata'],'status':'completed','error':None,'output':output,
                        'usage':{'input_tokens':700,'output_tokens':200,'total_tokens':900,
                                 'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':50}}}
                else:
                    self.send_error(404)
                    return
                body = canonical(result).encode()
                self.send_response(200); self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        port_file = directory/'controlled-port.json'
        port = json.loads(port_file.read_text()) if port_file.exists() else 0
        self.server = ThreadingHTTPServer(('127.0.0.1',port), Handler)
        if not port_file.exists():
            port_file.write_text(json.dumps(self.server.server_port))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f'http://127.0.0.1:{self.server.server_port}'

    def close(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()



class ProductAdapter:
    """Durable remote-side receipt boundary. Unacknowledged sends stay unknown."""
    def __init__(self, directory, origin, *, live_bindings=None, credential=None):
        if live_bindings is not None or credential is not None:
            from study_transport import require_live_release
            require_live_release()
        self.live_bindings, self.credential = live_bindings, credential
        from study_binding import environment, validate_environment, validate_contexts
        from study_controller import load_schedule
        self.environment = environment()
        validate_environment(self.environment)
        self.live_mapping_sha256 = validate_contexts(live_bindings, load_schedule()[1]) if live_bindings is not None else None
        self.directory, self.origin = directory, origin
        self.db = sqlite3.connect(directory/'bridge.sqlite')
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS receipts(key TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL, result TEXT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS admission_binding(value TEXT NOT NULL)')
        binding = canonical({'environment':self.environment, 'live_mapping_sha256':self.live_mapping_sha256})
        with self.db:
            previous = self.db.execute('SELECT value FROM admission_binding').fetchone()
            if previous is None:
                if self.db.execute('SELECT 1 FROM receipts LIMIT 1').fetchone():
                    raise Hold('legacy_bridge_requires_new_campaign')
                self.db.execute('INSERT INTO admission_binding VALUES (?)',(binding,))
            elif previous[0] != binding:
                raise Hold('bridge_admission_binding_drift')
        self.drop_ack = False

    def observe(self, key):
        row = self.db.execute('SELECT * FROM receipts WHERE key=?', (key,)).fetchone()
        return json.loads(row['result']) if row and row['state'] == 'complete' else {'key':key, 'state':'unknown'}

    def call(self, key, operation, payload):
        from study_binding import validate_environment, validate_sources, validate_contexts
        from network_harness import inventory
        from study_controller import load_schedule
        validate_environment(self.environment)
        validate_sources({v:inventory(ROOT/('.local/batch3/b35b/baseline/workagent' if v=='B0' else 'backend/workagent')) for v in ('B0','B1','M1')})
        if self.live_bindings is not None and validate_contexts(self.live_bindings, load_schedule()[1]) != self.live_mapping_sha256:
            raise Hold('live_mapping_drift')
        body = canonical(payload)
        existing = self.db.execute('SELECT * FROM receipts WHERE key=?', (key,)).fetchone()
        if existing:
            if existing['payload'] != body:
                raise Hold('bridge_payload_drift')
            return self.observe(key)  # no retry, including when previous send is unknown
        with self.db:
            self.db.execute('INSERT INTO receipts VALUES (?,?,?,NULL)', (key, body, 'sending'))
        trial = payload['blind_id'] if operation == 'open_trajectory' else payload['trajectory']['id']
        variant = payload['variant'] if operation == 'open_trajectory' else payload['trajectory']['variant']
        if len(trial) != 24 or any(c not in '0123456789abcdef' for c in trial) or variant not in ('B0','B1','M1'):
            raise Hold('invalid_bridge_identity')
        slot = self.directory/trial
        slot.mkdir(exist_ok=True)
        source = ROOT/'.local/batch3/b35b/baseline' if variant == 'B0' else ROOT/'backend'
        if variant == 'B0':
            staged = slot/'baseline'
            if not staged.exists():
                shutil.copytree(source/'workagent', staged/'workagent', ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
                (slot/'runtime').mkdir()
                for name in ('general-responses-v1.json','general-b1-v1.json','bundles.py','__init__.py'):
                    shutil.copyfile(ROOT/'runtime'/name, slot/'runtime'/name)
            source = staged.resolve()
        env = {'PATH':os.environ['PATH'], 'HOME':os.environ['HOME'], 'PYTHONPATH':str(source)+':'+str(ROOT/'evaluation')+':'+str(ROOT),
               'PYTHONDONTWRITEBYTECODE':'1'}
        process = subprocess.run([str(ROOT/'backend/.venv/bin/python'), str(ROOT/'evaluation/study_application.py'), str(slot)],
            input=canonical({'operation':operation,'payload':payload,'controlled_origin':self.origin,'environment':self.environment,
                             'live_binding':self.live_bindings[trial] if self.live_bindings else None,
                             'credential':self.credential if operation=='execute' else None}),
            text=True, capture_output=True, cwd=ROOT, env=env, timeout=1200)
        (slot/(key+'.stderr')).write_text(process.stderr)
        if process.returncode:
            raise Hold('application_operation_unknown:' + str(slot/(key+'.stderr')))
        result = {'key':key,'state':'complete','payload_sha256':digest(body),'value':json.loads(process.stdout)}
        with self.db:
            self.db.execute("UPDATE receipts SET state='complete',result=? WHERE key=?", (canonical(result),key))
        if self.drop_ack:
            self.drop_ack = False
            raise ConnectionError('scripted_ack_lost_after_commit')
        return result

    def close(self):
        self.db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--stop-after',type=int)
    args = parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    os.chmod(args.output,0o700)
    provider = LocalProvider(args.output)
    adapter = ProductAdapter(args.output, provider.origin)
    controller = Controller(args.output/'controller.sqlite', adapter)
    try:
        result = controller.run(stop_after=args.stop_after)
        (args.output/'summary.json').write_text(canonical(result)+'\n')
        if result['collected_episodes'] == 72:
            export = args.output/'evaluation-packets'
            if not export.exists():
                controller.export_evaluation(export)
        print(canonical({k:v for k,v in result.items() if k!='episodes'}),flush=True)
    finally:
        controller.close(); adapter.close(); provider.close()

if __name__ == '__main__':
    main()
