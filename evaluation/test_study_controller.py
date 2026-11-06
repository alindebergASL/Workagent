"""Controller mechanics only. Full actual-worker diagnostic is a separate command."""
import json
from pathlib import Path
import sqlite3
import pytest

from study_controller import Controller, Hold, ingress, load_schedule, canonical, digest
from study_transport import attach_transport, LIVE_EXECUTION_RELEASE
from study_diagnostic import LocalProvider, ProductAdapter


class DurablePeer:
    """Scripted application protocol peer; not product/quality evidence."""
    def __init__(self):
        self.results = {}
        self.calls = []
        self.drop = None

    def call(self,key,operation,payload):
        self.calls.append((key,operation,payload))
        if self.drop == 'before':
            self.drop = None
            raise ConnectionError('unknown delivery')
        if operation == 'open_trajectory':
            value = {'id':payload['blind_id'],'variant':payload['variant']}
        elif operation == 'transition':
            value = {'episode':payload['episode']}
        elif operation == 'ingress':
            value = {'message_sha256':payload['message_sha256']}
        elif operation == 'execute':
            value = {'status':'ready'}
        elif operation == 'collect':
            value = {'blind_id':payload['trajectory']['id'], 'episode':payload['episode'],
                     'artifacts':[], 'messages':[], 'oracle_sha256':payload['oracle_sha256'],
                     'evidence_level':'scripted_protocol_only'}
        else:
            value = {'diagnostic':True}
        result = {'key':key,'state':'complete','payload_sha256':digest(canonical(payload)),'value':value}
        self.results[key] = result
        if self.drop == 'after':
            self.drop = None
            raise ConnectionError('ack lost after commit')
        return result

    def observe(self,key):
        return self.results.get(key, {'key':key,'state':'unknown'})


def test_all_72_exact_ingresses_and_restart(tmp_path):
    peer = DurablePeer()
    c = Controller(tmp_path/'state.sqlite',peer)
    assert c.run(stop_after=3)['collected_episodes'] == 3
    calls = list(peer.calls)
    c.close()
    c = Controller(tmp_path/'state.sqlite',peer)
    result = c.run()
    assert result['collected_episodes'] == 72 and result['scheduled_trajectories'] == 12
    assert result['live_episodes'] == result['paid_calls'] == 0
    assert len(peer.calls) == 12 + 72*4
    assert peer.calls[:len(calls)] == calls
    before = len(peer.calls)
    assert c.run() == result and len(peer.calls) == before
    _, schedule = load_schedule()
    expected = [(t['blind_id'],e['episode'],ingress(e)['message_sha256']) for t in schedule for e in t['episodes']]
    actual = [(p['trajectory']['id'],p['episode'],p['message_sha256']) for _,op,p in peer.calls if op=='ingress']
    assert actual == expected
    c.export_evaluation(tmp_path/'evaluation')
    packets = list((tmp_path/'evaluation').glob('*.json'))
    assert len(packets) == 72
    for path in packets:
        packet = json.loads(path.read_text())
        assert not {'variant','source_manifest','oracle_content','quality_score'} & packet.keys()
        assert packet['quality'] is packet['effort'] is None
    c.close()


@pytest.mark.parametrize('drop',['before','after'])
def test_unknown_never_resends_across_restart(tmp_path,drop):
    peer = DurablePeer(); peer.drop = drop
    c = Controller(tmp_path/'state.sqlite',peer)
    with pytest.raises(ConnectionError):
        c.operation('trial',1,'probe',{'stable':True})
    c.close()
    c = Controller(tmp_path/'state.sqlite',peer)
    if drop == 'after':
        assert c.operation('trial',1,'probe',{'stable':True})['state'] == 'complete'
    else:
        with pytest.raises(Hold,match='unknown_outcome_no_resend'):
            c.operation('trial',1,'probe',{'stable':True})
    assert len(peer.calls) == 1
    states = [r[0] for r in c.db.execute('SELECT state FROM history ORDER BY seq')]
    assert states[:2] == ['sending','unknown']
    c.close()


def test_payload_cannot_change_after_restart(tmp_path):
    peer=DurablePeer(); c=Controller(tmp_path/'state.sqlite',peer)
    c.operation('trial',1,'probe',{'stable':True})
    with pytest.raises(Hold,match='operation_payload_drift'):
        c.operation('trial',1,'probe',{'stable':False})
    assert len(peer.calls)==1
    c.close()


@pytest.mark.parametrize('tamper',['key','payload_sha256','state'])
def test_unbound_or_pending_receipt_never_completes(tmp_path,tamper):
    peer=DurablePeer()
    original=peer.call
    def bad(*args):
        result=original(*args)
        result[tamper]='wrong'
        return result
    peer.call=bad
    c=Controller(tmp_path/'state.sqlite',peer)
    with pytest.raises(Hold):
        c.operation('trial',1,'probe',{})
    assert c.db.execute('SELECT state FROM operations').fetchone()[0] == 'sending'
    c.close()


def test_resume_rejects_store_binding_drift(tmp_path):
    c=Controller(tmp_path/'state.sqlite',DurablePeer()); c.close()
    with sqlite3.connect(tmp_path/'state.sqlite') as db:
        db.execute("UPDATE binding SET value='tampered'")
    with pytest.raises(Hold,match='study_binding_drift'):
        Controller(tmp_path/'state.sqlite',DurablePeer())


def test_live_switch_denied_before_db_or_transport(tmp_path):
    assert LIVE_EXECUTION_RELEASE is None
    with pytest.raises(RuntimeError,match='paid_execution_unreleased'):
        Controller(tmp_path/'must-not-exist.sqlite',None,mode='official_api')
    assert not (tmp_path/'must-not-exist.sqlite').exists()
    class NoDatabase:
        @property
        def db(self):
            pytest.fail('live database accessed')
    with pytest.raises(RuntimeError,match='paid_execution_unreleased'):
        attach_transport(NoDatabase(), {'transport':'official_api'},credential='not-a-real-credential')
    with pytest.raises(RuntimeError,match='paid_execution_unreleased'):
        ProductAdapter(tmp_path,None,live_bindings={},credential='not-a-real-credential')
    assert not (tmp_path/'bridge.sqlite').exists()


def test_real_loopback_wire_retains_synthetic_provenance(tmp_path):
    provider=LocalProvider(tmp_path)
    transport=attach_transport(None,{'transport':'controlled_http','controlled_origin':provider.origin,
                                    'grant':{'responses':{'transport_mode':'synthetic'}}})
    try:
        assert transport.provenance.mode == 'synthetic'
        assert transport.matches_binding('synthetic',None,None)
        assert not transport.matches_binding('official_api','proj_test','file:/not-mounted')
        result=transport._client.post('responses/input_tokens',content='{}')
        assert result.json()['input_tokens'] == 700
        assert len(provider.calls)==1
    finally:
        transport.close(); provider.close()


@pytest.mark.parametrize('origin',['https://api.openai.com','http://localhost:80','http://127.0.0.1:80/redirect','http://127.0.0.1:80@evil.invalid'])
def test_controlled_mode_cannot_send_to_nonloopback(origin):
    with pytest.raises(RuntimeError,match='controlled_loopback_only'):
        attach_transport(None,{'transport':'controlled_http','controlled_origin':origin,
                              'grant':{'responses':{'transport_mode':'synthetic'}}})


def test_controlled_mode_rejects_live_grant():
    with pytest.raises(RuntimeError,match='controlled_requires_synthetic_grant'):
        attach_transport(None,{'transport':'controlled_http','controlled_origin':'http://127.0.0.1:1',
                              'grant':{'responses':{'transport_mode':'official_api'}}})
