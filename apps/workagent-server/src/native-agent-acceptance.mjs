import { mergedTarget } from './native-merge.mjs';
// Explicit human acceptance only. Canonical proposals are immutable; native
// changesets/history/CAS remain the only content and receipt authority.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { authorize, digest, intentConditions, same } from './workspace.mjs';
import { UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { SetRangeValuesMutation } from '@univerjs/sheets';
const fail=(code='native_acceptance_refused')=>{throw new Fault(code,409);};
const ident=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const abandonedUnused=i=>i.abandoned==='native_acceptance_abandoned_unused'&&!Object.hasOwn(i,'confirmed')&&!Object.hasOwn(i,'executor');
const context=userID=>({userID,customData:{},request:{}});
const resolved=(cell,style)=>cell===null?null:{...cell,...(typeof cell.s==='string'?{s:style}:{})};
const scalar=x=>x===null||['string','boolean'].includes(typeof x)||typeof x==='number'&&Number.isFinite(x);
export class NativeAgentAcceptance {
  constructor(authority,service,dbAdapter){Object.assign(this,{authority,service,dbAdapter});this.enabled=false;}
  check(s,principal,unitID,session){
    authorize(s,principal);
    if(!this.enabled||!this.authority.workspace.nativeEnabled)fail('native_acceptance_disabled');
    this.authority.check(s,principal,unitID,true,session);
  }
  origin(principal,unitID,session,binding,memberID){
    const origin=this.authority.sessions.get(memberID);
    return !!binding&&!!origin&&!origin.action&&origin.userID===principal&&origin.unitID===unitID&&origin.revision===session.revision&&origin.binding===binding;
  }
  proposal(s,principal,unitID,id){
    const p=s.works[unitID].nativeAgentProposals?.[id];
    if(!p||p.id!==id||p.principal!==principal||p.basis?.unitID!==unitID)fail('native_acceptance_proposal');
    return p;
  }
  current(s,principal,unitID,session,p){
    this.check(s,principal,unitID,session);
    if(p.review!=='pending'||!same(p.basis,intentConditions(s,s.works[unitID]))||p.basis.accessRevision!==session.revision)fail('native_acceptance_stale');
  }
  owned(s,principal,unitID,session,binding,id){
    this.check(s,principal,unitID,session);
    const i=s.works[unitID].nativeAgentAcceptances?.[id];
    if(!i||i.principal!==principal||i.epoch!==session.revision||!binding||i.binding!==binding)fail('native_acceptance_identity');
    return i;
  }
  async head(principal,unitID){return (await this.dbAdapter.getUnit(context(principal),unitID))?.headRevision;}
  async prepare(principal,unitID,session,binding,input,send){
    if(!input||Object.keys(input).some(k=>!['commandId','proposalId','memberID'].includes(k))||!ident(input.commandId)||!ident(input.proposalId)||!ident(input.memberID)||!binding)fail('native_acceptance_input');
    let p,old;
    await this.authority.workspace.store.transaction(async s=>{
      this.check(s,principal,unitID,session);old=s.works[unitID].nativeAgentAcceptances?.[input.commandId];
      if(old){if(!equal(old.target,input)||old.binding!==binding||old.principal!==principal||old.epoch!==session.revision)fail('native_acceptance_identity');return;}
      p=structuredClone(this.proposal(s,principal,unitID,input.proposalId));this.current(s,principal,unitID,session,p);
      if(await this.head(principal,unitID)!==p.basis.nativeRevision)fail('native_acceptance_head_changed');
      this.current(s,principal,unitID,session,p);
      if(!this.origin(principal,unitID,session,binding,input.memberID))fail('native_acceptance_origin');
    });
    if(old)return this.receipt(principal,unitID,session,binding,input.commandId,send);
    // Pinned public native materialization outside the Workspace lock: its SDK
    // read middleware obtains that same lock. No nested transaction or bypass.
    const load=await this.authority.scope.run({unitID,session},()=>this.service.getUnitLoadDataWithBlocks({unitID,type:2,revision:p.basis.nativeRevision},{userID:principal}));
    if(load.targetRevision!==p.basis.nativeRevision)fail('native_acceptance_history');
    const materializer=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});let params,preview;
    try{
      const m=await materializer.materializeSnapshot(load),data=await transformSnapshotToWorkbookData(m.snapshot,[...m.sheetBlocks]);
      const patch=p.patch,c=patch?.cells?.[0];
      if(!patch||Object.keys(patch).join()!=='cells'||patch.cells.length!==1||!c||Object.keys(c).some(k=>!['sheetId','row','column','value'].includes(k))||c.sheetId!=='sheet-1'||!Number.isSafeInteger(c.row)||!Number.isSafeInteger(c.column)||c.row<0||c.column<0||!scalar(c.value)||typeof c.value==='string'&&(c.value.length>20000||c.value.startsWith('=')))fail('native_acceptance_scalar_only');
      const sheet=data.sheets[c.sheetId];if(!sheet||c.row>=sheet.rowCount||c.column>=sheet.columnCount)fail('native_acceptance_cell');
      if(mergedTarget(sheet,c.row,c.column))fail('native_acceptance_merged_target');
      const before=sheet.cellData?.[c.row]?.[c.column]??null,style=typeof before?.s==='string'?data.styles?.[before.s]:before?.s;
      if(before&&(Object.keys(before).some(k=>!['v','t','f','si','s','ft','fd'].includes(k))||['f','si','ft','fd'].some(k=>before[k]!=null)||before.v!==undefined&&!scalar(before.v)))fail('native_acceptance_scalar_only');
      if(typeof before?.s==='string'&&style===undefined)fail('native_acceptance_style');
      const after={...(before??{}),v:c.value};if(c.value===null)delete after.t;else after.t=({string:1,number:2,boolean:3})[typeof c.value];
      // Public workbook materialization allocates new style IDs. Compare full
      // resolved cells/styles, retaining canonical proposal bytes unchanged.
      if(!equal(resolved(before,style),resolved(p.before,p.style)))fail('native_acceptance_cell_evidence');
      if(!equal(style??null,p.style))fail('native_acceptance_style_evidence');
      if(!equal(resolved(after,style),resolved(p.after,p.style)))fail('native_acceptance_after_evidence');
      if(digest({before:p.before,style:p.style})!==p.cellHash||!equal(JSON.parse(p.raw),patch))fail('native_acceptance_evidence');
      if(equal(before,after))fail('native_acceptance_no_change');
      params={unitId:unitID,subUnitId:c.sheetId,cellValue:{[c.row]:{[c.column]:structuredClone(p.after)}},...(typeof p.after?.s==='string'?{styleRefMap:{[p.after.s]:structuredClone(p.style)}}:{})};
      preview={sheetID:c.sheetId,row:c.row,column:c.column,before:structuredClone(p.before),after:structuredClone(p.after),style:structuredClone(p.style),nativeRevision:p.basis.nativeRevision};
    }finally{await materializer.dispose();}
    await this.authority.workspace.store.transaction(async s=>{
      this.check(s,principal,unitID,session);
      const current=this.proposal(s,principal,unitID,input.proposalId);this.current(s,principal,unitID,session,current);
      if(digest(current)!==digest(p))fail('native_acceptance_proposal_changed');
      const intents=s.works[unitID].nativeAgentAcceptances??={};
      if(intents[input.commandId]){const i=this.owned(s,principal,unitID,session,binding,input.commandId);if(!equal(i.target,input))fail('native_acceptance_identity');return;}
      // Only explicit abandonment of a never-confirmed/never-admitted preview
      // releases its target. Refusal, departure or absent history alone cannot.
      if(Object.values(intents).some(i=>i.target.proposalId===input.proposalId&&!abandonedUnused(i)))fail('native_acceptance_target_retained');
      if(Object.keys(intents).length>=1024)fail('native_acceptance_capacity');
      if(await this.head(principal,unitID)!==p.basis.nativeRevision)fail('native_acceptance_head_changed');
      this.current(s,principal,unitID,session,current);
      if(!this.origin(principal,unitID,session,binding,input.memberID))fail('native_acceptance_origin');
      const request={unitID,type:2,baseRev:p.basis.nativeRevision,revision:p.basis.nativeRevision+1,userID:principal,createTime:Math.floor(Date.now()/1000),sid:`acceptance_${randomUUID()}`,reqId:1,mutations:[{id:SetRangeValuesMutation.id,data:JSON.stringify(params)}]};
      intents[input.commandId]={principal,binding,epoch:session.revision,target:structuredClone(input),proposalHash:digest(p),basis:structuredClone(p.basis),request,hash:digest(request.mutations),preview};
    });
    return this.receipt(principal,unitID,session,binding,input.commandId,send);
  }
  // Return policy refusals rather than throwing through native middleware, so a
  // definitive refusal is retained and SDK errors stay nonretryable.
  async reason(s,i,session){
    const unitID=i.request.unitID;
    try{
      const p=this.proposal(s,i.principal,unitID,i.target.proposalId);this.current(s,i.principal,unitID,session,p);
      if(digest(p)!==i.proposalHash)return 'native_acceptance_proposal_changed';
      if(await this.head(i.principal,unitID)!==i.request.baseRev)return 'native_acceptance_head_changed';
      this.current(s,i.principal,unitID,session,p);
      if(!this.origin(i.principal,unitID,session,i.binding,i.target.memberID))return 'native_acceptance_origin';
    }catch(e){if(e instanceof Fault)return e.code;throw e;}
  }
  async confirm(principal,unitID,session,binding,id,input,send){
    if(!ident(id)||!input||Object.keys(input).length)fail('native_acceptance_input');
    await this.authority.workspace.store.transaction(async s=>{
      const i=this.owned(s,principal,unitID,session,binding,id);
      if(i.abandoned)fail('native_acceptance_abandoned_unused');
      if(i.confirmed||i.rejected)return;
      const reason=await this.reason(s,i,session);if(reason)i.rejected=reason;else i.confirmed=true;
    });
    return this.receipt(principal,unitID,session,binding,id,send);
  }
  async abandon(principal,unitID,session,binding,id,input,send){
    if(!ident(id)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)fail('native_acceptance_input');
    await this.authority.workspace.store.transaction(s=>{
      const i=this.owned(s,principal,unitID,session,binding,id);
      // confirm() and connect() use this same transaction lock. These markers
      // never clear, including after departure; no native history guess needed.
      if(Object.hasOwn(i,'confirmed')||Object.hasOwn(i,'executor'))fail('native_acceptance_not_unused');
      if(i.abandoned&&i.abandoned!=='native_acceptance_abandoned_unused')fail('native_acceptance_not_unused');
      i.abandoned='native_acceptance_abandoned_unused';
    });
    return this.receipt(principal,unitID,session,binding,id,send);
  }
  async action(principal,unitID,session,action){
    if(action?.kind!=='agent-acceptance'||!ident(action.id))fail('native_acceptance_purpose');
    await this.authority.workspace.store.read(s=>{const i=this.owned(s,principal,unitID,session,action.binding,action.id);if(!i.confirmed||i.rejected||i.abandoned)fail('native_acceptance_not_confirmed');});
  }
  async connect(principal,unitID,session,action,memberID){
    await this.authority.workspace.store.transaction(async s=>{
      const i=this.owned(s,principal,unitID,session,action.binding,action.id);
      if(action.kind!=='agent-acceptance'||!i.confirmed||i.rejected||i.abandoned)fail('native_acceptance_not_confirmed');
      if(i.executor&&i.executor!==memberID)fail('native_acceptance_executor_retained');
      const reason=await this.reason(s,i,session);if(reason)fail(reason);
      i.executor=memberID;
    });
  }
  async validate(s,c,session,commit=false){
    const request=c.request.changeset,scope=this.authority.scope.getStore();
    if(session.actionKind!=='agent-acceptance'){if(request.sid.startsWith('acceptance_')||scope?.action?.kind==='agent-acceptance')return 'native_acceptance_purpose';return;}
    const i=s.works[request.unitID]?.nativeAgentAcceptances?.[session.action];
    if(!i||scope?.action?.kind!=='agent-acceptance'||scope.action.id!==session.action||scope.action.binding!==session.binding||i.binding!==session.binding||i.principal!==c.userID||i.epoch!==session.revision||i.executor!==c.memberID||!i.confirmed)return 'native_acceptance_identity';
    if(!equal(request,{...i.request,memberID:i.executor}))return 'native_acceptance_request';
    if(i.abandoned)return 'native_acceptance_abandoned_unused';
    if(i.rejected)return i.rejected;
    if(commit){
      if(c.changeset.baseRev!==i.request.baseRev||c.changeset.revision!==i.request.revision||digest(c.changeset.mutations)!==i.hash){i.rejected='native_acceptance_head_changed';return i.rejected;}
      const reason=await this.reason(s,i,session);if(reason){i.rejected=reason;return reason;}
    }else{
      // Dedup must still accept exact already-committed retries. History is read
      // only for the receipt; never resubmit from recovery or infer absence safe.
      this.check(s,c.userID,request.unitID,session);
    }
  }
  async receipt(principal,unitID,session,binding,id,send){
    if(!ident(id))fail('native_acceptance_input');
    await this.authority.workspace.store.transaction(async s=>{
      const i=this.owned(s,principal,unitID,session,binding,id);
      const history=await this.dbAdapter.getChangesets(context(principal),unitID,{from:i.request.baseRev,to:i.request.revision});
      const c=history.find(c=>c.unitID===unitID&&c.type===2&&c.revision===i.request.revision&&c.baseRev===i.request.baseRev&&c.userID===principal&&c.memberID===i.executor&&c.sid===i.request.sid&&c.reqId===i.request.reqId&&digest(c.mutations)===i.hash);
      this.owned(s,principal,unitID,session,binding,id);
      send({id,proposalId:i.target.proposalId,disposition:c?'committed':i.abandoned||i.rejected?'rejected':'unknown',phase:i.abandoned?'abandoned':i.executor?'executor-admitted':i.confirmed?'confirmed':'prepared',...(c?{revision:c.revision}:{}),...(i.abandoned||i.rejected?{reason:i.abandoned||i.rejected}:{}),preview:structuredClone(i.preview),actionPath:`/api/native/${unitID}/${i.epoch}/agent-acceptance/${id}/universer-api`,...(i.executor?{request:{...structuredClone(i.request),memberID:i.executor}}:{})});
    });
  }
}
