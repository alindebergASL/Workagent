"""Thin prompt CLI for the persistent B1 domain, never a direct provider client."""
import argparse
import json
import sys


def main(argv=None):
    argv=list(sys.argv[1:] if argv is None else argv)
    if '--help' not in argv and ('--controlled' not in argv or '--live' in argv or
                               any(a=='--provider' or a.startswith('--provider=') for a in argv)):
        print('Only explicit --controlled is supported; live/provider execution is disabled.',file=sys.stderr)
        raise SystemExit(2)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controlled',action='store_true',help='Explicit no-inference transport (usefulness unverified)')
    parser.add_argument('--live',action='store_true',help='Unsupported; fails before environment/DB access')
    parser.add_argument('--provider',help='Unsupported; no provider or credential access')
    parser.add_argument('--workspace',help='Existing authorized workspace; auto-selects when exactly one is available')
    parser.add_argument('--command-id',help='Stable mutation ID; use same expected version when replaying continue/cancel/delegate')
    parser.add_argument('--expected-version',type=int,help='Optional explicit CAS version (otherwise read current)')
    sub=parser.add_subparsers(dest='operation',required=True)
    prompt=sub.add_parser('prompt'); prompt.add_argument('text')
    follow=sub.add_parser('continue'); follow.add_argument('conversation_id'); follow.add_argument('text')
    inspect=sub.add_parser('inspect'); inspect.add_argument('conversation_id')
    cancel=sub.add_parser('cancel'); cancel.add_argument('conversation_id')
    delegate=sub.add_parser('delegate'); delegate.add_argument('conversation_id'); delegate.add_argument('goal')
    delegate.add_argument('--criterion',action='append',required=True)
    args=parser.parse_args(argv)
    # Fail closed BEFORE environment, DB, worker imports or any credential path.
    if not args.controlled or args.live or args.provider:
        parser.error('Only explicit --controlled is supported; live/provider execution is disabled.')

    import os
    from uuid import uuid5, NAMESPACE_URL
    from pydantic import ValidationError
    from .db import Database
    from .errors import DomainError
    from .models import (CreateConversation, PostMessage, CancelConversation,
                         DelegateConversation, new_id)
    from .service import Service, Principal
    from .general_worker import GeneralWorker, ControlledTransport
    if os.environ.get('LOCAL_TEST_MODE')!='true':
        parser.error('LOCAL_TEST_MODE=true required')
    db=Database(); db.check_runtime_role()
    service=Service(db)
    principal=Principal(os.environ.get('LOCAL_PRINCIPAL_ID','local-human'))
    workspace=args.workspace
    if not workspace:
        available=service.list_workspaces(principal,limit=2)
        if len(available.items)!=1 or available.next_cursor:
            parser.error('Use --workspace to choose an existing authorized workspace')
        workspace=available.items[0].id
    command_id=args.command_id or new_id()
    def command(cls,**fields):
        return cls(schema_version='workagent/v1',request_id=new_id(),command_id=command_id,**fields)
    try:
        if args.operation=='prompt':
            # Separate durable command IDs allow restart between create and POST.
            create=CreateConversation(schema_version='workagent/v1',request_id=new_id(),
                command_id=str(uuid5(NAMESPACE_URL,'workagent/conversation/'+command_id)))
            conversation=service.create_conversation(principal,workspace,create)
            cid=conversation.id
        else:
            cid=args.conversation_id
            conversation=service.get_conversation(principal,workspace,cid).conversation
        expected=args.expected_version if args.expected_version is not None else conversation.work_version
        if args.operation in ('prompt','continue'):
            queued=service.post_message(principal,workspace,cid,command(PostMessage,expected_work_version=expected,text=args.text))
            GeneralWorker(service,transport=ControlledTransport()).work(principal,workspace,queued.run.id)
            result=service.get_conversation(principal,workspace,cid).model_dump(mode='json')
            result['command_id']=command_id
            result['submitted_work_version']=expected
        elif args.operation=='inspect':
            result=service.get_conversation(principal,workspace,cid).model_dump(mode='json')
        elif args.operation=='cancel':
            service.cancel_conversation(principal,workspace,cid,command(CancelConversation,expected_work_version=expected))
            result=service.get_conversation(principal,workspace,cid).conversation.model_dump(mode='json')
        else:
            assignment=service.delegate_conversation(principal,workspace,cid,command(DelegateConversation,
                expected_work_version=expected,goal=args.goal,completion_criteria=args.criterion))
            result=service.get_assignment(principal,workspace,assignment.id).model_dump(mode='json')
        print(json.dumps(result,ensure_ascii=False))
    except DomainError as exc:
        print(exc.envelope('prompt-cli').model_dump_json(),file=sys.stderr)
        return 1
    except ValidationError:
        parser.error('Invalid command fields; inspect --help and contract bounds')
    return 0


if __name__=='__main__':
    sys.exit(main())
