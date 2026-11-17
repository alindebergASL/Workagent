// Browser-profile recovery for root/reply TEXT, never anchors or native requests.
// Each mounted editor owns its draft ID. Recovery transfers and submission seals
// serialize with Web Locks; localStorage alone is not a multi-tab transaction.
type Scope = { principal: string; unitID: string; epoch: number; threadID?: string };
type Disk = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
type Locks = { request<T>(name: string, callback: () => T | Promise<T>): Promise<T> };
type Draft = { schema: 1; id: string; owner: string; version: number; text: string };
type Seal = Draft & { kind: 'attempt' | 'discard' | 'transfer' };
type Completion = Draft & { kind: 'complete'; commentId: string };
export type CommentPublication = { commentId: string; principal: string; text: string; threadID?: string };
export type CommentDraftToken = Readonly<Draft>;
export type CommentDraftRecoveryView = { drafts: Draft[]; attempted: number; message: string };
export const emptyCommentDraftRecovery: CommentDraftRecoveryView = { drafts: [], attempted: 0, message: 'Local text recovery waits for a fresh authority check.' };
export function nativeCommentDrafts(scope: Scope, storage: () => Disk, authorized: () => boolean,
  changed: (value: CommentDraftRecoveryView) => void, locks?: Locks) {
  const prefix = scope.threadID === undefined
    ? `workagent:native-root-text:v1:${encodeURIComponent(JSON.stringify([scope.principal, scope.unitID, scope.epoch]))}:`
    : `workagent:native-reply-text:v1:${encodeURIComponent(JSON.stringify([scope.principal, scope.unitID, scope.epoch, scope.threadID]))}:`;
  const owner = crypto.randomUUID();
  let live = true, memory = '', current: Draft | undefined, failure = '', generation = 0, restoredID: string | undefined;
  const key = (id: string, seal = false) => prefix + id + (seal ? ':seal' : ':draft');
  const same = (a: Draft, b: Draft) => a.id === b.id && a.owner === b.owner && a.version === b.version && a.text === b.text;
  function read() {
    const disk = storage(), drafts = new Map<string, Draft>(), seals = new Map<string, Seal>(), completed = new Map<string, Completion>();
    for (let i = 0; i < disk.length; i++) {
      const k = disk.key(i); if (!k?.startsWith(prefix)) continue;
      const v = JSON.parse(disk.getItem(k) ?? 'null');
      if (!v || v.schema !== 1 || typeof v.id !== 'string' || v.id.length > 128 || !/^[a-zA-Z0-9-]+$/.test(v.id) || typeof v.owner !== 'string' || !v.owner || v.owner.length > 128 || !Number.isSafeInteger(v.version) || v.version < 1 || typeof v.text !== 'string' || v.text.length > 8000) throw Error('Invalid recovery record');
      if (k === prefix + v.id + ':complete') {
        if (Object.keys(v).sort().join() !== 'commentId,id,kind,owner,schema,text,version' || v.kind !== 'complete' || typeof v.commentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(v.commentId)) throw Error('Invalid completed evidence');
        completed.set(v.id, v); continue;
      }
      const seal = k === key(v.id, true);
      if (k !== key(v.id) && !seal || Object.keys(v).sort().join() !== (seal ? 'id,kind,owner,schema,text,version' : 'id,owner,schema,text,version') || seal && !['attempt','discard','transfer'].includes(v.kind)) throw Error('Invalid recovery record');
      if (seal) seals.set(v.id, v); else drafts.set(v.id, v);
    }
    // Completion is a single retained record with the exact text/token/native
    // comment identity. It is written/read back BEFORE retiring the redundant
    // draft+attempt pair. A crash during retirement therefore stays sealed.
    for (const [id, proof] of completed) {
      if (drafts.has(id) && !same(drafts.get(id)!, proof) || seals.has(id) && (seals.get(id)!.kind !== 'attempt' || !same(seals.get(id)!, proof))) throw Error('Conflicting completed evidence');
      drafts.delete(id); seals.delete(id);
    }
    for (const [id, seal] of seals) if (!drafts.has(id) || !same(seal, drafts.get(id)!)) throw Error('Conflicting recovery evidence');
    // Explicitly discarded text stays sealed and retained, but is no longer
    // active work. Neither completed nor discarded history consumes active slots.
    const active = [...drafts.keys()].filter(id => seals.get(id)?.kind !== 'discard');
    const activeCount = active.length;
    if (activeCount > 64 || activeCount + active.filter(id => seals.has(id)).length > 128) throw Error('Recovery capacity reached');
    return { disk, drafts, seals, completed, activeCount };
  }
  function put(disk: Disk, k: string, value: Draft | Seal | Completion) {
    const bytes = JSON.stringify(value); disk.setItem(k, bytes);
    if (disk.getItem(k) !== bytes) throw Error('Recovery write not retained');
  }
  function seal(record: Draft, kind: Seal['kind']) {
    const state = read(), stored = state.drafts.get(record.id);
    if (!stored || !same(stored, record)) throw Error('Draft version changed');
    const old = state.seals.get(record.id);
    if (old) { if (old.kind !== kind) throw Error('Draft already consumed'); return; }
    put(state.disk, key(record.id, true), { ...record, kind });
  }
  function view(): CommentDraftRecoveryView {
    if (!live || !authorized()) return { ...emptyCommentDraftRecovery, message: failure || emptyCommentDraftRecovery.message };
    try {
      const { drafts, seals, completed } = read();
      const unsaved = memory && (!current || current.text !== memory);
      return { drafts: [...drafts.values()].filter(d => d.id !== current?.id && d.text !== '' && !seals.has(d.id) && ![...seals.values(), ...completed.values()].some(s => (s.kind === 'attempt' || s.kind === 'complete') && s.text === d.text)), attempted: [...seals.values()].filter(s => s.kind === 'attempt').length + completed.size,
        message: failure || (unsaved ? 'Current text is not saved locally. Keep this tab open.' : (scope.threadID === undefined ? 'Local browser text recovery only — not native publication or sync. Restore root text explicitly, then choose a current cell. Edit drafts are not saved here.' : 'Local browser reply text recovery only — not native publication or sync. Restore explicitly into this published thread. Edit drafts are not saved here.')) };
    } catch { return { drafts: [], attempted: 0, message: 'Local recovery unavailable or invalid. Keep this tab open; text has not been safely saved.' }; }
  }
  const emit = () => { if (live) changed(view()); };
  async function edit(text: string) {
    if (!live) return; generation++;
    // Until the mounted consumer accepts delivery, new input is a separate draft.
    // Never overwrite the saved source while an older Restore promise is in flight.
    if (restoredID && current?.id === restoredID) current = undefined;
    restoredID = undefined; memory = text;
    try {
      if (!locks) throw Error('Web Locks unavailable');
      await locks.request(prefix, () => {
      if (!live || memory !== text) return;
      if (text.length > 8000) throw Error('Text too long');
      const state = read();
      if (current) {
        const old = state.drafts.get(current.id), mark = state.seals.get(current.id);
        if (!old || !same(old, current)) { if (text !== '') throw Error('Draft transferred or changed'); current = undefined; failure = ''; emit(); return; }
        if (mark && mark.kind !== 'attempt') { if (text !== '') throw Error('Draft transferred or changed'); current = undefined; failure = ''; emit(); return; }
        if (mark) { if (text === current.text) { failure = ''; emit(); return; } current = undefined; }
      }
      if (!text) { if (current) seal(current, 'discard'); current = undefined; }
      else {
        if (!current && state.activeCount >= 64) throw Error('Recovery capacity reached');
        const next: Draft = { schema: 1, id: current?.id ?? crypto.randomUUID(), owner, version: (current?.version ?? 0) + 1, text };
        put(state.disk, key(next.id), next); current = next;
      }
      failure = '';
      });
    } catch { failure = 'Current text is not saved locally. Storage is unavailable, full or changed; keep this tab open. Submission is blocked until its text can be safely retained.'; }
    emit();
  }
  async function locked<T>(run: () => T): Promise<T | undefined> {
    if (!live || !authorized()) return;
    try {
      if (!locks) throw Error('Web Locks unavailable');
      return await locks.request(prefix, () => { if (live && authorized()) return run(); });
    } catch { failure = 'Local recovery unavailable or changed. Keep this tab open; no submission or recovery transfer was authorized.'; emit(); }
  }
  return {
    view, text: () => memory, refresh: emit, edit,
    async restore(id: string, version: number) {
      const start = generation;
      const next = await locked(() => {
        if (memory || generation !== start) return;
        const state = read(), saved = state.drafts.get(id);
        if (!saved || saved.version !== version || state.seals.has(id) || !saved.text || [...state.seals.values(), ...state.completed.values()].some(s => (s.kind === 'attempt' || s.kind === 'complete') && s.text === saved.text)) return;
        // One atomic localStorage replacement transfers only an UNSENT record.
        // Failure before the write leaves the old version; failure after it leaves
        // the new version. Both are explicitly recoverable, never two copies.
        const next: Draft = { ...saved, owner, version: saved.version + 1 };
        put(state.disk, key(id), next); return next;
      });
      // Web Locks may deliver the result after its callback has finished. Do not
      // install text until lifetime, authority AND newer input are rechecked.
      if (!next || !live || !authorized() || generation !== start || memory) return;
      try {
        const state = read(), saved = state.drafts.get(id);
        if (!saved || !same(saved, next) || state.seals.has(id)) return;
        current = next; memory = next.text; restoredID = next.id; failure = ''; emit(); return memory;
      } catch { failure = 'Local recovery unavailable. Saved text remains retained; no restore completed.'; emit(); }
    },
    canRecover: () => live && authorized(),
    acceptRestore(text: string) {
      if (!live || !authorized() || !restoredID || current?.id !== restoredID || memory !== text) return false;
      restoredID = undefined; return true;
    },
    releaseRestore(text: string) {
      // Mounted caller rejected a late result. Detach without touching the saved
      // record; a fresh explicit choice can recover it later.
      if (restoredID && current?.id === restoredID && memory === text) { current = undefined; memory = ''; restoredID = undefined; generation++; emit(); }
    },
    async discard(id: string, version: number) {
      return (await locked(() => { const s = read(), d = s.drafts.get(id); if (!d || d.version !== version || s.seals.has(id)) return false; seal(d, 'discard'); failure = ''; emit(); return true; })) ?? false;
    },
    async beforeAttempt(): Promise<CommentDraftToken | undefined> {
      return locked(() => {
        if (!current || current.text !== memory || !memory) { failure = 'Current text is not saved locally. No comment submission started.'; emit(); return; }
        seal(current, 'attempt'); failure = ''; emit(); return { ...current };
      });
    },
    matches: (token: CommentDraftToken) => !!current && same(token, current) && memory === token.text,
    async complete(token: CommentDraftToken, proof: CommentPublication) {
      // Only the consuming native-comments callback supplies this proof, after
      // matching its pending ID to current authoritative root membership/body.
      if (!proof || proof.principal !== scope.principal || proof.threadID !== scope.threadID || proof.text !== token.text || typeof proof.commentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(proof.commentId)) return;
      return locked(() => {
        const state = read(), old = state.completed.get(token.id);
        const archived: Completion = { ...token, kind: 'complete', commentId: proof.commentId };
        if (old) { if (!same(old, token) || old.commentId !== proof.commentId) throw Error('Completion conflict'); }
        else {
          const mark = state.seals.get(token.id), saved = state.drafts.get(token.id);
          if (!mark || mark.kind !== 'attempt' || !saved || !same(mark, token) || !same(saved, token)) throw Error('Unmatched completion');
          put(state.disk, prefix + token.id + ':complete', archived);
        }
        // Never remove an unsent/unknown record. The archived proof dominates
        // either redundant key if cleanup is interrupted or storage is denied.
        state.disk.removeItem(key(token.id, true)); state.disk.removeItem(key(token.id));
        if (current && same(token, current) && memory === token.text) { memory = ''; current = undefined; restoredID = undefined; generation++; }
        failure = ''; emit(); return true;
      });
    },
    dispose() { generation++; live = false; },
  };
}
