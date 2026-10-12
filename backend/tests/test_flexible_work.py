"""Flexible artifacts: synthetic inputs, real restricted PostgreSQL, no live calls."""
import pytest
from pydantic import ValidationError
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from workagent.models import HumanSave, AcceptProposal, PostMessage
from workagent.general_worker import GeneralWorker, ControlledTransport


def table():
    return {'kind':'structured_table','version':'structured-table/v1','title':'Plant trials',
            'fields':[{'key':'plant','label':'Plant','type':'text','editable':True},
                      {'key':'height','label':'Height','type':'decimal','unit':'cm','scale':1,'editable':True}],
            'rows':[{'row_id':'oak','cells':[{'field_key':'plant','value':'Oak'},{'field_key':'height','value':'12.5'}]}]}


def publish(ctx, body, cv=None, **target):
    s,p,ws,_,_=ctx
    cv=cv or conversation(ctx)
    q=post(ctx,cv,'Keep this useful draft; no correctness claim.',operation={'kind':'publish_artifact','body':body,**target})
    run=GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
    assert run.state=='partial' and run.unresolved
    detail=s.get_conversation(p,ws,cv.id)
    item=detail.messages[-1].result.results[1]
    return detail.conversation,item,s.get_artifact(p,ws,item.artifact_id)


def test_general_table_type_and_identity_validation():
    from workagent.flexible_models import StructuredTableBody
    body=StructuredTableBody.model_validate(table())
    assert body.fields[1].unit=='cm'
    for change in [lambda x:x['fields'].append(x['fields'][0]),
                   lambda x:x['rows'].append(x['rows'][0]),
                   lambda x:x['rows'][0]['cells'][1].update(value=True),
                   lambda x:x['rows'][0]['cells'][1].update(value='12.55'),
                   lambda x:x['rows'][0]['cells'].append({'field_key':'unknown','value':'x'})]:
        data=table(); change(data)
        with pytest.raises(ValidationError): StructuredTableBody.model_validate(data)


def test_structured_lifecycle_uses_existing_revision_proposal_history(context):
    s,p,ws,_,_=context
    cv,item,art=publish(context,table())
    body=art.current_revision.body.model_copy(deep=True)
    body.rows[0].cells[0].value='Human Oak'
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
    _,result,current=publish(context,table(),cv,artifact_id=art.id,base_revision_id=saved.current_revision_id)
    assert current.current_revision_id==saved.current_revision_id
    proposal=s.proposals(p,ws,art.id).items[0]
    assert proposal.status=='pending' and result.proposal_id==proposal.id
    accepted=s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=saved.current_revision_id))
    assert accepted.current_revision.body.title=='Plant trials'
    assert len(s.history(p,ws,art.id).items)==3
    assert s.get_artifact(p,ws,art.id,saved.current_revision_id).requested_revision.body.rows[0].cells[0].value=='Human Oak'


def view(art,generation=1):
    return {'kind':'custom_view','version':'custom-view/v1','title':'Trial chart',
            'source':{'html':'<h1>Plant height</h1><button id="refresh">Refresh saved data</button>',
                      'css':'h1 { color: green }','js':'// Inert on backend; host adapter supplies actions.'},
            'fallback':'Oak measured 12.5 cm. This is a draft, not verified research.',
            'access_generation':generation,
            'bindings':[{'name':'trials','artifact_id':art.id,'revision_id':art.current_revision_id,'body_hash':art.current_revision.body_hash}],
            'actions':[{'name':'refresh','kind':'read_binding','binding':'trials',
                        'payload_schema':{'type':'object','properties':{},'additionalProperties':False}}]}


def action(art,**changes):
    from workagent.models import ViewActionRequest
    data={'schema_version':'workagent/v1','request_id':'view-refresh','view_revision_id':art.current_revision_id,
          'view_body_hash':art.current_revision.body_hash,'access_generation':art.current_revision.body.access_generation,
          'action':'refresh','payload':{}}
    return ViewActionRequest(**{**data,**changes})


def test_view_bounds_and_closed_action_payload():
    from workagent.flexible_models import CustomViewBody, ViewSource
    from workagent.models import ViewActionRequest
    with pytest.raises(ValidationError): ViewSource(html='é'*24001)
    with pytest.raises(ValidationError): ViewActionRequest(schema_version='workagent/v1',request_id='r',view_revision_id='r',view_body_hash='0'*64,access_generation=1,action='refresh',payload={'artifact_id':'arbitrary'})
    with pytest.raises(ValidationError):
        CustomViewBody(title='x',source={'html':'x'},fallback=' ',access_generation=1)


def test_view_broker_read_reopen_stale_and_unauthorized(context):
    from workagent.service import Service,Principal
    from workagent.db import Database
    s,p,ws,_,admin=context
    cv,_,data=publish(context,table())
    cv,_,art=publish(context,view(data),cv)
    reopened=Service(s.db).get_artifact(p,ws,art.id)
    assert reopened.current_revision==art.current_revision and reopened.current_revision.body.source.js.startswith('// Inert')
    result=s.invoke_view_action(p,ws,art.id,action(art))
    assert result.body==data.current_revision.body and result.revision_id==data.current_revision_id
    raises('unsupported_operation',lambda:s.invoke_view_action(p,ws,art.id,action(art,action='approve')))
    raises('not_found_or_not_authorized',lambda:s.invoke_view_action(Principal('intruder'),ws,art.id,action(art)))
    raises('not_found_or_not_authorized',lambda:s.invoke_view_action(p,ws,'absent',action(art)))
    raises('not_found_or_not_authorized',lambda:s.invoke_view_action(p,ws,art.id,action(art,view_revision_id='stale')))
    raises('not_found_or_not_authorized',lambda:s.invoke_view_action(p,ws,art.id,action(art,view_body_hash='0'*64)))
    raises('not_found_or_not_authorized',lambda:s.invoke_view_action(p,ws,art.id,action(art,access_generation=2)))
    edited=data.current_revision.body.model_copy(deep=True); edited.rows[0].cells[1].value='13.0'
    s.human_save(p,ws,data.id,cmd(HumanSave,expected_current_revision_id=data.current_revision_id,body=edited))
    raises('not_found_or_not_authorized',lambda:s.invoke_view_action(p,ws,art.id,action(art)))
    # Saved fallback/source remain readable when a binding becomes stale.
    assert s.get_artifact(p,ws,art.id).current_revision.body.fallback==view(data)['fallback']
    with Database(admin).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    raises('not_found_or_not_authorized',lambda:s.invoke_view_action(p,ws,art.id,action(art)))


def test_view_foreign_binding_and_sql_guards(context):
    import psycopg
    from workagent.service import encoded,digest
    from workagent.models import Revision,new_id
    from workagent.flexible_models import CustomViewBody
    s,p,ws,_,_=context
    cv,_,data=publish(context,table())
    other=conversation(context)
    raises('not_found_or_not_authorized',lambda:publish(context,view(data),other))
    cv,_,art=publish(context,view(data),cv)
    malicious=CustomViewBody.model_validate(view(data)); malicious.bindings[0].revision_id='absent'
    revision=Revision(id=new_id(),artifact_id=art.id,revision_number=2,parent_revision_id=art.current_revision_id,
        author_id=p.id,author_kind='human',body=malicious,body_hash=digest(malicious),source_dependencies=[])
    with pytest.raises(psycopg.Error,match='exact current same-conversation'):
        with s.db.transaction() as c:
            c.execute('INSERT INTO revisions(workspace_id,artifact_id,id,revision_number,parent_revision_id,data) VALUES (%s,%s,%s,2,%s,%s)',
                (ws,art.id,revision.id,art.current_revision_id,encoded(revision)))
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute("UPDATE revisions SET data=data || '{\"forged\":true}' WHERE workspace_id=%s AND id=%s",(ws,art.current_revision_id))
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))


class DraftProvider:
    """Synthetic transport exercises admission/schema/ledger/publication; not inference."""
    def __init__(self,body,adaptive):
        from test_general_responses import Provider
        self.base=Provider(); self.body=body; self.adaptive=adaptive

    def transport(self):
        import httpx
        from workagent.responses_transport import ResponsesTransport
        return ResponsesTransport.synthetic(httpx.MockTransport(self.handle))

    def handle(self,request):
        import json,httpx
        if request.method=='GET' or request.url.path.endswith('input_tokens'): return self.base.handle(request)
        data=json.loads(request.content); ctx=json.loads(data['input'][0]['content'])
        message=next(m for m in ctx['messages'] if m['run_id']==ctx['run_id'] and m['author_kind']=='human')
        if data['metadata']['step_id']=='final':
            output=[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps({'text':'Verified everything. This generated claim is not evidence.'})}]}]
        else:
            body=self.body(ctx) if callable(self.body) else self.body
            from pydantic import TypeAdapter
            from workagent.flexible_models import DraftBody
            body=TypeAdapter(DraftBody).validate_python(body).model_dump(mode='json')
            value={'decision':{'kind':'publish_artifact','target':message['target'],'body':body}}
            if self.adaptive: value.update(goal='Organize useful general work',success_criteria=[])
            output=[{'type':'function_call','name':'choose_general_action','call_id':'call_draft','arguments':json.dumps(value)}]
        rid='resp_draft_'+str(len(self.base.responses))
        response={'id':rid,'object':'response','model':'gpt-6.1-sol','service_tier':'default','metadata':data['metadata'],
            'status':'completed','error':None,'output':output,'usage':{'input_tokens':700,'output_tokens':200,'total_tokens':900,
            'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':50}}}
        self.base.responses[rid]=response
        return httpx.Response(200,json=response)


@pytest.mark.parametrize('adaptive',[False,True])
@pytest.mark.parametrize('kind',['document','structured_table','custom_view'])
def test_actual_model_admission_draft_stage_publication(context,tmp_path,adaptive,kind):
    from test_general_responses import activate as general_activate,worker,target
    from test_adaptive_execution import activate as adaptive_activate
    from workagent.service import Service
    s,p,ws,_,_=context
    cv,_,bound=publish(context,table())
    if adaptive: adaptive_activate(context,cv)
    else: general_activate(context,[cv])
    body=({'title':'Trip prep','blocks':[{'block_id':'pack','kind':'checklist','text':'Pack raincoat','checked':False}]} if kind=='document'
          else table() if kind=='structured_table' else view(bound))
    fake=DraftProvider(body,adaptive)
    q=post(context,cv,'Organize this general work and retain a useful draft.')
    run=worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert run.state=='partial' and run.unresolved
    detail=s.get_conversation(p,ws,cv.id); item=detail.messages[-1].result.results[1]
    art=s.get_artifact(p,ws,item.artifact_id)
    obs=s.get_product_observation(p,ws,item.observation_id).observation
    assert obs.output.goal_status=='needs_validation' and obs.output.generated_code_executed is False
    assert obs.model_selection and detail.turns[-1].retained_local_result.published
    if adaptive:
        assert detail.turns[-1].adaptive.outcome=='needs_validation'
        assert detail.turns[-1].adaptive.steps[-1].verification.satisfied is False
        assert not detail.messages[-1].text.startswith('Verified')
    # Restart readback and duplicate delivery do not regenerate or accept anything.
    assert Service(s.db).get_artifact(p,ws,art.id).current_revision==art.current_revision
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    if kind=='custom_view': assert s.invoke_view_action(p,ws,art.id,action(art)).body==bound.current_revision.body
    saved_body=art.current_revision.body.model_copy(deep=True); saved_body.title='Human title'
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=saved_body))
    q2=post(context,detail.conversation,'Suggest a revised draft without accepting it.',target=target(saved))
    assert worker(context,fake,tmp_path).work(p,ws,q2.run.id).state=='partial'
    proposal=s.proposals(p,ws,art.id).items[0]
    assert proposal.status=='pending' and s.get_artifact(p,ws,art.id).current_revision.body.title=='Human title'
    assert not detail.messages[-1].text.startswith('Verified')
    accepted=s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=saved.current_revision_id))
    assert len(s.history(p,ws,art.id).items)==3
    assert Service(s.db).get_artifact(p,ws,art.id).current_revision==accepted.current_revision
    assert s.get_artifact(p,ws,art.id,saved.current_revision_id).requested_revision.body.title=='Human title'
    if kind=='custom_view': assert s.invoke_view_action(p,ws,art.id,action(accepted)).body==bound.current_revision.body


@pytest.mark.parametrize('checks',[
    {'kind':'csv_totals','expected_sum':'3.00','mismatch_count':1},
    {'kind':'wasm_cases','entrypoint':'total','cases':[{'arguments':[3,1250],'expected':'3750'}]},
])
def test_draft_cannot_bypass_human_checks_or_break_publication(context,tmp_path,checks):
    from test_adaptive_execution import activate
    from test_general_responses import worker,totals
    from workagent.service import Service
    s,p,ws,_,_=context
    cv=conversation(context); grant=activate(context,cv)
    q=post(context,cv,'Create work and satisfy my supplied checks.',acceptance_checks=checks)
    fake=DraftProvider(table(),True)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[-1].adaptive.outcome=='step_limit'
    steps=detail.turns[-1].adaptive.steps
    assert len(steps)==4 and all(step.status=='rejected' for step in steps)
    assert all(not step.verification.acceptance.passed for step in steps)
    assert not detail.artifact_ids and len(detail.messages)==2
    assert 'supplied acceptance checks' in detail.messages[-1].text
    before=totals(s,grant)['request_counts']['dispatch']
    assert before==5
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert totals(s,grant)['request_counts']['dispatch']==before
    assert Service(s.db).get_conversation(p,ws,cv.id)==detail


def test_rejected_draft_can_continue_to_checked_executable_work(context,tmp_path):
    import json
    from test_adaptive_execution import activate,AdaptiveProvider
    from test_general_responses import worker,totals
    s,p,ws,_,_=context
    cv=conversation(context); grant=activate(context,cv)
    q=post(context,cv,'Build a calculator and run my supplied checks.',acceptance_checks={
        'kind':'wasm_cases','entrypoint':'total','cases':[{'arguments':[3,1250],'expected':'3750'}]})
    fake=DraftProvider(table(),True); tool=AdaptiveProvider(first_good=True)
    tool.responses=fake.base.responses
    draft_handle=fake.handle
    def handle(request):
        if request.method=='POST' and not request.url.path.endswith('input_tokens'):
            data=json.loads(request.content); ctx=json.loads(data['input'][0]['content'])
            if data['metadata']['step_id']!='final' and ctx.get('adaptive',{}).get('observations'):
                assert ctx['adaptive']['observations'][-1]['status']=='rejected'
                response=tool.handle(request)
                payload=response.json(); call=payload['output'][0]
                value=json.loads(call['arguments'])
                value.update(goal='Organize useful general work',success_criteria=[])
                call['arguments']=json.dumps(value)
                tool.responses[payload['id']]=payload
                import httpx
                return httpx.Response(200,json=payload)
        return draft_handle(request)
    fake.handle=handle
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id); steps=detail.turns[-1].adaptive.steps
    assert detail.turns[-1].adaptive.outcome=='needs_validation' and len(steps)==2
    assert steps[0].status=='rejected' and not steps[0].verification.acceptance.passed
    assert steps[1].status=='observed' and steps[1].verification.acceptance.passed
    assert not steps[1].verification.satisfied
    assert len(detail.artifact_ids)==2  # Executable tool and its downloadable file, no draft table.
    assert {s.get_artifact(p,ws,aid).current_revision.body.kind for aid in detail.artifact_ids}=={'tool','file'}
    assert totals(s,grant)['request_counts']['dispatch']==3


def test_read_only_field_and_identity_rules(context):
    s,p,ws,_,_=context
    source=table(); source['fields'][1]['editable']=False
    cv,_,art=publish(context,source)
    for mutate in [lambda b:setattr(b.rows[0].cells[1],'value','20.0'),
                   lambda b:setattr(b.fields[1],'unit','meters'),
                   lambda b:setattr(b,'rows',[])]:
        body=art.current_revision.body.model_copy(deep=True); mutate(body)
        raises('unsupported_operation',lambda:s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body)))
    assert s.get_artifact(p,ws,art.id).current_revision_id==art.current_revision_id


def test_view_http_empty_payload_no_target_auth_and_stale_view(context):
    from fastapi.testclient import TestClient
    from workagent.api import create_app,Settings
    from workagent.service import Principal
    s,p,ws,_,_=context
    cv,_,data=publish(context,table()); cv,_,art=publish(context,view(data),cv)
    bearer='synthetic-flexible-test-not-a-real-token'
    client=TestClient(create_app(Settings(s.db.dsn,True,bearer,p.id)))
    url=f'/v1/workspaces/{ws}/artifacts/{art.id}/view-actions'
    payload=action(art).model_dump(mode='json')
    assert client.post(url,json=payload).status_code==401
    headers={'Authorization':'Bearer '+bearer}
    response=client.post(url,headers=headers,json=payload)
    assert response.status_code==200 and response.json()['body']==data.current_revision.body.model_dump(mode='json')
    assert len(response.content)<60000
    for malformed in [dict(payload,payload={'artifact_id':data.id}),dict(payload,artifact_id=data.id),dict(payload,action='save'),dict(payload,payload=[]),dict(payload,payload=None)]:
        assert client.post(url,headers=headers,json=malformed).status_code==422
    stale=art.current_revision.body.model_copy(deep=True); stale.title='New saved view'
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=stale))
    result=client.post(url,headers=headers,json=payload)
    missing=client.post(url.replace(art.id,'missing'),headers=headers,json=payload)
    assert result.status_code==missing.status_code==404
    assert result.json()==missing.json()
    assert s.invoke_view_action(p,ws,art.id,action(saved)).body==data.current_revision.body


def test_view_generation_revoked_even_after_membership_restored(context):
    from workagent.db import Database
    s,p,ws,_,admin=context
    cv,_,data=publish(context,table()); cv,_,art=publish(context,view(data),cv)
    with Database(admin).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
        c.execute('UPDATE memberships SET active=true WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
        c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
    raises('not_found_or_not_authorized',lambda:s.invoke_view_action(p,ws,art.id,action(art)))


def test_concurrent_view_save_cas_and_old_action_rejected(context):
    from concurrent.futures import ThreadPoolExecutor
    from workagent.errors import DomainError
    s,p,ws,_,_=context
    cv,_,data=publish(context,table()); cv,_,art=publish(context,view(data),cv)
    def save(title):
        body=art.current_revision.body.model_copy(deep=True); body.title=title
        try:
            return s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
        except DomainError as exc: return exc.code.value
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(save,['first','second']))
    assert sum(r=='version_conflict' for r in results)==1
    assert len(s.history(p,ws,art.id).items)==2
    raises('not_found_or_not_authorized',lambda:s.invoke_view_action(p,ws,art.id,action(art)))


def test_sql_rejects_generated_verified_stage(context,tmp_path,monkeypatch):
    import copy,psycopg
    from test_general_responses import worker,activate
    from workagent.responses_ledger import Ledger
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,[cv])
    q=post(context,cv,'Retain general draft data.')
    original=Ledger.event
    def forge(self,c,phase,kind,data):
        if kind=='tool_result':
            data=copy.deepcopy(data); data['output']['generated_code_executed']=True
        return original(self,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',forge)
    with pytest.raises(psycopg.Error,match='draft is exact unverified data'):
        worker(context,DraftProvider(table(),False),tmp_path).work(p,ws,q.run.id)
    assert s.get_conversation(p,ws,cv.id).artifact_ids==[]
