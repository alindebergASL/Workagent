"""Scheduler tests with inert services: no DB, network, credentials or sleeps."""
from contextlib import contextmanager
from types import SimpleNamespace
import json

import pytest
from workagent.responses_dispatcher import ResponsesDispatcher, serve
from workagent.responses_transport import TransportError


class DB:
    def __init__(self, rows):
        self.rows=rows
    @contextmanager
    def transaction(self):
        yield self
    def execute(self, sql, params):
        if 'FROM run_dispatches' in sql:
            return SimpleNamespace(fetchall=lambda:self.rows)
        if 'FROM provider_attempts' in sql:
            return SimpleNamespace(fetchone=lambda:None)
        raise AssertionError(sql)


def dispatcher(monkeypatch, outcomes):
    calls=[]
    rows=[dict(cursor=i+1,run_id=key,data={'principal_id':'person'},active=True) for i,key in enumerate(outcomes)]
    service=SimpleNamespace(db=DB(rows))
    def work(p,ws,rid):
        calls.append(rid)
        value=outcomes[rid]
        if isinstance(value,Exception): raise value
        return SimpleNamespace(id=rid,conversation_id=rid,state=value)
    service.get_conversation=lambda *args:SimpleNamespace(turns=[SimpleNamespace(run_id=args[-1],
        provider_observation='received',model_dump=lambda **_: {'private':'must not log'})])
    worker=SimpleNamespace(service=service,work=work,phases=True,
        transport=SimpleNamespace(provenance=SimpleNamespace(mode='synthetic')))
    instance=ResponsesDispatcher(worker,workspace='workspace',grant_id='grant')
    monkeypatch.setattr(instance.local_dispatcher,'once',lambda:{'completed':1})
    return instance,calls


@pytest.mark.parametrize('code',['action_unresolved','budget_exhausted','version_conflict'])
def test_one_blocked_run_does_not_starve_later_work_or_dump_observations(monkeypatch,code):
    from workagent.errors import DomainError
    d,calls=dispatcher(monkeypatch,{'revoked':DomainError(code),'good':'ready'})
    result=d.once()
    assert calls==['revoked','good'] and result['local']['completed']==1
    assert result['results'][-1]['status']=='completed'
    assert 'private' not in json.dumps(result) and 'observation' not in json.dumps(result)


def test_revoked_grant_skips_model_but_advances_local(monkeypatch):
    d,calls=dispatcher(monkeypatch,{'revoked':'ready'})
    d.worker.service.db.rows[0]['active']=False
    assert d.once()['results'][0]['status']=='authority_unavailable'
    assert calls==[]


@pytest.mark.parametrize('state',['outcome_unknown','count_unknown','invalid'])
def test_durable_uncertainty_never_reenters_worker(monkeypatch,state):
    d,calls=dispatcher(monkeypatch,{'unknown':'running'})
    original=d.worker.service.db.execute
    def execute(sql,params):
        if 'FROM provider_attempts' in sql:
            return SimpleNamespace(fetchone=lambda:{'id':'attempt'})
        return original(sql,params)
    d.worker.service.db.execute=execute
    monkeypatch.setattr('workagent.responses_ledger.observations',lambda *_:[SimpleNamespace(state=state)])
    for _ in range(2): assert d.once()['results'][0]['status'] in ('outcome_unknown','invalid_response')
    assert calls==[]


def test_known_id_pending_continues_next_tick(monkeypatch):
    d,calls=dispatcher(monkeypatch,{'known':'running'})
    original=d.worker.service.db.execute
    def execute(sql,params):
        if 'FROM provider_attempts' in sql: return SimpleNamespace(fetchone=lambda:{'id':'attempt'})
        return original(sql,params)
    d.worker.service.db.execute=execute
    monkeypatch.setattr('workagent.responses_ledger.observations',lambda *_:[SimpleNamespace(state='accepted')])
    for _ in range(2): assert d.once()['results'][0]['status']=='provider_pending'
    assert calls==['known','known']


def test_continuous_authority_loss_does_not_stop_local_or_spin(monkeypatch,capsys):
    d,calls=dispatcher(monkeypatch,{'model':'ready'})
    sleeps=[]
    def sleep(interval):
        sleeps.append(interval)
        if len(sleeps)==2: raise KeyboardInterrupt
    monkeypatch.setattr('time.sleep',sleep)
    def revoked(): raise TransportError('private operator details')
    with pytest.raises(KeyboardInterrupt): serve(d,revoked,.1)
    assert calls==[] and sleeps==[.1,.1]
    output=capsys.readouterr().out
    assert 'private operator details' not in output
    assert 'authority_unavailable' in output


@pytest.mark.parametrize('interval',[0, .01, 61, float('nan'), float('inf')])
def test_interval_rejected_before_work(interval):
    with pytest.raises(ValueError): serve(None,lambda:pytest.fail('must not verify'),interval)


def test_missing_live_opt_in_rejected_before_db_or_key_access(monkeypatch,capsys):
    from workagent import responses_dispatcher as cli
    monkeypatch.setenv('LOCAL_TEST_MODE','true')
    monkeypatch.setattr('sys.argv',['responses_dispatcher','--general-responses','--workspace','workspace',
        '--grant-id','grant','--serve'])
    monkeypatch.setattr(cli,'Database',lambda *a:pytest.fail('DB must not be accessed'))
    monkeypatch.setattr(cli,'load_credential',lambda *a:pytest.fail('key must not be accessed'))
    with pytest.raises(SystemExit) as stopped: cli.main()
    assert stopped.value.code==2
    assert 'explicit_authority_state_and_bounded_interval_required' in capsys.readouterr().err


def test_bounded_cursor_does_not_starve_work_behind_unknowns(monkeypatch):
    d,calls=dispatcher(monkeypatch,{**{f'blocked-{n}':'running' for n in range(100)},'later':'ready'})
    rows=d.worker.service.db.rows
    original=d.worker.service.db.execute
    def execute(sql,params):
        if 'FROM run_dispatches' in sql:
            return SimpleNamespace(fetchall=lambda:[r for r in rows if r['cursor']>params[1]][:100])
        return original(sql,params)
    d.worker.service.db.execute=execute
    monkeypatch.setattr(d,'_blocked_status',lambda row:'outcome_unknown' if row['run_id'].startswith('blocked') else None)
    assert len(d.once()['results'])==100 and calls==[]
    assert d.once()['results'][0]['run_id']=='later' and calls==['later']
