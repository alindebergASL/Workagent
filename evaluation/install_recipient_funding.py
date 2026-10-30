"""Trusted, incremental recipient installation. No provider I/O or release switch.

Use only the existing 12 physical stores and immutable correction issuer. A failed
recipient credit keeps its issuer allocation reserved; rerun the SAME phase ID to
finish, never issue a replacement. This is not a new accounting coordinator.
"""
from decimal import Decimal
from hashlib import sha256
import argparse
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

from test_accounting_correction import pg, PRIMARY
from study_binding import validate_contexts, validate_sources, environment, validate_environment, SOURCE_HASHES
from study_controller import load_schedule, canonical
from network_harness import inventory, REPO as ROOT

OUT = ROOT / '.local/batch3/b35c/live-study'
SQL = ROOT / 'evaluation/recipient_funding.sql'
ISSUER_OID = 7704275


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def save(path, data):
    raw = canonical(data) + '\n'
    if path.exists():
        if path.read_text() != raw:
            raise RuntimeError('immutable_install_receipt_mismatch:' + str(path))
    else:
        with path.open('x') as f:
            f.write(raw)


def mapping():
    schedule_hash, schedule = load_schedule()
    bindings = json.loads((OUT / 'live-bindings.private.json').read_text())
    document = json.loads((OUT / 'recipient-plans-file-target.json').read_text())
    assert document['prior_document_sha256'] == sha256((OUT / 'recipient-plans.json').read_bytes()).hexdigest()
    assert document['candidate_source_files'] == {'backend/workagent/general_responses.py': sha256((ROOT/'backend/workagent/general_responses.py').read_bytes()).hexdigest()}
    assert validate_contexts(bindings, schedule) == document['live_mapping_sha256']
    validate_sources({v: inventory(ROOT / ('.local/batch3/b35b/baseline/workagent' if v == 'B0' else 'backend/workagent')) for v in SOURCE_HASHES})
    validate_environment(environment())
    plans = {p['blind_id']: p for p in document['plans']}
    assert len(plans) == 12 and len({p['database'] for p in plans.values()}) == 12
    assert set(plans) == set(bindings)
    for trial in schedule:
        p, b = plans[trial['blind_id']], bindings[trial['blind_id']]
        assert p['database'] == urlsplit(b['database_url']).path.lstrip('/')
        assert p['database'] == urlsplit(b['migration_database_url']).path.lstrip('/')
        assert p['schedule_sha256'] == schedule_hash
        assert p['source_manifest_sha256'] == SOURCE_HASHES[trial['variant']]
        assert p['authorization_sha256'] == sha256((ROOT / 'docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md').read_bytes()).hexdigest()
        assert p['binding_sha256'] == sha256(canonical({k:v for k,v in p.items() if k != 'binding_sha256'}).encode()).hexdigest()
    return plans, bindings


def identity(plan, binding):
    actual = json.loads(pg(plan['database'], """BEGIN READ ONLY;
    SELECT jsonb_build_object('oid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()),
      'grants',(SELECT jsonb_agg(jsonb_build_object('id',id,'hash',md5(data::text),'active',active,'data',data) ORDER BY id) FROM provider_grants));
    ROLLBACK;"""))
    assert actual['oid'] == plan['database_oid'], 'recipient_oid_drift'
    expected = {g['id']: g for g in (binding['grant'], binding['other_grant'])}
    assert {g['id']:g['data'] for g in actual['grants']} == expected
    assert all(g['active'] for g in actual['grants'])
    assert {g['id']:g['hash'] for g in actual['grants']} == {g['id']:g['hash'] for g in plan['grant_hashes']}


def installed_readback(plan):
    return json.loads(pg(plan['database'], """BEGIN READ ONLY;
    SELECT jsonb_build_object('database',current_database(),'binding',(SELECT to_jsonb(b) FROM study_funding.binding b),
      'functions',(SELECT jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) FROM pg_proc WHERE pronamespace='study_funding'::regnamespace),
      'gate',(SELECT tgenabled FROM pg_trigger WHERE tgrelid='responses_events'::regclass AND tgname='zz_study_funding'),
      'deny_all_present',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='responses_events'::regclass AND tgname='a_study_unfunded_denial'),
      'certificate_count',(SELECT count(*) FROM study_funding.certificates),
      'events',(SELECT count(*) FROM responses_events)); ROLLBACK;"""))


def install_gate(plan, binding):
    identity(plan, binding)
    receipt = OUT / plan['blind_id'] / 'recipient-install.json'
    exists = pg(plan['database'], "SELECT to_regnamespace('study_funding') IS NOT NULL;").strip() == 't'
    if not exists:
        assert pg(plan['database'], "SELECT NOT EXISTS(SELECT 1 FROM responses_events) AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='responses_events'::regclass AND tgname='a_study_unfunded_denial' AND tgenabled='O');").strip() == 't'
        backup = OUT / plan['blind_id'] / 'before-recipient.dump'
        if backup.exists():
            raise RuntimeError('backup_exists_without_install; inspect exact prior attempt')
        with backup.open('xb') as f:
            backup.chmod(0o600)
            subprocess.run(['sudo','-n','-u','postgres','pg_dump','-Fc','-d',plan['database']], stdout=f, check=True, timeout=120)
        with backup.open('rb') as f:
            subprocess.run(['pg_restore','--list'], stdin=f, stdout=subprocess.DEVNULL, check=True, timeout=30)
        # Keep temporary denial until the binding is inserted and new ALWAYS gate
        # is present in the SAME transaction. Zero certificates still denies all.
        source = SQL.read_text()
        assert source.startswith('-- Fresh') and source.endswith('COMMIT;\n')
        project = binding['grant']['responses']['project_id']
        hashes = {g['id']:g['hash'] for g in plan['grant_hashes']}
        tail = f"""SELECT study_funding.bind_exact({q(plan['binding_sha256'])},{q(project)},{q(canonical(hashes))}::jsonb);
        DROP TRIGGER a_study_unfunded_denial ON public.responses_events;
        COMMIT;\n"""
        pg(plan['database'], source.removesuffix('COMMIT;\n') + tail)
    current = installed_readback(plan)
    b = current['binding']
    assert b['database_name'] == plan['database'] and int(b['database_oid']) == plan['database_oid']
    assert b['plan_sha256'] == plan['binding_sha256']
    assert b['project_id'] == binding['grant']['responses']['project_id']
    assert b['grants'] == {g['id']:g['hash'] for g in plan['grant_hashes']}
    assert current['gate'] == 'A' and not current['deny_all_present']
    if receipt.exists():
        previous = json.loads(receipt.read_text())
        assert previous['sql_sha256'] == sha256(SQL.read_bytes()).hexdigest()
        assert previous['readback']['binding'] == b
        assert previous['readback']['functions'] == current['functions']
    else:
        assert current['certificate_count'] == current['events'] == 0
        save(receipt, dict(sql_sha256=sha256(SQL.read_bytes()).hexdigest(),
                          backup_sha256=sha256((receipt.parent/'before-recipient.dump').read_bytes()).hexdigest(),readback=current))
    return current


def issue_phase(plan, binding, phase, amount):
    assert phase > 0 and amount.is_finite() and amount > 0
    current = install_gate(plan,binding)
    target_hash = current['binding']['binding_sha256']
    cert = 'b35c-' + plan['blind_id'] + '-phase-' + str(phase)
    # Issuer first: durable debit even if the recipient step fails. Same cert ID
    # and exact arguments make retry idempotent; never delete/refund on failure.
    pg(PRIMARY, f"SELECT test_budget_correction.issue_exact({q(cert)},{q(plan['database'])},{q(target_hash)},{q(amount)}::numeric);")
    issued = json.loads(pg(PRIMARY, f"BEGIN READ ONLY; SELECT to_jsonb(c)-'created_at' FROM test_budget_correction.certificates c WHERE id={q(cert)}; ROLLBACK;"), parse_float=Decimal)
    expected = dict(id=cert,target_database=plan['database'],target_binding_sha256=target_hash,amount_usd=amount)
    assert issued == expected, 'issuer_exact_certificate_mismatch'
    pg(plan['database'], f"SELECT study_funding.install_certificate({q(cert)},{q(PRIMARY)},{ISSUER_OID}::oid,{q(plan['database'])},{q(target_hash)},{q(amount)}::numeric);")
    received = json.loads(pg(plan['database'], f"BEGIN READ ONLY; SELECT to_jsonb(c)-'created_at' FROM study_funding.certificates c WHERE id={q(cert)}; ROLLBACK;"), parse_float=Decimal)
    assert received == dict(expected,issuer_database=PRIMARY,issuer_oid=str(ISSUER_OID))
    issued['amount_usd']=received['amount_usd']=str(amount)
    totals = json.loads(pg(PRIMARY,"""BEGIN READ ONLY;
      SELECT jsonb_build_object('released',(SELECT sum(released_usd) FROM test_budget_correction.releases),
        'allocated',(SELECT sum(amount_usd) FROM test_budget_correction.certificates),
        'encumbered',99.605960-(SELECT sum(released_usd) FROM test_budget_correction.releases)+(SELECT sum(amount_usd) FROM test_budget_correction.certificates)); ROLLBACK;"""))
    assert Decimal(str(totals['encumbered'])) <= 100
    result = dict(issuer=issued,recipient=received,totals_at_issue=totals,provider_calls=0,billed_usd=None)
    path = OUT / plan['blind_id'] / ('phase-'+str(phase)+'-certificate.json')
    if path.exists():
        old = json.loads(path.read_text())
        assert old['issuer'] == issued and old['recipient'] == received
    else:
        save(path,result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['verify','install-gates','issue-phase'])
    parser.add_argument('--trajectory');parser.add_argument('--phase',type=int);parser.add_argument('--amount')
    args=parser.parse_args()
    plans,bindings=mapping()
    if args.action=='issue-phase':
        assert args.trajectory in plans and args.phase and args.amount
        print(canonical(issue_phase(plans[args.trajectory],bindings[args.trajectory],args.phase,Decimal(args.amount))))
    else:
        rows=[]
        for key,p in plans.items():
            identity(p,bindings[key])
            if args.action=='install-gates':
                row=install_gate(p,bindings[key]);rows.append(dict(database=p['database'],gate=row['gate'],certificates=row['certificate_count'],events=row['events']))
        print(canonical(dict(action=args.action,verified_identities=len(plans),rows=rows,provider_calls=0)))

if __name__=='__main__':main()
