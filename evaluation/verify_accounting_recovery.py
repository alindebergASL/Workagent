"""Post-correction consistent backup + quarantined recovery rehearsal."""
from hashlib import sha256
import json
import os
import subprocess
import uuid
from test_accounting_correction import ROOT, OUT, PRIMARY, pg
from verify_accounting_correction import inventory, apply
from install_accounting_correction import readback

DB='workagent_test_recovery_'+uuid.uuid4().hex[:12]
backup=OUT/'primary-after-correction.dump'
with backup.open('xb') as f:
    os.chmod(backup,0o600)
    p=subprocess.run(['sudo','-n','-u','postgres','pg_dump','-Fc','--no-password','-d',PRIMARY],stdout=f,stderr=subprocess.PIPE,timeout=120)
assert p.returncode==0,p.stderr[-1000:]
pg(PRIMARY,'CREATE DATABASE "'+DB+'"; REVOKE CONNECT ON DATABASE "'+DB+'" FROM PUBLIC;')
with backup.open('rb') as f:
    p=subprocess.run(['sudo','-n','-u','postgres','pg_restore','--exit-on-error','--no-owner','-d',DB],stdin=f,capture_output=True,timeout=180)
assert p.returncode==0,p.stderr[-1000:]
source,amounts=readback()
for table in ('releases','certificates'):
    sql='BEGIN READ ONLY; SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),\'[]\') FROM test_budget_correction.'+table+' t; ROLLBACK;'
    assert pg(PRIMARY,sql)==pg(DB,sql),'journal_restore_drift'
assert inventory(PRIMARY)==inventory(DB),'public_restore_drift'
for sql in (apply(),"SELECT test_budget_correction.issue_exact('clone','workagent_test_target','"+'a'*64+"',1);"):
    try:pg(DB,sql)
    except RuntimeError as e:assert 'canonical_issuer_required' in str(e)
    else:raise AssertionError('restored_copy_minted_authority')
acl_sql="""BEGIN READ ONLY; SELECT jsonb_build_object(
 'unexpected_schema_users',(SELECT count(*) FROM pg_roles WHERE rolcanlogin AND NOT rolsuper AND has_schema_privilege(oid,'test_budget_correction','USAGE')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('name',proname,'security_definer',prosecdef,'config',proconfig,'acl',proacl::text,'owner',pg_get_userbyid(proowner)) ORDER BY proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='test_budget_correction'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid IN ('test_budget_correction.releases'::regclass,'test_budget_correction.certificates'::regclass) AND NOT tgisinternal)
); ROLLBACK;"""
acl=json.loads(pg(PRIMARY,acl_sql))
assert acl['unexpected_schema_users']==0
assert len(acl['functions'])==3 and all(not f['security_definer'] and f['owner']=='postgres' and f['config']==['search_path=pg_catalog'] and f['acl']=='{postgres=X/postgres}' for f in acl['functions'])
assert len(acl['triggers'])==2 and all(t['enabled']=='O' and all(x in t['definition'] for x in ('DELETE','UPDATE','TRUNCATE')) for t in acl['triggers'])
report=dict(backup_sha256=sha256(backup.read_bytes()).hexdigest(),backup_bytes=backup.stat().st_size,
  quarantined_restore=DB,full_public_inventory_match=True,correction_and_certificate_journals_match=True,
  restored_release_and_issue_denied=True,installed_catalog=acl,amounts=amounts,provider_calls=0,
  note='No restored pool is activated. Uncertain future issuer loss stops sends; do not restore stale issuance history.')
with (OUT/'post-install-recovery.json').open('x') as f:f.write(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
