"""Controller-authored real TCP+restricted PostgreSQL file/export acceptance.

Uses only synthetic local work. No dispatcher or provider is started.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import httpx
import pytest
from test_domain import context
from workagent.models import new_id


def command(**fields):
    key=new_id()
    return {'schema_version':'workagent/v1','request_id':key,'command_id':key,**fields}


def digest(text):
    return sha256(text.encode('utf-8')).hexdigest()


@pytest.fixture
def tcp(context,tmp_path):
    service,p,ws,refs,owner=context
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    token=secrets.token_urlsafe(32)
    env={**os.environ,'DATABASE_URL':service.db.dsn,'LOCAL_TEST_MODE':'true',
         'LOCAL_BEARER_TOKEN':token,'LOCAL_PRINCIPAL_ID':p.id,'WORKAGENT_FIXTURE_MODE':'false',
         'PYTHONPATH':str(Path(__file__).resolve().parents[1])}
    log=(tmp_path/'tcp-api.log').open('w')
    process=None
    client=httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=20,
        headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()})
    def start():
        nonlocal process
        process=subprocess.Popen([sys.executable,'-m','uvicorn','workagent.api:app','--host','127.0.0.1','--port',str(port)],
                                  env=env,stdout=log,stderr=subprocess.STDOUT)
        for _ in range(150):
            assert process.poll() is None,'Disposable API exited (private log retained)'
            try:
                if client.get('/openapi.json').status_code==200:return
            except httpx.HTTPError:pass
            time.sleep(.1)
        raise AssertionError('Disposable TCP API not ready')
    def stop():
        if process and process.poll() is None:process.terminate();process.wait(15)
    try:
        start()
        yield client,context,start,stop,tmp_path
    finally:
        stop();client.close();log.close()


def checked(response, status=200):
    assert response.status_code==status,response.text
    return response.json()


def create_work(client,ws):
    return checked(client.post(f'/v1/workspaces/{ws}/conversations',json=command(title='Synthetic file acceptance',selected_source_refs=[])),201)


def create_file(client,ws,cv,text,filename='notes.md',mime='text/markdown'):
    return checked(client.post(f'/v1/workspaces/{ws}/work-areas/{cv["id"]}/files',json=command(
        expected_work_version=cv['work_version'],source=dict(kind='text',filename=filename,mime_type=mime,content=text,sha256=digest(text)))),201)


def read_file(client,ws,file,offset=0,limit=8192):
    ref=file['current']
    return client.get(f'/v1/workspaces/{ws}/files/{file["workspace_file_id"]}/versions/{ref["version_id"]}',
        params={'sha256':ref['sha256'],'offset':offset,'limit':limit})


def test_real_tcp_create_edit_export_race_restart(tcp):
    client,ctx,start,stop,tmp=tcp
    s,p,ws,_,_=ctx;root=f'/v1/workspaces/{ws}'
    cv=create_work(client,ws)
    original='\ufeffHuman annotation: 雪\r\nFirst line\nLast line\r'
    file=create_file(client,ws,cv,original)
    assert checked(read_file(client,ws,file))['text']==original
    page=checked(read_file(client,ws,file,limit=9))
    assert page['has_utf8_bom'] and page['newline']=='mixed' and page['omitted_ranges']
    assert page['chunk_sha256']==digest(page['text'])
    assert page['next_offset']==len(page['text'].encode())
    text='\ufeffHuman annotation: 雪\r\nApproved change\n'
    endpoint=root+f'/files/{file["workspace_file_id"]}/versions'
    body=command(expected_work_version=cv['work_version'],base_version_id=file['current']['version_id'],
                 base_sha256=file['current']['sha256'],content=text,sha256=digest(text))
    edited=checked(client.post(endpoint,json=body),201)
    assert checked(client.post(endpoint,json=body),201)==edited # same command, no duplicate effect
    stale=client.post(endpoint,json=command(**{k:v for k,v in body.items() if k not in ('schema_version','request_id','command_id')}))
    assert stale.status_code==409
    assert checked(read_file(client,ws,file))['text']==original
    assert checked(read_file(client,ws,edited))['text']==text
    ref=edited['current']; exports=[]
    for fmt in ('txt','markdown','csv','json'):
        result=checked(client.post(root+f'/files/{file["workspace_file_id"]}/exports',json=command(
            version_id=ref['version_id'],sha256=ref['sha256'],format=fmt)),201)
        download=client.get(root+f'/exports/{result["export_id"]}/download')
        assert download.status_code==200,download.text
        assert sha256(download.content).hexdigest()==result['blob']['sha256']
        assert len(download.content)==result['blob']['byte_length']
        assert b'Human annotation' in download.content
        assert download.headers['x-content-type-options']=='nosniff'
        assert 'attachment' in download.headers['content-disposition']
        if fmt in ('txt','markdown'):assert download.content==text.encode()
        exports.append(result)
    # Two distinct writes from the SAME human base: exactly one wins.
    def save(i):
        changed=text+str(i)
        return client.post(endpoint,json=command(expected_work_version=cv['work_version'],base_version_id=ref['version_id'],
            base_sha256=ref['sha256'],content=changed,sha256=digest(changed))).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:statuses=list(pool.map(save,(1,2)))
    assert sorted(statuses)==[201,409]
    stop();start()
    assert checked(read_file(client,ws,file))['text']==original
    for result in exports:
        raw=client.get(root+f'/exports/{result["export_id"]}/download').content
        assert sha256(raw).hexdigest()==result['blob']['sha256']
    (tmp/'journey.json').write_text(json.dumps({'evidence':'actual_TCP_restricted_PG','formats':[x['format'] for x in exports],
        'download_hashes':[x['blob']['sha256'] for x in exports],'race_statuses':sorted(statuses),
        'restart_retains_old_version_and_exports':True,'provider_calls':0},indent=2)+'\n')


def test_tcp_cross_workspace_and_hash_denial(tcp):
    client,ctx,_,_,_=tcp;s,p,ws,_,owner=ctx;cv=create_work(client,ws)
    file=create_file(client,ws,cv,'private synthetic file')
    from workagent.fixture import seed
    other='test-'+new_id()
    seed(owner,[],other,p.id)
    other_cv=create_work(client,other)
    ref=file['current']
    paths=[f'/files/{file["workspace_file_id"]}/versions/{ref["version_id"]}?sha256={ref["sha256"]}',
           f'/work-areas/{cv["id"]}/files']
    for path in paths:
        response=client.get(f'/v1/workspaces/{other}'+path)
        assert response.status_code==404 and 'private synthetic file' not in response.text
    assert checked(client.get(f'/v1/workspaces/{other}/work-areas/{other_cv["id"]}/files'))['items']==[]
    bad=client.get(f'/v1/workspaces/{ws}/files/{file["workspace_file_id"]}/versions/{ref["version_id"]}',
                   params={'sha256':'0'*64})
    assert bad.status_code==409
    forged=client.post(f'/v1/workspaces/{ws}/files/{file["workspace_file_id"]}/versions',json=command(
        expected_work_version=cv['work_version'],base_version_id=ref['version_id'],base_sha256='0'*64,
        content='forged',sha256=digest('forged')))
    assert forged.status_code==409
    assert checked(read_file(client,ws,file))['text']=='private synthetic file'


@pytest.mark.parametrize('filename,mime,content',[
    ('../escape.txt','text/plain','safe'),('/absolute.txt','text/plain','safe'),
    ('archive.zip','text/plain','safe'),('x.txt','text/plain','PK\x03\x04payload'),
    ('x.txt','text/plain','%PDF-1.7'),('x.txt','application/json','{}'),
    ('x.json','application/json','NaN'),('x.txt','text/plain','\x00binary'),
])
def test_tcp_rejects_path_archive_mime(tcp,filename,mime,content):
    client,ctx,_,_,_=tcp;_,_,ws,_,_=ctx;cv=create_work(client,ws)
    response=client.post(f'/v1/workspaces/{ws}/work-areas/{cv["id"]}/files',json=command(
        expected_work_version=cv['work_version'],source=dict(kind='text',filename=filename,mime_type=mime,content=content,sha256=digest(content))))
    assert response.status_code==422
    assert checked(client.get(f'/v1/workspaces/{ws}/work-areas/{cv["id"]}/files'))['items']==[]
