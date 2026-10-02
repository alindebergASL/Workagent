"""Explicit no-inference wire simulator. Never selected by the live worker CLI."""
import json
import httpx
from .responses_transport import ResponsesTransport, MODEL

class SyntheticResponses:
    def __init__(self,*,queued=False,false_completion=False,lose_id=False):
        self.calls=[]; self.responses={}; self.queued=queued
        self.false_completion=false_completion; self.lose_id=lose_id

    def transport(self):
        return ResponsesTransport.synthetic(httpx.MockTransport(self.handle))

    def handle(self,request):
        self.calls.append((request.method,request.url.path))
        if request.url.path.endswith('/input_tokens'):
            return httpx.Response(200,json={'object':'response.input_tokens','input_tokens':1000})
        if request.method=='GET':
            return httpx.Response(200,json=self.responses[request.url.path.rsplit('/',1)[-1]])
        if request.url.path.endswith('/cancel'):
            rid=request.url.path.split('/')[-2]
            return httpx.Response(200,json={**self.responses[rid],'status':'cancelled','output':[]})
        payload=json.loads(request.content)
        rid='resp_synthetic_'+payload['metadata']['attempt_id']+'_'+payload['metadata']['step_id']
        if payload['metadata']['step_id']=='selection':
            metadata=json.loads(payload['input'][0]['content'])
            args={'source_ids':[s['id'] for s in metadata['sources']],
                  'include_current_body':metadata['include_current_body']}
            output=[{'type':'function_call','call_id':'call_synthetic','name':'read_scoped_context',
                     'arguments':json.dumps(args),'status':'completed'}]
        else:
            scope=json.loads(payload['input'][-1]['output'])
            source=scope['sources'][0]
            value={'title':'Proposed intake ownership check',
                'next_action':'Ask the intake owner to identify the missing owner and a dated next step for each incomplete intake row before the next review.',
                'missing_information':['Confirm the owner of each unassigned row and its next review date.'],
                'specific_judgment':'Prioritize incomplete ownership records before process redesign; the selected intake evidence is not an execution receipt.',
                'source_basis':[{'source_id':source['id'],'external_version':source['external_version'],
                                 'basis':'Selected intake snapshot supplied by the authorized scoped broker; no external task execution evidence.'}],
                'task_not_performed':True,'underlying_action_performed':False}
            if self.false_completion:
                value['underlying_action_performed']=True
                value['next_action']='I have completed the task and sent the message to every owner.'
            output=[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps(value)}]}]
        data={'id':rid,'object':'response','model':MODEL,'service_tier':'default',
              'metadata':payload['metadata'],'status':'completed','error':None,'output':output,
              'usage':{'input_tokens':1000,'output_tokens':100,'total_tokens':1100,
                       'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':20}}}
        self.responses[rid]=data
        if self.lose_id: raise httpx.ReadTimeout('synthetic response ID loss')
        return httpx.Response(200,json={**data,'status':'queued','output':[],'usage':None} if self.queued else data)
