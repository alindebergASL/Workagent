import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeEditor, type EditorHandle } from './NativeEditor';
import type { Work, Proposal } from './types';
import type { IWorkbookData } from '@univerjs/core';
import { DraftFence } from './drafts';
import './style.css';
const uuid = () => crypto.randomUUID();
async function api<T>(path: string, input?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', method: method ?? (input ? 'POST' : 'GET'), ...(input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
const friendly: Record<string, string> = { save_conflict: 'The saved sheet changed while you were editing. Your draft is kept. Download it before opening the saved version.', proposal_conflict: 'This proposal is out of date. Ask the agent to review the current sheet.', access_denied: 'Please sign in to your private workspace.', accounting_bridge_not_connected: 'Model access is waiting for the accounting connection. You can still edit and save your sheet.', openrouter_not_configured: 'Model access is not configured yet.', execution_interrupted_check_receipt: 'Work was interrupted. Your saved sheet is safe. The operator must check any uncertain model request before retrying.' };
function App() {
  const [authenticated, setAuthenticated] = useState(false), [token, setToken] = useState(''), [error, setError] = useState('');
  const [works, setWorks] = useState<{ id: string; title: string; status: string }[]>([]), [work, setWork] = useState<Work | null>(null);
  const [editorState, setEditorState] = useState<{ book: IWorkbookData; revision: number; permission: number; version: string } | null>(null);
  const [draft, setDraft] = useState(false), [prompt, setPrompt] = useState(''), [sourceText, setSourceText] = useState(''), [sourceName, setSourceName] = useState('Pasted data'), [busy, setBusy] = useState(false);
  const [view, setView] = useState<'chat' | 'sheet'>('chat');
  const fence = useRef(new DraftFence());
  const saveFlight = useRef<Promise<void> | null>(null);
  const editor = useRef<EditorHandle | null>(null), dirty = useRef(false), active = useRef<string | null>(null), base = useRef(editorState), workRef = useRef(work);
  function installEditor(next: typeof editorState) { base.current = next; setEditorState(next); }
  const hasDraft = () => dirty.current || !!editor.current?.isEditing();
  const report = (e: unknown) => setError(e instanceof Error ? friendly[e.message] ?? e.message : 'Unable to save this change.');
  const list = useCallback(async () => { setWorks(await api('/work')); setAuthenticated(true); }, []);
  const receive = useCallback((w: Work) => {
    if (active.current !== w.id) return;
    const current = workRef.current;
    const savedRevision = base.current?.book.id === w.id ? base.current.revision : 0;
    if (w.contentRevision < savedRevision || (current?.id === w.id && (w.contentRevision < current.contentRevision || w.intentRevision < current.intentRevision))) return;
    workRef.current = w; setWork(w);
    if (!dirty.current && !editor.current?.isEditing() && !saveFlight.current && !(base.current?.book.id === w.id && base.current.revision === w.contentRevision)) {
      const next = { book: w.book, revision: w.contentRevision, permission: w.expected.permissionRevision, version: `${w.id}:${w.contentRevision}` };
      base.current = next; setEditorState(next);
    }
  }, []);
  useEffect(() => { list().catch(() => {}); }, [list]);
  useEffect(() => {
    const timer = setInterval(() => { const current = active.current; if (current) api<Work>(`/work/${current}`).then(w => { if (active.current === current) receive(w); }).catch(report); }, 1800);
    return () => clearInterval(timer);
  }, [receive]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty.current || editor.current?.isEditing()) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
  async function open(workId: string) {
    if (hasDraft() || saveFlight.current) { setError('Save your current sheet before switching work.'); return; }
    const ticket = fence.current.request();
    const w = await api<Work>(`/work/${workId}`);
    if (!fence.current.current(ticket) || hasDraft() || saveFlight.current) return;
    active.current = workId; receive(w); setError('');
    const saved = localStorage.getItem(`workagent-draft:${workId}`);
    if (saved) {
      try {
        const d = JSON.parse(saved); if (d.book?.id !== workId || !Number.isInteger(d.revision) || !Number.isInteger(d.permission)) throw new Error('invalid_draft'); dirty.current = true; setDraft(true);
        installEditor({ book: d.book, revision: d.revision, permission: d.permission, version: `${w.id}:draft:${uuid()}` });
        if (d.revision !== w.contentRevision) setError(friendly.save_conflict);
      } catch { setError('A local draft could not be opened. The saved server version is available.'); }
    }
  }
  function edited(book: IWorkbookData) {
    if (!active.current || !base.current || book.id !== active.current) return;
    fence.current.edit(); dirty.current = true; setDraft(true);
    try { localStorage.setItem(`workagent-draft:${active.current}`, JSON.stringify({ book, revision: base.current.revision, permission: base.current.permission })); }
    catch { setError('Local draft storage is full. Save your sheet to keep these changes.'); }
  }
  async function save() {
    if (saveFlight.current) return saveFlight.current;
    if (!active.current || !base.current || !editor.current) return;
    const workId = active.current, native = editor.current, state = base.current;
    const operation = async () => {
      const book = await native.commit();
      if (!dirty.current) return;
      const generation = fence.current.generation;
      const result = await api<{ contentRevision: number; permissionRevision: number }>(`/work/${workId}/save`, { commandId: uuid(), book, contentRevision: state.revision, permissionRevision: state.permission });
      if (active.current !== workId) return;
      const changedDuringSave = generation !== fence.current.generation || native.isEditing();
      dirty.current = changedDuringSave; setDraft(changedDuringSave);
      const newBase = { book: changedDuringSave ? native.save() : book, revision: result.contentRevision, permission: result.permissionRevision, version: state.version };
      installEditor(newBase);
      if (changedDuringSave) localStorage.setItem(`workagent-draft:${workId}`, JSON.stringify(newBase));
      else localStorage.removeItem(`workagent-draft:${workId}`);
      setError('');
    };
    saveFlight.current = operation();
    try { await saveFlight.current; } finally { saveFlight.current = null; }
    receive(await api<Work>(`/work/${workId}`));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!prompt.trim() || busy) return; setBusy(true); setError(''); fence.current.request();
    const requestedWork = active.current;
    try {
      await save(); if (hasDraft()) throw new Error('Please finish and save your latest edit before sending.'); const sourceIds: string[] = [];
      if (sourceText.trim()) { const source = await api<{ id: string }>('/sources', { commandId: uuid(), name: sourceName, content: sourceText, synthetic: true }); sourceIds.push(source.id); }
      if (active.current !== requestedWork || hasDraft()) throw new Error('Your latest changes are kept. Save them before sending.');
      const current = workRef.current;
      const result = await api<{ workId: string }>('/work/commands', { commandId: uuid(), kind: current ? 'continue' : 'start', ...(current ? { workId: current.id, expectedIntentRevision: current.intentRevision } : {}), text: prompt, sourceIds });
      setPrompt(''); setSourceText(''); await open(result.workId); await list(); setView('sheet');
    } catch (e) { report(e); } finally { setBusy(false); }
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
    if (active.current !== key || !fence.current.current(ticket) || saveFlight.current || editor.current.isEditing()) {
      setError('Your latest edit is kept. Finish editing before opening the saved version.'); return;
    }
    // Only release the draft after the fetch succeeds and its recovery copy is durable.
    localStorage.setItem(`workagent-recovery:${key}:${Date.now()}`, JSON.stringify({ ...base.current, book: editor.current.save() }));
    localStorage.removeItem(`workagent-draft:${key}`);
    dirty.current = false; setDraft(false);
    installEditor({ book: saved.book, revision: saved.contentRevision, permission: saved.expected.permissionRevision, version: `${key}:reload:${uuid()}` });
    workRef.current = saved; setWork(saved); setError('The previous draft is retained on this device.');
  }
  function downloadDraft() {
    if (!editor.current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(editor.current.save(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'workagent-draft.univer.json'; link.click(); URL.revokeObjectURL(url);
  }
  if (!authenticated) return <main className="sign-in"><div className="brand">Workagent</div><h1>Your work, together.</h1><p>Sign in to your private workspace.</p><form onSubmit={async e => { e.preventDefault(); try { await api('/session', { token }); setToken(''); setError(''); await list(); } catch (err) { report(err); } }}><label>Access key<input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="current-password" /></label><button>Sign in</button></form>{error && <p role="alert">{error}</p>}</main>;
  return <main className="app"><header><div className="brand">Workagent</div><select disabled={busy} aria-label="Saved work" value={work?.id ?? ''} onChange={e => { if (e.target.value) open(e.target.value).catch(report); else if (!hasDraft() && !saveFlight.current) { fence.current.request(); active.current = null; workRef.current = null; setWork(null); installEditor(null); } else setError('Save your current sheet before switching work.'); }}><option value="">New work</option>{works.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select><span className="private">Private workspace</span></header>
    {error && <div className="notice" role="alert">{error}{draft && <><button onClick={downloadDraft}>Download draft</button><button onClick={() => viewSaved().catch(report)}>Open saved version</button></>}</div>}
    <nav className="mobile-tabs"><button onClick={() => setView('chat')}>Conversation</button><button onClick={() => setView('sheet')}>Sheet</button></nav>
    <div className={`layout view-${view}`}><section className="conversation" aria-label="Conversation"><div className="messages" aria-live="polite">{!work && <div className="welcome"><h1>What are we working on?</h1><p>Describe an outcome and add synthetic data. We’ll work through it in an editable sheet.</p></div>}{work?.messages.map(m => <article className={m.role} key={m.id}><small>{m.role === 'user' ? 'You' : 'Workagent'}</small><p>{m.text}</p></article>)}{work && ['queued', 'working', 'cancellation_requested'].includes(work.status) && <p className="progress">{work.status === 'cancellation_requested' ? 'Stopping…' : 'Working on your request…'}</p>}{work?.errorCode && <p className="notice">{friendly[work.errorCode] ?? 'This work needs attention before it can continue.'}</p>}
      {work?.proposals.filter(p => p.status === 'pending').map(p => <article className="proposal" key={p.id}><strong>Proposed changes</strong><p>{p.reason === 'human_edit' ? 'These cells include your edits.' : 'The sheet or instructions changed while I was working.'}</p>{p.patch.title && <p>Title: {p.patch.title}</p>}<ul>{p.patch.cells.map((c, i) => <li key={i}>{work.book.sheets[c.sheetId]?.name ?? c.sheetId}, row {c.row + 1}, column {c.column + 1}: <del>{String(work.book.sheets[c.sheetId]?.cellData?.[c.row]?.[c.column]?.f ?? work.book.sheets[c.sheetId]?.cellData?.[c.row]?.[c.column]?.v ?? '')}</del> → <strong>{String(c.formula ?? c.value ?? '(empty)')}</strong></li>)}</ul><button onClick={() => decide(p, 'accept').catch(report)}>Accept changes</button><button className="secondary" onClick={() => decide(p, 'reject').catch(report)}>Keep current</button></article>)}
      </div><form className="composer" onSubmit={submit}><details><summary>Add synthetic data</summary><input aria-label="Source name" value={sourceName} onChange={e => setSourceName(e.target.value)} /><textarea aria-label="Source text" value={sourceText} onChange={e => setSourceText(e.target.value)} placeholder="Paste synthetic notes, CSV or a brief" /><label className="file">Or choose a text/CSV file<input type="file" accept=".txt,.csv,.md" onChange={async e => { const f = e.target.files?.[0]; if (f) { if (f.size > 200000) { setError('Choose a text file under 200 KB.'); return; } setSourceName(f.name); setSourceText(await f.text()); } }} /></label></details><label className="sr-only" htmlFor="prompt">Message Workagent</label><textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Describe the outcome, or correct the direction…" /><div className="composer-actions"><span>Synthetic data only</span>{work && ['working', 'queued'].includes(work.status) && <button type="button" className="secondary" onClick={async () => { try { await api('/work/commands', { commandId: uuid(), kind: 'cancel', workId: work.id, expectedIntentRevision: work.intentRevision, sourceIds: [] }); } catch (e) { report(e); } }}>Stop</button>}<button disabled={busy || !prompt.trim()}>{busy ? 'Saving…' : 'Send'}</button></div></form></section>
    <section className="work-area" aria-label="Work area">{editorState ? <><div className="sheet-heading"><div><strong>{editorState.book.name}</strong><span>{draft ? 'Unsaved changes' : 'Saved'}</span></div><button onClick={() => save().catch(report)} disabled={!draft}>Save sheet</button></div><NativeEditor book={editorState.book} version={editorState.version} onReady={e => { editor.current = e; }} onEdit={edited} /></> : <div className="empty-sheet"><span>Room to work</span><p>Your editable sheet will appear here.</p></div>}</section></div></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
