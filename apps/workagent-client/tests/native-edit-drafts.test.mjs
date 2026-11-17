import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeEditDrafts} from '../src/native-edit-drafts.ts';
const scope={principal:'owner',unitID:'work',epoch:1};
const basis={commentID:'comment',threadID:'root',version:'v1',original:'Original\r\n'};
function fixture(){const bytes=new Map(),targets=new Map([[basis.commentID,{threadID:basis.threadID,principal:'owner',version:basis.version,original:basis.original}]]);let allowed=true,tail=Promise.resolve();const disk={get length(){return bytes.size;},key:i=>[...bytes.keys()][i]??null,getItem:k=>bytes.get(k)??null,setItem:(k,v)=>bytes.set(k,v),removeItem:k=>bytes.delete(k)};const locks={request:(_k,fn)=>{const p=tail.then(fn);tail=p.catch(()=>{});return p;}};return {bytes,targets,disk,locks,allow:v=>allowed=v,make:(s=scope,l=locks)=>nativeEditDrafts(s,()=>disk,()=>allowed,id=>targets.get(id),()=>{},l)};}
test('edit reload retains exact original basis and multiline text, scoped authority and separate targets',async()=>{
 const f=fixture(),a=f.make();await a.get(basis).helper.edit('  Edited 雪\nnew line  ');a.dispose();const b=f.make(),saved=b.view().drafts[0];assert.deepEqual(saved.basis,basis);assert.equal(b.view().drafts[0].text,'  Edited 雪\nnew line  ');
 for(const s of [{...scope,principal:'other'},{...scope,unitID:'other'},{...scope,epoch:2}])assert.equal(f.make(s).view().drafts.length,0);
 f.allow(false);assert.equal(b.view().drafts.length,0);assert.equal(await b.restore(saved),undefined);f.allow(true);const result=await b.restore(saved);assert.equal(result.text,saved.text);assert.equal(result.helper.acceptRestore(result.text),true);
});
test('changed version, original bytes, unknown body, ownership, thread and deletion never rebase saved edits',async()=>{
 for(const change of [{version:'v2'},{original:'Altered\r\n'},{unknown:true},{principal:'peer'},{threadID:'other'},null]){const f=fixture(),a=f.make();await a.get(basis).helper.edit('keep stale');const b=f.make(),saved=b.view().drafts[0],before=new Map(f.bytes);if(change)f.targets.set(basis.commentID,{...f.targets.get(basis.commentID),...change});else f.targets.delete(basis.commentID);assert.equal(await b.restore(saved),undefined);assert.deepEqual(f.bytes,before);if(change&&(!change.principal&&!change.threadID)){assert.equal(b.view().drafts[0].current,false);assert.equal(b.view().drafts[0].text,'keep stale');}}
});
test('post-callback delayed result rechecks basis/authority and two-tab transfer remains one owner',async()=>{
 for(const cause of ['basis','authority','dispose']){const f=fixture(),a=f.make();await a.get(basis).helper.edit('delayed');let release,ran;const gate=new Promise(r=>release=r),done=new Promise(r=>ran=r);const b=f.make(scope,{request:async(_k,fn)=>{const result=await fn();ran();await gate;return result;}}),saved=b.view().drafts[0],pending=b.restore(saved);await done;if(cause==='basis')f.targets.get(basis.commentID).version='v2';if(cause==='authority')f.allow(false);if(cause==='dispose')b.dispose();release();assert.equal(await pending,undefined);f.allow(true);f.targets.get(basis.commentID).version='v1';assert.equal(f.make().view().drafts[0].text,'delayed');}
 const f=fixture(),a=f.make();await a.get(basis).helper.edit('two tabs');const b=f.make(),c=f.make(),saved=b.view().drafts[0];const results=await Promise.all([b.restore(saved),c.restore(saved)]);assert.equal(results.filter(Boolean).length,1);assert.equal(await a.get(basis).helper.beforeAttempt(),undefined);
});
test('attempted edit never reoffered; exact native identity/body/basis proof retires only matching text and preserves newer input',async()=>{
 const f=fixture(),a=f.make(),entry=a.get(basis);await entry.helper.edit('Submitted');const token=await entry.helper.beforeAttempt();assert.ok(token);assert.equal(f.make().view().drafts.length,0);const before=new Map(f.bytes),proof={commentId:basis.commentID,body:'Submitted',version:'edit-one',previousVersion:'v1'};f.targets.set(basis.commentID,{threadID:basis.threadID,principal:'owner',version:'edit-one',original:'Submitted\r\n'});
 for(const wrong of [{...proof,previousVersion:'v2'},{...proof,version:'other'},{...proof,body:'wrong'},{...proof,commentId:'other'}])await a.complete(entry,token,wrong,'edit-one');assert.deepEqual(f.bytes,before);
 await entry.helper.edit('newer original-basis draft');await a.complete(entry,token,proof,'edit-one');assert.equal(entry.helper.text(),'newer original-basis draft');assert.equal(f.make().view().drafts[0].current,false);assert.equal([...f.bytes.keys()].filter(k=>k.endsWith(':complete')).length,1);
});
test('edit storage failure/readback failure retains bytes, and Cancel keeps unknown seals',async()=>{
 for(const mode of ['write','readback']){const f=fixture(),a=f.make();await a.get(basis).helper.edit('Saved edit');const b=f.make(),saved=b.view().drafts[0],put=f.disk.setItem,get=f.disk.getItem;let once=true;f.disk.setItem=(k,v)=>{if(once){once=false;if(mode==='write')throw Error('full');put(k,v);f.disk.getItem=()=>{f.disk.getItem=get;throw Error('readback');};return;}put(k,v);};assert.equal(await b.restore(saved),undefined);f.disk.setItem=put;f.disk.getItem=get;const c=f.make();assert.equal(c.view().drafts[0].text,'Saved edit');const entry=c.get(basis);await entry.helper.edit('Unknown');const token=await entry.helper.beforeAttempt();assert.ok(token);await entry.helper.edit('');assert.equal(f.make().view().drafts.some(d=>d.text==='Unknown'),false);assert.equal(f.make().view().attempted,1);}
});
test('70 proven completions/discards retain evidence without active history lockout, unresolved quota is unchanged',async()=>{
 const f=fixture(),a=f.make(),entry=a.get(basis);for(let n=0;n<70;n++){f.targets.get(basis.commentID).version='v1';f.targets.get(basis.commentID).original=basis.original;await entry.helper.edit('body '+n);const token=await entry.helper.beforeAttempt();assert.ok(token);const proof={commentId:basis.commentID,previousVersion:'v1',version:'edit-'+n,body:token.text};f.targets.get(basis.commentID).version=proof.version;f.targets.get(basis.commentID).original=proof.body+'\r\n';await a.complete(entry,token,proof,proof.version);await entry.helper.edit('discard '+n);await entry.helper.edit('');}assert.equal([...f.bytes.keys()].filter(k=>k.endsWith(':complete')).length,70);
 f.targets.get(basis.commentID).version='v1';f.targets.get(basis.commentID).original=basis.original;for(let n=0;n<64;n++){await entry.helper.edit('unknown '+n);assert.ok(await entry.helper.beforeAttempt());}const bytes=new Map(f.bytes);await entry.helper.edit('overflow');assert.equal(await entry.helper.beforeAttempt(),undefined);assert.deepEqual(f.bytes,bytes);
});

test('enumeration P2: one-shot length/key/get failures visibly fence until complete healthy validation, without changing bytes',async()=>{
 for(const mode of ['length','key','null-key','get']){const f=fixture(),a=f.make();await a.get(basis).helper.edit('Retained unknown');assert.ok(await a.get(basis).helper.beforeAttempt());await a.get(basis).helper.edit('Retain unsent edit');const b=f.make();assert.equal(b.view().drafts.length,1);const before=new Map(f.bytes),length=Object.getOwnPropertyDescriptor(f.disk,'length'),key=f.disk.key,get=f.disk.getItem;let once=true;
 if(mode==='length')Object.defineProperty(f.disk,'length',{configurable:true,get(){if(once){once=false;throw Error('one-shot length');}return length.get();}});
 if(mode==='key'||mode==='null-key')f.disk.key=i=>{if(once){once=false;if(mode==='null-key')return null;throw Error('one-shot key');}return key(i);};
 if(mode==='get')f.disk.getItem=k=>{if(once){once=false;throw Error('one-shot get');}return get(k);};
 const failed=b.view();assert.match(failed.message,/unavailable|invalid/);assert.equal(b.current(basis),false,mode+' must fence actions');assert.equal(failed.drafts.length,0);
 const healthy=b.view();assert.equal(healthy.drafts.length,1,mode+' full validation must recover');assert.equal(healthy.drafts[0].text,'Retain unsent edit');assert.equal(healthy.attempted,1,'unknown attempt remains non-repostable');assert.equal(b.current(basis),true);assert.deepEqual(f.bytes,before);assert.equal(b.get(basis).helper.text(),'','validation never restores into composer');
 }
});
test('enumeration P2: valid namespace names do not conceal malformed draft/seal/archive or absent-target records',async()=>{
 for(const kind of ['draft','seal','archive','other-target']){const f=fixture(),a=f.make();await a.get(basis).helper.edit('kept');const b=f.make();assert.equal(b.view().drafts.length,1);const draftKey=[...f.bytes.keys()][0],raw=f.bytes.get(draftKey),d=JSON.parse(raw);let badKey=draftKey;
 if(kind==='draft')f.bytes.set(draftKey,'{');
 if(kind==='seal'){badKey=draftKey.replace(/:draft$/,':seal');f.bytes.set(badKey,JSON.stringify({...d,kind:'attempt',text:'mismatched'}));}
 if(kind==='archive'){badKey=draftKey.replace(/:draft$/,':complete');f.bytes.set(badKey,JSON.stringify({...d,kind:'complete',commentId:null}));}
 if(kind==='other-target'){const other={...basis,commentID:'unavailable'};const prefix=draftKey.slice(0,draftKey.indexOf(encodeURIComponent(JSON.stringify(basis))));badKey=prefix+encodeURIComponent(JSON.stringify(other))+':bad:draft';f.bytes.set(badKey,'{');}
 const bytes=new Map(f.bytes);for(let i=0;i<3;i++){const v=b.view();assert.equal(v.drafts.length,0);assert.match(v.message,/unavailable|invalid/);assert.equal(b.current(basis),false);assert.deepEqual(f.bytes,bytes);}
 // Repair only synthetic fixture bytes to prove recovery requires validation,
 // not just a successful length read. Product never repairs/removes evidence.
 if(kind==='draft')f.bytes.set(draftKey,raw);else f.bytes.delete(badKey);
 f.allow(false);assert.equal(b.view().drafts.length,0);assert.equal(b.current(basis),false);f.allow(true);assert.equal(b.view().drafts.length,1);assert.equal(b.current(basis),true);
 }
});
test('enumeration P2: failure in primitive view after initial validation cannot advertise a healthy empty result',async()=>{
 const f=fixture(),a=f.make();await a.get(basis).helper.edit('kept after later read failure');const b=f.make(),get=f.disk.getItem;let reads=0;f.disk.getItem=k=>{if(++reads===2)throw Error('view read failed after validator');return get(k);};
 const v=b.view();assert.match(v.message,/unavailable|invalid/);assert.equal(v.drafts.length,0);assert.equal(b.current(basis),false);f.disk.getItem=get;assert.equal(b.view().drafts.length,1);assert.equal(b.current(basis),true);
});
