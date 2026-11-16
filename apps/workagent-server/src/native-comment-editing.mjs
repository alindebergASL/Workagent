// Private immutable versions; only exact native receipts publish a version.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
export const UPDATE_COMMENT = 'thread-comment.mutation.update-comment';
const fail = () => { throw new Fault('native_comment_refused',409); };
const id = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x) && !['__proto__','constructor','prototype'].includes(x);
const text = body => ({dataStream:body+'\r\n',paragraphs:[{startIndex:body.length}]});
const validInput = input => !!input && Object.keys(input).sort().join()==='body,commentId,id,memberID,previousVersion' && [input.id,input.commentId,input.memberID,input.previousVersion].every(id) && typeof input.body==='string' && !!input.body.trim() && input.body.length<=8000 && !/[\u0000-\u0008\u000b-\u001f]/.test(input.body);
const nodes = view => view.roots.flatMap(root=>[root,...(root.children??[]).map(c=>({...c,ref:root.ref}))]);
export class NativeCommentEditing {
 constructor(comments){this.comments=comments;this.authority=comments.authority;}
 async receipt(principal,unitID,a){
  const result={...a.input,head:a.head,status:a.abandoned?'abandoned':'unknown',phase:a.abandoned?'abandoned':a.attempt?'admitted':'prepared'};
  if(!a.attempt||a.abandoned)return result;
  const history=await this.comments.dbAdapter.getChangesets({userID:principal,customData:{},request:{}},unitID,{from:a.head,to:a.head+1});
  const c=history?.find(c=>c.unitID===unitID&&c.type===2&&c.baseRev===a.head&&c.revision===a.head+1&&c.userID===a.principal&&c.memberID===a.input.memberID&&c.sid===a.attempt.sid&&c.reqId===a.attempt.reqId&&createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex')===a.attempt.hash);
  if(!c||c.mutations.length!==1||c.mutations[0].id!==UPDATE_COMMENT)return result;
  let p;try{p=JSON.parse(c.mutations[0].data);}catch{return result;}
  if(!this.matches(unitID,p,a))return result;
  return {...result,status:'committed',revision:c.revision};
 }
 matches(unitID,p,a){return p?.unitId===unitID&&p.subUnitId==='sheet-1'&&Object.keys(p).every(k=>['unitId','subUnitId','payload','trigger'].includes(k))&&equal(p.payload,{commentId:a.input.commentId,text:text(a.input.body)});}
 async project(principal,unitID,session,view){
  const edits=await this.authority.workspace.store.read(s=>{this.authority.check(s,principal,unitID,false,session);return Object.values(s.works[unitID].nativeCommentEdits??{});});
  const latest=new Map();for(const a of edits)if(a.attempt&&!a.abandoned&&a.head<view.revision&&(!latest.has(a.input.commentId)||latest.get(a.input.commentId).head<a.head))latest.set(a.input.commentId,a);
  // One exact revision lookup per live comment, never the intervening cell history.
  for(const root of view.roots)for(const meta of [root,...(root.children??[])]){
   meta.bodyVersion='original';const a=latest.get(meta.id);if(!a)continue;
   const r=await this.receipt(principal,unitID,a);
   if(r.status==='committed'){meta.bodyVersion=a.input.id;meta.editedText=text(a.input.body);meta.bodyRevision=r.revision;}
   else{meta.bodyUnknown=true;delete meta.bodyVersion;}
  }
 }
 async prepare(principal,unitID,session,input,send){
  if(!validInput(input)||!session.binding)fail();
  const view=await this.comments.prepare(principal,unitID,session);
  await this.authority.workspace.store.transaction(async s=>{
   this.authority.check(s,principal,unitID,true,session);
   const records=s.works[unitID].nativeCommentEdits??={},old=records[input.id];
   if(old){if(old.principal!==principal||old.epoch!==session.revision||old.binding!==session.binding||!equal(old.input,input))fail();return;}
   await this.comments.current(principal,unitID,view);
   const member=this.authority.sessions.get(input.memberID),meta=nodes(view).find(c=>c.id===input.commentId),w=s.works[unitID],claim=w.nativeCommentClaims?.[input.commentId];
   if(!member||member.action||member.userID!==principal||member.unitID!==unitID||member.revision!==session.revision||member.binding!==session.binding||!meta||meta.personId!==principal||claim?.principal!==principal||meta.bodyUnknown||meta.bodyVersion!==input.previousVersion)fail();
   if(Object.keys(records).length>=4096||equal(meta.editedText??claim.comment.text,text(input.body)))fail();
   for(const a of Object.values(records).filter(a=>a.input.commentId===input.commentId)){
    if(a.abandoned){if(a.head===view.revision&&a.input.memberID===input.memberID&&a.input.body===input.body)fail();}
    else if((await this.receipt(principal,unitID,a)).status!=='committed')fail();
   }
   await this.comments.current(principal,unitID,view);
   records[input.id]={input:structuredClone(input),principal,epoch:session.revision,binding:session.binding,head:view.revision,ref:meta.ref,author:meta.personId,threadId:meta.threadId};
  });
  await this.authority.workspace.store.transaction(async s=>{this.authority.check(s,principal,unitID,true,session);send(await this.receipt(principal,unitID,s.works[unitID].nativeCommentEdits[input.id]));});
 }
 async abandon(principal,unitID,session,key,send,input){
  if(!id(key)||!session.binding||(input!==undefined&&(!validInput(input)||input.id!==key)))fail();
  await this.authority.workspace.store.transaction(async s=>{
   this.authority.check(s,principal,unitID,true,session);
   const w=s.works[unitID],records=w.nativeCommentEdits??={};let a=records[key];
   if(a){if(a.principal!==principal||a.epoch!==session.revision||a.binding!==session.binding||a.attempt||(input!==undefined&&!equal(a.input,input)))fail();}
   else{
    // Explicit settlement, not inference from a 409/absent receipt. Under the
    // admission lock, an absent identity cannot have admitted an edit. Seal it
    // permanently before replying so delayed preparation cannot resurrect it.
    const claim=input&&w.nativeCommentClaims?.[input.commentId],member=input&&this.authority.sessions.get(input.memberID);
    if(!input||claim?.principal!==principal||Object.keys(records).length>=4096||member&&(member.action||member.userID!==principal||member.unitID!==unitID||member.revision!==session.revision||member.binding!==session.binding))fail();
    const unit=await this.comments.dbAdapter.getUnit({userID:principal,customData:{},request:{}},unitID);
    if(!unit||!Number.isSafeInteger(unit.headRevision))fail();
    // Do not poison another live preparation whose revisionless SDK payload
    // would match the same native member/head/body tuple.
    if(Object.values(records).some(r=>!r.abandoned&&r.head===unit.headRevision&&r.input.memberID===input.memberID&&r.input.commentId===input.commentId&&r.input.body===input.body))fail();
    a=records[key]={input:structuredClone(input),principal,epoch:session.revision,binding:session.binding,head:unit.headRevision,unprepared:true};
   }
   a.abandoned=true;
  });
  await this.authority.workspace.store.transaction(async s=>{this.authority.check(s,principal,unitID,true,session);send(await this.receipt(principal,unitID,s.works[unitID].nativeCommentEdits[key]));});
 }
 action(s,context,session){
  const c=context.request.changeset;if(!c.mutations.some(m=>m.id===UPDATE_COMMENT))return;
  if(c.mutations.length!==1)fail();const p=JSON.parse(c.mutations[0].data);
  const found=Object.values(s.works[c.unitID].nativeCommentEdits??{}).filter(a=>a.principal===context.userID&&a.epoch===session.revision&&a.binding===session.binding&&a.input.memberID===context.memberID&&a.head===c.baseRev&&this.matches(c.unitID,p,a));
  if(found.length!==1||found[0].abandoned)fail();return found[0];
 }
 bind(s,context,session,admission){
  const a=this.action(s,context,session);if(!a)return;
  const c=context.request.changeset,attempt={sid:c.sid,reqId:c.reqId,hash:createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex')};
  if(a.attempt&&!equal(a.attempt,attempt))fail();if(!a.attempt){if(!admission)fail();a.attempt=attempt;}
 }
 validate(s,context,view){
  const session=this.authority.sessions.get(context.memberID),a=this.action(s,context,session),c=context.changeset,original=context.request.changeset;
  this.authority.check(s,context.userID,c.unitID,true,session);
  const meta=nodes(view).find(m=>m.id===a?.input.commentId);
  if(!a||!meta||meta.personId!==context.userID||meta.personId!==a.author||meta.threadId!==a.threadId||meta.ref!==a.ref||meta.bodyUnknown||meta.bodyVersion!==a.input.previousVersion||a.head!==view.revision||original.baseRev!==view.revision||!equal(c.mutations,original.mutations))fail();
 }
}
