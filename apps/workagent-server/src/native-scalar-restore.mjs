import { mergedTarget } from './native-merge.mjs';
// Bounded scalar restore: retained intent, never a writable snapshot/history store.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { authorize, digest, intentConditions, same } from './workspace.mjs';
import { UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { SetRangeValuesMutation } from '@univerjs/sheets';
const fail=(code='native_restore_refused')=>{throw new Fault(code,409);};
const ident=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const targetOK=input=>!!input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).sort().join()==='commandId,currentHead,memberID,sourceRevision'&&ident(input.commandId)&&ident(input.memberID)&&Number.isSafeInteger(input.sourceRevision)&&input.sourceRevision>=1&&Number.isSafeInteger(input.currentHead)&&input.sourceRevision<input.currentHead&&input.currentHead-input.sourceRevision<=128;
const abandonedUnused=i=>i.abandoned==='native_restore_abandoned_unused'&&!Object.hasOwn(i,'confirmed')&&!Object.hasOwn(i,'executor');
const context=userID=>({userID,customData:{},request:{}});
const scalar=x=>x===null||['string','boolean'].includes(typeof x)||typeof x==='number'&&Number.isFinite(x);
export class NativeScalarRestore {
  constructor(authority,service,dbAdapter){Object.assign(this,{authority,service,dbAdapter});this.enabled=false;}
  check(s,principal,unitID,session){
    authorize(s,principal);
    if(!this.enabled||!this.authority.workspace.nativeEnabled)fail('native_restore_disabled');
    if(this.authority.check(s,principal,unitID,true,session).role!=='owner')fail('native_restore_owner');
  }
  origin(principal,unitID,session,binding,memberID){
    const origin=this.authority.sessions.get(memberID);
    return !!binding&&!!origin&&!origin.action&&origin.userID===principal&&origin.unitID===unitID&&origin.revision===session.revision&&origin.binding===binding;
  }
  owned(s,principal,unitID,session,binding,id){
    this.check(s,principal,unitID,session);
    const i=s.works[unitID].nativeScalarRestores?.[id];
    if(!i||i.principal!==principal||i.epoch!==session.revision||!binding||i.binding!==binding)fail('native_restore_identity');
    return i;
  }
  async head(principal,unitID){return (await this.dbAdapter.getUnit(context(principal),unitID))?.headRevision;}
  async materialize(principal,unitID,session,revision){
    const load=await this.authority.scope.run({unitID,session},()=>this.service.getUnitLoadDataWithBlocks({unitID,type:2,revision},{userID:principal}));
    if(load.targetRevision!==revision)fail('native_restore_history');
    const m=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});
    try{const x=await m.materializeSnapshot(load);return await transformSnapshotToWorkbookData(x.snapshot,[...x.sheetBlocks]);}finally{await m.dispose();}
  }
  async prepare(principal,unitID,session,binding,input,send){
    if(!targetOK(input)||!binding)fail('native_restore_input');
    let old,basis;
    await this.authority.workspace.store.transaction(async s=>{
      this.check(s,principal,unitID,session);old=s.works[unitID].nativeScalarRestores?.[input.commandId];
      if(old){if(!equal(old.target,input)||old.binding!==binding||old.principal!==principal||old.epoch!==session.revision)fail('native_restore_identity');return;}
      if(await this.head(principal,unitID)!==input.currentHead)fail('native_restore_head_changed');
      this.check(s,principal,unitID,session);if(!this.origin(principal,unitID,session,binding,input.memberID))fail('native_restore_origin');
      basis=structuredClone(intentConditions(s,s.works[unitID]));
    });
    if(old)return this.receipt(principal,unitID,session,binding,input.commandId,send);
    const scope=fn=>this.authority.scope.run({unitID,session},fn);
    const history=await scope(()=>this.service.getChangesets({unitID,type:2,from:input.sourceRevision,to:input.currentHead},{userID:principal}));
    // Resolution/body metadata can be omitted by snapshot serializers. Reject
    // every intervening non-value command, and require contiguous native proof.
    if(history.changesets.length!==input.currentHead-input.sourceRevision||history.changesets.some((c,n)=>c.revision!==input.sourceRevision+n+1||c.baseRev!==c.revision-1||c.mutations.some(m=>m.id!==SetRangeValuesMutation.id)))fail('native_restore_unsupported_history');
    const target=await this.materialize(principal,unitID,session,input.sourceRevision),current=await this.materialize(principal,unitID,session,input.currentHead);
    const {params,preview}=scalarRestoreDiff(current,target,input.sourceRevision,input.currentHead);
    await this.authority.workspace.store.transaction(async s=>{
      this.check(s,principal,unitID,session);const intents=s.works[unitID].nativeScalarRestores??={};
      if(intents[input.commandId]){const i=this.owned(s,principal,unitID,session,binding,input.commandId);if(!equal(i.target,input))fail('native_restore_identity');return;}
      if(Object.values(intents).some(i=>i.principal===principal&&i.epoch===session.revision&&i.target.currentHead===input.currentHead&&!abandonedUnused(i)))fail('native_restore_target_retained');
      if(Object.keys(intents).length>=1024)fail('native_restore_capacity');
      if(await this.head(principal,unitID)!==input.currentHead)fail('native_restore_head_changed');
      this.check(s,principal,unitID,session);if(!same(basis,intentConditions(s,s.works[unitID])))fail('native_restore_intent_changed');
      if(!this.origin(principal,unitID,session,binding,input.memberID))fail('native_restore_origin');
      const request={unitID,type:2,baseRev:input.currentHead,revision:input.currentHead+1,userID:principal,createTime:Math.floor(Date.now()/1000),sid:`restore_${randomUUID()}`,reqId:1,mutations:[{id:SetRangeValuesMutation.id,data:JSON.stringify(params)}]};
      intents[input.commandId]={principal,binding,epoch:session.revision,target:structuredClone(input),basis,request,hash:digest(request.mutations),preview};
    });
    return this.receipt(principal,unitID,session,binding,input.commandId,send);
  }
  async reason(s,i,session){
    try{
      this.check(s,i.principal,i.request.unitID,session);
      if(!same(i.basis,intentConditions(s,s.works[i.request.unitID])))return 'native_restore_intent_changed';
      if(await this.head(i.principal,i.request.unitID)!==i.request.baseRev)return 'native_restore_head_changed';
      this.check(s,i.principal,i.request.unitID,session);
      if(!this.origin(i.principal,i.request.unitID,session,i.binding,i.target.memberID))return 'native_restore_origin';
    }catch(e){if(e instanceof Fault)return e.code;throw e;}
  }
  async confirm(principal,unitID,session,binding,id,input,send){
    if(!ident(id)||!input||Object.keys(input).length)fail('native_restore_input');
    await this.authority.workspace.store.transaction(async s=>{
      const i=this.owned(s,principal,unitID,session,binding,id);
      if(i.abandoned)fail('native_restore_abandoned_unused');
      if(i.confirmed||i.rejected)return;
      const reason=await this.reason(s,i,session);if(reason)i.rejected=reason;else i.confirmed=true;
    });
    return this.receipt(principal,unitID,session,binding,id,send);
  }
  async abandon(principal,unitID,session,binding,id,input,send){
    if(!ident(id)||!input||typeof input!=='object'||Array.isArray(input))fail('native_restore_input');
    const supplied=Object.keys(input).length>0;
    if(supplied&&(!targetOK(input)||input.commandId!==id))fail('native_restore_input');
    await this.authority.workspace.store.transaction(s=>{
      this.check(s,principal,unitID,session);
      if(!binding)fail('native_restore_identity');
      const intents=s.works[unitID].nativeScalarRestores??={};
      let i=intents[id];
      if(i){i=this.owned(s,principal,unitID,session,binding,id);if(supplied&&!equal(i.target,input))fail('native_restore_identity');}
      else{
        if(!supplied)fail('native_restore_identity');
        if(Object.keys(intents).length>=1024)fail('native_restore_capacity');
        // This lock also serializes prepare's final reservation, confirmation
        // and executor admission. No head/history absence inference is used.
        i=intents[id]={principal,binding,epoch:session.revision,target:structuredClone(input)};
      }
      // confirm() and connect() use this same transaction lock. These markers
      // never clear, including after departure; no native history guess needed.
      if(Object.hasOwn(i,'confirmed')||Object.hasOwn(i,'executor'))fail('native_restore_not_unused');
      if(i.abandoned&&i.abandoned!=='native_restore_abandoned_unused')fail('native_restore_not_unused');
      i.abandoned='native_restore_abandoned_unused';
    });
    return this.receipt(principal,unitID,session,binding,id,send);
  }
  async action(principal,unitID,session,action){
    if(action?.kind!=='scalar-restore'||!ident(action.id))fail('native_restore_purpose');
    await this.authority.workspace.store.read(s=>{const i=this.owned(s,principal,unitID,session,action.binding,action.id);if(!i.confirmed||i.rejected||i.abandoned)fail('native_restore_not_confirmed');});
  }
  async connect(principal,unitID,session,action,memberID){
    await this.authority.workspace.store.transaction(async s=>{
      const i=this.owned(s,principal,unitID,session,action.binding,action.id);
      if(action.kind!=='scalar-restore'||!i.confirmed||i.rejected||i.abandoned)fail('native_restore_not_confirmed');
      if(i.executor&&i.executor!==memberID)fail('native_restore_executor_retained');
      const reason=await this.reason(s,i,session);if(reason)fail(reason);
      i.executor=memberID;
    });
  }
  async validate(s,c,session,commit=false){
    const request=c.request.changeset,scope=this.authority.scope.getStore();
    if(session.actionKind!=='scalar-restore'){if(request.sid.startsWith('restore_')||scope?.action?.kind==='scalar-restore')return 'native_restore_purpose';return;}
    const i=s.works[request.unitID]?.nativeScalarRestores?.[session.action];
    if(!i||scope?.action?.kind!=='scalar-restore'||scope.action.id!==session.action||scope.action.binding!==session.binding||i.binding!==session.binding||i.principal!==c.userID||i.epoch!==session.revision||i.executor!==c.memberID||!i.confirmed)return 'native_restore_identity';
    if(!equal(request,{...i.request,memberID:i.executor}))return 'native_restore_request';
    if(i.abandoned)return 'native_restore_abandoned_unused';
    if(i.rejected)return i.rejected;
    if(commit){
      if(c.changeset.baseRev!==i.request.baseRev||c.changeset.revision!==i.request.revision||digest(c.changeset.mutations)!==i.hash){i.rejected='native_restore_head_changed';return i.rejected;}
      const reason=await this.reason(s,i,session);if(reason){i.rejected=reason;return reason;}
    }else{
      // Dedup must still accept exact already-committed retries. History is read
      // only for the receipt; never resubmit from recovery or infer absence safe.
      this.check(s,c.userID,request.unitID,session);
    }
  }
  async receipt(principal,unitID,session,binding,id,send){
    if(!ident(id))fail('native_restore_input');
    await this.authority.workspace.store.transaction(async s=>{
      const i=this.owned(s,principal,unitID,session,binding,id);
      if(!i.request){
        if(!abandonedUnused(i))fail('native_restore_identity');
        send({id,sourceRevision:i.target.sourceRevision,target:structuredClone(i.target),disposition:'rejected',phase:'abandoned',reason:i.abandoned,actionPath:`/api/native/${unitID}/${i.epoch}/scalar-restore/${id}/universer-api`});
        return;
      }
      const history=await this.dbAdapter.getChangesets(context(principal),unitID,{from:i.request.baseRev,to:i.request.revision});
      const c=history.find(c=>c.unitID===unitID&&c.type===2&&c.revision===i.request.revision&&c.baseRev===i.request.baseRev&&c.userID===principal&&c.memberID===i.executor&&c.sid===i.request.sid&&c.reqId===i.request.reqId&&digest(c.mutations)===i.hash);
      this.owned(s,principal,unitID,session,binding,id);
      send({id,sourceRevision:i.target.sourceRevision,disposition:c?'committed':i.abandoned||i.rejected?'rejected':'unknown',phase:i.abandoned?'abandoned':i.executor?'executor-admitted':i.confirmed?'confirmed':'prepared',...(c?{revision:c.revision}:{}),...(i.abandoned||i.rejected?{reason:i.abandoned||i.rejected}:{}),preview:structuredClone(i.preview),actionPath:`/api/native/${unitID}/${i.epoch}/scalar-restore/${id}/universer-api`,...(i.executor?{request:{...structuredClone(i.request),memberID:i.executor}}:{})});
    });
  }
}

// One-cell cap deliberately reuses the qualified scalar native action envelope.
// Compare resolved styles because public materialization reallocates style IDs.
export function scalarRestoreDiff(current,target,sourceRevision,currentHead){
  const normalize=data=>{const out=structuredClone(data);for(const sheet of Object.values(out.sheets))for(const row of Object.values(sheet.cellData??{}))for(const cell of Object.values(row))if(typeof cell?.s==='string'){if(!Object.hasOwn(data.styles??{},cell.s))fail('native_restore_style');cell.s=data.styles[cell.s];}delete out.styles;return out;};
  if(current.rev!==currentHead||target.rev!==sourceRevision)fail('native_restore_revision');
  const a=normalize(current),b=normalize(target);delete a.rev;delete b.rev;const sheet=a.sheets['sheet-1'],prior=b.sheets['sheet-1'];if(!sheet||!prior)fail('native_restore_original_sheet');
  const positions=new Set();for(const tab of [sheet,prior])for(const [r,cols]of Object.entries(tab.cellData??{}))for(const c of Object.keys(cols))positions.add(r+':'+c);
  let effect;
  for(const key of positions){const [r,c]=key.split(':'),before=sheet.cellData?.[r]?.[c]??{},after=prior.cellData?.[r]?.[c]??{};if(equal(before,after))continue;
    if(effect||!/^\d+$/.test(r)||!/^\d+$/.test(c)||+r>=sheet.rowCount||+c>=sheet.columnCount||mergedTarget(sheet,+r,+c)||mergedTarget(prior,+r,+c))fail('native_restore_one_unmerged_scalar');
    for(const cell of [before,after])if(Object.keys(cell).some(k=>!['v','t','s','f','si','ft','fd'].includes(k))||['f','si','ft','fd'].some(k=>cell[k]!=null)||cell.v!=null&&(!scalar(cell.v)||cell.t!=null&&cell.t!==({string:1,number:2,boolean:3})[typeof cell.v])||typeof cell.v==='string'&&(cell.v.startsWith('=')||cell.v.length>20000))fail('native_restore_scalar_only');
    const metadata=cell=>{const x=structuredClone(cell);delete x.v;delete x.t;for(const k of ['f','si','ft','fd'])if(x[k]==null)delete x[k];return x;};
    if(!equal(metadata(before),metadata(after))||equal(before.v??null,after.v??null))fail('native_restore_metadata');
    effect={row:+r,column:+c,before:before.v??null,after:after.v??null};
    // Remove only this value difference for full outside-state comparison.
    for(const tab of [sheet,prior]){if(tab.cellData?.[r]){delete tab.cellData[r][c];if(!Object.keys(tab.cellData[r]).length)delete tab.cellData[r];}}
  }
  if(!effect)fail('native_restore_no_change');if(!equal(a,b))fail('native_restore_structure_or_resource_changed');
  const value={v:effect.after,t:effect.after===null?null:({string:1,number:2,boolean:3})[typeof effect.after]};
  return {params:{unitId:current.id,subUnitId:'sheet-1',cellValue:{[effect.row]:{[effect.column]:value}}},preview:{sheetID:'sheet-1',sourceRevision,nativeRevision:currentHead,...effect}};
}
