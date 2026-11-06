"""No-provider unit controls; real known-ID recovery is covered separately."""
from contextlib import contextmanager
from types import SimpleNamespace
import pytest
from observe_live_study import pending_safety
from study_controller import Hold

class DB:
    def __init__(self,events):self.events=events
    @contextmanager
    def transaction(self):yield self
    def execute(self,sql,args):
        assert args==('exact-run',)
        return self
    def fetchall(self):return self.events

def check(kinds):
    rows=[dict(phase='selection',kind=k,data=d) for k,d in kinds]
    return pending_safety(SimpleNamespace(db=DB(rows)),dict(current_run='exact-run'))

@pytest.mark.parametrize('events',[
 [('count_send',{})],
 [('count_send',{}),('count_problem',{})],
 [('dispatch',{})],
 [('dispatch',{}),('identity',{})],
 [('dispatch',{}),('identity',{'response_id':'id'}),('identity',{'response_id':'other'})]])
def test_unknown_effect_denied(events):
    with pytest.raises(Hold):check(events)

def test_known_identity_is_observable_without_new_dispatch():
    counts=check([('count_send',{}),('count_result',{}),('dispatch',{}),('identity',{'response_id':'exact-response'})])
    assert counts['selection']==dict(count_send=1,count_result=1,dispatch=1,identity=1)

def test_settled_effect_and_no_effect_are_safe_for_normal_worker():
    assert check([])=={}
    assert check([('dispatch',{}),('result',{'state':'failed'})])['selection']==dict(dispatch=1,result=1)


def test_exact_real_format_bridge_selection():
    import sqlite3
    from observe_live_study import select_pending,canonical,digest
    b=sqlite3.connect(':memory:');c=sqlite3.connect(':memory:')
    b.row_factory=c.row_factory=sqlite3.Row
    b.execute('CREATE TABLE receipts(key,payload,state,result)')
    c.execute('CREATE TABLE operations(key,trial,episode,operation,payload,state,result)')
    payload=canonical(dict(trajectory=dict(id='trial',variant='B1'),episode=1,admitted=dict(run_id='exact-run')))
    key=digest(canonical(['trial',1,'execute',digest(payload)]))
    b.execute('INSERT INTO receipts VALUES (?,?,?,NULL)',(key,payload,'sending'))
    c.execute('INSERT INTO operations VALUES (?,?,?,?,?,?,NULL)',(key,'trial',1,'execute',payload,'unknown'))
    old,p=select_pending(b,c,'trial');assert old['key']==key and p['admitted']['run_id']=='exact-run'
    b.execute('UPDATE receipts SET payload=?',('{}',))
    with pytest.raises(Hold):select_pending(b,c,'trial')
    b.execute('UPDATE receipts SET payload=?,state=?',(payload,'complete'))
    with pytest.raises(Hold):select_pending(b,c,'trial')
    b.close();c.close()


def test_actual_jail_uses_original_real_state(tmp_path):
    import subprocess
    from pathlib import Path
    from observe_live_study import durable_jail
    from network_harness import REPO
    durable=(tmp_path/'durable').resolve();durable.mkdir(mode=0o700)
    (durable/'canary').write_text('original-state-not-replacement')
    placeholder=tmp_path/'fresh';placeholder.mkdir(mode=0o700)
    argv=durable_jail(REPO/'.local/batch3/b35c/preparation/public-inputs/B1/episode-1',placeholder,
       REPO/'backend/workagent',expected=placeholder,durable=durable)
    # Same bubblewrap mounts, tiny no-network process instead of product worker.
    argv=argv[:argv.index('--')+1]+['/usr/bin/python3','-I','-B','-c',
        'from pathlib import Path; assert Path("/state/canary").read_text()=="original-state-not-replacement"; print("real-state-mounted")']
    p=subprocess.run(argv,text=True,capture_output=True,timeout=30)
    assert p.returncode==0 and p.stdout.strip()=='real-state-mounted',p.stderr
    symlink=tmp_path/'symlink';symlink.symlink_to(durable,target_is_directory=True)
    with pytest.raises(AssertionError):durable_jail(REPO,placeholder,REPO,expected=placeholder,durable=symlink)
