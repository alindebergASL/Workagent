// Read-only projections of native service history, never a writable history store.
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { UniverType } from '@univerjs/protocol';
import { UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
const PAGE = 25;
function revision(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Fault('invalid_native_history_revision', 400);
  return Number(value);
}
function columnName(index) { let name = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; }
export class NativeHistory {
  constructor(authority, service, dbAdapter) { Object.assign(this, { authority, service, dbAdapter }); }
  async read(principal, unitID, session, query, send) {
    if ([...query.keys()].some(k => !['before', 'revision'].includes(k)) || [...query.keys()].length > 1) throw new Fault('invalid_native_history_query', 400);
    const selected = query.has('revision') ? revision(query.get('revision')) : undefined;
    const before = query.has('before') ? revision(query.get('before')) : undefined;
    let head;
    await this.authority.fence(principal, unitID, false, async () => {
      const unit = await this.dbAdapter.getUnit({ userID: principal, customData: {}, request: {} }, unitID);
      if (!unit || !Number.isSafeInteger(unit.headRevision)) throw new Fault('native_history_unavailable', 409);
      head = unit.headRevision;
    }, session);
    const scope = effect => this.authority.scope.run({ unitID, session }, effect);
    let result;
    if (selected !== undefined) {
      if (selected > head) throw new Fault('native_history_revision_unavailable', 409);
      // Native middleware takes its own Workspace fence; do not nest transactions.
      const load = await scope(() => this.service.getUnitLoadDataWithBlocks({ unitID, type: UniverType.UNIVER_SHEET, revision: selected }, { userID: principal }));
      if (load.targetRevision !== selected) throw new Fault('native_history_revision_unavailable', 409);
      const materializer = new UnitSnapshotMaterializer({ execution: { mode: 'in-process' } });
      let data;
      try { const state = await materializer.materializeSnapshot(load); data = await transformSnapshotToWorkbookData(state.snapshot, [...state.sheetBlocks]); }
      finally { await materializer.dispose(); }
      // Deliberately never expose resources, comment bodies, SID/reqIds or claims.
      // This is a bounded text preview, not a workbook replacement or export.
      result = { revision: selected, limited: true, sheets: (data.sheetOrder ?? []).slice(0, 4).map(id => {
        const sheet = data.sheets[id], cells = [];
        outer: for (const [row, columns] of Object.entries(sheet.cellData ?? {})) for (const [col, cell] of Object.entries(columns ?? {})) {
          if (!cell || (cell.v == null && !cell.f && !cell.p?.body?.dataStream)) continue;
          cells.push({ cell: `${columnName(Number(col))}${Number(row) + 1}`, value: String(cell.f ?? cell.v ?? cell.p?.body?.dataStream ?? '').slice(0, 500) });
          if (cells.length === 50) break outer;
        }
        return { id, name: String(sheet.name).slice(0, 200), rows: sheet.rowCount, columns: sheet.columnCount, cells };
      }) };
    } else {
      const to = Math.min(head, before === undefined ? head : before - 1), from = Math.max(1, to - PAGE);
      const history = to > from ? await scope(() => this.service.getChangesets({ unitID, type: UniverType.UNIVER_SHEET, from, to }, { userID: principal })) : { changesets: [] };
      result = { head, entries: history.changesets.slice(-PAGE).reverse().map(c => ({ revision: c.revision, author: c.userID, operationCount: c.mutations.length, operations: [...new Set(c.mutations.map(m => m.id))].slice(0, 20) })), ...(from > 1 ? { before: from + 1 } : {}) };
    }
    // Immutable requested revisions need no latest-head equality. Current access
    // and epoch must still hold at synchronous response enqueue, after all reads.
    await this.authority.fence(principal, unitID, false, () => { send(result); }, session);
  }
}
