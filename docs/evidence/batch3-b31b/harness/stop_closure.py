"""Stop only exact proof-owned processes; retain installed services/data."""
import json,os,signal,socket,subprocess,time
from pathlib import Path
root=Path.cwd();proof=root.parent
assert root.name=='candidate' and 'b31b-recovery-tb7f7aa98' in str(proof)
rows=[]
for name in ('api','web'):
 d=json.loads((proof/(name+'-process.json')).read_text());proc=Path('/proc')/str(d['pid']);actual=str((proc/'cwd').resolve()) if proc.exists() else None
 assert actual==d['cwd'],(name,actual)
 os.kill(d['pid'],signal.SIGTERM);rows.append({**d,'name':name,'owned_cwd_verified':actual})
time.sleep(3)
for row in rows:
 proc=Path('/proc')/str(row['pid']);sock=socket.socket();row['port_refused']=bool(sock.connect_ex(('127.0.0.1',row['port'])));sock.close();row['pid_exists']=proc.exists();assert row['port_refused'] and not row['pid_exists']
services={}
for name in ('workagent-dev-api','workagent-dev-web','postgresql','workagent-idle.timer'):
 services[name]=subprocess.check_output(['systemctl','show',name,'--property=ActiveState,MainPID,ActiveEnterTimestampMonotonic'],text=True).strip();assert 'ActiveState=active' in services[name]
lease='ad1b09e6-316b-4e1f-82c3-2bc6cbad3e82'
release=json.loads(subprocess.check_output(['sudo','workagent-idle','release',lease],text=True));status=json.loads(subprocess.check_output(['sudo','workagent-idle','status'],text=True));assert not any(x.get('id')==lease for x in status['leases'])
data={'owned_services':rows,'installed_services':services,'released':release,'lease_readback':status,'scope':'No installed runtime changes, no fixture deletion, no database maintenance'}
(proof/'sanitized-closure/runtime-final.json').write_text(json.dumps(data,indent=2)+'\n');print(json.dumps(data,indent=2))
