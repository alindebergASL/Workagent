"""The B1 product worker, used unchanged by CLI and HTTP-admitted turns.

Controlled transport is an explicit test input, not a second answer-producing
CLI or an inference implementation. No provider modules, keys or fallback.
"""
from copy import deepcopy

from .conversations import PROFILE, PRODUCT_PROFILE
from .errors import DomainError
from .models import TextResult, TurnResult
from .service import Principal


class ControlledTransport:
    mode = 'controlled'

    def __init__(self, responses=None):
        self.responses = iter(responses) if responses is not None else None
        self.calls = 0
        self.contexts = []

    def respond(self, context):
        self.calls += 1
        self.contexts.append(deepcopy(context))
        if self.responses is not None:
            return next(self.responses)
        humans=[m for m in context['messages'] if m['author_kind']=='human']
        operation=humans[-1].get('operation')
        if operation is not None:
            # Controlled selection from the explicit registry; broker resolves exact inputs.
            return {'tool':operation['kind']}
        # Deliberately a wiring receipt rather than a canned useful answer.
        return TurnResult(results=[TextResult(text=(
            f'Controlled transport: retained {len(humans)} human message(s). '
            'What outcome would you like to work toward? '
            'This verifies persistence and worker wiring, not model usefulness.'))])


class GeneralWorker:
    def __init__(self, service, *, transport):
        if not isinstance(transport,ControlledTransport) or transport.mode!='controlled':
            raise DomainError('unsupported_operation')
        self.service=service
        self.transport=transport

    def _terminal_readback(self,p,ws,run):
        if run.state=='ready':
            detail=self.service.get_conversation(p,ws,run.conversation_id)
            if not any(m.run_id==run.id and m.author_kind=='assistant' for m in detail.messages):
                raise DomainError('action_unresolved')
        return run

    def _recover_failure(self,p,ws,run_id,cap):
        """One failure publication attempt; durable authority wins over a lost ACK."""
        service=self.service
        try:
            observed=service.get_run(p,ws,run_id)
            if observed.state in ('ready','partial'):
                return self._terminal_readback(p,ws,observed)
            # Recheck context before attempting publication. fail_local_turn checks
            # the fenced capability again in its own terminal-write transaction.
            service.conversation_worker_context(cap)
            try:
                service.fail_local_turn(cap,
                    'Controlled worker failed; no result was fabricated. Submit a fresh turn to retry.')
            except DomainError:
                raise
            except Exception:
                # No retry: publication itself may have committed before losing ACK.
                pass
            observed=service.get_run(p,ws,run_id)
            if observed.state not in ('ready','partial'):
                raise DomainError('action_unresolved')
            return self._terminal_readback(p,ws,observed)
        except DomainError as exc:
            raise exc from None
        except Exception:
            # Recovery/readback unavailable: leave the existing lease/outbox alone.
            # Never leak transport, validation, or persistence exception contents.
            raise DomainError('action_unresolved') from None

    def work(self,p,ws,run_id):
        service=self.service
        run=service.get_run(p,ws,run_id)
        if run.profile not in (PROFILE,PRODUCT_PROFILE):
            raise DomainError('unsupported_operation')
        if run.state in ('ready','partial','cancelled'):
            # Exact durable readback; duplicate delivery must not invoke transport.
            return self._terminal_readback(p,ws,run)
        cap=service.claim_run(p,ws,run_id)
        try:
            context=service.conversation_worker_context(cap)
            result=self.transport.respond(context)
            if run.profile==PRODUCT_PROFILE:
                if not isinstance(result,dict) or set(result)!= {'tool'}:
                    return service.fail_local_turn(cap,'Controlled transport did not select the authorized local tool.')
                try:
                    service.execute_local_product(cap,result['tool'])
                except DomainError as exc:
                    if exc.code.value in ('version_conflict','unsupported_operation','budget_exhausted'):
                        return service.fail_local_turn(cap,exc.code.value+'; inspect saved state and submit a fresh turn.')
                    raise
            else:
                service.complete_conversation_turn(cap,result)
            observed=service.get_run(p,ws,run_id)
            if observed.state not in ('ready','partial'):
                raise DomainError('action_unresolved')
            return observed
        except DomainError:
            raise
        except Exception:
            # Only ordinary post-claim failures are isolated; process-control
            # BaseExceptions (SystemExit/KeyboardInterrupt) retain crash semantics.
            return self._recover_failure(p,ws,run_id,cap)

    def once(self, *, workspace=None):
        """One bounded batch from the existing durable outbox admission ledger."""
        with self.service.db.transaction() as c:
            rows=c.execute('''SELECT d.workspace_id,d.run_id,r.data FROM run_dispatches d
                JOIN runs r ON r.workspace_id=d.workspace_id AND r.id=d.run_id
                WHERE d.acknowledged_at IS NULL AND r.data->>'profile' IN (%s,%s)
                AND (%s::text IS NULL OR d.workspace_id=%s) ORDER BY d.cursor LIMIT 100''',
                (PROFILE,PRODUCT_PROFILE,workspace,workspace)).fetchall()
        counts={'completed':0,'deferred':0,'denied':0}
        for row in rows:
            try:
                self.work(Principal(row['data']['principal_id'],'worker'),row['workspace_id'],row['run_id'])
                counts['completed']+=1
            except DomainError as exc:
                counts['deferred' if exc.code.value=='action_unresolved' else 'denied']+=1
        return counts


def main():
    import argparse
    import os
    import json
    from .db import Database
    from .service import Service
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controlled',action='store_true')
    parser.add_argument('--live',action='store_true')
    parser.add_argument('--provider')
    parser.add_argument('--workspace')
    args=parser.parse_args()
    if not args.controlled or args.live or args.provider:
        parser.error('Only explicit --controlled is supported; live/provider execution is disabled.')
    if os.environ.get('LOCAL_TEST_MODE')!='true':
        parser.error('LOCAL_TEST_MODE=true required')
    db=Database(); db.check_runtime_role()
    print(json.dumps(GeneralWorker(Service(db),transport=ControlledTransport()).once(workspace=args.workspace)))


if __name__=='__main__':
    main()
