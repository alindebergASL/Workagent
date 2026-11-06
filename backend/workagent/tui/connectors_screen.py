"""Explicit synthetic consent beside existing work; composer is left mounted."""
from textual.screen import ModalScreen
from textual.binding import Binding
from textual.widgets import Static, Button, Select, Footer
from textual.containers import Horizontal, VerticalScroll
from rich.text import Text
from ..operator_journal import OperatorError
from ..connectors.models import ConnectorPage, ConnectorStatus
from .transport import ReadLane

class ConnectorsScreen(ModalScreen):
    BINDINGS=[Binding('escape','close','Back',priority=True)]
    CSS='''
    ConnectorsScreen { background: $surface; }
    .connector-row { height: auto; min-height: 3; }
    #connector-notice, #connector-details { height: auto; padding: 1; }
    '''
    def __init__(self,client,workspace,principal):
        super().__init__();self.client=client;self.workspace=workspace;self.principal=principal
        self.lane=ReadLane();self.busy=False;self.flow=None;self.selected=None;self.pending=None
    def compose(self):
        with VerticalScroll():
            yield Static('Synthetic library · local fixture only',markup=False)
            yield Static('Resource: synthetic/catalog · read only · processor: local-synthetic-mcp\nRetention: synthetic-only; no private account access',markup=False)
            with Horizontal(classes='connector-row'):
                yield Button('Back',id='connector-back');yield Button('Refresh',id='connector-refresh')
                yield Button('Connect synthetic',id='connector-connect')
            yield Select([],prompt='Synthetic connections',id='connector-list')
            yield Static('Choose a connection to inspect its current status.',id='connector-details',markup=False)
            with Horizontal(classes='connector-row'):
                yield Button('Inspect status',id='connector-status')
                yield Button('Confirm synthetic consent',id='connector-confirm',disabled=True)
                yield Button('Revoke',id='connector-revoke',variant='error')
                yield Button('Replay exact',id='connector-replay')
            yield Static('',id='connector-notice',markup=False)
        yield Footer()
    def on_mount(self):self.start('refresh')
    def on_unmount(self):self.lane.close()
    def action_close(self):self.dismiss()
    def notice(self,value):self.query_one('#connector-notice',Static).update(Text(value))
    def authorize(self):
        if self.client.identity(self.workspace)!=self.principal:raise OperatorError('Authenticated connector scope changed')
    def command(self,action,args):
        from uuid import uuid4
        self.authorize()
        if self.pending:raise OperatorError('A command is unresolved; inspect/replay its exact ID')
        record=self.client.prepare(self.workspace,action,args,command_id=str(uuid4()),principal_id=self.principal)
        self.client.journal.reserve(record);self.pending=record
        result=self.client.execute(record,lambda value:None);self.pending=None
        return result
    def start(self,action):
        if self.busy:return
        self.busy=True;self.run_worker(self.perform(action),exit_on_error=False)
    async def perform(self,action):
        try:
            await self.lane.read(self.authorize)
            if action=='refresh':
                self.selected=None;self.query_one('#connector-details',Static).update('')
                page=ConnectorPage.model_validate(await self.lane.read(self.client.run,self.workspace,'connectors',[]))
                self.query_one('#connector-list',Select).set_options([(Text('Synthetic library · '+x.state+' · '+x.connector_id[:8]),x.connector_id) for x in page.items])
                self.notice('Current synthetic connections loaded.')
            elif action=='connect':
                self.selected=None;self.query_one('#connector-details',Static).update('')
                out=await self.lane.read(self.command,'connector-connect',[]);self.flow=out['receipt']['flow_id']
                self.notice('Review the fixed synthetic account, resource, read effect and retention above, then confirm. Expires '+out['receipt']['expires_at'])
            elif action=='confirm':
                if not self.flow:raise OperatorError('Start synthetic consent first')
                out=await self.lane.read(self.command,'connector-confirm',[self.flow]);self.selected=out['readback'];self.flow=None
            elif action=='status':
                selected=self.query_one('#connector-list',Select).value
                if selected is Select.NULL:raise OperatorError('Choose a connection')
                self.selected=None
                self.selected=await self.lane.read(self.client.run,self.workspace,'connector-status',[selected])
            elif action=='revoke':
                if not self.selected:raise OperatorError('Inspect current status before revoking')
                out=await self.lane.read(self.command,'connector-revoke',[self.selected['connector_id'],str(self.selected['access_generation'])]);self.selected=out['readback']
            elif action=='replay':
                if not self.pending:raise OperatorError('No unresolved connector command')
                out=await self.lane.read(self.client.execute,self.pending,lambda value:None)
                if self.pending['action']=='connector-connect':self.flow=out['receipt']['flow_id']
                else:self.selected=out['readback']
                self.pending=None
            if self.selected:
                x=ConnectorStatus.model_validate(self.selected)
                self.query_one('#connector-details',Static).update(Text(f'Synthetic library: {x.state}\nGeneration {x.access_generation}; expires {x.expires_at}\nProvider revocation: {x.provider_revocation}\n{x.reason or ""}'))
                self.notice('Verified current status. Local revoke and provider outcome are separate.')
        except Exception:
            self.flow=None
            self.query_one('#connector-list',Select).set_options([])
            self.selected=None;self.query_one('#connector-details',Static).update('Status unavailable; refresh current access.')
            self.notice('Operation unavailable.'+(' Exact command retained: '+self.pending['command_id'] if self.pending else ''))
        finally:
            self.busy=False;self.query_one('#connector-confirm',Button).disabled=self.flow is None
    def on_button_pressed(self,event):
        action=event.button.id.removeprefix('connector-')
        if action=='back':self.action_close()
        else:self.start(action)
