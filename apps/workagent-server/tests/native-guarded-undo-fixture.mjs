// TEST ONLY. An explicit server-validated inverse intent; never enables native Undo.
// Metadata below is a short-lived proof capability, not a history/dedup authority.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CollabError, UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { SetRangeValuesMutation, SetRangeValuesUndoMutationFactory } from '@univerjs/sheets';
import { client, UNIT, TAB } from './native-history-sdk.test.mjs';
export const operationHash = changeset => createHash('sha256').update(JSON.stringify(changeset.mutations)).digest('hex');
const deny = reason => { throw new CollabError('PERMISSION_DENIED',reason,{retryable:false}); };
const canonical = mutation => { const {trigger,...params}=JSON.parse(mutation.data);return {id:mutation.id,params}; };
export function guardedUndoFixture(s) {
  const intents=new AsyncLocalStorage();let held=false,commitChecks=0;
  const transaction=s.store.transaction.bind(s.store);
  s.store.transaction=fn=>transaction(async state=>{assert.equal(held,false,'no nested transaction');held=true;try{return await fn(state);}finally{held=false;}});
  s.service.use('commitChangeset',async(c,next)=>{
    const intent=intents.getStore();if(!intent)return next();
    assert.equal(held,true,'guard runs inside real NativeAuthority commit fence');commitChecks++;
    if(c.userID!==intent.principal||c.memberID!==intent.executorMember||c.changeset.unitID!==UNIT||c.changeset.mutations.length!==1)deny('guard_identity');
    // Existing outer NativeAuthority already checked ACL/epoch and SID admission.
    const session=s.authority.sessions.get(c.memberID),origin=s.authority.sessions.get(intent.member);
    if(origin?.userID!==intent.principal||origin?.revision!==intent.epoch)deny('guard_origin_session');
    if(session?.revision!==intent.epoch)deny('guard_epoch');
    const unit=await s.db.getUnit(c,UNIT);
    if(unit.headRevision!==intent.expectedHead)deny('guard_head_changed');
    if(!isDeepStrictEqual(canonical(c.changeset.mutations[0]),intent.inverse))deny('guard_inverse_changed');
    await next(); // actual SDK adapter CAS, still under Workspace transaction.
  });
  async function prepare(principal,member,target,executorMember=member){
    const session=s.authority.sessions.get(member);
    if(session?.userID!==principal)deny('guard_session');
    const executor=s.authority.sessions.get(executorMember);
    if(executor?.userID!==principal||executor?.unitID!==UNIT||executor?.revision!==session.revision)deny('guard_executor_session');
    await s.authority.checkNow(principal,UNIT,true,session);
    const {changesets}=await s.authority.scope.run({unitID:UNIT,session},()=>s.service.getChangesets({unitID:UNIT,type:2,from:target.revision-1,to:target.revision},{userID:principal}));
    const original=changesets[0];
    if(changesets.length!==1||original.revision!==target.revision||original.userID!==principal||original.memberID!==member||original.sid!==target.sid||original.reqId!==target.reqId||operationHash(original)!==target.hash)deny('guard_original_identity');
    if(original.mutations.length!==1||original.mutations[0].id!==SetRangeValuesMutation.id)deny('guard_not_single_value_operation');
    const p=JSON.parse(original.mutations[0].data),rows=Object.entries(p.cellValue??{});
    if(p.unitId!==UNIT||p.subUnitId!==TAB||rows.length!==1)deny('guard_not_single_value_operation');
    if(Object.keys(p).some(k=>!['unitId','subUnitId','cellValue','trigger','styleRefMap'].includes(k))||Object.keys(p.styleRefMap??{}).length)deny('guard_not_single_value_operation');
    const cells=Object.entries(rows[0][1]);
    if(cells.length!==1||Object.keys(cells[0][1]).some(k=>k!=='v')||!['number','string','boolean'].includes(typeof cells[0][1].v))deny('guard_not_single_value_operation');
    const load=await s.authority.scope.run({unitID:UNIT,session},()=>s.service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision:original.baseRev},{userID:principal}));
    const materializer=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});let local;
    let inverse;
    try{const state=await materializer.materializeSnapshot(load);local=client(await transformSnapshotToWorkbookData(state.snapshot,[...state.sheetBlocks]),principal);
      inverse={id:SetRangeValuesMutation.id,params:SetRangeValuesUndoMutationFactory(local.univer.__getInjector(),{unitId:UNIT,subUnitId:TAB,cellValue:p.cellValue})};
    }finally{local?.dispose();await materializer.dispose();}
    await s.authority.fence(principal,UNIT,true,async()=>{const unit=await s.db.getUnit({},UNIT);if(unit.headRevision!==original.revision)deny('guard_head_changed');},session);
    return Object.freeze({principal,member,executorMember,epoch:session.revision,expectedHead:original.revision,inverse,original:{...target}});
  }
  return {prepare,get commitChecks(){return commitChecks;},
    // Parent-only transport proof: install a trusted test intent around the real HTTP handler.
    withIntent(intent,effect){return intents.run(intent,effect);},
    submit(intent,changeset,principal=intent.principal,member=intent.executorMember){return intents.run(intent,()=>s.service.submitChangeset({changeset},{userID:principal,memberID:member}));},
    request(intent,sid='explicit-inverse-proof',reqId=1){return {unitID:UNIT,type:2,baseRev:intent.expectedHead,revision:intent.expectedHead+1,userID:intent.principal,memberID:intent.executorMember,sid,reqId,mutations:[{id:intent.inverse.id,data:JSON.stringify(intent.inverse.params)}]};}
  };
}
