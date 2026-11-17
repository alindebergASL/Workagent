// Helper/fetch/storage/action doubles: policy/lifecycle evidence, not browser or transport proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorSubject } from 'rxjs';
import { SessionStatus } from '@univerjs-pro/collaboration-client';
import { nativeScalarRestore } from '../src/native-scalar-restore.ts';
import { openRestoreAction, openReversalAction } from '../src/native-reversal-action.ts';
const session={unitID:'A',principal:'owner',binding:'binding',owner:true,agent:true,restore:true,access:{role:'owner',revision:1}};
function fixture(disk=new Map(),override={}){
 const calls=[],views=[],actions=[],status=new BehaviorSubject(SessionStatus.ONLINE);let busy=false,healthy=true,head=2,receipt,mode='',release,terminal=0;
 const storage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),get length(){return disk.size;},key:n=>[...disk.keys()][n]??null};
 const fetcher=async(url,o={})=>{calls.push({url,...o});if(mode==='hold')await new Promise(r=>release=r);if(mode==='denied')return {ok:false,status:403};
 if(o.method==='POST'){
  if(mode==='pre-refused'&&!url.endsWith('/confirm')&&!url.endsWith('/abandon'))return {ok:false,status:409};
  if(url.endsWith('/confirm'))receipt=mode.startsWith('refused-')?{...receipt,phase:'prepared',disposition:'rejected',reason:mode.startsWith('refused-intent')?'native_restore_intent_changed':mode.startsWith('refused-head')?'native_restore_head_changed':'native_restore_origin'}:{...receipt,phase:'confirmed'};
  else if(url.endsWith('/abandon')){const input=JSON.parse(o.body);receipt={...(receipt??{id:input.commandId,sourceRevision:input.sourceRevision,target:input,actionPath:`/api/native/A/1/scalar-restore/${input.commandId}/universer-api`}),phase:'abandoned',disposition:'rejected',reason:'native_restore_abandoned_unused'};}
  else{const input=JSON.parse(o.body);assert.ok([...disk.keys()].some(k=>k.endsWith(':identity:'+input.commandId)));receipt={id:input.commandId,sourceRevision:input.sourceRevision,phase:'prepared',disposition:'unknown',actionPath:`/api/native/A/1/scalar-restore/${input.commandId}/universer-api`,preview:{sheetID:'sheet-1',row:0,column:0,nativeRevision:2,sourceRevision:1,before:11,after:33}};}
  if(mode==='refused-origin-lost'&&url.endsWith('/confirm')||mode==='lost'||mode==='lost-confirm'&&url.endsWith('/confirm')||mode==='lost-abandon'&&url.endsWith('/abandon'))throw Error('lost response');
 }
 if(!receipt)return {ok:false,status:404};return {ok:true,json:async()=>structuredClone(mode==='wrong'?{...receipt,actionPath:receipt.actionPath.replace('scalar-restore','reversal')}:receipt)};
 };
 const open=async()=>{const a={memberID:'executor',submits:0,disposed:0,async submit(q){this.submits++;if(mode==='lost-submit')throw Error('lost native response');receipt={...receipt,disposition:'committed',revision:3};},dispose(){this.disposed++;}};actions.push(a);
 receipt={...receipt,phase:'executor-admitted',request:{unitID:'A',userID:'owner',memberID:'executor',type:2,baseRev:2,revision:3,sid:'restore_test',reqId:1,createTime:123,mutations:[{id:'sheet.mutation.set-range-values',data:JSON.stringify({unitId:'A',subUnitId:'sheet-1',cellValue:{0:{0:{v:receipt.preview.after,t:2}}}})}]}};return a;};
 const helper=nativeScalarRestore({...session,...override},{getMemberID:()=> 'self',get sessionStatus(){return status.value;},sessionStatus$:status},()=>head,()=>healthy,()=>busy,v=>views.push(v),fetcher,storage,open,()=>terminal++);
 return {helper,disk,calls,actions,status,storage,view:()=>views.at(-1),busy:v=>busy=v,healthy:v=>healthy=v,head:v=>head=v,mode:v=>mode=v,release:()=>release?.(),receipt:()=>structuredClone(receipt),restore:r=>receipt=r};
}
test('explicit preview/confirm makes one action submission; native receipt alone records completion',async()=>{
 const f=fixture();try{assert.equal(f.view().canPreview,true);await f.helper.preview(1);assert.equal(f.actions.length,0);assert.equal(f.view().canConfirm,true);
 await Promise.all([f.helper.confirm(),f.helper.confirm()]);assert.equal(f.actions.length,1);assert.equal(f.actions[0].submits,1);assert.equal(f.actions[0].disposed,1);assert.match(f.view().message,/Recorded as native revision 3/);assert.match(f.view().message,/Waiting/);f.head(3);f.helper.refresh();assert.match(f.view().message,/Live editor has reached/);assert.equal(f.calls.filter(x=>x.method==='POST').length,2);await f.helper.confirm();assert.equal(f.calls.filter(x=>x.method==='POST').length,2);
 }finally{f.helper.dispose();}
});
for(const mode of ['lost','lost-confirm','lost-submit'])test(`${mode}: remount retains immutable identity and performs GET only`,async()=>{
 const f=fixture();f.mode(mode);await f.helper.preview(1);if(mode!=='lost')await f.helper.confirm();const disk=new Map(f.disk),receipt=f.receipt();f.helper.dispose();
 const g=fixture(disk);try{g.restore(receipt);await g.helper.check();await g.helper.confirm();await g.helper.preview(1);assert.equal(g.actions.length,0);assert.equal(g.calls.filter(x=>x.method==='POST').length,0);assert.ok([...f.disk].every(([k,v])=>disk.get(k)===v));}finally{g.helper.dispose();}
});
test('unused preview explicit abandonment permits a distinct fresh identity; lost cancellation reply uses GET only',async()=>{
 const f=fixture();try{await f.helper.preview(1);const old=f.receipt().id;f.mode('lost-abandon');await f.helper.abandon();assert.equal(f.view().canAbandon,false);const count=f.calls.length;await f.helper.abandon();assert.equal(f.calls.length,count);f.mode('');await f.helper.check();assert.equal(f.view().canPreview,true);await f.helper.preview(1);assert.notEqual(f.receipt().id,old);assert.ok([...f.disk.keys()].some(k=>k.endsWith(':identity:'+old)));}finally{f.helper.dispose();}
});
test('two live tabs cannot erase identities or downgrade admission; third absent GET cannot mint replacement',async()=>{
 const disk=new Map(),a=fixture(disk),b=fixture(disk);try{a.mode('lost');await a.helper.preview(1);b.helper.refresh();await b.helper.preview(1);assert.equal(b.calls.length,0);await b.helper.check();assert.equal(b.view().canPreview,false);assert.equal([...disk.keys()].filter(k=>k.includes(':identity:')).length,1);
 const c=fixture(disk);try{await c.helper.check();await c.helper.preview(1);assert.equal(c.calls.filter(x=>x.method==='POST').length,0);}finally{c.helper.dispose();}
 }finally{a.helper.dispose();b.helper.dispose();}
});
test('known confirmed/admitted never abandon; stale prepared evidence cannot downgrade another tab confirmation',async()=>{
 const disk=new Map(),a=fixture(disk);await a.helper.preview(1);const old=a.receipt(),b=fixture(disk);b.restore(old);a.mode('lost-confirm');await a.helper.confirm();await b.helper.check();assert.equal(b.view().canAbandon,false);assert.equal(b.view().canConfirm,false);await b.helper.abandon();assert.ok(b.calls.every(c=>c.method!=='POST'));a.helper.dispose();b.helper.dispose();
});
test('input/head/offline/capability guards preserve identity without blur, action or retry',async()=>{
 for(const guard of ['input','head','offline']){const f=fixture();await f.helper.preview(1);if(guard==='input')f.busy(true);if(guard==='head')f.head(3);if(guard==='offline')f.status.next(SessionStatus.OFFLINE);await f.helper.confirm();assert.equal(f.actions.length,0);assert.equal(f.calls.length,1);f.helper.dispose();}
 for(const override of [{restore:false},{owner:false,access:{role:'editor',revision:1}}]){const f=fixture(new Map(),override);await f.helper.preview(1);assert.equal(f.calls.length,0);f.helper.dispose();}
});
test('wrong receipt, malformed metadata, storage failure and stale disposal are fail closed',async()=>{
 const f=fixture();f.mode('wrong');await f.helper.preview(1);assert.equal(f.view().canConfirm,false);assert.equal(f.actions.length,0);f.helper.dispose();
 const bad=fixture(new Map([['workagent:native-scalar-restore:owner:A:binding:1:identity:bad','{']]));await bad.helper.preview(1);assert.equal(bad.calls.length,0);bad.helper.dispose();
 const g=fixture();g.storage.setItem=()=>{throw Error('quota');};await g.helper.preview(1);assert.equal(g.calls.length,0);g.helper.dispose();
 const h=fixture();h.mode('hold');const p=h.helper.preview(1);h.helper.dispose();h.release();await p;assert.equal(h.view().preview,undefined);assert.equal(h.calls[0].signal.aborted,true);assert.ok(h.disk.size);
});

test('restore action opener refuses reversal/acceptance/foreign-unit paths before transport',async()=>{
 const {openRestoreAction}=await import('../src/native-reversal-action.ts');let calls=0;const fetcher=async()=>{calls++;throw Error('unexpected');};
 for(const path of ['/api/native/A/1/reversal/x/universer-api','/api/native/A/1/agent-acceptance/x/universer-api','/api/native/B/1/scalar-restore/x/universer-api'])await assert.rejects(openRestoreAction('A',path,'binding',new AbortController().signal,fetcher,()=>{},'http://fixture'),/Invalid action path/);assert.equal(calls,0);
});

test('refused preparation and absent GET retain exact identity until explicit server settlement; fresh preview is separate',async()=>{
 const f=fixture();try{f.mode('pre-refused');await f.helper.preview(1);const originals=new Map(f.disk);await f.helper.check();assert.equal(f.view().canPreview,false);assert.equal(f.view().canConfirm,false);assert.equal(f.view().canAbandon,true);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 f.mode('');await f.helper.abandon();const settled=f.receipt(),body=JSON.parse(f.calls.find(c=>c.url.endsWith('/abandon')).body);assert.deepEqual(body,{commandId:settled.id,sourceRevision:1,currentHead:2,memberID:'self'});assert.equal(settled.preview,undefined);assert.equal(f.view().canPreview,true);assert.ok([...originals].every(([k,v])=>f.disk.get(k)===v));await f.helper.preview(1);assert.notEqual(f.receipt().id,settled.id);assert.equal(f.actions.length,0);
 }finally{f.helper.dispose();}
});
test('lost absent settlement response and cross-tab remount recover only by GET, preserving append-only evidence',async()=>{
 const disk=new Map(),a=fixture(disk),b=fixture(disk);try{a.mode('pre-refused');await a.helper.preview(1);b.helper.refresh();assert.equal(b.view().canPreview,false);const original=new Map(disk);a.mode('lost-abandon');await a.helper.abandon();const settled=a.receipt();b.helper.refresh();assert.equal(b.view().canAbandon,false);await b.helper.abandon();assert.equal(b.calls.length,0);
 for(const order of [[...disk],[...disk].reverse()]){const c=fixture(new Map(order));try{c.restore(settled);assert.equal(c.view().canPreview,false);await c.helper.check();assert.equal(c.view().canPreview,true);assert.equal(c.view().canConfirm,false);await c.helper.confirm();await c.helper.abandon();assert.equal(c.actions.length,0);assert.equal(c.calls.length,1);assert.ok(c.calls.every(x=>(x.method??'GET')==='GET'));}finally{c.helper.dispose();}}
 assert.ok([...original].every(([k,v])=>disk.get(k)===v));
 }finally{a.helper.dispose();b.helper.dispose();}
});
test('absent settlement proof must match exact immutable target; unknown confirm attempts never become unused',async()=>{
 for(const key of ['memberID','currentHead','sourceRevision','commandId']){const f=fixture();try{f.mode('pre-refused');await f.helper.preview(1);f.mode('lost-abandon');await f.helper.abandon();const bad=f.receipt();bad.target[key]=typeof bad.target[key]==='number'?999:'foreign';f.restore(bad);f.mode('');await f.helper.check();assert.equal(f.view().canPreview,false);assert.equal(f.view().canConfirm,false);assert.equal(f.view().canAbandon,false);}finally{f.helper.dispose();}}
 const f=fixture();try{await f.helper.preview(1);f.mode('lost-confirm');await f.helper.confirm();f.restore(undefined);await f.helper.check();assert.equal(f.view().canAbandon,false);const posts=f.calls.filter(c=>c.method==='POST').length;await f.helper.abandon();assert.equal(f.calls.filter(c=>c.method==='POST').length,posts);}finally{f.helper.dispose();}
});

for(const refusal of ['intent','head'])test(`definitive ${refusal} refusal permits only explicit unused settlement, retaining confirm evidence across remount`,async()=>{
 const f=fixture();let g;
 try{await f.helper.preview(1);const id=f.receipt().id;f.mode('refused-'+refusal);await f.helper.confirm();if(refusal==='head')f.head(3);
 assert.equal(f.actions.length,0);assert.equal(f.view().canConfirm,false);assert.equal(f.view().canAbandon,true);if(refusal==='intent')assert.equal(f.view().canPreview,false);
 const original=new Map(f.disk);assert.equal([...original.keys()].filter(k=>k.endsWith(':confirm')).length,1);
 g=fixture(f.disk);g.restore(f.receipt());if(refusal==='head')g.head(3);await g.helper.check();await g.helper.confirm();assert.equal(g.view().canAbandon,true);assert.equal(g.view().canConfirm,false);assert.ok(g.calls.every(c=>(c.method??'GET')==='GET'));assert.equal(g.actions.length,0);
 g.mode('lost-abandon');await g.helper.abandon();const posts=g.calls.filter(c=>c.method==='POST').length;await g.helper.abandon();assert.equal(g.calls.filter(c=>c.method==='POST').length,posts);assert.equal(g.view().canAbandon,false);
 g.mode('');await g.helper.check();assert.equal(g.view().canPreview,true);assert.ok([...original].every(([k,v])=>f.disk.get(k)===v));
 for(const entries of [[...f.disk],[...f.disk].reverse()]){const c=fixture(new Map(entries));try{c.restore(g.receipt());await c.helper.check();assert.equal(c.view().canPreview,true);assert.equal(c.view().canConfirm,false);await c.helper.abandon();await c.helper.confirm();assert.ok(c.calls.every(x=>(x.method??'GET')==='GET'));assert.equal(c.actions.length,0);}finally{c.helper.dispose();}}
 await g.helper.preview(1);assert.notEqual(g.receipt().id,id);assert.equal(g.actions.length,0);assert.ok([...original].every(([k,v])=>f.disk.get(k)===v));
 }finally{g?.helper.dispose();f.helper.dispose();}
});
test('unused-refusal eligibility rejects unknown, admitted, unsupported or mismatched evidence and never masks positive admission',async()=>{
 const cases=[r=>({...r,disposition:'unknown'}),r=>({...r,phase:'confirmed'}),r=>({...r,phase:'executor-admitted'}),r=>({...r,reason:'native_restore_unsupported_history'}),r=>({...r,reason:'PERMISSION_DENIED'}),r=>({...r,id:'other'}),r=>({...r,preview:{...r.preview,nativeRevision:99}}),r=>({...r,request:{}}),r=>({...r,revision:3})];
 for(const change of cases){const f=fixture();try{await f.helper.preview(1);const preview=f.receipt();f.mode('lost-confirm');await f.helper.confirm();f.restore(change({...preview,disposition:'rejected',reason:'native_restore_intent_changed'}));f.mode('');await f.helper.check();assert.equal(f.view().canAbandon,false);const posts=f.calls.filter(x=>x.method==='POST').length;await f.helper.abandon();assert.equal(f.calls.filter(x=>x.method==='POST').length,posts);assert.equal(f.actions.length,0);}finally{f.helper.dispose();}}
 // A lower-ranked confirmed receipt is still positive evidence; a later
 // prepared/refused response must not make that identity abandonable.
 const f=fixture();try{await f.helper.preview(1);const preview=f.receipt();f.mode('lost-confirm');await f.helper.confirm();f.mode('');await f.helper.check();f.restore({...preview,disposition:'rejected',reason:'native_restore_head_changed'});await f.helper.check();assert.equal(f.view().canAbandon,false);const posts=f.calls.filter(x=>x.method==='POST').length;await f.helper.abandon();assert.equal(f.calls.filter(x=>x.method==='POST').length,posts);}finally{f.helper.dispose();}
});
