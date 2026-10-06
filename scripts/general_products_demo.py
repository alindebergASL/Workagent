#!/usr/bin/env python3
"""Real controlled CLI B2/B3 journey against an explicitly provisioned fresh DB.

No inference. Creates a new workspace; never resets records. Each CLI call is a
new process. Human edits/acceptance use the same authoritative Service commands.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from workagent.db import Database
from workagent.fixture import seed
from workagent.models import HumanSave,AcceptProposal,new_id
from workagent.service import Service,Principal

ROOT=Path(__file__).resolve().parents[1]
FIX=ROOT/'fixtures/general-work'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():
        parser.error('Refusing to overwrite existing evidence')
    if '/workagent_test_' not in os.environ['DATABASE_URL'] or os.environ.get('LOCAL_TEST_MODE')!='true':
        parser.error('Fresh disposable local test DB required')
    ws='general-products-'+new_id(); p=Principal(os.environ.get('LOCAL_PRINCIPAL_ID','local-human'))
    seed(os.environ['MIGRATION_DATABASE_URL'],json.loads((ROOT/'fixtures/actor/solo-v0.1/initial_records.json').read_text()),ws,p.id)
    service=Service(Database()); service.db.check_runtime_role()
    def cli(*words):
        child=subprocess.run([sys.executable,'-m','workagent.prompt_cli','--controlled','--workspace',ws,*words],
            cwd=ROOT,capture_output=True,text=True,env={**os.environ,'PYTHONPATH':str(ROOT/'backend')})
        if child.returncode:
            raise RuntimeError(child.stderr)
        return json.loads(child.stdout)
    def command(cls,**fields):
        return cls(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),**fields)
    def products(detail):
        return [x for x in detail['messages'][-1]['result']['results'] if x['kind']!='text']
    evidence={'mode':'controlled_transport','provider_observation':'not_observed','usefulness':'unverified','workspace_id':ws,'cli':{}}
    first=cli('prompt','Reconcile the attached invoice CSV; retain original cells and notes.',
        '--operator','reconcile_csv','--attach',str(FIX/'invoices.csv'))
    table=products(first)[0]; artifact=service.get_artifact(p,ws,table['artifact_id'])
    body=artifact.current_revision.body.model_copy(deep=True)
    body.notes=['Human: retain this review note.']; body.rows[1]['note']='Human: credit pending; keep my note'
    saved=service.human_save(p,ws,artifact.id,command(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=body))
    changed=cli('continue',first['conversation']['id'],'Switch to HALF_EVEN and preserve my saved row and review notes.',
        '--operator','reconcile_csv','--artifact-id',artifact.id,'--base-revision-id',saved.current_revision_id,'--rounding','ROUND_HALF_EVEN')
    proposal=products(changed)[0]
    accepted=service.accept_proposal(p,ws,proposal['proposal_id'],command(AcceptProposal,expected_current_revision_id=saved.current_revision_id))
    assert accepted.current_revision.body.notes==body.notes
    assert accepted.current_revision.body.rows[1]['note']==body.rows[1]['note']
    assert accepted.current_revision.body.source_csv==(FIX/'invoices.csv').read_text()
    assert accepted.current_revision.body.rows[1]['calculated_total']=='37.50'
    evidence['cli']['csv_initial']=first; evidence['cli']['csv_changed']=changed
    evidence['csv_accepted']=accepted.model_dump(mode='json')
    original=cli('prompt','Run the attached import-free invoice total tool with explicit integer inputs.',
        '--operator','run_wasm','--attach',str(FIX/'invoice-total.wat'),
        '--arg','3','--arg','1250','--field','quantity:Quantity','--field','price:Unit price cents')
    tool=products(original)[0]; artifact=service.get_artifact(p,ws,tool['artifact_id'])
    body=artifact.current_revision.body.model_copy(deep=True); body.notes=['Human: all amounts are integer cents.']
    saved=service.human_save(p,ws,artifact.id,command(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=body))
    shipping=cli('continue',original['conversation']['id'],'Change requirement: add shipping of 500 cents; keep my saved note.',
        '--operator','run_wasm','--artifact-id',artifact.id,'--base-revision-id',saved.current_revision_id,
        '--attach',str(FIX/'invoice-total-with-shipping.wat'),'--arg','3','--arg','1250','--arg','500',
        '--field','quantity:Quantity','--field','price:Unit price cents','--field','shipping:Shipping cents')
    proposal=products(shipping)[0]
    accepted=service.accept_proposal(p,ws,proposal['proposal_id'],command(AcceptProposal,expected_current_revision_id=saved.current_revision_id))
    before=service.get_product_observation(p,ws,tool['observation_id'])
    after=service.get_product_observation(p,ws,proposal['observation_id'])
    assert before.observation.output.value==3750 and after.observation.output.value==4250
    assert accepted.current_revision.body.notes==body.notes and after.binding_state=='current_revision'
    assert service.download_product(p,ws,artifact.id).content==(FIX/'invoice-total-with-shipping.wat').read_text()
    evidence['cli']['wasm_initial']=original; evidence['cli']['wasm_shipping']=shipping
    evidence['tool_accepted']=accepted.model_dump(mode='json')
    evidence['observations']=[service.get_product_observation(p,ws,item['observation_id']).model_dump(mode='json')
        for detail in (first,changed,original,shipping) for item in products(detail)]
    # New CLI processes read persisted bodies/results, no worker or provider invocation.
    evidence['reopened']=[cli('inspect',first['conversation']['id']),cli('inspect',original['conversation']['id'])]
    evidence['summary']={'csv_reported':'78.40','csv_calculated':'77.40','wasm_return':before.observation.output.value,
        'shipping_return':after.observation.output.value,'human_notes_preserved':True,
        'run_ids':{name:detail['runs'][-1]['id'] for name,detail in evidence['cli'].items()}}
    assert not service.list_assignments(p,ws).items
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x') as f:
        json.dump(evidence,f,indent=2,ensure_ascii=False); f.write('\n')
    print(json.dumps({'workspace_id':ws,'evidence':str(args.output),**evidence['summary']},indent=2))

if __name__=='__main__':
    main()
