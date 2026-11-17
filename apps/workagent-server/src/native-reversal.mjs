import { mergedTarget } from './native-merge.mjs';
// Explicit single-operation reversal. Native history/CAS remain content authority.
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { Univer, LocaleType } from '@univerjs/core';
import { UniverSheetsPlugin, SetRangeValuesMutation, SetRangeValuesUndoMutationFactory } from '@univerjs/sheets';
import { UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
const fail = (code='native_reversal_refused') => { throw new Fault(code,409); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ident = value => typeof value==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
const context = principal => ({userID:principal,customData:{},request:{}});
function scalar(p,unitID) {
  if(!p || Object.keys(p).some(k=>!['unitId','subUnitId','cellValue','trigger','styleRefMap'].includes(k)) || p.unitId!==unitID || p.subUnitId!=='sheet-1') fail('native_reversal_unsupported');
  const rows=Object.entries(p.cellValue??{});if(rows.length!==1 || !/^(0|[1-9][0-9]*)$/.test(rows[0][0])) fail('native_reversal_unsupported');
  const columns=Object.entries(rows[0][1]??{});if(columns.length!==1 || !/^(0|[1-9][0-9]*)$/.test(columns[0][0])) fail('native_reversal_unsupported');
  const cell=columns[0][1],row=Number(rows[0][0]),col=Number(columns[0][0]);
  if(!Number.isSafeInteger(row)||!Number.isSafeInteger(col)||!cell||Object.keys(cell).some(k=>!['v','t','f','si','s','ft','fd'].includes(k))||!['string','number','boolean'].includes(typeof cell.v)||typeof cell.v==='number'&&!Number.isFinite(cell.v)||['f','si','ft','fd'].some(k=>cell[k]!=null)||cell.t!==undefined&&![1,2,3].includes(cell.t)) fail('native_reversal_unsupported');
  if(cell.t!==undefined && cell.t!==({string:1,number:2,boolean:3})[typeof cell.v]) fail('native_reversal_unsupported');
  // Initially qualify only the observed browser text-color envelope, not arbitrary styles.
  const styles=p.styleRefMap??{};
  if(cell.s!=null) {
    if(typeof cell.s!=='string'||Object.keys(styles).length!==1||!Object.hasOwn(styles,cell.s)) fail('native_reversal_unsupported');
    const style=styles[cell.s];if(!style||Object.keys(style).join()!=='cl'||!style.cl||Object.keys(style.cl).join()!=='rgb'||!/^#[0-9a-fA-F]{6}$/.test(style.cl.rgb)) fail('native_reversal_unsupported');
  } else if(Object.keys(styles).length) fail('native_reversal_unsupported');
  return {row,col};
}
export class NativeReversal {
  constructor(authority,service,dbAdapter){Object.assign(this,{authority,service,dbAdapter});}
  owned(s,principal,unitID,session,binding,id){
    this.authority.check(s,principal,unitID,false,session);
    const intent=s.works[unitID].nativeReversals?.[id];
    if(!intent||intent.principal!==principal||intent.epoch!==session.revision||!binding||intent.binding!==binding) fail('native_reversal_identity');
    return intent;
  }
  async prepare(principal,unitID,session,binding,input,send){
    if(!input||Object.keys(input).some(k=>!['commandId','revision','memberID','sid','reqId','hash'].includes(k))||!ident(input.commandId)||!ident(input.memberID)||!ident(input.sid)||!Number.isSafeInteger(input.revision)||input.revision<2||!Number.isSafeInteger(input.reqId)||input.reqId<1||typeof input.hash!=='string'||!/^[a-f0-9]{64}$/.test(input.hash)||!binding) fail();
    const originalSession=this.authority.sessions.get(input.memberID);
    if(!originalSession||originalSession.action||originalSession.userID!==principal||originalSession.unitID!==unitID||originalSession.revision!==session.revision||originalSession.binding!==binding) fail('native_reversal_origin_session');
    let old;
    await this.authority.workspace.store.read(s=>{this.authority.check(s,principal,unitID,true,session);old=s.works[unitID].nativeReversals?.[input.commandId];if(old&&(!isDeepStrictEqual(old.target,input)||old.binding!==binding||old.principal!==principal||old.epoch!==session.revision)) fail('native_reversal_identity');});
    if(old)return this.receipt(principal,unitID,session,binding,input.commandId,send);
    await this.authority.fence(principal,unitID,true,async()=>{if((await this.dbAdapter.getUnit(context(principal),unitID))?.headRevision!==input.revision)fail('native_reversal_head_changed');},session);
    const scope=fn=>this.authority.scope.run({unitID,session},fn);
    const history=await scope(()=>this.service.getChangesets({unitID,type:2,from:input.revision-1,to:input.revision},{userID:principal}));
    const c=history.changesets[0];
    if(history.changesets.length!==1||c.revision!==input.revision||c.userID!==principal||c.memberID!==input.memberID||c.sid!==input.sid||c.reqId!==input.reqId||hash(c.mutations)!==input.hash||c.mutations.length!==1||c.mutations[0].id!==SetRangeValuesMutation.id) fail('native_reversal_target');
    const p=JSON.parse(c.mutations[0].data),position=scalar(p,unitID);
    const load=await scope(()=>this.service.getUnitLoadDataWithBlocks({unitID,type:2,revision:c.baseRev},{userID:principal}));
    if(load.targetRevision!==c.baseRev) fail('native_reversal_history_unavailable');
    const materializer=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});let univer,inverse,preview;
    try {
      const snapshot=await materializer.materializeSnapshot(load),data=await transformSnapshotToWorkbookData(snapshot.snapshot,[...snapshot.sheetBlocks]);
      const sheet=data.sheets[p.subUnitId];if(!sheet||position.row>=sheet.rowCount||position.col>=sheet.columnCount) fail();
      if(mergedTarget(sheet,position.row,position.col))fail('native_reversal_merged_target');
      const before=sheet.cellData?.[position.row]?.[position.col]??null;
      // Restoring formulas/rich text is outside this first scalar intent.
      if(before&&(before.f||before.si||before.p)) fail('native_reversal_unsupported');
      univer=new Univer({locale:LocaleType.EN_US,locales:{enUS:{}}});univer.registerPlugin(UniverSheetsPlugin);univer.createUnit(2,data);
      inverse=SetRangeValuesUndoMutationFactory(univer.__getInjector(),{unitId:unitID,subUnitId:p.subUnitId,cellValue:p.cellValue});
      preview={sheetID:p.subUnitId,...position,before,after:p.cellValue[position.row][position.col]};
    }finally{univer?.dispose();await materializer.dispose();}
    await this.authority.workspace.store.transaction(async s=>{
      this.authority.check(s,principal,unitID,true,session);
      const intents=s.works[unitID].nativeReversals??={};
      if(intents[input.commandId]){if(!isDeepStrictEqual(intents[input.commandId].target,input)||intents[input.commandId].binding!==binding)fail('native_reversal_identity');return;}
      // A new command ID is not recovery of an unresolved native request.
      // Compare the exact original operation under the same reservation lock;
      // neither a disconnected executor nor absent history releases its identity.
      const {commandId: _commandId, ...target}=input;
      for(const retained of Object.values(intents)) {
        if(retained.principal!==principal||retained.epoch!==session.revision||retained.request.unitID!==unitID||(retained.rejected&&retained.rejected!=='native_reversal_abandoned_unused'))continue;
        const {commandId: _retainedCommandId, ...original}=retained.target;
        if(isDeepStrictEqual(original,target))fail('native_reversal_target_retained');
      }
      if(Object.keys(intents).length>=1024)fail('native_reversal_capacity');
      if((await this.dbAdapter.getUnit(context(principal),unitID))?.headRevision!==c.revision)fail('native_reversal_head_changed');
      if(this.authority.sessions.get(input.memberID)!==originalSession)fail('native_reversal_origin_session');
      const request={unitID,type:2,baseRev:c.revision,revision:c.revision+1,userID:principal,createTime:Math.floor(Date.now()/1000),sid:`reversal_${randomUUID()}`,reqId:1,mutations:[{id:SetRangeValuesMutation.id,data:JSON.stringify(inverse)}]};
      intents[input.commandId]={principal,binding,epoch:session.revision,target:structuredClone(input),request,hash:hash(request.mutations),preview};
    });
    return this.receipt(principal,unitID,session,binding,input.commandId,send);
  }
  async abandon(principal,unitID,session,binding,id,send){
    if(!ident(id))fail();
    await this.authority.workspace.store.transaction(s=>{
      const intent=this.owned(s,principal,unitID,session,binding,id);
      this.authority.check(s,principal,unitID,true,session);
      // connect() binds the executor in this same canonical transaction. An
      // executor is never cleared on disconnect; no executor proves no native
      // submission could have been admitted for this reserved request.
      if(intent.executor)fail('native_reversal_executor_retained');
      if(intent.rejected&&intent.rejected!=='native_reversal_abandoned_unused')fail('native_reversal_rejected');
      intent.rejected='native_reversal_abandoned_unused';
    });
    return this.receipt(principal,unitID,session,binding,id,send);
  }
  async action(principal,unitID,session,action){
    if(!action||!ident(action.id))fail('native_reversal_identity');
    await this.authority.workspace.store.read(s=>{const intent=this.owned(s,principal,unitID,session,action.binding,action.id);this.authority.check(s,principal,unitID,true,session);if(intent.rejected)fail('native_reversal_rejected');});
  }
  async connect(principal,unitID,session,action,memberID){
    await this.authority.workspace.store.transaction(s=>{const intent=this.owned(s,principal,unitID,session,action.binding,action.id);this.authority.check(s,principal,unitID,true,session);if(intent.executor&&intent.executor!==memberID)fail('native_reversal_executor_retained');if(intent.rejected)fail('native_reversal_rejected');intent.executor=memberID;});
  }
  // Invoked under the existing Workspace transaction, before SDK dedup, and
  // again on the transformed commit batch while that lock spans native CAS.
  async validate(s,c,session,commit=false){
    const request=c.request.changeset;
    if(!session.action){if(this.authority.scope.getStore()?.action||request.sid.startsWith('reversal_'))return 'native_reversal_purpose';return;}
    const intent=s.works[request.unitID]?.nativeReversals?.[session.action];
    const scope=this.authority.scope.getStore();
    if(!intent||scope?.action?.id!==session.action||scope.action.binding!==session.binding||intent.binding!==session.binding||intent.principal!==c.userID||intent.epoch!==session.revision||intent.executor!==c.memberID)return 'native_reversal_identity';
    const expected={...intent.request,memberID:intent.executor};
    if(!isDeepStrictEqual(request,expected))return 'native_reversal_request';
    if(intent.rejected)return intent.rejected;
    if(commit){
      if(c.changeset.baseRev!==intent.request.baseRev||c.changeset.revision!==intent.request.revision||hash(c.changeset.mutations)!==intent.hash||(await this.dbAdapter.getUnit(context(c.userID),request.unitID))?.headRevision!==intent.request.baseRev){intent.rejected='native_reversal_head_changed';return intent.rejected;}
      const origin=this.authority.sessions.get(intent.target.memberID);
      if(!origin||origin.action||origin.userID!==intent.principal||origin.revision!==intent.epoch||origin.unitID!==request.unitID||origin.binding!==intent.binding){intent.rejected='native_reversal_origin_session';return intent.rejected;}
    }
  }
  async receipt(principal,unitID,session,binding,id,send){
    if(!ident(id))fail();
    await this.authority.workspace.store.transaction(async s=>{
      const intent=this.owned(s,principal,unitID,session,binding,id);
      const history=await this.dbAdapter.getChangesets(context(principal),unitID,{from:intent.request.baseRev,to:intent.request.revision});
      const committed=history.find(c=>c.revision===intent.request.revision&&c.unitID===unitID&&c.type===2&&c.userID===principal&&c.memberID===intent.executor&&c.sid===intent.request.sid&&c.reqId===intent.request.reqId&&hash(c.mutations)===intent.hash);
      send({id,disposition:committed?'committed':intent.rejected?'rejected':'unknown',...(committed?{revision:committed.revision}:{}),...(intent.rejected?{reason:intent.rejected}:{}),preview:intent.preview,actionPath:`/api/native/${unitID}/${intent.epoch}/reversal/${id}/universer-api`,...(intent.executor?{request:{...intent.request,memberID:intent.executor}}:{})});
    });
  }
}
