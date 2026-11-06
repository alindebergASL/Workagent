"""Read-only independent install readback; never provider I/O or SQL writes."""
import argparse,json,os
from psycopg import sql
import amend_selection_recovery as S
from install_recipient_funding import identity
from workagent.capabilities.registry import adapters


def capture():
    m=json.loads(S.CANDIDATE.read_bytes())
    plans,bindings=S.G.exact_targets(m,source_amendment=m)
    result={'manifest_sha256':S.digest(S.CANDIDATE.read_bytes()),'stores':{}}
    catalog=adapters()
    for p in plans:
        b=bindings[p['blind_id']];identity(p,b)
        with S.Database(b['migration_database_url']).transaction() as c:
            c.execute('SET TRANSACTION READ ONLY')
            names=[r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()]
            tables={n:S.digest(S.canonical(c.execute(sql.SQL('SELECT to_jsonb(t) row FROM {} t ORDER BY to_jsonb(t)::text').format(sql.Identifier(n))).fetchall())) for n in names}
            migrated=S.schema_state(c,m)
            pins=0
            for row in c.execute('SELECT data FROM tool_grants').fetchall():
                for pin in row['data']['capabilities']:
                    descriptor=catalog[pin['id']].descriptor
                    assert pin=={k:getattr(descriptor,k) for k in pin}
                    pins+=1
            diagnostics=c.execute('SELECT count(*) n FROM selection_rejection_diagnostics').fetchone()['n'] if migrated else 0
            if p['blind_id']==S.TRIAL:
                saved,raw=S.saved_binding()
                assert c.execute('SELECT id,phase,kind,data FROM responses_events WHERE attempt_id=%s ORDER BY phase,kind,id',(S.ATTEMPT,)).fetchall()==saved['events']
                assert c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s ORDER BY phase',(S.ATTEMPT,)).fetchall()==saved['steps']
                if migrated:
                    row=c.execute('SELECT * FROM selection_rejection_diagnostics WHERE result_event_id=%s',(saved['result_event_id'],)).fetchone()
                    assert row==dict(result_event_id=saved['result_event_id'],read_event_id=saved['read_event_id'],diagnostic_bytes=raw.decode(),diagnostic_sha256=S.digest(raw))
            result['stores'][p['blind_id']]=dict(database=p['database'],tables=tables,migrated=migrated,pins=pins,diagnostics=diagnostics,fiscal=S.G.preserved_rows(p['database']))
    for name,table in [('controller','operations'),('bridge','receipts')]:
        with S.G.readonly(S.CAMPAIGN/(name+'.sqlite')) as c:
            assert S.G.logical(c,table)==m['successor']['journals'][table]
    from test_accounting_correction import pg,PRIMARY
    result['issuer']=json.loads(pg(PRIMARY,"""BEGIN READ ONLY; SELECT jsonb_build_object(
      'adjustments',(SELECT count(*) FROM test_budget_correction.releases),
      'released',(SELECT sum(released_usd)::text FROM test_budget_correction.releases),
      'certificates',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM test_budget_correction.certificates t)); ROLLBACK;"""))
    return result


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser();parser.add_argument('stage',choices=['before','after']);args=parser.parse_args()
    value=capture();path=S.OUT/('READBACK_'+args.stage.upper()+'.json')
    if args.stage=='before':
        assert all(not r['migrated'] for r in value['stores'].values())
    else:
        before=json.loads((S.OUT/'READBACK_BEFORE.json').read_bytes())
        assert before['manifest_sha256']==value['manifest_sha256'] and before['issuer']==value['issuer']
        assert len(value['stores'])==12 and value['issuer']['adjustments']==186
        preserved=0
        for key,old in before['stores'].items():
            new=value['stores'][key]
            assert new['migrated'] and new['pins']==old['pins'] and new['fiscal']==old['fiscal']
            assert new['diagnostics']==(1 if key==S.TRIAL else 0)
            for name,h in old['tables'].items():
                if name!='schema_migrations':assert new['tables'][name]==h;preserved+=1
        assert S.AM.load()==json.loads(S.CANDIDATE.read_bytes())
        assert S.digest((S.SLOT/'application.json').read_bytes())==S.AM.load()['application_after_sha256']
        value['preserved_original_table_instances']=preserved
    S.G.exact_bytes(path,(S.canonical(value)+'\n').encode())
    print(S.canonical(dict(stage=args.stage,stores=len(value['stores']),pins=sum(v['pins'] for v in value['stores'].values()),all_migrated=all(v['migrated'] for v in value['stores'].values()),issuer_adjustments=value['issuer']['adjustments'],provider_io=0)))

if __name__=='__main__':main()
