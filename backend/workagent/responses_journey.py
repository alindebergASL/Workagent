"""Executable no-inference product journey against a disposable real PostgreSQL DB."""
import argparse
from datetime import timedelta
from hashlib import sha256
import json
import os
from pathlib import Path
from .db import Database
from .fixture import seed
from .models import (ProviderGrant,ResponsesBinding,CreateAssignment,SourceRef,HumanSave,Block,
                     RequestRevision,AcceptProposal,new_id,now)
from .provider_attempts import configure_grant
from .runtime_config import active_configuration
from .service import Service,Principal,digest
from .responses_dispatcher import ResponsesDispatcher
from .responses_worker import ResponsesWorker,consumer_hash,instruction_hash
from .responses_synthetic import SyntheticResponses
from .responses_schema import FINAL_SCHEMA,scope_registry
from .responses_ledger import summary


def command(cls,**values):
    return cls(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),**values)


def journey(state_dir):
    if os.environ.get('LOCAL_TEST_MODE')!='true' or '/workagent_test_' not in os.environ.get('DATABASE_URL',''):
        raise RuntimeError('disposable local PostgreSQL environment required')
    ws='responses-synthetic-'+new_id(); p=Principal('local-human')
    fixture=Path(__file__).resolve().parents[2]/'fixtures/actor/solo-v0.1/initial_records.json'
    seed(os.environ['MIGRATION_DATABASE_URL'],json.loads(fixture.read_text()),ws,p.id)
    service=Service(Database()); service.db.check_runtime_role()
    with service.db.transaction() as c: _,config=active_configuration(c)
    grant=ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,profile='openai-responses-v1',model='gpt-6.1-sol',
        consumer_sha256=consumer_hash(),expires_at=now()+timedelta(minutes=30),max_runs=2,max_received_output_tokens=16384,
        responses=ResponsesBinding(project_id='proj_SYNTHETIC',secret_reference='file:/synthetic/not-a-key',transport_mode='synthetic',
        instructions_sha256=instruction_hash(config),schema_sha256=sha256(FINAL_SCHEMA.material).hexdigest(),scope_tool_sha256=digest(scope_registry())))
    configure_grant(Database(os.environ['MIGRATION_DATABASE_URL']),grant)
    refs=[SourceRef(source_id=s.id,external_version=s.external_version,observed_at=s.observed_at) for s in service.list_sources(p,ws).items]
    created=service.create_assignment(p,ws,command(CreateAssignment,goal='Prepare the next useful intake action; do not execute it.',
        completion_criteria=['Concrete next action with source basis and missing information'],selected_source_refs=refs))
    fake=SyntheticResponses(queued=True)
    with _transport(fake) as transport:
        worker=ResponsesWorker(service,transport,state_dir)
        dispatcher=ResponsesDispatcher(worker,workspace=ws,grant_id=grant.id)
        initial=dispatcher.once()
        assert initial['results'][0]['status']=='completed'
        a=service.get_assignment(p,ws,created.assignment.id)
        artifact=service.get_artifact(p,ws,a.artifact_ids[0])
        body=artifact.current_revision.body.model_copy(deep=True)
        body.blocks.append(Block(block_id='human-protected',kind='protected_note',text='Keep Wednesday 14:00–15:00 for method drafting.'))
        body.blocks.append(Block(block_id='human-choice',kind='paragraph',text='Human decision: ownership clarification comes before process redesign.'))
        human=service.human_save(p,ws,artifact.id,command(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=body))
        a=service.get_assignment(p,ws,a.id)
        revised=service.request_revision(p,ws,artifact.id,command(RequestRevision,expected_work_version=a.work_version,
            base_revision_id=human.current_revision_id,instruction='Preserve both human notes and state the specific ownership decision.'))
        revision=dispatcher.once(); assert revision['results'][0]['status']=='completed'
        run=service.get_run(p,ws,revised.run.id)
        proposal=next(x for x in service.proposals(p,ws,artifact.id).items if x.id==run.proposal_id)
        attempt=service.get_provider_attempt(p,ws,revised.run.id).id
        assert [b.block_id for b in proposal.body.blocks[:7]]==[
            f'managed.{part}.{attempt}' for part in ('current','next-action','missing-information',
                'source-basis','specific-judgment','scope','history')]
        assert 'supersedes prior agent advice' in proposal.body.blocks[0].text
        assert 'earlier agent recommendations superseded' in proposal.body.blocks[6].text
        assert proposal.body.blocks[7:]==body.blocks
        approved=service.accept_proposal(p,ws,proposal.id,command(AcceptProposal,expected_current_revision_id=human.current_revision_id))
        assert service.get_artifact(p,ws,artifact.id).current_revision_id==approved.current_revision_id
    with _transport(fake) as transport:
        restart=ResponsesWorker(Service(Database()),transport,state_dir).run(ws,revised.run.id)
        assert restart=='reconciled'
    outcome=service.get_assignment(p,ws,created.assignment.id).responsibility.runs[-1]
    assert outcome.state=='readback_verified' and outcome.outcome_gate==outcome.safety_gate=='passed'
    with service.db.transaction() as c: counters=summary(c,grant.id)
    return {'evidence_mode':'synthetic HTTPX; real PostgreSQL/product worker/domain/broker/outbox',
        'provider_inference_calls':0,'workspace_id':ws,'assignment_id':created.assignment.id,
        'initial_run_id':created.run.id,'revision_run_id':revised.run.id,'proposal_id':proposal.id,
        'approved_revision_id':approved.current_revision_id,'restart':restart,
        'outcome_gate':outcome.outcome_gate,'safety_gate':outcome.safety_gate,
        'underlying_action_performed':False,'counters':counters}

from contextlib import contextmanager
@contextmanager
def _transport(fake):
    t=fake.transport()
    try:yield t
    finally:t.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir',required=True)
    args=parser.parse_args()
    print(json.dumps(journey(args.state_dir),indent=2))

if __name__=='__main__':main()
