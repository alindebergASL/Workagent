"""Production parent worker + actual isolated children + live TCP/native activity.

Selection transport is deterministic/no-provider. Assertions are independent test
oracles, not a live-model usefulness or wall-time improvement claim.
"""
import asyncio
from hashlib import sha256
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch
import pytest
from textual.app import App
from textual.widgets import Select,TextArea
from test_domain import context
from test_delegation_pg import setup,VERIFY,DATA
from test_conversations import conversation,post
from test_general_alpha_runtime import activate,AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_compute_http_pg import http_api
from workagent.capabilities.delegation_composition import SCHEMA,POLICY
from workagent.capabilities import policy
from workagent.db import Database
from workagent.operator_client import OperatorClient
from workagent.tui.tool_activity import ToolActivityController,receipt_text
from workagent.tui.tool_activity_screen import ToolActivityScreen


def verifier(index):
    def decision(ctx):
        children=[x['capability_result']['result'] for x in ctx['adaptive']['observations']
                  if (x.get('capability_result') or {}).get('capability')=='delegate_analysis']
        child=children[index]
        assert child['state']=='proposal'
        return {'kind':'verify_delegate','child_attempt_id':child['child_attempt_id'],
                'proposal_sha256':child['proposal_sha256'],'inspection':'Inspect exact regional rows; recompute sum and mean with rational arithmetic',
                'code':VERIFY}
    return decision


def draft(ctx):
    checked=[x['capability_result']['result'] for x in ctx['adaptive']['observations']
             if (x.get('capability_result') or {}).get('capability')=='verify_delegate']
    assert len(checked)==2 and all(x['state']=='checks_passed' for x in checked)
    from fractions import Fraction
    means={x['proposal']['source']:Fraction(x['proposal']['mean']) for x in checked}
    text=f"West mean {means['west.csv']} seconds; East mean {means['east.csv']} seconds. East is {means['east.csv']-means['west.csv']} seconds higher.\nTwo disjoint child analyses were independently checked by the parent. Synthetic deterministic evidence, not a paid multi-agent benefit claim."
    return {'kind':'files_create_draft','source':{'kind':'text','filename':'verified-regional-comparison.txt',
            'mime_type':'text/plain','content':text,'sha256':sha256(text.encode()).hexdigest()}}


@pytest.mark.parametrize('restart',[False,True])
def test_production_worker_child_checkpoints_assimilation_and_restart(context,tmp_path,restart):
    s,p,ws,_,_=context;cv=conversation(context)
    with patch('test_general_alpha_runtime.POLICY',POLICY),patch('test_general_alpha_runtime.DECISION_SCHEMA',SCHEMA):
        pg=activate(context,cv,continuity_version='sustained-v1',max_steps=6)
    cap,g,q,requests=setup(context,cv=cv,claim=False,extra=('files.create_draft',),provider_grant_id=pg.id)
    fake=AlphaProvider([*(r.model_dump() for r in requests),verifier(0),verifier(1),draft,
                       {'kind':'reply','text':'The verified comparison is saved as a draft: West 120 seconds, East 180 seconds; East is 60 seconds higher. No human acceptance or paid-agent benefit is claimed.'}])
    process_receipts=[]
    if restart:
        spec=tmp_path/'restart.json'
        spec.write_text(json.dumps({'workspace_id':ws,'principal_id':p.id,'run_id':q.run.id,'children':[r.model_dump() for r in requests]}))
        script=Path(__file__).with_name('delegation_restart_worker.py')
        with (tmp_path/'worker-interrupt.log').open('w') as log:
            first=subprocess.run([sys.executable,str(script),str(spec),'interrupt'],stdout=log,stderr=subprocess.STDOUT,timeout=180)
        assert first.returncode==71,(tmp_path/'worker-interrupt.log').read_text()
        process_receipts.append(json.loads(spec.with_suffix('.result.json').read_text()))
        from test_runtime import expire
        expire(context,q.run.id)
        with (tmp_path/'worker-resume.log').open('w') as log:
            second=subprocess.run([sys.executable,str(script),str(spec),'resume'],stdout=log,stderr=subprocess.STDOUT,timeout=300)
        assert second.returncode==0,(tmp_path/'worker-resume.log').read_text()
        process_receipts.append(json.loads(spec.with_suffix('.result.json').read_text()))
        assert process_receipts[0]['pid']!=process_receipts[1]['pid']
        result=s.get_run(p,ws,q.run.id)
    else:
        result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='ready', result.model_dump()
    detail=s.get_conversation(p,ws,cv.id)
    assert 'East is 60 seconds higher' in detail.messages[-1].text
    with s.db.transaction() as c:
        rows=c.execute("SELECT a.id,a.capability_id,e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' WHERE a.workspace_id=%s AND a.run_id=%s ORDER BY a.created_at",(ws,q.run.id)).fetchall()
        assert len(rows)==5 and [r['capability_id'] for r in rows].count('delegation.analysis')==2
        assert c.execute('SELECT 1 FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
        assert c.execute('SELECT provider_grant_id FROM tool_budget_accounts WHERE id=%s',(g.budget_account_id,)).fetchone()['provider_grant_id']==pg.id
    calls=list(fake.calls); assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready';assert fake.calls==calls
    if os.environ.get('DELEGATION_EVIDENCE_DIR'):
        dest=Path(os.environ['DELEGATION_EVIDENCE_DIR']); dest.mkdir(exist_ok=True,parents=True)
        (dest/f'parent-worker-{restart}.json').write_text(json.dumps({'run_id':q.run.id,'workspace_id':ws,'conversation_id':cv.id,
            'state':result.state,'restart':restart,'process_receipts':process_receipts,'no_duplicate_launch':True,'paid_product_calls':0,
            'transport':'controlled selection; real GeneralWorker, PG and gVisor children', 'tool_observations':rows},indent=2))


@pytest.mark.parametrize('size',[(120,40),(80,24)])
def test_live_tcp_native_activity_clear_on_revoke(context,http_api,size):
    from test_delegation_pg import launch,verify
    s,p,ws,_,admin=context;cap,g,q,requests=setup(context)
    child=launch(context,cap,q,requests[0]);check=verify(context,cap,q,child)
    assert check.output['result']['state']=='checks_passed'
    with patch.dict(os.environ,{'WORKAGENT_OPERATOR_URL':str(http_api.base_url).rstrip('/')}):
        client=OperatorClient()
    controller=ToolActivityController(client,ws,p.id,q.run.id)
    page=controller.listing();assert len(page.items)==2
    texts=[receipt_text(i,ws) for i in page.items]
    assert any('unreviewed' in t for t in texts) and any('checks_passed' in t for t in texts)
    async def check_screen():
        app=App();screen=ToolActivityScreen(client,ws,p.id,[{'id':q.run.id,'state':'running'}])
        async with app.run_test(size=size) as pilot:
            app.push_screen(screen)
            for _ in range(60):
                await pilot.pause(.1)
                if screen.page is not None:break
            assert screen.page is not None
            screen.query_one('#tool-attempt',Select).value=child.attempt_id;await pilot.pause(.2)
            assert 'Parent verification: unreviewed' in screen.query_one('#tool-receipt',TextArea).text
            screen.query_one('#tool-attempt',Select).value=check.attempt_id;await pilot.pause(.2)
            text=screen.query_one('#tool-receipt',TextArea).text
            assert 'checks_passed' in text and 'independent rational mean' in text
            if os.environ.get('DELEGATION_EVIDENCE_DIR'):
                dest=Path(os.environ['DELEGATION_EVIDENCE_DIR'])
                app.save_screenshot(filename=f'native-activity-{size[0]}.svg',path=str(dest))
                (dest/f'native-activity-{size[0]}.txt').write_text(text)
            policy.restrict_resources(Database(admin),g.id,[g.resource_selectors[1]])
            screen.action_refresh()
            for _ in range(60):
                await pilot.pause(.1)
                if not screen.busy:break
            assert screen.page is None and screen.query_one('#tool-receipt',TextArea).text==''
            assert screen.exports=={}
    asyncio.run(check_screen())
    path=f'/v1/workspaces/{ws}/tool-attempts/{child.attempt_id}'
    response=http_api.get(path,headers={'Authorization':'Bearer '+os.environ['LOCAL_BEARER_TOKEN'],'X-Schema-Version':'workagent/v1','X-Request-Id':'delegation-revoke'})
    assert response.status_code==404 and child.output_sha256 not in response.text
