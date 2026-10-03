"""The B1 product worker, used unchanged by CLI and HTTP-admitted turns.

Controlled transport is an explicit test input, not a second answer-producing
CLI or an inference implementation. No provider modules, keys or fallback.
"""
from copy import deepcopy

from .conversations import PROFILE
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

    def work(self,p,ws,run_id):
        service=self.service
        run=service.get_run(p,ws,run_id)
        if run.profile!=PROFILE:
            raise DomainError('unsupported_operation')
        if run.state in ('ready','cancelled'):
            # Exact durable readback; duplicate delivery must not invoke transport.
            if run.state=='ready':
                detail=service.get_conversation(p,ws,run.conversation_id)
                if not any(m.run_id==run.id and m.author_kind=='assistant' for m in detail.messages):
                    raise DomainError('action_unresolved')
            return run
        cap=service.claim_run(p,ws,run_id)
        context=service.conversation_worker_context(cap)
        result=self.transport.respond(context)
        service.complete_conversation_turn(cap,result)
        observed=service.get_run(p,ws,run_id)
        if observed.state!='ready':
            raise DomainError('action_unresolved')
        return observed

    def once(self, *, workspace=None):
        """One bounded batch from the existing durable outbox admission ledger."""
        with self.service.db.transaction() as c:
            rows=c.execute('''SELECT d.workspace_id,d.run_id,r.data FROM run_dispatches d
                JOIN runs r ON r.workspace_id=d.workspace_id AND r.id=d.run_id
                WHERE d.acknowledged_at IS NULL AND r.data->>'profile'=%s
                AND (%s::text IS NULL OR d.workspace_id=%s) ORDER BY d.cursor LIMIT 100''',
                (PROFILE,workspace,workspace)).fetchall()
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
