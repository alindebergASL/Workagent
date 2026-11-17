import {CanceledError,DEFAULT_WORKSHEET_ROW_COUNT,DEFAULT_WORKSHEET_COLUMN_COUNT,mergeWorksheetSnapshotWithDefault} from '@univerjs/core';
import type {ICommandService,IWorkbookData,ICellData,IRange} from '@univerjs/core';
export const WORKSHEET_GUIDANCE='Native tabs support up to four blank worksheets, rename, reorder of additional tabs (original stays first), and scalar cells. Comments, merge/row operations, reversal and agent proposals remain on the original worksheet. Copy supports additional scalar-only tabs with default layout, supported resources and up to 4,096 populated cells; Delete, import and rename with formulas are not yet supported.';
const ADD='sheet.command.insert-sheet',RENAME='sheet.command.set-worksheet-name',SELECT='sheet.operation.set-worksheet-active',ORDER='sheet.command.set-worksheet-order',COPY='sheet.command.copy-sheet';
const forbidden=new Set(['sheet.command.remove-sheet','sheet.command.set-worksheet-hidden','sheet.command.set-worksheet-show']);
const copyStable=(x:any):string=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(copyStable(v))):Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,JSON.parse(copyStable(x[k]))])):x);
const copyEqual=(a:any,b:any)=>copyStable(a)===copyStable(b);

const copyResources=new Set(['SHEET_RANGE_PROTECTION_PLUGIN','SHEET_AuthzIoMockService_PLUGIN','SHEET_WORKSHEET_PROTECTION_PLUGIN','SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN','SHEET_DEFINED_NAME_PLUGIN','SHEET_RANGE_THEME_MODEL_PLUGIN','SHEET_UNIVER_THREAD_COMMENT_PLUGIN','SHEET_SPARKLINE_PLUGIN','SHEET_CONDITIONAL_FORMATTING_PLUGIN','SHEET_OUTLINE_PLUGIN','SHEET_DRAWING_PLUGIN','SHEET_CHART_PLUGIN','SHEET_NOTE_PLUGIN','SHEET_SHAPE_PLUGIN','SHEET_DATA_VALIDATION_PLUGIN','SHEET_FILTER_PLUGIN','SHEET_TABLE_PLUGIN']);
const plainCopy=(x:any)=>!!x&&Object.getPrototypeOf(x)===Object.prototype;
export function qualifiedCopySource(data:any,id:string){
 const source=data.sheets[id];
 if(id==='sheet-1'||!source||source.id!==id||data.sheetOrder[0]!=='sheet-1'||data.sheetOrder.length>=4||new Set(data.sheetOrder).size!==data.sheetOrder.length||!data.sheetOrder.includes(id))return false;
 // Only canonical blank-sheet structure plus bounded scalar cells; no property is stripped to fit.
 const expected=mergeWorksheetSnapshotWithDefault({id,name:source.name});
 if(Object.keys(source).some(k=>!Object.hasOwn(expected,k)&&!(k==='backgroundImage'&&source[k]===undefined))||!copyEqual({...source,cellData:{}},expected)||!plainCopy(source.cellData))return false;
 const emptyResources:Record<string,unknown>={
  UNIVER_OLE_ATTACHMENT_PLUGIN:{files:{},objects:{}},UNIVER_EMBED_RESOURCE_PLUGIN:{version:1,embeds:{}},
  SHEET_PIVOT_CHART_PLUGIN:{charts:{}},SHEET_SLICER_PLUGIN:{slicerCaches:[],slicers:[],timelineCaches:[],timelines:[]},
  SHEET_EXTERNAL_DATA_PLUGIN:{links:[]},UNIVER_EXTERNAL_REFERENCE_PLUGIN:{references:{}},
  SHEET_PIVOT_TABLE_PLUGIN:{dataFieldManagerConfig:{[data.id]:{collections:{},dataFields:{}}},pivotTableConfigs:{},pivotCacheConfigs:{[data.id]:{}}}
 };
 for(const resource of data.resources??[]){
  if((!copyResources.has(resource.name)&&!Object.hasOwn(emptyResources,resource.name))||typeof resource.data!=='string')return false;
  let parsed;try{parsed=resource.data===''?{}:JSON.parse(resource.data);}catch{return false;}
  if(!plainCopy(parsed))return false;
  if(Object.hasOwn(emptyResources,resource.name)){if(!copyEqual(parsed,emptyResources[resource.name]))return false;continue;}
  if(resource.name==='SHEET_UNIVER_THREAD_COMMENT_PLUGIN'){if(Object.keys(parsed).some(k=>k!=='sheet-1'))return false;}
  else if(Object.keys(parsed).length)return false;
 }
 let count=0;
 for(const [r,row]of Object.entries<any>(source.cellData)){
  if(!/^(0|[1-9][0-9]*)$/.test(r)||+r>=source.rowCount||!plainCopy(row))return false;
  for(const [c,cell]of Object.entries<any>(row)){
   if(++count>4096||!/^(0|[1-9][0-9]*)$/.test(c)||+c>=source.columnCount||!plainCopy(cell)||Object.keys(cell).some(k=>!['v','t','s','f','si','ft','fd','p','custom'].includes(k)))return false;
   if(['f','si','ft','fd','p','custom'].some(k=>cell[k]!=null)||cell.v!=null&&!['string','number','boolean'].includes(typeof cell.v)||typeof cell.v==='number'&&!Number.isFinite(cell.v)||typeof cell.v==='string'&&(cell.v.startsWith('=')||cell.v.length>20000)||cell.t!=null&&![1,2,3,4].includes(cell.t))return false;
   if(cell.s!=null){const style=typeof cell.s==='string'&&Object.hasOwn(data.styles??{},cell.s)?data.styles[cell.s]:cell.s;if(!plainCopy(style))return false;}
  }
 }
 return true;
}

export function guardNativeWorksheets(unitID:string,commands:Pick<ICommandService,'beforeCommandExecuted'>,read:()=>IWorkbookData|null,active:()=>string|undefined,canWrite:()=>boolean,busy:()=>boolean,report:(text:string)=>void,selections:()=>readonly IRange[]=()=>[]){
 let copyActivation:string|undefined;
 return commands.beforeCommandExecuted((c,options)=>{
  if(options?.fromCollab)return;const p=c.params as any;
  // Public InsertSheet controller auto-selects its new local sheet. Suppress only
  // this view operation in the synchronous copy invocation, never native writes.
  if(c.id==='sheet.mutation.insert-sheet'&&p?.unitId===unitID&&p?.trigger===COPY){const id=p.sheet?.id;copyActivation=id;queueMicrotask(()=>{if(copyActivation===id)copyActivation=undefined;});}
  if(c.id===SELECT&&copyActivation&&p?.unitId===unitID&&p?.subUnitId===copyActivation){copyActivation=undefined;throw new CanceledError();}

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
  if(![ADD,RENAME,ORDER,COPY].includes(c.id))return;
  if(!canWrite()||busy())refuse();const data=read();if(!data||p?.unitId&&p.unitId!==unitID)refuse();if(!data)return;
  if(c.id===COPY){
   // Native context-menu dispatch includes an own value: undefined sentinel.
   if(p!==undefined&&(!p||Object.getPrototypeOf(p)!==Object.prototype||Object.keys(p).some(k=>!['unitId','subUnitId'].includes(k)&&!(k==='value'&&p.value===undefined))||('unitId' in p&&p.unitId!==unitID)||('subUnitId' in p&&typeof p.subUnitId!=='string')))refuse();
   if(!sheet||!qualifiedCopySource(data,sheet))refuse();return;
  }
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
