import { AbsoluteRefType } from '@univerjs/core';
import { adjustRangeOnMutation } from '@univerjs/sheets';
import { CollabError, UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { CompressMutationService, transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { isDeepStrictEqual } from 'node:util';
export const MERGE='sheet.mutation.add-worksheet-merge',UNMERGE='sheet.mutation.remove-worksheet-merge';
const VALUES='sheet.mutation.set-range-values',INSERT='sheet.mutation.insert-row',REMOVE='sheet.mutation.remove-rows';
const structural = m => [INSERT,REMOVE].includes(m.id);
const explicitMerge = c => c.mutations.some(m=>[MERGE,UNMERGE].includes(m.id));
const refuse=()=>{throw new CollabError('PERMISSION_DENIED','Native merge requires a current, non-overlapping range with no lost content, changed formatting or comment anchors',{retryable:false});};
export const contains=(r,row,col)=>row>=r.startRow&&row<=r.endRow&&col>=r.startColumn&&col<=r.endColumn;
export const mergedTarget=(sheet,row,col)=>(sheet.mergeData??[]).some(r=>contains(r,row,col));
const plainObject=value=>value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype;
const intersects=(a,b)=>a.startRow<=b.endRow&&b.startRow<=a.endRow&&a.startColumn<=b.endColumn&&b.startColumn<=a.endColumn;
const keys=['startRow','endRow','startColumn','endColumn'];
const referenceKeys=['startAbsoluteRefType','endAbsoluteRefType'];
const referenceTypes=[AbsoluteRefType.NONE,AbsoluteRefType.ROW,AbsoluteRefType.COLUMN,AbsoluteRefType.ALL];
// Public IRange metadata is preserved, including the name-box parser's flags.
const rangeMetadata=r=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>keys.includes(k)||k==='rangeType'||referenceKeys.includes(k))&&referenceKeys.every(k=>r[k]===undefined||referenceTypes.includes(r[k]));
export function mergeRange(r,sheet){if(!rangeMetadata(r)||r.rangeType!==undefined&&r.rangeType!==0||keys.some(k=>!Number.isSafeInteger(r[k])||r[k]<0)||r.endRow<r.startRow||r.endColumn<r.startColumn||r.endRow>=sheet.rowCount||r.endColumn>=sheet.columnCount||(r.endRow-r.startRow+1)*(r.endColumn-r.startColumn+1)>4096||(r.startRow===r.endRow&&r.startColumn===r.endColumn))refuse();}
// One rectangle, either merged whole or completely tiled by single-row/column
// strips. Sorting is validation only; native payload/metadata is never rewritten.
export function mergeRanges(ranges,sheet){
 if(!Array.isArray(ranges)||!ranges.length||ranges.length>64)refuse();
 for(const r of ranges)mergeRange(r,sheet);
 if(ranges.length===1)return ranges[0];
 const horizontal=ranges.every(r=>r.startRow===r.endRow),ordered=[...ranges].sort((a,b)=>horizontal?a.startRow-b.startRow:a.startColumn-b.startColumn),first=ordered[0];
 if(!ordered.every((r,n)=>horizontal?r.startRow===first.startRow+n&&r.startColumn===first.startColumn&&r.endColumn===first.endColumn:r.startColumn===r.endColumn&&r.startColumn===first.startColumn+n&&r.startRow===first.startRow&&r.endRow===first.endRow))refuse();
 const last=ordered.at(-1),bound={startRow:first.startRow,endRow:last.endRow,startColumn:first.startColumn,endColumn:last.endColumn};mergeRange(bound,sheet);return bound;
}
function roots(data){const resource=data.resources?.find(r=>r.name==='SHEET_UNIVER_THREAD_COMMENT_PLUGIN');return resource?JSON.parse(resource.data)['sheet-1']??[]:[];}
export function validateMerge(data,mutations){
 const sheet=data.sheets['sheet-1'];if(!sheet)refuse();const list=mutations.map(m=>({id:m.id,p:JSON.parse(m.data)})),operations=list.filter(m=>[MERGE,UNMERGE].includes(m.id));
 if(operations.length!==1)refuse();const {id,p}=operations[0];if(Object.keys(p).some(k=>!['unitId','subUnitId','ranges','trigger'].includes(k))||p.unitId!==data.id||p.subUnitId!=='sheet-1'||!Array.isArray(p.ranges))refuse();const bound=mergeRanges(p.ranges,sheet);
 if(id===MERGE&&list.length!==1||id===UNMERGE&&(list[0].id!==UNMERGE||list.length>2||list[1]&&list[1].id!==VALUES))refuse();
 if(id===MERGE&&(sheet.mergeData??[]).some(m=>intersects(m,bound)))refuse();
 if(id===UNMERGE&&(p.ranges.some(r=>!(sheet.mergeData??[]).some(m=>keys.every(k=>m[k]===r[k])))||(sheet.mergeData??[]).some(m=>intersects(m,bound)&&!p.ranges.some(r=>keys.every(k=>m[k]===r[k])))))refuse();
 for(const root of roots(data)){const match=/^([A-Z]+)([1-9][0-9]*)$/.exec(root.ref);if(!match)refuse();let col=0;for(const c of match[1])col=col*26+c.charCodeAt(0)-64;if(contains(bound,Number(match[2])-1,col-1))refuse();}
 const style=c=>{const value=c?.s;if(value==null)return null;const resolved=typeof value==='string'&&Object.hasOwn(data.styles??{},value)?data.styles[value]:value;if(!plainObject(resolved))refuse();return resolved;};
 const expected={};
 for(const r of p.ranges){const anchorStyle=style(sheet.cellData?.[r.startRow]?.[r.startColumn]);
 for(let row=r.startRow;row<=r.endRow;row++)for(let col=r.startColumn;col<=r.endColumn;col++){
  const cell=sheet.cellData?.[row]?.[col];if(row===r.startRow&&col===r.startColumn)continue;
  if(id===MERGE&&['v','f','si','p','ft','fd'].some(k=>cell?.[k]!=null))refuse();
  if(id===UNMERGE){if(!isDeepStrictEqual(style(cell),anchorStyle))refuse();
   if(anchorStyle!==null){expected[row]??={};expected[row][col]={s:anchorStyle};}
  }
 }
 }
 // Only the public unmerge companion: every styled non-anchor coordinate,
 // no content fields, and no formatting change. Numeric map keys are scoped to
 // this compressed mutation, never interpreted as workbook style IDs.
 if(!list[1]){if(Object.keys(expected).length)refuse();return;}
 const q=list[1].p;
 if(!plainObject(q)||q.unitId!==data.id||q.subUnitId!=='sheet-1'||Object.keys(q).some(k=>!['unitId','subUnitId','cellValue','trigger','styleRefMap'].includes(k))||!plainObject(q.cellValue)||('styleRefMap' in q&&!plainObject(q.styleRefMap)))refuse();
 const map=q.styleRefMap??{},mapKeys=Object.keys(map),used=new Set();
 if(mapKeys.length>64||mapKeys.some((k,n)=>k!==String(n)||!plainObject(map[k])||mapKeys.slice(0,n).some(prior=>isDeepStrictEqual(map[prior],map[k]))))refuse();
 for(const [row,cols] of Object.entries(q.cellValue)){
  if(!/^(0|[1-9][0-9]*)$/.test(row)||!plainObject(cols)||!Object.keys(cols).length)refuse();
  for(const [col,cell] of Object.entries(cols)){
   if(!/^(0|[1-9][0-9]*)$/.test(col)||!contains(bound,+row,+col)||!plainObject(cell)||Object.keys(cell).join()!=='s')refuse();
   if(mapKeys.length){if(typeof cell.s!=='string'||!Object.hasOwn(map,cell.s))refuse();used.add(cell.s);}
   else if(!plainObject(cell.s))refuse();
  }
 }
 if(used.size!==mapKeys.length)refuse();
 const compressor=new CompressMutationService();
 try{
  const point=compressor.interceptor.getInterceptPoints().COMPRESS_MUTATION_APPLY;
  const applied=compressor.interceptor.fetchThroughInterceptors(point)([{id:VALUES,params:structuredClone(q)}],null);
  if(!isDeepStrictEqual(applied[0]?.params.cellValue,expected))refuse();
 }finally{compressor.interceptor.dispose();}

}
// Validation-only range projection uses the pinned public SDK transformation.
// Nothing is written here; the native service alone transforms/commits content.
function validateRows(data, mutations, allowNativeRepair) {
 const sheet=data.sheets['sheet-1'];if(!sheet)refuse();
 let rows=sheet.rowCount,merges=structuredClone(sheet.mergeData??[]);
 const parsed=mutations.map(m=>({id:m.id,params:JSON.parse(m.data)})),rowOps=parsed.filter(structural),repairs=parsed.filter(m=>[MERGE,UNMERGE].includes(m.id));
 if(repairs.length && (!allowNativeRepair||rowOps.length!==1||parsed.length!==3||parsed[0].id!==UNMERGE||!structural(parsed[1])||parsed[2].id!==MERGE))refuse();
 for(const m of rowOps){
  const p=m.params,r=p?.range;
  if(p?.unitId!==data.id||p.subUnitId!=='sheet-1'||!rangeMetadata(r)||r.rangeType!==undefined&&r.rangeType!==1||keys.some(k=>!Number.isSafeInteger(r[k])||r[k]<0)||r.startColumn!==0||r.endColumn!==sheet.columnCount-1||r.endRow<r.startRow||r.startRow>rows||(m.id===REMOVE&&r.endRow>=rows))refuse();
  const count=r.endRow-r.startRow+1,nextRows=rows+(m.id===INSERT?count:-count);if(!Number.isSafeInteger(nextRows)||nextRows<1)refuse();
  // Insert at the first row is before the merge; removal touching any merged
  // row, or insertion strictly inside it, remains unsupported even if SDK OT
  // has wrapped the primitive with remove/add merge repairs.
  if(merges.some(x=>m.id===INSERT?r.startRow>x.startRow&&r.startRow<=x.endRow:r.startRow<=x.endRow&&r.endRow>=x.startRow))refuse();
  merges=merges.map(x=>{const next=adjustRangeOnMutation(x,m);if(!next||next.startRow<0||next.endRow>=nextRows)refuse();return next;});rows=nextRows;
 }
 if(repairs.length){
  const removed=repairs[0].params,added=repairs[1].params;
  for(const p of [removed,added])if(p.unitId!==data.id||p.subUnitId!=='sheet-1'||Object.keys(p).some(k=>!['unitId','subUnitId','ranges','trigger'].includes(k))||!Array.isArray(p.ranges)||!p.ranges.length)refuse();
  // Only a verified SDK-generated single-row repair pair is accepted. It must
  // remove existing ranges and add exactly their native adjusted counterparts.
  if(removed.ranges.length!==added.ranges.length||removed.ranges.length>sheet.mergeData.length)refuse();
  const matched=new Set();for(let n=0;n<removed.ranges.length;n++){
   const index=sheet.mergeData.findIndex(x=>isDeepStrictEqual(x,removed.ranges[n]));
   if(index<0||matched.has(index)||!isDeepStrictEqual(merges[index],added.ranges[n]))refuse();matched.add(index);
  }
 }
}
export class NativeMerge {
 constructor(authority,service){Object.assign(this,{authority,service});}
 needs(c){return explicitMerge(c)||c.mutations.some(structural);}
 admissionRevision(c){return explicitMerge(c)?0:c.baseRev;}
 async prepare(principal,unitID,session,revision=0){if(!Number.isSafeInteger(revision)||revision<0)refuse();const load=await this.authority.scope.run({unitID,session},()=>this.service.getUnitLoadDataWithBlocks({unitID,type:2,revision},{userID:principal}));const m=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});try{const state=await m.materializeSnapshot(load);return {revision:load.targetRevision,data:await transformSnapshotToWorkbookData(state.snapshot,[...state.sheetBlocks])};}finally{await m.dispose();}}
 validate(c,view){
  if(c.changeset.baseRev!==view.revision)refuse();
  if(explicitMerge(c.request.changeset)){
   if(c.request.changeset.baseRev!==view.revision||!isDeepStrictEqual(c.request.changeset.mutations,c.changeset.mutations))refuse();validateMerge(view.data,c.changeset.mutations);
  }else validateRows(view.data,c.changeset.mutations,c.request.changeset.mutations.every(structural));
 }
}
