"""Quarantined synthetic backup restore; never adopts/changes an installed DB.

A current authoritative database is REQUIRED. An old backup alone is not proof
of current deletion/permission state. Restore is inspection/recovery only:
existing provider/tool authority is disabled, no credential vault is restored,
and old accounting cannot be reused to authorize new spending. Human originals
and audit/unknown receipts are retained. No cache/embedding directory is copied.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from dev_db import admin


def identity(dsn):
    d = conninfo_to_dict(dsn)
    if not re.fullmatch(r'workagent_test_[a-f0-9]{12}', d.get('dbname','')) or d.get('host') != '127.0.0.1':
        raise ValueError('Only local freshly provisioned synthetic databases are supported')
    return d


def pg(command, dsn, *args):
    d = identity(dsn)
    env = {**os.environ, 'PGHOST':d['host'], 'PGPORT':d.get('port','5432'),
           'PGDATABASE':d['dbname'], 'PGUSER':d['user'], 'PGPASSWORD':d['password']}
    result = subprocess.run([command,*args], env=env, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(command+' failed; target remains quarantined (details withheld)')


def backup(dsn, path):
    path = Path(path)
    with path.open('xb'):
        pass
    path.chmod(0o600)
    pg('pg_dump', dsn, '--format=custom', '--no-owner', '--no-privileges', '--file', str(path))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def insert(c, table, row, *, update=False):
    keys = list(row)
    vals = [Jsonb(row[k]) if isinstance(row[k], (dict,list)) else row[k] for k in keys]
    query = sql.SQL('INSERT INTO {} ({}) VALUES ({}) ON CONFLICT DO NOTHING').format(
        sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,keys)),sql.SQL(',').join(sql.Placeholder() for _ in keys))
    c.execute(query,vals)


def restore(archive, current_dsn, output):
    """Return a private env path ONLY after locked safety replay and verification.

    All restore targets and roles are newly generated here; no caller target URL.
    Source workspace locks serialize tombstones/revokes during replay/release.
    The result is a separate offline inspection branch, NOT a concurrent live
    authority replica. Continuing a live source does not synchronize this branch.
    """
    identity(current_dsn)
    archive=Path(archive); output=Path(output)
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > 256*1024*1024:
        raise ValueError('Bounded regular synthetic backup required')
    archive=archive.resolve(strict=True)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    suffix=secrets.token_hex(6); name='workagent_test_'+suffix
    owner=name+'_owner'; runtime=name+'_runtime'
    op=secrets.token_urlsafe(32); rp=secrets.token_urlsafe(32)
    admin(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}; CREATE ROLE {} NOLOGIN PASSWORD {}; CREATE DATABASE {} OWNER {}; REVOKE CONNECT ON DATABASE {} FROM PUBLIC;').format(
        sql.Identifier(owner),sql.Literal(op),sql.Identifier(runtime),sql.Literal(rp),sql.Identifier(name),sql.Identifier(owner),sql.Identifier(name)).as_string())
    owner_dsn=f'postgresql://{owner}:{op}@127.0.0.1:5432/{name}'
    runtime_dsn=f'postgresql://{runtime}:{rp}@127.0.0.1:5432/{name}'
    # No runtime can connect while pg_restore installs data/functions/triggers.
    pg('pg_restore',owner_dsn,'--exit-on-error','--no-owner','--no-privileges','--dbname',name,str(archive))
    with psycopg.connect(current_dsn,row_factory=dict_row) as source, psycopg.connect(owner_dsn,row_factory=dict_row) as target:
        source.execute("SET LOCAL statement_timeout='30s'")
        target.execute("SET LOCAL statement_timeout='30s'")
        source.execute('SELECT id FROM workspaces ORDER BY id FOR UPDATE').fetchall()
        source_schema=source.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
        if source_schema!=target.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall():
            raise ValueError('Matching reviewed schema required; target remains quarantined')
        workspaces=target.execute('SELECT id,access_generation FROM workspaces ORDER BY id').fetchall()
        if not workspaces:raise ValueError('Nonempty synthetic backup required')
        tables=['memory_items','memory_revisions','memory_evidence','memory_tombstones','memory_scope_bindings']
        for table in tables+['memberships','source_access','connector_accounts','connector_auth_flows']:
            target.execute(sql.SQL('ALTER TABLE {} DISABLE TRIGGER USER').format(sql.Identifier(table)))
        generations={}
        for w in workspaces:
            ws=w['id']
            live=source.execute('SELECT access_generation FROM workspaces WHERE id=%s',(ws,)).fetchone()
            if live is None:raise ValueError('Current safety authority missing workspace')
            generation=max(live['access_generation'],w['access_generation'])+1
            target.execute('UPDATE workspaces SET access_generation=%s WHERE id=%s',(generation,ws))
            generations[ws]=generation
            # Preserve only intersections; missing members/sources are denied.
            members={r['principal_id']:r for r in source.execute('SELECT * FROM memberships WHERE workspace_id=%s',(ws,))}
            for row in target.execute('SELECT * FROM memberships WHERE workspace_id=%s',(ws,)).fetchall():
                cur=members.get(row['principal_id'])
                target.execute('UPDATE memberships SET active=%s,role=%s WHERE workspace_id=%s AND principal_id=%s',
                    (bool(cur and cur['active'] and row['active']),cur['role'] if cur else row['role'],ws,row['principal_id']))
            for row in target.execute('SELECT a.*,s.data FROM source_access a JOIN sources s ON s.workspace_id=a.workspace_id AND s.id=a.source_id WHERE a.workspace_id=%s',(ws,)).fetchall():
                cur=source.execute('SELECT a.active,s.data FROM source_access a JOIN sources s ON s.workspace_id=a.workspace_id AND s.id=a.source_id WHERE a.workspace_id=%s AND a.source_id=%s AND a.principal_id=%s',(ws,row['source_id'],row['principal_id'])).fetchone()
                allowed=bool(cur and cur['active'] and row['active'] and cur['data']==row['data'])
                target.execute('UPDATE source_access SET active=%s WHERE workspace_id=%s AND source_id=%s AND principal_id=%s',(allowed,ws,row['source_id'],row['principal_id']))
            # Current memory includes corrected revisions and scrubbed history.
            # Only existing backup principals can be restored, never new access.
            owners={r['principal_id'] for r in target.execute('SELECT principal_id FROM memberships WHERE workspace_id=%s',(ws,))}
            items=[r for r in source.execute('SELECT * FROM memory_items WHERE workspace_id=%s',(ws,)) if r['owner_id'] in owners]
            for item in items:insert(target,'memory_items',{**item,'current_revision_id':None})
            for item in items:
                rows=source.execute('SELECT * FROM memory_revisions WHERE workspace_id=%s AND memory_id=%s ORDER BY recorded_at,id',(ws,item['id'])).fetchall()
                for row in rows:
                    insert(target,'memory_revisions',row)
                    target.execute('UPDATE memory_revisions SET data=%s WHERE workspace_id=%s AND id=%s',(Jsonb(row['data']),ws,row['id']))
                target.execute('UPDATE memory_items SET current_revision_id=%s WHERE workspace_id=%s AND id=%s',(item['current_revision_id'],ws,item['id']))
                target.execute('DELETE FROM memory_evidence WHERE workspace_id=%s AND memory_id=%s',(ws,item['id']))
                for row in source.execute('SELECT * FROM memory_evidence WHERE workspace_id=%s AND memory_id=%s',(ws,item['id'])):insert(target,'memory_evidence',row)
            for row in source.execute('SELECT * FROM memory_tombstones WHERE workspace_id=%s',(ws,)):insert(target,'memory_tombstones',row)
            # Restored pending auth codes and credentials can never be consumed.
            for row in target.execute('SELECT * FROM connector_accounts WHERE workspace_id=%s',(ws,)).fetchall():
                cur=source.execute('SELECT * FROM connector_accounts WHERE workspace_id=%s AND id=%s',(ws,row['id'])).fetchone()
                target.execute("UPDATE connector_accounts SET state='revoked',credential_ref=NULL,access_generation=%s,provider_revocation=%s,reason='isolated_restore_requires_new_consent' WHERE workspace_id=%s AND id=%s",
                    (max(row['access_generation'],cur['access_generation'] if cur else 0)+1,cur['provider_revocation'] if cur else 'pending',ws,row['id']))
            target.execute('UPDATE connector_auth_flows SET consumed=true,secret_ref=NULL WHERE workspace_id=%s',(ws,))
        target.execute('SET CONSTRAINTS ALL IMMEDIATE')
        for table in tables+['memberships','source_access','connector_accounts','connector_auth_flows']:
            target.execute(sql.SQL('ALTER TABLE {} ENABLE TRIGGER USER').format(sql.Identifier(table)))
        target.execute('UPDATE provider_grants SET active=false')
        target.execute('UPDATE tool_grants SET active=false')
        # No permissive default function ACLs after --no-privileges restore.
        target.execute('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC')
        target.execute('REVOKE ALL ON SCHEMA public FROM PUBLIC')
        target.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(runtime)))
        target.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}').format(sql.Identifier(runtime)))
        target.execute(sql.SQL('GRANT INSERT ON commands,audit,outbox TO {}').format(sql.Identifier(runtime)))
        for signature in ('write_memory_revision(text,text,text,text,jsonb)',
                          'forget_memory(text,text,text,text,text)',
                          'rollback_memory_revision(text,text,text,jsonb,text)'):
            target.execute(sql.SQL('GRANT EXECUTE ON FUNCTION {} TO {}').format(sql.SQL(signature),sql.Identifier(runtime)))
        # Only visibility/inspection predicates, never SECURITY DEFINER writers.
        funcs=target.execute("SELECT oid::regprocedure::text signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND NOT prosecdef").fetchall()
        for f in funcs:
            target.execute(sql.SQL('GRANT EXECUTE ON FUNCTION {} TO {}').format(sql.SQL(f['signature']),sql.Identifier(runtime)))
        # SELECT FOR SHARE requires UPDATE ACL. Immutable owner guards reject writes.
        target.execute(sql.SQL('GRANT UPDATE ON workspaces,memberships,sources,source_access TO {}').format(sql.Identifier(runtime)))
        target.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(sql.Identifier(name),sql.Identifier(runtime)))
        # A database-level runtime marker is checked before any Service write.
        target.execute('CREATE TABLE isolated_restore_receipt (singleton boolean PRIMARY KEY CHECK(singleton), data jsonb NOT NULL)')
        receipt={'version':'isolated-restore-v1','backup_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
            'access_generations':generations,'current_safety_replayed':True,'mode':'inspection_and_memory_recovery_only',
            'provider_authority_disabled':True,'vault_restored':False,'external_caches_restored':False,
            'retention':'Human originals, backup audit and historical provider requests remain; no claim of provider-side deletion or current settled billing.',
            'resume':'Reconcile current budget/unknown outcomes and new authority before any execution; this restored branch cannot send.'}
        target.execute('INSERT INTO isolated_restore_receipt VALUES(true,%s)',(Jsonb(receipt),))
        target.execute(sql.SQL('GRANT SELECT ON isolated_restore_receipt TO {}').format(sql.Identifier(runtime)))
        target.commit()
        # Credentials are withheld until exact durable guard verification.
        with psycopg.connect(owner_dsn,row_factory=dict_row) as check:
            assert check.execute('SELECT data FROM isolated_restore_receipt').fetchone()['data']==receipt
            assert not check.execute('SELECT 1 FROM provider_grants WHERE active UNION ALL SELECT 1 FROM tool_grants WHERE active').fetchone()
            assert not check.execute("SELECT 1 FROM connector_accounts WHERE credential_ref IS NOT NULL OR state='connected'").fetchone()
        admin(sql.SQL('ALTER ROLE {} LOGIN').format(sql.Identifier(runtime)).as_string())
    env=output/'restored.env'
    fd=os.open(env,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:
        f.write(f'export DATABASE_URL={runtime_dsn}\nexport MIGRATION_DATABASE_URL={owner_dsn}\nexport LOCAL_TEST_MODE=true\nexport LOCAL_BEARER_TOKEN={secrets.token_urlsafe(32)}\nexport LOCAL_PRINCIPAL_ID=local-human\n')
    (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return env


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup');parser.add_argument('output')
    args=parser.parse_args()
    path=restore(args.backup,os.environ['MIGRATION_DATABASE_URL'],args.output)
    print('Verified inspection-only isolated restore; private environment:',path)
