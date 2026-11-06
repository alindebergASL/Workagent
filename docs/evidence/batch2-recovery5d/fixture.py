"""A14-only synthetic fixtures; no model worker/transport or authority edits."""
from pathlib import Path
import sys, os, json, hashlib
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from workagent.db import Database
from workagent.fixture import seed
from workagent.service import Service, Principal
from workagent.models import CreateConversation
from test_domain import cmd
OUT=ROOT/'docs/evidence/batch2-recovery5d'
WS='recovery5d-scope'; PRIVATE='recovery5d-a-only'; A='local-human'; B='recovery5d-other'
assert '/workagent_test_' in os.environ['DATABASE_URL']
s=Service(Database());p=Principal(A)
def save(name,data):
    with (OUT/(name+'.json')).open('x') as f:json.dump(data,f,indent=2,default=str,ensure_ascii=False);f.write('\n')
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,default=str).encode()).hexdigest()
def audit():
    with s.db.transaction() as c:
        identity=c.execute('SELECT current_database() db,current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
        names=[r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE '%ledger%' OR tablename LIKE '%dispatch%' OR tablename LIKE '%grant%' OR tablename LIKE '%usage%')").fetchall()]
        tables={n:c.execute('SELECT to_jsonb(t) value FROM '+n+' t ORDER BY to_jsonb(t)::text').fetchall() for n in names}
        old=c.execute("SELECT to_jsonb(t) value FROM source_access t WHERE workspace_id='recovery5a-workspace' ORDER BY to_jsonb(t)::text").fetchall()
        old_memberships=c.execute("SELECT to_jsonb(t) value FROM memberships t WHERE workspace_id='recovery5c-scope' ORDER BY to_jsonb(t)::text").fetchall()
        cv=c.execute('SELECT to_jsonb(t) value FROM conversations t WHERE workspace_id=%s ORDER BY to_jsonb(t)::text',(WS,)).fetchall()
    return {'identity':dict(identity),'ledger_tables':{n:{'count':len(r),'sha256':digest(r)} for n,r in tables.items()},'preexisting_source_access_sha256':digest(old),'preexisting5c_memberships_sha256':digest(old_memberships),'fixture_conversations':cv}
mode=sys.argv[1]
if mode=='seed':
    assert not (OUT/'fixture.json').exists()
    save('audit-before',audit())
    seed(os.environ['MIGRATION_DATABASE_URL'],[],WS,A)
    seed(os.environ['MIGRATION_DATABASE_URL'],[],PRIVATE,A)
    with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'owner')",(WS,B))
    a=s.create_conversation(p,WS,cmd(CreateConversation,title='A14 shared synthetic conversation',selected_source_refs=[]))
    b=s.create_conversation(p,WS,cmd(CreateConversation,title='A14 other synthetic conversation',selected_source_refs=[]))
    assert s.get_conversation(Principal(B),WS,a.id).conversation.id==a.id
    save('fixture',{'workspace':WS,'private_workspace':PRIVATE,'principal_a':A,'principal_b':B,'conversation':a.id,'other_conversation':b.id,'purpose':'Shared canonical access; local unsent drafts and staged originals must be private to authenticated principal+backend.'})
    save('audit-seeded',audit())
    print('Synthetic fixture created and canonical readback verified; no provider effects.')
elif mode=='revoke':
    assert not (OUT/'revoked.json').exists(), 'Never retry a completed revocation'
    with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:
        before=c.execute('SELECT to_jsonb(t) value FROM memberships t WHERE workspace_id=%s ORDER BY principal_id',(WS,)).fetchall()
        result=c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s AND active=true',(WS,A))
        assert result.rowcount==1
        after=c.execute('SELECT to_jsonb(t) value FROM memberships t WHERE workspace_id=%s ORDER BY principal_id',(WS,)).fetchall()
    save('revoked',{'before':before,'after':after})
    print('Fresh A membership revoked once and read back; old fixtures untouched.')
elif mode.startswith('audit-'):
    save(mode,audit());print('Audit recorded without secrets.')
elif mode=='api':
    import uvicorn
    from workagent.api import create_app, Settings
    assert sys.argv[2] in (A,B)
    port=int(sys.argv[3]);assert port in (18965,18966)
    app=create_app(Settings(os.environ['DATABASE_URL'],True,os.environ['LOCAL_BEARER_TOKEN'],sys.argv[2],fixture_mode=True))
    uvicorn.run(app,host='127.0.0.1',port=port,log_level='warning')
