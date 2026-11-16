// Actual pinned codec, RefRangeService and viewport operation; inert session and
// command delivery only. No transport, canvas geometry or browser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorSubject, Subject } from 'rxjs';
import { CommandType, IUniverInstanceService } from '@univerjs/core';
import { serializeRangeWithSheet } from '@univerjs/engine-formula';
import { RefRangeService, InsertRowMutation, RemoveRowMutation } from '@univerjs/sheets';
import { ScrollToRangeOperation, SheetsScrollRenderController } from '@univerjs/sheets-ui';
import { IRenderManagerService } from '@univerjs/engine-render';
import { SessionStatus } from '@univerjs-pro/collaboration-client';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { nativeFollow } from '../src/native-follow.ts';
const range={startRow:8,endRow:8,startColumn:7,endColumn:7};
function fixture(){
  const events=new Subject(),status=new BehaviorSubject(SessionStatus.ONLINE),calls=[],states=[],listeners=new Set(),callbacks=[];
  let busy=false,active='s';
  const commands={onCommandExecuted(fn){listeners.add(fn);return {dispose(){listeners.delete(fn);}};},syncExecuteCommand(id,params){assert.equal(id,ScrollToRangeOperation.id);calls.push(params);return true;}};
  const refs=new RefRangeService(commands,{interceptCommand:()=>({dispose(){}})},{},{ });
  const session={event$:events,sessionStatus$:status,get sessionStatus(){return status.value;},getMemberID:()=> 'self'};
  const book={getSheetBySheetId:id=>['s','other'].includes(id)?{getRowCount:()=>100,getColumnCount:()=>30}:null,getActiveSheet:()=>({getSheetId:()=>active})};
  const follow=nativeFollow('A',session,()=>book,{watchRange(...args){callbacks.push(args[3]);return refs.watchRange(...args);}},commands,()=>busy,s=>states.push(s));
  const members=[{memberID:'self',userID:'owner',name:'Me',self:true},{memberID:'peer',userID:'peer',name:'Peer',self:false},{memberID:'tab',userID:'owner',name:'Me too',self:false}];
  follow.presence({online:true,members});
  const cursor=(overrides={})=>events.next({eventID:CollaborationEvent.UPDATE_CURSOR,data:{unitID:'A',memberID:'peer',userID:'peer',selection:serializeRangeWithSheet('s',range),...overrides}});
  return {follow,events,status,calls,states,members,listeners,callbacks,cursor,commands,refs,setBusy:v=>busy=v,setActive:v=>active=v,
    mutate(id,params){for(const fn of [...listeners])fn({id,type:CommandType.MUTATION,params});},
    dispose(){follow.dispose();refs.dispose();events.complete();status.complete();}};
}
test('explicit follow uses real codec and only viewport operation; self/foreign members ignored; same-account tab supported',()=>{
  const f=fixture();try{
    f.cursor();assert.equal(f.calls.length,0);f.follow.follow('self');f.cursor();assert.equal(f.calls.length,0);
    f.follow.follow('peer');f.cursor({unitID:'B'});f.cursor({memberID:'stranger'});f.cursor({userID:'wrong'});assert.equal(f.calls.length,0);
    f.cursor();assert.equal(f.calls.length,1);assert.equal(f.calls[0].range.startRow,8);assert.equal(f.calls[0].unitId,'A');
    f.follow.stop();f.cursor();assert.equal(f.calls.length,1);assert.equal(f.events.observers.length,0);assert.equal(f.listeners.size,0);
    f.follow.follow('tab');f.cursor({memberID:'tab',userID:'owner'});assert.equal(f.calls.length,2);
  }finally{f.dispose();}
});
test('disconnect, departure, disposal and local input cancel intent without replay on reconnect',()=>{
  const f=fixture();try{
    f.follow.follow('peer');f.cursor();f.status.next(SessionStatus.OFFLINE);f.status.next(SessionStatus.ONLINE);f.cursor();assert.equal(f.calls.length,1);
    f.follow.follow('peer');f.follow.presence({online:true,members:f.members.filter(m=>m.memberID!=='peer')});f.cursor();assert.equal(f.events.observers.length,0);
    f.follow.presence({online:true,members:f.members});f.setBusy(true);f.follow.follow('peer');f.cursor();assert.match(f.states.at(-1).message,/Paused/);
    f.setBusy(false);f.cursor();assert.equal(f.calls.length,1);f.follow.follow('peer');f.follow.localInteraction();f.cursor();assert.equal(f.calls.length,1);
    f.follow.follow('peer');f.setBusy(true);f.cursor();assert.match(f.states.at(-1).message,/Paused/);assert.equal(f.calls.length,1);
    f.follow.dispose();f.setBusy(false);f.follow.follow('peer');f.cursor();assert.equal(f.calls.length,1);assert.equal(f.status.observers.length,0);
  }finally{f.dispose();}
});
test('malformed/no-position cursor and wrong worksheet pause safely without scrolling or changing membership',()=>{
  const f=fixture();try{
    for(const selection of [undefined,null,{},[], '', 'bad', "'missing'!A1", "'s'!A99999", "'s'!A:A", 'x'.repeat(4097)]){
      f.follow.follow('peer');f.cursor({selection});assert.equal(f.calls.length,0);assert.match(f.states.at(-1).message,/Paused/);
    }
    f.follow.follow('peer');f.events.next(null);f.events.next({eventID:CollaborationEvent.UPDATE_CURSOR,data:null});
    f.cursor({selection:serializeRangeWithSheet('other',range)});assert.match(f.states.at(-1).message,/another worksheet/);assert.equal(f.calls.length,0);
    assert.equal(f.members.length,3);
  }finally{f.dispose();}
});
test('actual SDK range transformation H9 to H10, foreign isolation and deletion invalidate following without guessed scroll',()=>{
  const f=fixture();try{
    const transformed=[];const watch=f.refs.watchRange('A','s',range,(before,after)=>transformed.push({before,after}));
    const insert={unitId:'A',subUnitId:'s',range:{startRow:0,endRow:0,startColumn:0,endColumn:29}};
    f.follow.follow('peer');f.cursor();f.mutate(InsertRowMutation.id,{...insert,unitId:'B'});f.mutate(InsertRowMutation.id,{...insert,subUnitId:'other'});assert.equal(transformed.length,0);
    f.mutate(InsertRowMutation.id,insert);assert.equal(transformed[0].after.startRow,9);assert.match(f.states.at(-1).message,/structure changed/);assert.equal(f.calls.length,1);watch.dispose();
    f.follow.follow('peer');f.cursor();f.mutate(RemoveRowMutation.id,{unitId:'A',subUnitId:'s',range:{startRow:8,endRow:8,startColumn:0,endColumn:29}});assert.match(f.states.at(-1).message,/removed/);assert.equal(f.listeners.size,0);
  }finally{f.dispose();}
});
test('actual viewport operation delegates to native scroll controller, without selection/content commands',()=>{
  const calls=[];
  const accessor={get(token){if(token===IUniverInstanceService)return {};assert.equal(token,IRenderManagerService);return {getRenderUnitById(id){assert.equal(id,'A');return {with(token){assert.equal(token,SheetsScrollRenderController);return {scrollToRange(...args){calls.push(args);return true;}};}};}};}};
  assert.equal(ScrollToRangeOperation.handler(accessor,{unitId:'A',range}),true);assert.deepEqual(calls,[[range,undefined,undefined]]);
});
test('replaced or disposed cursor watchers cannot pause a newer member position or session intent',()=>{
  const f=fixture();try{
    f.follow.follow('peer');f.cursor();const old=f.callbacks[0];f.cursor();const before=f.states.length;
    old(range,null);assert.equal(f.states.length,before);assert.match(f.states.at(-1).message,/view only/);
    f.follow.stop();const stopped=f.states.length;f.callbacks.at(-1)(range,null);assert.equal(f.states.length,stopped);
    f.follow.follow('tab');f.cursor({memberID:'tab',userID:'owner'});old(range,null);assert.equal(f.states.at(-1).memberID,'tab');
  }finally{f.dispose();}
});

test('public command DI tracks paste through completion, false, cancellation and errors; overlapping input remains busy',async()=>{
  const {Univer,LocaleType,ICommandService,CanceledError}=await import('@univerjs/core');
  const {PasteCommand}=await import('@univerjs/ui');
  const {SheetPasteShortKeyCommand,ISheetClipboardService}=await import('@univerjs/sheets-ui');
  const {nativePasteActivity}=await import('../src/native-follow.ts');
  let starts=0;
  const activity=nativePasteActivity(()=>starts++),univer=new Univer({locale:LocaleType.EN_US,locales:{enUS:{}},override:activity.override});
  const service=univer.__getInjector().get(ICommandService);
  let resolve, outcome, reject, invoke=()=>new Promise((a,b)=>{resolve=a;reject=b;});
  // Real pinned CommandService/Injector lifecycle; inert paste handler, no clipboard or content writes.
  for(const id of [PasteCommand.id,SheetPasteShortKeyCommand.id])service.registerCommand({id,type:CommandType.COMMAND,handler:()=>invoke()});
  service.registerCommand({id:'unrelated',type:CommandType.COMMAND,handler:()=>true});
  try{
    assert.equal(await service.executeCommand('unrelated'),true);assert.equal(starts,0);
    for(outcome of [true,false]){const pending=service.executeCommand(PasteCommand.id);assert.equal(activity.busy(),true);resolve(outcome);assert.equal(await pending,outcome);assert.equal(activity.busy(),false);}
    const error=new Error('paste failed'),failed=service.executeCommand(SheetPasteShortKeyCommand.id);reject(error);await assert.rejects(failed,e=>e===error);assert.equal(activity.busy(),false);
    const cancelled=service.beforeCommandExecuted(info=>{if(info.id===SheetPasteShortKeyCommand.id)throw new CanceledError();});
    assert.equal(await service.executeCommand(SheetPasteShortKeyCommand.id),false);assert.equal(activity.busy(),false);cancelled.dispose();
    const first=service.executeCommand(PasteCommand.id),finishFirst=resolve;
    const second=service.executeCommand(SheetPasteShortKeyCommand.id),finishSecond=resolve;
    finishFirst(false);await first;assert.equal(activity.busy(),true);finishSecond(true);await second;assert.equal(activity.busy(),false);
    invoke=()=>{throw error;};await assert.rejects(service.executeCommand(PasteCommand.id),e=>e===error);assert.equal(activity.busy(),false);
    // The actual exported sheet command also refuses a missing paste target.
    service.unregisterCommand(SheetPasteShortKeyCommand.id);
    univer.__getInjector().add([ISheetClipboardService,{useValue:{capturePasteTarget:()=>null}}]);
    service.registerCommand(SheetPasteShortKeyCommand);
    assert.equal(await service.executeCommand(SheetPasteShortKeyCommand.id,{}),false);assert.equal(activity.busy(),false);
  }finally{univer.dispose();}
});
