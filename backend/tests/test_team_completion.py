"""Disposable PostgreSQL + synthetic model decisions; parent owns live proof."""
import json
from copy import deepcopy
import httpx
import psycopg
import pytest
from test_domain import context, cmd
from test_conversations import conversation, post
from test_general_responses import Provider, worker, target
from test_adaptive_execution import activate
from test_team_verifier_pure import GOAL, GOOD, BAD, team_case
from workagent.models import HumanSave
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.responses_ledger import Ledger


class TeamProvider(Provider):
    def __init__(self):
        super().__init__(); self.contexts=[]

    def handle(self,request):
        response=super().handle(request)
        if request.method!='POST' or request.url.path!='/v1/responses': return response
        payload=json.loads(request.content); data=response.json()
        if payload['metadata']['step_id']!='final':
            context=json.loads(payload['input'][0]['content']); self.contexts.append(context)
            message=[m for m in context['messages'] if m['author_kind']=='human'][-1]
            op=team_case(BAD if len(self.contexts)==1 else GOOD)[3].decision.model_dump(mode='json')
            op['target']=message['target']
            data['output'][0]['arguments']=json.dumps(dict(goal='Build team calculator',success_criteria=[],decision=op))
        self.responses[data['id']]=data
        return httpx.Response(200,json=data)


def test_autonomous_fixture_repair_preserves_saved_notes(context,tmp_path):
    s,p,ws,_,_=context; cv=conversation(context)
    seed=post(context,cv,'Seed saved calculator',operation=team_case()[1])
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,seed.run.id)
    art=s.get_artifact(p,ws,s.get_conversation(p,ws,cv.id).messages[-1].result.results[1].artifact_id)
    body=art.current_revision.body.model_copy(deep=True); body.notes=['My human note']; body.title='My teams'
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
    cv=s.get_conversation(p,ws,cv.id).conversation
    activate(context,cv); q=post(context,cv,GOAL,target=target(saved)); fake=TeamProvider()
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    steps=s.get_conversation(p,ws,cv.id).turns[-1].adaptive.steps
    assert len(steps)==2 and steps[0].status=='observed'
    assert steps[0].verification.automatic.failures==['numerical_disagreement']
    assert steps[1].verification.automatic.case_count==1891 and steps[1].verification.satisfied
    feedback=fake.contexts[1]['adaptive']['observations'][0]['verification']['automatic']
    assert set(feedback)=={'recognized','passed','failures','scope','checker_version','case_count'}
    proposal=s.proposals(p,ws,art.id).items[0]
    assert proposal.status=='pending' and proposal.body.notes==body.notes and proposal.body.title==body.title
    assert s.get_artifact(p,ws,art.id).current_revision_id==saved.current_revision_id


@pytest.mark.parametrize('field',['result','spec','coverage'])
def test_sql_rejects_forged_team_evidence(context,tmp_path,monkeypatch,field):
    s,p,ws,_,_=context; cv=conversation(context); activate(context,cv)
    q=post(context,cv,GOAL); original=Ledger.event
    def forged(ledger,c,phase,kind,data):
        if kind=='tool_result' and data['verification']['satisfied']:
            data=deepcopy(data); proof=data['verification']['automatic']
            if field=='result': data['output']['value']+=1
            elif field=='spec': proof['spec']['max_n']=59
            else: proof['case_count']=1890
        return original(ledger,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',forged)
    with pytest.raises(psycopg.Error,match='automatic evidence'):
        worker(context,TeamProvider(),tmp_path).work(p,ws,q.run.id)


@pytest.mark.parametrize('text',[GOAL,GOAL.replace('Build','Update'),GOAL.replace('Build','Check'),GOAL+' Also email it.'])
def test_team_sql_recognition_and_unsupported_publication(context,tmp_path,text):
    from workagent.bounded_verifier import recognize
    from workagent.service import encoded
    s,p,ws,_,_=context; message=team_case(text=text)[0]; spec=recognize(message)
    with s.db.transaction() as c:
        assert c.execute('SELECT bounded_team_spec(%s) AS spec',(encoded(message),)).fetchone()['spec']==(spec.model_dump(mode='json') if spec else None)
    if spec is None:
        cv=conversation(context); activate(context,cv); q=post(context,cv,text)
        assert worker(context,TeamProvider(),tmp_path).work(p,ws,q.run.id).state=='partial'
        assert s.get_conversation(p,ws,cv.id).turns[-1].adaptive.outcome=='needs_validation'
