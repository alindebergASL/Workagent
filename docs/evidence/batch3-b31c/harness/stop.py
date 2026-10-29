import json,subprocess,socket
from pathlib import Path
root=Path.cwd();proof=root.parent;assert proof.name=='b31c-t5a57eb56'
rows=json.loads((proof/'processes.json').read_text());subprocess.run(['python3','operate.py','stop'],check=True)
subprocess.run(['sudo','systemctl','stop','workagent-compute-b31c'],check=True)
for row in rows:
 try:
  with socket.create_connection(('127.0.0.1',row['port']),timeout=.5):pass
  raise AssertionError('owned service port live')
 except OSError:row['port_refused']=True
compute=subprocess.check_output(['systemctl','show','workagent-compute-b31c','-p','LoadState','-p','ActiveState'],text=True);assert 'ActiveState=inactive' in compute
installed={unit:subprocess.check_output(['systemctl','show',unit,'-p','MainPID','-p','ActiveState'],text=True) for unit in ['workagent-dev-api','workagent-dev-web']}
assert 'MainPID=917' in installed['workagent-dev-api'] and 'MainPID=918' in installed['workagent-dev-web']
lease='64d532c2-eef6-41f9-a046-6969f2f437b5';released=json.loads(subprocess.check_output(['sudo','workagent-idle','release',lease],text=True));status=json.loads(subprocess.check_output(['sudo','workagent-idle','status'],text=True));assert not any(x['id']==lease for x in status['leases'])
result=dict(owned_processes=rows,compute=compute,installed_services=installed,lease_release=released,lease_status=status,installed_data_maintenance=False,public_deployment=False)
(proof/'evidence/runtime-final.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
