"""Local staging only; exact bytes, no uploads or path alias normalization."""
from hashlib import sha256
import os
import pytest
from workagent.operator_attachments import stage_text_files
from workagent.operator_journal import OperatorError


def test_exact_snapshot_survives_local_change(tmp_path):
    path=tmp_path/'evidence.csv'
    raw=b'\xef\xbb\xbfid,value\r\na,2\r\n'
    path.write_bytes(raw)
    staged=stage_text_files([str(path)])
    path.write_text('changed')
    assert staged[0].payload()=={'filename':'evidence.csv','mime_type':'text/csv','content':raw.decode('utf-8')}
    assert staged[0].sha256==sha256(raw).hexdigest()
    assert staged[0].byte_length==len(raw)
    assert str(path) not in repr(staged[0])


@pytest.mark.parametrize('name,raw',[
    ('bad name.txt',b'ok'),('UPPER.TXT',b'ok'),('binary.txt',b'\xff'),
    ('nul.txt',b'a\x00b'),('empty.txt',b''),('large.txt',b'x'*200001),
    ('original.pdf',b'%PDF-1.7'),
])
def test_invalid_files_fail_before_staging(tmp_path,name,raw):
    path=tmp_path/name;path.write_bytes(raw)
    with pytest.raises(OperatorError):stage_text_files([str(path)])


def test_count_and_aggregate_bound(tmp_path):
    paths=[]
    for i in range(3):
        path=tmp_path/f'file{i}.txt';path.write_bytes(b'a'*100001);paths.append(str(path))
    with pytest.raises(OperatorError):stage_text_files(paths)
    with pytest.raises(OperatorError):stage_text_files(paths[:2])


def test_symlink_fifo_directory_are_not_read(tmp_path):
    plain=tmp_path/'plain.txt';plain.write_text('content')
    link=tmp_path/'link.txt';link.symlink_to(plain)
    fifo=tmp_path/'pipe.txt';os.mkfifo(fifo)
    directory=tmp_path/'dir.txt';directory.mkdir()
    for p in (link,fifo,directory):
        with pytest.raises(OperatorError):stage_text_files([str(p)])


def test_staging_is_immutable_and_does_not_expose_content_repr(tmp_path):
    from dataclasses import FrozenInstanceError
    p=tmp_path/'context.md';p.write_text('synthetic-private-prompt')
    staged=stage_text_files([str(p)])
    assert 'synthetic-private-prompt' not in repr(staged)
    with pytest.raises(FrozenInstanceError):staged[0].content='changed'
    payload=staged[0].payload();payload['content']='changed'
    assert staged[0].payload()['content']=='synthetic-private-prompt'
