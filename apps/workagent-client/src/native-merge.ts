import { AbsoluteRefType, CanceledError } from '@univerjs/core';
import type { ICommandService, IWorkbookData, IRange } from '@univerjs/core';
// These are the public pinned command IDs; primitive mutation observers cannot
// safely cancel a multi-mutation merge after its first write.
const ADD='sheet.command.add-worksheet-merge', REMOVE='sheet.command.remove-worksheet-merge';
const fields=['startRow','endRow','startColumn','endColumn'] as const;
const referenceKeys=['startAbsoluteRefType','endAbsoluteRefType'] as const;
const referenceTypes=[AbsoluteRefType.NONE,AbsoluteRefType.ROW,AbsoluteRefType.COLUMN,AbsoluteRefType.ALL];
const rangeMetadata=(r:IRange)=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>[...fields,'rangeType',...referenceKeys].includes(k))&&referenceKeys.every(k=>r[k]===undefined||referenceTypes.includes(r[k]!));
export const MERGE_GUIDANCE='Use the native Merge toolbar for one range (up to 4,096 cells). Non-anchor content, overlapping merges and comment anchors are not supported. Unmerge must preserve existing formatting; it never restores discarded text.';
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
  if(!data||!sheet||data.id!==unitID||p?.unitId&&p.unitId!==unitID||p?.subUnitId&&p.subUnitId!=='sheet-1'||p?.value!==undefined)refuse(MERGE_GUIDANCE);
  if(!data||!sheet)return;
  const ranges=command.id===ADD?p?.selections:p?.ranges??selection();if(!ranges||ranges.length!==1)refuse(MERGE_GUIDANCE);const r=ranges![0];
  if(!rangeMetadata(r)||r.rangeType!==undefined&&r.rangeType!==0||fields.some(k=>!Number.isSafeInteger(r[k])||r[k]<0)||r.endRow<r.startRow||r.endColumn<r.startColumn||r.endRow>=(sheet.rowCount??0)||r.endColumn>=(sheet.columnCount??0)||(r.endRow-r.startRow+1)*(r.endColumn-r.startColumn+1)>4096||r.startRow===r.endRow&&r.startColumn===r.endColumn)refuse(MERGE_GUIDANCE);
  const contains=(row:number,col:number)=>row>=r.startRow&&row<=r.endRow&&col>=r.startColumn&&col<=r.endColumn;
  const overlaps=(m:IRange)=>m.startRow<=r.endRow&&r.startRow<=m.endRow&&m.startColumn<=r.endColumn&&r.startColumn<=m.endColumn;
  if(command.id===ADD&&sheet.mergeData?.some(overlaps)||command.id===REMOVE&&!sheet.mergeData?.some(m=>fields.every(k=>m[k]===r[k])))refuse(MERGE_GUIDANCE);
  const resource=data.resources?.find(x=>x.name==='SHEET_UNIVER_THREAD_COMMENT_PLUGIN');
  if(resource)for(const root of JSON.parse(resource.data)['sheet-1']??[]){const m=/^([A-Z]+)([1-9][0-9]*)$/.exec(root.ref);if(!m)refuse(MERGE_GUIDANCE);let col=0;for(const c of m![1])col=col*26+c.charCodeAt(0)-64;if(contains(Number(m![2])-1,col-1))refuse('This range contains a comment anchor. Choose a range outside the thread.');}
  const style=(row:number,col:number)=>{const s=sheet.cellData?.[row]?.[col]?.s;return typeof s==='string'?data.styles?.[s]??null:s??null;};
  for(let row=r.startRow;row<=r.endRow;row++)for(let col=r.startColumn;col<=r.endColumn;col++){
   if(row===r.startRow&&col===r.startColumn)continue;const c=sheet.cellData?.[row]?.[col];
   if(command.id===ADD&&[c?.v,c?.f,c?.si,c?.p,c?.ft,c?.fd].some(v=>v!=null))refuse('Merge would discard non-anchor content. Move that content explicitly first. Unmerge does not restore it.');
   if(command.id===REMOVE&&JSON.stringify(style(row,col))!==JSON.stringify(style(r.startRow,r.startColumn)))refuse('Native unmerge would replace cell formatting. This case is not yet supported.');
  }
  report(MERGE_GUIDANCE);
 });
}
