import { PdfExport } from './PdfExport';
import { DocxExchange } from './DocxExchange';
import { DocumentExchange } from './DocumentExchange';
import { DocumentEditor, type DocumentHandle } from './DocumentEditor';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeEditor, type EditorHandle } from './NativeEditor';
import type { Work, Proposal } from './types';
import type { IWorkbookData, IDocumentData } from '@univerjs/core';
import { DraftFence } from './drafts';
import { withoutFormulaResults } from '../../../packages/workagent-contract/index.mjs';
import { ApiError, ProductCursor, ComposerDrafts, type ComposerDraft, type ProductBatch, type SelectionAttachment, type SelectionContext, type Submission } from './resume';
import './style.css';
import { MaintenanceActions, type Pending } from './maintenance-actions';
import { XlsxExchange } from './XlsxExchange';
import { CsvExchange } from './CsvExchange';
import { MaintenancePanel } from './MaintenancePanel';
const uuid = () => crypto.randomUUID();
async function api<T>(path: string, input?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', signal, method: method ?? (input ? 'POST' : 'GET'), ...(input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}) });
  const result = await response.json(); if (!response.ok) throw new ApiError(path, response.status, typeof result.error === 'string' ? result.error : 'service_unavailable'); return result;
}
const friendly: Record<string, string> = { save_conflict: 'The saved work changed while you were editing. Your draft is kept. Download it before opening the saved version.', proposal_conflict: 'This proposal is out of date. Ask the agent to review the current work.', access_denied: 'Please sign in to your private workspace.', accounting_bridge_not_connected: 'Model access is waiting for the accounting connection. You can still edit and save your sheet.', openrouter_not_configured: 'Model access is not configured yet.', execution_interrupted_check_receipt: 'Work was interrupted. Your saved sheet is safe. The operator must check any uncertain model request before retrying.' };
friendly.provider_budget_exhausted = 'OpenRouter reports that a configured budget is exhausted. Saved work is kept.';
friendly.provider_http_402 = 'OpenRouter refused this request under its credit or in-flight limits. Saved work is kept; nothing was retried.';
friendly.provider_http_403 = 'OpenRouter denied this request. Saved work is kept; nothing was retried.';
friendly.provider_http_429 = 'OpenRouter rate-limited this request. Saved work is kept; nothing was retried.';
friendly.output_limit_reached = 'The response reached its output limit before finishing. Saved changes and replies are kept. Send a continuation to carry on from the saved work.';
friendly.empty_model_response = 'The model ended without a usable reply. Saved work is kept. Send a continuation to try a new turn.';
friendly.interrupted_no_automatic_replay = 'Execution may have started before the restart. Saved changes are kept. Nothing was resent; ask explicitly to continue, or have the operator reconcile the request.';
friendly.cancelled_check_receipt = 'Work has stopped. Saved changes are kept; an in-flight model request may still have taken effect.';
friendly.service_stopped = 'The service stopped during this work. Saved changes are kept; execution was not automatically repeated.';
friendly.unresolved_send = 'An earlier send has an unknown acknowledgement. Restore that message below and send it again to check the same command safely.';
friendly.invalid_document_title = 'Enter a document title of 1–200 characters before saving.';
friendly.invalid_document_structure = 'This document contains malformed native formatting. Your whole local draft is kept. Download the draft or Open saved version to recover.';
friendly.invalid_document = 'This document cannot be saved. Your local draft is kept.';
friendly.invalid_document_body = 'The document text exceeds the supported bounds or contains unsupported objects. Your local draft is kept.';
friendly.unsupported_document_structure = 'This document contains unsupported content or foreign artifact fields. Your whole draft is kept. Download the draft, then Open saved version to resume from the saved document; the previous draft is also retained on this device.';
friendly.unsupported_document_resources = 'This document contains unsupported style, note or permission resources. Your local draft is kept.';
friendly.unsupported_document_list = 'Only flat bullets and decimal lists are currently mapped. Nested lists, other numbering styles or inconsistent list references were refused; your existing content is kept. Use a level-zero bullet or decimal list.';
friendly.pdf_lists_unqualified = 'PDF list rendering is not yet qualified. No download was made. Use Word export to retain supported lists.';

friendly.selection_conflict = 'The saved work changed. Attach the intended selection again before sending; your message is kept.';
friendly.invalid_document_selection = 'Attach one body-text range of at most 10,000 UTF-16 units, with complete Unicode characters.';
friendly.invalid_composer_draft = 'This device has an unsupported composer draft. It has been retained without overwriting it.';
friendly.invalid_pending_send = 'This device has an unsupported pending send. It has been retained; no new command was sent.';
friendly.invalid_selection = 'This selection is unavailable or too large. Attach one range of at most 2,000 cells (200 KB of context).';
type NativeContent = IWorkbookData | IDocumentData;
type NativeArtifact = { kind: 'sheet'; book: IWorkbookData } | { kind: 'document'; book: IDocumentData };
type NativeEditor = { kind: 'sheet'; native: EditorHandle } | { kind: 'document'; native: DocumentHandle };
type EditorState = NativeArtifact & { revision: number; permission: number; version: string };
const content = (w: Work): NativeArtifact => w.kind === 'document' ? { kind: 'document', book: w.document } : { kind: 'sheet', book: w.book };
const meaning = (artifact: NativeArtifact) => artifact.kind === 'sheet' ? withoutFormulaResults(artifact.book) : artifact.book;
const snapshot = (editor: NativeEditor): NativeArtifact => editor.kind === 'document' ? { kind: 'document', book: editor.native.save() } : { kind: 'sheet', book: editor.native.save() };
function App() {
  const [authenticated, setAuthenticated] = useState(false), [token, setToken] = useState(''), [error, setError] = useState('');
  const [works, setWorks] = useState<{ id: string; title: string; status: string }[]>([]), [work, setWork] = useState<Work | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState(false), [prompt, setPrompt] = useState(''), [sourceText, setSourceText] = useState(''), [sourceName, setSourceName] = useState('Pasted data'), [busy, setBusy] = useState(false);
  const [view, setView] = useState<'chat' | 'sheet'>('chat');
  const [pendingSend, setPendingSend] = useState(false);
  const [selectionView, setSelectionView] = useState<SelectionAttachment | undefined>();
  const [selectionInvalid, setSelectionInvalid] = useState(false), [pendingPreview, setPendingPreview] = useState<Submission | null>(null);
  const blankActions = useRef(new MaintenanceActions(localStorage, 'blank-sheet'));
  const [blankTitle, setBlankTitle] = useState('Untitled work'), [blankBusy, setBlankBusy] = useState(false);
  const blankFlight = useRef(false);
  const blankAttempt = useRef<Pending | null>(null);
  const [blankPending, setBlankPending] = useState(false);
  const [createdBlank, setCreatedBlank] = useState<string | null>(null);
  const fence = useRef(new DraftFence());
  const composers = useRef(new ComposerDrafts(localStorage));
  const composer = useRef<ComposerDraft>({ prompt: '', sourceName: 'Pasted data', sourceText: '' });
  const saveFlight = useRef<Promise<void> | null>(null);
  // Only settle the recovery payload this consumer loaded or last wrote. Another
  // tab can retry the same command while owning a newer, independent draft.
  const recovery = useRef<{ workId: string; raw: string } | null>(null);
  const editor = useRef<NativeEditor | null>(null), dirty = useRef(false), active = useRef<string | null>(null), base = useRef(editorState), workRef = useRef(work);
  function installEditor(next: typeof editorState) { if (next?.version !== base.current?.version) editor.current = null; base.current = next; setEditorState(next); }
  const hasDraft = () => dirty.current || !!editor.current?.native.isEditing();
  const report = (e: unknown) => setError(e instanceof Error ? friendly[e.message] ?? e.message : 'Unable to save this change.');
  function displayComposer(value: ComposerDraft) { composer.current = value; setPrompt(value.prompt); setSourceName(value.sourceName); setSourceText(value.sourceText); setSelectionView(value.selection); }
  function pendingState(workId: string | null) { try { const pending = composers.current.pending(workId); setPendingSend(!!pending); setPendingPreview(pending); } catch (e) { setPendingSend(false); setPendingPreview(null); report(e); } }
  function loadComposer(workId: string | null) {
    try { const value = composers.current.read(workId); displayComposer(value); setSelectionInvalid(value.selection?.kind === 'document'); } catch (e) { displayComposer({ prompt: '', sourceName: 'Pasted data', sourceText: '' }); report(e); }
    pendingState(workId);
  }
  function editComposer(changes: Partial<ComposerDraft>) {
    const next = { ...composer.current, ...changes }; displayComposer(next);
    try { composers.current.write(active.current, next); } catch (e) { report(e instanceof Error && e.message === 'invalid_composer_draft' ? e : new Error('Local storage is full. Keep this page open to preserve your message.')); }
  }
  const list = useCallback(async () => { setWorks(await api('/work')); setAuthenticated(true); }, []);
  const receive = useCallback((w: Work) => {
    if (active.current !== w.id) return;
    const current = workRef.current;
    if (current?.id === w.id && current.eventSequence > w.eventSequence) return;
    const savedRevision = base.current?.book.id === w.id ? base.current.revision : 0;
    if (w.contentRevision < savedRevision || (current?.id === w.id && (w.contentRevision < current.contentRevision || w.intentRevision < current.intentRevision))) return;
    workRef.current = w; setWork(w);
    if (!dirty.current && !editor.current?.native.isEditing() && !saveFlight.current && !(base.current?.book.id === w.id && base.current.revision === w.contentRevision)) {
      const next = { ...content(w), revision: w.contentRevision, permission: w.expected.permissionRevision, version: `${w.id}:${w.contentRevision}` };
      installEditor(next);
    }
  }, []);
  useEffect(() => { loadComposer(null); list().catch(() => {}); }, [list]);
  useEffect(() => {
    try {
      const pending = blankActions.current.read(); blankAttempt.current = pending; setBlankPending(!!pending);
      if (typeof pending?.input.title === 'string') setBlankTitle(pending.input.title);
      setCreatedBlank(localStorage.getItem('workagent-blank:created'));
    } catch (e) { report(e); }
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    const cursor = new ProductCursor(); let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const ticket = cursor.request(), navigation = fence.current.navigation;
      try {
        const batch = await api<ProductBatch>(`/events${cursor.after === undefined ? '' : `?after=${cursor.after}`}`);
        if (disposed) return;
        cursor.apply(ticket, batch, value => {
          if (navigation !== fence.current.navigation) return false;
          setWorks(value.works);
          for (const snapshot of value.snapshots) receive(snapshot);
        });
      } catch (e) { if (!disposed) report(e); }
      if (!disposed) timer = setTimeout(poll, 1800);
    };
    void poll(); return () => { disposed = true; clearTimeout(timer); };
  }, [authenticated, receive]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty.current || editor.current?.native.isEditing()) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
  async function open(workId: string) {
    if (saveFlight.current) { setError('Wait for the current save before switching work.'); return; }
    if (editor.current?.kind === 'document' && editor.current.native.isEditing()) { setError('Native document input is still finishing. Retry switching work after it finishes.'); return; }
    if (hasDraft() && editor.current && !edited(editor.current.native.save())) return;
    const ticket = fence.current.request();
    let w = await api<Work>(`/work/${workId}`);
    if (!fence.current.current(ticket) || saveFlight.current) return;
    if (workRef.current?.id === workId && workRef.current.eventSequence > w.eventSequence) w = workRef.current;
    dirty.current = false; setDraft(false); editor.current = null;
    active.current = workId; workRef.current = null;
    installEditor({ ...content(w), revision: w.contentRevision, permission: w.expected.permissionRevision, version: `${w.id}:open:${uuid()}` });
    receive(w); setError(''); loadComposer(workId);
    const saved = localStorage.getItem(`workagent-draft:${workId}`);
    recovery.current = saved === null ? null : { workId, raw: saved };
    if (saved) {
      try {
        const d = JSON.parse(saved); if (d.book?.id !== workId || !Number.isInteger(d.revision) || !Number.isInteger(d.permission)) throw new Error('invalid_draft'); dirty.current = true; setDraft(true);
        installEditor({ kind: w.kind === 'document' ? 'document' : 'sheet', book: d.book, revision: d.revision, permission: d.permission, version: `${w.id}:draft:${uuid()}` });
        if (d.revision !== w.contentRevision) setError(friendly.save_conflict);
      } catch { setError('A local draft could not be opened. The saved server version is available.'); }
    }
    return true;
  }
  async function createBlank(kind: 'sheet' | 'document' = 'sheet') {
    if (blankFlight.current) return;
    blankFlight.current = true; setBlankBusy(true);
    const actions = blankActions.current;
    let submitted;
    try {
      // A visible Retry owns this exact attempt even if another tab settled it.
      submitted = blankAttempt.current ?? actions.prepare('create', '/work/blank', { title: blankTitle, ...(kind === 'document' ? { kind } : {}) }, uuid);
      blankAttempt.current = submitted;
      setBlankPending(true);
      const result = await api<{ workId: string }>(submitted.path, submitted.input);
      const current = actions.read();
      if (!current || current.input.commandId === submitted.input.commandId) {
        localStorage.setItem('workagent-blank:created', result.workId);
        setCreatedBlank(result.workId);
      }
      actions.accepted(submitted); blankAttempt.current = null;
      await list();
    } catch (e) { if (submitted && actions.rejected(e, submitted)) blankAttempt.current = null; report(e); }
    finally {
      blankFlight.current = false; setBlankBusy(false);
      blankAttempt.current ??= actions.read(); setBlankPending(!!blankAttempt.current);
      if (typeof blankAttempt.current?.input.title === 'string') setBlankTitle(blankAttempt.current.input.title);
    }
  }
  function attachSelection() {
    try {
      if (!editor.current || !base.current || !active.current) return;
      const selection = editor.current.native.selection();
      if (!selection || selection.workId !== active.current) throw new Error('The editor changed. Attach the selection again.');
      editComposer({ selection: { ...selection, contentRevision: base.current.revision } }); setSelectionInvalid(false); setError('');
    } catch (e) { report(e); }
  }
  function newWork() {
    if (saveFlight.current) { setError('Wait for the current save before switching work.'); return; }
    if (editor.current?.kind === 'document' && editor.current.native.isEditing()) { setError('Native document input is still finishing. Retry switching work after it finishes.'); return; }
    if (hasDraft() && editor.current && !edited(editor.current.native.save())) return;
    fence.current.request(); active.current = null; workRef.current = null; editor.current = null;
    dirty.current = false; setDraft(false); setWork(null); installEditor(null); loadComposer(null); setError('');
  }
  function edited(book: NativeContent) {
    if (!active.current || !base.current || book.id !== active.current) return false;
    fence.current.edit(); dirty.current = true; setDraft(true);
    if (composer.current.selection?.kind === 'document') setSelectionInvalid(true);
    try {
      const raw = JSON.stringify({ book, revision: base.current.revision, permission: base.current.permission });
      localStorage.setItem(`workagent-draft:${active.current}`, raw);
      recovery.current = { workId: active.current, raw };
    }
    catch { setError('Local draft storage is full. Save your work to keep these changes.'); return false; }
    return true;
  }
  async function save() {
    if (saveFlight.current) return saveFlight.current;
    if (!active.current || !base.current || !editor.current) return;
    const workId = active.current, native = editor.current, state = base.current;
    const operation = async () => {
      const committed: NativeArtifact = native.kind === 'document' ? { kind: 'document', book: await native.native.commit() } : { kind: 'sheet', book: await native.native.commit() };
      if (committed.kind !== state.kind) throw new Error('The editor kind changed. Reopen the saved work.');
      if (active.current !== workId || editor.current !== native || base.current?.version !== state.version) throw new Error('The editor changed while finishing the edit. Retry from the current work.');
      const actions = new MaintenanceActions(localStorage, `sheet-save:${workId}`);
      const unresolved = actions.read();
      if (!dirty.current && !unresolved) return;
      const generation = fence.current.generation;
      const submitted = unresolved ?? actions.prepare('save', `/work/${workId}/save`, { ...(committed.kind === 'document' ? { document: committed.book } : { book: committed.book }), contentRevision: state.revision, permissionRevision: state.permission }, uuid);
      // Persisted retries retain their exact original body until the server settles it.
      const submittedArtifact: NativeArtifact = state.kind === 'document'
        ? { kind: 'document', book: submitted.input.document as IDocumentData }
        : { kind: 'sheet', book: submitted.input.book as IWorkbookData };
      let result: { contentRevision: number; permissionRevision: number };
      try {
        result = await api(submitted.path, submitted.input);
        const pending = actions.read();
        // A sibling consumer may already have accepted this exact command. A
        // genuinely different pending command still fences this late response.
        if (pending && pending.input.commandId !== submitted.input.commandId) return;
        actions.accepted(submitted);
      } catch (e) { actions.rejected(e, submitted); throw e; }
      if (active.current !== workId || editor.current !== native || !base.current) return;
      if (base.current.revision > result.contentRevision || base.current.permission > result.permissionRevision) return;
      const latest = snapshot(native);
      const changedDuringSave = generation !== fence.current.generation || native.native.isEditing() || JSON.stringify(meaning(latest)) !== JSON.stringify(meaning(submittedArtifact));
      dirty.current = changedDuringSave; setDraft(changedDuringSave);
      const newBase: EditorState = { ...(changedDuringSave ? latest : submittedArtifact), revision: result.contentRevision, permission: result.permissionRevision, version: state.version };
      installEditor(newBase);
      const owned = recovery.current, key = `workagent-draft:${workId}`;
      if (owned?.workId === workId && localStorage.getItem(key) === owned.raw) {
        if (changedDuringSave) {
          const raw = JSON.stringify(newBase);
          localStorage.setItem(key, raw); recovery.current = { workId, raw };
        } else { localStorage.removeItem(key); recovery.current = null; }
      }
      setError('');
    };
    saveFlight.current = operation();
    try { await saveFlight.current; } finally { saveFlight.current = null; }
    receive(await api<Work>(`/work/${workId}`));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!prompt.trim() || busy) return; setBusy(true); setError(''); fence.current.request();
    const requestedWork = active.current, navigation = fence.current.navigation, sent = { ...composer.current };
    let submittedCommandId: string | undefined;
    try {
      composers.current.read(requestedWork);
      const retry = composers.current.pending(requestedWork);
      if (retry && JSON.stringify(retry.draft) !== JSON.stringify(sent)) throw new Error('unresolved_send');
      const native = editor.current, initialBase = base.current;
      let selection: SelectionContext | undefined;
      let captured: ReturnType<EditorHandle['selection']> | ReturnType<DocumentHandle['selection']> | undefined;
      let selectionEpoch: number | undefined;
      if (sent.selection && !retry && (sent.selection.kind === 'document') !== (native?.kind === 'document')) throw new Error('The selection belongs to a different artifact kind. Remove it and attach again.');
      if (sent.selection && !retry) {
        captured = native?.native.selection();
        selectionEpoch = native?.native.selectionEpoch();
        const { contentRevision, ...attached } = sent.selection;
        if (!captured || !initialBase || contentRevision !== initialBase.revision || requestedWork !== attached.workId || JSON.stringify(captured) !== JSON.stringify(attached)) throw new Error('The sheet or document selection changed. Attach the intended range again.');
      }
      // A retry owns already-captured context. It must neither recapture nor
      // autosave newer human edits before checking the original command.
      if (!retry) { await save(); if (hasDraft()) throw new Error('Please finish and save your latest edit before sending.'); }
      const sourceIds: string[] = [];
      if (active.current !== requestedWork || navigation !== fence.current.navigation) return;
      const current = workRef.current;
      if (captured) {
        if (editor.current !== native || base.current?.version !== initialBase?.version || current?.contentRevision !== base.current?.revision || native?.native.selectionEpoch() !== selectionEpoch || JSON.stringify(native?.native.selection()) !== JSON.stringify(captured)) throw new Error('The sheet or selection changed while saving. Attach the intended range again.');
        selection = 'kind' in captured && captured.kind === 'document'
          ? { kind: 'document', workId: captured.workId, documentId: captured.documentId, segmentId: '', startOffset: captured.startOffset, endOffset: captured.endOffset, contentRevision: base.current!.revision }
          : { ...captured, contentRevision: base.current!.revision };
      }
      const submission = composers.current.submission(requestedWork, sent, current?.intentRevision, uuid, selection); setPendingSend(true); setPendingPreview(submission);
      submittedCommandId = submission.commandId;
      if (sent.sourceText.trim()) { const source = await api<{ id: string }>('/sources', { commandId: submission.sourceCommandId, name: sent.sourceName, content: sent.sourceText, synthetic: true }); sourceIds.push(source.id); }
      if (active.current !== requestedWork || navigation !== fence.current.navigation || (!retry && hasDraft())) throw new Error('Your latest changes are kept. Return to this work to retry sending.');
      if (captured && (editor.current !== native || native?.native.selectionEpoch() !== selectionEpoch || JSON.stringify(native?.native.selection()) !== JSON.stringify(captured) || base.current?.revision !== selection?.contentRevision)) throw new Error('The sheet or selection changed. Your message is kept.');
      const result = await api<{ workId: string }>('/work/commands', { commandId: submission.commandId, kind: requestedWork ? 'continue' : 'start', ...(requestedWork ? { workId: requestedWork, expectedIntentRevision: submission.intentRevision } : {}), ...(submission.selection ? { selection: submission.selection } : {}), text: sent.prompt, sourceIds });
      composers.current.accepted(requestedWork, submission.commandId);
      const cleared = composers.current.clearIfUnchanged(requestedWork, sent);
      if (active.current === requestedWork && navigation === fence.current.navigation) {
        if (cleared || JSON.stringify(composer.current) === JSON.stringify(sent)) loadComposer(requestedWork);
        // Typing during admission remains on its original work; do not navigate away.
        if (cleared && await open(result.workId)) setView('sheet');
      }
      await list();
    } catch (e) {
      if (submittedCommandId !== undefined) composers.current.rejected(requestedWork, submittedCommandId, e);
      report(e);
    } finally { setBusy(false); pendingState(active.current); }
  }
  async function decide(proposal: Proposal, decision: string) {
    if (!work) return;
    await save();
    if (hasDraft() || active.current !== work.id) throw new Error('Finish saving your current edits before reviewing changes.');
    await api(`/work/${work.id}/proposals/${proposal.id}`, { commandId: uuid(), decision, expected: work.expected });
    receive(await api<Work>(`/work/${work.id}`));
  }
  async function viewSaved() {
    if (!active.current || !editor.current || !base.current || saveFlight.current) return;
    const key = active.current, ticket = fence.current.request();
    const saved = await api<Work>(`/work/${key}`);
    if (active.current !== key || !fence.current.current(ticket) || saveFlight.current || editor.current.native.isEditing()) {
      setError('Your latest edit is kept. Finish editing before opening the saved version.'); return;
    }
    // Only release the draft after the fetch succeeds and its recovery copy is durable.
    localStorage.setItem(`workagent-recovery:${key}:${Date.now()}`, JSON.stringify({ ...base.current, book: editor.current.native.save() }));
    const owned = recovery.current;
    if (owned?.workId === key && localStorage.getItem(`workagent-draft:${key}`) === owned.raw) localStorage.removeItem(`workagent-draft:${key}`);
    recovery.current = null;
    dirty.current = false; setDraft(false);
    installEditor({ ...content(saved), revision: saved.contentRevision, permission: saved.expected.permissionRevision, version: `${key}:reload:${uuid()}` });
    workRef.current = saved; setWork(saved); setError('The previous draft is retained on this device.');
  }
  function downloadDraft() {
    if (!editor.current) return;
    if (editor.current.native.isEditing()) { setError('Native input is still finishing. Retry downloading the draft after it finishes.'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(editor.current.native.save(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'workagent-draft.univer.json'; link.click(); URL.revokeObjectURL(url);
  }
  if (!authenticated) return <main className="sign-in"><div className="brand">Workagent</div><h1>Your work, together.</h1><p>Sign in to your private workspace.</p><form onSubmit={async e => { e.preventDefault(); try { await api('/session', { token }); setToken(''); setError(''); await list(); } catch (err) { report(err); } }}><label>Access key<input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="current-password" /></label><button>Sign in</button></form>{error && <p role="alert">{error}</p>}</main>;
  return <main className="app"><header><div className="brand">Workagent</div><select aria-label="Saved work" value={work?.id ?? ''} onChange={e => { if (e.target.value) open(e.target.value).catch(report); else newWork(); }}><option value="">New work</option>{works.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select><span className="private">Private workspace</span></header>
    {error && <div className="notice" role="alert">{error}{draft && <><button onClick={downloadDraft}>Download draft</button><button onClick={() => viewSaved().catch(report)}>Open saved version</button></>}</div>}
    <nav className="mobile-tabs"><button onClick={() => setView('chat')}>Conversation</button><button onClick={() => setView('sheet')}>Work area</button></nav>
    <div className={`layout view-${view}`}><section className="conversation" aria-label="Conversation"><div className="messages" aria-live="polite">{!work && <div className="welcome"><h1>What are we working on?</h1><p>Describe an outcome and add synthetic data. We’ll work through it in an editable sheet.</p></div>}{work?.messages.map(m => <article className={m.role} key={m.id}><small>{m.role === 'user' ? 'You' : 'Workagent'}</small><p>{m.text}</p>{m.selection?.kind === 'document' && <details><summary>Document passage · {m.selection.title} · revision {m.selection.contentRevision}</summary><p>Body offsets [{m.selection.startOffset}, {m.selection.endOffset}) (UTF-16). Context only.</p><pre className="selected-quote">{m.selection.quote}</pre></details>}</article>)}{work && ['queued', 'working', 'cancellation_requested'].includes(work.status) && <p className="progress">{work.status === 'cancellation_requested' ? 'Stopping…' : 'Working on your request…'}</p>}{work?.errorCode && <p className="notice">{friendly[work.errorCode] ?? 'This work needs attention before it can continue.'}</p>}
      {work?.proposals.filter(p => p.status === 'pending').map(p => <article className="proposal" key={p.id}><strong>Proposed changes</strong><p>{p.reason === 'human_edit' ? work.kind === 'document' ? 'This document includes your edits.' : 'These cells include your edits.' : 'The work or instructions changed while I was working.'}</p>{p.kind === 'document' && <><p>Title: {p.patch.document.title}</p><p>Whole-document proposal. Your saved document stays unchanged until acceptance. Native styles are included; the preview below shows text only.</p><pre className="document-preview">{p.patch.document.body?.dataStream}</pre></>}{p.patch.title && <p>Title: {p.patch.title}</p>}<ul>{(p.patch.cells ?? []).map((c, i) => <li key={i}>{work.book?.sheets[c.sheetId]?.name ?? c.sheetId}, row {c.row + 1}, column {c.column + 1}: <del>{String(work.book?.sheets[c.sheetId]?.cellData?.[c.row]?.[c.column]?.f ?? work.book?.sheets[c.sheetId]?.cellData?.[c.row]?.[c.column]?.v ?? '')}</del> → <strong>{String(c.formula ?? c.value ?? '(empty)')}</strong></li>)}</ul><button onClick={() => decide(p, 'accept').catch(report)}>Accept changes</button><button className="secondary" onClick={() => decide(p, 'reject').catch(report)}>Keep current</button></article>)}
      {work && work.kind !== 'document' && <MaintenancePanel key={work.id} work={work} api={api} beforeAction={async () => { if (hasDraft() || saveFlight.current) throw new Error('Save your sheet before changing maintenance.'); }} refresh={async () => { receive(await api<Work>(`/work/${work.id}`)); }} />}
      </div><form className="composer" onSubmit={submit}>{work && <div className="selection-context"><button type="button" disabled={busy} onPointerDown={e => e.preventDefault()} onClick={attachSelection}>{work.kind === 'document' ? 'Attach selected text' : 'Attach selected cells'}</button>{selectionView && <div>{selectionView.kind === 'document' ? <><p>Attached document: {selectionView.title} · body offsets [{selectionView.startOffset}, {selectionView.endOffset}) (UTF-16) · attached at revision {selectionView.contentRevision}. Current edits save on Send.</p><pre className="selected-quote">{selectionView.quote}</pre>{(selectionInvalid || selectionView.contentRevision !== editorState?.revision) && <p role="status">Document, selection or editor changed. Reattach selected text before a new send.</p>}<p>Context only. Requested edits use the existing whole-document proposal and acceptance flow.</p></> : <p>Attached: {selectionView.sheetName} · {selectionView.rangeLabel} · attached at revision {selectionView.contentRevision}. Current edits save on Send.</p>}<button type="button" disabled={busy} onClick={() => editComposer({ selection: undefined })}>Remove selection</button></div>}{pendingPreview && <details><summary>Unresolved send: original captured context retained</summary><p>Retry uses the original message and command, independently of the editable attachment above.</p>{pendingPreview.selection?.kind === 'document' && <><p>Document body [{pendingPreview.selection.startOffset}, {pendingPreview.selection.endOffset}) · saved revision {pendingPreview.selection.contentRevision}</p><pre className="selected-quote">{pendingPreview.draft.selection?.kind === 'document' ? pendingPreview.draft.selection.quote : ''}</pre></>}</details>}</div>}<details><summary>Add synthetic data</summary><input aria-label="Source name" value={sourceName} onChange={e => editComposer({ sourceName: e.target.value })} /><textarea aria-label="Source text" value={sourceText} onChange={e => editComposer({ sourceText: e.target.value })} placeholder="Paste synthetic notes, CSV or a brief" /><label className="file">Or choose a text/CSV file<input type="file" accept=".txt,.csv,.md" onChange={async e => { const f = e.target.files?.[0]; if (f) { if (f.size > 200000) { setError('Choose a text file under 200 KB.'); return; } const key = active.current, navigation = fence.current.navigation, before = composer.current; const content = await f.text(); if (active.current === key && navigation === fence.current.navigation && composer.current === before) editComposer({ sourceName: f.name, sourceText: content }); } }} /></label></details><label className="sr-only" htmlFor="prompt">Message Workagent</label><textarea id="prompt" value={prompt} onChange={e => editComposer({ prompt: e.target.value })} placeholder="Describe the outcome, or correct the direction…" /><div className="composer-actions"><span>Synthetic data only</span>{pendingSend && <button type="button" className="secondary" onClick={() => { const pending = composers.current.pending(active.current); if (pending) { editComposer(pending.draft); setError('The unresolved message is restored. Send checks the same command; it will not create a duplicate.'); } }}>Restore unresolved send</button>}{work && ['working', 'queued'].includes(work.status) && <button type="button" className="secondary" onClick={async () => { try { await api('/work/commands', { commandId: uuid(), kind: 'cancel', workId: work.id, expectedIntentRevision: work.intentRevision, sourceIds: [] }); } catch (e) { report(e); } }}>Stop</button>}<button disabled={busy || !prompt.trim()}>{busy ? 'Saving…' : 'Send'}</button></div></form></section>
    <section className="work-area" aria-label="Work area"><div className="blank-sheet"><label>New work name<input aria-label="New work name" value={blankTitle} maxLength={200} disabled={blankBusy || blankPending} onChange={e => setBlankTitle(e.target.value)} /></label><button type="button" disabled={blankBusy || !blankTitle.trim()} onClick={() => void createBlank()}>{blankPending ? 'Retry blank creation' : 'Create blank spreadsheet'}</button><button type="button" disabled={blankBusy || blankPending || !blankTitle.trim()} onClick={() => void createBlank('document')}>New document</button>{createdBlank && <span role="status">New work saved. <button type="button" onClick={() => { void open(createdBlank).then(opened => { if (opened) setView('sheet'); }).catch(report); }}>Open created work</button></span>}</div><DocumentExchange api={api} editor={() => editor.current?.kind === 'document' ? editor.current.native : null} work={work?.kind === 'document' ? work : null} onImported={list} onOpen={async id => { if (await open(id)) setView('sheet'); }} /><DocxExchange api={api} editor={() => editor.current?.kind === 'document' ? editor.current.native : null} work={work?.kind === 'document' ? work : null} onImported={list} onOpen={async id => { if (await open(id)) setView('sheet'); }} /><PdfExport api={api} editor={() => editor.current?.kind === 'document' ? editor.current.native : null} work={work?.kind === 'document' ? work : null} /><XlsxExchange api={api} editor={() => editor.current?.kind === 'sheet' ? editor.current.native : null} work={work?.kind === 'document' ? null : work} onImported={list} onOpen={async id => { if (await open(id)) setView('sheet'); }} /><CsvExchange api={api} editor={() => editor.current?.kind === 'sheet' ? editor.current.native : null} work={work?.kind === 'document' ? null : work} onImported={list} onOpen={async id => { if (await open(id)) setView('sheet'); }} />{editorState ? <><div className="sheet-heading"><div><strong>{editorState.kind === 'document' ? editorState.book.title : editorState.book.name}</strong><span>{draft ? 'Unsaved changes' : 'Saved'}</span></div><button onClick={() => save().catch(report)} disabled={!draft}>{work?.kind === 'document' ? 'Save document' : 'Save sheet'}</button></div>{editorState.kind === 'document' ? <DocumentEditor document={editorState.book} version={editorState.version} onReady={e => { if (base.current?.version === editorState.version) { editor.current = e ? { kind: 'document', native: e } : null; const attached = composer.current.selection; if (attached?.kind === 'document' && attached.editorId !== e?.editorId) setSelectionInvalid(true); } }} onSelectionChange={() => { if (base.current?.version === editorState.version && composer.current.selection?.kind === 'document') setSelectionInvalid(true); }} onEdit={d => { if (base.current?.version === editorState.version) edited(d); }} onError={report} /> : <NativeEditor book={editorState.book} version={editorState.version} onReady={e => { if (base.current?.version === editorState.version) editor.current = e ? { kind: 'sheet', native: e } : null; }} onEdit={d => { if (base.current?.version === editorState.version) edited(d); }} />}</> : <div className="empty-sheet"><span>Room to work</span><p>Your editable sheet or document will appear here.</p></div>}</section></div></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
