"""Independent narrow reviewer probes; disposable SQL only, no paid calls."""
from dataclasses import replace
import secrets

import psycopg
import pytest

from test_domain import context
from test_conversations import conversation, post
from test_workspace_files_pg import make, text
from test_workspace_file_gateway_pg import install, call
from test_run_output_workflow import install_workflow
from test_research_pg import material
from research_http_fixture import URL
from workagent import public_retrieval
from workagent.capabilities import registry, policy, research_adapters as R
from workagent.capabilities.broker import CapabilityBroker
from workagent.capabilities.models import InputRef
from workagent.db import Database
from workagent.errors import DomainError
from workagent.service import digest, encoded


def test_cost_only_draft_never_becomes_output_authority(context, monkeypatch):
    s,p,ws,_,admin=context
    cv,_,_=make(context)
    cap,g,q=install(context,cv,[],['files.create_draft','artifacts.export'],allow_run_outputs=True)
    adapters=registry.adapters(); original=adapters['files.create_draft']; effects=[]
    def revoke_after_effect(*args):
        result=original.invoke_fenced(*args)
        effects.append(result)
        with Database(admin).transaction() as c:
            c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
        return result
    adapters['files.create_draft']=replace(original,invoke_fenced=revoke_after_effect)
    monkeypatch.setattr(registry,'adapters',lambda:adapters)
    request=call(cap,q,'files.create_draft',dict(kind='files_create_draft',source=text('Retained cost-only draft').model_dump()),[])
    observation=CapabilityBroker(s,cap).call(request)
    assert len(effects)==1
    assert observation.status=='cost_only' and observation.output is None
    with s.db.transaction() as c:
        assert c.execute('SELECT tool_run_output_resources(%s,%s) AS refs',(ws,q.run.id)).fetchone()['refs']==[]
        assert c.execute('SELECT count(*) AS n FROM tool_cost_entries WHERE attempt_id=%s',(observation.attempt_id,)).fetchone()['n']==2
    with pytest.raises(DomainError): CapabilityBroker(s,cap).call(request)
    assert len(effects)==1


@pytest.mark.parametrize('phase',['reserved_before_dispatch','exported_before_reduction'])
def test_capture_reduction_fences_derived_exports(context,monkeypatch,phase):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1')
    monkeypatch.setattr(public_retrieval,'fetch_public_source',lambda url,**kw:material(url,'Exact public evidence.'))
    s,p,ws,_,admin=context; cv=conversation(context); q=post(context,cv)
    cap=s.claim_run(p,ws,q.run.id); g=install_workflow(context,cv,q,None)
    broker=CapabilityBroker(s,cap)
    capture=R.ResearchCapture(kind='research_capture',url=URL,allow_browser=False)
    obs=broker.call(call(cap,q,'research.capture',capture.model_dump(),R.input_refs(capture)))
    assert obs.status=='observed'
    draft=broker.call(call(cap,q,'files.create_draft',dict(kind='files_create_draft',source=text('Derived from exact public evidence.').model_dump()),[]))
    own=draft.output['result']['current']
    ref=InputRef(kind='workspace_file',id=own['workspace_file_id'],version=own['version_id'],sha256=own['sha256'])
    request=call(cap,q,'artifacts.export',dict(kind='artifacts_export',input_ref=ref.model_dump(),format='txt'),[ref])
    if phase=='reserved_before_dispatch':
        secret=secrets.token_urlsafe(32)
        with s.db.transaction() as c:
            aid=c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) AS id',
                (ws,q.run.id,cap.fence,digest(cap.secret),encoded(request),digest(secret))).fetchone()['id']
    else:
        exported=broker.call(request)
        assert exported.status=='observed'
        export_id=exported.output['result']['export_id']
        assert s.download_export(p,ws,export_id)[1]==b'Derived from exact public evidence.'
    policy.restrict_resources(Database(admin),g.id,[R.input_refs(capture)[0]])
    with s.db.transaction() as c:
        assert c.execute('SELECT tool_run_output_resources(%s,%s) AS refs',(ws,q.run.id)).fetchone()['refs']==[]
    if phase=='reserved_before_dispatch':
        with pytest.raises(psycopg.Error),s.db.transaction() as c:
            c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s)',(aid,cap.fence,digest(cap.secret),secret))
        with s.db.transaction() as c:
            assert c.execute('SELECT count(*) AS n FROM tool_attempt_events WHERE attempt_id=%s',(aid,)).fetchone()['n']==0
            assert c.execute('SELECT count(*) AS n FROM tool_cost_entries WHERE attempt_id=%s',(aid,)).fetchone()['n']==1
    else:
        with pytest.raises(DomainError):s.download_export(p,ws,export_id)
        with pytest.raises(DomainError):s.get_artifact(p,ws,ref.id)
