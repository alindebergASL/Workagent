"""Thin prompt CLI for the persistent B1 domain, never a direct provider client."""
import argparse
import json
import sys


def main(argv=None):
    argv=list(sys.argv[1:] if argv is None else argv)
    if '--help' not in argv and (not any(x in argv for x in ('--controlled','--general-responses')) or '--live' in argv or
                               any(a=='--provider' or a.startswith('--provider=') for a in argv)):
        print('Use explicit --controlled or --general-responses (admission only); no direct provider execution.',file=sys.stderr)
        raise SystemExit(2)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--general-responses',action='store_true',help='Submit to an existing scoped general grant; dispatcher owns inference')
    parser.add_argument('--controlled',action='store_true',help='Explicit no-inference transport (usefulness unverified)')
    parser.add_argument('--live',action='store_true',help='Unsupported; fails before environment/DB access')
    parser.add_argument('--provider',help='Unsupported; no provider or credential access')
    parser.add_argument('--workspace',help='Existing authorized workspace; auto-selects when exactly one is available')
    parser.add_argument('--command-id',help='Stable mutation ID; use same expected version when replaying continue/cancel/delegate')
    parser.add_argument('--expected-version',type=int,help='Optional explicit CAS version (otherwise read current)')
    sub=parser.add_subparsers(dest='operation',required=True)
    prompt=sub.add_parser('prompt'); prompt.add_argument('text')
    follow=sub.add_parser('continue'); follow.add_argument('conversation_id'); follow.add_argument('text')
    for turn in (prompt,follow):
        turn.add_argument('--operator',choices=['reconcile_csv','run_wasm'])
        turn.add_argument('--attach',help='Explicit bounded UTF-8 local input; bytes go into the same admitted message')
        turn.add_argument('--artifact-id')
        turn.add_argument('--base-revision-id')
        turn.add_argument('--target-artifact'); turn.add_argument('--target-revision'); turn.add_argument('--target-body-hash')
        turn.add_argument('--rounding',choices=['ROUND_HALF_UP','ROUND_HALF_EVEN'],default='ROUND_HALF_UP')
        turn.add_argument('--entrypoint',default='total')
        turn.add_argument('--arg',action='append',type=int,default=[])
        turn.add_argument('--field',action='append',default=[],help='Input form name:label, one per argument')
    sub.add_parser('create')
    inspect=sub.add_parser('inspect'); inspect.add_argument('conversation_id')
    cancel=sub.add_parser('cancel'); cancel.add_argument('conversation_id')
    delegate=sub.add_parser('delegate'); delegate.add_argument('conversation_id'); delegate.add_argument('goal')
    delegate.add_argument('--criterion',action='append',required=True)
    args=parser.parse_args(argv)
    # Fail closed BEFORE environment, DB, worker imports or any credential path.
    if args.controlled==args.general_responses or args.live or args.provider:
        parser.error('Select exactly one explicit mode; no direct provider execution.')
    if args.general_responses and getattr(args,'operator',None):
        parser.error('General mode uses model selection; do not supply --operator')

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
        if args.operation in ('prompt','create'):
            # Separate durable command IDs allow restart between create and POST.
            create=CreateConversation(schema_version='workagent/v1',request_id=new_id(),
                command_id=str(uuid5(NAMESPACE_URL,'workagent/conversation/'+command_id)))
            conversation=service.create_conversation(principal,workspace,create)
            cid=conversation.id
        else:
            cid=args.conversation_id
            conversation=service.get_conversation(principal,workspace,cid).conversation
        expected=args.expected_version if args.expected_version is not None else conversation.work_version
        if args.operation=='create':
            print(conversation.model_dump_json()); return 0
        if args.operation in ('prompt','continue'):
            if args.general_responses and service.get_conversation(principal,workspace,cid).conversation.model_activation!='active':
                raise DomainError('unsupported_operation')
            if args.controlled and service.get_conversation(principal,workspace,cid).conversation.model_activation!='disabled':
                raise DomainError('unsupported_operation')
            operation=None
            from .message_models import AttachmentInput,ExactTarget
            from pathlib import Path
            attachments=[]
            for name in ([args.attach] if args.general_responses and args.attach else []):
                path=Path(name)
                with path.open('rb') as stream: raw=stream.read(200001)
                if len(raw)>200000: raise DomainError('budget_exhausted')
                attachments.append(AttachmentInput(filename=path.name,mime_type='text/csv' if path.suffix=='.csv' else 'text/plain',content=raw.decode('utf-8')))
            target=None
            if any((args.target_artifact,args.target_revision,args.target_body_hash)):
                target=ExactTarget(artifact_id=args.target_artifact,revision_id=args.target_revision,body_hash=args.target_body_hash)
            if args.operator:
                content=None
                if args.attach:
                    from pathlib import Path
                    with Path(args.attach).open('rb') as attachment:
                        raw=attachment.read(200001)
                    bound=200000 if args.operator=='reconcile_csv' else 16000
                    if len(raw)>bound:
                        parser.error('Attachment exceeds explicit operator byte bound')
                    content=raw.decode('utf-8')
                operation={'kind':args.operator,'artifact_id':args.artifact_id,'base_revision_id':args.base_revision_id}
                if args.operator=='reconcile_csv':
                    operation.update(input_csv=content,rounding=args.rounding)
                else:
                    fields=[]
                    for field in args.field:
                        name,sep,label=field.partition(':')
                        if not sep:
                            parser.error('--field requires name:label')
                        fields.append({'name':name,'label':label})
                    operation.update(code=content,entrypoint=args.entrypoint,arguments=args.arg,input_form=fields)
            elif (args.attach and not args.general_responses) or args.artifact_id or args.base_revision_id or args.arg or args.field:
                parser.error('Attachments/inputs require explicit --operator')
            queued=service.post_message(principal,workspace,cid,command(PostMessage,expected_work_version=expected,text=args.text,operation=operation,attachments=attachments,target=target))
            if args.controlled:
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
    except (ValidationError,UnicodeError,OSError):
        parser.error('Invalid command or unreadable bounded UTF-8 attachment; inspect --help and contract bounds')
    return 0


if __name__=='__main__':
    sys.exit(main())
