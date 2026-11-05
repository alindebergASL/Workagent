"""One exact, funded diagnostic GET; never create, cancel, reparse or replace receipts.

A malformed terminal result retained no arguments. Capture the same provider
identity once through the unchanged official transport + per-read SQL gate. Keep
raw synthetic-study response private; publish validation paths/types only.
"""
from dataclasses import asdict
from datetime import datetime,timezone
import fcntl
import json
import os
from pathlib import Path
import time
from pydantic import ValidationError
import study_application as A
from study_controller import canonical,digest
from study_source_amendment import load
from study_transport import attach_transport
from workagent.general_worker import GeneralWorker
from workagent.general_responses import check_pins
from workagent.provider_attempts import ReceiptCapability
from workagent.service import WorkerCapability
from workagent.responses_ledger import Ledger,parsed_data
from workagent.responses_io import interval

ROOT=Path(__file__).resolve().parents[1]
SLOT=ROOT/'.local/batch3/b35c/live-study/campaign/d477c622c837a9cc1fb1f0be'
OUT=ROOT/'.local/batch3/b35c/discovery-recovery/schema-diagnostic'
RID='6ad4f6c8-091b-4660-a362-732c9af752a3'
ATTEMPT='20afa88b-46ac-46fd-9c65-f5fea9c181c4'
PHASE='selection_3'
RESPONSE='resp_089e1a2789695b03006ae3f6226e6487d0ae19867dd2ef49ff'


def validate_rejection(request,events):
    old=events['result']
    assert request.phase==PHASE and request.metadata.request_id==RID and request.metadata.attempt_id==ATTEMPT
    assert old['state']=='malformed' and old['issue']=='schema_validation_failed'
    assert old['response_id']==events['identity']['response_id']==RESPONSE
    assert old['request_sha256']==request.sha256 and old['usage'] is not None
    assert old['value'] is None and old['output_items']=='[]' and 'tool_result' not in events
    return old


def diagnostic(document,request):
    assert document['id']==RESPONSE and document['metadata']==request.metadata.model_dump()
    calls=[i for i in document['output'] if i['type']=='function_call']
    assert len(calls)==1 and calls[0]['name']=='choose_general_action'
    # Do not repair, instantiate under a looser schema, or execute returned data.
    value=json.loads(calls[0]['arguments'])
    try:request.schema.model.model_validate(value,strict=True)
    except ValidationError as exc:
        errors=[{'location':list(e['loc']),'type':e['type']} for e in exc.errors(include_input=False,include_context=False,include_url=False)]
    else:raise AssertionError('retained schema rejection did not reproduce')
    return {'decision_kind':value.get('decision',{}).get('kind'),'errors':errors}


def main():
    os.umask(0o077);assert load() is not None
    assert not OUT.exists(),'no automatic reread of diagnostic'
    state=json.loads((SLOT/'application.json').read_text());assert state['current_run']==RID
    s,p,_=A.context(SLOT,state);run=s.get_run(p,state['workspace'],RID)
    assert run.state=='running'
    if run.lease_expires_at and run.lease_expires_at>datetime.now(timezone.utc):
        time.sleep((run.lease_expires_at-datetime.now(timezone.utc)).total_seconds()+0.1)
    with (SLOT.parent/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with s.db.transaction() as c:config=check_pins(c,s.get_run(p,state['workspace'],RID))
        grant=state['active_grant'];ref=grant['responses']['secret_reference'];assert ref.startswith('file:')
        key=Path(ref[5:]);assert key.stat().st_mode&0o077==0
        transport=attach_transport(s,dict(transport='official_api',principal=p.id,workspace=state['workspace'],
            run_id=RID,grant_id=grant['id'],grant=grant,run_configuration=config),credential=key.read_text().strip())
        worker=GeneralWorker(s,transport=transport,state=SLOT/'worker-state',enable_responses=True)
        phases=worker.phases
        try:
            with phases.state.lock(state['workspace'],RID):
                saved=phases.state.load(state['workspace'],RID);receipt=ReceiptCapability(**saved['receipt'])
                assert receipt.attempt_id==ATTEMPT
                # Normal domain reclaim after natural expiry, never lease surgery.
                cap=s._claim_run(p,state['workspace'],RID,responses_receipt=receipt)
                saved['worker']=asdict(cap);phases.state.save(state['workspace'],RID,saved)
                ledger=Ledger(s,receipt);request,events=ledger.snapshot(PHASE,cap)
                old=validate_rejection(request,events);phases._authorize_transport(config)
                OUT.mkdir(mode=0o700)
                (OUT/'intent.json').write_text(canonical(dict(run=RID,attempt=ATTEMPT,phase=PHASE,response=RESPONSE,
                    request_sha256=request.sha256,result_sha256=digest(canonical(old)),new_count=0,new_create=0,max_reads=1))+'\n')
                captured=[]
                def observe(response):
                    assert response.request.method=='GET' and response.request.url.path=='/v1/responses/'+RESPONSE
                    response.read();assert response.status_code==200
                    raw=response.content;document=json.loads(raw)
                    assert document['id']==RESPONSE and document['metadata']==request.metadata.model_dump()
                    with (OUT/'response.private.json').open('xb') as f:f.write(raw)
                    captured.append(document)
                transport._client.event_hooks['response'].append(observe)
                deadline=phases._visit_deadline(cap)
                with interval(ledger,request,'read',cap):
                    read_id=phases._reserve_http(ledger,request,'read',cap,deadline)
                    assert read_id is not None and phases._after_reservation_ready(request,'read',cap,deadline)
                    (OUT/'read-reserved.json').write_text(canonical(dict(read_id=read_id))+'\n')
                    result=transport.retrieve(RESPONSE,request=request)
                assert parsed_data(result)==old and len(captured)==1
                assert ledger.snapshot(PHASE,cap)[1]==events
                report=diagnostic(captured[0],request)
                report.update(response_sha256=digest((OUT/'response.private.json').read_bytes()),read_id=read_id,
                    immutable_result_unchanged=True,new_count=0,new_create=0,new_reads=1)
                (OUT/'DIAGNOSIS.json').write_text(canonical(report)+'\n');print(canonical(report))
        finally:transport.close()

if __name__=='__main__':main()
