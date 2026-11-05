"""Offline45: fake DB/transport plus owned harmless local Python processes only."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
from types import SimpleNamespace as NS
import pytest
import study_execution as E

@pytest.fixture(autouse=True)
def no_external_io(monkeypatch):
    import socket,psycopg
    def forbidden(*a,**kw):raise AssertionError('PG/provider/network forbidden in45 offline')
    monkeypatch.setattr(psycopg,'connect',forbidden)
    monkeypatch.setattr(socket.socket,'connect',forbidden)
    monkeypatch.setattr(socket.socket,'connect_ex',forbidden)


def test_route_nesting_is_finite_and_no_product_timeouts_change():
    from workagent.general_worker import GENERAL_CLAIM_SECONDS
    assert E.CLAIM_SECONDS==GENERAL_CLAIM_SECONDS==600
    assert E.WORKER_SECONDS==1200
    assert E.application_seconds('official_api','execute')==1800
    assert E.application_seconds('controlled_http','execute')==36600
    assert E.NONEXECUTE_SECONDS==1200
    for route in ('official_api','controlled_http'):
        for operation in ('open_trajectory','ingress','collect'):
            assert E.application_seconds(route,operation)==E.NONEXECUTE_SECONDS
    assert E.WORKER_SECONDS+E.TERM_GRACE_SECONDS+E.REAP_SECONDS<E.application_seconds('official_api','execute')
    assert E.CONTROLLED_VISITS*(E.WORKER_SECONDS+E.CLAIM_SECONDS)<E.application_seconds('controlled_http','execute')
    assert E.application_seconds('official_api','execute')<E.NO_PROGRESS_SECONDS<E.OBSERVER_SECONDS
    with pytest.raises(ValueError):E.application_seconds('unapproved-route','execute')


def test_deferrals_are_allowed_but_claims_and_polls_cannot_reset_watchdog():
    clock=[0.];w=E.ProgressWindow({'prepared':1},overall=100,idle=20,clock=lambda:clock[0])
    for t in (1,3,8,14):
        clock[0]=t;w.observe({'prepared':1});w.check(5)
    clock[0]=15
    with pytest.raises(E.ExecutionStopped,match='no_durable_progress'):w.check(5)
    # A genuinely new durable phase earns progress; mere visits did not.
    w.observe({'prepared':2});w.check(5)
    for t in range(20,100,10):
        clock[0]=t;w.observe({'prepared':t});w.check()
    clock[0]=100;w.observe({'prepared':100})
    with pytest.raises(E.ExecutionStopped,match='overall_bound'):w.check()
    with pytest.raises(E.ExecutionStopped,match='regressed'):w.observe({'prepared':1})


def test_progress_query_does_not_credit_claim_or_repeated_read(monkeypatch):
    class C:
        def execute(self,sql,args):
            assert args==('run',)*4
            assert "NOT IN ('read','cancel')" in sql
            assert 'lease_expires_at' not in sql and 'fence' not in sql and 'UPDATE' not in sql
            return self
        def fetchall(self):return [{'kind':'prepared','n':2},{'kind':'response:result','n':1}]
    class DB:
        @contextmanager
        def transaction(self):yield C()
    assert E.durable_progress(NS(db=DB()),'run')=={'prepared':2,'response:result':1}


def test_owned_success_keeps_private_evidence_and_refuses_same_receipt(tmp_path):
    prefix=tmp_path/'process'
    result=E.run_owned([sys.executable,'-u','-c',"import sys; print('ok'); print('diagnostic',file=sys.stderr)"],input='secret-not-logged',cwd=tmp_path,timeout=5,evidence=prefix)
    assert result.returncode==0 and result.stdout=='ok\n' and result.stderr=='diagnostic\n'
    meta=json.loads(prefix.with_suffix('.process.json').read_text())
    assert meta['reaped'] and meta['status']=='exited' and 'secret' not in json.dumps(meta)
    assert prefix.with_suffix('.stdout').stat().st_mode & 0o777==0o600
    with pytest.raises(E.ExecutionStopped,match='no_replay'):
        E.run_owned([sys.executable,'-c','raise SystemExit(99)'],input='',cwd=tmp_path,timeout=5,evidence=prefix)


def not_live(pid):
    path=Path(f'/proc/{pid}/stat')
    return not path.exists() or path.read_text().rsplit(')',1)[1].split()[0]=='Z'


@pytest.mark.parametrize('ignore_term',[False,True])
def test_timeout_retains_partial_bytes_and_kills_owned_group(tmp_path,monkeypatch,ignore_term):
    monkeypatch.setattr(E,'TERM_GRACE_SECONDS',.05)
    signals="import signal; signal.signal(signal.SIGTERM,signal.SIG_IGN);" if ignore_term else ""
    child=signals+"import time; time.sleep(60)"
    command=signals+f"import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c',{child!r}]); print(p.pid,flush=True); print('before-timeout',file=sys.stderr,flush=True); time.sleep(60)"
    prefix=tmp_path/'timeout'
    with pytest.raises(E.ExecutionStopped,match='process_timeout_unknown'):
        E.run_owned([sys.executable,'-u','-c',command],input='',cwd=tmp_path,timeout=.3,evidence=prefix)
    pid=int(prefix.with_suffix('.stdout').read_text());meta=json.loads(prefix.with_suffix('.process.json').read_text())
    assert not_live(pid) and not_live(meta['pid'])
    assert meta['status']=='timeout' and meta['reaped']
    assert prefix.with_suffix('.stderr').read_text()=='before-timeout\n'


def test_application_alarm_also_cleans_owned_child(tmp_path,monkeypatch):
    monkeypatch.setattr(E,'TERM_GRACE_SECONDS',.05)
    prefix=tmp_path/'alarm';handler=signal.getsignal(signal.SIGALRM)
    with pytest.raises(E.ExecutionStopped,match='process_timeout_unknown'):
        with E.application_window(.2):
            E.run_owned([sys.executable,'-u','-c',"import time;print('started',flush=True);time.sleep(60)"],input='',cwd=tmp_path,timeout=5,evidence=prefix)
    meta=json.loads(prefix.with_suffix('.process.json').read_text())
    assert meta['reaped'] and not_live(meta['pid'])
    assert signal.getsignal(signal.SIGALRM)==handler and signal.getitimer(signal.ITIMER_REAL)==(0.,0.)


def test_evidence_error_after_spawn_cannot_orphan_child(tmp_path,monkeypatch):
    monkeypatch.setattr(E,'TERM_GRACE_SECONDS',.05)
    real=E._record;pid=[]
    def fail_running(path,value):
        if value['status']=='running':pid.append(value['pid']);raise OSError('synthetic disk fault')
        real(path,value)
    monkeypatch.setattr(E,'_record',fail_running)
    with pytest.raises(OSError):E.run_owned([sys.executable,'-c','import time;time.sleep(60)'],input='',cwd=tmp_path,timeout=5,evidence=tmp_path/'disk')
    assert len(pid)==1 and not_live(pid[0])


def test_adapter_timeout_and_failed_child_remain_unknown_without_resend(tmp_path,monkeypatch):
    import study_diagnostic as D,study_binding as B,network_harness as H,study_controller as C
    monkeypatch.setattr(B,'validate_environment',lambda *_:None)
    monkeypatch.setattr(B,'validate_sources',lambda *_:None)
    monkeypatch.setattr(H,'inventory',lambda *_:{})
    monkeypatch.setattr(C,'load_schedule',lambda:({},[]))
    adapter=D.ProductAdapter.__new__(D.ProductAdapter)
    adapter.environment={};adapter.live_bindings=None;adapter.directory=tmp_path;adapter.origin='http://controlled.invalid';adapter.credential=None;adapter.drop_ack=False
    adapter.db=sqlite3.connect(tmp_path/'bridge.sqlite');adapter.db.row_factory=sqlite3.Row
    adapter.db.execute('CREATE TABLE receipts(key TEXT PRIMARY KEY,payload TEXT,state TEXT,result TEXT)')
    calls=[]
    def timeout(*a,**kw):calls.append(kw);raise E.ExecutionStopped('process_timeout_unknown')
    monkeypatch.setattr(D,'run_owned',timeout)
    payload={'trajectory':{'id':'a'*24,'variant':'B1'}}
    with pytest.raises(C.Hold,match='application_operation_unknown'):adapter.call('exact','execute',payload)
    assert adapter.call('exact','execute',payload)=={'key':'exact','state':'unknown'}
    assert len(calls)==1 and calls[0]['timeout']==36600
    assert adapter.db.execute('SELECT state,result FROM receipts').fetchone()['result'] is None
    adapter.close()


@pytest.mark.parametrize('mode,unknown',[('controlled_http',False),('controlled_http',True),('official_api',False)])
def test_actual_application_visit_path_defers_without_lease_surgery(tmp_path,monkeypatch,mode,unknown):
    import study_application as A
    from study_controller import Hold
    from network_harness import REPO
    calls=[];queries=[]
    class C:
        def execute(self,sql,args):queries.append(sql);return self
        def fetchone(self):return {'data':{}}
        def fetchall(self):return [{'phase':'selection','kind':'count_send'}] if unknown else []
    class DB:
        @contextmanager
        def transaction(self):yield C()
    service=NS(db=DB(),get_run=lambda *a:NS(state='ready' if len(calls)>1 else 'running',lease_expires_at=None,id='r',unresolved=None))
    monkeypatch.setattr(A,'context',lambda *a:(service,NS(id='human'),{'DATABASE_URL':'postgresql://unused@127.0.0.1/unit'}))
    monkeypatch.setattr(A,'stage_execution_source',lambda *a:tmp_path/'product')
    monkeypatch.setattr(A,'inventory',lambda *a:{})
    monkeypatch.setattr(A,'durable_progress',lambda *a:{'prepared':1})
    monkeypatch.setattr(A,'jail',lambda *a:['/usr/bin/bwrap','--unshare-all','--die-with-parent','--new-session','--ro-bind',str(REPO/'evaluation/network_worker.py'),'/worker.py','--','/usr/bin/python3','/worker.py'])
    def launch(argv,**kw):
        calls.append(kw);assert '-u' in argv and kw['timeout']==1200
        return NS(returncode=0,stdout=json.dumps({'state':'running' if len(calls)==1 else 'ready'}),stderr='')
    monkeypatch.setattr(A,'run_owned',launch)
    state=dict(mode=mode,episode=1,variant='B0',workspace='w',current_run='r',source_manifest_sha256='a'*64,controlled_origin='http://127.0.0.1:9',active_grant={'id':'g'},inputs=str(tmp_path),input_files={},environment={'dependencies':{},'files':{}})
    if mode=='official_api' or unknown:
        with pytest.raises(Hold,match='installed_run_pending_observation|provider_outcome_unknown_no_replay'):A.execute(tmp_path,state,{})
        assert len(calls)==1
    else:
        assert A.execute(tmp_path,state,{})['status']=='ready' and len(calls)==2
    assert not any('UPDATE' in q or 'MIGRATION' in q for q in queries)

@pytest.mark.parametrize('sig',[signal.SIGALRM,signal.SIGTERM])
def test_signal_during_spawn_is_deferred_until_pid_tracked(tmp_path,monkeypatch,sig):
    real=E.subprocess.Popen;children=[]
    monkeypatch.setattr(E,'TERM_GRACE_SECONDS',.05)
    def during_spawn(*a,**kw):
        child=real(*a,**kw);children.append(child.pid)
        os.kill(os.getpid(),sig) # before run_owned receives the process object
        return child
    monkeypatch.setattr(E.subprocess,'Popen',during_spawn)
    prefix=tmp_path/'spawn-signal'
    with pytest.raises(E.ExecutionStopped,match='process_(timeout|interrupted)_unknown'):
        E.run_owned([sys.executable,'-c','import time;time.sleep(60)'],input='',cwd=tmp_path,timeout=5,evidence=prefix)
    meta=json.loads(prefix.with_suffix('.process.json').read_text())
    assert children==[meta['pid']] and meta['reaped'] and not_live(meta['pid'])


@pytest.mark.parametrize('events,reason',[
    ([('count_send',{})],'unknown_count'),
    ([('count_send',{}),('count_result',{}),('dispatch',{})],'unknown_create'),
    ([('dispatch',{}),('identity',{'response_id':'known'})],None),
    ([('count_send',{}),('count_result',{}),('dispatch',{}),('identity',{'response_id':'known'}),('result',{})],None),
])
def test_actual_observer_preserves_unknown_vs_acknowledged_resume_boundary(events,reason):
    import observe_live_study as O
    from study_controller import Hold
    class DB:
        @contextmanager
        def transaction(self):yield self
        def execute(self,*a):return self
        def fetchall(self):return [{'phase':'selection:3','kind':kind,'data':data} for kind,data in events]
    if reason:
        with pytest.raises(Hold,match=reason):O.pending_safety(NS(db=DB()),{'current_run':'run'})
    else:
        assert O.pending_safety(NS(db=DB()),{'current_run':'run'})['selection:3']['dispatch']==1
