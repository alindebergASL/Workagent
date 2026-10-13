"""Attachments remain inert exact UTF-8 evidence, not executable uploads."""
from hashlib import sha256
import pytest
from pydantic import ValidationError
from workagent.message_models import AttachmentInput,MessageAttachment
from workagent.models import PostMessage,new_id

EXTENSIONS=('csv','txt','md','py','js','jsx','ts','tsx','json','yaml','yml','toml','xml','html','css','sql','sh','wat','log')

@pytest.mark.parametrize('extension',EXTENSIONS)
def test_common_code_and_text_names_are_preserved(extension):
    name='Example.test.'+extension;text='\ufeff# café\r\n\tcontents\n'
    a=AttachmentInput(filename=name,mime_type='text/csv' if extension=='csv' else 'text/plain',content=text)
    assert a.filename==name and a.content==text
    stored=MessageAttachment(**a.model_dump(),ref='attachment',sha256=sha256(text.encode()).hexdigest(),byte_length=len(text.encode()))
    assert stored.content==text

@pytest.mark.parametrize('name',['../example.py','dir/example.py','dir\\example.py','.hidden.py','example..py','a.exe','x.png','a.zip','space name.py','a.PY','x.py\n','x.py.txt.exe','x'*82+'.txt'])
def test_filename_rejections(name):
    with pytest.raises(ValidationError):AttachmentInput(filename=name,mime_type='text/plain',content='safe')

@pytest.mark.parametrize('content',['','\x00','\ud800','é'*100001])
def test_bad_text_encoding_size_or_empty(content):
    with pytest.raises(ValidationError):AttachmentInput(filename='example.py',mime_type='text/plain',content=content)


def test_mime_exact_bytes_and_aggregate_limits_unchanged():
    with pytest.raises(ValidationError):AttachmentInput(filename='example.py',mime_type='text/csv',content='a')
    with pytest.raises(ValidationError):AttachmentInput(filename='data.csv',mime_type='text/plain',content='a')
    a=AttachmentInput(filename='example.py',mime_type='text/plain',content='é'*100000)
    payload=dict(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),expected_work_version=1,text='Read this as context only.')
    PostMessage.model_validate(payload|{'attachments':[a]})
    b=AttachmentInput(filename='README.md',mime_type='text/plain',content='x')
    with pytest.raises(ValidationError):PostMessage.model_validate(payload|{'attachments':[a,b]})
    with pytest.raises(ValidationError):PostMessage.model_validate(payload|{'attachments':[b,b,b]})


def test_old_csv_txt_filename_boundary_and_control_policy_preserved():
    # New types do not invalidate persisted historical text accepted by this DTO.
    for ext in ('csv','txt'):
        AttachmentInput(filename='x'*81+'.'+ext,mime_type='text/csv' if ext=='csv' else 'text/plain',content='a\t\r\n')
    a=AttachmentInput(filename='script.py',mime_type='text/plain',content="__import__('os').system('MUST_NOT_EXECUTE')")
    assert 'MUST_NOT_EXECUTE' in a.content
