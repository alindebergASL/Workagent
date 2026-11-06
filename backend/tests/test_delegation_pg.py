"""Real PG/gVisor child processes, no paid provider and no host code fallback."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from hashlib import sha256
import json
import os
from pathlib import Path
import time
from unittest.mock import patch
import psycopg
import pytest
from test_domain import context, cmd
from test_conversations import conversation, post
from workagent.capabilities import registry, policy, observations
from workagent.capabilities.broker import CapabilityBroker
from workagent.capabilities.delegation import DelegateAnalysis, VerifyDelegate, launch_refs, processor_ref
from workagent.capabilities.models import ToolGrantV1, CapabilityPin
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import new_id, now, CancelConversation
from workagent.service import Service, digest, encoded
from workagent.workspace_file_models import CreateWorkspaceFile, WorkingText
from test_workspace_file_gateway_pg import call

DATA = {'west.csv':'item,seconds\na,60\nb,180\n','east.csv':'item,seconds\nc,120\nd,240\n'}
CODE = """import csv,json,os,socket
from decimal import Decimal
from pathlib import Path
files=list(Path('/inputs').glob('*.csv'))
assert len(files)==1
assert set(p.name for p in Path('/inputs').iterdir())=={'main.py','task.json',files[0].name}
a=json.load(open('/inputs/task.json'))['authority']
assert a['nested_delegation'] is False and a['accept'] is False and a['memory_admission'] is False
assert not any(k in os.environ for k in ('DATABASE_URL','LOCAL_BEARER_TOKEN','OPENAI_API_KEY'))
try:
 socket.create_connection(('1.1.1.1',443),timeout=.2)
 raise AssertionError('network reachable')
except OSError:pass
values=[Decimal(r['seconds']) for r in csv.DictReader(files[0].open())]
print(json.dumps({'rows':len(values),'total':str(sum(values)),'mean':str(sum(values)/len(values)), 'source':files[0].name}))
"""
VERIFY = """import csv,json
from fractions import Fraction
from pathlib import Path
p=json.load(open('/inputs/child.json'))['proposal']
rows=list(csv.DictReader(next(Path('/inputs').glob('*.csv')).open()))
values=[Fraction(x['seconds']) for x in rows]
assert p['rows']==len(rows) and Fraction(p['total'])==sum(values) and Fraction(p['mean'])==sum(values)/len(values)
print(json.dumps({'passed':True,'checks':['exact source rows','independent rational sum','independent rational mean']}))
"""


def setup(ctx, *, limit=2, sources=True, extra=(), q=None, cv=None, claim=True, provider_grant_id=None):
    s,p,ws,_,admin=ctx
    cv=cv or conversation(ctx); items=[]
    if sources:
        for name,raw in DATA.items():
            f=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,expected_work_version=cv.work_version,
                source=WorkingText(kind='text',filename=name,mime_type='text/csv',content=raw,sha256=sha256(raw.encode()).hexdigest())))
            items.append({'name':name,'ref':f.current.model_dump()})
    q=q or post(ctx,cv,'Compare the two independent regional timing summaries and retain the verified comparison.')
    cap=s.claim_run(p,ws,q.run.id) if claim else None
    names=['delegation.analysis','delegation.verify',*extra]
    desc=[registry.adapters()[n].descriptor for n in names]
    requests=[DelegateAnalysis(kind='delegate_analysis',task='Summarize '+i['name'],independent_benefit='Independent disjoint regional inputs',
                output_contract='JSON rows, total seconds and mean seconds with exact decimals',code=CODE,inputs=[i]) for i in items]
    selectors=[processor_ref()]
    for r in requests:selectors.extend(launch_refs(r)[:-1])
    grant=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in desc],
        resource_selectors=selectors,effects=['read','local_compute','draft'],privacy_classes=['workspace_private'],egress='none',
        expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),grant,limits={'child':limit,'local_compute':8,'rendering':2},provider_grant_id=provider_grant_id)
    return cap,grant,q,requests


def launch(ctx,cap,q,request):
    return CapabilityBroker(ctx[0],cap).call(call(cap,q,'delegation.analysis',request.model_dump(),launch_refs(request)))


def simple(task='test',code='print("{\\"value\\":7}")'):
    return DelegateAnalysis(kind='delegate_analysis',task=task,independent_benefit='Independent bounded check',output_contract='JSON object',code=code,inputs=[])


def verify(ctx,cap,q,obs,code=VERIFY):
    request=VerifyDelegate(kind='verify_delegate',child_attempt_id=obs.attempt_id,proposal_sha256=obs.output['result']['proposal_sha256'],
                           inspection='Inspect exact input and child proposal; recompute with independent rational implementation',code=code)
    from workagent.capabilities.delegation import input_refs
    return CapabilityBroker(ctx[0],cap).call(call(cap,q,'delegation.verify',request.model_dump(),input_refs(ctx[0],cap,request)))


def test_actual_disjoint_children_independent_check_and_assimilation(context):
    s,p,ws,_,_=context
    cap,g,q,requests=setup(context,extra=('files.create_draft',))
    # Two actual child service invocations, isolated input directories; parent
    # remains the only product worker and retains all evidence/usage.
    results=[launch(context,cap,q,r) for r in requests]
    assert all(o.status=='observed' and o.output['result']['state']=='proposal' for o in results), [o.model_dump() for o in results]
    assert [o.output['result']['proposal']['total'] for o in results]==['240','360']
    for o,r in zip(results,requests):
        assert o.output['result']['authority']['sources']==[x.model_dump() for x in launch_refs(r)[:-1]]
        assert o.cost.cpu_ms>0 and o.output['result']['execution']['cleanup_verified']
        assert o.output['result']['provider_calls']==0
    with s.db.transaction() as c:
        assert not c.execute('SELECT delegation_reviewed(%s,%s) AS ok',(ws,q.run.id)).fetchone()['ok']
    source=WorkingText(kind='text',filename='comparison.txt',mime_type='text/plain',content='West mean 120s; East mean 180s. East is 60s higher.',sha256=sha256(b'West mean 120s; East mean 180s. East is 60s higher.').hexdigest())
    publish=call(cap,q,'files.create_draft',{'kind':'files_create_draft','source':source.model_dump()},[])
    with pytest.raises((DomainError,psycopg.Error)):CapabilityBroker(s,cap).call(publish)
    checks=[verify(context,cap,q,o) for o in results]
    assert all(c.output['result']['state']=='checks_passed' for c in checks)
    draft=CapabilityBroker(s,cap).call(publish)
    assert draft.status=='observed'
    saved=s.get_artifact(p,ws,draft.output['result']['workspace_file_id'])
    assert saved.current_revision.author_kind=='worker'
    assert CapabilityBroker(Service(s.db),cap).call(publish)==draft
    with s.db.transaction() as c:
        assert c.execute('SELECT delegation_reviewed(%s,%s) AS ok',(ws,q.run.id)).fetchone()['ok']
        assert c.execute("SELECT sum(e.units) AS n FROM tool_cost_entries e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.account_id=%s AND e.kind='reserved' AND e.category='child'",(g.budget_account_id,)).fetchone()['n']==2
        assert c.execute('SELECT count(*) AS n FROM memory_items WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
    evidence=os.environ.get('DELEGATION_EVIDENCE_DIR')
    if evidence:
        dest=Path(evidence);dest.mkdir(exist_ok=True,parents=True)
        (dest/'actual-children.json').write_text(json.dumps([o.model_dump(mode='json') for o in results],indent=2))
        (dest/'parent-verification.json').write_text(json.dumps([o.model_dump(mode='json') for o in checks],indent=2))
        (dest/'comparison.txt').write_text(source.content)
        (dest/'assimilation.json').write_text(draft.model_dump_json(indent=2))


def test_failed_verification_not_assimilation_or_memory(context):
    s,p,ws,_,_=context;cap,g,q,requests=setup(context)
    o=launch(context,cap,q,requests[0]); assert o.status=='observed'
    failed=verify(context,cap,q,o,"raise AssertionError('independent check failed')")
    assert failed.output['result']['state']=='checks_failed' and failed.output['result']['proposal'] is None
    evidence={'kind':'tool_observation','conversation_id':q.conversation.id,'event_id':o.attempt_id,'sha256':digest(o.model_dump(mode='json'))}
    with s.db.transaction() as c:
        assert not c.execute('SELECT delegation_reviewed(%s,%s) AS ok',(ws,q.run.id)).fetchone()['ok']
        assert not c.execute('SELECT memory_procedure_evidence_authorized(%s,%s,%s,%s,%s) AS ok',
                             (ws,p.id,'task',q.conversation.id,encoded(evidence))).fetchone()['ok']


def test_source_and_processor_intersection_prevent_leakage(context):
    s,p,ws,_,admin=context;cap,g,q,requests=setup(context)
    policy.restrict_resources(Database(admin),g.id,launch_refs(requests[1])[:-1])
    with pytest.raises((DomainError,psycopg.Error)):launch(context,cap,q,requests[1])
    o=launch(context,cap,q,requests[0]);assert o.output['result']['state']=='proposal'
    policy.restrict_resources(Database(admin),g.id,[processor_ref()])
    with pytest.raises((DomainError,psycopg.Error)):verify(context,cap,q,o)
    with pytest.raises(DomainError):observations.page(s,p,ws,q.run.id)


def test_concurrent_children_reserve_shared_budget_once(context):
    s,p,ws,_,_=context;cap,g,q,_=setup(context,limit=1,sources=False)
    def do(i):
        try:return launch(context,cap,q,simple(str(i))).status
        except (DomainError,psycopg.Error):return 'denied'
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(do,range(2)))
    assert results.count('observed')==1 and results.count('denied')==1
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) AS n FROM tool_attempts WHERE run_id=%s",(q.run.id,)).fetchone()['n']==1


def test_hard_two_child_bound_independent_of_account_capacity(context):
    cap,g,q,_=setup(context,limit=3,sources=False)
    for i in range(2):assert launch(context,cap,q,simple(str(i))).status=='observed'
    with pytest.raises((DomainError,psycopg.Error)):launch(context,cap,q,simple('third'))


def test_unknown_submission_no_retry_even_new_call_after_restart(context,monkeypatch):
    from workagent.sandbox.client import SandboxOutcomeUnknown
    s,p,ws,_,_=context;cap,g,q,_=setup(context,sources=False); invocations=[]
    from workagent.capabilities.delegation import client
    actual_run=client.run
    executed=[]
    def unknown(*args,**kw):
        invocations.append(1)
        executed.append(actual_run(*args,**kw))
        raise SandboxOutcomeUnknown('controlled ACK loss after actual child completion')
    monkeypatch.setattr('workagent.capabilities.delegation.client.run',unknown)
    request=call(cap,q,'delegation.analysis',simple().model_dump(),[processor_ref()])
    o=CapabilityBroker(s,cap).call(request)
    assert o.status=='outcome_unknown' and o.cost.basis=='unknown'
    assert CapabilityBroker(Service(s.db),cap).call(request)==o
    with pytest.raises((DomainError,psycopg.Error)):
        CapabilityBroker(Service(s.db),cap).call(request.model_copy(update={'call_id':new_id()}))
    with pytest.raises((DomainError,psycopg.Error)):launch(context,cap,q,simple('changed task'))
    assert invocations==[1]
    assert len(executed)==1 and executed[0]['status']=='succeeded' and executed[0]['cleanup_verified']


def test_crash_after_dispatch_blocks_duplicate_launch(context):
    s,p,ws,_,_=context;cap,g,q,_=setup(context,sources=False)
    request=call(cap,q,'delegation.analysis',simple().model_dump(),[processor_ref()]);secret='synthetic-receipt'
    with s.db.transaction() as c:
        aid=c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) AS id',(ws,q.run.id,cap.fence,digest(cap.secret),encoded(request),digest(secret))).fetchone()['id']
        assert c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) AS sent',(aid,cap.fence,digest(cap.secret),secret)).fetchone()['sent']
    for req in (request,request.model_copy(update={'call_id':new_id()})):
        with pytest.raises((DomainError,psycopg.Error)):CapabilityBroker(Service(s.db),cap).call(req)
    assert observations.page(s,p,ws,q.run.id).items[0].state=='outcome_unknown'


@pytest.mark.parametrize('change',['cancel','revoke','generation','lease','source'])
def test_actual_running_child_cancel_revoke_stale_fenced(context,change):
    s,p,ws,_,admin=context;cap,g,q,requests=setup(context)
    request=requests[0].model_copy(update={'code':"import time; time.sleep(4); print('{\"late\":true}')"})
    with ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(launch,context,cap,q,request)
        deadline=time.monotonic()+10
        while True:
            with s.db.transaction() as c:
                sent=c.execute("SELECT 1 FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='dispatch' WHERE a.run_id=%s",(q.run.id,)).fetchone()
            if sent:break
            assert time.monotonic()<deadline;time.sleep(.03)
        time.sleep(.6)
        if change=='cancel':s.cancel_conversation(p,ws,q.conversation.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
        elif change=='source':policy.restrict_resources(Database(admin),g.id,launch_refs(request)[:-1])
        elif change=='lease':
            from test_runtime import expire
            expire(context,q.run.id);Service(s.db).claim_run(p,ws,q.run.id)
        else:
            with Database(admin).transaction() as c:
                if change=='revoke':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
                else:c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
        o=future.result(timeout=15)
    assert o.status=='cost_only' and o.output is None
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM tool_cost_entries WHERE attempt_id=%s',(o.attempt_id,)).fetchone()['n']==2


def test_credentials_elevation_nested_delegation_rejected():
    from pydantic import ValidationError
    for field,value in [('token','never'),('accept',True),('delegate',{}),('effects',['external_write']),('processor','paid')]:
        with pytest.raises(ValidationError):DelegateAnalysis.model_validate({**simple().model_dump(),field:value})
