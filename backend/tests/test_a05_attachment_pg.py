"""A05 original-byte retrieval through actual worker/SQL; synthetic transport only."""
from hashlib import sha256
import pytest
from test_domain import context, cmd
from test_conversations import conversation, post
from test_b24_runtime_pg import activate
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_sustained_continuity import Interrupted
from workagent.models import AttachmentInput, PostMessage
from workagent.retained_results import ReadAttachment, material
from workagent.errors import DomainError

TEXT='\ufeffHeader\r\n'+'abcdefghij\r\n'*3000+'ORIGINAL_TAIL_é🙂\r\n'


def upload(ctx,cv):
    s,p,ws,_,_=ctx
    return s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Inspect my original file.',
        attachments=[AttachmentInput(filename='original.txt',mime_type='text/plain',content=TEXT)]))


def select(item,offset=0,limit=8192):
    return {'kind':'read_attachment',**{k:item[k] for k in ('message_id','ref','sha256')},'offset':offset,'limit':limit}


def test_original_bom_crlf_tail_historical_no_resupply_and_truthful_projection(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,cv,max_steps=3)
    q=upload(context,cv)
    assert s.get_conversation(p,ws,cv.id).attachment_context==[]
    def first(ctx):
        item=ctx['evidence_context']['attachments']['items'][0]
        assert item['body_omitted'] and item['body'] is None
        assert any(d['name']=='read_attachment' for d in ctx['composition']['capabilities'])
        return select(item,0,17)
    def tail(ctx):
        page=ctx['adaptive']['observations'][-1]['capability_result']['result']
        assert page['text'].startswith('\ufeffHeader\r\n')
        assert page['body_sha256']==sha256(TEXT.encode()).hexdigest()
        assert page['chunk_sha256']==sha256(page['text'].encode()).hexdigest()
        offset=len(TEXT.encode())-len('ORIGINAL_TAIL_é🙂\r\n'.encode())
        return select(ctx['evidence_context']['attachments']['items'][0],offset)
    def answer(ctx):
        page=ctx['adaptive']['observations'][-1]['capability_result']['result']
        assert page['text']=='ORIGINAL_TAIL_é🙂\r\n' and page['complete']
        assert page['body_bytes']==len(TEXT.encode())
        return {'kind':'reply','text':'Original tail verified.'}
    fake=AlphaProvider([first,tail,answer])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    item=detail.attachment_context[0]
    assert item.body_omitted and item.omission_reason=='size_limit' and len(item.chunks)==2
    assert item.message_id==q.message.id and item.sha256==sha256(TEXT.encode()).hexdigest()
    # No resupply: the second run recovers the original bytes from the old message.
    q2=post(context,detail.conversation,'Read the same original tail again without a new attachment.')
    assert not q2.message.attachments
    historical=AlphaProvider([lambda ctx:select(ctx['evidence_context']['attachments']['items'][0],
        len(TEXT.encode())-len('ORIGINAL_TAIL_é🙂\r\n'.encode())),answer])
    assert finish_safe_visits(context,worker(context,historical,tmp_path),q2.run.id).state=='ready'
    projected=s.get_conversation(p,ws,cv.id).attachment_context[0]
    assert projected.run_id==q2.run.id and projected.message_id==q.message.id and len(projected.chunks)==1
    with s.db.transaction() as c:
        reads=c.execute('SELECT data FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',(ws,q2.run.id)).fetchall()
        assert len(reads)==1 and reads[0]['data']['result']['text']=='ORIGINAL_TAIL_é🙂\r\n'
    calls=list(historical.calls)
    worker(context,historical,tmp_path).work(p,ws,q2.run.id)
    assert historical.calls==calls


@pytest.mark.parametrize('failure',['hash','ref','message','principal','workspace','cross_conversation','revoked','stale_fence','stale_lease'])
def test_attachment_denial_before_any_receipt(context,tmp_path,failure):
    from workagent.service import WorkerCapability, Principal
    from test_runtime import expire
    from workagent.checkpoint_models import StopRun
    s,p,ws,_,_=context
    cv=conversation(context);grant=activate(context,cv,max_steps=2)
    q=upload(context,cv)
    fake=AlphaProvider([{'kind':'discover_capabilities'}])
    w=worker(context,fake,tmp_path)
    def interrupt(point):
        if point=='after_tool_result': raise Interrupted()
    w.phases.hook=interrupt
    with pytest.raises(Interrupted): finish_safe_visits(context,w,q.run.id)
    cap=WorkerCapability(**w.phases.state.load(ws,q.run.id)['worker'])
    a=q.message.attachments[0]
    d=ReadAttachment(**select({'message_id':q.message.id,'ref':a.ref,'sha256':a.sha256}))
    if failure in ('hash','ref','message'):
        d=d.model_copy(update={ {'hash':'sha256','ref':'ref','message':'message_id'}[failure]: '0'*64 if failure=='hash' else 'unknown'})
    if failure=='stale_lease': expire(context,q.run.id)
    if failure=='revoked':
        from workagent.provider_attempts import revoke_grant
        from workagent.db import Database
        revoke_grant(Database(context[4]),grant.id)
    if failure=='stale_fence': s.stop_conversation_run(p,ws,cv.id,cmd(StopRun,expected_work_version=q.conversation.work_version,run_id=q.run.id))
    foreign=conversation(context) if failure=='cross_conversation' else None
    with pytest.raises(DomainError):
        with s.db.transaction() as c:
            actor,run,current=s._check_capability(c,cap)
            if failure=='principal': actor=Principal('foreign-human')
            if failure=='workspace': run=run.model_copy(update={'workspace_id':'foreign-workspace'})
            if failure=='cross_conversation': current=foreign
            material(s,c,actor,run,current,d)
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['n']==0


def test_attachment_read_receipt_is_revalidated_after_target_change(context,tmp_path):
    from test_sustained_continuity import draft
    from test_general_responses import target
    from workagent.models import HumanSave
    s,p,ws,_,_=context
    cv=conversation(context);activate(context,cv,max_steps=2)
    q=post(context,cv,'Create a saved target.')
    initial=AlphaProvider([draft('Saved target'),{'kind':'reply','text':'Saved.'}])
    assert finish_safe_visits(context,worker(context,initial,tmp_path),q.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id); art=s.get_artifact(p,ws,detail.artifact_ids[0])
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=detail.conversation.work_version,
        text='Read original attachment for this exact target.',target=target(art),
        attachments=[AttachmentInput(filename='target.txt',mime_type='text/plain',content=TEXT)]))
    fake=AlphaProvider([lambda ctx:select(ctx['evidence_context']['attachments']['items'][0],len(TEXT.encode())-24),
                        {'kind':'reply','text':'Should not publish after target edit.'}])
    w=worker(context,fake,tmp_path)
    def interrupt(point):
        if point=='after_tool_result': raise Interrupted()
    w.phases.hook=interrupt
    with pytest.raises(Interrupted): finish_safe_visits(context,w,q.run.id)
    body=art.current_revision.body.model_copy(update={'title':'Human changed exact target'})
    s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
    before=list(fake.calls)
    with pytest.raises(DomainError,match='version_conflict'):
        finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert fake.calls==before
    assert all(m.text!='Should not publish after target edit.' for m in s.get_conversation(p,ws,cv.id).messages)
