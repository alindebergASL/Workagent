"""Source generations coexist; source publication never moves durable state."""
import os
from pathlib import Path
import pytest
import study_application as app


def source(tmp_path):
    root=tmp_path/'source';root.mkdir();(root/'module.py').write_text('old source\n')
    return root


def key(root):
    return app.digest(app.canonical(app.inventory(root)))


def test_old_successor_and_subsequent_ordinary_episode(tmp_path):
    src=source(tmp_path);slot=tmp_path/'slot';slot.mkdir()
    historic=slot/'product-gateway-recovery';historic.mkdir();(historic/'old.py').write_text('historical')
    state=slot/'worker-state';state.mkdir();(state/'receipt.json').write_text('durable')
    oldkey=key(src);old=app.stage_execution_source(slot,src,oldkey)
    (src/'module.py').write_text('successor source\n');newkey=key(src)
    new=app.stage_execution_source(slot,src,newkey)
    assert new!=old and old.name=='product-'+oldkey and new.name=='product-'+newkey
    assert app.stage_execution_source(slot,src,newkey)==new  # subsequent episode
    assert app.stage_execution_source(slot,src,oldkey)==old  # retained exact snapshot
    assert (old/'module.py').read_text()=='old source\n'
    assert (historic/'old.py').read_text()=='historical'
    assert (state/'receipt.json').read_text()=='durable'


@pytest.mark.parametrize('damage',['changed','extra','missing','symlink','directory_symlink','bytecode','fifo'])
def test_reuse_checks_full_safe_inventory(tmp_path,damage):
    src=source(tmp_path);slot=tmp_path/'slot';slot.mkdir();expected=key(src)
    staged=app.stage_execution_source(slot,src,expected)
    if damage=='changed':(staged/'module.py').write_text('drift')
    if damage=='extra':(staged/'extra.py').write_text('drift')
    if damage=='missing':(staged/'module.py').unlink()
    if damage=='symlink':(staged/'module.py').unlink();(staged/'module.py').symlink_to(src/'module.py')
    if damage=='directory_symlink':(staged/'linked').symlink_to(src,target_is_directory=True)
    if damage=='bytecode':(staged/'module.pyc').write_bytes(b'ignored by old inventory')
    if damage=='fifo':os.mkfifo(staged/'fifo')
    with pytest.raises(app.Hold):app.stage_execution_source(slot,src,expected)


@pytest.mark.parametrize('damage',['symlink','fifo','hash','path','root_symlink'])
def test_unsafe_source_or_hash_denied(tmp_path,damage):
    src=source(tmp_path);slot=tmp_path/'slot';slot.mkdir();expected=key(src)
    if damage=='symlink':(src/'link').symlink_to(src/'module.py')
    if damage=='fifo':os.mkfifo(src/'fifo')
    if damage=='hash':expected='0'*64
    if damage=='path':expected='../other'
    if damage=='root_symlink':alias=tmp_path/'alias';alias.symlink_to(src,target_is_directory=True);src=alias
    with pytest.raises(app.Hold):app.stage_execution_source(slot,src,expected)
    assert list(slot.iterdir())==[]


def test_copy_drift_never_publishes_partial(tmp_path,monkeypatch):
    src=source(tmp_path);slot=tmp_path/'slot';slot.mkdir();expected=key(src)
    copy=app.shutil.copytree
    def corrupt(*a,**kw):
        result=copy(*a,**kw);(Path(result)/'module.py').write_text('changed during copy');return result
    monkeypatch.setattr(app.shutil,'copytree',corrupt)
    with pytest.raises(app.Hold,match='copied_arm_drift'):app.stage_execution_source(slot,src,expected)
    assert list(slot.iterdir())==[]


def test_atomic_publication_only_after_verified_copy(tmp_path,monkeypatch):
    src=source(tmp_path);slot=tmp_path/'slot';slot.mkdir();expected=key(src)
    rename=Path.rename;seen=[]
    def publish(candidate,target):
        assert not target.exists()
        assert app.digest(app.canonical(app.staged_inventory(candidate)))==expected
        seen.append(target)
        return rename(candidate,target)
    monkeypatch.setattr(Path,'rename',publish)
    result=app.stage_execution_source(slot,src,expected)
    assert seen==[result] and list(slot.iterdir())==[result]


def test_execute_uses_hash_generation_and_same_worker_state_across_episodes(tmp_path,monkeypatch):
    from contextlib import contextmanager
    from types import SimpleNamespace
    import json
    repo=tmp_path/'repo';src=repo/'backend/workagent';src.mkdir(parents=True)
    (src/'module.py').write_text('old')
    slot=tmp_path/'slot';slot.mkdir();mounted=[]
    class Connection:
        def execute(self,*a):return self
        def fetchone(self):return {'data':{}}
    @contextmanager
    def transaction():yield Connection()
    service=SimpleNamespace(db=SimpleNamespace(transaction=transaction),
        get_run=lambda *a:SimpleNamespace(state='ready',id='run',unresolved=[]))
    monkeypatch.setattr(app,'ROOT',repo)
    monkeypatch.setattr(app,'context',lambda *a:(service,SimpleNamespace(id='human'),{'DATABASE_URL':'postgresql://127.0.0.1:5432/synthetic'}))
    def launch(inputs,state,product):
        mounted.append((state,product))
        return ['jail',str(repo/'evaluation/network_worker.py'),'--','python']
    monkeypatch.setattr(app,'jail',launch)
    monkeypatch.setattr(app.subprocess,'run',lambda *a,**kw:SimpleNamespace(returncode=0,stdout=json.dumps({'state':'ready'}),stderr=''))
    state=dict(variant='B1',episode=1,workspace='ws',current_run='run',mode='controlled_http',
        controlled_origin='http://127.0.0.1:12345',active_grant={'id':'grant'},input_files={},
        environment={'dependencies':{},'files':{}},inputs=str(tmp_path/'inputs'),source_manifest_sha256=key(src))
    app.execute(slot,state,{})
    (src/'module.py').write_text('successor');state.update(episode=2,source_manifest_sha256=key(src),source_amendment='gateway-rejection-feedback-v1')
    app.execute(slot,state,{})
    state['episode']=3
    app.execute(slot,state,{})
    assert mounted[0][1]!=mounted[1][1] and mounted[1][1]==mounted[2][1]
    assert all(path==slot/'worker-state' for path,_ in mounted)
    assert (mounted[0][1]/'module.py').read_text()=='old'
