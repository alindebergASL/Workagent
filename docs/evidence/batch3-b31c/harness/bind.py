"""Bind exact remote candidate, preserve failed observations, sanitize artifacts."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys
root=Path.cwd();proof=root.parent;out=proof/'evidence';manifest=json.loads((root/'source-manifest.json').read_text());bad=[]
for name,digest in manifest['files'].items():
 path=root/name
 if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:bad.append(name)
assert not bad,bad
(out/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
processes=json.loads((proof/'processes.json').read_text())
for p in processes:
 proc=Path('/proc')/str(p['pid']);assert (proc/'cwd').resolve()==Path(p['cwd']);p['start_actual']=(proc/'stat').read_text().rsplit(')',1)[1].split()[19]
 compute=subprocess.check_output(['systemctl','show','workagent-compute-b31c','-p','MainPID','-p','InvocationID','-p','ActiveState'],text=True)
pins=json.loads(Path('/run/workagent-compute-b31c/pins.json').read_text())
installed={unit:subprocess.check_output(['systemctl','show',unit,'-p','MainPID','-p','ActiveState'],text=True) for unit in ['workagent-dev-api','workagent-dev-web']}
record=dict(source_files_verified=len(manifest['files']),build_id=(root/'web/.next/BUILD_ID').read_text().strip(),public_build_flags=dict(NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION='1',NEXT_PUBLIC_WORKAGENT_API_MODE='real'),python=sys.version,processes=processes,compute_service=compute,compute_profile_sha256=hashlib.sha256(Path('/run/workagent-compute-b31c/pins.json').read_bytes()).hexdigest(),compute_service_tree=pins['trees']['service'],installed_services=installed,disk=subprocess.check_output(['df','-h','/'],text=True))
(out/'runtime-source-binding.json').write_text(json.dumps(record,indent=2)+'\n')
# Keep raw remote logs/private env in this disposable proof. Publish redacted copies.
secrets=[v for k,v in os.environ.items() if any(x in k for x in ['TOKEN','PASSWORD','SECRET','DATABASE_URL']) and len(v)>8]
dest=proof/'sanitized';dest.mkdir(exist_ok=True)
for path in out.rglob('*'):
 if not path.is_file():continue
 relative=path.relative_to(out);target=dest/relative;target.parent.mkdir(parents=True,exist_ok=True);raw=path.read_bytes()
 if path.suffix in ('.png',):target.write_bytes(raw);continue
 text=raw.decode('utf-8')
 for value in secrets:text=text.replace(value,'<private fixture credential redacted>')
 text=re.sub(r'postgres(?:ql)?://[^\s\"\'<>]+','<disposable PostgreSQL DSN redacted>',text)
 target.write_text(text)
print(json.dumps(dict(source_files_verified=len(manifest['files']),build_id=record['build_id'],published_file_count=sum(p.is_file() for p in dest.rglob('*')),installed_services=installed),indent=2))
