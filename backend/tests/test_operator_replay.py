"""Immutable envelopes must survive a lost acknowledgement and process restart."""
import json
import http.client
import io
import pytest
from workagent.operator_client import OperatorClient, OperatorError

@pytest.fixture
def setup(monkeypatch, tmp_path):
    monkeypatch.setenv('LOCAL_BEARER_TOKEN','private-fixture-token-'+'x'*32)
    monkeypatch.setenv('WORKAGENT_OPERATOR_URL','http://127.0.0.1:8765')
    journal=tmp_path/'commands'
    monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL',str(journal))
    return journal

@pytest.mark.parametrize('action,args',[
    ('follow',['c','Keep human edits','a','rev','a'*64]),
    ('promote',['c','Title','Goal','project']), ('cancel',['c'])])
def test_explicit_replay_preserves_envelope_after_lost_ack(setup,monkeypatch,action,args):
    posts=[]; reads=[]; version=7
    def request(self,path,body=None):
        if body is None:
            reads.append(path)
            return {'conversation':{'id':'c','work_version':version}}
        posts.append((path,json.dumps(body)))
        if len(posts)==1: raise OperatorError('Lost acknowledgement after commit')
        return {'run':{'id':'canonical-run'}}
    monkeypatch.setattr(OperatorClient,'request',request)
    with pytest.raises(OperatorError):
        OperatorClient().run('w',action,args,command_id='same-id')
    version=8
    result=OperatorClient().run('w','replay',['same-id'])
    assert posts[0]==posts[1]
    assert len(reads)==2 # preflight once; replay readback only
    assert result['receipt']['run']['id']=='canonical-run'
    assert result['command_id']=='same-id'


def test_reused_id_refuses_before_refresh_or_post(setup,monkeypatch):
    calls=[]
    def request(path,body=None):
        calls.append((path,body))
        return {'conversation':{'work_version':7}} if body is None else {'run':{'id':'r'}}
    client=OperatorClient(); monkeypatch.setattr(client,'request',request)
    client.run('w','follow',['c','Original'],command_id='same-id')
    for ws,args in [('w',['c','Changed']),('w',['other','Original']),('other',['c','Original']),('w',['c','Original'])]:
        before=len(calls)
        with pytest.raises(OperatorError): client.run(ws,'follow',args,command_id='same-id')
        assert len(calls)==before
    monkeypatch.setenv('WORKAGENT_OPERATOR_URL','http://127.0.0.1:8766')
    with pytest.raises(OperatorError): OperatorClient().run('w','replay',['same-id'])


def test_receipt_survives_readback_failure(setup,monkeypatch):
    def request(self,path,body=None):
        if body is not None: return {'id':'created'}
        raise OperatorError('Readback unavailable')
    monkeypatch.setattr(OperatorClient,'request',request)
    with pytest.raises(OperatorError): OperatorClient().run('w','chat',['Hello'],command_id='receipt-id')
    saved=OperatorClient().run('w','command',['receipt-id'])
    assert saved['outcome']['state']=='readback_unknown'
    assert saved['outcome']['receipt']=={'id':'created'}
    assert 'private-fixture-token' not in ''.join(p.read_text() for p in setup.iterdir())
    assert setup.stat().st_mode & 0o777 == 0o700
    assert all(p.stat().st_mode & 0o777 == 0o600 for p in setup.iterdir())


@pytest.mark.parametrize('damage',['corrupt','missing','symlink','hardlink','mode','path','body','scope'])
def test_corrupt_or_unsafe_record_fails_closed(setup,monkeypatch,damage,tmp_path):
    from workagent.operator_journal import digest
    client=OperatorClient()
    monkeypatch.setattr(client,'request',lambda path,body=None: {'id':'c'})
    client.run('w','chat',['Hello'],command_id='saved')
    file=setup/'saved.json'
    if damage=='corrupt': file.write_text('{broken')
    elif damage=='missing': file.unlink()
    elif damage=='symlink':
        other=tmp_path/'other'; file.rename(other); file.symlink_to(other)
    elif damage=='hardlink':
        import os
        os.link(file,tmp_path/'other')
    elif damage=='mode': file.chmod(0o644)
    else:
        data=json.loads(file.read_text())
        if damage=='path': data['record']['path']='/w/../other/conversations'
        elif damage=='scope': data['record']['workspace']='elsewhere'
        else: data['record']['body']['unexpected']='mutated'
        # Even a well-formed checksum cannot authorize a different path/payload.
        data['digest']=digest(data['record'])
        file.write_text(json.dumps(data))
    monkeypatch.setattr(client,'request',lambda *a,**k:pytest.fail('No network for invalid replay'))
    with pytest.raises(OperatorError): client.run('w','replay',['saved'])


@pytest.mark.parametrize('damage',['symlink','parent-symlink','mode','relative','traversal'])
def test_untrusted_journal_path_refused(setup,monkeypatch,tmp_path,damage):
    target=tmp_path/'target'; target.mkdir(mode=0o700)
    if damage=='symlink': setup.symlink_to(target)
    elif damage=='parent-symlink':
        setup.symlink_to(target); monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL',str(setup/'sub'))
    elif damage=='mode':
        setup.mkdir(mode=0o755)
        # mkdir's mode is masked by the caller's umask. Make this deliberately
        # unsafe fixture explicit even when the test runner uses umask 077.
        setup.chmod(0o755)
        assert setup.stat().st_mode & 0o777 == 0o755
    elif damage=='relative': monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL','relative')
    else: monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL',str(tmp_path/'target/../commands'))
    client=OperatorClient()
    monkeypatch.setattr(client,'request',lambda *a,**k:pytest.fail('No network for unsafe journal'))
    with pytest.raises(OperatorError): client.run('w','chat',['Hello'])


def test_journal_capacity_and_write_failure_never_send(setup,monkeypatch):
    from workagent import operator_journal
    client=OperatorClient()
    monkeypatch.setattr(client,'request',lambda *a,**k:pytest.fail('No POST without durable envelope'))
    monkeypatch.setattr(operator_journal,'MAX_RECORDS',0)
    with pytest.raises(OperatorError,match='full'): client.run('w','chat',['Hello'])
    monkeypatch.setattr(operator_journal,'MAX_RECORDS',256)
    monkeypatch.setattr(operator_journal.os,'fsync',lambda *a:(_ for _ in ()).throw(OSError('disk unavailable')))
    with pytest.raises(OperatorError): client.run('w','chat',['Hello'])


def test_exclusive_id_concurrent_reservation(setup,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    barrier=Barrier(2); posts=[]
    original=__import__('workagent.operator_journal',fromlist=['CommandJournal']).CommandJournal.require_new
    def require_new(self,cid):
        original(self,cid); barrier.wait(timeout=5)
    monkeypatch.setattr('workagent.operator_journal.CommandJournal.require_new',require_new)
    def request(self,path,body=None):
        if body is not None: posts.append(body)
        return {'id':'c'}
    monkeypatch.setattr(OperatorClient,'request',request)
    def send(_):
        try: return OperatorClient().run('w','chat',['Hello'],command_id='race')
        except OperatorError: return None
    with ThreadPoolExecutor(2) as pool: results=list(pool.map(send,range(2)))
    assert len(posts)==1
    assert len([r for r in results if r])==1


@pytest.mark.parametrize('boundary',['post','readback'])
def test_truncated_http_preserves_exact_journal_without_retry(setup,monkeypatch,boundary):
    # Exercise urllib's actual HTTPResponse reader with a short Content-Length
    # body, not a mocked OperatorError or request method.
    class Socket:
        def makefile(self,*args):
            return io.BytesIO(b'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\nsynthetic-private-partial-body')
    class Opener:
        def __init__(self): self.calls=[]; self.fail=True
        def open(self,request,timeout):
            self.calls.append((request.method,request.full_url,request.data))
            if self.fail and ((boundary=='post' and request.method=='POST') or
                             (boundary=='readback' and len(self.calls)==3)):
                response=http.client.HTTPResponse(Socket()); response.begin(); return response
            data={'run':{'id':'canonical-run'}} if request.method=='POST' else {'conversation':{'work_version':7}}
            return io.BytesIO(json.dumps(data).encode())
    client=OperatorClient(); opener=Opener(); client.opener=opener
    reserved=[]; reserve=client.journal.reserve
    def capture(record):
        reserved.append(json.loads(json.dumps(record))); reserve(record)
    monkeypatch.setattr(client.journal,'reserve',capture)
    with pytest.raises(OperatorError,match='No automatic retry') as exc:
        client.run('w','follow',['c','Original text','a','rev','a'*64],command_id='truncated-id')
    assert 'synthetic-private-partial-body' not in str(exc.value)
    assert client.token not in str(exc.value)
    assert len(opener.calls)==(2 if boundary=='post' else 3)
    assert sum(method=='POST' for method,_,_ in opener.calls)==1
    saved=OperatorClient().run('w','command',['truncated-id'])
    assert saved['record']==reserved[0]
    assert saved['outcome']==({'state':'outcome_unknown'} if boundary=='post' else
        {'state':'readback_unknown','receipt':{'run':{'id':'canonical-run'}}})
    assert all('synthetic-private-partial-body' not in p.read_text() for p in setup.iterdir())
    # Only an explicit replay sends a second POST; it retains the exact envelope.
    opener.fail=False
    restarted=OperatorClient(); restarted.opener=opener
    result=restarted.run('w','replay',['truncated-id'])
    posts=[call for call in opener.calls if call[0]=='POST']
    assert len(posts)==2 and posts[0]==posts[1]
    assert result['receipt']=={'run':{'id':'canonical-run'}}
    final=restarted.run('w','command',['truncated-id'])
    assert final['record']==reserved[0]
    assert final['outcome']=={'state':'confirmed','receipt':result['receipt']}
