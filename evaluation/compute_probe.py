"""Probe the installed pinned product compute sandbox with real oracle paths.
Only path names and safe input enter this job, never oracle bytes/answers.
"""
from pathlib import Path
import json
import os
import subprocess
import sys
import time
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from workagent.sandbox.client import run
from workagent.sandbox.runner_protocol import blob
from harness import canonical, write_new, digest


def main():
    destination=Path(sys.argv[1]).resolve()
    if destination.exists():raise ValueError('preserve_existing_receipt')
    code='''import os,json,socket
checks={}
for name,path in [('oracle','/home/ubuntu/workagent-evaluator-b35b/oracles/custody.json'),('manifest','/home/ubuntu/workagent-evaluator-b35b/manifest.json'),('hostproc','/proc/1/root/home/ubuntu/workagent-evaluator-b35b/oracles/custody.json'),('traversal','/inputs/../../home/ubuntu/workagent-evaluator-b35b/oracles/custody.json')]:
 try:
  with open(path,'rb') as f:f.read(1)
  checks[name]=False
 except OSError: checks[name]=True
checks['input_exact']=open('/inputs/safe.txt').read()=='allowed ordinary input'
checks['no_credential']=not any(x in os.environ for x in ['DATABASE_URL','OPENAI_API_KEY'])
try:
 s=socket.create_connection(('127.0.0.1',8152),timeout=.2);s.close();checks['network']=False
except OSError:checks['network']=True
print(json.dumps(checks,sort_keys=True))
with open('/outputs/custody.json','w') as f:json.dump(checks,f,sort_keys=True)
'''
    result=run(code,[blob('safe.txt',b'allowed ordinary input')],authorized=lambda:True,
               endpoint='/run/workagent-compute-b31a-v3/compute.sock',
               profile_sha256='69ff94d387bef41a0210653b213bdae301a9e0600a62d273d469f34385b44578')
    write_new(destination,canonical(result))
    assert result['status']=='succeeded' and result['exit_code']==0 and result['cleanup_verified']
    checks=json.loads(result['stdout']);assert checks and all(checks.values())
    print(json.dumps({'status':result['status'],'checks':checks,'receipt_sha256':digest(canonical(result)),
                      'provider_calls':0,'profile':result['profile'],'runtime':result['runtime_version']}))


if __name__=='__main__':main()
