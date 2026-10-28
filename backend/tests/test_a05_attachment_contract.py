"""A05: original immutable attachment ranges must be a governed decision."""
from workagent.retained_results import SustainedDecision


def test_original_attachment_range_is_a_sustained_decision():
    decision = {
        'kind': 'read_attachment',
        'message_id': 'original-message',
        'ref': 'original-attachment',
        'sha256': 'a' * 64,
        'offset': 40000,
        'limit': 8192,
    }
    parsed = SustainedDecision.model_validate({
        'goal': 'Read the original tail without resupplying the attachment',
        'success_criteria': [],
        'decision': decision,
    })
    assert parsed.decision.model_dump(mode='json') == decision


import pytest
from hashlib import sha256
from types import SimpleNamespace
from pydantic import ValidationError
from workagent.errors import DomainError
from workagent.retained_results import ReadAttachment, page_bytes, read
from test_b24_checkpoints import ReadConnection


def selection(**kw):
    return ReadAttachment.model_validate(dict(kind='read_attachment',message_id='message',ref='attachment',sha256='a'*64,offset=0,limit=8192)|kw)


@pytest.mark.parametrize('kw',[{'offset':-1},{'offset':True},{'limit':0},{'limit':8193},{'limit':False},{'sha256':'A'*64},{'ref':'../../file'},{'path':'/etc/passwd'}])
def test_closed_original_range_contract(kw):
    with pytest.raises(ValidationError): selection(**kw)


def test_original_multibyte_bom_crlf_ranges():
    raw='\ufeffa\r\né🙂tail\r\n'.encode()
    first=page_bytes(raw,0,7)
    assert first['text']=='\ufeffa\r\n' and first['next_offset']==6
    second=page_bytes(raw,6,6)
    assert second['text']=='é🙂' and second['next_offset']==12
    assert first['body_sha256']==sha256(raw).hexdigest()
    assert page_bytes(raw,len(raw),8192)['text']==''
    for offset,limit in [(1,8192),(7,8192),(8,1),(len(raw)+1,1)]:
        with pytest.raises(DomainError): page_bytes(raw,offset,limit)


def test_attachment_replay_and_shared_retained_budget(monkeypatch):
    import workagent.retained_results as retained
    raw=b'original\r\n'
    monkeypatch.setattr(retained,'material',lambda *args:raw)
    run=SimpleNamespace(workspace_id='w',id='r'); c=ReadConnection(); d=selection()
    result=read(None,c,None,run,None,d,'selection',{})
    assert result['capability']=='read_attachment'
    assert result['result']['chunk_sha256']==sha256(raw).hexdigest()
    assert read(None,c,None,run,None,d,'selection',{})==result and c.inserts==1
    for pages,size in [(8,0),(1,32768),(1,32767)]:
        c=ReadConnection(); c.pages=pages; c.size=size
        with pytest.raises(DomainError,match='budget_exhausted'): read(None,c,None,run,None,d,'selection',{})
        assert not c.inserts
