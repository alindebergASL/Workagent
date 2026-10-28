import hashlib,json,subprocess
from pathlib import Path
root=Path.cwd();paths=subprocess.check_output(['git','ls-files','backend/workagent','web/src','web/scripts','web/package.json','web/package-lock.json','web/next.config.ts','contracts'],text=True).splitlines()+['backend/tests/test_combined_attachment_bridge_pg.py']
files={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths if (root/p).is_file()}
out=root/'.local/batch3/b31c/source-manifest.json';out.write_text(json.dumps({'base':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'files':files},indent=2)+'\n');print('SOURCE FILES',len(files))
