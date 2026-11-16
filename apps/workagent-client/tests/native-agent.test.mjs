// Client state/fetch/storage doubles only; no provider, transport, DB or browser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeAgent,initialNativeAgentView} from '../src/native-agent.ts';
const session={principal:'owner',owner:true,binding:'b',unitID:'A',access:{role:'owner',revision:1},agent:true};
const empty=()=>({unitID:'A',accessRevision:1,nativeRevision:2,expectedIntentRevision:0,jobs:[],proposals:[]});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(disk=new Map(),s=session){let data={...empty(),unitID:s.unitID,accessRevision:s.access.revision},mode='ok',gate,good=true,busy=false,head=2,time=0,broken=false;const calls=[],views=[];
 const storage={get length(){return disk.size;},key:i=>[...disk.keys()][i],getItem:k=>disk.get(k)??null,setItem(k,v){if(broken)throw Error('disk');disk.set(k,v);}};
 const fetcher=async(url,o)=>{calls.push({url,...o});if(mode==='hold'){gate=defer();await gate.promise;}if(mode==='lost')throw Error('reply lost');if(mode==='denied')return {ok:false,status:403};
  if(o.method==='POST'){const input=JSON.parse(o.body);assert.ok([...disk.values()].some(v=>JSON.parse(v).commandId===input.commandId || JSON.parse(v).records?.some(r=>r.input.commandId===input.commandId)));return {ok:true,json:async()=>({workId:s.unitID,commandId:input.commandId,intentRevision:input.expectedIntentRevision+1})};}
  return {ok:true,json:async()=>structuredClone(data)};};
 const helper=nativeAgent(s,()=>good,()=>busy,()=>head,v=>views.push(v),fetcher,storage,()=>time);
 return {helper,calls,views,disk,storage,view:()=>views.at(-1),data:v=>data=v,mode:v=>mode=v,healthy:v=>good=v,busy:v=>busy=v,head:v=>head=v,clock:v=>time=v,broken:v=>broken=v,release:()=>gate.resolve()};
}
const ownJob=(id,status='running')=>({...empty(),expectedIntentRevision:1,jobs:[{id,status,phase:'execution_started',messages:[]}]});
test('explicit send persists exact identity, doubleclick POST once, preserves later draft and clears only matching admitted text',async()=>{
 const f=fixture();try{assert.equal(f.calls.length,0);await f.helper.check();f.helper.edit('literal\nrequest');f.mode('hold');const sending=f.helper.send();await f.helper.send();f.helper.edit('newer draft');f.release();await sending;
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);const p=f.calls.find(c=>c.method==='POST'),input=JSON.parse(p.body);assert.equal(input.text,'literal\nrequest');assert.equal(p.credentials,'same-origin');assert.equal(p.headers['X-Workagent-Session-Binding'],'b');assert.equal(f.view().draft,'newer draft');assert.equal(f.helper.canLeave(),true);
 f.mode('ok');f.data(ownJob(input.commandId,'ready'));await f.helper.check();assert.equal(f.view().canSend,true);await f.helper.send();assert.equal(f.view().draft,'');assert.equal(f.calls.filter(c=>c.method==='POST').length,2);
 }finally{f.helper.dispose();}
});
test('lost send/remount and absent partial job list never replay; exact job GET recovers admission',async()=>{
 const f=fixture();await f.helper.check();f.helper.edit('retain exact');f.mode('lost');await f.helper.send();const id=JSON.parse(f.calls.at(-1).body).commandId;f.helper.dispose();
 const g=fixture(f.disk);try{assert.equal(g.view().draft,'retain exact');assert.equal(g.calls.length,0);await g.helper.check();assert.equal(g.view().canSend,false);assert.match(g.view().message,/unknown/);await g.helper.send();assert.ok(g.calls.every(c=>c.method==='GET'));
 g.data(ownJob(id,'ready'));await g.helper.check();assert.equal(g.view().canSend,false,'same exact request cannot mint replacement');g.helper.edit('distinct new intent');assert.equal(g.view().canSend,true);
 }finally{g.helper.dispose();}
});
test('cancel identity is separate and lost reply never inferred from later stopped job/intent',async()=>{
 const f=fixture();try{f.data(ownJob('known'));await f.helper.check();assert.equal(f.view().canCancel,true);f.mode('lost');await f.helper.cancel();const sent=JSON.parse(f.calls.at(-1).body);assert.equal(sent.kind,'cancel');assert.equal(sent.expectedIntentRevision,1);assert.equal(sent.text,undefined);f.mode('ok');f.data({...ownJob('known','stopped'),expectedIntentRevision:2});await f.helper.check();assert.match(f.view().message,/unknown/);assert.equal(f.view().canCancel,false);f.helper.edit('another');assert.equal(f.view().canSend,false);await f.helper.cancel();assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 }finally{f.helper.dispose();}
});
test('input/pending/connection guards, storage failure and reader scope issue no POST',async()=>{
 const f=fixture();try{await f.helper.check();f.helper.edit('draft');for(const label of ['cell','paste','composition','pending']){f.busy(true);await f.helper.send();assert.equal(f.calls.filter(c=>c.method==='POST').length,0,label);}f.busy(false);f.healthy(false);await f.helper.send();assert.equal(f.calls.length,1);f.healthy(true);f.broken(true);f.helper.edit('unpersisted draft');assert.equal(f.helper.canLeave(),false);await f.helper.send();assert.equal(f.calls.length,1);assert.equal(f.view().draft,'unpersisted draft');}finally{f.helper.dispose();}
 const r=fixture(new Map(),{...session,owner:false,access:{role:'editor',revision:1}});try{await r.helper.check();r.helper.edit('bad');await r.helper.send();assert.equal(r.calls.length,0);}finally{r.helper.dispose();}
});
test('dispose/403/epoch mismatch hide late data, preserve metadata and isolate old unknown scope',async()=>{
 const f=fixture();await f.helper.check();f.helper.edit('old draft');f.mode('lost');await f.helper.send();f.mode('hold');const reading=f.helper.check();f.helper.dispose();f.release();await reading;assert.equal(f.view().jobs.length,0);assert.ok(f.calls.at(-1).signal.aborted);
 const g=fixture(f.disk,{...session,binding:'new',access:{role:'owner',revision:2}});try{assert.equal(g.view().draft,'');assert.equal(g.view().priorUnknown,true);await g.helper.check();g.helper.edit('new scoped text');assert.equal(g.view().canSend,true);g.mode('denied');await g.helper.check();assert.equal(g.view().jobs.length,0);assert.equal(g.view().canSend,false);assert.ok([...f.disk.values()].some(v=>v.includes('old draft')));}finally{g.helper.dispose();}
 const h=fixture();try{h.data({...empty(),accessRevision:2,jobs:[{id:'leak',status:'ready',messages:[{text:'secret'}]}]});await h.helper.check();assert.equal(h.view().jobs.length,0);assert.equal(h.view().canCheck,false);}finally{h.helper.dispose();}
});
test('safe display whitelist, local revision marks stale, bounded polling GET-only and draft restoration before paint',async()=>{
 const f=fixture();try{f.helper.edit('byte\r\nexact');assert.equal(initialNativeAgentView(session,f.storage).draft,'byte\r\nexact');f.data({...ownJob('known'),proposals:[{id:'p',review:'pending',basis:{nativeRevision:2,sessionID:'HIDDEN'},provenance:{callID:'HIDDEN'},patch:{cells:[{sheetId:'sheet-1',row:0,column:0}]},before:{v:'<script>'},after:{v:22}}]});await f.helper.check();assert.equal(JSON.stringify(f.view()).includes('HIDDEN'),false);f.head(3);f.helper.refresh();assert.equal(f.view().proposals[0].review,'stale');f.clock(5000);f.helper.poll();await new Promise(setImmediate);assert.equal(f.calls.length,2);f.helper.poll();assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.method==='GET'));}finally{f.helper.dispose();}
});
test('known cancellation acknowledges only admission; successful cancellation schedules status GET without replay',async()=>{
 const f=fixture();try{f.data(ownJob('known'));await f.helper.check();await f.helper.cancel();assert.match(f.view().message,/not proof work has stopped/);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);f.data({...ownJob('known','stopped'),expectedIntentRevision:2});f.clock(5000);f.helper.poll();await new Promise(setImmediate);assert.equal(f.calls.at(-1).method,'GET');assert.equal(f.view().jobs[0].status,'stopped');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);}finally{f.helper.dispose();}
});
test('two live tabs cannot erase an unknown identity through draft edits, absent GET or stale ready state',async()=>{
 const disk=new Map(),a=fixture(disk),b=fixture(disk);let c;
 try{await a.helper.check();await b.helper.check();b.helper.edit('ready stale tab');assert.equal(b.view().canSend,true);
 a.helper.edit('original exact\r\nrequest');a.mode('lost');await a.helper.send();const sent=JSON.parse(a.calls.at(-1).body);
 b.helper.edit('other draft');await b.helper.check();assert.equal(b.view().canSend,false);await b.helper.send();assert.equal(b.calls.filter(c=>c.method==='POST').length,0);
 c=fixture(disk);await c.helper.check();c.helper.edit(sent.text);assert.equal(c.view().canSend,false);await c.helper.send();assert.equal(c.calls.filter(c=>c.method==='POST').length,0);
 assert.ok([...disk.values()].some(raw=>raw.includes(sent.commandId)));
 }finally{a.helper.dispose();b.helper.dispose();c?.helper.dispose();}
});
const base='workagent:native-agent:owner:A:b:1';
const identities=disk=>[...disk].filter(([k])=>k.startsWith(base+':command:')).map(([,v])=>JSON.parse(v));
test('a ready stale tab reconciles before refresh, send and cancel without relying on another GET',async()=>{
 for(const action of ['refresh','send','cancel']){
  const disk=new Map(),a=fixture(disk),b=fixture(disk);
  try{await a.helper.check();b.data(action==='cancel'?ownJob('active'):empty());await b.helper.check();b.helper.edit('B ready');a.helper.edit('A unknown');a.mode('lost');await a.helper.send();
   await b.helper[action]();assert.equal(b.view().canSend,false);assert.equal(b.view().canCancel,false);assert.equal(b.calls.filter(c=>c.method==='POST').length,0);assert.equal(identities(disk).length,1);
  }finally{a.helper.dispose();b.helper.dispose();}
 }
});
test('delayed POST and stale GET evidence never overwrite another command or regress terminal admission; drafts separate',async()=>{
 const disk=new Map(),a=fixture(disk),b=fixture(disk),stale=fixture(disk);let c;
 try{await a.helper.check();a.helper.edit('first exact\r\n');a.mode('hold');const sending=a.helper.send();const first=JSON.parse(a.calls.at(-1).body);
 stale.data(ownJob(first.commandId,'running'));stale.mode('hold');const reading=stale.helper.check();
 b.data(ownJob(first.commandId,'ready'));await b.helper.check();b.helper.edit('second exact');b.mode('lost');await b.helper.send();const second=JSON.parse(b.calls.at(-1).body);
 b.helper.edit('newer shared draft');const before=identities(disk).map(x=>JSON.stringify(x)).sort();
 a.release();await sending;stale.release();await reading;
 assert.deepEqual(identities(disk).map(x=>JSON.stringify(x)).sort(),before);assert.equal(identities(disk).length,2);
 assert.equal(initialNativeAgentView(session,b.storage).draft,'newer shared draft');assert.equal(identities(disk).find(r=>r.commandId===first.commandId).text,'first exact\r\n');assert.equal(identities(disk).find(r=>r.commandId===second.commandId).text,'second exact');
 c=fixture(disk);await c.helper.check();assert.equal(c.view().canSend,false);c.data(ownJob(second.commandId,'ready'));await c.helper.check();c.helper.edit('third explicit request');assert.equal(c.view().canSend,true,'late running/POST must not erase observed terminal first job');
 }finally{a.helper.dispose();b.helper.dispose();stale.helper.dispose();c?.helper.dispose();}
});
test('legacy mixed records and CRLF draft migrate compatibly without modifying originals; unrelated scopes untouched',async()=>{
 const command=(id,kind='continue')=>({commandId:id,kind,...(kind==='continue'?{text:'original '+id+'\r\n'}:{}),sourceIds:[],expectedIntentRevision:0,accessRevision:1});
 const raw=JSON.stringify({version:1,draft:'legacy\r\nexact',records:[{input:command('done'),admission:'admitted',outcome:'ready',intentRevision:1},{input:command('unknown'),admission:'unknown'},{input:command('cancel','cancel'),admission:'unknown'}]},null,2);
 const disk=new Map([[base,raw],['unrelated-draft','keep exact'],['workagent:native-agent:peer:A:b:1','foreign malformed metadata']]);const f=fixture(disk);let g;
 try{assert.equal(f.view().draft,'legacy\r\nexact');assert.equal(identities(disk).length,3);await f.helper.check();f.helper.edit('changed current draft');assert.equal(f.view().canSend,false);assert.equal(disk.get(base),raw);assert.equal(disk.get('unrelated-draft'),'keep exact');
 g=fixture(disk);assert.equal(g.view().draft,'changed current draft');g.data(ownJob('unknown','ready'));await g.helper.check();assert.equal(g.view().canSend,false,'unknown cancellation remains unknown');assert.equal(disk.get(base),raw);
 }finally{f.helper.dispose();g?.helper.dispose();}
});
test('malformed/conflicting identities, unavailable enumeration and write failure fail closed without deleting originals',async()=>{
 const input={commandId:'fixed',kind:'continue',text:'immutable',sourceIds:[],expectedIntentRevision:0,accessRevision:1};
 for(const raw of ['null','{invalid',JSON.stringify({...input,accessRevision:2})]){
  const disk=new Map([[base+':command:fixed',raw]]),f=fixture(disk);try{await f.helper.check();f.helper.edit('new');await f.helper.send();assert.equal(f.calls.filter(c=>c.method==='POST').length,0);assert.equal(disk.get(base+':command:fixed'),raw);}finally{f.helper.dispose();}
 }
 const old=JSON.stringify({version:1,draft:'old',records:[{input,admission:'unknown'}]});const disk=new Map([[base,old],[base+':command:fixed',JSON.stringify({...input,text:'different'})]]),f=fixture(disk);
 try{await f.helper.check();f.helper.edit('new');await f.helper.send();assert.equal(f.view().canSend,false);assert.equal(disk.get(base),old);assert.equal(JSON.parse(disk.get(base+':command:fixed')).text,'different');}finally{f.helper.dispose();}
 const views=[],h=nativeAgent(session,()=>true,()=>false,()=>2,v=>views.push(v),async()=>({ok:true,json:async()=>empty()}),{getItem:()=>null,setItem:()=>{throw Error('unavailable');}});
 try{await h.check();h.edit('retain locally');await h.send();assert.equal(views.at(-1).canSend,false);assert.equal(h.canLeave(),false);}finally{h.dispose();}
 const w=fixture();try{await w.helper.check();w.helper.edit('saved draft');w.broken(true);await w.helper.send();assert.equal(w.calls.filter(c=>c.method==='POST').length,0);assert.equal(w.view().draft,'saved draft');}finally{w.helper.dispose();}
});
test('own admitted running request can cancel exactly once; admission and stopped job remain distinct',async()=>{
 const f=fixture();try{
  await f.helper.check();f.helper.edit('own request to cancel');await f.helper.send();
  const original=JSON.parse(f.calls.find(c=>c.method==='POST').body),saved=f.disk.get(base+':command:'+original.commandId);
  f.data(ownJob(original.commandId,'running'));await f.helper.check();assert.equal(f.view().canCancel,true);
  await f.helper.cancel();const posts=f.calls.filter(c=>c.method==='POST');assert.equal(posts.length,2);const cancel=JSON.parse(posts[1].body);
  assert.equal(cancel.kind,'cancel');assert.notEqual(cancel.commandId,original.commandId);assert.equal(cancel.expectedIntentRevision,1);
  assert.equal(f.disk.get(base+':command:'+original.commandId),saved);assert.match(f.view().message,/Cancellation admitted, not proof work has stopped/);
  f.data({...ownJob(original.commandId,'running'),expectedIntentRevision:2});await f.helper.check();assert.equal(f.view().jobs[0].status,'running');
  f.data({...ownJob(original.commandId,'stopped'),expectedIntentRevision:2});await f.helper.check();assert.equal(f.view().jobs[0].status,'stopped');assert.equal(f.calls.filter(c=>c.method==='POST').length,2);
 }finally{f.helper.dispose();}
});
test('lost cancellation of own running request retains unknown cancellation with no resend/remount retry',async()=>{
 const f=fixture();let g;try{
  await f.helper.check();f.helper.edit('own request');await f.helper.send();const original=JSON.parse(f.calls.find(c=>c.method==='POST').body);
  f.data(ownJob(original.commandId,'running'));await f.helper.check();f.mode('lost');await f.helper.cancel();const posts=f.calls.filter(c=>c.method==='POST');assert.equal(posts.length,2);const cancel=JSON.parse(posts[1].body);
  f.mode('ok');f.data({...ownJob(original.commandId,'stopped'),expectedIntentRevision:2});await f.helper.check();assert.match(f.view().message,/unknown/);await f.helper.cancel();assert.equal(f.calls.filter(c=>c.method==='POST').length,2);
  g=fixture(f.disk);g.data({...ownJob(original.commandId,'stopped'),expectedIntentRevision:2});await g.helper.check();g.helper.edit('new distinct request');await g.helper.send();await g.helper.cancel();assert.equal(g.view().canSend,false);assert.equal(g.calls.filter(c=>c.method==='POST').length,0);assert.ok(identities(f.disk).some(r=>r.commandId===cancel.commandId));
 }finally{f.helper.dispose();g?.helper.dispose();}
});
test('identity appearing during reservation does not strand an eligible command before fetch; both inputs retained',async()=>{
 const f=fixture();try{
  await f.helper.check();f.helper.edit('eligible before reservation');const originalSet=f.storage.setItem;
  const concurrent={commandId:'concurrent-reservation',kind:'continue',text:'other tab exact input',sourceIds:[],expectedIntentRevision:0,accessRevision:1};let injected=false;
  f.storage.setItem=(k,v)=>{originalSet(k,v);if(!injected&&k.startsWith(base+':command:')){injected=true;originalSet(base+':command:'+concurrent.commandId,JSON.stringify(concurrent));}};
  await f.helper.send();assert.equal(f.calls.filter(c=>c.method==='POST').length,1,'server intent CAS, not a second client reservation check, arbitrates admission');
  assert.equal(identities(f.disk).length,2);assert.deepEqual(identities(f.disk).find(r=>r.commandId===concurrent.commandId),concurrent);
  f.helper.edit('must wait now');await f.helper.send();assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.view().canSend,false,'next action sees retained unknown');
 }finally{f.helper.dispose();}
});
test('acceptance-enabled request status describes automatic behavior, not global proposal application',async()=>{
 const f=fixture(new Map(),{...session,acceptance:true});
 const historical='Proposals are not applied.';
 const proposed={id:'p',review:'stale',basis:{nativeRevision:2},patch:{cells:[{sheetId:'sheet-1',row:0,column:0}]},before:{v:11},after:{v:33}};
 try{
  f.helper.edit('request draft remains exact\r\n');const disk=new Map(f.disk);
  for(const state of ['running','ready']){
   const result={...ownJob('known',state),nativeRevision:3,proposals:[proposed]};result.jobs[0].messages=[{text:historical}];f.data(result);await f.helper.check();
   assert.match(f.view().message,/never apply.*automatically/i);assert.match(f.view().message,/acceptance status/i);assert.doesNotMatch(f.view().message,/proposals are not applied/i);
   assert.equal(f.view().jobs[0].messages[0].text,historical);assert.equal(f.view().proposals[0].review,'stale');assert.equal(f.view().proposals[0].before,'11');assert.equal(f.view().proposals[0].after,'33');assert.equal(f.view().draft,'request draft remains exact\r\n');
  }
  assert.ok(f.calls.every(c=>c.method==='GET'));assert.deepEqual(f.disk,disk);
 }finally{f.helper.dispose();}
 const off=fixture();try{await off.helper.check();assert.match(off.view().message,/proposals are not applied/i);assert.doesNotMatch(off.view().message,/acceptance status/i);}finally{off.helper.dispose();}
});
