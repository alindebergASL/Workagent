"""Read exact existing run + saved diagnostic, no HTTP or installed writes."""
import json,os
from pathlib import Path
from workagent.db import Database
from workagent.models import ProviderGrant
from workagent.adaptive import contract,CAPABILITY
from workagent.responses_transport import PreparedRequest,RequestMetadata
from workagent.selection_rejection import observation
from study_controller import canonical,digest
from amend_gateway_recovery import TRIAL,CAMPAIGN,exact_bytes
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.local/batch3/b35c/selection-recovery'
RUN='6ad4f6c8-091b-4660-a362-732c9af752a3'
ATTEMPT='20afa88b-46ac-46fd-9c65-f5fea9c181c4'
PHASE='selection_3'
DIAG=ROOT/'.local/batch3/b35c/discovery-recovery/schema-diagnostic'

def prepare():
    os.umask(0o077)
    assert not (OUT/'LIVE_BINDING.private.json').exists(),'reuse captured exact binding, no automatic refresh'
    b=json.loads((CAMPAIGN.parent/'live-bindings.private.json').read_bytes())[TRIAL]
    raw=(DIAG/'response.private.json').read_bytes()
    report=json.loads((DIAG/'DIAGNOSIS.json').read_bytes())
    assert digest(raw)==report['response_sha256']
    with Database(b['database_url']).transaction() as c:
        c.execute('SET TRANSACTION READ ONLY')
        run=c.execute('SELECT data FROM runs WHERE id=%s',(RUN,)).fetchone()['data']
        assert run['state']=='running'
        steps=c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s ORDER BY phase',(ATTEMPT,)).fetchall()
        events=c.execute('SELECT id,phase,kind,data FROM responses_events WHERE attempt_id=%s ORDER BY phase,kind,id',(ATTEMPT,)).fetchall()
        config=c.execute('SELECT data FROM run_configurations WHERE run_id=%s',(RUN,)).fetchone()['data']
        migrations=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    request_row=next(s for s in steps if s['phase']==PHASE)
    result=next(e for e in events if e['phase']==PHASE and e['kind']=='result')
    read_id=json.loads((DIAG/'read-reserved.json').read_bytes())['read_id']
    assert any(e['id']==read_id and e['phase']==PHASE and e['kind']=='read' for e in events)
    _,schema=contract(ProviderGrant.model_validate(b['grant']).responses)
    request=PreparedRequest(request_row['request_bytes'].encode(),RequestMetadata.model_validate(request_row['metadata']),PHASE,schema,CAPABILITY)
    assert request.sha256==request_row['request_sha256']
    proof=observation(request,result,raw.decode(),config['responses']['max_steps'],run['fence'])
    assert proof['feedback']['generated_text']['utf8_bytes']==4224
    assert proof['feedback']['generated_text']['sha256']=='554ad60bb09186312457a06a3922c3f285e1313332a0cc32f942879cb5d5d40a'
    from workagent.capabilities.registry import adapters
    current=adapters();tool=json.loads((CAMPAIGN/TRIAL/'application.json').read_bytes())['active_tool_grant'] if False else None
    state=json.loads((CAMPAIGN/TRIAL/'application.json').read_bytes())
    # The model-facing schema and existing tool descriptors have not changed.
    assert json.loads(request.body)['tools'][0]['parameters']==json.loads(schema.material)
    saved=dict(run=run,steps=steps,events=events,configuration=config,migrations=migrations,
        diagnostic_file=str((DIAG/'response.private.json').relative_to(ROOT)),diagnostic_sha256=digest(raw),
        read_event_id=read_id,result_event_id=result['id'],result_sha256=digest(canonical(result['data'])))
    exact_bytes(OUT/'LIVE_BINDING.private.json',(canonical(saved)+'\n').encode())
    public=dict(run=RUN,attempt=ATTEMPT,phase=PHASE,response=proof['response_id'],
        request_sha256=request.sha256,result_sha256=proof['result_sha256'],diagnostic_sha256=proof['diagnostic_sha256'],
        generated_utf8_bytes=4224,generated_sha256=proof['feedback']['generated_text']['sha256'],
        configured_max_steps=config['responses']['max_steps'],original_results=len([e for e in events if e['kind']=='result']),
        counts={phase:{kind:sum(e['phase']==phase and e['kind']==kind for e in events) for kind in ('dispatch','read','result','tool_result','selection_rejection')} for phase in sorted({e['phase'] for e in events})},
        new_provider_io=0,installed_writes=0)
    exact_bytes(OUT/'EXACT_REPRODUCTION.json',(canonical(public)+'\n').encode());print(canonical(public))
if __name__=='__main__':prepare()
