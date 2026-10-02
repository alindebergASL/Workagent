"""Recover a recorded live-model draft through the real domain API.

Operator-assisted qualification only: no model call, model worker, provider switch,
new authority, or implied human approval. The default app adapter stays fixture-only.
"""
import argparse, hashlib, json, os, sys, urllib.request, uuid
from pathlib import Path
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from workagent.models import Body, Block, HumanSave
from workagent.service import canonical


def persist(path,data):
    with path.open('x') as f:
        json.dump(data,f,indent=2);f.flush();os.fsync(f.fileno())
    fd=os.open(path.parent,os.O_DIRECTORY);os.fsync(fd);os.close(fd)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['prepare','commit-and-crash','recover','verify'])
    parser.add_argument('--proof-dir',type=Path,required=True)
    args=parser.parse_args();d=args.proof_dir
    base=os.environ['WORKAGENT_PROOF_API']
    parsed=urlparse(base)
    if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or parsed.username or parsed.password:
        raise RuntimeError('Only the explicitly started local evaluator API is allowed')
    def api(path,body=None):
        headers={'Authorization':'Bearer '+os.environ['LOCAL_BEARER_TOKEN'],'X-Schema-Version':'workagent/v1','X-Request-Id':str(uuid.uuid4()),'Content-Type':'application/json'}
        request=urllib.request.Request(base+'/v1/workspaces/local-workspace'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        with urllib.request.urlopen(request,timeout=30) as r:return json.load(r)
    def command(id):return {'schema_version':'workagent/v1','request_id':str(uuid.uuid4()),'command_id':id}
    response=json.loads((d/'response.json').read_text());dispatch=json.loads((d/'dispatch.json').read_text());request=json.loads((d/'request.json').read_text())
    request_hash=hashlib.sha256((d/'request.json').read_bytes()).hexdigest()
    if response['status']!='response_received' or response['http_status']!=200 or response['stop_reason']!='end_turn' or response['request_sha256']!=request_hash or dispatch['request_sha256']!=request_hash:
        raise RuntimeError('A complete bound actual response is required; no synthetic replacement')
    data=json.loads(response['text']);required={'analysis','plan','checklist','protected_note','evidence_source_ids','uncertainties'}
    if set(data)!=required or not isinstance(data['analysis'],str) or not isinstance(data['protected_note'],str):raise RuntimeError('Unexpected model shape')
    for key in ['plan','checklist','evidence_source_ids','uncertainties']:
        if not isinstance(data[key],list) or not 1<=len(data[key])<=30 or not all(isinstance(x,str) and 1<=len(x)<=20000 for x in data[key]):raise RuntimeError('Invalid model list')
    payload=json.loads(request['messages'][0]['content']);selected=payload['selected_sources']
    expected={x['id'] for x in selected}
    if len(data['evidence_source_ids'])!=len(expected) or set(data['evidence_source_ids'])!=expected:raise RuntimeError('Unexpected source attribution')
    protected=next(x['content']['protected_note'] for x in selected if 'protected_note' in x['content'])
    if data['protected_note']!=protected:raise RuntimeError('Model changed protected source note')
    rows=next(x['content']['rows'] for x in selected if 'rows' in x['content'])
    missing=[x['id'] for x in rows if not x['owner_recorded'] or not x['next_action_recorded']]
    if f'{len(missing)} unique cases' not in data['analysis'] or not all(id in data['analysis'] for id in missing):raise RuntimeError('Model count/IDs did not match this synthetic case')
    response_hash=hashlib.sha256((d/'response.json').read_bytes()).hexdigest()
    if args.operation=='prepare':
        if (d/'operation.json').exists():raise RuntimeError('Existing operation must be recovered, never rebound')
        source_details=[api('/sources/'+x['id']) for x in selected]
        for source,original in zip(source_details,selected):
            if source['content']!=original['content'] or source['external_version']!=str(original['version']):raise RuntimeError('Current permitted source differs from model input')
        refs=[{k:v for k,v in {'source_id':x['id'],'external_version':x['external_version'],'observed_at':x['observed_at']}.items()} for x in source_details]
        created=api('/assignments',{**command('model-proof-create:'+response['response_id']),'goal':payload['goal'],'completion_criteria':['Inspect a real Qwen-generated private plan and checklist, preserving exact source notes and uncertainty.'],'selected_source_refs':refs})
        # Establish an explicit fixture baseline, then an operator-imported live draft.
        # Neither this baseline nor its profile is represented as model execution.
        from workagent.db import Database
        from workagent.service import Service,Principal
        from workagent.fixture import run_fixture
        run_fixture(Service(Database()),Principal('local-human'),'local-workspace',created['run']['id'])
        a=api('/assignments/'+created['assignment']['id']);art=api('/artifacts/'+a['artifact_ids'][0])
        body=Body(title='Qwen-assisted private working plan',blocks=[
            Block(block_id='model-provenance',kind='paragraph',text=f"Actual {response['model_returned']} draft, operator-imported for review. Provider response {response['response_id']}; response SHA-256 {response_hash}. Not an autonomous product-worker run or human approval. No external action occurred."),
            Block(block_id='analysis',kind='paragraph',text=data['analysis']),
            *[Block(block_id='plan-'+str(i),kind='paragraph',text=x) for i,x in enumerate(data['plan'])],
            Block(block_id='protected-0',kind='protected_note',text=data['protected_note']),
            Block(block_id='checklist-heading',kind='heading',text='Reusable model-generated checklist'),
            *[Block(block_id='check-'+str(i),kind='checklist',text=x) for i,x in enumerate(data['checklist'])],
            Block(block_id='unknowns',kind='paragraph',text='Unknowns: '+' '.join(data['uncertainties']))])
        save=HumanSave(**command('model-proof-save:'+response['response_id']),expected_current_revision_id=art['current_revision_id'],body=body).model_dump(mode='json')
        persist(d/'operation.json',{'assignment_id':a['id'],'artifact_id':art['id'],'baseline_revision_id':art['current_revision_id'],'body_hash':hashlib.sha256(canonical(body).encode()).hexdigest(),'response_sha256':response_hash,'command':save,'mode':'operator_assisted_live_model_draft','model_dispatches':1,'crosscheck':{'source_ids':sorted(expected),'missing_case_ids':missing,'sample_size':len(rows),'protected_note_unchanged':True}})
        print(json.dumps({'prepared':True,'assignment_id':a['id'],'artifact_id':art['id']}));return
    operation=json.loads((d/'operation.json').read_text())
    if operation['response_sha256']!=response_hash:raise RuntimeError('Recorded response changed')
    if args.operation=='commit-and-crash':
        saved=api('/artifacts/'+operation['artifact_id']+'/save',operation['command'])
        persist(d/'unacknowledged-commit.json',{'revision_id':saved['current_revision_id'],'body_hash':saved['current_revision']['body_hash']})
        os._exit(73)  # PG committed; local workflow acknowledgement deliberately absent.
    if args.operation=='recover':
        # Same command/base/body; current authorization and backend receipt decide replay.
        saved=api('/artifacts/'+operation['artifact_id']+'/save',operation['command'])
    else:saved=api('/artifacts/'+operation['artifact_id'])
    receipt=json.loads((d/'unacknowledged-commit.json').read_text())
    history=api('/artifacts/'+operation['artifact_id']+'/history?limit=100')['items']
    if saved['current_revision_id']!=receipt['revision_id'] or saved['current_revision']['body_hash']!=operation['body_hash'] or len(history)!=2 or saved['current_revision']['author_kind']!='human':raise RuntimeError('Recovery did not preserve the exact single operator import')
    result={'passed':True,'mode':operation['mode'],'operation':args.operation,'assignment_id':operation['assignment_id'],'artifact_id':operation['artifact_id'],'revision_id':saved['current_revision_id'],'body_hash':saved['current_revision']['body_hash'],'history_count':len(history),'model_dispatches':1,'provider_response_id':response['response_id'],'model_returned':response['model_returned'],'usage':response['usage'],'no_new_model_call':True,'not_autonomous_worker':True,'not_owner_approval':True}
    persist(d/(args.operation+'.json'),result);print(json.dumps(result))

if __name__=='__main__':main()
