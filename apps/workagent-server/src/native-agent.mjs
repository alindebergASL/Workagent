// Read/propose only. Native service history is the sole content authority.
import { Fault, revision } from '../../../packages/workagent-contract/index.mjs';
import { authorize, digest, event, intentConditions, same } from './workspace.mjs';
import { UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { createSheetReader } from '../../workagent-runner/src/sheet-read.mjs';
const fail = (code, status=409) => { throw new Fault(code,status); };
const context = principal => ({userID:principal,customData:{},request:{}});
const session = (principal,unitID,epoch) => ({userID:principal,unitID,revision:epoch});
export class NativeAgent {
  constructor(authority,service,dbAdapter) {
    Object.assign(this,{authority,service,dbAdapter});this.workspace=authority.workspace;
    this.enabled=false;this.bases=new WeakMap();this.workspace.nativeAgent=this;
  }
  admission(s,principal,input) {
    authorize(s,principal);
    if(!this.enabled||!this.workspace.nativeEnabled)fail('native_agent_disabled');
    if(!input||Object.keys(input).some(k=>!['commandId','kind','workId','text','sourceIds','expectedIntentRevision','accessRevision'].includes(k))||!['continue','cancel'].includes(input.kind)||input.sourceIds?.length!==0)fail('native_agent_command_invalid',400);
    revision(input.accessRevision);
    this.authority.check(s,principal,input.workId,true,session(principal,input.workId,input.accessRevision));
    if(s.works[input.workId].status==='creating')fail('native_work_not_ready');
  }
  admit(principal,unitID,input) {
    if(input?.workId!==undefined&&input.workId!==unitID)fail('native_agent_unit_mismatch');
    return this.workspace.admitCommand(principal,{...input,workId:unitID},this);
  }
  check(s,principal,job) {
    authorize(s,principal);if(!this.enabled||this.workspace.nativeAgent!==this)fail('native_agent_disabled');
    const j=s.jobs[job.id];
    if(!j||j.kind!=='native-agent'||j.principal!==principal||j.workId!==job.workId||j.sessionId!==job.sessionId||j.status!=='running'||digest(j.expected)!==digest(job.expected))fail('native_agent_job_inactive');
    this.authority.check(s,principal,j.workId,true,session(principal,j.workId,j.expected.accessRevision));
    const w=s.works[j.workId];if(!same(j.expected,intentConditions(s,w))||['stopped','cancellation_requested'].includes(w.status))fail('work_superseded');
    return w;
  }
  async authorize(principal,job) {
    return this.workspace.store.read(s=>{const w=this.check(s,principal,job);return {id:w.id,kind:'native-sheet',...intentConditions(s,w),expected:intentConditions(s,w)};});
  }
  async head(principal,unitID) {
    const u=await this.dbAdapter.getUnit(context(principal),unitID);
    if(!u||!Number.isSafeInteger(u.headRevision)||u.headRevision<1)fail('native_agent_head_unavailable');
    return u.headRevision;
  }
  async load(principal,job,head) {
    // SDK read middleware takes its own Workspace lock. Never call it inside
    // another canonical transaction; revalidate after async materialization.
    const scope={unitID:job.workId,session:session(principal,job.workId,job.expected.accessRevision)};
    const load=await this.authority.scope.run(scope,()=>this.service.getUnitLoadDataWithBlocks({unitID:job.workId,type:2,revision:head},{userID:principal}));
    if(load.targetRevision!==head)fail('native_agent_revision_unavailable');
    const materializer=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});
    try {const m=await materializer.materializeSnapshot(load);return await transformSnapshotToWorkbookData(m.snapshot,[...m.sheetBlocks]);}
    finally {await materializer.dispose();}
  }
  async read(principal,job,query,reader=createSheetReader(job.workId)) {
    let head;
    await this.workspace.store.transaction(async s=>{this.check(s,principal,job);head=await this.head(principal,job.workId);});
    const data=await this.load(principal,job,head);
    // Explicit ephemeral projection, not w.book or a writable content mirror.
    // Resources, comment claims, native request IDs and private metadata never
    // enter the reader. Formula caches remain unknown in the existing reader.
    const book={id:job.workId,name:data.name,sheetOrder:data.sheetOrder,styles:{},resources:[],sheets:{}};
    for(const sid of data.sheetOrder){const sheet=data.sheets[sid],cellData={};for(const [r,row] of Object.entries(sheet.cellData??{})){cellData[r]={};for(const [c,cell] of Object.entries(row)){if(!cell)continue;const out={};for(const k of ['v','t','f','si'])if(Object.hasOwn(cell,k))out[k]=cell[k];if(cell.p?.body?.dataStream!==undefined)out.p={body:{dataStream:cell.p.body.dataStream}};cellData[r][c]=out;}}
      book.sheets[sid]={id:sid,name:sheet.name,rowCount:sheet.rowCount,columnCount:sheet.columnCount,cellData};}
    const expected={contentRevision:head,intentRevision:job.expected.intentRevision,permissionRevision:job.expected.permissionRevision,cancellationEpoch:job.expected.cancellationEpoch};
    const basis={unitID:job.workId,nativeRevision:head,accessRevision:job.expected.accessRevision,intentRevision:job.expected.intentRevision,permissionRevision:job.expected.permissionRevision,cancellationEpoch:job.expected.cancellationEpoch,jobID:job.id,sessionID:job.sessionId};
    const result=JSON.parse(reader({id:job.workId,book,humanCells:[],expected},query));
    const {jobID:_jobID,sessionID:_sessionID,...publicBasis}=basis;
    result.nativeBasis=publicBasis;result.editPolicy='Native read/propose only: one plain scalar cell; no mutation or acceptance. expected.contentRevision is the native head, not a product snapshot revision. Formatting/resources omitted from model view; full cell and style evidence retained by host.';
    return this.workspace.store.transaction(async s=>{
      this.check(s,principal,job);if(await this.head(principal,job.workId)!==head)fail('native_agent_head_changed_restart_read');
      return {result:JSON.stringify(result),basis};
    }).then(value=>{
      // Stores clone transaction results; bind only the returned host-owned basis.
      this.bases.set(value.basis,{principal,jobID:job.id,sessionID:job.sessionId,data,hash:digest(value.basis)});return value;
    });
  }
  async propose(principal,job,callId,raw,basis) {
    if(typeof callId!=='string'||!callId||callId.length>200)fail('native_call_not_bound');if(typeof raw!=='string'||raw.length>30000)fail('native_agent_patch_invalid',400);
    const key=digest({operation:'native-agent-scalar',session:job.sessionId,callId});
    return this.workspace.store.transaction(async s=>{
      const w=this.check(s,principal,job),proposals=w.nativeAgentProposals??={};
      const old=proposals[key];if(old){if(old.raw!==raw)fail('command_conflict');return {status:'proposed',proposalId:key,nativeRevision:old.basis.nativeRevision,review:old.review};}
      const evidence=this.bases.get(basis);
      if(!evidence||evidence.principal!==principal||evidence.jobID!==job.id||evidence.sessionID!==job.sessionId||evidence.hash!==digest(basis)||basis.unitID!==job.workId)fail('native_agent_read_required');
      let patch;try{patch=JSON.parse(raw);}catch{fail('native_agent_patch_invalid',400);}
      if(!patch||Object.keys(patch).join()!=='cells'||!Array.isArray(patch.cells)||patch.cells.length!==1)fail('native_agent_scalar_only',400);
      const cell=patch.cells[0];if(!cell||Object.keys(cell).some(k=>!['sheetId','row','column','value'].includes(k))||!Number.isSafeInteger(cell.row)||!Number.isSafeInteger(cell.column)||cell.row<0||cell.column<0||!['string','number','boolean'].includes(typeof cell.value)&&cell.value!==null||typeof cell.value==='number'&&!Number.isFinite(cell.value)||typeof cell.value==='string'&&(cell.value.length>20000||cell.value.startsWith('=')))fail('native_agent_scalar_only',400);
      if(typeof cell.sheetId!=='string'||!evidence.data.sheetOrder.includes(cell.sheetId)||!Object.hasOwn(evidence.data.sheets,cell.sheetId))fail('native_agent_cell_invalid',400);
      const sheet=evidence.data.sheets[cell.sheetId];if(!sheet||cell.row>=sheet.rowCount||cell.column>=sheet.columnCount)fail('native_agent_cell_invalid',400);
      const before=structuredClone(sheet.cellData?.[cell.row]?.[cell.column]??null);
      if(before&&(Object.keys(before).some(k=>!['v','t','f','si','s','ft','fd'].includes(k))||['f','si','ft','fd'].some(k=>before[k]!=null)))fail('native_agent_scalar_only',400);
      const style=typeof before?.s==='string'?evidence.data.styles?.[before.s]:before?.s;
      if(typeof before?.s==='string'&&style===undefined)fail('native_agent_style_unavailable');
      const after={...(before??{}),v:cell.value};if(cell.value===null)delete after.t;else after.t=({string:1,number:2,boolean:3})[typeof cell.value];
      if(Object.keys(proposals).length>=1024)fail('native_agent_proposal_capacity');
      const head=await this.head(principal,job.workId),review=head===basis.nativeRevision?'pending':'stale';
      proposals[key]={id:key,principal,raw,patch:structuredClone(patch),basis:structuredClone(basis),provenance:{jobID:job.id,sessionID:job.sessionId,callID:callId},before,after,style:structuredClone(style??null),cellHash:digest({before,style:style??null}),review};
      event(s,w,'native_agent_proposed');
      return {status:'proposed',proposalId:key,nativeRevision:basis.nativeRevision,review};
    });
  }
  async inspect(principal,unitID,epoch,send) {
    revision(epoch);
    await this.workspace.store.transaction(async s=>{
      authorize(s,principal);if(!this.enabled||this.workspace.nativeAgent!==this)fail('native_agent_disabled');
      this.authority.check(s,principal,unitID,true,session(principal,unitID,epoch));
      const w=s.works[unitID],head=await this.head(principal,unitID);
      // Recheck before synchronous response enqueue under the same Workspace
      // lock. Historical evidence belongs to this owner/unit, not the old grant.
      authorize(s,principal);if(!this.enabled||this.workspace.nativeAgent!==this)fail('native_agent_disabled');
      this.authority.check(s,principal,unitID,true,session(principal,unitID,epoch));
      send({unitID,nativeRevision:head,expectedIntentRevision:w.intentRevision??0,accessRevision:epoch,status:w.status,jobs:Object.values(s.jobs).filter(j=>j.kind==='native-agent'&&j.workId===unitID&&j.principal===principal).slice(-20).map(j=>({id:j.id,status:j.status,phase:j.phase,errorCode:j.errorCode,messages:structuredClone(j.messages??[])})),proposals:Object.values(w.nativeAgentProposals??{}).filter(p=>p.principal===principal&&p.basis.unitID===unitID).slice(-50).map(p=>({...structuredClone(p),review:p.basis.nativeRevision===head&&same(p.basis,intentConditions(s,w))?p.review:'stale'}))});
    });
  }
}
