"""No network, database or paid providers: exact egress and attribution mechanics."""
from hashlib import sha256
from types import SimpleNamespace
from datetime import timedelta
import pytest
from workagent.errors import DomainError
from workagent.models import now
from workagent.research import validate_quote
from workagent.research_models import QuoteRef, SearchResult
from workagent.capabilities import research_adapters as R, policy, registry
from workagent.capabilities.models import ToolGrantV1, CapabilityPin, ToolCallV1


def test_query_bytes_and_url_egress_are_exact():
    a = R.ResearchSearch(kind='research_search', query='private synthetic secret\n')
    b = R.ResearchSearch(kind='research_search', query='private synthetic secret')
    assert R.input_refs(a)[0] != R.input_refs(b)[0]
    assert R.input_refs(a)[0].sha256 == sha256(a.query.encode()).hexdigest()
    assert R.input_refs(a)[1] == R.selector('processor', R.SEARCH_PROCESSOR)
    capture = R.ResearchCapture(kind='research_capture', url='https://example.com/private?token=synthetic', allow_browser=False)
    assert R.input_refs(capture)[0] != R.input_refs(capture.model_copy(update={'url':'https://example.com/'}))[0]
    with pytest.raises(DomainError):
        R.input_refs(capture.model_copy(update={'url':'https://example.com'}))
    assert R.input_refs(capture)[1] != R.input_refs(capture.model_copy(update={'allow_browser':True}))[1]


@pytest.mark.parametrize('missing',['egress','query','processor','url','disabled'])
def test_read_permission_never_authorizes_private_egress(monkeypatch, missing):
    monkeypatch.setenv('WORKAGENT_RESEARCH_ENABLED','1')
    req = (R.ResearchCapture(kind='research_capture',url='https://example.com/private?secret=fixture',allow_browser=False)
           if missing=='url' else R.ResearchSearch(kind='research_search',query='synthetic private memory'))
    name=R.IDS[req.kind]; adapter=registry.adapters()[name]; d=adapter.descriptor
    refs=R.input_refs(req)
    selectors=refs[:]
    if missing in ('query','url'): selectors=selectors[1:]
    if missing=='processor': selectors=selectors[:1]
    g=ToolGrantV1(id='grant',workspace_id='ws',principal_id='p',run_id='run',scope_id='cv',
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256)],
        resource_selectors=selectors,effects=['read'],privacy_classes=['public','workspace_private'],
        egress='none' if missing=='egress' else 'public_https',expires_at=now()+timedelta(hours=1),access_generation=1,budget_account_id='budget')
    class C:
        def execute(self,*args): return self
        def fetchone(self): return {'descriptor':d.model_dump(mode='json'),'enabled':True}
    monkeypatch.setattr(policy,'grant',lambda *args:g)
    service=SimpleNamespace(_check_capability=lambda *args:(SimpleNamespace(id='p'),SimpleNamespace(workspace_id='ws',id='run',access_generation=1,conversation_id='cv'),SimpleNamespace(id='cv',work_version=1)))
    call=ToolCallV1(call_id='call',capability_id=name,capability_version='1',arguments=req.model_dump(),input_refs=refs,expected_work_version=1)
    if missing=='disabled': monkeypatch.delenv('WORKAGENT_RESEARCH_ENABLED')
    with pytest.raises(DomainError): policy.authorize(service,C(),None,call,adapter)


def test_missing_search_zero_calls_and_snippets_not_evidence(monkeypatch):
    monkeypatch.setattr(R,'search_provider',None)
    result=R.search('exact query  ')
    assert result.status=='unavailable' and result.external_calls==0 and result.candidates==[]
    assert result.query=='exact query  '
    class Fixture:
        processor=R.SEARCH_PROCESSOR
        mode='deterministic_http_fixture'
        def search(self,query):
            return SearchResult(status='available',query=query,query_sha256=sha256(query.encode()).hexdigest(),
                processor=self.processor,mode=self.mode,searched_at=now(),external_calls=1,omissions=[],
                candidates=[{'url':'https://example.com/','title':'misleading','snippet':'This proves everything.'}])
    monkeypatch.setattr(R,'search_provider',Fixture())
    assert R.search('query').candidates[0].evidence_use=='discovery_only'
    monkeypatch.setattr(Fixture,'search',lambda self,q: result)
    with pytest.raises(ValueError): R.search('another query')


def test_quote_ranges_are_unicode_exact_and_not_entailment():
    text='α😀 says: not established.\r\n'
    quote=QuoteRef(workspace_file_id='f',snapshot_id='s',text_sha256=sha256(text.encode()).hexdigest(),start=1,end=2,quote='😀',relation='supports')
    validate_quote(text,quote)
    for bad in [quote.model_copy(update={'start':0,'end':1}),quote.model_copy(update={'text_sha256':'0'*64}),quote.model_copy(update={'quote':'X'})]:
        with pytest.raises(DomainError): validate_quote(text,bad)
    from workagent.research_models import ResearchClaim
    from typing import get_args
    assert 'supported' not in get_args(ResearchClaim.model_fields['semantic_status'].annotation)
    with pytest.raises(Exception):
        QuoteRef(workspace_file_id='f',snapshot_id='s',text_sha256='0'*64,start=1,end=3,quote='😀',relation='supports')


def test_opt_in_schema_and_legacy_catalog_stay_distinct():
    from workagent.capabilities.research_composition import SCHEMA, enabled
    from workagent.capabilities.compute_composition import SCHEMA as old
    from workagent.composition import descriptors
    config={'responses':{'continuity_version':'sustained-v1','scope_tool_sha256':sha256(SCHEMA.material).hexdigest()}}
    assert enabled(config) and not enabled({})
    assert b'research_capture' not in old.material
    assert 'research_capture' not in str(descriptors())
    assert b'research_capture' in SCHEMA.material


def test_capture_exact_raw_mime_and_empty_coverage():
    import base64
    from workagent.research import append_capture
    from workagent.models import now
    class C:
        def __init__(self): self.writes=[]
        def execute(self,sql,args): self.writes.append((sql,args));return self
        def fetchone(self): return None
    req=R.ResearchCapture(kind='research_capture',url='https://example.com/',allow_browser=False)
    raw=b'<h1>Different from snippet</h1>'
    data=dict(raw_base64=base64.b64encode(raw).decode(),content_sha256=sha256(raw).hexdigest(),
        text='Different from snippet',text_sha256=sha256(b'Different from snippet').hexdigest(),requested_url=req.url,
        status='ok',content_type='text/html; charset=utf-8',title='Title',final_url=req.url,http_status=200,
        redirects=[],fetched_at=now(),extractor_version='fixture-v1',coverage={'body_complete':True,'text_complete':True,'omissions':[]},
        external_version={'etag':None,'last_modified':None},extraction_status='extracted',browser_used=False)
    args=(None,C(),SimpleNamespace(id='p'),SimpleNamespace(workspace_id='ws',id='run'),SimpleNamespace(id='cv'),'attempt',req)
    saved=append_capture(*args,data)
    assert saved.original_sha256==sha256(raw).hexdigest() and saved.locator.mime_type==data['content_type']
    assert len([sql for sql,_ in args[1].writes if sql.startswith('INSERT INTO generated_blobs')])==1
    with pytest.raises(ValueError): append_capture(*args,{**data,'content_sha256':'0'*64})
    with pytest.raises(ValueError): append_capture(*args,{**data,'text':'misleading snippet'})
    empty={**data,'raw_base64':'','content_sha256':sha256(b'').hexdigest(),'text':'','text_sha256':sha256(b'').hexdigest(),'extraction_status':'empty'}
    saved=append_capture(*args,empty)
    assert saved.original_byte_length==0 and saved.extraction_status=='empty'
