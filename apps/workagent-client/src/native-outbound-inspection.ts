import type { IChangeset } from '@univerjs-pro/collaboration';
import { createUniverCollaborationAdapter, ICollaborationClientAdapterService, type ICollaborationClientAdapter } from '@univerjs-pro/collaboration-client';
import type { DependencyOverride } from '@univerjs/core';

export type InspectionState = { entity: object; member: string; status: string; pending: boolean; revision: number };
const maxBytes = 64 * 1024;
// A single SDK scalar envelope is shallow, with one mutations array. Budget
// the entire envelope (including style definitions) using data descriptors;
// a UTF-16 code unit costs at most six JSON bytes, even when escaped.
function fitsScalarBudget(cs: IChangeset) {
  let bytes = maxBytes, nodes = 64;
  function fits(value: unknown, depth: number, mutationsArray = false): boolean {
    if (--nodes < 0 || depth > 8 || (bytes -= 32) < 0) return false; // punctuation or a numeric literal
    if (typeof value === 'string') return (bytes -= value.length * 6) >= 0;
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return true;
    if (typeof value !== 'object' || 'toJSON' in value) return false;
    if (Array.isArray(value)) {
      if (!mutationsArray || value.length !== 1 || Object.getPrototypeOf(value) !== Array.prototype) return false;
      const item = Object.getOwnPropertyDescriptor(value, '0');
      return !!item && 'value' in item && fits(item.value, depth + 1);
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    for (const key in value) {
      if ((bytes -= key.length * 6 + 4) < 0) return false;
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (!field || !('value' in field) || !fits(field.value, depth + 1, depth === 0 && key === 'mutations')) return false;
    }
    return true;
  }
  return fits(cs, 0);
}
const oneIndex = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const keys = Object.keys(value);
  if (keys.length === 1 && /^(0|[1-9]\d*)$/.test(keys[0]) && Number.isSafeInteger(Number(keys[0]))) return keys[0];
};
function ordinaryScalar(cs: IChangeset) {
  if (cs.mutations.length !== 1 || cs.mutations[0].id !== 'sheet.mutation.set-range-values') return false;
  const p = cs.mutations[0].params as { unitId?: string; subUnitId?: string; trigger?: string;
    cellValue?: Record<string, Record<string, Record<string, unknown>>> };
  if (p?.unitId !== cs.unitID || !p.subUnitId || (p.trigger !== undefined && p.trigger !== 'sheet.command.set-range-values') ||
      Object.keys(p).some(k => !['unitId','subUnitId','cellValue','styleRefMap','trigger'].includes(k))) return false;
  const row = oneIndex(p.cellValue), column = row && oneIndex(p.cellValue![row]);
  const cell = row && column ? p.cellValue![row][column] : undefined;
  if (!cell || Object.keys(cell).some(k => !['v','t','s','f','si','p','ft','fd','custom'].includes(k)) ||
      ['f','si','p','ft','fd','custom'].some(k => cell[k] != null)) return false;
  return (typeof cell.v === 'string' && cell.v.length <= maxBytes && (cell.t == null || cell.t === 1)) ||
    (typeof cell.v === 'number' && Number.isFinite(cell.v) && (cell.t == null || cell.t === 2));
}

export function nativeOutboundInspection(unitID: string, principal: string, current: () => InspectionState | null,
  retain: (json: string) => void, standard: ICollaborationClientAdapter = createUniverCollaborationAdapter()) {
  let disposed = false;
  let candidate: { token: symbol; json: string; entity: object; member: string; revision: number } | undefined;
  const clear = () => { candidate = undefined; };
  const adapter = createUniverCollaborationAdapter({ async resolveUnit(context) {
    const resolution = await standard.resolveUnit(context);
    return { ...resolution, changeset: {
      toRemote(cs, ctx) {
        const outgoing = resolution.changeset ? resolution.changeset.toRemote(cs, ctx) : cs;
        clear();
        try {
          const state = !disposed && current();
          if (state && state.status === 'pending' && state.pending && state.member &&
              context.unitId === unitID && ctx.localUnitId === unitID && ctx.target.unitId === unitID &&
              resolution.target.unitId === unitID && fitsScalarBudget(outgoing) && outgoing.unitID === unitID && outgoing.type === 2 &&
              outgoing.userID === principal && (outgoing.memberID === state.member || outgoing.memberID === 'unknown') &&
              /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(outgoing.sid ?? '') &&
              Number.isSafeInteger(outgoing.reqId) && outgoing.reqId! > 0 && outgoing.baseRev === state.revision &&
              outgoing.revision === 0 && ordinaryScalar(outgoing)) {
            const json = JSON.stringify(outgoing);
            if (json.length <= maxBytes && new TextEncoder().encode(json).length <= maxBytes)
              candidate = { token: Symbol(), json, entity: state.entity, member: state.member, revision: state.revision };
          }
        } catch { clear(); }
        return outgoing;
      },
      toLocal(cs, ctx) {
        clear();
        return resolution.changeset ? resolution.changeset.toLocal(cs, ctx) : cs;
      },
    } };
  } });
  function available() {
    if (!candidate) return;
    const state = current();
    if (!state || !state.pending || state.status !== 'awaiting' || state.entity !== candidate.entity ||
        state.member !== candidate.member || state.revision !== candidate.revision) clear();
    return candidate?.token;
  }
  const override: DependencyOverride = [[ICollaborationClientAdapterService, { useValue: adapter }]];
  return { override, available, save(token: symbol) {
    if (available() !== token || !candidate) return;
    const { json } = candidate;
    clear(); retain(json);
  }, dispose() { disposed = true; clear(); } };
}
