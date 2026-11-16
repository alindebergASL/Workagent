// Real pinned AddCommentCommand/model/data source, inert HTTP responses. No native
// transport or persistence proof; authoritative publication is explicitly simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IThreadCommentDataSourceService, AddCommentMutation } from '@univerjs/thread-comment';
import { nativeComments } from '../src/native-comments.ts';
import { fixture as sdk } from '../../workagent-server/tests/native-comments-sdk.test.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture(role='owner') {
  const local=sdk(), source=local.univer.__getInjector().get(IThreadCommentDataSourceService), states=[],posts=[],signals=[];
  let published=[],refusal=false,busy=false,gate,receipt,actionReceipts=[],lostAction=false,actionGate,lostAbandon=false;const saved=new Map(),disk={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),key:i=>[...saved.keys()][i]??null,get length(){return saved.size;}};
  const session={unitID:local.unitID,principal:'owner',name:'Owner',binding:'synthetic',owner:role==='owner',access:{role,revision:1}};
  const request=async(url,options)=>{assert.match(url,/native-comments\/1(?:\?|\/actions|$)/);signals.push(options.signal);
    if(options.method==='POST'){
      const body=JSON.parse(options.body);posts.push(body);if(url.endsWith('/abandon')){const id=url.split('/').at(-2),r=actionReceipts.find(a=>a.id===id);Object.assign(r,{phase:'abandoned',status:'abandoned'});if(lostAbandon)throw Error('lost abandonment response');return {ok:true,json:async()=>structuredClone(r)};}if(url.endsWith('/actions')){if(actionGate)await actionGate.promise;if(lostAction)throw Error('lost preparation response');return {ok:true,json:async()=>({...body,status:'unknown',head:3})};}if(refusal)return {ok:false,status:409};
      const canonical={id:body.id,threadId:body.parentId??body.id,unitId:local.unitID,subUnitId:'sheet-1',personId:'owner',authorName:'Owner',dT:'2026-11-16T00:00:00.000Z',ref:body.ref,text:{dataStream:body.body+'\r\n',paragraphs:[{startIndex:body.body.length}]},...(body.parentId?{parentId:body.parentId}:{})};
      return {ok:true,json:async()=>canonical};
    }
    if(gate)await gate.promise;
    return {ok:true,json:async()=>({revision:3,comments:structuredClone(published),receipt,actions:actionReceipts})};
  };
  const helper=nativeComments(session,source,local.commands,()=>!busy,v=>states.push(v),request,()=> 'member',disk);
  return {local,helper,source,states,posts,signals,saved,disk,session,request,setLostAbandon:v=>lostAbandon=v,setActionGate:v=>actionGate=v,setActions:v=>actionReceipts=v,setLostAction:v=>lostAction=v,setRefusal:v=>refusal=v,setBusy:v=>busy=v,setPublished:v=>published=v,setGate:v=>gate=v,setReceipt:v=>receipt=v,
    dispose(){helper.dispose();local.dispose();}};
}
test('actual AddCommentCommand: definite body refusal emits no mutation, retains editable draft and only explicit new intent retries',async()=>{
  const f=fixture();try{
    f.setRefusal(true);await f.helper.add('keep my text','H9');assert.equal(f.posts.length,1);assert.equal(f.local.emitted.length,0);assert.equal(f.helper.pending(),false);assert.equal(f.helper.canAdd(),true);assert.match(f.states.at(-1).message,/No native add began/);
    await f.helper.refresh();assert.equal(f.posts.length,1);
    f.setRefusal(false);await f.helper.add('keep my text','H9');assert.equal(f.posts.length,2);assert.notEqual(f.posts[0].id,f.posts[1].id);
    const mutation=f.local.emitted.find(m=>m.id===AddCommentMutation.id);assert.ok(mutation);
    assert.equal(mutation.params.comment.personId,'owner');assert.equal(mutation.params.comment.authorName,'Owner');assert.equal(mutation.params.comment.text.dataStream,'keep my text\r\n');assert.equal(mutation.params.comment.ref,'H9');assert.equal(f.helper.pending(),true);
    await f.helper.refresh();assert.equal(f.helper.pending(),true);assert.equal(f.states.at(-1).confirmed,undefined);
    f.setPublished([mutation.params.comment]);await f.helper.refresh();assert.equal(f.helper.pending(),false);assert.equal(f.states.at(-1).confirmed,mutation.params.comment.id);
  }finally{f.dispose();}
});
test('reader and active input/pending guard make no POST; cancelled reply recovers without native entry',async()=>{
  for(const role of ['read','owner']){const f=fixture(role);try{if(role==='owner')f.setBusy(true);await f.helper.add('draft','H9');assert.equal(f.posts.length,0);assert.equal(f.helper.pending(),false);assert.match(f.states.at(-1).message,/Read-only|Finish active/);}finally{f.dispose();}}
  const f=fixture();try{await f.helper.add('reply draft','H9','absent-root');assert.equal(f.posts.length,0);assert.equal(f.helper.pending(),false);assert.match(f.states.at(-1).message,/No native add began/);}finally{f.dispose();}
});
test('error after native mutation entry remains uncertain and never silently retries or clears pending',async()=>{
  const f=fixture();const observer=f.local.commands.onCommandExecuted(c=>{if(c.id===AddCommentMutation.id)throw Error('late command failure');});
  try{await f.helper.add('uncertain','H9');assert.equal(f.helper.pending(),true);assert.match(f.states.at(-1).message,/Native outcome unknown/);await f.helper.add('must not replay','H9');assert.equal(f.posts.length,1);}finally{observer.dispose();f.dispose();}
});
test('teardown aborts requests, drops late response and removes public mutation observer; scoped unimplemented writes fail closed',async()=>{
  const f=fixture(),gate=deferred();try{
    await assert.rejects(f.source.dataSource.updateComment({}),/not enabled/);await assert.rejects(f.source.dataSource.deleteComment('','','',''),/not enabled/);
    await assert.rejects(f.source.dataSource.listComments('foreign','sheet-1',[]),/session changed/);
    f.setGate(gate);const pending=f.helper.refresh(),count=f.states.length;f.helper.dispose();gate.resolve();await pending;assert.equal(f.states.length,count);assert.ok(f.signals.every(s=>s.aborted));assert.equal(f.source.dataSource,null);
  }finally{f.local.dispose();}
});

test('actual add then structural delete before first poll releases pending only on own committed history receipt, preserving draft intent',async()=>{
  const {RemoveRowCommand}=await import('@univerjs/sheets');
  const f=fixture();try{
    await f.helper.add('keep removed text','H9');const id=f.posts[0].id;
    await f.local.commands.executeCommand(RemoveRowCommand.id,{unitId:f.local.unitID,subUnitId:'sheet-1',range:{startRow:8,endRow:8,startColumn:0,endColumn:25}});
    assert.equal(f.local.model.getComment(f.local.unitID,'sheet-1',id),undefined);
    f.setReceipt({id,status:'unknown'});await f.helper.refresh();await f.helper.refresh();assert.equal(f.helper.pending(),true);assert.equal(f.helper.canAdd(),false);
    f.setReceipt({id:'someone-else',status:'committed-removed',revision:2});await f.helper.refresh();assert.equal(f.helper.pending(),true);
    f.setReceipt({id,status:'committed-removed',revision:2});await f.helper.refresh();assert.equal(f.helper.pending(),false);assert.equal(f.states.at(-1).confirmed,undefined);assert.equal(f.states.at(-1).removed,id);assert.match(f.states.at(-1).message,/committed.*removed.*retained/);
    assert.equal(f.helper.canAdd(),false,'new comment requires an explicit new-draft choice');await f.helper.add('no silent recreation','H9');assert.equal(f.posts.length,1);
    await f.helper.refresh();assert.equal(f.posts.length,1);f.helper.newDraft();assert.equal(f.helper.canAdd(),true);assert.equal(f.states.at(-1).removed,undefined);
  }finally{f.dispose();}
});

test('root resolve/reopen uses actual public command, preserves text and only history receipt settles; lost preparation remount is GET-only',async()=>{
 const f=fixture();try{
  await f.helper.add('unchanged draft text','H9');const root=f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id);f.setPublished([structuredClone(root)]);await f.helper.refresh();
  const before=structuredClone(root.text);assert.equal(f.helper.canResolve(root),true);await f.helper.resolve(root);
  const a=f.posts.at(-1);assert.equal(a.resolved,true);assert.equal(root.resolved,true);assert.deepEqual(root.text,before);
  await f.helper.refresh();assert.equal(f.helper.canResolve(root),false);assert.match(f.states.at(-1).resolution,/unknown/);
  f.setPublished([{...root,resolved:true}]);f.setActions([{...a,status:'committed',revision:3}]);await f.helper.refresh();assert.equal(f.helper.canResolve(root),true);assert.match(f.states.at(-1).resolution,/recorded/);
  f.setLostAction(true);await f.helper.resolve(root);const count=f.posts.length,disk=new Map(f.saved);assert.equal(f.posts.at(-1).resolved,false);assert.equal(root.resolved,true);
  f.helper.dispose();const states=[],reopened=nativeComments(f.session,f.source,f.local.commands,()=>true,v=>states.push(v),f.request,()=> 'member',f.disk);
  try{await reopened.refresh();await reopened.resolve(root);assert.equal(f.posts.length,count);assert.deepEqual(f.saved,disk);assert.match(states.at(-1).resolution,/unknown/);}finally{reopened.dispose();}
 }finally{f.dispose();}
});
test('resolution guards deny reader/other author and active input without sending or changing root',async()=>{
 for(const role of ['owner','editor','read']){const f=fixture(role);try{
  const root={id:'other',personId:'someone-else',resolved:false};if(role==='owner')f.setBusy(true);
  assert.equal(f.helper.canResolve(root),false);await f.helper.resolve(root);assert.equal(f.posts.length,0);assert.equal(f.saved.size,0);assert.equal(root.resolved,false);
 }finally{f.dispose();}}
});

test('busy during prepare: no native resolve starts; explicit unused abandonment is available after GET',async()=>{
 const f=fixture();try{
  await f.helper.add('retained body','H9');const root=f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id);f.setPublished([structuredClone(root)]);await f.helper.refresh();
  const gate=deferred();f.setActionGate(gate);const operation=f.helper.resolve(root);await new Promise(setImmediate);f.setBusy(true);gate.resolve();await operation;f.setBusy(false);
  const a=f.posts.at(-1);assert.equal(root.resolved,undefined);assert.equal(f.local.emitted.some(m=>m.id==='thread-comment.mutation.resolve-comment'),false);
  f.setActions([{...a,status:'unknown',phase:'prepared',head:3}]);await f.helper.refresh();assert.deepEqual(f.states.at(-1).abandonable,[a.id]);
 }finally{f.dispose();}
});

test('explicit unused abandonment: lost reply is GET-only; append-only terminal evidence survives reverse storage order and remount',async()=>{
 const f=fixture();try{
  await f.helper.add('retain exact body','H9');const root=f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id);f.setPublished([structuredClone(root)]);await f.helper.refresh();
  const gate=deferred();f.setActionGate(gate);const operation=f.helper.resolve(root);await new Promise(setImmediate);f.setBusy(true);gate.resolve();await operation;f.setBusy(false);
  const a=f.posts.at(-1);f.setActions([{...a,status:'unknown',phase:'prepared',head:3}]);await f.helper.refresh();const old=new Map(f.saved);
  f.setLostAbandon(true);await f.helper.abandon(a.id);const count=f.posts.length;await f.helper.abandon(a.id);assert.equal(f.posts.length,count);
  await f.helper.refresh();assert.deepEqual(f.states.at(-1).abandonable,[]);assert.equal(f.helper.canResolve(root),false,'same member/head tuple cannot be reused for late native mutation safety');
  const other={...root,id:'other'};assert.equal(f.helper.canResolve(other),true,'other threads are released without remount');for(const [key,value]of old)assert.equal(f.saved.get(key),value);
  f.helper.dispose();const records=[...f.saved].reverse();f.saved.clear();for(const [k,v]of records)f.saved.set(k,v);
  const states=[],fresh=nativeComments(f.session,f.source,f.local.commands,()=>true,v=>states.push(v),f.request,()=> 'fresh-member',f.disk);
  try{await fresh.refresh();assert.equal(f.posts.length,count);assert.equal(fresh.canResolve(root),true);await fresh.abandon(a.id);assert.equal(f.posts.length,count);assert.equal(f.local.emitted.some(m=>m.id==='thread-comment.mutation.resolve-comment'),false);}finally{fresh.dispose();}
 }finally{f.dispose();}
});
test('possibly-sent native resolution cannot be abandoned even if a stale GET claims prepared',async()=>{
 const f=fixture();try{
  await f.helper.add('body','H9');const root=f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id);f.setPublished([structuredClone(root)]);await f.helper.refresh();await f.helper.resolve(root);
  const a=f.posts.at(-1);f.setActions([{...a,status:'unknown',phase:'prepared',head:3}]);await f.helper.refresh();assert.deepEqual(f.states.at(-1).abandonable,[]);const count=f.posts.length;await f.helper.abandon(a.id);assert.equal(f.posts.length,count);assert.ok([...f.saved.keys()].some(k=>k.includes('started:')));
 }finally{f.dispose();}
});
