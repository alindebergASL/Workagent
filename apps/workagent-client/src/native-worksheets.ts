import {CanceledError,DEFAULT_WORKSHEET_ROW_COUNT,DEFAULT_WORKSHEET_COLUMN_COUNT} from '@univerjs/core';
import type {ICommandService,IWorkbookData,ICellData,IRange} from '@univerjs/core';
export const WORKSHEET_GUIDANCE='Native tabs support up to four blank worksheets, rename, reorder of additional tabs (original stays first), and scalar cells. Comments, merge/row operations, reversal and agent proposals remain on the original worksheet. Delete, duplicate, import and rename with formulas are not yet supported.';
const ADD='sheet.command.insert-sheet',RENAME='sheet.command.set-worksheet-name',SELECT='sheet.operation.set-worksheet-active',ORDER='sheet.command.set-worksheet-order';
const forbidden=new Set(['sheet.command.remove-sheet','sheet.command.copy-sheet','sheet.command.set-worksheet-hidden','sheet.command.set-worksheet-show']);
export function guardNativeWorksheets(unitID:string,commands:Pick<ICommandService,'beforeCommandExecuted'>,read:()=>IWorkbookData|null,active:()=>string|undefined,canWrite:()=>boolean,busy:()=>boolean,report:(text:string)=>void,selections:()=>readonly IRange[]=()=>[]){
 return commands.beforeCommandExecuted((c,options)=>{
  if(options?.fromCollab)return;const p=c.params as any;
  const refuse=()=>{report(WORKSHEET_GUIDANCE+' Finish pending input before changing tabs. No worksheet command was started.');throw new CanceledError();};
  if(forbidden.has(c.id))refuse();
  if(c.id===SELECT||c.id==='sheet.command.set-worksheet-activate'){if(busy())refuse();return;}
  const sheet=p?.subUnitId??active();
  if(sheet!=='sheet-1'&&(['sheet.command.add-worksheet-merge','sheet.command.add-worksheet-merge-all','sheet.command.remove-worksheet-merge','sheet.command.insert-row-by-range','sheet.command.remove-row-by-range'].includes(c.id)||c.id.startsWith('thread-comment.command.')))refuse();
  if(sheet!=='sheet-1'&&['sheet.command.clear-selection-all','sheet.command.clear-selection-format','sheet.command.auto-clear-content'].includes(c.id))refuse();
  if(sheet!=='sheet-1'&&c.id==='sheet.command.clear-selection-content'){
   // Match the public command's current-selection fallback before any mutation.
   const tab=sheet?read()?.sheets[sheet]:undefined,ranges=p?.ranges??selections();
   const r=Array.isArray(ranges)&&ranges.length===1?ranges[0]:undefined;
   if(!canWrite()||busy()||p?.unitId&&p.unitId!==unitID||!tab||!r||
    ![r.startRow,r.endRow,r.startColumn,r.endColumn].every(Number.isSafeInteger)||
    r.startRow!==r.endRow||r.startColumn!==r.endColumn||r.startRow<0||r.startColumn<0||
    r.endRow>=tab.rowCount!||r.endColumn>=tab.columnCount!||r.rangeType!=null&&r.rangeType!==0)refuse();
  }
  if(sheet!=='sheet-1'&&c.id==='sheet.command.set-range-values'){
   const data=read(),tab=sheet?data?.sheets[sheet]:undefined,r=p?.range,v=p?.value;
   // Native plain typing includes an own p: undefined; actual rich text is still refused.
   if(!tab||!r||r.startRow!==r.endRow||r.startColumn!==r.endColumn||r.startRow<0||r.startColumn<0||r.endRow>=tab.rowCount!||r.endColumn>=tab.columnCount!||!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['v','t','s','f','si','ft','fd'].includes(k)&&!(k==='p'&&v.p===undefined))||['f','si','ft','fd'].some(k=>v[k]!=null)||typeof v.v==='string'&&v.v.startsWith('='))refuse();
  }
  if(![ADD,RENAME,ORDER].includes(c.id))return;
  if(!canWrite()||busy())refuse();const data=read();if(!data||p?.unitId&&p.unitId!==unitID)refuse();if(!data)return;
  if(c.id===ORDER){
   const ids=data.sheetOrder;
   if(!p||Object.getPrototypeOf(p)!==Object.prototype||Object.keys(p).some(k=>!['unitId','subUnitId','order'].includes(k))||
    ('unitId' in p&&p.unitId!==unitID)||('subUnitId' in p&&typeof p.subUnitId!=='string')||
    ids.length>4||ids[0]!=='sheet-1'||new Set(ids).size!==ids.length||ids.some(id=>!Object.hasOwn(data.sheets,id)||data.sheets[id].id!==id)||
    !sheet||sheet==='sheet-1'||!ids.includes(sheet)||!Number.isSafeInteger(p.order)||p.order<1||p.order>=ids.length||ids.indexOf(sheet)===p.order)refuse();
   return;
  }
  if(c.id===ADD){
   // Native '+' supplies only default dimensions. The SDK generates identity/name
   // and the server still requires the complete canonical blank snapshot.
   const defaults=p?.sheet;
   if(p!==undefined&&(!p||Object.getPrototypeOf(p)!==Object.prototype||Object.keys(p).some(k=>!['unitId','index','sheet'].includes(k))))refuse();
   if(defaults!==undefined&&(!defaults||Object.getPrototypeOf(defaults)!==Object.prototype||Object.keys(defaults).length!==2||
    !Object.hasOwn(defaults,'rowCount')||!Object.hasOwn(defaults,'columnCount')||
    defaults.rowCount!==DEFAULT_WORKSHEET_ROW_COUNT||defaults.columnCount!==DEFAULT_WORKSHEET_COLUMN_COUNT))refuse();
   if(data.sheetOrder.length>=4||p?.index!==undefined&&p.index!==data.sheetOrder.length)refuse();return;
  }
  if(Object.values(data.sheets).some(tab=>Object.values(tab.cellData??{}).some(row=>Object.values(row).some(cell=>(cell as ICellData)?.f||(cell as ICellData)?.si))))refuse();
  const name=p?.name;if(typeof name!=='string'||!name.length||name.length>31||name.trim()!==name||/[\\/:?*\[\]\x00-\x1f]/.test(name)||!sheet||!data.sheets[sheet]||data.sheetOrder.some(id=>id!==sheet&&(data.sheets[id].name??'').toLowerCase()===name.toLowerCase()))refuse();
 });
}
