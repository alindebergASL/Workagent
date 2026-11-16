import { AddCommentCommand, AddCommentMutation, ResolveCommentCommand, ResolveCommentMutation, UpdateCommentCommand, UpdateCommentMutation, DeleteCommentCommand, DeleteCommentMutation } from '@univerjs/thread-comment';
import type { IThreadComment, IThreadCommentDataSource, IThreadCommentDataSourceService } from '@univerjs/thread-comment';
import type { ICommandService } from '@univerjs/core';
import type { NativeSession } from './NativeCollaborationEditor';
type CommentRoot = EditableComment & { resolutionUnknown?: boolean };
export interface CommentView { comments: CommentRoot[]; message: string; pending: boolean; confirmed?: string; removed?: string; resolution?: string; resolutionBusy?: boolean; abandonable?: string[]; editing?: CommentEditView; deletion?: CommentDeleteView }
// Scoped to the existing native instance. No facade side effects or extra session.
export function nativeComments(session: NativeSession, source: IThreadCommentDataSourceService, commands: ICommandService,
  allowed: () => boolean, notify: (view: CommentView) => void, request: typeof fetch = fetch, memberID: () => string = () => '', disk?: Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>) {
  let editing: ReturnType<typeof nativeCommentEditing> | undefined;
  let deletion: ReturnType<typeof nativeCommentDeletion> | undefined;
  const update = (value: CommentView) => notify({ ...value, editing: editing?.view(), deletion: deletion?.view() });
  type Action = { id: string; commentId: string; memberID: string; resolved: boolean };
  const scope = `workagent:native-comment-resolution:${session.principal}:${session.unitID}:${session.binding}:${session.access.revision}:`;
  let receipts = new Map<string, { phase: string; status: string; head: number }>(), currentRevision = 0;
  let retired: { action: Action; head: number }[] = [];
  let actions: Action[] = [], resolution = '', resolutionBusy = false, executing: Action | undefined, storageFailed = false;
  const reconcile = () => {
    if (!disk) return false;
    try {
      const result: Action[] = []; retired = [];
      if (!Number.isSafeInteger(disk.length)) throw Error();
      for (let n = 0; n < disk.length; n++) {
        const key = disk.key(n); if (key === null) throw Error(); if (!key.startsWith(scope + 'intent:')) continue;
        const a = JSON.parse(disk.getItem(key) ?? 'null');
        if (!a || Object.keys(a).sort().join() !== 'commentId,id,memberID,resolved' || ![a.id,a.commentId,a.memberID].every(x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x)) || typeof a.resolved !== 'boolean' || key !== scope + 'intent:' + a.id) throw Error('Invalid retained resolution identity');
        const receipt = disk.getItem(scope + 'committed:' + a.id);
        if (receipt !== null && receipt !== JSON.stringify(a)) throw Error('Conflicting resolution evidence');
        const abandoned = disk.getItem(scope + 'abandoned:' + a.id);
        for (const prefix of ['started:', 'abandon-request:']) { const marker = disk.getItem(scope + prefix + a.id); if (marker !== null && marker !== JSON.stringify(a)) throw Error('Conflicting resolution attempt evidence'); }
        if (abandoned !== null) {
          const proof = JSON.parse(abandoned);
          if (receipt !== null || disk.getItem(scope + 'started:' + a.id) !== null || proof.id !== a.id || proof.commentId !== a.commentId || proof.memberID !== a.memberID || proof.resolved !== a.resolved || proof.status !== 'abandoned' || proof.phase !== 'abandoned' || !Number.isSafeInteger(proof.head)) throw Error('Conflicting abandoned resolution evidence');
          retired.push({ action: a, head: proof.head });
        } else if (receipt === null) result.push(a);
      }
      actions = result; return !storageFailed;
    } catch { storageFailed = true; resolution = 'Resolution recovery metadata unavailable. No action will be sent.'; return false; }
  };
  const append = (key: string, value: unknown) => {
    if (!disk) throw Error('Resolution storage unavailable');
    const encoded = JSON.stringify(value), old = disk.getItem(scope + key);
    if (old !== null && old !== encoded) throw Error('Resolution evidence conflict');
    if (old === null) disk.setItem(scope + key, encoded);
    if (disk.getItem(scope + key) !== encoded) throw Error('Resolution evidence could not be retained');
  };
  const abandonable = () => reconcile() && !resolutionBusy && session.access.role !== 'read' ? actions.filter(a => receipts.get(a.id)?.status === 'unknown' && receipts.get(a.id)?.phase === 'prepared' && disk!.getItem(scope + 'started:' + a.id) === null && disk!.getItem(scope + 'abandon-request:' + a.id) === null).map(a => a.id) : [];
  reconcile();
  const controller = new AbortController(); let live = true, pending: string | undefined, checking = false;
  let comments: CommentRoot[] = [], nativeAttempt = false, notice = '', removed: string | undefined;
  const mutationStart = commands.beforeCommandExecuted(command => {
    const params = command.params as { unitId?: string; comment?: { id?: string }; commentId?: string; resolved?: boolean } | undefined;
    if (command.id === ResolveCommentMutation.id && executing && params?.unitId === session.unitID && params.commentId === executing.commentId) {
      if (!live || !allowed() || memberID() !== executing.memberID || params.resolved !== executing.resolved || disk?.getItem(scope + 'abandon-request:' + executing.id) !== null || disk?.getItem(scope + 'abandoned:' + executing.id) !== null) throw Error('Resolution changed before native mutation; check retained status');
      append('started:' + executing.id, executing);
    }
    if (command.id === AddCommentMutation.id && params?.unitId === session.unitID && params.comment?.id === pending) nativeAttempt = true;
  });
  const url = `/api/work/${session.unitID}/native-comments/${session.access.revision}`;
  const assertScope = (unit: string, sub: string) => { if (!live || unit !== session.unitID || sub !== 'sheet-1') throw Error('Comment session changed'); };
  const call = async (body?: object, pendingID?: string) => {
    const response = await request(url + (pendingID ? `?pending=${encodeURIComponent(pendingID)}` : ''), { signal: controller.signal, method: body ? 'POST' : 'GET', headers: { 'X-Workagent-Session-Binding': session.binding, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!live) throw Error('Comment session changed');
    if (!response.ok) throw Error(`Comment request refused (${response.status}); draft retained`);
    const value = await response.json(); if (!live) throw Error('Comment session changed'); return value;
  };
  editing = nativeCommentEditing(session, commands, () => allowed() && !pending && !resolutionBusy && !deletion?.busy(), () => update({ comments, pending: !!pending, message: notice || 'Published comments', resolution, resolutionBusy, abandonable: abandonable() }), request, memberID, disk);
  deletion = nativeCommentDeletion(session, commands, () => allowed() && !pending && !resolutionBusy && !editing?.busy(), () => update({ comments, pending: !!pending, message: notice || 'Published comments', resolution, resolutionBusy, abandonable: abandonable() }), request, memberID, disk);
  const unavailable = async () => { throw Error('This comment operation is not enabled'); };
  const dataSource: IThreadCommentDataSource = {
    async addComment(comment) {
      assertScope(comment.unitId, comment.subUnitId);
      if (!allowed() || session.access.role === 'read') throw Error('Comment creation is unavailable while input or native edits are pending');
      return call({ id: comment.id, ref: comment.ref, body: comment.text.dataStream.slice(0, -2), ...(comment.parentId ? { parentId: comment.parentId } : {}) });
    },
    updateComment: comment => editing!.updateComment(comment),
    async resolveComment(comment) {
      assertScope(comment.unitId, comment.subUnitId);
      const a = executing;
      if (!a || comment.id !== a.commentId || comment.resolved !== a.resolved || !allowed() || a.memberID !== memberID()) throw Error('Resolution is unavailable; retained identity requires a status check');
      const response = await request(url + '/actions', { method: 'POST', signal: controller.signal, headers: { 'X-Workagent-Session-Binding': session.binding, 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
      if (!live || !response.ok) throw Error('Resolution preparation refused or unavailable; identity retained, no automatic retry');
      const receipt = await response.json();
      if (!live || !allowed() || memberID() !== a.memberID || receipt.id !== a.id || receipt.commentId !== a.commentId || receipt.memberID !== a.memberID || receipt.resolved !== a.resolved || receipt.status !== 'unknown') throw Error('Resolution preparation changed; check status without retry');
      return true;
    }, deleteComment: (unit, sub, thread, id) => deletion!.deleteComment(unit, sub, thread, id), deleteThread: unavailable,
    async listComments(unit, sub, threads) { assertScope(unit, sub); const value = await call(); return value.comments.filter((c: IThreadComment) => threads.includes(c.threadId)); },
    saveCommentToSnapshot: comment => comment,
  };
  source.dataSource = dataSource; source.syncUpdateMutationToColla = true;
  const refresh = async () => {
    if (!live || checking) return; checking = true;
    try {
      const value = await call(undefined, pending); comments = value.comments; editing!.observe(value); deletion!.observe(value); currentRevision = value.revision; receipts = new Map();
      reconcile();
      for (const a of actions) {
        const receipt = value.actions?.find((r: Action) => r.id === a.id);
        if (receipt && receipt.commentId === a.commentId && receipt.memberID === a.memberID && receipt.resolved === a.resolved && Number.isSafeInteger(receipt.head)) {
          receipts.set(a.id, receipt);
          if (receipt.status === 'abandoned' && receipt.phase === 'abandoned') { append('abandoned:' + a.id, receipt); resolution = 'Unused resolution abandoned. A new request is explicit; the same thread needs a newer native revision or a reopened editor.'; }
        }
        if (receipt?.status === 'committed' && receipt.commentId === a.commentId && receipt.memberID === a.memberID && receipt.resolved === a.resolved && Number.isSafeInteger(receipt.revision) && receipt.revision > 0 && receipt.revision <= value.revision) {
          try { append('committed:' + a.id, a); resolution = `Thread ${a.resolved ? 'resolution' : 'reopening'} recorded at native revision ${receipt.revision}.`; }
          catch { storageFailed = true; resolution = 'Cannot retain committed resolution evidence; no new action enabled.'; }
        }
      }
      reconcile();
      if (actions.length && !storageFailed) resolution = 'Retained thread resolution outcome unknown. Check status (GET only); no automatic retry.';
      const confirmed = pending && comments.some(c => c.id === pending || c.children?.some(r => r.id === pending)) ? pending : undefined;
      if (confirmed) { pending = undefined; notice = ''; removed = undefined; }
      else if (pending && value.receipt?.id === pending && value.receipt.status === 'committed-removed' && Number.isSafeInteger(value.receipt.revision) && value.receipt.revision > 0 && value.receipt.revision <= value.revision) {
        removed = pending; pending = undefined;
        notice = 'Comment was committed, then removed. Draft retained. Choose a new cell comment or clear the unsent draft; nothing will be replayed.';
      }
      update({ comments, pending: !!pending, confirmed, removed, resolution, resolutionBusy, abandonable: abandonable(), message: pending ? (notice || 'Comment awaiting native confirmation — keep this draft open') : (notice || 'Published comments at native revision ' + value.revision) });
    } catch (error) { if (live) update({ comments: [], pending: !!pending, removed, resolution, resolutionBusy, abandonable: abandonable(), message: String(error) }); }
    finally { checking = false; }
  };
  return {
    refresh,
    editing, deletion,
    pending: () => !!pending || resolutionBusy || !!editing?.busy() || !!deletion?.busy(),
    canResolve(root: CommentRoot) { return live && !deletion?.busy() && !editing?.busy() && reconcile() && !root.resolutionUnknown && !actions.some(a => a.commentId === root.id) && !retired.some(r => r.action.commentId === root.id && r.action.memberID === memberID() && r.head === currentRevision && r.action.resolved === (root.resolved !== true)) && !resolutionBusy && !pending && allowed() && !!memberID() && session.access.role !== 'read' && (session.owner || root.personId === session.principal); },
    async resolve(root: CommentRoot) {
      if (!this.canResolve(root)) return;
      const a: Action = { id: crypto.randomUUID(), commentId: root.id, memberID: memberID(), resolved: root.resolved !== true };
      try {
        const key = scope + 'intent:' + a.id, encoded = JSON.stringify(a);
        if (disk!.getItem(key) !== null) throw Error();
        disk!.setItem(key, encoded); if (disk!.getItem(key) !== encoded) throw Error();
      } catch { storageFailed = true; resolution = 'Cannot retain resolution identity. No request sent.'; update({ comments, pending: !!pending, message: notice || 'Published comments — bodies unchanged', resolution }); return; }
      resolutionBusy = true; executing = a; resolution = 'Thread state change awaiting native confirmation; no automatic retry.';
      update({ comments, pending: !!pending, message: notice || 'Published comments — bodies unchanged', resolution, resolutionBusy });
      try {
        if (!await commands.executeCommand(ResolveCommentCommand.id, { unitId: session.unitID, subUnitId: 'sheet-1', commentId: a.commentId, resolved: a.resolved })) throw Error('Native resolution command did not complete');
      } catch (error) { resolution = String(error) + ' Identity retained. Check status (GET only).'; }
      finally { executing = undefined; resolutionBusy = false; if (live) update({ comments, pending: !!pending, message: notice || 'Published comments — bodies unchanged', resolution, resolutionBusy }); }
    },
    async abandon(id: string) {
      if (!live || !allowed() || !abandonable().includes(id)) return;
      const a = actions.find(a => a.id === id)!;
      try { append('abandon-request:' + id, a); } catch { storageFailed = true; resolution = 'Cannot retain abandonment identity. No request sent.'; return; }
      resolutionBusy = true;
      try {
        const response = await request(url + '/actions/' + id + '/abandon', { method: 'POST', signal: controller.signal, headers: { 'X-Workagent-Session-Binding': session.binding, 'Content-Type': 'application/json' }, body: '{}' });
        if (!live || !response.ok) throw Error('Abandonment not confirmed; use GET status only');
        const r = await response.json();
        if (!live || r.id !== a.id || r.commentId !== a.commentId || r.memberID !== a.memberID || r.resolved !== a.resolved || r.status !== 'abandoned' || r.phase !== 'abandoned' || !Number.isSafeInteger(r.head)) throw Error('Abandonment response mismatch; use GET status only');
        append('abandoned:' + id, r); reconcile();
        resolution = 'Unused resolution abandoned. New requests are explicit; the same thread needs a newer native revision or a reopened editor.';
      } catch (error) { if (live) resolution = String(error) + ' Identity retained; no automatic retry.'; }
      finally { resolutionBusy = false; if (live) update({ comments, pending: !!pending, message: notice || 'Published comments — bodies unchanged', resolution, resolutionBusy, abandonable: abandonable() }); }
    },
    canAdd: () => live && !deletion?.busy() && !editing?.busy() && !pending && !resolutionBusy && !removed && allowed() && session.access.role !== 'read',
    explain(message: string) { notice = message; if (live) update({ comments, pending: !!pending, removed, message }); },
    newDraft() {
      if (!live || pending) return;
      removed = undefined; notice = 'New comment draft — no request sent';
      update({ comments, pending: false, message: notice });
    },
    async add(body: string, ref: string, parentId?: string) {
      if (!live) return;
      if (deletion?.busy() || editing?.busy() || pending || resolutionBusy || removed || !allowed() || session.access.role === 'read') {
        update({ comments, pending: !!pending, removed, message: removed ? notice : session.access.role === 'read' ? 'Read-only — comments can be read' : 'Finish active cell input, paste or pending native edits before adding a comment. Draft retained.' }); return;
      }
      pending = crypto.randomUUID(); nativeAttempt = false; notice = '';
      const comment: IThreadComment = { id: pending, threadId: parentId ?? pending, unitId: session.unitID, subUnitId: 'sheet-1', personId: session.principal, authorName: session.name, ref, dT: '', text: { dataStream: body + '\r\n' }, ...(parentId ? { parentId } : {}) };
      update({ comments, pending: true, message: 'Preparing private comment body — not published' });
      try {
        const result = await commands.executeCommand(AddCommentCommand.id, { unitId: session.unitID, subUnitId: 'sheet-1', comment });
        if (!result) throw Error('Native comment command refused; draft retained');
        if (live) update({ comments, pending: true, message: 'Comment awaiting native confirmation — keep this draft open' });
      } catch (error) {
        // Public before-command notification fences the native-effect boundary.
        // A rejected prewrite can retain a private body, but cannot have added it
        // natively. After mutation entry, even a thrown command is uncertain.
        if (!nativeAttempt) pending = undefined;
        notice = String(error) + (nativeAttempt ? ' Native outcome unknown; keep this draft open. No automatic retry.' : ' No native add began. Edit this draft or choose a new explicit action; no automatic retry.');
        if (live) update({ comments, pending: !!pending, message: notice });
      }
    },
    dispose() { live = false; deletion?.dispose(); editing?.dispose(); controller.abort(); mutationStart.dispose(); if (source.dataSource === dataSource) source.dataSource = null; },
  };
}

type EditableComment = IThreadComment & { bodyVersion?: string; bodyUnknown?: boolean };
type EditIntent = { id: string; commentId: string; memberID: string; body: string; previousVersion: string };
type EditReceipt = EditIntent & { head: number; status: string; phase: string; revision?: number };
export interface CommentEditView { message: string; busy: boolean; abandonable: string[]; confirmed?: { commentId: string; body: string; version: string } }
// Isolated immutable edit identities. Native command/ACK remains the only effect path.
function nativeCommentEditing(session: NativeSession, commands: ICommandService, allowed: () => boolean, notify: () => void,
 request: typeof fetch, memberID: () => string, disk?: Pick<Storage,'getItem'|'setItem'|'key'|'length'>) {
 const prefix=`workagent:native-comment-edit:${session.principal}:${session.unitID}:${session.binding}:${session.access.revision}:`,url=`/api/work/${session.unitID}/native-comments/${session.access.revision}/edits`;
 const controller=new AbortController();let live=true,busy=false,failed=false,message='',active:EditIntent|undefined,records:EditIntent[]=[],retired:EditReceipt[]=[],head=0;
 let receipts=new Map<string,EditReceipt>(), published=new Map<string,EditableComment>();
 let confirmed: CommentEditView['confirmed'];
 const equal=(a:EditIntent,b:EditIntent)=>a.id===b.id&&a.commentId===b.commentId&&a.memberID===b.memberID&&a.body===b.body&&a.previousVersion===b.previousVersion;
 const append=(key:string,value:unknown)=>{if(!disk)throw Error('Edit recovery storage unavailable');const encoded=JSON.stringify(value),old=disk.getItem(prefix+key);if(old!==null&&old!==encoded)throw Error('Conflicting edit evidence');if(old===null)disk.setItem(prefix+key,encoded);if(disk.getItem(prefix+key)!==encoded)throw Error('Edit evidence not retained');};
 const reconcile=()=>{try{
  if(!disk||!Number.isSafeInteger(disk.length))throw Error();const result:EditIntent[]=[],done:EditReceipt[]=[];
  for(let n=0;n<disk.length;n++){const key=disk.key(n);if(key===null)throw Error();if(!key.startsWith(prefix+'intent:'))continue;const a=JSON.parse(disk.getItem(key)??'null');
   if(!a||Object.keys(a).sort().join()!=='body,commentId,id,memberID,previousVersion'||![a.id,a.commentId,a.memberID,a.previousVersion].every(x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x))||typeof a.body!=='string'||!a.body.trim()||a.body.length>8000||key!==prefix+'intent:'+a.id)throw Error();
   const start=disk.getItem(prefix+'started:'+a.id),abandon=disk.getItem(prefix+'abandon-request:'+a.id);
   for(const marker of [start,abandon])if(marker!==null&&marker!==JSON.stringify(a))throw Error();
   const terminal=disk.getItem(prefix+'terminal:'+a.id);
   if(terminal!==null){const r=JSON.parse(terminal);if(!equal(a,r)||!Number.isSafeInteger(r.head)||!['committed','abandoned'].includes(r.status)||r.status==='abandoned'&&(start!==null||r.phase!=='abandoned')||r.status==='committed'&&(!Number.isSafeInteger(r.revision)||r.revision!==r.head+1))throw Error();done.push(r);}else result.push(a);
  }records=result;retired=done;return !failed;
 }catch{failed=true;message='Edit recovery evidence unavailable. No text change will be sent.';return false;}};
 const abandonable=()=>live&&reconcile()&&!busy&&session.access.role!=='read'?records.filter(a=>(!receipts.has(a.id)||(receipts.get(a.id)?.phase==='prepared'&&receipts.get(a.id)?.status==='unknown'))&&disk!.getItem(prefix+'started:'+a.id)===null&&disk!.getItem(prefix+'abandon-request:'+a.id)===null).map(a=>a.id):[];
 const call=async(path:string,body:object)=>{const r=await request(path,{method:'POST',signal:controller.signal,headers:{'X-Workagent-Session-Binding':session.binding,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!live||!r.ok)throw Error('Edit request not confirmed; check status, no automatic retry');const value=await r.json();if(!live)throw Error('Edit session changed');return value as EditReceipt;};
 const observer=commands.beforeCommandExecuted(command=>{if(command.id!==UpdateCommentMutation.id||!active)return;const p=command.params as {unitId:string;subUnitId:string;payload:{commentId:string;text:unknown}};if(p?.unitId!==session.unitID||p.subUnitId!=='sheet-1'||p.payload.commentId!==active.commentId||!live||!allowed()||memberID()!==active.memberID||disk?.getItem(prefix+'abandon-request:'+active.id)!==null)throw Error('Edit input changed before native mutation');append('started:'+active.id,active);});
 reconcile();
 return {
  view:():CommentEditView=>({message,busy,abandonable:abandonable(),confirmed}),busy:()=>busy,
  observe(value:{revision:number;edits?:EditReceipt[];comments:EditableComment[]}){head=value.revision;published=new Map(value.comments.flatMap(root=>[root,...(root.children??[]).map(c=>({...c,ref:root.ref}))]).map(c=>[c.id,c]));confirmed=undefined;reconcile();receipts=new Map();for(const a of records){const r=value.edits?.find(r=>r.id===a.id);if(!r||!equal(a,r)||!Number.isSafeInteger(r.head))continue;receipts.set(a.id,r);if(r.phase==='admitted'){try{append('started:'+a.id,a);}catch{failed=true;message='Cannot retain native admission evidence; no new edit enabled.';}}if(r.status==='committed'&&r.revision===r.head+1&&r.revision<=head||r.status==='abandoned'&&r.phase==='abandoned'){try{append('terminal:'+a.id,r);if(r.status==='committed'&&published.get(a.commentId)?.bodyVersion===a.id&&published.get(a.commentId)?.text.dataStream===a.body+'\r\n')confirmed={commentId:a.commentId,body:a.body,version:a.id};message=r.status==='committed'?`Text revision recorded at native revision ${r.revision}. Prior bodies retained.`:'Unused edit abandoned. A new edit requires a separate action; the same text needs a newer native revision or reopened editor.';}catch{failed=true;message='Conflicting edit evidence; no new edit enabled.';}}}reconcile();if(records.length&&!failed)message='Text edit outcome unknown. Check status (GET only). Explicit unused abandonment asks the server to fence this identity; no release until proven.';},
  canEdit(comment:EditableComment){return live&&reconcile()&&!busy&&allowed()&&session.access.role!=='read'&&comment.personId===session.principal&&!comment.bodyUnknown&&!!comment.bodyVersion&&published.get(comment.id)?.bodyVersion===comment.bodyVersion&&!published.get(comment.id)?.bodyUnknown&&!!memberID()&&!records.some(a=>a.commentId===comment.id);},
  canSave(comment:EditableComment,body:string){return this.canEdit(comment)&&!!body.trim()&&body.length<=8000&&!/[\u0000-\u0008\u000b-\u001f]/.test(body)&&comment.text.dataStream!==body+'\r\n';},
  async updateComment(comment:IThreadComment){const a=active;if(!a||!live||!allowed()||comment.id!==a.commentId||comment.unitId!==session.unitID||comment.subUnitId!=='sheet-1'||comment.text.dataStream!==a.body+'\r\n'||a.memberID!==memberID())throw Error('Comment editing not enabled outside an explicit retained edit');const r=await call(url,a);if(!equal(a,r)||r.status!=='unknown'||r.phase!=='prepared'||!allowed()||memberID()!==a.memberID)throw Error('Edit preparation changed; check status before any new action');return true;},
  async edit(comment:EditableComment,body:string){if(!this.canSave(comment,body))return;if(retired.some(r=>r.status==='abandoned'&&r.commentId===comment.id&&r.memberID===memberID()&&r.head===head&&r.body===body)){message='This abandoned edit needs a newer revision or explicitly reopened editor.';notify();return;}
   const a:EditIntent={id:crypto.randomUUID(),commentId:comment.id,memberID:memberID(),body,previousVersion:comment.bodyVersion!};try{append('intent:'+a.id,a);}catch{failed=true;message='Cannot retain edit identity. No request sent.';notify();return;}
   busy=true;active=a;message='Text edit awaiting native evidence; prior body remains published.';notify();
   try{if(!await commands.executeCommand(UpdateCommentCommand.id,{unitId:session.unitID,subUnitId:'sheet-1',payload:{commentId:a.commentId,text:{dataStream:body+'\r\n',paragraphs:[{startIndex:body.length}]}}}))throw Error('Native edit did not complete');}catch(error){message=String(error)+' Draft and identity retained; no automatic retry.';}finally{busy=false;active=undefined;if(live)notify();}
  },
  async abandon(id:string){if(!allowed()||!abandonable().includes(id))return;const a=records.find(a=>a.id===id)!;try{append('abandon-request:'+id,a);}catch{failed=true;message='Cannot retain abandonment identity. No request sent.';notify();return;}busy=true;notify();try{const r=await call(url+'/'+id+'/abandon',a);if(!equal(a,r)||r.status!=='abandoned'||r.phase!=='abandoned'||!Number.isSafeInteger(r.head))throw Error('Abandonment evidence mismatch');append('terminal:'+id,r);reconcile();message='Unused edit abandoned; no native text changed. A new edit is explicit.';}catch(error){message=String(error)+' Check status (GET only).';}finally{busy=false;if(live)notify();}},
  dispose(){live=false;controller.abort();observer.dispose();},
 };
}

type DeleteTarget = { id: string; bodyVersion: string };
type DeleteSelection = { commentId: string; rootId: string; ref: string; targets: DeleteTarget[] };
type DeleteIntent = DeleteSelection & { id: string; memberID: string };
type DeleteReceipt = DeleteIntent & { head: number; phase: string; status: string; revision?: number };
export interface CommentDeleteView { message: string; busy: boolean; preview?: DeleteSelection; canConfirm: boolean; abandonable: string[] }
function nativeCommentDeletion(session: NativeSession, commands: ICommandService, allowed: () => boolean, notify: () => void,
 request: typeof fetch, memberID: () => string, disk?: Pick<Storage,'getItem'|'setItem'|'key'|'length'>) {
 const prefix=`workagent:native-comment-delete:${session.principal}:${session.unitID}:${session.binding}:${session.access.revision}:`,url=`/api/work/${session.unitID}/native-comments/${session.access.revision}/deletions`,controller=new AbortController();
 let live=true,busy=false,failed=false,message='',head=0,preview:DeleteSelection|undefined,active:DeleteIntent|undefined,roots:CommentRoot[]=[],records:DeleteIntent[]=[],retired:DeleteReceipt[]=[],receipts=new Map<string,DeleteReceipt>();
 let invocation: { unitId: string; subUnitId: string; commentId: string } | undefined;
 const selection=(a:DeleteSelection)=>({commentId:a.commentId,rootId:a.rootId,ref:a.ref,targets:a.targets});
 const same=(a:DeleteIntent,b:DeleteIntent)=>a.id===b.id&&a.memberID===b.memberID&&JSON.stringify(selection(a))===JSON.stringify(selection(b));
 const append=(key:string,value:unknown)=>{if(!disk)throw Error('Deletion recovery storage unavailable');const encoded=JSON.stringify(value),old=disk.getItem(prefix+key);if(old!==null&&old!==encoded)throw Error('Conflicting deletion evidence');if(old===null)disk.setItem(prefix+key,encoded);if(disk.getItem(prefix+key)!==encoded)throw Error('Deletion evidence not retained');};
 const reconcile=()=>{try{
  if(!disk||!Number.isSafeInteger(disk.length))throw Error();const pending:DeleteIntent[]=[],done:DeleteReceipt[]=[];
  for(let n=0;n<disk.length;n++){const key=disk.key(n);if(key===null)throw Error();if(!key.startsWith(prefix+'intent:'))continue;const a=JSON.parse(disk.getItem(key)??'null');
   if(!a||Object.keys(a).sort().join()!=='commentId,id,memberID,ref,rootId,targets'||![a.id,a.commentId,a.memberID,a.rootId].every(x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x))||typeof a.ref!=='string'||!Array.isArray(a.targets)||!a.targets.length||a.targets.length>4096||a.targets.some((t:DeleteTarget)=>!t||Object.keys(t).sort().join()!=='bodyVersion,id'||![t.id,t.bodyVersion].every(x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x)))||new Set(a.targets.map((t:DeleteTarget)=>t.id)).size!==a.targets.length||key!==prefix+'intent:'+a.id)throw Error();
   const started=disk.getItem(prefix+'started:'+a.id),abandon=disk.getItem(prefix+'abandon-request:'+a.id);for(const marker of [started,abandon])if(marker!==null&&marker!==JSON.stringify(a))throw Error();
   const terminal=disk.getItem(prefix+'terminal:'+a.id);if(terminal===null){pending.push(a);continue;}const r=JSON.parse(terminal);
   if(!same(a,r)||!Number.isSafeInteger(r.head)||!['committed','abandoned'].includes(r.status)||r.status==='committed'&&r.revision!==r.head+1||r.status==='abandoned'&&(started!==null||r.phase!=='abandoned'))throw Error();done.push(r);
  }records=pending;retired=done;return !failed;
 }catch{failed=true;message='Deletion recovery evidence unavailable. Nothing will be sent.';return false;}};
 const describe=(root:CommentRoot,commentId:string):DeleteSelection|undefined=>{
  const target=root.id===commentId?root:root.children?.find(c=>c.id===commentId);if(!target)return;
  const affected=(target===root?[root,...(root.children??[])]:[target]) as EditableComment[];
  if(affected.some(c=>c.personId!==session.principal||c.bodyUnknown||!c.bodyVersion))return;
  return {commentId,rootId:root.id,ref:root.ref,targets:affected.map(c=>({id:c.id,bodyVersion:c.bodyVersion!})).sort((a,b)=>a.id.localeCompare(b.id))};
 };
 const current=(p:DeleteSelection)=>{const root=roots.find(r=>r.id===p.rootId),now=root&&describe(root,p.commentId);return !!now&&JSON.stringify(now)===JSON.stringify(p);};
 const safe=()=>live&&reconcile()&&!busy&&allowed()&&session.access.role!=='read'&&!!memberID();
 const canConfirm=()=>safe()&&!!preview&&current(preview)&&!records.some(a=>a.rootId===preview!.rootId)&&!retired.some(r=>r.status==='abandoned'&&r.commentId===preview!.commentId&&r.memberID===memberID()&&r.head===head);
 const abandonable=()=>live&&reconcile()&&!busy&&session.access.role!=='read'?records.filter(a=>(!receipts.has(a.id)||receipts.get(a.id)?.status==='unknown'&&receipts.get(a.id)?.phase==='prepared')&&disk!.getItem(prefix+'started:'+a.id)===null&&disk!.getItem(prefix+'abandon-request:'+a.id)===null).map(a=>a.id):[];
 const call=async(path:string,input:object)=>{const r=await request(path,{method:'POST',signal:controller.signal,headers:{'X-Workagent-Session-Binding':session.binding,'Content-Type':'application/json'},body:JSON.stringify(input)});if(!live||!r.ok)throw Error('Deletion request unconfirmed. Identity retained; check status, no retry.');const value=await r.json();if(!live)throw Error('Comment session changed');return value as DeleteReceipt;};
 const observer=commands.beforeCommandExecuted((command,options)=>{
  // Pinned public DeleteCommentCommand forwards its params object unchanged to
  // DeleteCommentMutation after the data-source await. Structural cleanup has
  // its own params, even for the same comment. Do not use a concurrent command's
  // trigger or a matching comment ID as evidence of this manual invocation.
  if(options?.fromCollab||command.id!==DeleteCommentMutation.id||!active||command.params!==invocation)return;const p=invocation;
  if(!live||!allowed()||memberID()!==active.memberID||p?.unitId!==session.unitID||p.subUnitId!=='sheet-1'||p.commentId!==active.commentId||!current(selection(active))||disk?.getItem(prefix+'abandon-request:'+active.id)!==null)throw Error('Deletion changed before native mutation; retained identity requires status check');append('started:'+active.id,active);
 });
 reconcile();
 return {
  view:():CommentDeleteView=>({message,busy,preview,canConfirm:canConfirm(),abandonable:abandonable()}),busy:()=>busy,
  canChoose(root:CommentRoot,id:string){const p=describe(root,id);return safe()&&!!p&&current(p)&&!records.some(a=>a.rootId===root.id);},
  choose(root:CommentRoot,id:string){if(!this.canChoose(root,id))return;preview=describe(root,id);message='Review the exact comment/subtree below. No request sent. Native removal retains private history.';notify();},
  cancel(){if(busy)return;preview=undefined;notify();},
  observe(value:{revision:number;comments:CommentRoot[];deletions?:DeleteReceipt[]}){
   head=value.revision;roots=value.comments;reconcile();receipts=new Map();
   for(const a of records){const r=value.deletions?.find(r=>r.id===a.id);if(!r||!same(a,r)||!Number.isSafeInteger(r.head))continue;receipts.set(a.id,r);
    try{if(r.phase==='admitted')append('started:'+a.id,a);if(r.status==='committed'&&r.revision===r.head+1&&r.revision<=head||r.status==='abandoned'&&r.phase==='abandoned'){append('terminal:'+a.id,r);message=r.status==='committed'?`Removal recorded at native revision ${r.revision}. Prior bodies/history retained; restore is not enabled.`:'Unused deletion abandoned. A new request is explicit; this comment needs a newer native revision or reopened editor.';if(preview?.commentId===a.commentId)preview=undefined;}}
    catch{failed=true;message='Conflicting deletion evidence; no new request enabled.';}
   }
   reconcile();if(records.length&&!failed)message='Deletion outcome unknown. GET status only; live absence is not proof. Explicit unused abandonment requires server proof.';
   if(preview&&!current(preview))message='Comment, body or subtree changed. Cancel this preview and review the latest thread; no automatic deletion.';
  },
  async deleteComment(unit:string,sub:string,thread:string,id:string){const a=active;if(!a||!live||!allowed()||unit!==session.unitID||sub!=='sheet-1'||thread!==a.rootId||id!==a.commentId||memberID()!==a.memberID)throw Error('Manual deletion is not enabled outside an explicit confirmation');const r=await call(url,a);if(!same(a,r)||r.status!=='unknown'||r.phase!=='prepared'||!allowed()||memberID()!==a.memberID||!current(selection(a)))throw Error('Deletion preparation changed. Check status without retry.');return true;},
  async confirm(){if(!canConfirm())return;const a:DeleteIntent={...preview!,id:crypto.randomUUID(),memberID:memberID()};try{append('intent:'+a.id,a);}catch{failed=true;message='Cannot retain deletion identity. No request sent.';notify();return;}active=a;busy=true;message='Deletion awaiting native evidence; not yet recorded.';notify();
   invocation={unitId:session.unitID,subUnitId:'sheet-1',commentId:a.commentId};
   try{if(!await commands.executeCommand(DeleteCommentCommand.id,invocation))throw Error('Native deletion did not complete');}catch(error){message=String(error)+' Identity retained; no automatic retry.';}finally{invocation=undefined;active=undefined;busy=false;if(live)notify();}
  },
  async abandon(id:string){if(!allowed()||!abandonable().includes(id))return;const a=records.find(a=>a.id===id)!;try{append('abandon-request:'+id,a);}catch{failed=true;message='Cannot retain abandonment evidence; no request sent.';notify();return;}busy=true;notify();try{const r=await call(url+'/'+id+'/abandon',a);if(!same(a,r)||r.status!=='abandoned'||r.phase!=='abandoned'||!Number.isSafeInteger(r.head))throw Error('Abandonment not proven');append('terminal:'+id,r);reconcile();preview=undefined;message='Unused deletion abandoned. No native removal. New requests require explicit review.';}catch(error){message=String(error)+' Check status (GET only).';}finally{busy=false;if(live)notify();}},
  dispose(){live=false;controller.abort();observer.dispose();},
 };
}
