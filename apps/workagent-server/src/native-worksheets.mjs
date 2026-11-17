// Native snapshots and commit order remain SDK-owned. This validates a bounded
// blank-sheet surface, without allowing arbitrary worksheet import or deletion.
import {mergeWorksheetSnapshotWithDefault} from '@univerjs/core';
import {CollabError} from '@univerjs-pro/collaboration-service';
import {isDeepStrictEqual} from 'node:util';
import {NativeMerge} from './native-merge.mjs';
export const INSERT_SHEET='sheet.mutation.insert-sheet',RENAME_SHEET='sheet.mutation.set-worksheet-name',ORDER_SHEET='sheet.mutation.set-worksheet-order',SHEET_VALUES='sheet.mutation.set-range-values';
const fail=()=>{throw new CollabError('PERMISSION_DENIED','Only blank worksheet addition, unique rename, additional-tab reorder and scalar cells are qualified on additional worksheets',{retryable:false});};
const nameOK=n=>typeof n==='string'&&n.trim()===n&&n.length>0&&n.length<=31&&!/[\\/:?*\[\]\x00-\x1f]/.test(n);
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
    if(!nameOK(name)||data.sheetOrder.some(s=>s!==p.subUnitId&&data.sheets[s].name.toLowerCase()===name.toLowerCase()))fail();
    if(id===INSERT_SHEET){
     if(Object.keys(p).some(k=>!['unitId','index','sheet','trigger','styles'].includes(k))||('styles' in p&&(!p.styles||Object.getPrototypeOf(p.styles)!==Object.prototype||Object.keys(p.styles).length))||data.sheetOrder.length>=4||p.index!==data.sheetOrder.length||typeof p.sheet?.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(p.sheet.id)||Object.hasOwn(data.sheets,p.sheet.id))fail();
     const blank=mergeWorksheetSnapshotWithDefault({id:p.sheet.id,name});if(!isDeepStrictEqual(p.sheet,blank))fail();
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
