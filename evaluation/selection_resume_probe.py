"""Synthetic-only prepared-selection cold jail timing/fault probe around the unchanged phase driver."""
import json
from pathlib import Path
import sys
import time
sys.path[:0]=['/product','/deps','/']
import study_worker
from workagent.general_worker import GeneralWorker
from workagent.responses_worker import ResponsesWorker
from workagent.responses_transport import ResponsesTransport
from workagent.responses_ledger import Ledger
from workagent.service import Service,now

trace=[];claim=[];active=[]
original_claim=Service._claim_run
original_reserve=ResponsesWorker._reserve_http
original_window=ResponsesWorker._http_window
original_init=GeneralWorker.__init__
original_operation=Ledger.reserve_operation

def claiming(self,*a,**kw):
    start=time.monotonic();result=original_claim(self,*a,**kw)
    claim[:]=[start,time.monotonic()]
    trace.append({'event':'claim','seconds':claim[1]-claim[0],'fence':result.fence})
    return result

def window(self,run,deadline,**kw):
    result=original_window(self,run,deadline,**kw)
    if active and active[-1][0]=='selection_5':
        trace.append({'event':'http_window','operation':active[-1][1],'handoff':kw.get('handoff',False),
            'allowed':result,'lease_remaining':(run.lease_expires_at-now()).total_seconds(),
            'claim_to_check_seconds':time.monotonic()-claim[0] if claim else None,
            'allowance':sum(self.transport._client.timeout.as_dict().values())+5+(5 if kw.get('handoff') else 0)})
    return result

def reserve(self,ledger,request,kind,cap,deadline):
    active.append((request.phase,kind))
    try:return original_reserve(self,ledger,request,kind,cap,deadline)
    finally:active.pop()

def operation(self,request,kind,cap,**kw):
    if mode=='before_reservation' and request.phase=='selection_5' and kind=='count_send':
        ready=kw['ready']
        def interrupt(run):
            assert ready(run),'cold reservation window did not fit'
            raise InterruptedError('before reservation commit')
        kw['ready']=interrupt
    return original_operation(self,request,kind,cap,**kw)

def init(self,*a,**kw):
    hook=kw.get('hook')
    def fault(name):
        if (mode=='after_identity' and name=='after_response') or (mode=='normal' and name=='after_tool_result'):raise InterruptedError('after identity')
        if hook:hook(name)
    kw['hook']=fault
    return original_init(self,*a,**kw)

def forbidden(*a,**kw):raise AssertionError('prepared history must not be rebuilt, recounted or restaged')

if __name__=='__main__':
    # Read only the explicit synthetic probe selector; pass cfg unchanged through
    # the real worker's source/dependency/input/network/SQL-role validation.
    import io
    raw=sys.stdin.read();cfg=json.loads(raw);mode=cfg.pop('probe_mode','normal')
    assert cfg['transport']=='controlled_http' and cfg['grant']['responses']['transport_mode']=='synthetic'
    sys.stdin=io.StringIO(json.dumps(cfg))
    original_prepared=GeneralWorker._prepared_selection
    def prepared(self,*args):
        start=time.monotonic()
        try:return original_prepared(self,*args)
        finally:trace.append({'event':'validate_prepared_selection','seconds':time.monotonic()-start})
    GeneralWorker._prepared_selection=prepared
    Service.conversation_worker_context=forbidden
    Service._claim_run=claiming
    ResponsesWorker._http_window=window
    ResponsesWorker._reserve_http=reserve
    Ledger.reserve_operation=operation
    GeneralWorker.__init__=init
    original_stage=Service.stage_general_product
    def stage(self,cap,receipt,phase='selection'):
        assert phase=='selection_5', 'settled selection restaged'
        return original_stage(self,cap,receipt,phase)
    Service.stage_general_product=stage
    Ledger.prepare=forbidden
    original_count=ResponsesTransport.count
    def count(self,request):
        assert request.phase=='selection_5', 'settled selection recounted'
        return original_count(self,request)
    ResponsesTransport.count=count
    try:study_worker.main()
    finally:print(json.dumps({'probe_trace':trace}),file=sys.stderr)
