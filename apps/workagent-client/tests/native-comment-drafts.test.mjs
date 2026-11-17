import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCommentDrafts } from '../src/native-comment-drafts.ts';
const scope={principal:'owner',unitID:'native-one',epoch:2};
function fixture(){const values=new Map();let denied=false,healthy=true;let tail=Promise.resolve();const storage={get length(){if(denied)throw Error('denied');return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>{if(denied)throw Error('denied');return values.get(k)??null;},setItem:(k,v)=>{if(denied)throw Error('full');values.set(k,v);},removeItem:k=>{if(denied)throw Error('denied');values.delete(k);}};const locks={request:(_key,fn)=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;}};return {values,storage,locks,setDenied:v=>denied=v,setHealthy:v=>healthy=v,make:(s=scope)=>nativeCommentDrafts(s,()=>storage,()=>healthy,()=>{},locks)};}
test('reload offers exact text only after authority; principal/unit/epoch isolated; restore is explicit text only',async()=>{const f=fixture(),a=f.make();await a.edit('  root\r\n<draft>  ');a.dispose();const b=f.make();f.setHealthy(false);assert.equal(b.view().drafts.length,0);f.setHealthy(true);const [saved]=b.view().drafts;assert.equal(saved.text,'  root\r\n<draft>  ');for(const s of [{...scope,principal:'peer'},{...scope,unitID:'other'},{...scope,epoch:3}])assert.equal(f.make(s).view().drafts.length,0);assert.equal(b.text(),'');assert.equal(await b.restore(saved.id,saved.version),'  root\r\n<draft>  ');assert.equal(f.make().view().drafts.length,1,'only transferred current draft remains recoverable');});
test('attempt is durably sealed before effect; reload never offers attempted body, newer text survives old completion',async()=>{const f=fixture(),a=f.make();await a.edit('attempted');const token=await a.beforeAttempt();assert.ok(token);assert.equal(f.make().view().drafts.length,0);assert.equal(f.make().view().attempted,1);await a.edit('newer');await a.complete(token,proof(token));assert.equal(a.text(),'newer');assert.equal(f.make().view().drafts[0].text,'newer');});
test('two tabs preserve separate records; stale recover/discard cannot erase or duplicate a newer version',async()=>{const f=fixture(),a=f.make(),b=f.make();await a.edit('A');await b.edit('B');const c=f.make(),old=c.view().drafts.find(x=>x.text==='A');await a.edit('A newer');assert.equal(await c.restore(old.id,old.version),undefined);assert.equal(await c.discard(old.id,old.version),false);assert.deepEqual(c.view().drafts.map(x=>x.text).sort(),['A newer','B']);const fresh=c.view().drafts.find(x=>x.text==='A newer'),d=f.make();const outcomes=await Promise.all([c.restore(fresh.id,fresh.version),d.restore(fresh.id,fresh.version)]);assert.equal(outcomes.filter(x=>x==='A newer').length,1);assert.equal(await a.beforeAttempt(),undefined,'transferred live source cannot submit');});
test('denied/full/corrupt storage fails closed before effect and preserves in-memory text and original records',async()=>{const f=fixture(),a=f.make();await a.edit('keep');const original=new Map(f.values);f.setDenied(true);await a.edit('new memory');assert.equal(a.text(),'new memory');assert.equal(await a.beforeAttempt(),undefined);assert.match(a.view().message,/not saved|unavailable/i);assert.deepEqual(f.values,original);f.setDenied(false);const key=[...f.values.keys()][0];f.values.set(key,'{');assert.equal(f.make().view().drafts.length,0);assert.equal(await a.beforeAttempt(),undefined);assert.match(a.view().message,/unavailable|invalid/i);});
test('explicit empty/discard retains tombstone, never restores old text; no locks means no transfer/submission',async()=>{const f=fixture(),a=f.make();await a.edit('discard me');const before=[...f.values.values()][0];await a.edit('');assert.equal(f.make().view().drafts.length,0);assert.ok([...f.values.values()].some(x=>x.includes('discard')));const b=f.make();await b.edit('other');const c=nativeCommentDrafts(scope,()=>f.storage,()=>true,()=>{},undefined);const item=c.view().drafts[0];assert.equal(await c.restore(item.id,item.version),undefined);assert.equal(await c.beforeAttempt(),undefined);assert.ok(before.includes('discard me'));});
test('late authority loss/disposal during lock cannot restore or mark an attempt',async()=>{const f=fixture(),a=f.make();await a.edit('safe');let release;const gate=new Promise(r=>release=r);const b=nativeCommentDrafts(scope,()=>f.storage,()=>true,()=>{},{request:async(_k,fn)=>{await gate;return fn();}});const item=b.view().drafts[0],pending=b.restore(item.id,item.version);b.dispose();release();assert.equal(await pending,undefined);assert.equal(f.make().view().drafts[0].text,'safe');});

test('attempted exact text cannot be reoffered by another tab/new draft; earlier evidence is immutable',async()=>{const f=fixture(),a=f.make();await a.edit('same attempted text');await a.beforeAttempt();const evidence=new Map(f.values);const b=f.make();await b.edit('same attempted text');assert.equal(f.make().view().drafts.length,0);for(const [k,v]of evidence)assert.equal(f.values.get(k),v);await b.edit('distinct unsent text');assert.equal(f.make().view().drafts[0].text,'distinct unsent text');});
test('failed attempt-seal write prevents first effect and keeps exact original draft recoverable',async()=>{const f=fixture(),a=f.make();await a.edit('not submitted');const put=f.storage.setItem;f.storage.setItem=(k,v)=>{if(k.endsWith(':seal'))throw Error('quota');put(k,v);};assert.equal(await a.beforeAttempt(),undefined);assert.equal(a.text(),'not submitted');assert.equal(f.make().view().drafts[0].text,'not submitted');assert.match(a.view().message,/no submission/i);});
test('save racing explicit restore is serialized and cannot overwrite transferred or newer records',async()=>{const f=fixture(),a=f.make(),b=f.make();await a.edit('v1');const r=b.view().drafts[0];const update=a.edit('v2'),restore=b.restore(r.id,r.version);await update;assert.equal(await restore,undefined);const newest=b.view().drafts[0];assert.equal(newest.text,'v2');assert.equal(await b.restore(newest.id,newest.version),'v2');await a.edit('');await a.edit('separate explicit new text');assert.deepEqual(f.make().view().drafts.map(r=>r.text).sort(),['separate explicit new text','v2']);});
test('explicit clear/discard history does not consume active quota or erase unknown evidence',async()=>{
 for(const method of ['clear','chooser']){
  const f=fixture(),a=f.make();await a.edit('unknown attempt');await a.beforeAttempt();const unknown=new Map(f.values);
  for(let n=0;n<70;n++){
   await a.edit('discarded '+n);assert.equal(a.text(),'discarded '+n);
   if(method==='chooser'){const b=f.make(),saved=b.view().drafts.find(x=>x.text==='discarded '+n);assert.ok(saved);assert.equal(await b.discard(saved.id,saved.version),true);}
   await a.edit('');
  }
  const retained=new Map(f.values);assert.equal(f.make().view().drafts.length,0);await a.edit('new root comment');assert.ok(await a.beforeAttempt());
  for(const [k,v]of retained)assert.equal(f.values.get(k),v,'explicit discard evidence remains byte-exact');
  for(const [k,v]of unknown)assert.equal(f.values.get(k),v,'unknown attempt remains byte-exact');
 }
});
test('64 unresolved attempts still exhaust the unchanged active capacity',async()=>{
 const f=fixture(),a=f.make();for(let n=0;n<64;n++){await a.edit('unknown '+n);assert.ok(await a.beforeAttempt());}
 const retained=new Map(f.values);await a.edit('overflow');assert.equal(await a.beforeAttempt(),undefined);assert.deepEqual(f.values,retained);
});
const proof=token=>({commentId:'native-'+token.id,principal:scope.principal,text:token.text});
test('P2 completion: 70 proven completions retire active capacity including older proof after newer typing',async()=>{
 const f=fixture(),a=f.make();await a.edit('unresolved older');const unresolved=await a.beforeAttempt(),original=new Map(f.values);
 for(let n=0;n<70;n++){await a.edit('completed '+n);const token=await a.beforeAttempt();assert.ok(token,'completion '+n+' must not hit retained-history cap');await a.edit('newer '+n);await a.complete(token,proof(token));assert.equal(a.text(),'newer '+n);}
 for(const [k,v]of original)assert.equal(f.values.get(k),v,'unresolved evidence immutable');assert.ok(unresolved);assert.ok(await a.beforeAttempt());
});
test('P2 transfer: interrupted write or readback leaves exact unsent text recoverable after remount',async()=>{
 for(const failure of ['write','readback']){const f=fixture(),a=f.make();await a.edit('recover after '+failure);const b=f.make(),saved=b.view().drafts[0],put=f.storage.setItem,get=f.storage.getItem;let armed=true,failed=false;
 f.storage.setItem=(k,v)=>{if(armed&&k.endsWith(':draft')){if(failure==='write'){armed=false;failed=true;throw Error('write failed');}put(k,v);armed=false;failed=true;f.storage.getItem=key=>{f.storage.getItem=get;throw Error('readback failed');};return;}put(k,v);};
 await b.restore(saved.id,saved.version);assert.equal(failed,true);f.storage.getItem=get;f.storage.setItem=put;const cold=f.make(),again=cold.view().drafts;assert.equal(again.length,1,'exact one recoverable copy');assert.equal(again[0].text,saved.text);assert.equal(await cold.restore(again[0].id,again[0].version),saved.text);
 }
});
test('P2 late restore: delayed result AFTER lock callback cannot replace typing or expose after revoke/dispose',async()=>{
 for(const cause of ['typing','revoke','dispose']){const f=fixture(),a=f.make();await a.edit('saved old');let release,ran;const done=new Promise(r=>ran=r),gate=new Promise(r=>release=r);let first=true;
 const locks={request:async(_k,fn)=>{const value=await fn();if(first){first=false;ran();await gate;}return value;}};
 let authorized=true;const b=nativeCommentDrafts(scope,()=>f.storage,()=>authorized,()=>{},locks),saved=b.view().drafts[0];const restoring=b.restore(saved.id,saved.version);await done;
 if(cause==='typing')await b.edit('newer typing');if(cause==='revoke')authorized=false;if(cause==='dispose')b.dispose();release();assert.equal(await restoring,undefined);if(cause==='typing')assert.equal(b.text(),'newer typing');assert.ok(f.make().view().drafts.some(d=>d.text==='saved old'),'late rejected result remains recoverable');
 }
});

test('completion retirement requires exact attempted text/principal proof; interrupted retirement remains sealed',async()=>{
 const f=fixture(),a=f.make();await a.edit('never attempted');const d=f.make().view().drafts[0];await a.complete(d,proof(d));assert.equal(f.make().view().drafts.length,1);
 const token=await a.beforeAttempt(),before=new Map(f.values);await a.complete(token,{...proof(token),principal:'peer'});await a.complete(token,{...proof(token),text:'other'});await a.complete(token,{...proof(token),commentId:undefined});assert.deepEqual(f.values,before);
 const remove=f.storage.removeItem;let failed=false;f.storage.removeItem=k=>{failed=true;throw Error('interrupted retirement');};await a.complete(token,proof(token));assert.equal(failed,true);assert.equal(f.make().view().drafts.length,0);assert.equal(f.make().view().attempted,1);
 f.storage.removeItem=remove;await a.complete(token,proof(token));assert.equal([...f.values.keys()].filter(k=>k.endsWith(':complete')).length,1);assert.equal([...f.values.keys()].filter(k=>k.endsWith(':seal')||k.endsWith(':draft')).length,0);const b=f.make();await b.edit(token.text);assert.equal(f.make().view().drafts.length,0,'completed body is never a recovered unsent offer');
});
test('atomic transfer preserves a concurrently transferred newer version and stale source cannot submit',async()=>{
 const f=fixture(),a=f.make();await a.edit('one copy');const b=f.make(),r=b.view().drafts[0];assert.equal(await b.restore(r.id,r.version),'one copy');const transferred=f.make().view().drafts[0];assert.equal(transferred.id,r.id);assert.equal(transferred.version,r.version+1);assert.equal(await a.beforeAttempt(),undefined);assert.equal([...f.values.keys()].filter(k=>k.endsWith(':draft')).length,1);
});
