"""A public-read receipt can support follow-through, not verify a source claim."""
import httpx
import pytest
from test_domain import context
from test_sustained_continuity import setup, draft, advance
from test_responsibility_execution import dispatch, admitted
from test_adaptive_execution import finish_safe_visits
from test_general_alpha_runtime import AlphaProvider
from test_public_retrieval import transport, wire
from workagent import public_retrieval as reader
from workagent.errors import DomainError


@pytest.mark.parametrize('read_first',[False,True])
def test_public_read_and_prepared_work_can_settle_one_checkin(context,tmp_path,monkeypatch,read_first):
    s,p,ws,_,_=context
    cv,art,a,g,_=setup(context)
    calls=transport(monkeypatch,[wire(b'<p>Use clear headings.</p>')])
    monkeypatch.setattr(reader,'fetch_public_url',reader.retrieve)
    def followthrough(ctx):
        result=advance(ctx)
        result['evidence']=[{'phase':o['phase'],'operation_hash':o['binding']['operation_hash']}
                            for o in ctx['adaptive']['observations']]
        result['plan'].update(current_outcome='Read the public source and prepared a draft. Source claims are unverified.',
                             next_action={'kind':'await_event','description':'Wait for human feedback.'},
                             wait={'kind':'person','reason':'Review the draft.'},next_check_in_at=None)
        return result
    target={'artifact_id':art.id,'revision_id':art.current_revision_id,
            'body_hash':s.get_artifact(p,ws,art.id).current_revision.body_hash}
    actions=([{'kind':'read_saved_work','target':target}] if read_first else [])
    fake=AlphaProvider(actions+[{'kind':'fetch_public_url','url':'https://synthetic.example/guidance'},
                        draft('Source-backed draft'),followthrough,
                        {'kind':'reply','text':'Prepared a draft from the public source. Awaiting your review.'}])
    d,_,w=dispatch(context,tmp_path,g,fake)
    w.phases.transport._client.timeout=httpx.Timeout(.5)
    d.once()
    rid=admitted(s,ws)[0]['run_id']
    assert finish_safe_visits(context,w,rid).state=='ready'
    if fake.failures:raise fake.failures[0]
    life=s.get_responsibility(p,ws,a.id).lifecycle
    assert life.state=='waiting_person' and life.next_check_in_at is None
    assert len(calls)==1
    evidence=life.outcome_evidence['evidence']
    assert [e['basis'] for e in evidence]==(['retained_read_not_goal_verification'] if read_first else [])+['public_read_not_goal_verification','observed_preparation_not_goal_verification']
    assert s.get_artifact(p,ws,art.id).current_revision_id==art.current_revision_id
    before=list(fake.calls)
    w.work(p,ws,rid)
    assert fake.calls==before and len(calls)==1


@pytest.mark.parametrize('kind',['read_saved_work','read_context','discover_saved_work','search_work_context','inspect_json','load_skill','discover_capabilities'])
def test_authorized_retained_reads_are_observations_not_goal_proof(kind):
    from types import SimpleNamespace
    from workagent.responsibility_action import followthrough_evidence
    from workagent.service import digest
    ref=SimpleNamespace(phase='selection',operation_hash='a'*64)
    result={'value':'An already-authorized retained observation.'}
    observed={'status':'reply','decision':{'kind':kind},'binding':{'operation_hash':ref.operation_hash},
              'capability_result':{'capability':kind,'version':'1','result':result}}
    evidence=followthrough_evidence(observed,ref)
    assert evidence['basis']=='retained_read_not_goal_verification' and evidence['body_hash']==digest(result)
    for field,value in [('version','invented'),('capability','mismatch'),('result',None),('result',[])]:
        invalid={**observed,'capability_result':{**observed['capability_result'],field:value}}
        with pytest.raises(DomainError):followthrough_evidence(invalid,ref)


@pytest.mark.parametrize('status',['ok','error'])
def test_public_read_evidence_is_not_source_verification(status):
    from types import SimpleNamespace
    from workagent.responsibility_action import followthrough_evidence
    from workagent.service import digest
    ref=SimpleNamespace(phase='selection',operation_hash='a'*64)
    result={'status':status,'trust':'untrusted_external_content','text':'Source claim, not verified.'}
    observed={'status':'reply','decision':{'kind':'fetch_public_url'},
              'binding':{'operation_hash':ref.operation_hash},
              'capability_result':{'capability':'fetch_public_url','result':result}}
    evidence=followthrough_evidence(observed,ref)
    assert evidence['basis']=='public_read_not_goal_verification'
    assert evidence['body_hash']==digest(result)


@pytest.mark.parametrize('mutation',['hash','tool','trust','status','missing'])
def test_followthrough_rejects_unbound_or_non_public_evidence(mutation):
    from types import SimpleNamespace
    from workagent.responsibility_action import followthrough_evidence
    ref=SimpleNamespace(phase='selection',operation_hash='a'*64)
    observed={'status':'reply','decision':{'kind':'fetch_public_url'},
              'binding':{'operation_hash':ref.operation_hash},
              'capability_result':{'capability':'fetch_public_url','result':{'status':'ok','trust':'untrusted_external_content'}}}
    if mutation=='hash':observed['binding']['operation_hash']='b'*64
    if mutation=='tool':observed['capability_result']['capability']='read_context'
    if mutation=='trust':observed['capability_result']['result']['trust']='verified'
    if mutation=='status':observed['capability_result']['result']['status']='invented'
    if mutation=='missing':observed={}
    with pytest.raises(DomainError):followthrough_evidence(observed,ref)
