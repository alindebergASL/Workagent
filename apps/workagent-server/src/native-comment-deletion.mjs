// Manual deletion changes native membership, never canonical bodies/history.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
const DELETE='thread-comment.mutation.delete-comment';
const fail=()=>{throw new Fault('native_comment_refused',409);};
const identifier=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const valid=a=>a&&Object.keys(a).sort().join()==='commentId,id,memberID,ref,rootId,targets'&&[a.id,a.commentId,a.memberID,a.rootId].every(identifier)&&typeof a.ref==='string'&&/^[A-Z]{1,4}[1-9][0-9]{0,6}$/.test(a.ref)&&Array.isArray(a.targets)&&a.targets.length>0&&a.targets.length<=4096&&a.targets.every(t=>t&&Object.keys(t).sort().join()==='bodyVersion,id'&&identifier(t.id)&&identifier(t.bodyVersion))&&new Set(a.targets.map(t=>t.id)).size===a.targets.length;
export class NativeCommentDeletion {
 constructor(comments){this.comments=comments;this.authority=comments.authority;}
 matches(unitID,p,a){return p?.unitId===unitID&&p.subUnitId==='sheet-1'&&p.commentId===a.input.commentId&&Object.keys(p).every(k=>['unitId','subUnitId','commentId','trigger'].includes(k));}
 checkTarget(s,principal,unitID,view,input){
  const root=view.roots.find(r=>r.id===input.rootId),target=root&&(root.id===input.commentId?root:root.children?.find(c=>c.id===input.commentId));
  if(!target||root.ref!==input.ref)fail();const affected=target===root?[root,...(root.children??[])]:[target],claims=s.works[unitID].nativeCommentClaims??{};
  if(affected.some(c=>c.personId!==principal||claims[c.id]?.principal!==principal||c.bodyUnknown||!c.bodyVersion))fail();
  const targets=affected.map(c=>({id:c.id,bodyVersion:c.bodyVersion})).sort((a,b)=>a.id.localeCompare(b.id));
  if(!equal(targets,input.targets))fail();
 }
 async receipt(principal,unitID,a){
  const r={...a.input,head:a.head,status:a.abandoned?'abandoned':'unknown',phase:a.abandoned?'abandoned':a.attempt?'admitted':'prepared'};
  if(!a.attempt||a.abandoned)return r;
  const history=await this.comments.dbAdapter.getChangesets({userID:principal,customData:{},request:{}},unitID,{from:a.head,to:a.head+1});
  const c=history?.find(c=>c.unitID===unitID&&c.type===2&&c.baseRev===a.head&&c.revision===a.head+1&&c.userID===a.principal&&c.memberID===a.input.memberID&&c.sid===a.attempt.sid&&c.reqId===a.attempt.reqId&&createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex')===a.attempt.hash);
  if(!c||c.mutations.length!==1||c.mutations[0].id!==DELETE)return r;
  let p;try{p=JSON.parse(c.mutations[0].data);}catch{return r;}
  return this.matches(unitID,p,a)?{...r,status:'committed',revision:c.revision}:r;
 }
 async prepare(principal,unitID,session,input,send){
  if(!valid(input)||!session.binding)fail();const view=await this.comments.prepare(principal,unitID,session);
  await this.authority.workspace.store.transaction(async s=>{
   this.authority.check(s,principal,unitID,true,session);const records=s.works[unitID].nativeCommentDeletions??={},old=records[input.id];
   if(old){if(old.principal!==principal||old.epoch!==session.revision||old.binding!==session.binding||!equal(old.input,input))fail();return;}
   await this.comments.current(principal,unitID,view);const member=this.authority.sessions.get(input.memberID);
   if(!member||member.action||member.userID!==principal||member.unitID!==unitID||member.revision!==session.revision||member.binding!==session.binding)fail();
   this.checkTarget(s,principal,unitID,view,input);
   if(Object.keys(records).length>=4096)fail();
   for(const a of Object.values(records).filter(a=>a.input.commentId===input.commentId)){
    if(a.abandoned){if(a.head===view.revision&&a.input.memberID===input.memberID)fail();}
    else if((await this.receipt(principal,unitID,a)).status!=='committed')fail();
   }
   await this.comments.current(principal,unitID,view);
   records[input.id]={input:structuredClone(input),principal,epoch:session.revision,binding:session.binding,head:view.revision};
  });
  await this.authority.workspace.store.transaction(async s=>{this.authority.check(s,principal,unitID,true,session);send(await this.receipt(principal,unitID,s.works[unitID].nativeCommentDeletions[input.id]));});
 }
 async abandon(principal,unitID,session,key,send,input){
  if(!identifier(key)||!session.binding||input!==undefined&&(!valid(input)||input.id!==key))fail();
  await this.authority.workspace.store.transaction(async s=>{
   this.authority.check(s,principal,unitID,true,session);const w=s.works[unitID],records=w.nativeCommentDeletions??={};let a=records[key];
   if(a){if(a.principal!==principal||a.epoch!==session.revision||a.binding!==session.binding||a.attempt||input!==undefined&&!equal(a.input,input))fail();}
   else{
    const member=input&&this.authority.sessions.get(input.memberID);
    if(!input||w.nativeCommentClaims?.[input.commentId]?.principal!==principal||Object.keys(records).length>=4096||member&&(member.action||member.userID!==principal||member.unitID!==unitID||member.revision!==session.revision||member.binding!==session.binding))fail();
    const unit=await this.comments.dbAdapter.getUnit({userID:principal,customData:{},request:{}},unitID);if(!unit||!Number.isSafeInteger(unit.headRevision))fail();
    if(Object.values(records).some(r=>!r.abandoned&&r.head===unit.headRevision&&r.input.memberID===input.memberID&&r.input.commentId===input.commentId))fail();
    a=records[key]={input:structuredClone(input),principal,epoch:session.revision,binding:session.binding,head:unit.headRevision,unprepared:true};
   }
   a.abandoned=true;
  });
  await this.authority.workspace.store.transaction(async s=>{this.authority.check(s,principal,unitID,true,session);send(await this.receipt(principal,unitID,s.works[unitID].nativeCommentDeletions[key]));});
 }
 // Structural remove-row batches retain their separate, qualified validator.
 isManual(c){return c.mutations.length===1&&c.mutations[0].id===DELETE;}
 action(s,context,session){
  const c=context.request.changeset;if(!this.isManual(c))return;
  const p=JSON.parse(c.mutations[0].data),found=Object.values(s.works[c.unitID].nativeCommentDeletions??{}).filter(a=>a.principal===context.userID&&a.epoch===session.revision&&a.binding===session.binding&&a.input.memberID===context.memberID&&a.head===c.baseRev&&this.matches(c.unitID,p,a));
  if(found.length!==1||found[0].abandoned)fail();return found[0];
 }
 bind(s,context,session,admission){
  const a=this.action(s,context,session);if(!a)return;const c=context.request.changeset,attempt={sid:c.sid,reqId:c.reqId,hash:createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex')};
  if(a.attempt&&!equal(a.attempt,attempt))fail();if(!a.attempt){if(!admission)fail();a.attempt=attempt;}
 }
 validate(s,context,view){
  const session=this.authority.sessions.get(context.memberID),a=this.action(s,context,session),c=context.changeset,original=context.request.changeset;
  this.authority.check(s,context.userID,c.unitID,true,session);
  if(!a||a.head!==view.revision||original.baseRev!==view.revision||!equal(c.mutations,original.mutations))fail();this.checkTarget(s,context.userID,c.unitID,view,a.input);
 }
}
