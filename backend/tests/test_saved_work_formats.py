"""Controlled cross-format checks for the general saved-work read capability."""
import copy
import pytest
from test_domain import context, cmd
from test_saved_work_retrieval import CheckedProvider
from test_general_alpha_runtime import activate
from test_general_responses import worker
from test_conversations import conversation
from workagent.models import PostMessage
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.flexible_models import StructuredTableBody, CustomViewBody


@pytest.mark.parametrize('kind',['structured_table','custom_view'])
def test_retrieval_is_not_specific_to_documents(context,tmp_path,kind):
    s,p,ws,_,_=context
    cv=conversation(context)
    if kind=='structured_table':
        body=StructuredTableBody.model_validate({'title':'Research comparison','fields':[
            {'key':'description','label':'Description','type':'text','editable':True}],
            'rows':[{'row_id':f'row-{i}','cells':[{'field_key':'description','value':'Synthetic observation. '*70}]} for i in range(6)],
            'notes':['Human correction: uncertain evidence remains uncertain.']}).model_dump(mode='json')
    else:
        with s.db.transaction() as c: generation=s._scope(c,p,ws)
        body=CustomViewBody(title='Interactive evidence briefing',source={'html':'<article>'+('<p>Synthetic details</p>'*400)+'</article>'},
            fallback='Synthetic evidence briefing; no external actions.',access_generation=generation).model_dump(mode='json')
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Create this work',
        operation={'kind':'publish_artifact','body':body}))
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
    detail=s.get_conversation(p,ws,cv.id); cv=detail.conversation
    a=s.get_artifact(p,ws,detail.artifact_ids[0])
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Make the title clearer; keep the content'))
    def choose(ctx):
        item=ctx['saved_work']['items'][0]
        assert item['kind']==kind and item['body_bytes']>8192 and not item['in_projection']
        assert ctx['target_body'] is None
        return {'kind':'read_saved_work','target':item['target']}
    def revise(ctx):
        result=ctx['adaptive']['observations'][0]['capability_result']['result']
        assert result['body']==body and result['status']=='complete'
        changed=copy.deepcopy(result['body']); changed['title']='Clearer title'
        return {'kind':'publish_artifact','target':result['target'],'body':changed}
    fake=CheckedProvider([choose,revise]); outcome=worker(context,fake,tmp_path).work(p,ws,q.run.id)
    if fake.failures: raise fake.failures[0]
    assert outcome.state=='partial'
    proposal=s.proposals(p,ws,a.id).items[0]
    actual=proposal.body.model_dump(mode='json'); actual['title']=body['title']
    assert actual==body and proposal.status=='pending'
    assert s.get_artifact(p,ws,a.id).current_revision_id==a.current_revision_id
