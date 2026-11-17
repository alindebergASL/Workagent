// Inspection evidence only. Never interprets receipts, imports or submits operations.
type Scope = { principal: string; unitID: string; epoch: number };
type Disk = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>;
type Evidence = { id: string; format: 'v1' | 'legacy'; serialized: string; verified: boolean };
export function nativeOperationRecovery(scope: Scope, storage: () => Disk, authorized: () => boolean, legacyKey?: string) {
  scope = { ...scope }; // This editor's captured scope cannot be retargeted by a caller.
  const prefix = `workagent:native-operation-evidence:v1:${encodeURIComponent(JSON.stringify(scope))}:`;
  const memory = new Map<string, Evidence>();
  let disposed = false;
  const allowed = () => !disposed && authorized();
  const matches = (s: Scope) => s?.principal === scope.principal && s?.unitID === scope.unitID && s?.epoch === scope.epoch;
  function read() {
    const records = new Map(memory); let warning = '';
    if (!allowed()) return { records: [], warning: 'Recovery evidence hidden until current authority is available.' };
    try {
      const disk = storage(); const keys: string[] = [];
      for (let n = 0, length = disk.length; n < length; n++) { const k = disk.key(n); if (k === null) throw Error('enumeration'); if (k.startsWith(prefix)) keys.push(k); }
      for (const key of keys) {
        const raw = disk.getItem(key); if (raw === null) throw Error('missing record');
        try {
          const v = JSON.parse(raw);
          if (v.version !== 1 || !matches(v.scope) || key !== prefix + v.id || typeof v.event !== 'string') throw Error('invalid');
          JSON.parse(v.event);
          const prior = records.get(v.id);
          if (prior && prior.serialized !== raw) throw Error('conflicting record');
          records.set(v.id, prior ?? { id: v.id, format: 'v1', serialized: raw, verified: true });
        } catch { warning = 'Invalid or conflicting stored evidence remains untouched and is not exported.'; }
      }
      if (legacyKey) {
        const raw = disk.getItem(legacyKey);
        if (raw !== null) {
          try {
            const v = JSON.parse(raw);
            // Epoch comes from the exact current legacy key, not an unscoped search.
            if (v.principal !== scope.principal || v.unitID !== scope.unitID || (v.epoch !== undefined && v.epoch !== scope.epoch) || typeof v.reason !== 'string' || !Object.hasOwn(v, 'localChanges')) throw Error('legacy scope');
            records.set('legacy', { id: 'legacy', format: 'legacy', serialized: raw, verified: true });
          } catch { warning = 'Legacy evidence has unverified scope or format; it remains untouched and is not exported.'; }
        }
      }
    } catch { warning = 'Stored recovery evidence could not be fully read; current captured evidence is available only in this tab.'; }
    if (!allowed()) return { records: [], warning: 'Recovery evidence hidden until current authority is available.' };
    return { records: [...records.values()], warning };
  }
  function view() {
    const { records, warning } = read();
    const memoryOnly = records.some(r => !r.verified);
    return { available: records.length > 0, count: records.length,
      message: [warning, memoryOnly ? 'Recovery is in memory only or storage readback is unverified — download before closing this tab.' : records.length ? 'Recovery evidence read back from this browser profile.' : '',
        'Inspection only: awaiting edits may already have committed. Never resubmit this JSON.'].filter(Boolean).join(' ') };
  }
  return {
    view,
    capture(event: unknown) {
      // Preservation belongs to the originating editor; authority gates disclosure,
      // not retention of an already supplied public conflict event.
      if (disposed) return view();
      const id = crypto.randomUUID();
      const serialized = JSON.stringify({ version: 1, scope, id, event: JSON.stringify(event) });
      const record: Evidence = { id, format: 'v1', serialized, verified: false };
      memory.set(id, record);
      try {
        const disk = storage(); const key = prefix + id;
        if (disk.getItem(key) !== null) throw Error('identity exists');
        disk.setItem(key, serialized);
        if (disk.getItem(key) !== serialized) throw Error('readback');
        record.verified = true;
      } catch { /* Keep exact in-memory bytes; no overwrite, cleanup or retry. */ }
      return view();
    },
    exportJSON(currentScope: Scope = scope) {
      if (!matches(currentScope)) return null;
      const { records, warning } = read();
      if (!records.length || !allowed()) return null;
      return JSON.stringify({ version: 1, scope, inspectionOnly: true, warning,
        notice: 'Awaiting operations may already have committed. This export is not permission to resubmit.', records });
    },
    dispose() { disposed = true; },
  };
}
