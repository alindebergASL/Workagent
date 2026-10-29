"""Synthetic connector commands share the existing exact replay journal."""
from uuid import UUID
from ..operator_client import identifier
from ..operator_journal import OperatorError
from ..connectors.models import StartAuthorization, CompleteAuthorization, RevokeConnector, AuthorizationFlow, ConnectorStatus
ACTIONS=('connector-connect','connector-confirm','connector-revoke')
def build(client,ws,action,args,*,command_id,principal_id):
    ws=identifier(ws);principal_id=identifier(principal_id)
    try:
        key=str(UUID(command_id))
        if key!=command_id:raise ValueError()
        root='/'+ws+'/connectors'
        if action=='connector-connect' and not args:
            path=root+'/authorization-flows';body=StartAuthorization(resource='synthetic/catalog',idempotency_key=key)
        elif action=='connector-confirm' and len(args)==1:
            fid=str(UUID(args[0]));path=root+'/authorization-flows/'+fid+'/complete';body=CompleteAuthorization(idempotency_key=key)
        elif action=='connector-revoke' and len(args)==2:
            cid=str(UUID(args[0]));path=root+'/'+cid+'/revoke';body=RevokeConnector(idempotency_key=key,expected_generation=int(args[1]))
        else:raise ValueError()
    except (ValueError,TypeError):raise OperatorError('Invalid explicit synthetic connector command') from None
    return dict(format=6,command_id=key,base=client.base,workspace=ws,principal_id=principal_id,
                action=action,args=list(args),path=path,body=body.model_dump(mode='json'))
def validate(client,record,ws,principal):
    principal=principal or client.identity(ws)
    if client.identity(ws)!=principal or build(client,ws,record['action'],record['args'],command_id=record['command_id'],principal_id=principal)!=record:
        raise OperatorError('Connector command scope changed')
def readback(client,record,saved):
    root='/'+record['workspace']+'/connectors/'
    if record['action']=='connector-connect':
        flow=AuthorizationFlow.model_validate(saved)
        # Flow ID is also the synthetic connector ID, with no secret in either.
        status=ConnectorStatus.model_validate(client.request(root+flow.flow_id+'/status'))
        return status.model_dump(mode='json')
    status=ConnectorStatus.model_validate(saved)
    if status.connector_id!=record['args'][0]:raise OperatorError('Connector receipt scope mismatch')
    current=ConnectorStatus.model_validate(client.request(root+status.connector_id+'/status'))
    if current.access_generation<status.access_generation:raise OperatorError('Connector generation moved backwards')
    return current.model_dump(mode='json')
