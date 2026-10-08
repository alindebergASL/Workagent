"""Local-only explicit Responses dispatcher/operator CLI. Never creates a grant on run."""
import argparse
import json
import os
from pathlib import Path
from .db import Database
from .errors import DomainError
from .models import ProviderGrant,Run
from .service import Service
from .runtime_config import BundleDenied,active_configuration
from .responses_worker import ResponsesWorker,load_credential,validate_pins
from .responses_transport import ResponsesTransport,TransportError

def general_dispatch_status(run, observation):
    """A terminal retained product isn't a verified goal or a retry request.

    Receipt-backed publication permits watching for newly admitted work.
    Unknown/invalid work remains isolated from unrelated admitted commands.
    """
    if run.state=='cancelled': return 'cancelled'
    if observation.provider_observation=='outcome_unknown': return 'outcome_unknown'
    if observation.provider_observation=='invalid': return 'invalid_response'
    if run.state=='ready': return 'completed'
    if run.state=='partial':
        local=observation.retained_local_result
        if (observation.adaptive and observation.adaptive.outcome=='needs_validation'
            and local and local.published and local.status=='observed'
            and observation.response_steps and all(s.state=='received' for s in observation.response_steps)):
            return 'result_needs_review'
        if observation.adaptive and observation.adaptive.outcome in ('blocked','waiting_for_user','step_limit','budget_limit'):
            return observation.adaptive.outcome
        return 'local_tool_rejected'
    return 'provider_pending' if run.state=='running' else run.state


class ResponsesDispatcher:
    def __init__(self,worker,*,workspace,grant_id):
        self.worker=worker; self.workspace=workspace; self.grant_id=grant_id
        # Same durable outbox and existing local worker. This cursor is only a
        # fairness hint; restart safely scans again, never a second work ledger.
        self.cursor=0
        from .dispatcher import Dispatcher
        self.local_dispatcher=Dispatcher(worker.service,workspace=workspace,general_controlled=True)

    def once(self,*,model_authorized=True):
        service=self.worker.service
        local=self.local_dispatcher.once()
        if not model_authorized:
            return {'mode':self.worker.transport.provenance.mode,'local':local,
                    'results':[],'model_status':'authority_unavailable'}
        with service.db.transaction() as c:
            rows=c.execute('''SELECT d.cursor,d.run_id,r.data,g.active FROM run_dispatches d
                JOIN runs r ON r.workspace_id=d.workspace_id AND r.id=d.run_id
                JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id
                JOIN provider_grants g ON g.id=rc.data->>'grant_id'
                WHERE d.workspace_id=%s AND d.acknowledged_at IS NULL AND d.cursor>%s
                  AND r.data->>'profile'=%s AND rc.data->>'grant_id'=%s
                ORDER BY d.cursor LIMIT 100''',(self.workspace,self.cursor,'general-responses-v1' if hasattr(self.worker,'phases') else 'openai-responses-v1',self.grant_id)).fetchall()
        self.cursor=rows[-1]['cursor'] if len(rows)==100 else 0
        results=[]
        for row in rows:
            observation=None
            try:
                status=self._blocked_status(row)
                if status is not None:
                    pass
                elif hasattr(self.worker,'phases'):
                    from .service import Principal
                    run=self.worker.work(Principal(row['data']['principal_id'],'worker'),self.workspace,row['run_id'])
                    detail=service.get_conversation(Principal(row['data']['principal_id']),self.workspace,run.conversation_id)
                    observation=next(t for t in detail.turns if t.run_id==run.id)
                    status=general_dispatch_status(run,observation)
                else: status=self.worker.run(self.workspace,row['run_id'])
            except (DomainError,BundleDenied,TransportError,BlockingIOError): status='denied_or_deferred'
            except Exception:
                # CLI reporting boundary: never render DB/private-state/model values.
                # Direct worker tests still expose programmer failures to the test runner.
                status='internal_error'
            result={'run_id':row['run_id'],'status':status}
            # Detailed evidence belongs in authenticated canonical readback,
            # never stdout of a continuous operator process.
            results.append(result)
        return {'mode':self.worker.transport.provenance.mode,'local':local,'results':results}

    def _blocked_status(self,row):
        if not row['active']:
            return 'authority_unavailable'
        from .responses_ledger import observations
        with self.worker.service.db.transaction() as c:
            attempt=c.execute('SELECT id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',
                (self.workspace,row['run_id'])).fetchone()
            steps=observations(c,attempt['id']) if attempt else []
        # An accepted known ID can be retrieved. Unknown count/send and invalid
        # output require a separate explicit resolution, never repeated work().
        if any(s.state in ('count_unknown','outcome_unknown') for s in steps):
            return 'outcome_unknown'
        if any(s.state=='invalid' for s in steps):
            return 'invalid_response'
        return None


def authority(path,*,general=False):
    # No credential discovery. This is the user authority record, not key material.
    record=json.loads(Path(path).read_text())
    r=record['runtime']
    if not r.get('product_project_id') or not r.get('secure_secret_reference'):
        raise TransportError('product_project_and_secure_key_reference_missing')
    if r['model']!='gpt-6.1-sol' or r['profile']!=('general-responses-v1' if general else 'openai-responses-v1'):
        raise TransportError('grant_route_mismatch')
    if general:
        from .general_responses import verify_route_record
        verify_route_record(record)
    return record


def general_status(db,workspace,grant_id):
    """Local operator readback only; no private request/receipt/key material."""
    from .responses_ledger import summary
    from .products import turn_state
    with db.transaction() as c:
        row=c.execute('SELECT data,active FROM provider_grants WHERE id=%s AND workspace_id=%s',
                      (grant_id,workspace)).fetchone()
        if not row or row['data']['profile']!='general-responses-v1':
            raise TransportError('grant_binding_mismatch')
        grant=ProviderGrant.model_validate(row['data'])
        runs=c.execute("SELECT r.data FROM runs r JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id WHERE r.workspace_id=%s AND rc.data->>'grant_id'=%s ORDER BY r.id",(workspace,grant_id)).fetchall()
        return {'grant_id':grant.id,'workspace_id':workspace,'active':row['active'],
            'profile':grant.profile,'mode':grant.responses.transport_mode,'expires_at':None,
            'conversation_ids':grant.responses.conversation_ids,'budget':summary(c,grant.id),
            'shared_budget':summary(c,grant.id,shared=True),
            'turns':[turn_state(Run.model_validate(r['data']),c).model_dump(mode='json',exclude={'retained_local_result'}) for r in runs]}


def serve(dispatcher,verify,interval):
    """Continue independent admitted work; journal gates unknown provider actions."""
    import time
    if not 0.1<=interval<=60:
        raise ValueError('interval must be between 0.1 and 60 seconds')
    previous=None
    while True:
        authorized=True
        try:
            verify()
        except (TransportError,DomainError,BundleDenied):
            authorized=False
        result=dispatcher.once() if authorized else dispatcher.once(model_authorized=False)
        if result!=previous and (result['results'] or result.get('model_status') or any(result.get('local',{}).values())):
            print(json.dumps(result),flush=True)
        previous=result
        time.sleep(interval)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--general-responses',action='store_true',help='Explicit opt-in to same GeneralWorker conversation profile')
    parser.add_argument('--authority-record')
    parser.add_argument('--workspace',required=True)
    parser.add_argument('--grant-id',required=True)
    parser.add_argument('--state-dir')
    parser.add_argument('--interval',type=float,default=2.0)
    action=parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--once',action='store_true')
    action.add_argument('--status',action='store_true',help='Read cumulative general status; no key access or provider I/O')
    action.add_argument('--serve',action='store_true',help='Advance admitted model/local work; recover known IDs, never regenerate unknown sends')
    action.add_argument('--install-grant',metavar='OPERATOR_JSON')
    action.add_argument('--install-successor',metavar='OPERATOR_JSON')
    action.add_argument('--reconcile-run',metavar='RUN_ID',help='Known-ID readback/publication only; never count or generate')
    args=parser.parse_args()
    try:
        if os.environ.get('LOCAL_TEST_MODE')!='true':
            raise TransportError('local_only_required')
        if args.status:
            if not args.general_responses: raise TransportError('general_profile_required')
            db=Database(); db.check_runtime_role()
            print(json.dumps(general_status(db,args.workspace,args.grant_id)))
            return
        if not args.authority_record or not args.state_dir or not 0.1<=args.interval<=60:
            raise TransportError('explicit_authority_state_and_bounded_interval_required')
        if args.serve and not args.general_responses: raise TransportError('general_profile_required')
        # Keep the historical intake invocation unchanged (including operator adapters).
        record=(authority(args.authority_record,general=True) if args.general_responses else authority(args.authority_record))  # Before DB/key access.
        if args.grant_id!=record['grant_id']:raise TransportError('grant_identity_mismatch')
        db=Database(); db.check_runtime_role()
        if args.install_grant:
            grant=ProviderGrant.model_validate_json(Path(args.install_grant).read_text())
        else:
            with db.transaction() as c:
                row=c.execute('SELECT data,active FROM provider_grants WHERE id=%s',(args.grant_id,)).fetchone()
                if not row or not row['active']:raise TransportError('operator_grant_required')
                grant=ProviderGrant.model_validate(row['data'])
        b=grant.responses
        if (grant.id!=args.grant_id or grant.workspace_id!=args.workspace or b is None or
            b.transport_mode!='official_api' or b.project_id!=record['runtime']['product_project_id'] or
            b.secret_reference!=record['runtime']['secure_secret_reference']):
            raise TransportError('grant_binding_mismatch')
        if args.general_responses:
            if args.reconcile_run: raise TransportError('general_use_same_worker_once_for_recovery')
            from .general_responses import validate_grant
            if not args.install_successor:
                with db.transaction() as c: validate_grant(grant,c)
        else:
            with db.transaction() as c:
                _,config=active_configuration(c)
                if not args.install_successor:validate_pins(grant,config,c)
        if args.install_successor:
            from .responses_recovery import SuccessorApproval,install_successor
            approval=SuccessorApproval.model_validate_json(Path(args.install_successor).read_text())
            if approval.grant_id!=grant.id:raise TransportError('grant_identity_mismatch')
            installed=install_successor(Database(os.environ['MIGRATION_DATABASE_URL']),approval)
            with db.transaction() as c:
                actual=c.execute('SELECT data FROM provider_consumer_successors WHERE grant_id=%s',(grant.id,)).fetchone()
                if not actual or SuccessorApproval.model_validate(actual['data'])!=installed:
                    raise TransportError('successor_install_readback_failed')
                if args.general_responses: validate_grant(grant,c)
                else: validate_pins(grant,config,c)
            print(json.dumps({'status':'operator_successor_installed','approval':installed.model_dump(mode='json')}))
            return
        if args.install_grant:
            from .provider_attempts import configure_grant
            configure_grant(Database(os.environ['MIGRATION_DATABASE_URL']),grant,route_record=record if args.general_responses else None)
            with db.transaction() as c:
                installed=c.execute('SELECT data,active FROM provider_grants WHERE id=%s',(grant.id,)).fetchone()
                if not installed or not installed['active'] or ProviderGrant.model_validate(installed['data'])!=grant:
                    raise TransportError('grant_install_readback_failed')
            print(json.dumps({'status':'operator_grant_installed','grant_id':grant.id}))
            return
        from .models import now
        from .responses_recovery import effective_expiry
        with db.transaction() as c:
            if not args.general_responses and effective_expiry(c,grant)<=now():raise TransportError('grant_expired')
            if args.reconcile_run:
                target=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                                 (args.workspace,args.reconcile_run)).fetchone()
                if not target or target['data'].get('grant_id')!=grant.id:
                    raise TransportError('grant_binding_mismatch')
        transport=ResponsesTransport(credential=load_credential(b.secret_reference),project_id=b.project_id,
                                     credential_reference=b.secret_reference,enabled=True)
        try:
            if args.general_responses:
                from .general_worker import GeneralWorker
                worker=GeneralWorker(Service(db),transport=transport,state=args.state_dir,enable_responses=True,
                                     poll_limit=1 if args.serve else 10)
            else:
                worker=ResponsesWorker(Service(db),transport,args.state_dir,poll_limit=1 if args.reconcile_run else 10)
            if args.reconcile_run:
                status=worker.run(args.workspace,args.reconcile_run,reconcile_only=True)
                from .responses_ledger import summary
                with db.transaction() as c:budget=summary(c,grant.id)
                print(json.dumps({'status':status,'run_id':args.reconcile_run,'grant_id':grant.id,'budget':budget}))
            else:
                dispatcher=ResponsesDispatcher(worker,workspace=args.workspace,grant_id=args.grant_id)
                if args.serve:
                    def verify():
                        from .general_responses import verify_route_record
                        verify_route_record(record,grant)
                        with db.transaction() as c:
                            row=c.execute('SELECT active FROM provider_grants WHERE id=%s',(grant.id,)).fetchone()
                            if not row or not row['active']: raise TransportError('operator_grant_required')
                    serve(dispatcher,verify,args.interval)
                else: print(json.dumps(dispatcher.once()))
        finally:transport.close()
    except (TransportError,DomainError,BundleDenied) as exc:
        # Never print request, receipt credentials, headers, provider text or DSNs.
        code=exc.code if isinstance(exc,TransportError) else 'authority_or_runtime_denied'
        parser.exit(2,json.dumps({'status':'blocked','code':code})+'\n')
    except Exception:
        parser.exit(2,json.dumps({'status':'blocked','code':'local_configuration_or_runtime_error'})+'\n')

if __name__=='__main__':main()
