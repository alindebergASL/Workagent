"""Exact GET supplements omitted native lifecycle, without weakening bounds/CAS."""
import copy
import pytest
from workagent.service import digest
from workagent.work_area_models import WorkAreaContext
from workagent.tui.lifecycle import read_omitted_lifecycles
from test_tui_lifecycle_controls import responsibility


def fixture():
    detail=responsibility()
    context=WorkAreaContext(conversation_id='c1',conversation_work_version=3,purpose=None,
        artifacts=[],proposals=[],offered_targets=[],responsibilities=[{
            'assignment_id':'a1','owner_id':'human','work_version':7,
            'lifecycle_sha256':digest(detail['lifecycle']),'lifecycle':None,'lifecycle_omitted':True}],
        omissions={'artifacts':0,'proposals':0,'responsibilities':0,'saved_bodies':0,'lifecycles':1},truncated=True).model_dump(mode='json')
    return detail,context


class Client:
    def __init__(self,detail):self.detail=detail;self.calls=[]
    def request(self,path):
        self.calls.append(path)
        if isinstance(self.detail,Exception):raise self.detail
        return copy.deepcopy(self.detail)


def read(errors):
    def wrapper(name,fn,default):
        try:return fn()
        except Exception as exc:errors[name]=type(exc).__name__;return default
    return wrapper


def test_exact_detail_recovers_omission_without_mutating_projection():
    detail,context=fixture();client=Client(detail);errors={};before=copy.deepcopy(context)
    hydrated=read_omitted_lifecycles(client,'workspace','c1',context,read(errors))
    assert context==before and not errors
    assert hydrated['responsibilities'][0]['lifecycle']==detail['lifecycle']
    assert not hydrated['responsibilities'][0]['lifecycle_omitted']
    assert hydrated['omissions']['lifecycles']==0 and not hydrated['truncated']
    assert client.calls==['/workspace/assignments/a1/responsibility']
    read_omitted_lifecycles(client,'workspace','c1',hydrated,read(errors))
    assert len(client.calls)==1


@pytest.mark.parametrize('field,value',[
    ('id','other'),('workspace_id','other'),('conversation_id','other'),
    ('owner_id','other'),('work_version',8)])
def test_identity_or_version_mismatch_stays_omitted(field,value):
    detail,context=fixture();detail['assignment'][field]=value;errors={}
    result=read_omitted_lifecycles(Client(detail),'workspace','c1',context,read(errors))
    assert result==context and errors


@pytest.mark.parametrize('case',['hash','forbidden','malformed'])
def test_hash_access_and_schema_failures_stay_omitted(case):
    detail,context=fixture();errors={}
    if case=='hash':detail['lifecycle']['state']='paused'
    elif case=='forbidden':detail=RuntimeError('403 access revoked')
    else:detail={}
    result=read_omitted_lifecycles(Client(detail),'workspace','c1',context,read(errors))
    assert result==context and errors


def test_scope_mismatch_and_missing_context_never_fetch():
    detail,context=fixture();client=Client(detail)
    assert read_omitted_lifecycles(client,'workspace','other',context,read({}))==context
    assert read_omitted_lifecycles(client,'workspace','c1',None,read({})) is None
    assert not client.calls


def test_other_projection_omissions_remain_honest():
    detail,context=fixture();context['omissions']['artifacts']=1
    result=read_omitted_lifecycles(Client(detail),'workspace','c1',context,read({}))
    assert result['truncated'] and result['omissions']['artifacts']==1


def test_projection_bounds_reject_before_http():
    detail,context=fixture();context['responsibilities']*=9;client=Client(detail)
    with pytest.raises(ValueError):read_omitted_lifecycles(client,'workspace','c1',context,read({}))
    assert not client.calls
