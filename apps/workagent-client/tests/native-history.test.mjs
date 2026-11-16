// Real pinned commands/state/service with memory stores, plus scoped fetch doubles.
// No browser, socket, database or persisted-history claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UndoCommand, RedoCommand, IUniverInstanceService, CommandType, IUndoRedoService, IContextService, FOCUSING_SHEET, EDITOR_ACTIVATED, DOCS_NORMAL_EDITOR_UNIT_ID_KEY } from '@univerjs/core';
import { pair, edit, relay, UNIT } from '../../workagent-server/tests/native-history-sdk.test.mjs';
import { containNativeUndo, nativeHistory } from '../src/native-history.ts';

test('scoped native containment cancels actual sync/async Undo and Redo before local and server mutations; peer delivery still works',async()=>pair(async(s,a,b)=>{
  await relay(await edit(a,s,0,0,11),b);await relay(await edit(b,s,0,0,22),a);
  const before=a.undo.getUndoRedoStatus(UNIT),head=s.head,count=a.emitted.length;let notices=0;
  let guard=containNativeUndo(UNIT,a.commands,a.undo,()=>notices++);
  try {
    for(const id of [UndoCommand.id,RedoCommand.id]) {assert.equal(await a.commands.executeCommand(id),false);assert.equal(a.commands.syncExecuteCommand(id),false);}
    assert.equal(notices,2);assert.equal(a.cell(0,0),22);assert.equal(b.cell(0,0),22);assert.equal(s.head,head);assert.equal(a.emitted.length,count);assert.deepEqual(a.undo.getUndoRedoStatus(UNIT),before);
    await relay(await edit(b,s,0,1,33),a);assert.equal(a.cell(0,1),33);
    // Populate a real redo stack before testing both execution entrypoints.
    guard.dispose();guard={dispose(){}};await relay(await a.run(s,UndoCommand.id),b);
    const redoGuard=containNativeUndo(UNIT,a.commands,a.undo,()=>notices++);
    try{const redoCount=a.emitted.length,redoHead=s.head;assert.equal(await a.commands.executeCommand(RedoCommand.id),false);assert.equal(a.commands.syncExecuteCommand(RedoCommand.id),false);assert.equal(a.emitted.length,redoCount);assert.equal(s.head,redoHead);}finally{redoGuard.dispose();}
    // Separate ordinary/uncontained instance retains command behavior.
    assert.equal(await b.commands.executeCommand(UndoCommand.id),true);assert.equal(b.cell(0,1),null);
  } finally {guard.dispose();}
}));
test('embedded document focus uses its own actual Undo/Redo command stack; guard disposal does not clear stacks',async()=>pair(async(s,a)=>{
  await edit(a,s,0,0,11);const injector=a.univer.__getInjector(),instances=injector.get(IUniverInstanceService);
  const guard=containNativeUndo(UNIT,a.commands,a.undo,()=>assert.fail('text undo blocked'));
  // Inert text mutation handler, real focused document, core stack and commands.
  const doc=a.univer.createUnit(1,{id:DOCS_NORMAL_EDITOR_UNIT_ID_KEY,body:{dataStream:'draft\r\n'},documentStyle:{}});let text='draft';
  a.commands.registerCommand({id:'proof.text',type:CommandType.MUTATION,handler:(_accessor,p)=>{text=p.text;return true;}});
  instances.focusUnit(UNIT);injector.get(IContextService).setContextValue(FOCUSING_SHEET,true);injector.get(IContextService).setContextValue(EDITOR_ACTIVATED,true);injector.get(IUndoRedoService).pushUndoRedo({unitID:doc.getUnitId(),undoMutations:[{id:'proof.text',params:{text:'dra'}}],redoMutations:[{id:'proof.text',params:{text:'draft'}}]});
  assert.equal(await a.commands.executeCommand(UndoCommand.id),true);assert.equal(text,'dra');assert.equal(a.commands.syncExecuteCommand(RedoCommand.id),true);assert.equal(text,'draft');assert.equal(a.cell(0,0),11);
  guard.dispose();injector.get(IContextService).setContextValue(EDITOR_ACTIVATED,false);instances.focusUnit(UNIT);assert.equal(await a.commands.executeCommand(UndoCommand.id),true);assert.equal(a.cell(0,0),null);
}));
test('history fetches only GET, cancels obsolete preview/epoch and clears private output on refusal/disposal',async()=>{
  const calls=[],views=[];let finish;
  const history=nativeHistory({unitID:'A',binding:'synthetic-binding',access:{revision:4}},v=>views.push(v),async(url,options)=>{calls.push({url,options});return new Promise(resolve=>{finish=resolve;});});
  const old=history.read('?revision=2'),oldFinish=finish;const fresh=history.read();assert.equal(calls[0].options.signal.aborted,true);
  finish({ok:true,json:async()=>({head:3,entries:[{revision:3,author:'peer',operations:['edit'],operationCount:1}]})});await fresh;
  oldFinish({ok:true,json:async()=>({revision:2,sheets:[{name:'stale'}]})});await old;assert.equal(views.at(-1).preview,undefined);
  const denied=history.read();finish({ok:false,status:403});await denied;assert.deepEqual(views.at(-1).entries,[]);assert.match(views.at(-1).message,/access changed/);
  const late=history.read('?revision=1');history.dispose();finish({ok:true,json:async()=>({revision:1,sheets:[]})});await late;assert.equal(views.at(-1).preview,undefined);
  assert.ok(calls.every(c=>!c.options.method&&!c.options.body&&c.url.startsWith('/api/work/A/native-history/4')));
});
