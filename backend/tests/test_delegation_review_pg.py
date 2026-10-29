"""Focused independent-review regressions; live child process where marked."""
import json
from concurrent.futures import ThreadPoolExecutor
import psycopg
import pytest
from test_domain import context
from test_delegation_pg import setup, launch, simple, verify, CODE
from test_workspace_file_gateway_pg import call
from workagent.capabilities.broker import CapabilityBroker
from workagent.capabilities.delegation import parse_proposal, processor_ref
from workagent.db import Database
from workagent.errors import DomainError
from workagent.service import Service,digest,encoded


@pytest.mark.parametrize('text',['{"x":1e999}','{"nested":[-1e999]}','{"x":NaN}','{"x":Infinity}','{"x":1,"x":2}'])
def test_invalid_numeric_or_duplicate_json_rejected(text):
    with pytest.raises(ValueError):parse_proposal(text)


def test_finite_numeric_json_preserved():
    assert parse_proposal('{"x":1.25,"nested":[-2,0,1e3]}')=={'x':1.25,'nested':[-2,0,1000.0]}


def test_compute_export_cannot_assimilate_unreviewed_child(context):
    s,p,ws,_,_=context;cap,g,q,requests=setup(context,extra=('compute.python',))
    o=launch(context,cap,q,requests[0]);assert o.output['result']['state']=='proposal'
    request=call(cap,q,'compute.python',{'kind':'compute_python','code':"open('/outputs/result.txt','w').write('West total 240')",'inputs':[]},[])
    with pytest.raises((DomainError,psycopg.Error)):CapabilityBroker(s,cap).call(request)
    with s.db.transaction() as c:assert c.execute('SELECT count(*) AS n FROM artifact_exports WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
    assert verify(context,cap,q,o).output['result']['state']=='checks_passed'
    result=CapabilityBroker(s,cap).call(request)
    assert result.status=='observed'
    m=result.output['result']['outputs'][0]
    assert s.download_export(p,ws,m['export_id'])[1]==b'West total 240'


def test_explicit_discard_recovers_without_false_success_or_refund(context):
    s,p,ws,_,_=context;cap,g,q,_=setup(context,sources=False,extra=('compute.python',))
    bad=launch(context,cap,q,simple('incorrect',code='print("{\\"total\\":999}")'))
    failed=verify(context,cap,q,bad,"import json; p=json.load(open('/inputs/child.json')); assert p['proposal']['total']==7")
    assert failed.output['result']['state']=='checks_failed'
    discarded=verify(context,cap,q,bad,"import json; p=json.load(open('/inputs/child.json')); assert p['proposal']['total']!=7; print(json.dumps({'passed':False,'checks':['Total 999 differs from independently expected 7; discard']}))")
    assert discarded.output['result']['state']=='discarded' and discarded.output['result']['proposal'] is None
    good=launch(context,cap,q,simple('correct',code='print("{\\"total\\":7}")'))
    checked=verify(context,cap,q,good,"import json; p=json.load(open('/inputs/child.json')); assert p['proposal']['total']==sum((3,4)); print(json.dumps({'passed':True,'checks':['Independent sum 3+4']}))")
    assert checked.output['result']['state']=='checks_passed'
    request=call(cap,q,'compute.python',{'kind':'compute_python','code':"open('/outputs/corrected.txt','w').write('Corrected total 7; first child discarded')",'inputs':[]},[])
    assert CapabilityBroker(s,cap).call(request).status=='observed'
    with s.db.transaction() as c:
        assert c.execute('SELECT delegation_reviewed(%s,%s) AS ok',(ws,q.run.id)).fetchone()['ok']
        assert c.execute("SELECT sum(e.units) AS n FROM tool_cost_entries e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.account_id=%s AND e.kind='reserved' AND e.category='child'",(g.budget_account_id,)).fetchone()['n']==2


def test_live_overflow_is_failed_not_silently_normalized_proposal(context):
    cap,g,q,_=setup(context,sources=False)
    result=launch(context,cap,q,simple('overflow',code='print(\'{"value":1e999}\')'))
    assert result.status=='observed' and result.output['result']['state']=='failed'
    assert result.output['result']['proposal'] is None and result.output['result']['proposal_sha256'] is None
    assert result.output['result']['execution']['stdout_sha256']


def test_actual_reclaim_rotates_fence_and_blocks_changed_unknown_launch(context):
    from test_runtime import expire
    s,p,ws,_,_=context;cap,g,q,_=setup(context,sources=False)
    request=call(cap,q,'delegation.analysis',simple().model_dump(),[processor_ref()]);secret='synthetic-receipt'
    with s.db.transaction() as c:
        aid=c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) AS id',(ws,q.run.id,cap.fence,digest(cap.secret),encoded(request),digest(secret))).fetchone()['id']
        assert c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) AS sent',(aid,cap.fence,digest(cap.secret),secret)).fetchone()['sent']
    expire(context,q.run.id);fresh=Service(s.db).claim_run(p,ws,q.run.id)
    assert fresh.fence>cap.fence
    with pytest.raises((DomainError,psycopg.Error)):launch(context,fresh,q,simple('changed after real reclaim'))
    with s.db.transaction() as c:assert c.execute('SELECT count(*) AS n FROM tool_attempts WHERE run_id=%s',(q.run.id,)).fetchone()['n']==1


def test_two_concurrent_distinct_children_share_one_account(context):
    s,p,ws,_,_=context;cap,g,q,_=setup(context,sources=False)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda i:launch(context,cap,q,simple(str(i))),range(2)))
    assert all(o.status=='observed' and o.output['result']['state']=='proposal' for o in results)
    assert {o.output['result']['authority']['budget_account_id'] for o in results}=={g.budget_account_id}


def test_exact_proposal_hash_forgery_rejected(context):
    from workagent.capabilities.delegation import VerifyDelegate,input_refs
    s,p,ws,_,_=context;cap,g,q,_=setup(context,sources=False)
    result=launch(context,cap,q,simple())
    request=VerifyDelegate(kind='verify_delegate',child_attempt_id=result.attempt_id,proposal_sha256='0'*64,inspection='forged digest',code='pass')
    with pytest.raises(DomainError):input_refs(s,cap,request)
