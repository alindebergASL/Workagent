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
  let editRefusal=false,published=[],refusal=false,busy=false,gate,receipt,actionReceipts=[],lostAction=false,actionGate,lostAbandon=false;const saved=new Map(),disk={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),key:i=>[...saved.keys()][i]??null,get length(){return saved.size;}};
  const session={unitID:local.unitID,principal:'owner',name:'Owner',binding:'synthetic',owner:role==='owner',access:{role,revision:1}};
  const request=async(url,options)=>{assert.match(url,/native-comments\/1(?:\?|\/actions|\/edits|\/deletions|$)/);signals.push(options.signal);
    if(options.method==='POST'){
      const body=JSON.parse(options.body);posts.push(body);if(url.endsWith('/abandon')){const id=url.split('/').at(-2);let r=actionReceipts.find(a=>a.id===id);if(!r&&(url.includes('/edits/')||url.includes('/deletions/'))){assert.equal(body.id,id);r={...body,head:3};actionReceipts.push(r);}Object.assign(r,{phase:'abandoned',status:'abandoned'});if(lostAbandon)throw Error('lost abandonment response');return {ok:true,json:async()=>structuredClone(r)};}if(url.endsWith('/actions')||url.endsWith('/edits')||url.endsWith('/deletions')){if(url.endsWith('/edits')&&editRefusal)return {ok:false,status:409};if(actionGate)await actionGate.promise;if(lostAction)throw Error('lost preparation response');return {ok:true,json:async()=>({...body,status:'unknown',phase:'prepared',head:3})};}if(refusal)return {ok:false,status:409};
      const canonical={id:body.id,threadId:body.parentId??body.id,unitId:local.unitID,subUnitId:'sheet-1',personId:'owner',authorName:'Owner',dT:'2026-11-16T00:00:00.000Z',ref:body.ref,text:{dataStream:body.body+'\r\n',paragraphs:[{startIndex:body.body.length}]},...(body.parentId?{parentId:body.parentId}:{})};
      return {ok:true,json:async()=>canonical};
    }
    if(gate)await gate.promise;
    return {ok:true,json:async()=>({revision:3,comments:structuredClone(published),receipt,actions:actionReceipts,edits:actionReceipts,deletions:actionReceipts})};
  };
  const helper=nativeComments(session,source,local.commands,()=>!busy,v=>states.push(v),request,()=> 'member',disk);
  return {local,helper,source,states,posts,signals,saved,disk,session,request,setEditRefusal:v=>editRefusal=v,setLostAbandon:v=>lostAbandon=v,setActionGate:v=>actionGate=v,setActions:v=>actionReceipts=v,setLostAction:v=>lostAction=v,setRefusal:v=>refusal=v,setBusy:v=>busy=v,setPublished:v=>published=v,setGate:v=>gate=v,setReceipt:v=>receipt=v,
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

test('text editing: actual public command retains identity; only committed receipt publishes; author and active-input guards',async()=>{
 const {UpdateCommentMutation}=await import('@univerjs/thread-comment');const f=fixture();try{
  await f.helper.add('Original','H9');const root=f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id);const published={...structuredClone(root),bodyVersion:'original'};f.setPublished([published]);await f.helper.refresh();
  assert.equal(f.helper.editing.canEdit({...published,personId:'peer'}),false);f.setBusy(true);await f.helper.editing.edit(published,'Changed');assert.equal(f.posts.length,1);f.setBusy(false);
  let retainedID;await f.helper.editing.edit(published,'Changed',id=>{retainedID=id;assert.equal(f.posts.length,1,'identity exposed before HTTP/native effect');assert.equal(root.text.dataStream,'Original\r\n');assert.ok([...f.saved.keys()].some(k=>k.endsWith('intent:'+id)));});const a=f.posts.at(-1);assert.equal(retainedID,a.id);assert.equal(a.body,'Changed');assert.equal(a.previousVersion,'original');assert.equal(root.text.dataStream,'Changed\r\n');assert.equal(f.local.emitted.at(-1).id,UpdateCommentMutation.id);assert.equal(f.helper.editing.canEdit(published),false);
  await f.helper.refresh();assert.equal(f.states.at(-1).comments[0].text.dataStream,'Original\r\n');assert.match(f.states.at(-1).editing.message,/unknown/);const count=f.posts.length;
  f.setActions([{...a,status:'committed',phase:'admitted',head:2,revision:3}]);f.setPublished([{...published,text:{dataStream:'Changed\r\n'},bodyVersion:a.id}]);await f.helper.refresh();assert.match(f.states.at(-1).editing.message,/recorded/);assert.equal(f.posts.length,count);assert.deepEqual(f.states.at(-1).editing.confirmed,{commentId:a.commentId,body:a.body,version:a.id,previousVersion:'original'});
  assert.equal(f.saved.get([...f.saved.keys()].find(k=>k.endsWith('intent:'+a.id))),JSON.stringify(a));
 }finally{f.dispose();}
});
test('text edit busy during preparation: explicit unused abandonment, lost response/remount GET-only and immutable draft identity',async()=>{
 const f=fixture(),gate=deferred();let reopened;try{
  await f.helper.add('Original','H9');const root={...structuredClone(f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id)),bodyVersion:'original'};f.setPublished([root]);await f.helper.refresh();f.setActionGate(gate);
  const work=f.helper.editing.edit(root,'Retain this edit');await new Promise(setImmediate);const a=f.posts.at(-1);f.setBusy(true);gate.resolve();await work;assert.equal(f.local.model.getComment(f.local.unitID,'sheet-1',root.id).text.dataStream,'Original\r\n');f.setBusy(false);
  f.setActions([{...a,status:'unknown',phase:'prepared',head:3}]);await f.helper.refresh();assert.deepEqual(f.states.at(-1).editing.abandonable,[a.id]);f.setLostAbandon(true);await f.helper.editing.abandon(a.id);const count=f.posts.length,before=new Map(f.saved);
  f.helper.dispose();const reversed=new Map([...f.saved].reverse()),disk={getItem:k=>reversed.get(k)??null,setItem:(k,v)=>reversed.set(k,v),key:i=>[...reversed.keys()][i]??null,get length(){return reversed.size;}};
  reopened=nativeComments(f.session,f.source,f.local.commands,()=>true,()=>{},f.request,()=> 'new-member',disk);await reopened.refresh();assert.equal(f.posts.length,count);for(const [key,value] of before)assert.equal(disk.getItem(key),value);assert.equal(reopened.editing.canEdit(root),true);
  assert.equal(f.local.model.getComment(f.local.unitID,'sheet-1',root.id).text.dataStream,'Original\r\n');
 }finally{reopened?.dispose();f.dispose();}
});

test('editing unchanged text creates no identity or POST across cancel/remount; changed Save uses current body version',async()=>{
 const f=fixture();let reopened;try{
  await f.helper.add('Original','H9');const root={...structuredClone(f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id)),bodyVersion:'original'};f.setPublished([root]);await f.helper.refresh();const before=new Map(f.saved),posts=f.posts.length,mutations=f.local.emitted.length;
  await f.helper.editing.edit(root,'Original');assert.equal(f.posts.length,posts);assert.deepEqual(f.saved,before);assert.equal(f.local.emitted.length,mutations);assert.equal(f.helper.editing.canEdit(root),true);
  f.helper.dispose();reopened=nativeComments(f.session,f.source,f.local.commands,()=>true,()=>{},f.request,()=> 'new-member',f.disk);await reopened.refresh();await reopened.editing.edit(root,'Original');assert.equal(f.posts.length,posts);assert.deepEqual(f.saved,before);
  await reopened.editing.edit(root,'Second');const a=f.posts.at(-1);f.setActions([{...a,status:'committed',phase:'admitted',head:2,revision:3}]);const fresh={...root,bodyVersion:a.id,text:{dataStream:'Second\r\n'}};f.setPublished([fresh]);await reopened.refresh();
  assert.equal(reopened.editing.canEdit(root),false,'old form must not reinterpret a draft at the new body version');assert.equal(reopened.editing.canEdit(fresh),true);await reopened.editing.edit(fresh,'Third');assert.equal(f.posts.at(-1).previousVersion,a.id);
 }finally{reopened?.dispose();f.dispose();}
});

test('refused preparation stays unknown until explicit server settlement; absent GET never releases identity; second consumer reconciles lost abandonment',async()=>{
 const f=fixture();let other;try{
  await f.helper.add('Original','H9');const root={...structuredClone(f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id)),bodyVersion:'original'};f.setPublished([root]);await f.helper.refresh();f.setEditRefusal(true);await f.helper.editing.edit(root,'Changed');const a=f.posts.at(-1),saved=new Map(f.saved),count=f.posts.length;
  assert.equal(f.helper.editing.canEdit(root),false);await f.helper.refresh();assert.equal(f.posts.length,count);assert.equal(f.helper.editing.canEdit(root),false);assert.deepEqual(f.states.at(-1).editing.abandonable,[a.id]);
  const states=[];other=nativeComments(f.session,f.source,f.local.commands,()=>true,v=>states.push(v),f.request,()=> 'new-member',f.disk);await other.refresh();assert.equal(other.editing.canEdit(root),false);assert.equal(f.posts.length,count);
  f.setLostAbandon(true);await f.helper.editing.abandon(a.id);assert.equal(f.helper.editing.canEdit(root),false);await f.helper.editing.abandon(a.id);assert.equal(f.posts.length,count+1);for(const [k,v]of saved)assert.equal(f.saved.get(k),v);
  await other.refresh();assert.equal(other.editing.canEdit(root),true);assert.equal(f.posts.length,count+1);f.setEditRefusal(false);await other.editing.edit(root,'Changed explicitly');assert.equal(f.posts.length,count+2);assert.notEqual(f.posts.at(-1).id,a.id);
 }finally{other?.dispose();f.dispose();}
});
test('delayed preparation and lost response never auto release; native-started or authoritative admitted uncertainty cannot abandon',async()=>{
 const f=fixture(),gate=deferred();try{
  await f.helper.add('Original','H9');const root={...structuredClone(f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id)),bodyVersion:'original'};f.setPublished([root]);await f.helper.refresh();f.setActionGate(gate);f.setLostAction(true);
  const work=f.helper.editing.edit(root,'Changed');await new Promise(setImmediate);assert.equal(f.helper.editing.view().busy,true);assert.deepEqual(f.helper.editing.view().abandonable,[]);gate.resolve();await work;const a=f.posts.at(-1),count=f.posts.length;await f.helper.refresh();assert.equal(f.helper.editing.canEdit(root),false);assert.equal(f.posts.length,count);
  f.setActions([{...a,status:'unknown',phase:'admitted',head:3}]);await f.helper.refresh();assert.deepEqual(f.helper.editing.view().abandonable,[]);await f.helper.editing.abandon(a.id);assert.equal(f.posts.length,count);
  const intentKey=[...f.saved.keys()].find(k=>k.endsWith('intent:'+a.id));assert.equal(f.saved.get(intentKey.replace('intent:','started:')),JSON.stringify(a));f.setActions([]);await f.helper.refresh();assert.deepEqual(f.helper.editing.view().abandonable,[]);f.setActions([{...a,status:'unknown',phase:'prepared',head:3}]);await f.helper.refresh();assert.deepEqual(f.helper.editing.view().abandonable,[]);assert.equal(f.helper.editing.canEdit(root),false);
 }finally{f.dispose();}
});

test('manual deletion public command: preview/cancel sends nothing; removed membership is not proof; cold receipt is GET-only',async()=>{
 const {add}=await import('../../workagent-server/tests/native-comments-sdk.test.mjs');const f=fixture();let cold;try{
  const source=f.source.dataSource;f.source.dataSource=null;await add(f.local,'root','owner');f.source.dataSource=source;const root={...structuredClone(f.local.model.getComment(f.local.unitID,'sheet-1','root')),bodyVersion:'original'};f.setPublished([root]);await f.helper.refresh();const initial=new Map(f.saved);
  f.helper.deletion.choose(root,'root');assert.equal(f.posts.length,0);f.helper.deletion.cancel();assert.deepEqual(f.saved,initial);assert.equal(f.posts.length,0);
  f.helper.deletion.choose(root,'root');await f.helper.deletion.confirm();const a=f.posts.at(-1);assert.equal(f.posts.length,1);assert.equal(f.local.model.getComment(f.local.unitID,'sheet-1','root'),undefined);assert.equal(a.targets[0].bodyVersion,'original');f.setPublished([]);await f.helper.refresh();assert.match(f.states.at(-1).deletion.message,/unknown|changed/);assert.equal(f.saved.size,2);await f.helper.deletion.confirm();assert.equal(f.posts.length,1);
  f.helper.dispose();const states=[];cold=nativeComments(f.session,f.source,f.local.commands,()=>true,v=>states.push(v),f.request,()=> 'fresh',f.disk);await cold.refresh();assert.equal(f.posts.length,1);f.setActions([{...a,status:'committed',phase:'admitted',head:2,revision:3}]);await cold.refresh();assert.match(states.at(-1).deletion.message,/Removal recorded/);assert.equal(f.posts.length,1);assert.equal(states.at(-1).comments.length,0);
 }finally{cold?.dispose();f.dispose();}
});
test('manual deletion refuses foreign subtree and reader; busy preparation can explicitly abandon without touching drafts or native membership',async()=>{
 const {add}=await import('../../workagent-server/tests/native-comments-sdk.test.mjs');const f=fixture(),gate=deferred();try{
  const source=f.source.dataSource;f.source.dataSource=null;await add(f.local,'root','owner');await add(f.local,'reply','peer','root');f.source.dataSource=source;let root=structuredClone(f.local.model.getThread(f.local.unitID,'sheet-1','root'));const published={...root.root,bodyVersion:'original',children:root.children.map(c=>({...c,bodyVersion:'original'}))};f.setPublished([published]);await f.helper.refresh();assert.equal(f.helper.deletion.canChoose(published,'root'),false);assert.equal(f.helper.deletion.canChoose(published,'reply'),false);assert.equal(f.posts.length,0);
  const own={...published,children:[]};f.setPublished([own]);await f.helper.refresh();f.helper.deletion.choose(own,'root');f.setActionGate(gate);const pending=f.helper.deletion.confirm();await new Promise(setImmediate);assert.equal(await f.local.commands.executeCommand('thread-comment.mutation.delete-comment',{unitId:f.local.unitID,subUnitId:'sheet-1',commentId:'reply'},{fromCollab:true}),true);assert.equal(f.local.model.getComment(f.local.unitID,'sheet-1','reply'),undefined);f.setBusy(true);gate.resolve();await pending;const a=f.posts.at(-1);assert.ok(f.local.model.getComment(f.local.unitID,'sheet-1','root'));f.setBusy(false);
  f.setActions([{...a,status:'unknown',phase:'prepared',head:3}]);await f.helper.refresh();assert.deepEqual(f.states.at(-1).deletion.abandonable,[a.id]);f.setLostAbandon(true);await f.helper.deletion.abandon(a.id);const count=f.posts.length;await f.helper.deletion.abandon(a.id);assert.equal(f.posts.length,count);await f.helper.refresh();assert.match(f.states.at(-1).deletion.message,/abandoned/);assert.ok(f.local.model.getComment(f.local.unitID,'sheet-1','root'));assert.equal(f.posts.length,count);assert.equal(f.helper.deletion.view().preview,undefined);
 }finally{f.dispose();}
 const reader=fixture('read');try{const root={id:'root',threadId:'root',personId:'owner',ref:'H9',bodyVersion:'original',text:{dataStream:'Original\r\n'}};reader.setPublished([root]);await reader.helper.refresh();reader.helper.deletion.choose(root,'root');await reader.helper.deletion.confirm();assert.equal(reader.posts.length,0);}finally{reader.dispose();}
});

for (const sameTarget of [false, true]) test(`held manual deletion does not intercept ${sameTarget ? 'same-target' : 'unrelated'} structural cleanup or forge start evidence`, async () => {
 const { AddCommentCommand, DeleteCommentCommand, DeleteCommentMutation } = await import('@univerjs/thread-comment');
 const { RemoveRowCommand, RemoveRowMutation } = await import('@univerjs/sheets');
 const f=fixture(),gate=deferred();let pending,observer;
 try {
  const source=f.source.dataSource;f.source.dataSource=null;
  const roots=[];
  for(const [id,ref] of [['root','H9'],['other','H10']]) {
   const c={id,threadId:id,unitId:f.local.unitID,subUnitId:'sheet-1',personId:'owner',authorName:'Owner',dT:'synthetic',ref,text:{dataStream:id+'\r\n',paragraphs:[{startIndex:id.length}]}};
   assert.equal(await f.local.commands.executeCommand(AddCommentCommand.id,{unitId:f.local.unitID,subUnitId:'sheet-1',comment:c}),true);
   roots.push({...structuredClone(c),bodyVersion:'original'});
  }
  f.source.dataSource=source;f.setPublished(roots);await f.helper.refresh();
  const manualParams=[],deleteParams=[];
  observer=f.local.commands.beforeCommandExecuted(c=>{if(c.id===DeleteCommentCommand.id)manualParams.push(c.params);if(c.id===DeleteCommentMutation.id)deleteParams.push(c.params);});
  f.setActionGate(gate);f.helper.deletion.choose(roots[0],'root');pending=f.helper.deletion.confirm();await new Promise(setImmediate);
  const intent=f.posts[0],retained=new Map(f.saved),start=f.local.emitted.length,row=sameTarget?8:9,target=sameTarget?'root':'other';
  assert.equal(await f.local.commands.executeCommand(RemoveRowCommand.id,{unitId:f.local.unitID,subUnitId:'sheet-1',range:{startRow:row,endRow:row,startColumn:0,endColumn:25}}),true);
  assert.equal(f.local.save().sheets['sheet-1'].rowCount,29);
  assert.equal(f.local.model.getComment(f.local.unitID,'sheet-1',target),undefined);
  assert.deepEqual(f.local.emitted.slice(start).map(m=>m.id),[RemoveRowMutation.id,DeleteCommentMutation.id,...(sameTarget?['thread-comment.mutation.update-comment-ref']:[])]);
  assert.equal(f.local.model.getComment(f.local.unitID,'sheet-1',sameTarget?'other':'root').ref,'H9');
  assert.equal(deleteParams.length,1);assert.notEqual(deleteParams[0],manualParams[0],'structural cleanup is not the explicit manual invocation');
  assert.deepEqual(f.saved,retained,'no manual-start evidence while preparation is held');
  assert.equal(f.posts.length,1);
  if(sameTarget) {
   // New local input/native work makes the pending preparation unusable. The
   // complete row operation must not prevent explicit unused settlement.
   f.setBusy(true);gate.resolve();await pending;f.setBusy(false);
   f.setActions([{...intent,status:'unknown',phase:'prepared',head:3}]);await f.helper.refresh();
   assert.deepEqual(f.helper.deletion.view().abandonable,[intent.id]);
   await f.helper.deletion.abandon(intent.id);
   assert.equal([...f.saved.keys()].filter(k=>k.includes('started:')).length,0);
  } else {
   gate.resolve();await pending;
   assert.equal(deleteParams.length,2);assert.equal(deleteParams[1],manualParams[0],'public SDK forwards the exact manual params after preparation');
   const started=[...f.saved.entries()].filter(([k])=>k.includes('started:'));
   assert.equal(started.length,1);assert.equal(started[0][1],JSON.stringify(intent));
   assert.equal(f.local.model.getComment(f.local.unitID,'sheet-1','root'),undefined);
   assert.equal(f.posts.length,1);
  }
 } finally {f.setBusy(true);gate.resolve();await pending;observer?.dispose();f.dispose();}
});

test('two live edit controllers: observer terminal cannot consume origin fresh native confirmation',async()=>{
 for(const observerFirst of [true,false]){
 const f=fixture();let observer,peer;
 try{
  await f.helper.add('Original','H9');const root={...structuredClone(f.local.model.getComment(f.local.unitID,'sheet-1',f.posts[0].id)),bodyVersion:'original'};
  f.setPublished([root]);await f.helper.refresh();
  peer=sdk(f.local.save());const peerStates=[];
  observer=nativeComments(f.session,peer.univer.__getInjector().get(IThreadCommentDataSourceService),peer.commands,()=>true,v=>peerStates.push(v),f.request,()=> 'observer-member',f.disk);
  await observer.refresh();await f.helper.editing.edit(root,'Changed by origin');const a=f.posts.at(-1);
  assert.equal(f.local.emitted.filter(m=>m.id==='thread-comment.mutation.update-comment').length,1);
  await f.helper.refresh();assert.match(f.helper.editing.view().message,/unknown/);
  const receipt={...a,status:'committed',phase:'admitted',head:2,revision:3};
  const fresh={...root,bodyVersion:a.id,text:{dataStream:a.body+'\r\n'}};
  f.setActions([receipt]);f.setPublished([fresh]);await (observerFirst?observer:f.helper).refresh();const retained=new Map(f.saved),postCount=f.posts.length;
  assert.ok([...f.saved.keys()].some(k=>k.endsWith('terminal:'+a.id)));
  const proof={commentId:a.commentId,body:a.body,version:a.id,previousVersion:a.previousVersion};
  await f.helper.refresh();assert.deepEqual(f.helper.editing.view().confirmed,proof,'origin still needs fresh completion after another tab persisted terminal');
  assert.doesNotMatch(f.helper.editing.view().message,/unknown/);
  await observer.refresh();await f.helper.refresh();assert.deepEqual(f.helper.editing.view().confirmed,proof);assert.deepEqual(f.saved,retained);assert.equal(f.posts.length,postCount);
  // Shared terminal alone, mismatched basis/body/member/target, stale version or
  // foreign author are never native publication proof.
  for(const receipts of [[],[{...receipt,previousVersion:'wrong'}],[{...receipt,body:'wrong'}],[{...receipt,memberID:'other'}],[{...receipt,commentId:'other'}],[{...receipt,phase:'prepared'}]]){
   f.setActions(receipts);await f.helper.refresh();assert.equal(f.helper.editing.view().confirmed,undefined);
  }
  f.setActions([receipt]);for(const published of [{...fresh,bodyVersion:'newer'},{...fresh,bodyUnknown:true},{...fresh,personId:'peer'},{...fresh,text:{dataStream:'Other\r\n'}}]){
   f.setPublished([published]);await f.helper.refresh();assert.equal(f.helper.editing.view().confirmed,undefined);
  }
  assert.deepEqual(f.saved,retained);assert.equal(f.posts.length,postCount);
 }finally{observer?.dispose();peer?.dispose();f.dispose();}
 }
});

test('fresh edit confirmations retain every exact identity regardless of receipt order and unrelated uncertainty',async()=>{
 const {add}=await import('../../workagent-server/tests/native-comments-sdk.test.mjs');const f=fixture();let peer,observer;
 try{
  const source=f.source.dataSource;f.source.dataSource=null;
  for(const id of ['first','second','unresolved'])await add(f.local,id,'owner');f.source.dataSource=source;
  const roots=['first','second','unresolved'].map(id=>({...structuredClone(f.local.model.getComment(f.local.unitID,'sheet-1',id)),bodyVersion:'original'}));
  f.setPublished(roots);await f.helper.refresh();
  for(const root of roots)await f.helper.editing.edit(root,'New '+root.id);
  assert.equal(f.local.emitted.filter(m=>m.id==='thread-comment.mutation.update-comment').length,3);
  const [a,b,unknown]=f.posts;
  const receipts=[{...a,status:'committed',phase:'admitted',head:1,revision:2},{...b,status:'committed',phase:'admitted',head:2,revision:3},{...unknown,status:'unknown',phase:'admitted',head:3}];
  f.setPublished(roots.map((r,i)=>i<2?{...r,bodyVersion:f.posts[i].id,text:{dataStream:f.posts[i].body+'\r\n'}}:r));f.setActions(receipts);
  peer=sdk(f.local.save());observer=nativeComments(f.session,peer.univer.__getInjector().get(IThreadCommentDataSourceService),peer.commands,()=>true,()=>{},f.request,()=> 'observer',f.disk);
  await observer.refresh();const retained=new Map(f.saved);
  for(const order of [receipts,[...receipts].reverse()]){
   f.setActions(order);await f.helper.refresh();await observer.refresh();
   const view=f.helper.editing.view();assert.deepEqual(view.confirmations.map(p=>p.version).sort(),[a.id,b.id].sort());assert.equal(view.confirmed,undefined,'no arbitrary last completion');
   assert.match(view.message,/other text edit outcomes remain unknown/);assert.deepEqual(view.abandonable,[]);assert.deepEqual(f.saved,retained);assert.equal(f.posts.length,3);
  }
  f.setActions([receipts[0],{...receipts[0],body:'conflicting'},receipts[2]]);await f.helper.refresh();assert.deepEqual(f.helper.editing.view().confirmations,[],'duplicate/conflicting receipts and local terminal alone do not prove completion');
 }finally{observer?.dispose();peer?.dispose();f.dispose();}
});
