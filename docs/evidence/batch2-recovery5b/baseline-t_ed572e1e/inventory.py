"""Read-only candidate/predecessor/resource inventory; append-only evidence output.
Run with backend/.venv/bin/python. No app imports, browser, migrations or writes to DB.
"""
from pathlib import Path
import collections
import datetime
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path('/home/ubuntu/workagent-continuation-20261026')
OUT = Path(__file__).resolve().parent
SOURCE = 'docs/evidence/batch2-recovery5d/poll-correction/source-manifest.json'
MATRIX = 'docs/evidence/batch2-recovery5b/reconciled-after5d/acceptance-matrix.json'

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def save(name, value):
    with (OUT / name).open('x') as f:
        json.dump(value, f, indent=2, ensure_ascii=False, default=str)
        f.write('\n')

def git(*args):
    return subprocess.check_output(['git', '--no-optional-locks', *args], cwd=ROOT).decode()

manifest = json.loads((ROOT / SOURCE).read_text())
assert digest(ROOT / SOURCE) == '194d317f63fdf7fea4dadc38c6a6377a7196a8c02c74fc8da9db230f8b205c07'
mismatch = [p for p,h in manifest.items() if not (ROOT/p).is_file() or digest(ROOT/p) != h]
assert not mismatch, mismatch
app_files = set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z', 'backend', 'web', 'contracts', 'fixtures').strip('\0').split('\0'))
assert app_files == set(manifest), sorted(app_files.symmetric_difference(manifest))
head = git('rev-parse', 'HEAD').strip()
assert head == 'c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d'
branch = git('branch', '--show-current').strip()
assert branch == 'hermes/b2-conversational-client'
status = git('status', '--porcelain=v1', '-uall').splitlines()
source_dirty = [s for s in status if s[3:] in manifest]
save('source-manifest.json', manifest)
save('source-identity.json', {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'root': str(ROOT), 'head':head, 'branch':branch, 'origin_manifest':SOURCE, 'origin_manifest_sha256':digest(ROOT/SOURCE), 'file_count':len(manifest), 'source_hash_mismatches':mismatch, 'source_paths_complete':True, 'source_dirty':source_dirty, 'status_counts':[{'status':k[0],'root':k[1],'count':v} for k,v in sorted(collections.Counter((s[:2],s[3:].split('/')[0]) for s in status).items())], 'tracked_diff_sha256':hashlib.sha256(subprocess.check_output(['git','--no-optional-locks','diff','--binary','HEAD','--','backend','web','contracts','fixtures'],cwd=ROOT)).hexdigest(), 'scope_exclusions':['.local secret/lane state','dependency/venv contents','generated .next bundle (separate build identity)','docs evidence (separate reference hashes)']})

matrix=json.loads((ROOT/MATRIX).read_text())
rows=matrix['rows']
ids=[r['id'] for r in rows]
expected={f'A{i:02}' for i in range(1,36)} | {f'P{i}' for i in range(1,9)}
assert len(ids)==43 and len(set(ids))==43 and set(ids)==expected
refs={}
for row in rows:
    c=row['controlling_requirement']; p=ROOT/c['source']['path']
    assert digest(p)==c['source']['sha256']
    assert p.read_text().splitlines()[c['line']-1]==c['verbatim']
    for ref in row['evidence']:
        path=Path(ref['path']); path=path if path.is_absolute() else ROOT/path
        assert path.is_file() and digest(path)==ref['sha256'], str(path)
        refs[ref['path']]=ref['sha256']
save('acceptance-baseline.json', {'source_matrix':MATRIX,'sha256':digest(ROOT/MATRIX), 'classification':'INHERITED; no new product tests or browser proof', 'counts':dict(collections.Counter(r['status'] for r in rows)), 'rows':[{k:r[k] for k in ['id','case','required','evidence_required','status','controlling_requirement','assessment','remaining_gap','proof_groups','evidence_levels','source_reuse_qualification','parent_qualification_retained']} for r in rows]})
save('inherited-evidence-verified.json', {'scope':'Unique direct matrix evidence references only; hash verification is not behavioral re-execution', 'count':len(refs), 'files':refs})
xml=[]
for name in sorted(refs):
    if name.endswith('.xml'):
        p=Path(name); p=p if p.is_absolute() else ROOT/p
        try:
            # Only hash-pinned local JUnit receipts, never uploaded/untrusted XML.
            tree=ET.parse(p); cases=tree.findall('.//testcase')
            xml.append({'path':name,'sha256':digest(p),'testcases':len(cases),'failures':len(tree.findall('.//failure')),'errors':len(tree.findall('.//error')),'skips':len(tree.findall('.//skipped')),'classification':'retained execution; not rerun'})
        except ET.ParseError:
            xml.append({'path':name,'parse_error':True})
save('inherited-xml-inventory.json',xml)

# Read complete task bodies; coordination remains through kanban tools, never SQL writes.
db=sqlite3.connect('file:'+os.environ['HERMES_KANBAN_DB']+'?mode=ro',uri=True)
db.row_factory=sqlite3.Row
cards=[]
for tid in ['t_ed572e1e','t_75bcdd10','t_5f1899a4','t_372fad62','t_5f6349b3','t_77ca6df4','t_323eb2d2','t_ee8a7740','t_f483726e','t_45ab8522']:
    row=db.execute('SELECT id,title,status,body FROM tasks WHERE id=?',(tid,)).fetchone()
    if row: cards.append(dict(row))
active=[dict(r) for r in db.execute("SELECT id,title,status FROM tasks WHERE status IN ('running','review')")]
save('complete-card-context.json',{'cards':cards,'active_cards':active,'retrieval':'Read-only current board, complete body including HANDOFF and bounded acceptance; no missing tail in stored recovery card'})

processes=[]; writable=[]; candidates=[]
self_and_parent={os.getpid(),os.getppid()}
for proc in Path('/proc').iterdir():
    if not proc.name.isdigit(): continue
    try:
        pid=int(proc.name); cwd=os.readlink(proc/'cwd'); argv=(proc/'cmdline').read_bytes().split(b'\0'); comm=(proc/'comm').read_text().strip(); stat=(proc/'stat').read_text().rsplit(')',1)[1].split()
        if pid in self_and_parent: continue
        relevant=cwd.startswith(str(ROOT)) or any(str(ROOT).encode() in a for a in argv)
        if relevant:
            processes.append({'pid':pid,'ppid':int(stat[1]),'comm':comm,'cwd':cwd,'start_ticks':stat[19]})
        if comm.lower() in ['claude','codex','pytest','playwright','chromium','chrome','hermes']:
            candidates.append({'pid':pid,'comm':comm,'cwd':cwd,'source_related':relevant})
        for fd in (proc/'fd').iterdir():
            try:
                target=os.readlink(fd)
                if target.startswith(str(ROOT)) and not target.startswith(str(ROOT/' .local').replace('/ .local','/.local')):
                    flags=int(next(x.split()[1] for x in (proc/'fdinfo'/fd.name).read_text().splitlines() if x.startswith('flags:')),8)
                    if flags & 3 in (1,2): writable.append({'pid':pid,'target':target})
            except (OSError,StopIteration): pass
    except (OSError,IndexError,ValueError): pass
services=[]
for pid,port in [(4089836,18965),(4139215,3195),(2688430,18963),(875172,8152),(875173,3152)]:
    proc=Path('/proc')/str(pid)
    if not proc.exists(): services.append({'pid':pid,'port':port,'present':False}); continue
    st=(proc/'stat').read_text().rsplit(')',1)[1].split()
    env=dict(v.split(b'=',1) for v in (proc/'environ').read_bytes().split(b'\0') if b'=' in v)
    item={'pid':pid,'port':port,'present':True,'cwd':os.readlink(proc/'cwd'),'start_ticks':st[19], 'disposition':'browser child owns reversible dev operation' if port in (18965,3195) else 'EXCLUDED; leave untouched'}
    if port in (18965,3195):
        item['argv']=[a.decode() for a in (proc/'cmdline').read_bytes().split(b'\0') if a]
        item['provider_api_key_names_present']=[k.decode() for k in env if k.endswith(b'API_KEY')]
        item['migration_dsn_inherited']=b'MIGRATION_DATABASE_URL' in env
        if port==18965: api_env=env
        if port==3195: item['backend_matches_18965']=env.get(b'WORKAGENT_BACKEND_URL')==b'http://127.0.0.1:18965'
    services.append(item)
save('resource-inventory.json',{'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'processes':processes,'candidate_processes':candidates,'writable_source_fds':writable,'active_board_cards':active,'services':services,'tmux':subprocess.check_output(['tmux','list-panes','-a','-F','#{session_name} #{pane_pid} #{pane_current_command} #{pane_current_path}'],text=True).splitlines(),'listeners':subprocess.check_output(['ss','-ltnp'],text=True).splitlines(),'disk':dict(zip(['total','used','free'],shutil.disk_usage(ROOT))),'build_id':(ROOT/'web/.next/BUILD_ID').read_text().strip(),'dependencies':[{'path':s,'exists':(ROOT/s).exists(),'symlink':(ROOT/s).is_symlink(),'target':str((ROOT/s).resolve())} for s in ['backend/.venv','backend/.venv-docs','web/node_modules','contracts/node_modules']], 'concurrency_limit':'one build/browser worker: t_ee8a7740 only; t_323eb2d2 read-only audit', 'limits':'Process/open-FD observation and stable hashes are point-in-time evidence, not an OS-enforced write lock. Shared Chrome9222 is not task-owned.'})

# Inspect only disposable running API DB, inside an explicitly read-only transaction.
import psycopg
from psycopg.rows import dict_row
from urllib.parse import urlsplit
dsn=api_env[b'DATABASE_URL'].decode()
assert urlsplit(dsn).path=='/workagent_test_0604a6a3b5d9'
with psycopg.connect(dsn,row_factory=dict_row,options='-c default_transaction_read_only=on') as conn:
    role=conn.execute('SELECT current_database() db,current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
    assert not role['rolsuper'] and not role['rolbypassrls']
    migrations=conn.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    assert len(migrations)==49
    assert all(digest(ROOT/'backend/migrations'/m['name'])==m['checksum'] for m in migrations)
    shared=conn.execute('SELECT id FROM conversations WHERE workspace_id=%s AND id=%s',('recovery5a-workspace','cb848ce6-e383-4dc8-b2dc-7721720e45e6')).fetchall()
    assert len(shared)==1
    tx=conn.execute('SHOW transaction_read_only').fetchone()
save('disposable-schema-readback.json',{'role':role,'migrations':migrations,'shared_conversation_exists':True,'transaction':tx,'no_fixture_writes':True,'no_product_provider_calls':True,'schema_only_not_current_artifact_state':True})
assert all(digest(ROOT/p)==h for p,h in manifest.items())
assert git('rev-parse','HEAD').strip()==head
save('verification.json',{'verdict':'PASS baseline binding only','source_files_verified':len(manifest),'acceptance_rows':len(rows),'inherited_counts':dict(collections.Counter(r['status'] for r in rows)),'direct_evidence_refs_verified':len(refs),'migration_checksums_verified':len(migrations),'source_stable_at_end':True,'product_tests_run':0,'browser_runs':0,'builds':0,'product_source_changes':0,'paid_calls':0,'batch2_complete':False,'publication':'HOLD'})
print(json.dumps({'source_files':len(manifest),'rows':len(rows),'inherited_status_counts':dict(collections.Counter(r['status'] for r in rows)),'verified_direct_evidence_refs':len(refs),'migration_count':len(migrations),'output':str(OUT),'source_stable':True}))
