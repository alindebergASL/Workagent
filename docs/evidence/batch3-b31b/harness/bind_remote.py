"""Final read-only bindings + small sanitized export; run only on proof EC2."""
import hashlib,json,os,re,subprocess,sys
from pathlib import Path
root=Path.cwd();proof=root.parent;out=proof/'sanitized-closure';out.mkdir(exist_ok=True)
assert root.name=='candidate' and 'b31b-recovery-tb7f7aa98' in str(proof)
def h(p):return hashlib.sha256(p.read_bytes()).hexdigest()
m=json.loads((proof/'checkpoint-source.json').read_text());assert all(h(root/p)==v for p,v in m.items())
pack=json.loads((proof/'packaged-source.json').read_text());unchanged={p:v for p,v in pack.items() if p not in m and not p.startswith('.local/')};assert all(h(root/p)==v for p,v in unchanged.items())
(out/'source-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
locks=['backend/requirements.txt','backend/requirements.lock','backend/requirements-tui.txt','backend/requirements-tui.lock','web/package.json','web/pnpm-lock.yaml','contracts/package.json']
artifacts={str(p.relative_to(root)):h(p) for p in (root/'web/.next').rglob('*') if p.is_file() and any(x in p.parts for x in ('server','static'))}
for name in ['BUILD_ID','build-manifest.json','app-path-routes-manifest.json','required-server-files.json']:
 p=root/'web/.next'/name
 if p.exists():artifacts[str(p.relative_to(root))]=h(p)
packages={}
for folder,names in [('web',['next','react','typescript','vitest','@playwright/test']),('contracts',['typescript','openapi-typescript'])]:
 for name in names:
  p=root/folder/'node_modules'/name/'package.json'
  if p.exists():packages[folder+'/'+name]={'version':json.loads(p.read_text())['version'],'sha256':h(p),'resolved_path':str(p.resolve())}
installed=json.loads(subprocess.check_output([str(root/'backend/.venv/bin/python'),'-c','import importlib.metadata as m,json;print(json.dumps({d.metadata["Name"]:d.version for d in m.distributions()}))'],text=True))
binding={'changed_source_verified':len(m),'unchanged_packaged_files_verified':len(unchanged),'locks':{p:h(root/p) for p in locks},'packages':packages,'python_distributions':installed,'build_id':(root/'web/.next/BUILD_ID').read_text().strip(),'build_artifacts':artifacts,'note':'Readback of retained actual production build and isolated dependencies, not a rebuild or a reproducibility claim'}
(out/'runtime-build-binding.json').write_text(json.dumps(binding,indent=2)+'\n')
roots={'evidence':proof/'evidence','native':root/'.local/batch3/b31b/pty-evidence'}
index={}
secrets=[os.environ.get(k,'') for k in ('DATABASE_URL','MIGRATION_DATABASE_URL','LOCAL_BEARER_TOKEN')]
def clean(text):
 for value in secrets:
  if value:text=text.replace(value,'<private-fixture-value>')
 text=re.sub(r'postgres(?:ql)?://[^\s\"\']+','<private-disposable-dsn>',text)
 return text
for prefix,base in roots.items():
 for p in sorted(base.rglob('*')):
  if not p.is_file():continue
  rel=str(p.relative_to(base));key=prefix+'/'+rel;index[key]={'sha256':h(p),'bytes':p.stat().st_size}
  # Do not export API logs, terminal raw streams or private saved state.
  if p.suffix in ('.json','.log','.txt') and '/state/' not in '/'+rel and p.name not in ('api.log','web-server.log'):
   if p.stat().st_size<200000:
    target=out/prefix/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(clean(p.read_text(errors='replace')))
for name in ['usage.png','denied-read.png','history-cleared.png','old-list-before-forget-receipt.png','old-list-after-forget-receipt.png']:
 p=proof/'evidence/closure'/name;target=out/'evidence/closure'/name;target.write_bytes(p.read_bytes())
(out/'remote-evidence-index.json').write_text(json.dumps(index,indent=2)+'\n')
print(json.dumps({'source_matches':len(m),'unchanged_matches':len(unchanged),'build_id':binding['build_id'],'export_bytes':sum(p.stat().st_size for p in out.rglob('*') if p.is_file()),'indexed_receipts':len(index)},indent=2))
