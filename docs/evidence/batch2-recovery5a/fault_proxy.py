"""Test-only loopback fault proxy: commits one real POST, drops only its ACK.
No model responses are synthesized; every forwarded response is from the actual API.
No credentials/headers/bodies logged. Fault path constrained to this synthetic work.
"""
import hashlib,http.client,json,socket,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/evidence/batch2-recovery5a'
f=json.loads((OUT/'fixture.json').read_text())
fault_path='/v1/workspaces/'+f['workspace']+'/conversations/'+f['conversation']+'/messages'
lock=threading.Lock();dropped=False
class Proxy(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):self.forward()
 def do_POST(self):self.forward()
 def forward(self):
  global dropped
  raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
  assert len(raw)<=8*1024*1024
  upstream=http.client.HTTPConnection('127.0.0.1',18965,timeout=30)
  headers={k:v for k,v in self.headers.items() if k.lower() not in ('host','connection','transfer-encoding')}
  upstream.request(self.command,self.path,body=raw or None,headers=headers)
  response=upstream.getresponse();body=response.read();response_headers=response.getheaders();status=response.status;upstream.close()
  drop=False
  if self.command=='POST':
   with lock:
    if self.path==fault_path and not dropped and status in (200,201,202):dropped=drop=True
    record={'method':self.command,'path':self.path,'request_sha256':hashlib.sha256(raw).hexdigest(),'upstream_status':status,'dropped_ack':drop,'response_sha256':hashlib.sha256(body).hexdigest()}
    with (OUT/'fault-proxy-posts.jsonl').open('a') as log:log.write(json.dumps(record)+'\n')
  if drop:
   self.close_connection=True
   try:self.connection.shutdown(socket.SHUT_RDWR)
   except OSError:pass
   self.connection.close();return
  self.send_response(status)
  for k,v in response_headers:
   if k.lower() not in ('transfer-encoding','content-length','connection'):self.send_header(k,v)
  self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
print('Synthetic-only fault proxy127.0.0.1:18966 -> current API18965; first scoped message POST ACK will drop after actual commit.',flush=True)
ThreadingHTTPServer(('127.0.0.1',18966),Proxy).serve_forever()
