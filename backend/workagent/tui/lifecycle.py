"""Additive format-5 lifecycle commands; formats 1–4 stay frozen.

Preparation is pure. Assignment controls use the displayed assignment CAS, never
its conversation's version. A historical receipt is not present lifecycle state.
"""
from ..operator_journal import OperatorError

ACTIONS = {'responsibility-pause', 'responsibility-resume', 'responsibility-takeover', 'conversation-cancel'}


def read_omitted_lifecycles(client, workspace, conversation, context, read):
    """Supplement bounded work context with exact authorized GETs, never guessed state.

    At most eight projected responsibilities can need detail. Match version and
    lifecycle hash as well as identity so a concurrent change cannot authorize a
    control against a different observation. A failed read leaves omission intact.
    """
    import copy
    from ..responsibility_models import ResponsibilityDetail
    from ..work_area_models import WorkAreaContext
    from ..service import digest
    if not context or context.get('conversation_id') != conversation:
        return context
    result = WorkAreaContext.model_validate(copy.deepcopy(context)).model_dump(mode='json')
    for item in result.get('responsibilities', [])[:8]:
        if not item.get('lifecycle_omitted'):
            continue
        def fetch(item=item):
            detail = ResponsibilityDetail.model_validate(client.request(
                '/'+workspace+'/assignments/'+item['assignment_id']+'/responsibility'))
            a = detail.assignment
            if (a.id != item['assignment_id'] or a.workspace_id != workspace
                    or a.conversation_id != conversation or a.owner_id != item['owner_id']
                    or a.work_version != item['work_version']
                    or digest(detail.lifecycle) != item['lifecycle_sha256']):
                raise OperatorError('Responsibility detail changed; Refresh to verify current state')
            return detail.lifecycle.model_dump(mode='json')
        life = read('responsibility:'+item['assignment_id'], fetch, None)
        if life is not None:
            item.update(lifecycle=life, lifecycle_omitted=False)
            result['omissions']['lifecycles'] -= 1
    result['truncated'] = any(result['omissions'][key] for key in
        ('artifacts', 'proposals', 'responsibilities', 'saved_bodies', 'lifecycles'))
    return result


def build(client, ws, action, args, *, command_id, principal_id, expected_work_version):
    from ..operator_client import identifier
    from ..models import CancelConversation
    from ..responsibility_models import ControlResponsibility
    if action not in ACTIONS or not isinstance(args, (list, tuple)) or not all(isinstance(x, str) for x in args):
        raise OperatorError('Invalid lifecycle command')
    cid=identifier(command_id);ws=identifier(ws);principal=identifier(principal_id)
    try:
        if len(args)!=(1 if action=='conversation-cancel' else 2):raise ValueError()
        conversation=identifier(args[0])
        body={'schema_version':'workagent/v1','request_id':cid,'command_id':cid,
              'expected_work_version':expected_work_version}
        if action=='conversation-cancel':
            path='/conversations/'+conversation+'/cancel';model=CancelConversation
        else:
            path='/assignments/'+identifier(args[1])+'/responsibility/control';model=ControlResponsibility
            body['operation']=action.removeprefix('responsibility-')
        model.model_validate(body)
        client.wire_body(body)
    except (ValueError, TypeError, KeyError):
        raise OperatorError('Invalid exact lifecycle command; Refresh and inspect the displayed version') from None
    return {'format':5,'command_id':cid,'base':client.base,'workspace':ws,'principal_id':principal,
            'action':action,'args':list(args),'path':'/'+ws+path,'body':body}


def validate(client, record, ws, principal):
    try:
        rebuilt=build(client,ws,record['action'],record['args'],command_id=record['command_id'],
                      principal_id=principal,expected_work_version=record['body']['expected_work_version'])
        if type(record['format']) is not int or record!=rebuilt:raise OperatorError('Exact lifecycle command scope/body mismatch')
    except (KeyError, TypeError, ValueError):
        raise OperatorError('Corrupt format-5 command; replay refused') from None


def readback(client, record, saved):
    from ..models import Conversation
    from ..responsibility_models import ResponsibilityDetail
    conversation=record['args'][0];workspace=record['workspace'];principal=record['principal_id']
    if record['action']=='conversation-cancel':
        receipt=Conversation.model_validate(saved)
        if (receipt.id!=conversation or receipt.workspace_id!=workspace
                or receipt.state!='cancelled' or receipt.work_version!=record['body']['expected_work_version']+1):
            raise OperatorError('Conversation cancellation receipt mismatch')
        observed=client.request('/'+workspace+'/conversations/'+conversation)
        current=Conversation.model_validate(observed['conversation'])
        if (current.id!=receipt.id or current.workspace_id!=workspace or current.owner_id!=receipt.owner_id
                or current.work_version<receipt.work_version):
            raise OperatorError('Conversation cancellation readback mismatch')
        return observed
    receipt=ResponsibilityDetail.model_validate(saved);a=receipt.assignment
    operation=record['body']['operation']
    expected={'pause':{'paused'},'takeover':{'taken_over'},'resume':{'active','waiting_person','waiting_event','blocked'}}[operation]
    if (a.id!=record['args'][1] or a.conversation_id!=conversation or a.workspace_id!=workspace or a.owner_id!=principal
            or a.work_version!=record['body']['expected_work_version']+1 or receipt.lifecycle.state not in expected):
        raise OperatorError('Responsibility control receipt mismatch')
    observed=client.request('/'+workspace+'/assignments/'+a.id+'/responsibility')
    current=ResponsibilityDetail.model_validate(observed).assignment
    if (current.id!=a.id or current.conversation_id!=conversation or current.workspace_id!=workspace
            or current.owner_id!=principal or current.work_version<a.work_version):
        raise OperatorError('Responsibility control readback mismatch')
    return observed
