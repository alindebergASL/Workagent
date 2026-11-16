// Helper/fetch/storage/action doubles: policy/lifecycle evidence, not browser or transport proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorSubject } from 'rxjs';
import { SessionStatus } from '@univerjs-pro/collaboration-client';
import { nativeAgentAcceptance } from '../src/native-agent-acceptance.ts';
import { openAcceptanceAction, openReversalAction } from '../src/native-reversal-action.ts';
const session={unitID:'A',principal:'owner',binding:'binding',owner:true,agent:true,acceptance:true,access:{role:'owner',revision:1}};
const proposal={id:'proposal',review:'pending',revision:2,sheet:'sheet-1',row:0,column:0};
function fixture(disk=new Map(),override={}){
 const calls=[],views=[],actions=[],status=new BehaviorSubject(SessionStatus.ONLINE);let busy=false,healthy=true,head=2,receipt,mode='',release,terminal=0;
 const storage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),get length(){return disk.size;},key:n=>[...disk.keys()][n]??null};
 const fetcher=async(url,o={})=>{calls.push({url,...o});if(mode==='hold')await new Promise(r=>release=r);if(mode==='denied')return {ok:false,status:403};
 if(o.method==='POST'){
  if(url.endsWith('/confirm'))receipt=mode.startsWith('refused-origin')?{...receipt,phase:'prepared',disposition:'rejected',reason:'native_acceptance_origin'}:{...receipt,phase:'confirmed'};
  else if(url.endsWith('/abandon'))receipt={...receipt,phase:'abandoned',disposition:'rejected',reason:'native_acceptance_abandoned_unused'};
  else{const input=JSON.parse(o.body);assert.ok([...disk.keys()].some(k=>k.endsWith(':identity:'+input.commandId)));receipt={id:input.commandId,proposalId:input.proposalId,phase:'prepared',disposition:'unknown',actionPath:`/api/native/A/1/agent-acceptance/${input.commandId}/universer-api`,preview:{sheetID:'sheet-1',row:0,column:0,nativeRevision:2,before:{v:11},after:{v:33,t:2},style:null}};}
  if(mode==='refused-origin-lost'&&url.endsWith('/confirm')||mode==='lost'||mode==='lost-confirm'&&url.endsWith('/confirm')||mode==='lost-abandon'&&url.endsWith('/abandon'))throw Error('lost response');
 }
 if(!receipt)return {ok:false,status:404};return {ok:true,json:async()=>structuredClone(mode==='wrong'?{...receipt,actionPath:receipt.actionPath.replace('agent-acceptance','reversal')}:receipt)};
 };
 const open=async()=>{const a={memberID:'executor',submits:0,disposed:0,async submit(q){this.submits++;if(mode==='lost-submit')throw Error('lost native response');receipt={...receipt,disposition:'committed',revision:3};},dispose(){this.disposed++;}};actions.push(a);
 receipt={...receipt,phase:'executor-admitted',request:{unitID:'A',userID:'owner',memberID:'executor',type:2,baseRev:2,revision:3,sid:'acceptance_test',reqId:1,createTime:123,mutations:[{id:'sheet.mutation.set-range-values',data:JSON.stringify({unitId:'A',subUnitId:'sheet-1',cellValue:{0:{0:receipt.preview.after}}})}]}};return a;};
 const helper=nativeAgentAcceptance({...session,...override},{getMemberID:()=> 'self',get sessionStatus(){return status.value;},sessionStatus$:status},()=>[proposal],()=>head,()=>healthy,()=>busy,v=>views.push(v),fetcher,storage,open,()=>terminal++);
 return {helper,disk,calls,actions,status,storage,view:()=>views.at(-1),busy:v=>busy=v,healthy:v=>healthy=v,head:v=>head=v,mode:v=>mode=v,release:()=>release?.(),receipt:()=>structuredClone(receipt),restore:r=>receipt=r};
}
test('explicit preview/confirm makes one action submission; native receipt alone records completion',async()=>{
 const f=fixture();try{assert.deepEqual(f.view().eligible,['proposal']);await f.helper.preview('proposal');assert.equal(f.actions.length,0);assert.equal(f.view().canConfirm,true);
 await Promise.all([f.helper.confirm(),f.helper.confirm()]);assert.equal(f.actions.length,1);assert.equal(f.actions[0].submits,1);assert.equal(f.actions[0].disposed,1);assert.match(f.view().message,/Recorded as native revision 3/);assert.match(f.view().message,/Waiting/);f.head(3);f.helper.refresh();assert.match(f.view().message,/Live editor has reached/);assert.equal(f.calls.filter(x=>x.method==='POST').length,2);await f.helper.preview('proposal');assert.equal(f.calls.filter(x=>x.method==='POST').length,2);
 }finally{f.helper.dispose();}
});
for(const mode of ['lost','lost-confirm','lost-submit'])test(`${mode}: remount retains immutable identity and performs GET only`,async()=>{
 const f=fixture();f.mode(mode);await f.helper.preview('proposal');if(mode!=='lost')await f.helper.confirm();const disk=new Map(f.disk),receipt=f.receipt();f.helper.dispose();
 const g=fixture(disk);try{g.restore(receipt);await g.helper.check();await g.helper.confirm();await g.helper.preview('proposal');assert.equal(g.actions.length,0);assert.equal(g.calls.filter(x=>x.method==='POST').length,0);assert.ok([...f.disk].every(([k,v])=>disk.get(k)===v));}finally{g.helper.dispose();}
});
test('unused preview explicit abandonment permits a distinct fresh identity; lost cancellation reply uses GET only',async()=>{
 const f=fixture();try{await f.helper.preview('proposal');const old=f.receipt().id;f.mode('lost-abandon');await f.helper.abandon();assert.equal(f.view().canAbandon,false);const count=f.calls.length;await f.helper.abandon();assert.equal(f.calls.length,count);f.mode('');await f.helper.check();assert.deepEqual(f.view().eligible,['proposal']);await f.helper.preview('proposal');assert.notEqual(f.receipt().id,old);assert.ok([...f.disk.keys()].some(k=>k.endsWith(':identity:'+old)));}finally{f.helper.dispose();}
});
test('two live tabs cannot erase identities or downgrade admission; third absent GET cannot mint replacement',async()=>{
 const disk=new Map(),a=fixture(disk),b=fixture(disk);try{a.mode('lost');await a.helper.preview('proposal');b.helper.refresh();await b.helper.preview('proposal');assert.equal(b.calls.length,0);await b.helper.check();assert.equal(b.view().eligible.length,0);assert.equal([...disk.keys()].filter(k=>k.includes(':identity:')).length,1);
 const c=fixture(disk);try{await c.helper.check();await c.helper.preview('proposal');assert.equal(c.calls.filter(x=>x.method==='POST').length,0);}finally{c.helper.dispose();}
 }finally{a.helper.dispose();b.helper.dispose();}
});
test('known confirmed/admitted never abandon; stale prepared evidence cannot downgrade another tab confirmation',async()=>{
 const disk=new Map(),a=fixture(disk);await a.helper.preview('proposal');const old=a.receipt(),b=fixture(disk);b.restore(old);a.mode('lost-confirm');await a.helper.confirm();await b.helper.check();assert.equal(b.view().canAbandon,false);assert.equal(b.view().canConfirm,false);await b.helper.abandon();assert.ok(b.calls.every(c=>c.method!=='POST'));a.helper.dispose();b.helper.dispose();
});
test('input/head/offline/capability guards preserve identity without blur, action or retry',async()=>{
 for(const guard of ['input','head','offline']){const f=fixture();await f.helper.preview('proposal');if(guard==='input')f.busy(true);if(guard==='head')f.head(3);if(guard==='offline')f.status.next(SessionStatus.OFFLINE);await f.helper.confirm();assert.equal(f.actions.length,0);assert.equal(f.calls.length,1);f.helper.dispose();}
 for(const override of [{acceptance:false},{owner:false,access:{role:'editor',revision:1}}]){const f=fixture(new Map(),override);await f.helper.preview('proposal');assert.equal(f.calls.length,0);f.helper.dispose();}
});
test('wrong receipt, malformed metadata, storage failure and stale disposal are fail closed',async()=>{
 const f=fixture();f.mode('wrong');await f.helper.preview('proposal');assert.equal(f.view().canConfirm,false);assert.equal(f.actions.length,0);f.helper.dispose();
 const bad=fixture(new Map([['workagent:native-agent-acceptance:owner:A:binding:1:identity:bad','{']]));await bad.helper.preview('proposal');assert.equal(bad.calls.length,0);bad.helper.dispose();
 const g=fixture();g.storage.setItem=()=>{throw Error('quota');};await g.helper.preview('proposal');assert.equal(g.calls.length,0);g.helper.dispose();
 const h=fixture();h.mode('hold');const p=h.helper.preview('proposal');h.helper.dispose();h.release();await p;assert.equal(h.view().preview,undefined);assert.equal(h.calls[0].signal.aborted,true);assert.ok(h.disk.size);
});
test('action openers reject purpose/unit/query confusion before any transport',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('unexpected transport');},signal=new AbortController().signal;
 for(const [open,path] of [[openAcceptanceAction,'/api/native/A/1/reversal/x/universer-api'],[openReversalAction,'/api/native/A/1/agent-acceptance/x/universer-api'],[openAcceptanceAction,'/api/native/B/1/agent-acceptance/x/universer-api'],[openAcceptanceAction,'/api/native/A/1/agent-acceptance/x/universer-api?x=1']])await assert.rejects(open('A',path,'binding',signal,fetcher,()=>{},'http://fixture'),/Invalid action path/);
 assert.equal(calls,0);
});

const originRefusal = r => ({...r,phase:'prepared',disposition:'rejected',reason:'native_acceptance_origin'});
const abandonment = r => ({...r,phase:'abandoned',disposition:'rejected',reason:'native_acceptance_abandoned_unused'});
const evidenceKey = r => `workagent:native-agent-acceptance:owner:A:binding:1:evidence:${r.id}:${r.phase}:${r.disposition}`;
test('unused origin refusal after confirm attempt permits only explicit abandonment then a fresh confirmed identity',async()=>{
 const f=fixture();try{
  await f.helper.preview('proposal');const old=f.receipt().id;f.mode('refused-origin-lost');await f.helper.confirm();assert.equal(f.view().canAbandon,false);
  f.mode('');const beforeGet=f.calls.length;await f.helper.check();assert.equal(f.calls.length,beforeGet+1);assert.equal(f.calls.at(-1).method,undefined);
  assert.equal(f.view().canAbandon,true);assert.equal(f.view().canConfirm,false);assert.deepEqual(f.view().eligible,[]);
  const retained=new Map(f.disk),before=f.calls.length;await f.helper.confirm();await f.helper.preview('proposal');assert.equal(f.calls.length,before);
  await f.helper.abandon();assert.match(f.view().message,/explicitly abandoned/);assert.deepEqual(f.view().eligible,['proposal']);
  for(const [k,v]of retained)assert.equal(f.disk.get(k),v,'old attempt/identity/refusal bytes preserved');
  await f.helper.preview('proposal');assert.notEqual(f.receipt().id,old);await f.helper.confirm();assert.equal(f.actions.length,1);assert.equal(f.actions[0].submits,1);
  const oldPosts=f.calls.filter(c=>c.method==='POST'&&c.url.includes('/'+old+'/'));assert.equal(oldPosts.length,2);assert.ok(oldPosts[0].url.endsWith('/confirm'));assert.ok(oldPosts[1].url.endsWith('/abandon'));
 }finally{f.helper.dispose();}
});
test('unused refusal and abandoned evidence reconcile in either storage order without erasing either terminal record',async()=>{
 const seed=fixture();await seed.helper.preview('proposal');const refused=originRefusal(seed.receipt()),done=abandonment(refused);seed.helper.dispose();
 const retained=new Map(seed.disk);retained.set(evidenceKey(refused),JSON.stringify(refused));retained.set(evidenceKey(done),JSON.stringify(done));
 for(const entries of [[...retained],[...retained].reverse()]){
  const f=fixture(new Map(entries));try{assert.deepEqual(f.view().eligible,['proposal']);assert.equal(f.view().canConfirm,false);assert.equal(f.view().canAbandon,false);assert.equal(f.calls.length,0);
   const before=new Map(f.disk);await f.helper.preview('proposal');assert.equal(f.calls.length,1);for(const[k,v]of before)assert.equal(f.disk.get(k),v);
  }finally{f.helper.dispose();}
 }
});
test('lost abandonment after unused refusal resolves GET-only; stale cross-tab refusal cannot undo abandonment or a new identity',async()=>{
 const disk=new Map(),a=fixture(disk);let b;
 try{
  await a.helper.preview('proposal');a.mode('refused-origin');await a.helper.confirm();const refused=a.receipt();
  b=fixture(disk);b.restore(refused);assert.equal(b.calls.length,0);assert.equal(b.view().canConfirm,false);assert.equal(b.view().canAbandon,true);
  a.mode('lost-abandon');await a.helper.abandon();const preserved=new Map(disk);const before=a.calls.length;
  await a.helper.abandon();await b.helper.abandon();assert.equal(a.calls.length,before);assert.equal(b.calls.length,0);
  const done=a.receipt();a.mode('');await a.helper.check();await a.helper.preview('proposal');const fresh=a.receipt().id;assert.notEqual(fresh,refused.id);
  await b.helper.check();assert.match(b.view().message,/explicitly abandoned/);assert.equal(b.view().canAbandon,false);assert.equal(b.view().canConfirm,false);await b.helper.preview('proposal');assert.ok(b.calls.every(c=>c.method===undefined));
  for(const[k,v]of preserved)assert.equal(disk.get(k),v);
  for(const entries of [[...disk],[...disk].reverse()]){
   const c=fixture(new Map(entries));try{c.restore(done);await c.helper.check(refused.id);assert.match(c.view().message,/explicitly abandoned/);assert.equal(c.view().canAbandon,false);await c.helper.confirm();assert.ok(c.calls.every(x=>x.method===undefined));assert.equal(c.actions.length,0);assert.ok([...c.disk.keys()].some(k=>k.endsWith(':identity:'+fresh)));}finally{c.helper.dispose();}
  }
 }finally{a.helper.dispose();b?.helper.dispose();}
});
test('unused proof cannot conceal any confirmed/admitted/committed evidence in either order, or unrelated terminal refusal',async()=>{
 const seed=fixture();await seed.helper.preview('proposal');const initial=seed.receipt();seed.mode('lost-confirm');await seed.helper.confirm();const base=new Map(seed.disk);seed.helper.dispose();
 const refused=originRefusal(initial),done=abandonment(refused);
 const confirmed={...initial,phase:'confirmed'};
 const admitted={...initial,phase:'executor-admitted',request:{unitID:'A',userID:'owner',memberID:'executor',type:2,baseRev:2,revision:3,sid:'acceptance_test',reqId:1,createTime:123,mutations:[{id:'sheet.mutation.set-range-values',data:JSON.stringify({unitId:'A',subUnitId:'sheet-1',cellValue:{0:{0:initial.preview.after}}})}]}};
 for(const proof of [initial,confirmed,admitted]){
  const disk=new Map(base);disk.set(evidenceKey(proof),JSON.stringify(proof));const f=fixture(disk);
  try{assert.equal(f.view().canAbandon,false);await f.helper.abandon();await f.helper.confirm();assert.equal(f.calls.length,0);}finally{f.helper.dispose();}
 }
 const conflicts=[confirmed,admitted,{...admitted,disposition:'committed',revision:3},{...refused,reason:'native_acceptance_head_changed'}];
 for(const conflict of conflicts)for(const withAbandonment of [false,true])for(const reverse of [false,true]){
  const disk=new Map(base);disk.set(evidenceKey(refused),JSON.stringify(refused));if(withAbandonment)disk.set(evidenceKey(done),JSON.stringify(done));
  // An unrelated rejected receipt shares a phase key; it cannot coexist there.
  // Compare it against abandonment instead to exercise distinct terminal keys.
  if(conflict.reason==='native_acceptance_head_changed'&&!withAbandonment)continue;
  disk.set(evidenceKey(conflict),JSON.stringify(conflict));const f=fixture(new Map(reverse?[...disk].reverse():disk));
  try{assert.match(f.view().message,/metadata unavailable or conflicting/);assert.equal(f.view().canAbandon,false);assert.equal(f.view().canConfirm,false);assert.deepEqual(f.view().eligible,[]);await f.helper.abandon();await f.helper.preview('proposal');assert.equal(f.calls.length,0);assert.deepEqual(f.disk,new Map(reverse?[...disk].reverse():disk));}finally{f.helper.dispose();}
 }
});
test('OFFLINE to ONLINE empty acceptance scope reports current connection without effects or authority claims',async()=>{
 const f=fixture();try{
  const disk=new Map(f.disk);f.status.next(SessionStatus.OFFLINE);assert.match(f.view().message,/Disconnected/);f.status.next(SessionStatus.ONLINE);
  assert.match(f.view().message,/Native connection restored/);assert.match(f.view().message,/preview/i);assert.doesNotMatch(f.view().message,/Disconnected/);assert.deepEqual(f.view().eligible,['proposal']);assert.equal(f.view().canConfirm,false);assert.equal(f.calls.length,0);assert.equal(f.actions.length,0);assert.deepEqual(f.disk,disk);
  f.healthy(false);f.status.next(SessionStatus.OFFLINE);f.status.next(SessionStatus.ONLINE);assert.deepEqual(f.view().eligible,[]);assert.equal(f.view().canConfirm,false);assert.equal(f.calls.length,0);
 }finally{f.helper.dispose();}
});
test('ONLINE after unknown confirmation restores connection label only; identity and uncertainty stay retained',async()=>{
 const f=fixture();try{
  await f.helper.preview('proposal');f.mode('lost-confirm');await f.helper.confirm();const disk=new Map(f.disk),calls=f.calls.length;
  f.status.next(SessionStatus.OFFLINE);f.status.next(SessionStatus.ONLINE);assert.match(f.view().message,/Native connection restored/);assert.match(f.view().message,/GET only/);assert.match(f.view().message,/uncertain|unknown/);assert.doesNotMatch(f.view().message,/Disconnected/);
  assert.equal(f.view().canConfirm,false);assert.equal(f.view().canAbandon,false);assert.deepEqual(f.view().eligible,[]);assert.equal(f.calls.length,calls);assert.equal(f.actions.length,0);assert.deepEqual(f.disk,disk);await f.helper.confirm();assert.equal(f.calls.length,calls);
 }finally{f.helper.dispose();}
});
test('reconnect does not re-arm a prepared preview or clear a retained metadata error',async()=>{
 const f=fixture();try{await f.helper.preview('proposal');assert.equal(f.view().canConfirm,true);const disk=new Map(f.disk),calls=f.calls.length;f.status.next(SessionStatus.OFFLINE);f.status.next(SessionStatus.ONLINE);assert.match(f.view().message,/Native connection restored/);assert.equal(f.view().canConfirm,false);assert.equal(f.calls.length,calls);assert.deepEqual(f.disk,disk);}finally{f.helper.dispose();}
 const bad=new Map([['workagent:native-agent-acceptance:owner:A:binding:1:identity:bad','{']]),g=fixture(bad);
 try{g.status.next(SessionStatus.OFFLINE);g.status.next(SessionStatus.ONLINE);assert.deepEqual(g.view().eligible,[]);assert.equal(g.view().canConfirm,false);assert.equal(g.calls.length,0);assert.equal(bad.values().next().value,'{');}finally{g.helper.dispose();}
});
