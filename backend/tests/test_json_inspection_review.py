"""Adversarial checks resolving independent review hypotheses, without provider I/O."""
import copy
import pytest
import psycopg
from pydantic import ValidationError
from test_domain import context,cmd,raises
from test_conversations import conversation
from test_general_alpha_runtime import activate
from test_general_responses import worker
from test_json_inspection_runtime import test_same_vectors_through_python_and_restricted_sql as run_vector
from test_saved_work_retrieval import CheckedProvider
from workagent.models import PostMessage,AttachmentInput,ConversationMessage
from workagent.service import encoded


@pytest.mark.parametrize('content,status',[
    ('{"b":1,"aa":2}','complete'),
    ('{"𐀀":1,"":2,"a":3,"aa":4}','complete'),
    ('{"x":NaN}','invalid_input'),
    ('{"x":Infinity}','invalid_input'),
    ('\ufeff{}','invalid_input'),
    ('{"x":"\\ud800"}','invalid_input'),
])
def test_review_parity_vectors(context,tmp_path,content,status):
    run_vector(context,tmp_path,content,[],status)


def test_attachment_hash_and_nonnull_list_checked_at_admission(context,monkeypatch):
    s,p,ws,_,_=context;cv=conversation(context);activate(context,cv)
    original=s._append_message;checked=[]
    def check(c,workspace,message):
        if message.author_kind=='human':
            for mutation in ('hash','null'):
                value=message.model_dump(mode='json')
                if mutation=='hash':value['attachments'][0]['sha256']='0'*64
                else:value['attachments']=None
                with pytest.raises(ValidationError):ConversationMessage.model_validate(value)
                with pytest.raises(psycopg.Error,match='(immutable attachment bytes/hash|required|bounded general message)'):
                    with c.transaction():
                        c.execute('INSERT INTO conversation_messages(workspace_id,conversation_id,id,run_id,sequence,author_kind,data) VALUES (%s,%s,%s,%s,%s,%s,%s)',
                            (ws,message.conversation_id,message.id,message.run_id,message.sequence,message.author_kind,encoded(value)))
                checked.append(mutation)
        return original(c,workspace,message)
    monkeypatch.setattr(s,'_append_message',check)
    s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Synthetic input',
        attachments=[AttachmentInput(filename='records.json',mime_type='text/plain',content='{}')]))
    assert checked==['hash','null']


def test_result_selection_has_unique_event_index(context):
    s,p,ws,_,_=context
    with s.db.transaction() as c:
        definition=c.execute("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='responses_one_event'").fetchone()['indexdef']
    assert 'UNIQUE INDEX' in definition and '(attempt_id, phase, kind)' in definition
    assert "ARRAY['read'::text, 'cancel'::text]" in definition


def test_system_responsibility_cannot_invoke_inspection(context,tmp_path,monkeypatch):
    from test_responsibility_execution import setup,edit,admitted
    import workagent.json_inspection as parser
    s,p,ws,_,_=context;cv,art,a,g,life=setup(context)
    edit(context,art);s.advance_responsibilities(ws,g.id);rows=admitted(s,ws);assert len(rows)==1
    monkeypatch.setattr(parser,'inspect_json',lambda *_:pytest.fail('No attachment read from system scope'))
    fake=CheckedProvider([{'kind':'inspect_json','attachment':{'ref':'not-offered','sha256':'0'*64},'path':[]}])
    raises('not_found_or_not_authorized',lambda:worker(context,fake,tmp_path).work(p,ws,rows[0]['run_id']))
    assert len(fake.contexts)==1
