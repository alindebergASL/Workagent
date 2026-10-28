"""No paid model: controlled selection transport, real worker/gateway/gVisor/PG."""
from datetime import timedelta
from hashlib import sha256
from unittest.mock import patch
import pytest
from test_domain import context
from test_conversations import conversation,post
from test_general_alpha_runtime import activate,AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.capabilities.compute_composition import POLICY,SCHEMA
from workagent.capabilities import registry,policy
from workagent.capabilities.models import ToolGrantV1,CapabilityPin
from workagent.models import new_id,now
from workagent.db import Database


@pytest.mark.parametrize('restart',[False,True])
def test_compute_exact_schema_worker_checkpoint_and_restart(context,tmp_path,restart):
    s,p,ws,_,admin=context;cv=conversation(context)
    with patch('test_general_alpha_runtime.POLICY',POLICY),patch('test_general_alpha_runtime.DECISION_SCHEMA',SCHEMA):
        activate(context,cv,continuity_version='sustained-v1',max_steps=3)
    q=post(context,cv,'Run the supplied small Python checks and retain a real downloadable output.')
    d=registry.adapters()['compute.python'].descriptor
    grant=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256)],
        resource_selectors=[],effects=d.effects,privacy_classes=['workspace_private'],egress='none',
        expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),grant,limits={'local_compute':5})
    fake=AlphaProvider([{'kind':'compute_python','code':"assert sum([2,3,4])==9; open('/outputs/checks.txt','w').write('supplied assertion passed; not goal verification')",'inputs':[]},
                        {'kind':'reply','text':'The supplied check passed inside the confined worker; the actual output file is retained.'}])
    if restart:
        def crash(name):
            if name=='after_tool_result': raise SystemExit('controlled restart after real computation')
        with pytest.raises(SystemExit): worker(context,fake,tmp_path,hook=crash).work(p,ws,q.run.id)
        from test_runtime import expire
        expire(context,q.run.id)
    result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='ready'
    with s.db.transaction() as c:
        rows=c.execute("SELECT e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' WHERE a.workspace_id=%s AND a.run_id=%s",(ws,q.run.id)).fetchall()
        assert len(rows)==1 and rows[0]['data']['status']=='observed'
        assert c.execute('SELECT 1 FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
    output=rows[0]['data']['output']['result']['outputs'][0]
    assert s.download_export(p,ws,output['export_id'])[1]==b'supplied assertion passed; not goal verification'
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==calls
