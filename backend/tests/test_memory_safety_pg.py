"""B3.5a deterministic current-authority/recovery controls, not model utility."""
import json
import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch
import pytest
import psycopg
from test_domain import context,cmd,raises,PrivateDsn
from test_conversations import conversation,post
from test_memory_pg import remember,inspect
from test_memory_dependencies_pg import child
from test_memory_parent_worker import activated
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.db import Database
from workagent.service import Service
from workagent.memory.models import MemoryCAS,CorrectMemory,MemorySource
from workagent.errors import DomainError


@pytest.mark.parametrize('change',['correct','forget','revoke'])
@pytest.mark.parametrize('boundary',['count','send'])
def test_mutation_inflight_no_stale_publication_or_restart_send(context,tmp_path,change,boundary):
    s,p,ws,refs,admin=context;cv=conversation(context)
    root,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])],content='Old synthetic canary A')
    activated(context,cv);q=post(context,cv,'Summarize scoped work')
    class Mutating(AlphaProvider):
        changed=False
        def handle(self,request):
            result=super().handle(request)
            count=request.url.path.endswith('input_tokens')
            if request.method=='POST' and count==(boundary=='count') and not self.changed:
                self.changed=True
                if change=='correct':s.correct_memory(p,ws,root.memory_id,cmd(CorrectMemory,expected_revision_id=root.revision_id,content='New synthetic value'))
                elif change=='forget':s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
                else:
                    with Database(admin).transaction() as c:c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
            return result
    provider=Mutating([{'kind':'reply','text':'STALE SYNTHETIC RESULT'}])
    w=worker(context,provider,tmp_path)
    try:finish_safe_visits(context,w,q.run.id)
    except DomainError as e:assert e.code.value in ('source_changed','not_found_or_not_authorized','stale_worker')
    assert provider.changed
    assert not any('STALE SYNTHETIC RESULT' in m.text for m in s.get_conversation(p,ws,cv.id).messages)
    before=list(provider.calls)
    from test_runtime import expire
    expire(context,q.run.id)
    try:worker(context,provider,tmp_path).work(p,ws,q.run.id)
    except DomainError as e:assert e.code.value in ('source_changed','not_found_or_not_authorized','stale_worker')
    assert provider.calls==before
    if boundary=='count':assert not provider.contexts
    with s.db.transaction() as c:
        events=c.execute("SELECT e.kind FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s",(ws,q.run.id)).fetchall()
        assert not any(r['kind']=='dispatch' for r in events) if boundary=='count' else True


def test_queued_context_regenerates_and_published_reply_hidden(context,tmp_path):
    s,p,ws,_,_=context;cv=conversation(context);root,_=remember(context,cv)
    activated(context,cv);q=post(context,cv,'Use the current preference')
    corrected=s.correct_memory(p,ws,root.memory_id,cmd(CorrectMemory,expected_revision_id=root.revision_id,content='Fresh synthetic preference'))
    provider=AlphaProvider([{'kind':'reply','text':'Derived synthetic answer'}])
    assert finish_safe_visits(context,worker(context,provider,tmp_path),q.run.id).state=='ready'
    assert [e['revision_id'] for e in provider.contexts[0]['memory_manifest']]==[corrected.revision_id]
    assert s.get_conversation(p,ws,cv.id).messages[-1].text=='Derived synthetic answer'
    receipt=s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=corrected.revision_id))
    assert receipt.erased_memory_items==1 and 'provider-side deletion' in receipt.retention_notice
    assert all('Derived synthetic answer' not in m.text for m in s.get_conversation(p,ws,cv.id).messages)
    # New request after hiding old output occupies the next durable sequence slot.
    latest=s.get_conversation(p,ws,cv.id).conversation
    next_run=post(context,latest,'Fresh request after forget')
    with s.db.transaction() as c:
        sequences=c.execute('SELECT sequence FROM conversation_messages WHERE workspace_id=%s AND conversation_id=%s ORDER BY sequence',(ws,cv.id)).fetchall()
    assert [r['sequence'] for r in sequences]==list(range(1,len(sequences)+1))
    fresh=AlphaProvider([{'kind':'reply','text':'Fresh answer without memory'}])
    assert finish_safe_visits(context,worker(context,fresh,tmp_path),next_run.run.id).state=='ready'
    assert fresh.contexts[0]['memory_manifest']==[]
    assert 'Derived synthetic answer' not in json.dumps(fresh.contexts)


def env_file(path):
    return {k:v for line in Path(path).read_text().splitlines() if line.startswith('export ') for k,v in [line[7:].split('=',1)]}


@pytest.mark.parametrize('repetition',[1,2])
def test_real_backup_restore_current_tombstones_permissions_and_process_readback(context,tmp_path,repetition):
    from isolated_restore import backup,restore
    s,p,ws,refs,admin=context;cv=conversation(context)
    root,_=remember(context,cv,content='FORGOTTEN_SYNTHETIC_PAYLOAD')
    descendant=child(context,cv,root,content='FORGOTTEN_DERIVATIVE')
    other,_=remember(context,cv,subject_key='retained',content='Old retained preference')
    sourced,_=remember(context,cv,subject_key='source',source_refs=[MemorySource(ref=refs[0])])
    # Include a retained derived summary, provider authority and a human original
    # in the old backup; exclusion must cover more than memory CRUD after restore.
    from test_workspace_files_pg import make
    human_cv,human_file,_=make(context,'PRESERVED_RESTORE_HUMAN')
    activated(context,cv);q=post(context,cv,'Make a derived summary')
    fake=AlphaProvider([{'kind':'reply','text':'FORGOTTEN_SUMMARY_CANARY'}],explanation='FORGOTTEN_EXPLANATION_CANARY')
    assert finish_safe_visits(context,worker(context,fake,tmp_path/'before'),q.run.id).state=='ready'
    archive=tmp_path/'before.dump';backup(admin,archive)
    s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    corrected=s.correct_memory(p,ws,other.memory_id,cmd(CorrectMemory,expected_revision_id=other.revision_id,content='Current preference after backup'))
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
        generation=c.execute('SELECT access_generation FROM workspaces WHERE id=%s',(ws,)).fetchone()['access_generation']
    restored_env=restore(archive,admin,tmp_path/'restored')
    vals=env_file(restored_env);r=Service(Database(PrivateDsn(vals['DATABASE_URL'])));r.db.check_runtime_role()
    from types import SimpleNamespace
    from workagent.service import Principal
    # All adapters share this exact scope guard; absence of kind must never
    # accidentally elevate a file/compute/office worker to a recovery human.
    for identity in (SimpleNamespace(id=p.id),Principal(p.id,'worker')):
        with pytest.raises(DomainError) as denied,r.db.transaction() as c:r._scope(c,identity,ws,write=True)
        assert denied.value.code.value=='action_unresolved'
    assert 'FORGOTTEN_' not in r.get_conversation(p,ws,cv.id).model_dump_json()
    assert r.read_workspace_file(p,ws,human_file.workspace_file_id,human_file.current.version_id,human_file.current.sha256).text=='PRESERVED_RESTORE_HUMAN'
    for item in (root,descendant):
        result=r.inspect_memory(p,ws,item.memory_id)
        assert result.current.status=='forgotten' and all(x.content is None for x in result.revisions)
    assert r.inspect_memory(p,ws,other.memory_id).current.revision_id==corrected.revision_id
    assert r.list_memory(p,ws,cv.id).items[0].revision.content=='Current preference after backup'
    raises('not_found_or_not_authorized',lambda:r.inspect_memory(p,ws,sourced.memory_id))
    with r.db.transaction() as c:
        assert c.execute('SELECT access_generation FROM workspaces WHERE id=%s',(ws,)).fetchone()['access_generation']>generation
        assert c.execute('SELECT data FROM isolated_restore_receipt').fetchone()['data']['current_safety_replayed']
        assert not c.execute('SELECT 1 FROM provider_grants WHERE active UNION ALL SELECT 1 FROM tool_grants WHERE active').fetchone()
        assert c.execute('SELECT 1 FROM provider_attempts WHERE workspace_id=%s',(ws,)).fetchone()
        with pytest.raises(psycopg.Error),c.transaction():c.execute('UPDATE memory_items SET current_revision_id=NULL WHERE workspace_id=%s',(ws,))
    # Fresh actual interpreter readback, not Service object reconstruction.
    code="import os,json; from workagent.db import Database; from workagent.service import Service,Principal; s=Service(Database()); print(json.dumps(s.list_memory(Principal('local-human'),os.environ['TEST_WS'],os.environ['TEST_CV']).model_dump(mode='json')))"
    result=subprocess.run([sys.executable,'-c',code],env={**os.environ,**vals,'TEST_WS':ws,'TEST_CV':cv.id},capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr
    assert 'FORGOTTEN_' not in result.stdout and 'Current preference after backup' in result.stdout
    # Deliberate human recovery writes remain possible; no provider run can begin.
    after=r.correct_memory(p,ws,other.memory_id,cmd(CorrectMemory,expected_revision_id=corrected.revision_id,content='Recovered human correction'))
    assert r.inspect_memory(p,ws,other.memory_id).current.content=='Recovered human correction'
    r.forget_memory(p,ws,other.memory_id,cmd(MemoryCAS,expected_revision_id=after.revision_id))
    assert r.list_memory(p,ws,cv.id).items==[]
    raises('action_unresolved',lambda:post((r,p,ws,refs,admin),cv,'Never replay restored execution'))
