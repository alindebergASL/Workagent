from hashlib import sha256
import json
import httpx
from test_domain import context,cmd
from test_conversations import conversation,post
from test_general_responses_journey import api
from test_general_responses import activate,Provider,worker,attach,target
from workagent.models import PostMessage
from workagent.message_models import AttachmentInput


class ReplyWhenTargeted(Provider):
    def handle(self,request):
        response=super().handle(request)
        if request.method=='POST' and request.url.path=='/v1/responses':
            payload=json.loads(request.content)
            if payload['metadata']['step_id']=='selection':
                context=json.loads(payload['input'][0]['content'])
                message=[m for m in context['messages'] if m['author_kind']=='human'][-1]
                if message['target']:
                    self.targeted_message=message
                    data=response.json()
                    data['output'][0]['arguments']=json.dumps({'decision':{'kind':'reply','text':'The code was not run.'}})
                    self.responses[data['id']]=data
                    return httpx.Response(200,json=data)
        return response


def test_existing_targeted_http_reply_retains_code_bytes_and_replays(context,tmp_path):
    s,p,ws,_,_=context;cv=conversation(context);activate(context,[cv]);fake=ReplyWhenTargeted();w=worker(context,fake,tmp_path)
    initial=post(context,cv,'Reconcile the supplied CSV.',attachments=[attach()]);w.work(p,ws,initial.run.id)
    detail=s.get_conversation(p,ws,cv.id);art=s.get_artifact(p,ws,detail.artifact_ids[0]);exact=target(art)
    marker=tmp_path/'NOT_EXECUTED'
    text='\ufefffrom pathlib import Path\r\nPath('+repr(str(marker))+').touch()\r\n'
    file=AttachmentInput(filename='example.test.py',mime_type='text/plain',content=text)
    command=cmd(PostMessage,expected_work_version=detail.conversation.work_version,text='Explain the attached code as context; do not run it.',target=exact,attachments=[file])
    with api(context) as client:
        route=f'/v1/workspaces/{ws}/conversations/{cv.id}/messages'
        response=client.post(route,json=command.model_dump(mode='json'));assert response.status_code==202,response.text
        replay=client.post(route,json=command.model_dump(mode='json'));assert replay.status_code==202
        assert replay.json()==response.json()
        admitted=response.json();message=admitted['message'];assert message['target']==exact.model_dump(mode='json')
        attachment=message['attachments'][0];assert attachment['filename']==file.filename
        assert attachment['content']==text and attachment['sha256']==sha256(text.encode()).hexdigest()
        assert attachment['byte_length']==len(text.encode())
        w.work(p,ws,admitted['run']['id'])
        assert fake.targeted_message['attachments'][0]==attachment
        readback=client.get(f'/v1/workspaces/{ws}/conversations/{cv.id}').json()
        assert readback['messages'][-2]['attachments'][0]==attachment
        assert readback['messages'][-2]['target']==message['target']
    assert not marker.exists()
    assert s.get_artifact(p,ws,art.id).current_revision_id==art.current_revision_id
    assert len(s.get_conversation(p,ws,cv.id).messages)==4
