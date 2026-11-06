"""Attack the actual gVisor service. No fake denied strings or host-code fallback."""
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from workagent.sandbox.client import run, SandboxCancelled, SandboxUnavailable, SandboxOutcomeUnknown
from workagent.sandbox.runner_protocol import blob, unblob, encode
from workagent.sandbox import profiles as P


def execute(name,code,inputs=()):
    result=run(code,list(inputs),authorized=lambda:True)
    evidence=os.environ.get('COMPUTE_EVIDENCE_DIR')
    if evidence:
        dest=Path(evidence);dest.mkdir(parents=True,exist_ok=True)
        with (dest/'isolation.jsonl').open('a') as f:f.write(json.dumps({'case':name,'result':result})+'\n')
    assert result['cleanup_verified']
    unit=os.environ['COMPUTE_SYSTEMD_UNIT']
    parent=Path('/sys/fs/cgroup/system.slice')/(unit+'.service')
    assert parent.exists()
    assert not list(parent.glob('wa-compute-*'))
    return result


def test_network_proc_host_secrets_and_contained_subprocess(tmp_path,monkeypatch):
    secret=tmp_path/'host-secret.txt';secret.write_text('synthetic-host-only-sentinel')
    monkeypatch.setenv('WORKAGENT_HOST_SECRET','synthetic-env-not-for-guest')
    code='''import os,json,socket,subprocess
r={}
for path in PATHS:
 try: r[path]=open(path).read(80)
 except OSError as e: r[path]=e.errno
for name,addr in [('external',('1.1.1.1',443)),('metadata',('169.254.169.254',80)),('hostpg',('127.0.0.1',5432))]:
 try: s=socket.create_connection(addr,timeout=.3);r[name]='CONNECTED';s.close()
 except OSError as e: r[name]=e.errno
r['proc']=[p for p in os.listdir('/proc') if p.isdigit()]
r['env']=dict(os.environ)
r['child']=subprocess.check_output(['/bin/sh','-c','id -u; test ! -e /home/ubuntu'],text=True)
try: import pip;r['pip']=True
except ImportError:r['pip']=False
print(json.dumps(r))
'''.replace('PATHS',repr([str(secret),'/proc/'+str(os.getpid())+'/environ','/home/ubuntu/.ssh/id_rsa','/var/run/postgresql/.s.PGSQL.5432','/proc/self/root/home/ubuntu/.ssh/id_rsa']))
    result=execute('network-proc-host',code)
    r=json.loads(result['stdout'])
    assert all(isinstance(r[p],int) for p in [str(secret),'/proc/'+str(os.getpid())+'/environ','/home/ubuntu/.ssh/id_rsa','/var/run/postgresql/.s.PGSQL.5432','/proc/self/root/home/ubuntu/.ssh/id_rsa'])
    assert all(isinstance(r[k],int) for k in ('external','metadata','hostpg'))
    assert len(r['proc'])<10 and str(os.getpid()) not in r['proc']
    assert 'WORKAGENT_HOST_SECRET' not in r['env'] and 'DATABASE_URL' not in r['env']
    assert r['child']=='65534\n' and r['pip'] is False


def test_immutable_inputs_root_and_symlink_fifo_hardlink_collection():
    code='''import os,json
r={}
for p in ['/inputs/input.txt','/usr/local/lib/python3.12/os.py']:
 try: open(p,'w').write('change');r[p]='WRITTEN'
 except OSError as e:r[p]=e.errno
os.symlink('/inputs/input.txt','leak.txt')
os.mkfifo('fifo.txt')
open('hard.txt','w').write('cannot retain hardlink')
os.link('hard.txt','second.txt')
os.mkdir('nested')
open('nested/deep.txt','w').write('not traversed')
open('ok.txt','w').write('valid')
print(json.dumps(r))
'''
    result=execute('input-root-symlink-fifo-hardlink',code,[blob('input.txt',b'immutable')])
    assert all(isinstance(v,int) for v in json.loads(result['stdout']).values())
    assert [f['name'] for f in result['outputs']]==['ok.txt']
    assert unblob(result['outputs'][0])==b'valid'
    assert result['omissions']==['unsafe/non-regular output omitted']


@pytest.mark.parametrize('name,code,status',[
 ('ram',"a=[]\nwhile True:a.append(bytearray(16*1024*1024))",'failed'),
 ('cpu-single','while True: pass','failed'),
 ('disk',"for n in range(200):\n with open(str(n)+'.txt','wb') as f:f.write(b'x'*1048576)",'failed'),
 ('inode',"for n in range(1000):open(str(n)+'.txt','w').close()",'failed'),
 ('file-size',"open('big.txt','wb').write(b'x'*2097152)",'failed'),
 ('stdout',"while True:print('X'*10000)",'output_limit'),
 ('stderr',"import sys\nwhile True:sys.stderr.write('X'*10000)",'output_limit'),
 ('wall','import time;time.sleep(60)','wall_limit'),
])
def test_actual_resource_exhaustion(name,code,status):
    result=execute(name,code)
    assert result['status'] in ({'failed','cpu_limit'} if name=='cpu-single' else {status})
    assert not result['outputs']
    if name=='ram': assert result['resources']['oom_kill']>=1 and result['resources']['memory_peak_bytes']<=P.MEMORY_BYTES
    if name in ('stdout','stderr'): assert len(result['stdout'])+len(result['stderr'])==P.STREAM_BYTES
    if name=='disk': assert 'No space left on device' in result['stderr']
    if name=='inode': assert any(e in result['stderr'] for e in ('No space left on device','Too many open files'))
    if name=='file-size': assert 'File too large' in result['stderr']
    assert result['elapsed_ms']<40000


@pytest.mark.parametrize('parallel',[False,True])
def test_aggregate_cpu_including_sequential_children(parallel):
    child='import time;t=time.process_time();\nwhile time.process_time()-t<3.5: pass'
    code=f'''import subprocess
argv=['/usr/local/bin/python3','-I','-S','-c',{child!r}]
'''
    code+=('for n in range(20):\n a=subprocess.Popen(argv);b=subprocess.Popen(argv);a.wait();b.wait()' if parallel else
           'subprocess.run(argv,check=True);subprocess.run(argv,check=True)')
    result=execute('cpu-children-'+str(parallel),code)
    assert result['status']=='cpu_limit'
    assert 5000000<=result['resources']['cpu_usec']<6500000


def test_guest_fork_pid_limit_and_detached_tree_reaped():
    code='''import os,time
n=0
try:
 while n<200:
  pid=os.fork()
  if pid==0:
   os.setsid();os.close(1);os.close(2);time.sleep(60);os._exit(0)
  n+=1
except OSError as e:print(n,e.errno)
'''
    result=execute('fork-pid-setsid-cleanup',code)
    assert result['status']=='succeeded'
    count,errno=map(int,result['stdout'].split())
    assert 1<=count<=31 and errno==11
    assert result['resources']['pids_peak']<=P.HOST_PIDS


def test_output_manifest_limits_and_no_residual_between_jobs():
    result=execute('output-file-count',"for n in range(9):open(str(n)+'.txt','w').write('retained')")
    assert len(result['outputs'])==8 and result['omissions']
    result=execute('output-total-bytes',"for n in range(2):open(str(n)+'.txt','w').write('x'*700000)")
    assert len(result['outputs'])==1 and result['omissions']
    result=execute('no-residual',"import os;print(os.listdir('/outputs'));print(os.listdir('/inputs'));print(os.listdir('/tmp'))")
    assert result['stdout']=="[]\n['main.py']\n[]\n"


def test_disconnect_cancels_tree_without_waiting_wall_limit():
    start=time.monotonic()
    with pytest.raises(SandboxCancelled):
        run('import os,time\nif os.fork()==0: os.setsid()\ntime.sleep(60)',[],authorized=lambda:time.monotonic()-start<1)
    time.sleep(1)
    result=execute('after-cancel',"print('clean')")
    assert result['stdout']=='clean\n' and time.monotonic()-start<6


def test_actual_service_rejects_argv_and_input_paths():
    request={'version':1,'profile':P.PROFILE,'code':'print(1)','inputs':[], 'argv':['/bin/sh']}
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(6);sock.connect(os.environ['WORKAGENT_COMPUTE_SOCKET']);sock.sendall(encode(request))
        assert sock.recv(100)==b''
    for name in ('../escape.txt','/absolute.txt','main.py'):
        with pytest.raises(ValueError):run('print(1)',[blob(name,b'data')],authorized=lambda:True)
    assert execute('after-invalid-request','print(1)')['stdout']=='1\n'


def test_runtime_service_restart_kills_tree_and_never_replays():
    unit=os.environ['COMPUTE_SYSTEMD_UNIT']
    assert unit.startswith('workagent-compute-b31a-')
    from compute_fixtures import restart_owned_service
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(run,'import os,time\nif os.fork()==0:os.setsid()\ntime.sleep(60)',[],authorized=lambda:True)
            parent=Path('/sys/fs/cgroup/system.slice')/(unit+'.service')
            deadline=time.monotonic()+5
            while not list(parent.glob('wa-compute-*')):
                assert time.monotonic()<deadline;time.sleep(.05)
            time.sleep(.4)
            subprocess.run(['sudo','-n','systemctl','kill','--kill-whom=all','--signal=SIGKILL',unit],check=True)
            with pytest.raises(SandboxOutcomeUnknown):future.result(timeout=5)
    finally:
        restart_owned_service()
    assert execute('after-service-restart',"import os;print(os.listdir('/outputs'))")['stdout']=='[]\n'
