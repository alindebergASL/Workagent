// Native snapshots and commit order remain SDK-owned. This validates a bounded
// blank-sheet surface, without allowing arbitrary worksheet import or deletion.
import {mergeWorksheetSnapshotWithDefault} from '@univerjs/core';
import {CollabError} from '@univerjs-pro/collaboration-service';
import {isDeepStrictEqual} from 'node:util';
import {NativeMerge} from './native-merge.mjs';
export const INSERT_SHEET='sheet.mutation.insert-sheet',RENAME_SHEET='sheet.mutation.set-worksheet-name',ORDER_SHEET='sheet.mutation.set-worksheet-order',SHEET_VALUES='sheet.mutation.set-range-values';
const fail=()=>{throw new CollabError('PERMISSION_DENIED','Only blank worksheet addition, unique rename, additional-tab reorder and scalar cells are qualified on additional worksheets',{retryable:false});};
const nameOK=(n,max=31)=>typeof n==='string'&&n.trim()===n&&n.length>0&&n.length<=max&&!/[\\/:?*\[\]\x00-\x1f]/.test(n);

const copyResources=new Set(['SHEET_RANGE_PROTECTION_PLUGIN','SHEET_AuthzIoMockService_PLUGIN','SHEET_WORKSHEET_PROTECTION_PLUGIN','SHEET_WORKSHEET_PROTECTION_POINT_PLUGIN','SHEET_DEFINED_NAME_PLUGIN','SHEET_RANGE_THEME_MODEL_PLUGIN','SHEET_UNIVER_THREAD_COMMENT_PLUGIN','SHEET_SPARKLINE_PLUGIN','SHEET_CONDITIONAL_FORMATTING_PLUGIN','SHEET_OUTLINE_PLUGIN','SHEET_DRAWING_PLUGIN','SHEET_CHART_PLUGIN','SHEET_NOTE_PLUGIN','SHEET_SHAPE_PLUGIN','SHEET_DATA_VALIDATION_PLUGIN','SHEET_FILTER_PLUGIN','SHEET_TABLE_PLUGIN']);
const plainCopy=x=>!!x&&Object.getPrototypeOf(x)===Object.prototype;
export function qualifiedCopySource(data,id){
 const source=data.sheets[id];
 if(id==='sheet-1'||!source||source.id!==id||data.sheetOrder[0]!=='sheet-1'||data.sheetOrder.length>=4||new Set(data.sheetOrder).size!==data.sheetOrder.length||!data.sheetOrder.includes(id))return false;
 // Only canonical blank-sheet structure plus bounded scalar cells; no property is stripped to fit.
 const expected=mergeWorksheetSnapshotWithDefault({id,name:source.name});
 if(Object.keys(source).some(k=>!Object.hasOwn(expected,k)&&!(k==='backgroundImage'&&source[k]===undefined))||!isDeepStrictEqual({...source,cellData:{}},expected)||!plainCopy(source.cellData))return false;
 const emptyResources={
  UNIVER_OLE_ATTACHMENT_PLUGIN:{files:{},objects:{}},UNIVER_EMBED_RESOURCE_PLUGIN:{version:1,embeds:{}},
  SHEET_PIVOT_CHART_PLUGIN:{charts:{}},SHEET_SLICER_PLUGIN:{slicerCaches:[],slicers:[],timelineCaches:[],timelines:[]},
  SHEET_EXTERNAL_DATA_PLUGIN:{links:[]},UNIVER_EXTERNAL_REFERENCE_PLUGIN:{references:{}},
  SHEET_PIVOT_TABLE_PLUGIN:{dataFieldManagerConfig:{[data.id]:{collections:{},dataFields:{}}},pivotTableConfigs:{},pivotCacheConfigs:{[data.id]:{}}}
 };
 for(const resource of data.resources??[]){
  if((!copyResources.has(resource.name)&&!Object.hasOwn(emptyResources,resource.name))||typeof resource.data!=='string')return false;
  let parsed;try{parsed=resource.data===''?{}:JSON.parse(resource.data);}catch{return false;}
  if(!plainCopy(parsed))return false;
  if(Object.hasOwn(emptyResources,resource.name)){if(!isDeepStrictEqual(parsed,emptyResources[resource.name]))return false;continue;}
  if(resource.name==='SHEET_UNIVER_THREAD_COMMENT_PLUGIN'){if(Object.keys(parsed).some(k=>k!=='sheet-1'))return false;}
  else if(Object.keys(parsed).length)return false;
 }
 let count=0;
 for(const [r,row]of Object.entries(source.cellData)){
  if(!/^(0|[1-9][0-9]*)$/.test(r)||+r>=source.rowCount||!plainCopy(row))return false;
  for(const [c,cell]of Object.entries(row)){
   if(++count>4096||!/^(0|[1-9][0-9]*)$/.test(c)||+c>=source.columnCount||!plainCopy(cell)||Object.keys(cell).some(k=>!['v','t','s','f','si','ft','fd','p','custom'].includes(k)))return false;
   if(['f','si','ft','fd','p','custom'].some(k=>cell[k]!=null)||cell.v!=null&&!['string','number','boolean'].includes(typeof cell.v)||typeof cell.v==='number'&&!Number.isFinite(cell.v)||typeof cell.v==='string'&&(cell.v.startsWith('=')||cell.v.length>20000)||cell.t!=null&&![1,2,3,4].includes(cell.t))return false;
   if(cell.s!=null){const style=typeof cell.s==='string'&&Object.hasOwn(data.styles??{},cell.s)?data.styles[cell.s]:cell.s;if(!plainCopy(style))return false;}
  }
 }
 return true;
}

export class NativeWorksheets {
 constructor(authority,service){this.reader=new NativeMerge(authority,service);}
 needs(c){return c.mutations.some(m=>[INSERT_SHEET,RENAME_SHEET,ORDER_SHEET].includes(m.id)||(m.id===SHEET_VALUES&&JSON.parse(m.data).subUnitId!=='sheet-1'));}
 // Structural commands stay latest-only. Scalar admission reads the native
 // base that the author edited; the SDK then transforms it, and commit uses
 // a fresh current snapshot with validate()'s base/head equality unchanged.
 admissionRevision(c){return c.mutations.some(m=>[INSERT_SHEET,RENAME_SHEET,ORDER_SHEET].includes(m.id))?0:c.baseRev;}
 prepare(...args){return this.reader.prepare(...args);}
 validate(c,view){
  if(c.changeset.baseRev!==view.revision)fail();const data=view.data;
  const changes=c.changeset.mutations.map(m=>({id:m.id,p:JSON.parse(m.data)}));
  for(const {id,p} of changes){
   if(p.unitId!==data.id)fail();
   if([INSERT_SHEET,RENAME_SHEET,ORDER_SHEET].includes(id)){
    if(changes.length!==1||c.request.changeset.baseRev!==view.revision||!isDeepStrictEqual(c.request.changeset.mutations,c.changeset.mutations))fail();
    if(id===ORDER_SHEET){
     const ids=data.sheetOrder;
     if(!p||Object.getPrototypeOf(p)!==Object.prototype||Object.keys(p).some(k=>!['unitId','subUnitId','fromOrder','toOrder','trigger'].includes(k))||
      ('trigger' in p&&p.trigger!=='sheet.command.set-worksheet-order')||ids.length>4||ids[0]!=='sheet-1'||new Set(ids).size!==ids.length||
      ids.some(s=>!Object.hasOwn(data.sheets,s)||data.sheets[s].id!==s)||p.subUnitId==='sheet-1'||
      !Number.isSafeInteger(p.fromOrder)||!Number.isSafeInteger(p.toOrder)||p.fromOrder<1||p.toOrder<1||p.fromOrder>=ids.length||p.toOrder>=ids.length||
      p.fromOrder===p.toOrder||ids[p.fromOrder]!==p.subUnitId)fail();
     continue;
    }
    const name=id===INSERT_SHEET?p.sheet?.name:p.name;
    if(!nameOK(name,id===INSERT_SHEET&&p.trigger==='sheet.command.copy-sheet'?128:31)||data.sheetOrder.some(s=>s!==p.subUnitId&&data.sheets[s].name.toLowerCase()===name.toLowerCase()))fail();
    if(id===INSERT_SHEET){
     if(Object.keys(p).some(k=>!['unitId','index','sheet','trigger','styles'].includes(k))||data.sheetOrder.length>=4||typeof p.sheet?.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(p.sheet.id)||Object.hasOwn(data.sheets,p.sheet.id))fail();
     if(p.trigger==='sheet.command.copy-sheet'){
      if(!Number.isSafeInteger(p.index)||p.index<2||p.index>data.sheetOrder.length)fail();
      const sourceID=data.sheetOrder[p.index-1];if(!qualifiedCopySource(data,sourceID)||!plainCopy(p.styles??{}))fail();
      const copy=structuredClone(p.sheet),source=structuredClone(data.sheets[sourceID]),used=new Set();
      const resolve=(sheet,styles,record)=>{for(const row of Object.values(sheet.cellData??{}))for(const cell of Object.values(row??{}))if(cell&&typeof cell.s==='string'){if(!Object.hasOwn(styles,cell.s)||!plainCopy(styles[cell.s]))fail();if(record)used.add(cell.s);cell.s=styles[cell.s];}};
      resolve(copy,p.styles??{},true);resolve(source,data.styles??{},false);
      if(Object.keys(p.styles??{}).some(k=>!used.has(k)||(Object.hasOwn(data.styles??{},k)&&!isDeepStrictEqual(p.styles[k],data.styles[k]))))fail();
      if(!isDeepStrictEqual(copy,{...source,id:p.sheet.id,name}))fail();
     }else{
      if(('styles' in p&&(!plainCopy(p.styles)||Object.keys(p.styles).length))||p.index!==data.sheetOrder.length)fail();
      const blank=mergeWorksheetSnapshotWithDefault({id:p.sheet.id,name});if(!isDeepStrictEqual(p.sheet,blank))fail();
     }
    }else if(Object.values(data.sheets).some(tab=>Object.values(tab.cellData??{}).some(row=>Object.values(row).some(cell=>cell?.f||cell?.si)))||Object.keys(p).some(k=>!['unitId','subUnitId','name','oldName','trigger'].includes(k))||!Object.hasOwn(data.sheets,p.subUnitId)||p.oldName!==data.sheets[p.subUnitId].name)fail();
   }else if(p.subUnitId!=='sheet-1'){
    const sheet=data.sheets[p.subUnitId];if(id!==SHEET_VALUES||!sheet||!data.sheetOrder.includes(p.subUnitId)||Object.keys(p).some(k=>!['unitId','subUnitId','cellValue','styleRefMap','trigger'].includes(k)))fail();
    const rows=Object.entries(p.cellValue??{});if(rows.length!==1)fail();const [r,cols]=rows[0],cells=Object.entries(cols??{});if(cells.length!==1)fail();const [col,cell]=cells[0];
    // Public ClearSelectionContentCommand + SEND compression emits exactly these
    // null fields. This exception does not admit rich text or custom payloads.
    const clearKeys=['v','p','f','si','custom'];
    const clear=cell&&Object.getPrototypeOf(cell)===Object.prototype&&Object.keys(cell).length===clearKeys.length&&clearKeys.every(k=>Object.hasOwn(cell,k)&&cell[k]===null);
    if(clear&&p.styleRefMap!==undefined&&(!p.styleRefMap||Object.getPrototypeOf(p.styleRefMap)!==Object.prototype||Object.keys(p.styleRefMap).length))fail();
    if(!/^(0|[1-9][0-9]*)$/.test(r)||! /^(0|[1-9][0-9]*)$/.test(col)||+r>=sheet.rowCount||+col>=sheet.columnCount||!cell||Array.isArray(cell)||!clear&&Object.keys(cell).some(k=>!['v','t','s','f','si','ft','fd'].includes(k))||['f','si','ft','fd'].some(k=>cell[k]!=null)||cell.v!=null&&!['string','number','boolean'].includes(typeof cell.v)||typeof cell.v==='number'&&!Number.isFinite(cell.v)||typeof cell.v==='string'&&(cell.v.startsWith('=')||cell.v.length>20000))fail();
   }
  }
 }
}
