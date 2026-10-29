"""Restricted PG, actual deterministic HTTPS search; never production search."""
import pytest
from test_domain import context
from test_conversations import conversation
from test_research_pg import install,execute
from test_workspace_file_gateway_pg import call
from research_http_fixture import fixture,QUERY,URL
from workagent.capabilities import research_adapters as R
from workagent.capabilities.broker import CapabilityBroker
from workagent.errors import DomainError


def test_real_http_search_snippet_is_discovery_not_capture(context,tmp_path,monkeypatch):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1');s,p,ws,_,_=context;cv=conversation(context)
    search=R.ResearchSearch(kind='research_search',query=QUERY)
    capture=R.ResearchCapture(kind='research_capture',url=URL,allow_browser=False)
    cap,g,q=install(context,cv,[search,capture])
    with fixture(tmp_path) as http:
        found,search_call=execute(s,cap,q,search)
        result=found.output['result'];assert result['mode']=='deterministic_http_fixture'
        assert result['candidates'][0]['evidence_use']=='discovery_only' and '99 units' in result['candidates'][0]['snippet']
        assert len(http['calls'])==1 and http['calls'][0]['path'].startswith('/search?q=')
        with s.db.transaction() as c:assert not c.execute('SELECT 1 FROM source_snapshots WHERE workspace_id=%s',(ws,)).fetchone()
        captured,capture_call=execute(s,cap,q,capture);snapshot=captured.output['result']['snapshot']
        assert '10 units' in snapshot['locator']['text'] and '99 units' not in snapshot['locator']['text']
        assert 'UNTRUSTED INJECTION' in snapshot['locator']['text']
        assert snapshot['coverage']['body_complete'] and snapshot['locator']['external_version']['etag']=='version-A'
        assert len(http['calls'])==2
        assert CapabilityBroker(s,cap).call(search_call)==found
        assert CapabilityBroker(s,cap).call(capture_call)==captured
        assert len(http['calls'])==2
        assert all('Authorization' not in x['headers'] and 'Cookie' not in x['headers'] for x in http['calls'])


def test_exact_private_query_url_and_processor_selectors_refuse_zero_http(context,tmp_path,monkeypatch):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1');s,p,ws,_,_=context;cv=conversation(context)
    search=R.ResearchSearch(kind='research_search',query=QUERY)
    capture=R.ResearchCapture(kind='research_capture',url=URL,allow_browser=False)
    cap,g,q=install(context,cv,[search,capture])
    with fixture(tmp_path) as http:
        for request in [search.model_copy(update={'query':QUERY+' private synthetic payroll detail'}),
                        capture.model_copy(update={'url':URL+'?private=synthetic-payroll'}),
                        capture.model_copy(update={'allow_browser':True})]:
            with pytest.raises(DomainError):CapabilityBroker(s,cap).call(call(cap,q,R.IDS[request.kind],request.model_dump(),R.input_refs(request)))
        for request in [search,capture]:
            refs=R.input_refs(request)[:1] # omit the separately pinned processor selector
            with pytest.raises(DomainError):CapabilityBroker(s,cap).call(call(cap,q,R.IDS[request.kind],request.model_dump(),refs))
        assert http['calls']==[]
        with s.db.transaction() as c:assert not c.execute('SELECT 1 FROM tool_attempts WHERE workspace_id=%s',(ws,)).fetchone()


def test_missing_production_search_processor_explicit_zero_calls(context,monkeypatch):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1');s,p,ws,_,_=context;cv=conversation(context)
    search=R.ResearchSearch(kind='research_search',query=QUERY);cap,g,q=install(context,cv,[search])
    monkeypatch.setattr(R,'search_provider',None)
    result,_=execute(s,cap,q,search)
    assert result.output['result']['status']=='unavailable'
    assert result.output['result']['external_calls']==0 and result.output['result']['candidates']==[]
