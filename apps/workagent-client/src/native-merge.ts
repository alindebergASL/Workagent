import { AbsoluteRefType, CanceledError, Dimension } from '@univerjs/core';
import type { ICommandService, IWorkbookData, IRange } from '@univerjs/core';
// These are the public pinned command IDs; primitive mutation observers cannot
// safely cancel a multi-mutation merge after its first write.
const ADD='sheet.command.add-worksheet-merge', REMOVE='sheet.command.remove-worksheet-merge';
const fields=['startRow','endRow','startColumn','endColumn'] as const;
const referenceKeys=['startAbsoluteRefType','endAbsoluteRefType'] as const;
const referenceTypes=[AbsoluteRefType.NONE,AbsoluteRefType.ROW,AbsoluteRefType.COLUMN,AbsoluteRefType.ALL];
const rangeMetadata=(r:IRange)=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>[...fields,'rangeType',...referenceKeys].includes(k))&&referenceKeys.every(k=>r[k]===undefined||referenceTypes.includes(r[k]!));
export const MERGE_GUIDANCE='Use Merge all, horizontally or vertically on one rectangle (up to 4,096 cells and 64 strips). Non-anchor content, overlapping merges and comment anchors are not supported. Unmerge requires exactly matching formatting within each merge (including preexisting styles); it never restores discarded text.';
export function guardNativeMerge(unitID:string,commands:Pick<ICommandService,'beforeCommandExecuted'>,read:()=>IWorkbookData|null,selection:()=>IRange[],allowed:()=>boolean,report:(message:string)=>void){
 return commands.beforeCommandExecuted((command,options)=>{
  if(options?.fromCollab)return;
  // Normalized public row commands run before their first primitive mutation.
  // Crossing a merge emits a compound repair batch not yet qualified here.
  if(['sheet.command.insert-row-by-range','sheet.command.remove-row-by-range'].includes(command.id)){
   const p=command.params as {unitId?:string;subUnitId?:string;range?:IRange},data=read(),r=p?.range;
   if(p?.unitId!==unitID||p?.subUnitId!=='sheet-1'||!r)return;
   if(!rangeMetadata(r)){report('Unsupported row range metadata. No row change was started.');throw new CanceledError();}
   if(data?.sheets['sheet-1']?.mergeData?.some(m=>command.id==='sheet.command.insert-row-by-range'?r.startRow>m.startRow&&r.startRow<=m.endRow:r.startRow<=m.endRow&&r.endRow>=m.startRow)){
    report('Rows crossing merged cells are not yet supported. Unmerge explicitly first. No row change was started.');throw new CanceledError();
   }
   return;
  }
  if(![ADD,REMOVE].includes(command.id))return;
  const refuse=(reason:string):never=>{report(reason+' No merge/unmerge was started.');throw new CanceledError();};
  if(!allowed())refuse('Finish pending input/edits and wait for current write access.');
  const data=read(),p=command.params as {unitId?:string;subUnitId?:string;selections?:IRange[];ranges?:IRange[];value?:unknown}|undefined,sheet=data?.sheets['sheet-1'];
  if(!data||!sheet||data.id!==unitID||p?.unitId&&p.unitId!==unitID||p?.subUnitId&&p.subUnitId!=='sheet-1'||p?.value!==undefined&&(command.id!==ADD||p.value!==Dimension.ROWS&&p.value!==Dimension.COLUMNS))refuse(MERGE_GUIDANCE);
  if(!data||!sheet)return;
  const ranges=command.id===ADD?p?.selections:p?.ranges??selection();if(!ranges||ranges.length!==1)refuse(MERGE_GUIDANCE);const r=ranges![0];
  if(!rangeMetadata(r)||r.rangeType!==undefined&&r.rangeType!==0||fields.some(k=>!Number.isSafeInteger(r[k])||r[k]<0)||r.endRow<r.startRow||r.endColumn<r.startColumn||r.endRow>=(sheet.rowCount??0)||r.endColumn>=(sheet.columnCount??0)||(r.endRow-r.startRow+1)*(r.endColumn-r.startColumn+1)>4096||r.startRow===r.endRow&&r.startColumn===r.endColumn)refuse(MERGE_GUIDANCE);
  const contains=(row:number,col:number)=>row>=r.startRow&&row<=r.endRow&&col>=r.startColumn&&col<=r.endColumn;
  const overlaps=(m:IRange)=>m.startRow<=r.endRow&&r.startRow<=m.endRow&&m.startColumn<=r.endColumn&&r.startColumn<=m.endColumn;
  let strips:IRange[]=[r];
  if(command.id===ADD){
   if(sheet.mergeData?.some(overlaps))refuse(MERGE_GUIDANCE);
   const count=p?.value===Dimension.ROWS?r.endRow-r.startRow+1:p?.value===Dimension.COLUMNS?r.endColumn-r.startColumn+1:1;
   if(count>64||p?.value===Dimension.ROWS&&r.startColumn===r.endColumn||p?.value===Dimension.COLUMNS&&r.startRow===r.endRow)refuse(MERGE_GUIDANCE);
   if(p?.value===Dimension.ROWS)strips=Array.from({length:count},(_,n)=>({...r,startRow:r.startRow+n,endRow:r.startRow+n}));
   if(p?.value===Dimension.COLUMNS)strips=Array.from({length:count},(_,n)=>({...r,startColumn:r.startColumn+n,endColumn:r.startColumn+n}));
  }else{
   strips=(sheet.mergeData??[]).filter(overlaps);
   if(!strips.length||strips.length>64)refuse(MERGE_GUIDANCE);
   if(strips.length===1){if(!fields.every(k=>strips[0][k]===r[k]))refuse(MERGE_GUIDANCE);}
   else{
    const horizontal=strips.every(m=>m.startRow===m.endRow),ordered=[...strips].sort((a,b)=>horizontal?a.startRow-b.startRow:a.startColumn-b.startColumn);
    if(!ordered.every((m,n)=>horizontal?m.startRow===r.startRow+n&&m.startColumn===r.startColumn&&m.endColumn===r.endColumn:m.startColumn===m.endColumn&&m.startColumn===r.startColumn+n&&m.startRow===r.startRow&&m.endRow===r.endRow)||ordered.at(-1)!.endRow!==r.endRow||ordered.at(-1)!.endColumn!==r.endColumn)refuse(MERGE_GUIDANCE);
   }
  }
  const resource=data.resources?.find(x=>x.name==='SHEET_UNIVER_THREAD_COMMENT_PLUGIN');
  if(resource)for(const root of JSON.parse(resource.data)['sheet-1']??[]){const m=/^([A-Z]+)([1-9][0-9]*)$/.exec(root.ref);if(!m)refuse(MERGE_GUIDANCE);let col=0;for(const c of m![1])col=col*26+c.charCodeAt(0)-64;if(contains(Number(m![2])-1,col-1))refuse('This range contains a comment anchor. Choose a range outside the thread.');}
  const style=(row:number,col:number)=>{const s=sheet.cellData?.[row]?.[col]?.s;if(s==null)return null;
   const resolved=typeof s==='string'&&data.styles&&Object.hasOwn(data.styles,s)?data.styles[s]:s;
   if(!resolved||typeof resolved!=='object'||Array.isArray(resolved))refuse('Unresolved cell formatting is not supported.');return resolved;};
  const exactStyle=(s:unknown)=>JSON.stringify(s,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  for(const strip of strips)for(let row=strip.startRow;row<=strip.endRow;row++)for(let col=strip.startColumn;col<=strip.endColumn;col++){
   if(row===strip.startRow&&col===strip.startColumn)continue;const c=sheet.cellData?.[row]?.[col];
   if(command.id===ADD&&[c?.v,c?.f,c?.si,c?.p,c?.ft,c?.fd].some(v=>v!=null))refuse('Merge would discard non-anchor content. Move that content explicitly first. Unmerge does not restore it.');
   if(command.id===REMOVE&&exactStyle(style(row,col))!==exactStyle(style(strip.startRow,strip.startColumn)))refuse('Native unmerge would replace cell formatting. This case is not yet supported.');
  }
  report(MERGE_GUIDANCE);
 });
}
