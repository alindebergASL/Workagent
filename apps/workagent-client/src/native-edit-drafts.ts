import { nativeCommentDrafts, type CommentDraftToken } from './native-comment-drafts.ts';
export type EditDraftBasis = { commentID: string; threadID: string; version: string; original: string };
type Scope = { principal: string; unitID: string; epoch: number };
type Disk = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
type Locks = { request<T>(name: string, callback: () => T | Promise<T>): Promise<T> };
type Target = { threadID: string; principal: string; version?: string; original: string; unknown?: boolean };
type Helper = ReturnType<typeof nativeCommentDrafts>;
export type SavedEditDraft = CommentDraftToken & { basis: EditDraftBasis; current: boolean };
export type EditDraftView = { drafts: SavedEditDraft[]; attempted: number; message: string };
export const emptyEditDraftView: EditDraftView = { drafts: [], attempted: 0, message: 'Local edit recovery waits for fresh authority.' };
const basisKey = (b: EditDraftBasis) => JSON.stringify(b);
function validBasis(b: EditDraftBasis) {
  return b && Object.keys(b).sort().join() === 'commentID,original,threadID,version' &&
    [b.commentID,b.threadID,b.version].every(v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v)) &&
    typeof b.original === 'string' && b.original.length <= 8002 && b.original.endsWith('\r\n');
}
// Uses the same atomic ownership/seal/archive primitive as creation drafts, in
// a separate namespace whose immutable key includes the original published body.
export function nativeEditDrafts(scope: Scope, storage: () => Disk, authorized: () => boolean,
 target: (id: string) => Target | undefined, changed: (v: EditDraftView) => void, locks?: Locks) {
  const prefix = `workagent:native-edit-text:v1:${encodeURIComponent(JSON.stringify([scope.principal,scope.unitID,scope.epoch]))}:`;
  let live = true, invalid = false;
  const helpers = new Map<string,{basis: EditDraftBasis; helper: Helper}>();
  const owns = (b: EditDraftBasis) => { const t = target(b.commentID); return live && !invalid && authorized() && t?.principal === scope.principal && t.threadID === b.threadID; };
  const current = (b: EditDraftBasis) => { const t = target(b.commentID); return owns(b) && !t?.unknown && t?.version === b.version && t.original === b.original; };
  const emit = () => { if (live) changed(view()); };
  function get(b: EditDraftBasis) {
    if (!validBasis(b)) throw Error('Invalid edit basis');
    const basis = {commentID:b.commentID,threadID:b.threadID,version:b.version,original:b.original}, key = basisKey(basis);
    let entry = helpers.get(key);
    if (!entry) {
      entry = { basis, helper: nativeCommentDrafts({...scope,editBasis:basis},storage,()=>owns(basis),emit,locks) };
      helpers.set(key,entry);
    }
    return entry;
  }
  function view(): EditDraftView {
    if (!live || !authorized()) return emptyEditDraftView;
    try {
      const disk = storage(), length=disk.length, keys=new Set<string>();
      if (!Number.isSafeInteger(length) || length<0) throw Error('Incomplete edit enumeration');
      for (let i=0;i<length;i++) {
        const key=disk.key(i);
        if (typeof key!=='string' || keys.has(key)) throw Error('Incomplete edit enumeration');
        keys.add(key); if (!key.startsWith(prefix)) continue;
        const encoded=key.slice(prefix.length).split(':')[0], basis=JSON.parse(decodeURIComponent(encoded));
        if (!validBasis(basis) || encodeURIComponent(basisKey(basis)) !== encoded) throw Error('Invalid stored basis');
        get(basis);
      }
      if(disk.length!==length)throw Error('Edit enumeration changed');
      // Validate every discovered basis, even currently unavailable targets.
      // A healthy length/key scan alone does not validate drafts or evidence;
      // primitive view() intentionally catches errors for its own UI consumer.
      for(const {helper} of helpers.values())if(!helper.validateStorage())throw Error('Invalid retained edit record');
      if(!live || !authorized())return emptyEditDraftView;
      invalid=false;
      const drafts: SavedEditDraft[]=[]; let attempted=0, failure='';
      for (const {basis,helper} of helpers.values()) {
        if (!owns(basis)) continue;
        const v=helper.view();if(v.valid!==true)throw Error('Edit record read failed');attempted+=v.attempted;
        drafts.push(...v.drafts.map(d=>({...d,basis,current:current(basis)})));
        if (/unavailable|not saved|invalid|no submission/i.test(v.message)) failure=v.message;
      }
      if(!live || !authorized())return emptyEditDraftView;
      return {drafts,attempted,message:failure || 'Local browser edit text only. Original body basis is retained; stale drafts cannot overwrite current comments. No automatic save or publication.'};
    } catch { invalid=true; return {...emptyEditDraftView,message:'Local edit recovery unavailable or invalid. Keep this tab open; no recovery authorized.'}; }
  }
  return {
    view, refresh:emit, current, get,
    async restore(saved: SavedEditDraft) {
      if (!current(saved.basis)) return;
      const entry=get(saved.basis),text=await entry.helper.restore(saved.id,saved.version);
      if (text === undefined) return;
      if (!current(saved.basis)) {entry.helper.releaseRestore(text);return;}
      return {...entry,text};
    },
    async complete(entry: {basis:EditDraftBasis;helper:Helper}, token:CommentDraftToken,
      proof:{commentId:string;body:string;version:string;previousVersion:string}, expectedEditID:string) {
      const t=target(entry.basis.commentID);
      if (!owns(entry.basis) || proof.commentId!==entry.basis.commentID || proof.previousVersion!==entry.basis.version || proof.version!==expectedEditID || proof.body!==token.text || t?.unknown || t?.version!==proof.version || t.original!==proof.body+'\r\n') return;
      // The archive's native identity is the proven edit revision ID, not the
      // unchanged comment ID. Older ACKs never change a newer draft's basis.
      return entry.helper.complete(token,{commentId:proof.version,principal:scope.principal,text:token.text});
    },
    dispose(){live=false;helpers.forEach(e=>e.helper.dispose());},
  };
}
