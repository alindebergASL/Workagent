"""Concrete regression assertions from the independent B3.5a risk review."""
from pathlib import Path
from hashlib import sha256
from datetime import timedelta
import pytest
from test_domain import context,cmd,raises
from test_conversations import conversation,post
from test_memory_pg import remember,inspect
from test_memory_parent_worker import activated
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.memory.models import MemoryCAS,MemoryFile
from workagent.models import new_id,now,HumanSave
from workagent.db import Database
from workagent.capabilities import registry,policy
from workagent.capabilities.models import ToolGrantV1,CapabilityPin


def test_forget_closes_every_conversation_readback_projection(context,tmp_path):
    s,p,ws,_,_=context;cv=conversation(context);root,_=remember(context,cv)
    activated(context,cv);q=post(context,cv,'Use memory')
    canary='REVIEW_FORGOTTEN_REPLY_CANARY'
    fake=AlphaProvider([{'kind':'reply','text':canary}],explanation=canary)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    assert canary in s.get_conversation(p,ws,cv.id).model_dump_json()
    s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    assert canary not in s.get_conversation(p,ws,cv.id).model_dump_json()
    assert canary not in s.list_conversations(p,ws).model_dump_json()
    # No historical outgoing request/response is falsely claimed erased.
    with s.db.transaction() as c:
        assert c.execute("SELECT 1 FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s AND e.data::text LIKE %s",(ws,q.run.id,'%'+canary+'%')).fetchone()


@pytest.mark.parametrize('mutation',['forget','correct','revoke'])
@pytest.mark.parametrize('human_edit',[False,True])
def test_file_producer_closes_read_export_descendant_and_preserves_human(context,tmp_path,human_edit,mutation):
    from workagent.workspace_file_models import ExportFile,EditWorkspaceFile
    from workagent.memory.models import CorrectMemory,MemorySource
    from workagent.service import Service,encoded
    import psycopg
    s,p,ws,refs,admin=context;cv=conversation(context);root,_=remember(context,cv,source_refs=[MemorySource(ref=refs[0])])
    activated(context,cv);q=post(context,cv,'Create a draft from memory')
    d=registry.adapters()['files.create_draft'].descriptor
    grant=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256)],resource_selectors=[],effects=d.effects,
        privacy_classes=['workspace_private'],egress='none',expires_at=now()+timedelta(hours=1),access_generation=q.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),grant,limits={'local_compute':5})
    canary='REVIEW_FORGOTTEN_DRAFT_CANARY'
    fake=AlphaProvider([dict(kind='files_create_draft',source=dict(kind='text',filename='review.txt',mime_type='text/plain',content=canary,sha256=sha256(canary.encode()).hexdigest())),dict(kind='reply',text='Saved')],explanation=canary)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    f=s.list_workspace_files(p,ws,cv.id).items[0]
    leaf,_=remember(context,cv,subject_key='file-derived',source_refs=[MemoryFile(ref=f.current)])
    from test_procedure_memory_pg import propose
    from workagent.memory.models import ReviewMemory
    options=s.memory_lesson_evidence(p,ws,cv.id).items
    option=next(o for o in options if o.evidence.kind=='tool_observation')
    proposed=propose(context,cv,option.evidence)
    exported=s.export_workspace_file(p,ws,f.workspace_file_id,cmd(ExportFile,version_id=f.current.version_id,sha256=f.current.sha256,format='txt'))
    assert canary.encode() in s.download_export(p,ws,exported.export_id)[1]
    if human_edit:
        text='PRESERVED_HUMAN_ORIGINAL'
        human=s.edit_workspace_file(p,ws,f.workspace_file_id,cmd(EditWorkspaceFile,
            expected_work_version=s.get_conversation(p,ws,cv.id).conversation.work_version,
            base_version_id=f.current.version_id,base_sha256=f.current.sha256,content=text,sha256=sha256(text.encode()).hexdigest()))
    forged=inspect(context,leaf).current.model_dump(mode='json')
    if mutation=='forget':
        receipt=s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
        assert receipt.erased_memory_items==3
        assert inspect(context,leaf).current.status=='forgotten'
    elif mutation=='correct':
        s.correct_memory(p,ws,root.memory_id,cmd(CorrectMemory,expected_revision_id=root.revision_id,content='Corrected source-dependent preference'))
    else:
        with Database(admin).transaction() as c:c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    s=Service(s.db)  # Fresh service also denies every saved derivative.
    if mutation!='forget':raises('not_found_or_not_authorized',lambda:s.inspect_memory(p,ws,leaf.memory_id))
    forged.update(memory_id=new_id(),revision_id=new_id(),subject_key='new-attempt')
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute('SELECT write_memory_revision(%s,%s,%s,NULL,%s)',(ws,p.id,'remember',encoded(forged)))
    assert all(o.evidence.kind!='tool_observation' for o in s.memory_lesson_evidence(p,ws,cv.id).items)
    from workagent.errors import DomainError
    with pytest.raises(DomainError) as refused:s.review_memory(p,ws,proposed.memory_id,cmd(ReviewMemory,expected_revision_id=proposed.revision_id,decision='accept'))
    assert refused.value.code.value in ('not_found_or_not_authorized','action_unresolved','version_conflict')
    assert canary not in s.get_conversation(p,ws,cv.id).model_dump_json()
    raises('not_found_or_not_authorized',lambda:s.read_workspace_file(p,ws,f.workspace_file_id,f.current.version_id,f.current.sha256))
    raises('not_found_or_not_authorized',lambda:s.download_export(p,ws,exported.export_id))
    if human_edit:
        assert s.read_workspace_file(p,ws,f.workspace_file_id,human.current.version_id,human.current.sha256).text==text
        assert len(s.list_workspace_files(p,ws,cv.id).items)==1
        assert len(s.history(p,ws,f.workspace_file_id).items)==1
    else:assert s.list_workspace_files(p,ws,cv.id).items==[]


@pytest.mark.parametrize('mutation',['forget','correct','revoke'])
def test_proposal_hidden_and_cannot_be_accepted_after_forget(context,tmp_path,mutation):
    from test_work_area_context import saved,document
    from workagent.models import AcceptProposal
    s,p,ws,_,_=context;cv,a=saved(context)
    a=s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=document('PRESERVED_HUMAN_ORIGINAL')))
    from workagent.memory.models import CorrectMemory,MemorySource
    from workagent.service import Service
    root,_=remember(context,cv,source_refs=[MemorySource(ref=context[3][0])]);activated(context,cv);q=post(context,cv,'Revise my draft using the preference')
    canary='REVIEW_FORGOTTEN_PROPOSAL_CANARY'
    def choose(c):return {'kind':'publish_artifact','target':c['work_area_context']['offered_targets'][0],'body':document(canary)}
    fake=AlphaProvider([choose,{'kind':'reply','text':canary}],explanation=canary)
    finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    proposal=s.proposals(p,ws,a.id).items[0]
    if mutation=='forget':s.forget_memory(p,ws,root.memory_id,cmd(MemoryCAS,expected_revision_id=root.revision_id))
    elif mutation=='correct':s.correct_memory(p,ws,root.memory_id,cmd(CorrectMemory,expected_revision_id=root.revision_id,content='Revised preference'))
    else:
        with Database(context[4]).transaction() as c:c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,context[3][0].source_id))
    s=Service(s.db)
    assert s.proposals(p,ws,a.id).items==[]
    assert s.get_artifact(p,ws,a.id).current_revision.body.blocks[0].text=='PRESERVED_HUMAN_ORIGINAL'
    assert canary not in s.get_conversation(p,ws,cv.id).model_dump_json()
    raises('not_found_or_not_authorized',lambda:s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=a.current_revision_id)))
