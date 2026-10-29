"""Operator boundary tests: HTTP only, no retry, no secret-bearing diagnostics."""
import io
import http.client
import json
import urllib.error
import pytest
from workagent.operator_client import OperatorClient,OperatorError


@pytest.fixture
def client(monkeypatch,tmp_path):
    monkeypatch.setenv("WORKAGENT_OPERATOR_JOURNAL",str(tmp_path/"commands"))
    monkeypatch.setenv('LOCAL_BEARER_TOKEN','private-fixture-token-'+'x'*32)
    monkeypatch.setenv('WORKAGENT_OPERATOR_URL','http://127.0.0.1:8765')
    return OperatorClient()


def test_no_write_retry_or_secret_error(client):
    class Fail:
        calls=0
        def open(self,request,timeout):
            self.calls+=1
            raise OSError('sensitive: '+client.token)
    client.opener=Fail()
    with pytest.raises(OperatorError) as exc:
        client.request('/w/conversations',{'schema_version':'workagent/v1',
            'request_id':'stable-command','command_id':'stable-command','title':'Synthetic work'})
    assert client.opener.calls==1
    assert client.token not in str(exc.value) and 'No retry' in str(exc.value)


def test_target_and_readback_are_exact(client,monkeypatch):
    calls=[]; messages=[]
    def request(path,body=None):
        calls.append((path,body))
        if body is None: return {'conversation':{'id':'c','work_version':7}}
        return {'run':{'id':'r','state':'queued'}}
    monkeypatch.setattr(client,'request',request)
    result=client.run('w','follow',['c','Narrow the scope','a','rev','a'*64],command_id='stable-command',announce=messages.append)
    assert calls[1][1]['target']=={'artifact_id':'a','revision_id':'rev','body_hash':'a'*64}
    assert calls[1][1]['expected_work_version']==7 and calls[1][1]['command_id']=='stable-command'
    assert calls[-1]==('/w/conversations/c',None)
    assert messages[0]['automatic_retry'] is False and result['worker_execution']=='separate'


def test_proposal_must_belong_to_inspected_artifact(client,monkeypatch):
    monkeypatch.setattr(client,'all',lambda path:{'items':[]})
    monkeypatch.setattr(client,'request',lambda *a,**k:pytest.fail('No write is allowed'))
    with pytest.raises(OperatorError,match='not part'):
        client.run('w','accept',['p','wrong-artifact','r'])


def test_redact_server_errors(client):
    class Fail:
        def open(self,request,timeout):
            raise urllib.error.HTTPError('http://127.0.0.1',409,'bad',{},io.BytesIO(json.dumps({'code':client.token}).encode()))
    client.opener=Fail()
    with pytest.raises(OperatorError) as exc: client.request('/w')
    assert client.token not in str(exc.value) and 'http_error' in str(exc.value)


def test_loopback_only_and_terminal_escaping(monkeypatch):
    from workagent.operator_tui import safe
    monkeypatch.setenv('WORKAGENT_OPERATOR_URL','https://example.com')
    with pytest.raises(OperatorError): OperatorClient()
    assert '\x1b' not in safe({'text':'\x1b[2J'})


class TruncatedReader(io.BytesIO):
    def read(self, *args):
        raise http.client.IncompleteRead(b'synthetic-private-partial-body', 100)


def test_truncated_get_is_sanitized_without_retry(client):
    class Opener:
        calls=0
        def open(self, request, timeout):
            self.calls+=1
            assert request.method=='GET'
            return TruncatedReader()
    client.opener=Opener()
    with pytest.raises(OperatorError,match='Transport/readback unavailable') as exc:
        client.run('w','areas',[])
    assert client.opener.calls==1
    assert 'synthetic-private-partial-body' not in str(exc.value)


@pytest.mark.parametrize('failure',['initial','refresh','post','readback'])
def test_interactive_survives_truncated_response(client,monkeypatch,failure):
    from workagent import operator_tui
    class Opener:
        calls=[]
        def open(self, request, timeout):
            self.calls.append(request.method)
            if ((failure=='initial' and len(self.calls)==1) or
                (failure=='refresh' and len(self.calls)==2) or
                (failure=='post' and request.method=='POST') or
                (failure=='readback' and len(self.calls)==3)):
                return TruncatedReader()
            return io.BytesIO(json.dumps({'id':'c'} if request.method=='POST' else {'items':[]}).encode())
    class Screen:
        def __init__(self):
            self.keys=iter(('r' if failure in ('initial','refresh') else ':chat Hello\n')+'q')
            self.frames=[]; self.lines=[]; self.consumed=[]
        def keypad(self,value): pass
        def getmaxyx(self): return (40,240)
        def erase(self): self.lines=[]
        def addnstr(self,y,x,text,count): self.lines.append(text[:count])
        def refresh(self): self.frames.append('\n'.join(self.lines))
        def get_wch(self):
            key=next(self.keys); self.consumed.append(key); return key
    monkeypatch.setattr(operator_tui.curses,'curs_set',lambda value:None)
    client.opener=Opener(); screen=Screen()
    operator_tui.interactive(screen,client,'w')
    assert screen.consumed[-1]=='q'
    displayed='\n'.join(screen.frames)
    assert 'Transport/readback unavailable' in displayed
    assert 'synthetic-private-partial-body' not in displayed
    assert client.token not in displayed
    assert client.opener.calls.count('POST')==(1 if failure in ('post','readback') else 0)
    if failure=='initial':
        assert '"spaces": []' in screen.frames[-1] # explicit refresh recovers
