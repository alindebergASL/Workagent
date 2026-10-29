"""Restricted PG selective-scope and typed paging invariants (no network)."""
import pytest
from pydantic import ValidationError
from test_domain import context
from test_conversations import conversation
from test_github_unit import discover, response
from test_github_pg import install, execute
from workagent.capabilities import policy, github_adapters as A
from workagent.connectors import github_read as G
from workagent.db import Database
from workagent.errors import DomainError
from workagent.service import encoded


def test_selective_reduction_retains_other_repository_and_immutable_authority(context,monkeypatch):
    s,p,ws,_,admin=context;cv=conversation(context)
    denied=discover();allowed=denied.model_copy(update={'repository':'psf/requests'})
    cap,g,q=install(context,cv,[denied,allowed]);sent=[]
    def fetch(req):
        sent.append(req.repository)
        return response([{'number':1,'title':req.repository+' retained title'}])
    monkeypatch.setattr(G,'fetch',fetch)
    a,_=execute(s,cap,q,denied);b,_=execute(s,cap,q,allowed)
    ref=A.input_refs(denied)[0]
    with s.db.transaction() as c:
        original=c.execute('SELECT data FROM tool_grants WHERE id=%s',(g.id,)).fetchone()['data']
        receipts=c.execute('SELECT e.data FROM tool_attempt_events e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.created_at',(q.run.id,)).fetchall()
    policy.restrict_resources(Database(admin),g.id,[ref])
    policy.restrict_resources(Database(admin),g.id,[ref])  # idempotent, not a new allowance
    with s.db.transaction() as c:
        assert c.execute('SELECT data,active FROM tool_grants WHERE id=%s',(g.id,)).fetchone()=={'data':original,'active':True}
        assert c.execute('SELECT e.data FROM tool_attempt_events e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.created_at',(q.run.id,)).fetchall()==receipts
        assert ref not in policy.grant(c,ws,q.run.id).resource_selectors
        assert A.input_refs(allowed)[0] in policy.grant(c,ws,q.run.id).resource_selectors
    with pytest.raises(DomainError):s.get_source_snapshot(p,ws,a.output['result']['snapshot']['snapshot_id'])
    assert s.get_source_snapshot(p,ws,b.output['result']['snapshot']['snapshot_id']).snapshot_id==b.output['result']['snapshot']['snapshot_id']
    page=s.list_workspace_files(p,ws,cv.id)
    assert len(page.items)==1 and page.next_after is None and page.items[0].workspace_file_id==b.output['result']['snapshot']['workspace_file_id']
    execute(s,cap,q,allowed.model_copy(update={'page':2}))
    assert sent==['octocat/Hello-World','psf/requests','psf/requests']
    for db,sql,args in [
        (s.db,'INSERT INTO tool_scope_reductions(grant_id,selector) VALUES(%s,%s)',(g.id,encoded(A.input_refs(allowed)[0]))),
        (Database(admin),'DELETE FROM tool_scope_reductions WHERE grant_id=%s',(g.id,)),
        (Database(admin),"UPDATE tool_grants SET data=jsonb_set(data,'{resource_selectors}','[]') WHERE id=%s",(g.id,))]:
        with pytest.raises(Exception):
            with db.transaction() as c:c.execute(sql,args)
    with pytest.raises(Exception):policy.restrict_resources(s.db,g.id,[A.input_refs(allowed)[0]])


def test_discovery_excerpt_is_bounded_but_raw_body_is_retained():
    import json,base64
    raw=response([{'number':1,'body':'x'*4000}]);material=G.evidence(discover(),raw)
    assert len(json.loads(material['text'])['evidence'][0]['body'])==2000
    assert len(json.loads(base64.b64decode(material['raw_base64']))[0]['body'])==4000
    assert material['coverage']['body_complete'] and not material['coverage']['text_complete']
    assert material['coverage']['omissions']


@pytest.mark.parametrize('page,more,count',[(1,True,5),(2,False,0),(5,True,5),(5,False,1)])
def test_pagination_valid(page,more,count):
    p=A.GitHubPagination(page=page,per_page=5,item_count=count,next_page=page+1 if more and page<5 else None,has_more=more,limit_reached=more and page==5)
    assert p.model_dump()['item_count']==count


@pytest.mark.parametrize('change',[{'item_count':6},{'next_page':3},{'next_page':None},{'limit_reached':True},{'has_more':False},{'page':True}])
def test_pagination_rejects_inconsistent_or_untyped(change):
    data=dict(page=1,per_page=5,item_count=5,next_page=2,has_more=True,limit_reached=False)
    with pytest.raises(ValidationError):A.GitHubPagination.model_validate({**data,**change},strict=True)


@pytest.mark.parametrize('page,more',[(1,True),(5,True),(3,False)])
def test_actual_adapter_pagination_receipt(context,monkeypatch,page,more):
    s,p,ws,_,_=context;cv=conversation(context);req=discover().model_copy(update={'page':page})
    cap,g,q=install(context,cv,[req])
    monkeypatch.setattr(G,'fetch',lambda req:{**response([{'number':1}]),'has_more':more})
    obs,_=execute(s,cap,q,req)
    assert obs.output['result']['pagination']==dict(page=page,per_page=5,item_count=1,next_page=page+1 if more and page<5 else None,has_more=more,limit_reached=page==5 and more)
