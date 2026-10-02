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

class ResponsesDispatcher:
    def __init__(self,worker,*,workspace,grant_id):
        self.worker=worker; self.workspace=workspace; self.grant_id=grant_id

    def once(self):
        service=self.worker.service
        with service.db.transaction() as c:
            rows=c.execute('''SELECT d.run_id FROM run_dispatches d
                JOIN runs r ON r.workspace_id=d.workspace_id AND r.id=d.run_id
                JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id
                WHERE d.workspace_id=%s AND d.acknowledged_at IS NULL
                  AND r.data->>'profile'='openai-responses-v1' AND rc.data->>'grant_id'=%s
                ORDER BY d.cursor LIMIT 2''',(self.workspace,self.grant_id)).fetchall()
        results=[]
        for row in rows:
            try: status=self.worker.run(self.workspace,row['run_id'])
            except (DomainError,BundleDenied,TransportError,BlockingIOError): status='denied_or_deferred'
            except Exception:
                # CLI reporting boundary: never render DB/private-state/model values.
                # Direct worker tests still expose programmer failures to the test runner.
                status='internal_error'
            results.append({'run_id':row['run_id'],'status':status})
            if status not in ('completed','reconciled'):break
        return {'mode':self.worker.transport.provenance.mode,'results':results}


def authority(path):
    # No credential discovery. This is the user authority record, not key material.
    record=json.loads(Path(path).read_text())
    r=record['runtime']
    if not r.get('product_project_id') or not r.get('secure_secret_reference'):
        raise TransportError('product_project_and_secure_key_reference_missing')
    if r['model']!='gpt-6.1-sol' or r['profile']!='openai-responses-v1':
        raise TransportError('grant_route_mismatch')
    return record


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--authority-record',required=True)
    parser.add_argument('--workspace',required=True)
    parser.add_argument('--grant-id',required=True)
    parser.add_argument('--state-dir',required=True)
    action=parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--once',action='store_true')
    action.add_argument('--install-grant',metavar='OPERATOR_JSON')
    action.add_argument('--install-successor',metavar='OPERATOR_JSON')
    action.add_argument('--reconcile-run',metavar='RUN_ID',help='Known-ID readback/publication only; never count or generate')
    args=parser.parse_args()
    try:
        if os.environ.get('LOCAL_TEST_MODE')!='true':
            raise TransportError('local_only_required')
        record=authority(args.authority_record)  # Fails before DB or key access when access missing.
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
                validate_pins(grant,config,c)
            print(json.dumps({'status':'operator_successor_installed','approval':installed.model_dump(mode='json')}))
            return
        if args.install_grant:
            from .provider_attempts import configure_grant
            configure_grant(Database(os.environ['MIGRATION_DATABASE_URL']),grant)
            with db.transaction() as c:
                installed=c.execute('SELECT data,active FROM provider_grants WHERE id=%s',(grant.id,)).fetchone()
                if not installed or not installed['active'] or ProviderGrant.model_validate(installed['data'])!=grant:
                    raise TransportError('grant_install_readback_failed')
            print(json.dumps({'status':'operator_grant_installed','grant_id':grant.id}))
            return
        from .models import now
        from .responses_recovery import effective_expiry
        with db.transaction() as c:
            if effective_expiry(c,grant)<=now():raise TransportError('grant_expired')
            if args.reconcile_run:
                target=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                                 (args.workspace,args.reconcile_run)).fetchone()
                if not target or target['data'].get('grant_id')!=grant.id:
                    raise TransportError('grant_binding_mismatch')
        transport=ResponsesTransport(credential=load_credential(b.secret_reference),project_id=b.project_id,
                                     credential_reference=b.secret_reference,enabled=True)
        try:
            worker=ResponsesWorker(Service(db),transport,args.state_dir,poll_limit=1 if args.reconcile_run else 10)
            if args.reconcile_run:
                status=worker.run(args.workspace,args.reconcile_run,reconcile_only=True)
                from .responses_ledger import summary
                with db.transaction() as c:budget=summary(c,grant.id)
                print(json.dumps({'status':status,'run_id':args.reconcile_run,'grant_id':grant.id,'budget':budget}))
            else:
                print(json.dumps(ResponsesDispatcher(worker,workspace=args.workspace,grant_id=args.grant_id).once()))
        finally:transport.close()
    except (TransportError,DomainError,BundleDenied) as exc:
        # Never print request, receipt credentials, headers, provider text or DSNs.
        code=exc.code if isinstance(exc,TransportError) else 'authority_or_runtime_denied'
        parser.exit(2,json.dumps({'status':'blocked','code':code})+'\n')
    except Exception:
        parser.exit(2,json.dumps({'status':'blocked','code':'local_configuration_or_runtime_error'})+'\n')

if __name__=='__main__':main()
