"""Operator review through real FastAPI and restricted PostgreSQL (no provider)."""
import io
import json
import urllib.error
from urllib.parse import urlsplit
import pytest
from fastapi.testclient import TestClient
from test_domain import context,cmd
from test_flexible_work import publish
from test_proposal_review import table
from test_proposal_review_pg import candidate
from workagent.api import create_app,Settings
from workagent.models import HumanSave
from workagent.operator_client import OperatorClient,OperatorError


class ASGIOpener:
    def __init__(self,api):self.api=api;self.posts=[]
    def open(self,request,timeout):
        path=urlsplit(request.full_url).path
        if urlsplit(request.full_url).query:path+='?'+urlsplit(request.full_url).query
        if request.method=='POST':self.posts.append((path,request.data))
        response=self.api.request(request.method,path,content=request.data,headers=dict(request.header_items()))
        if response.status_code>=400:
            raise urllib.error.HTTPError(request.full_url,response.status_code,'HTTP failure',{},io.BytesIO(response.content))
        return io.BytesIO(response.content)


def test_operator_review_false_flags_explicit_accept_and_readback(context,monkeypatch,tmp_path):
    s,p,ws,_,_=context
    _,_,art=publish(context,table())
    art=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=table()))
    replacement=table();replacement.notes=[]
    prop=candidate(context,art,replacement)
    candidate(context,art,table())
    token='synthetic-operator-http-'+('x'*32)
    monkeypatch.setenv('LOCAL_BEARER_TOKEN',token)
    monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL',str(tmp_path/'commands'))
    monkeypatch.setenv('WORKAGENT_OPERATOR_URL','http://127.0.0.1:8765')
    with TestClient(create_app(Settings(s.db.dsn,True,token,p.id))) as api:
        client=OperatorClient();opener=ASGIOpener(api);client.opener=opener
        inspected=client.run(ws,'review',[prop.id,art.id,art.current_revision_id])
        assert inspected['review']['removed_content_count']>0
        assert inspected['review']['is_latest'] is False
        assert inspected['base']['current_revision']['body']['notes']==table().notes
        with pytest.raises(OperatorError,match='review_required'):
            client.run(ws,'accept',[prop.id,art.id,art.current_revision_id],command_id='declined')
        assert len(opener.posts)==1
        assert s.get_artifact(p,ws,art.id).current_revision_id==art.current_revision_id
        result=client.run(ws,'accept',[prop.id,art.id,art.current_revision_id],command_id='explicit',
            acknowledge_removed_content=True,acknowledge_older_proposal=True)
        assert result['readback']['artifact']['current_revision']['body']['notes']==[]
        assert result['readback']['artifact']['current_revision_id']!=art.current_revision_id
        assert client.journal.read('explicit')['outcome']['state']=='confirmed'
        assert len(opener.posts)==2
        client.run(ws,'replay',['explicit'])
        assert opener.posts[-1]==opener.posts[-2]
        assert len(s.history(p,ws,art.id).items)==3
