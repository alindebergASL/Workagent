from pathlib import Path
import pytest
from workagent.operator_journal import OperatorError
from workagent.tui.file_drafts import FileDraftStore, FileDraftSession


def store(path, conversation='conversation-a'):
    return FileDraftStore('http://127.0.0.1:9000', 'workspace-a', 'human-a', conversation, path=path)


def test_file_draft_exact_restart_scope_and_pending(tmp_path):
    path=tmp_path/'private'
    session=FileDraftSession(store(path))
    text='\ufeffHuman annotation 雪\r\nsecond\n'
    session.edit(content=text, pending={'command_id':'exact-command','body':{'content':text}})
    restored=FileDraftSession(store(path))
    assert restored.draft==session.draft
    assert restored.draft['content'].encode()==text.encode()
    assert FileDraftSession(store(path,'conversation-b')).draft['content']==''
    assert all(p.stat().st_mode & 0o777 == 0o600 for p in path.glob('*.json'))


def test_file_draft_concurrent_write_preserves_durable(tmp_path):
    first=FileDraftSession(store(tmp_path/'private'))
    second=FileDraftSession(store(tmp_path/'private'))
    first.edit(content='first human edit')
    with pytest.raises(OperatorError,match='changed in another'):
        second.edit(content='stale human edit')
    assert second.draft['content']==''
    assert FileDraftSession(store(tmp_path/'private')).draft['content']=='first human edit'


def test_file_draft_symlink_denied(tmp_path):
    target=tmp_path/'target';target.mkdir(mode=0o700)
    link=tmp_path/'link';link.symlink_to(target,target_is_directory=True)
    with pytest.raises(OperatorError):
        FileDraftSession(store(link))
    assert list(target.iterdir())==[]


def test_file_selection_keeps_unsent_content(tmp_path):
    session=FileDraftSession(store(tmp_path/'private'))
    session.edit(content='unsent new file')
    session.select('existing')
    session.edit(content='unsent existing edit',base={'version_id':'exact-base'})
    session.select('__new__')
    assert session.draft['content']=='unsent new file'
    restored=FileDraftSession(store(tmp_path/'private'))
    restored.select('existing')
    assert restored.draft['content']=='unsent existing edit'
    assert restored.draft['base']=={'version_id':'exact-base'}
