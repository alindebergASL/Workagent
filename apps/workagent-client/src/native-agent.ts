import type { NativeSession } from './NativeCollaborationEditor';
interface Command { commandId: string; kind: 'continue' | 'cancel'; text?: string; sourceIds: never[]; expectedIntentRevision: number; accessRevision: number }
interface Record { input: Command; admission: 'unknown' | 'admitted'; outcome?: string; intentRevision?: number }
interface Retained { version: 1; draft: string; records: Record[] }
interface Job { id: string; status: string; phase?: string; errorCode?: string; messages: { text: string }[] }
interface Proposal { id: string; review: string; revision: number; sheet: string; row: number; column: number; before: string; after: string }
interface Snapshot { expectedIntentRevision: number; nativeRevision: number; jobs: Job[]; proposals: Proposal[] }
export interface NativeAgentView { draft: string; message: string; busy: boolean; canSend: boolean; canCancel: boolean; canCheck: boolean; jobs: Job[]; proposals: Proposal[]; retained: boolean; priorUnknown: boolean; unsaved: boolean }
type StorageLike = Pick<Storage,'getItem'|'setItem'> & Partial<Pick<Storage,'key'|'length'>>;
const prefix = (s: NativeSession) => `workagent:native-agent:${s.principal}:${s.unitID}:`;
const key = (s: NativeSession) => `${prefix(s)}${s.binding}:${s.access.revision}`;
const owner = (s: NativeSession) => s.agent === true && s.owner && s.access.role === 'owner';
const active = (status: string) => ['queued','running'].includes(status);
const complete = (status?: string) => ['ready','stopped','superseded','incomplete','blocked'].includes(status ?? '');
const statuses = ['queued','running','ready','stopped','superseded','incomplete','blocked','interrupted','failed'];
const encoded = (id: string) => encodeURIComponent(id);
function validInput(v: Command, epoch: number) {
  return v && typeof v.commandId==='string' && !!v.commandId && ['continue','cancel'].includes(v.kind)
    && (v.kind==='continue'?typeof v.text==='string':v.text===undefined) && Array.isArray(v.sourceIds) && v.sourceIds.length===0
    && Number.isSafeInteger(v.expectedIntentRevision) && v.expectedIntentRevision>=0 && v.accessRevision===epoch
    && Object.keys(v).every(k=>['commandId','kind','text','sourceIds','expectedIntentRevision','accessRevision'].includes(k));
}
const canonical = (v: Command) => JSON.stringify({commandId:v.commandId,kind:v.kind,...(v.kind==='continue'?{text:v.text}:{}),sourceIds:v.sourceIds,expectedIntentRevision:v.expectedIntentRevision,accessRevision:v.accessRevision});
function legacy(base: string, storage: StorageLike): Retained {
  const raw=storage.getItem(base);if(raw===null)return {version:1,draft:'',records:[]};
  const v=JSON.parse(raw) as Retained;
  if(!v || v.version!==1||typeof v.draft!=='string'||!Array.isArray(v.records))throw Error('Invalid retained request metadata');
  return v;
}
function draft(base: string, storage: StorageLike) {
  const raw=storage.getItem(base+':draft');if(raw===null)return legacy(base,storage).draft;
  const v=JSON.parse(raw);if(v?.version!==1||typeof v.text!=='string')throw Error('Invalid retained draft');return v.text as string;
}
function keys(storage: StorageLike) {
  if(typeof storage.length!=='number'||!storage.key)throw Error('Cannot enumerate retained commands');
  const result:string[]=[];for(let i=0;i<storage.length;i++){const k=storage.key(i);if(typeof k!=='string')throw Error('Cannot enumerate retained commands');result.push(k);}return result;
}
// Separate immutable identities and append-only evidence. Never rewrite the legacy
// aggregate. localStorage is NOT a cross-process transaction/lock; server intent CAS
// still arbitrates simultaneous admissions. Observed uncertainty always blocks sends.
function identity(base:string,input:Command,storage:StorageLike) {
  const k=base+':command:'+encoded(input.commandId),value=canonical(input),old=storage.getItem(k);
  if(old!==null && canonical(JSON.parse(old))!==value)throw Error('Retained command identity conflict');
  if(old===null)storage.setItem(k,value);
  if(storage.getItem(k)!== (old??value))throw Error('Retained command identity changed');
}
function evidence(base:string,input:Command,storage:StorageLike,status?:string) {
  if(status!==undefined&&!statuses.includes(status))throw Error('Unknown job status; retain uncertainty');
  const k=base+':evidence:'+encoded(input.commandId)+':'+(status??'admitted'),value=canonical(input),old=storage.getItem(k);
  if(old!==null&&old!==value)throw Error('Retained evidence identity conflict');
  if(old===null)storage.setItem(k,value);
}
function records(base:string,epoch:number,storage:StorageLike): Record[] {
  const old=legacy(base,storage);
  for(const r of old.records){
    if(!r || !validInput(r.input,epoch)||!['unknown','admitted'].includes(r.admission)
      || r.outcome!==undefined&&(r.admission!=='admitted'||r.input.kind!=='continue'||!statuses.includes(r.outcome))
      || r.intentRevision!==undefined&&r.intentRevision!==r.input.expectedIntentRevision+1)throw Error('Invalid retained command');
    identity(base,r.input,storage);
    if(r.admission==='admitted')evidence(base,r.input,storage,r.outcome);
  }
  const all=keys(storage), found=new Map<string,Record>();
  for(const k of all)if(k.startsWith(base+':command:')){
    const input=JSON.parse(storage.getItem(k)??'null') as Command;
    if(!validInput(input,epoch)||k!==base+':command:'+encoded(input.commandId))throw Error('Invalid command identity');
    found.set(input.commandId,{input,admission:'unknown'});
  }
  for(const k of all)if(k.startsWith(base+':evidence:')){
    const input=JSON.parse(storage.getItem(k)??'null') as Command;
    if(!validInput(input,epoch))throw Error('Invalid evidence');
    const r=found.get(input.commandId),start=base+':evidence:'+encoded(input.commandId)+':',status=k.slice(start.length);
    if(!k.startsWith(start)||!r||canonical(r.input)!==canonical(input)||!['admitted',...statuses].includes(status)
      ||status!=='admitted'&&input.kind!=='continue')throw Error('Invalid evidence binding');
    r.admission='admitted';r.intentRevision=input.expectedIntentRevision+1;
    // A late running/POST observation cannot erase an already observed terminal
    // job. All factual observations remain available; absence adds no evidence.
    if(status!=='admitted'&&(!r.outcome||!complete(r.outcome)))r.outcome=status;
  }
  return [...found.values()];
}
const draftValue = (s:NativeSession,storage:StorageLike) => draft(key(s),storage);
export function initialNativeAgentView(s: NativeSession, storage: StorageLike): NativeAgentView {
  let draft='',message='Check request status before sending. No model request has been sent.';
  if(owner(s))try{draft=draftValue(s,storage);}catch{message='Stored request metadata unavailable. Sending disabled; retain this tab.';}
  return {draft,message,busy:false,canSend:false,canCancel:false,canCheck:false,jobs:[],proposals:[],retained:false,priorUnknown:false,unsaved:false};
}
// Only existing same-origin command/status endpoints. No inference loop or native
// operation/session. All durable identities are append-only; nothing is replayed.
export function nativeAgent(session: NativeSession, healthy: () => boolean, inputBusy: () => boolean, head: () => number,
  update: (v: NativeAgentView) => void, fetcher: typeof fetch, storage: StorageLike, now=Date.now) {
  let state: Retained={version:1,draft:'',records:[]}, snapshot: Snapshot | undefined;
  let live=true, fenced=false, busy=false, failedStorage=false, unsaved=false, generation=0, priorUnknown=false;
  let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, lastPoll=0, polls=0, needsCheck=false;
  let message=owner(session)?'Check request status before sending.':'Owner requests unavailable.';
  const failStorage=()=>{failedStorage=true;message='Stored request metadata unavailable or conflicting. Sending disabled; retain this tab and all identities.';};
  function reconcile(){
    if(!owner(session)||failedStorage)return;
    try{
      state.records=records(key(session),session.access.revision,storage);
      for(const k of keys(storage))if(k.startsWith(prefix(session))&&!k.startsWith(key(session)+':')&&k!==key(session)){
        // Scope base keys end in an access revision; new keys have a named suffix.
        const base=k.split(/:(?:draft|command|evidence)(?=:|$)/)[0];
        const epoch=Number(base.slice(base.lastIndexOf(':')+1));
        if(base===key(session))continue;
        if(!Number.isSafeInteger(epoch))throw Error('Unrecognized retained scope');
        if(records(base,epoch,storage).some(r=>r.admission==='unknown'||r.input.kind==='continue'&&!complete(r.outcome)))priorUnknown=true;
      }
    }catch{failStorage();}
  }
  if(owner(session))try{state.draft=draftValue(session,storage);reconcile();if(!failedStorage&&state.records.length)message='Retained requests: check status (GET only). No automatic retry.';}catch{failStorage();}
  const available=()=>live&&!fenced&&owner(session)&&healthy();
  const unknown=()=>state.records.some(r=>r.admission==='unknown');
  const outstanding=()=>state.records.some(r=>r.input.kind==='continue'&&!complete(r.outcome));
  const sendable=()=>available()&&!busy&&!failedStorage&&!!snapshot&&!unknown()&&!outstanding()&&!snapshot.jobs.some(j=>active(j.status))&&!inputBusy()&&!!state.draft.trim()&&!state.records.some(r=>r.input.kind==='continue'&&r.input.text===state.draft);
  const cancelable=()=>available()&&!busy&&!failedStorage&&!!snapshot&&!unknown()&&!inputBusy()&&snapshot.jobs.some(j=>active(j.status))&&!state.records.some(r=>r.input.kind==='cancel'&&r.input.expectedIntentRevision===snapshot!.expectedIntentRevision);
  const emit=()=>{reconcile();if(live)update({draft:state.draft,message:!healthy()&&!fenced?'Native session not ready — requests paused; draft and identities retained.':message,busy,canSend:sendable(),canCancel:cancelable(),canCheck:available()&&!busy,jobs:snapshot?.jobs??[],proposals:(snapshot?.proposals??[]).map(p=>({...p,review:head()>p.revision?'stale':p.review})),retained:state.records.length>0,priorUnknown,unsaved});};
  const save=()=>{try{storage.setItem(key(session)+':draft',JSON.stringify({version:1,text:state.draft}));unsaved=false;return true;}catch{failedStorage=true;unsaved=true;message='Cannot persist draft/request identity. Nothing new will be sent; keep this tab open.';return false;}};
  const begin=()=>{busy=true;controller=new AbortController();timer=setTimeout(()=>controller?.abort(),15000);return ++generation;};
  const valid=(n:number)=>live&&!fenced&&n===generation;
  const headers={'X-Workagent-Session-Binding':session.binding};
  const url=`/api/work/${session.unitID}/native-agent/${session.access.revision}`;
  function deny(){fenced=true;snapshot=undefined;message='Access changed — request data hidden; draft and identities retained. No retry.';}
  async function check() {
    if(!available()||busy)return;const n=begin();emit();
    try{
      const response=await fetcher(url,{method:'GET',credentials:'same-origin',headers,signal:controller!.signal});
      if(!valid(n))return;if(response.status===401||response.status===403){deny();return;}if(!response.ok)throw Error('Request status unavailable. Retained outcomes remain unknown; no retry.');
      const value=await response.json();if(!valid(n))return;
      if(value.unitID!==session.unitID||value.accessRevision!==session.access.revision){deny();return;}
      if(!Number.isSafeInteger(value.expectedIntentRevision)||!Number.isSafeInteger(value.nativeRevision)||!Array.isArray(value.jobs)||!Array.isArray(value.proposals))throw Error('Request status response invalid; no retry.');
      // Whitelist display data; raw provenance/session/call/auth fields are never
      // kept in the view or rendered, even though owner inspection returns them.
      snapshot={expectedIntentRevision:value.expectedIntentRevision,nativeRevision:value.nativeRevision,jobs:value.jobs.slice(-20).map((j:Job)=>({id:j.id,status:j.status,phase:j.phase,errorCode:j.errorCode,messages:(j.messages??[]).map(m=>({text:String(m.text)}))})),proposals:value.proposals.slice(-50).map((p:{id:string;review:string;basis:{nativeRevision:number};patch:{cells:{sheetId:string;row:number;column:number}[]};before?:{v?:unknown};after?:{v?:unknown}})=>({id:p.id,review:p.review,revision:p.basis.nativeRevision,sheet:p.patch.cells[0].sheetId,row:p.patch.cells[0].row,column:p.patch.cells[0].column,before:String(p.before?.v??'(empty)'),after:String(p.after?.v??'(empty)')}))};
      reconcile();
      if(!failedStorage)for(const r of state.records)if(r.input.kind==='continue'){const j=snapshot.jobs.find(j=>j.id===r.input.commandId);if(j)try{evidence(key(session),r.input,storage,j.status);}catch{failStorage();}}
      needsCheck=false;reconcile();
      if(!failedStorage)message=unknown()?'Outcome unknown for a retained command. An absent job or later intent does not prove failure or cancellation. Check status; do not resend.':snapshot.jobs.some(j=>j.status==='interrupted'||j.status==='failed'||j.errorCode)?'A job is interrupted, failed or refused. Inspect its status; no automatic retry or replay.':snapshot.jobs.some(j=>active(j.status))?'Request admitted; agent work is still in progress. Proposals are not applied.':'Status checked. Completed answers and proposals below; proposals are not applied.';
    }catch(error){if(valid(n)){snapshot=undefined;message=error instanceof Error?error.message:'Request status unknown.';}}
    finally{clearTimeout(timer);if(live&&n===generation){busy=false;emit();}}
  }
  async function post(kind:'continue'|'cancel') {
    reconcile();
    if(kind==='continue'?!sendable():!cancelable()){message='Request unavailable: check status, resolve retained uncertainty and finish native cell input/paste/composition/pending edits first. A new request must have distinct text.';emit();return;}
    const input:Command={commandId:crypto.randomUUID(),kind,...(kind==='continue'?{text:state.draft}:{}),sourceIds:[],expectedIntentRevision:snapshot!.expectedIntentRevision,accessRevision:session.access.revision};
    try{identity(key(session),input,storage);}catch{failStorage();emit();return;}
    reconcile();
    // Eligibility was checked against shared records before reservation. Do not
    // strand a never-submitted identity when another tab reserves concurrently,
    // or mistake our own running job for a cancellation conflict. The server's
    // expected-intent CAS arbitrates simultaneous submissions.
    if(failedStorage){emit();return;}
    const n=begin();message=kind==='continue'?'Sending one explicit request; admission is not completion.':'Sending one cancellation command; work is not yet confirmed stopped.';emit();
    try{
      const response=await fetcher(url,{method:'POST',credentials:'same-origin',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller!.signal});
      if(!valid(n))return;if(response.status===401||response.status===403){deny();return;}if(!response.ok)throw Error('Command refused or reply uncertain. Identity and text retained; GET status only, no repost.');
      const result=await response.json();if(!valid(n))return;
      if(result.commandId!==input.commandId||result.workId!==session.unitID||result.intentRevision!==input.expectedIntentRevision+1)throw Error('Admission response mismatch. Identity retained; GET status only.');
      try{evidence(key(session),input,storage);
        if(kind==='continue'&&state.draft===input.text&&draftValue(session,storage)===input.text){state.draft='';save();}
      }catch{failStorage();}
      reconcile();snapshot=undefined;polls=0;needsCheck=true;
      if(!failedStorage)message=kind==='continue'?'Request admitted, not complete. Check status for answers and proposals.':'Cancellation admitted, not proof work has stopped. Check job status.';
    }catch(error){if(valid(n))message=error instanceof Error?error.message:'Command outcome unknown; no retry.';}
    finally{clearTimeout(timer);if(live&&n===generation){busy=false;emit();}}
  }
  emit();
  return {check,send:()=>post('continue'),cancel:()=>post('cancel'),
    edit(text:string){if(!live||!owner(session))return;state.draft=text;save();emit();},
    refresh(){emit();},
    poll(){emit();if(!available()||busy||polls>=60||now()-lastPoll<5000)return;if(needsCheck||snapshot?.jobs.some(j=>active(j.status))||state.records.some(r=>r.admission==='admitted'&&r.input.kind==='continue'&&!r.outcome)){lastPoll=now();polls++;void check();}},
    canLeave:()=>!unsaved,
    dispose(){if(!live)return;live=false;generation++;clearTimeout(timer);controller?.abort();snapshot=undefined;update({...initialNativeAgentView(session,storage),draft:state.draft,message:'Native agent session closed or access changed. Retained work is not replayed.',retained:state.records.length>0,priorUnknown,unsaved});}
  };
}
