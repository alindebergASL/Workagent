import json,os,signal,socket,subprocess,time,sys
from pathlib import Path
root=Path.cwd();proof=root.parent; assert proof.name=='b31c-t5a57eb56'
rows=json.loads((proof/'processes.json').read_text())
for r in rows:
 pid=r['pid'];proc=Path('/proc')/str(pid)
 assert str((proc/'cwd').resolve())==r['cwd']
 r['start_actual']=(proc/'stat').read_text().rsplit(')',1)[1].split()[19]
 os.killpg(pid,signal.SIGTERM)
for r in rows:
 for _ in range(50):
  try:
   with socket.create_connection(('127.0.0.1',r['port']),timeout=.2):pass
  except OSError:break
  time.sleep(.1)
 else:raise AssertionError('owned port still listening')
 r['port_refused']=True
out=proof/'evidence'/('restart-'+str(time.time_ns())+'.json');out.write_text(json.dumps(rows,indent=2))
if sys.argv[1]=='restart':subprocess.run([sys.executable,'start.py'],check=True)
print(out)
