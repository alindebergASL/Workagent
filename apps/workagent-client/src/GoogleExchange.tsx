import { useEffect, useRef, useState } from 'react';
import type { IWorkbookData } from '@univerjs/core';
import type { DocumentHandle } from './DocumentEditor';
import type { Work } from './types';

type Api = <T>(path: string, input?: unknown) => Promise<T>;
type Connection = { generation: number; account: string | null };
type Receipt = { operationId: string; previewId: string; workId: string; account: string; title: string; stage: string; outcome: string; documentId?: string; code?: string; createdAt?: string; recordedAt?: string };
type Capability = { enabled: boolean; label: string; connection: Connection; accounts: { id: string; label: string; spreadsheetId: string }[]; receipts: Receipt[] };
type Preview = { previewId: string; kind: string; connectionGeneration: number; sourceHash: string; contentRevision: number; permissionRevision: number; account: string;
  book?: IWorkbookData; policy?: string; provenance: { spreadsheetId?: string; ranges?: string[] }; plan?: { title: string; text: string; digest: string; policy: string } };
type ActionContext = { principal: string; workId: string; generation: string; editorId?: string };
type Pending = { path: string; input: Record<string, unknown>; context: ActionContext; blocked?: boolean };
type Form = { version?: string; spreadsheetId: string; ranges: string; preview?: Preview; snapshot?: string; documentContext?: ActionContext; pending?: Pending; created?: string; receipt?: Receipt; receipts?: Receipt[]; message?: string };
const fresh = (): Form => ({ spreadsheetId: 'synthetic_sheet', ranges: "Inputs!A1:E2\nTeam's notes!A1:B2" });
const label = 'Simulated Google — local only';
const status = (r: Receipt) => r.outcome === 'verified' ? `Readback verified · ${r.title} · simulated document ${r.documentId}`
  : `${r.documentId ? `Partial document ${r.documentId}` : 'Delivery'} · ${r.outcome === 'unknown' ? 'unknown outcome' : r.outcome === 'refused' ? 'refused' : 'unresolved / not confirmed'} · ${r.stage}${r.code ? ` · ${r.code}` : ''}. Nothing will be automatically resent.`;
// Admission time orders new operations; legacy receipts retain their recorded
// time. Missing chronology must not bury an unresolved reservation behind success.
const receiptTime = (r: Receipt) => {
  const time = Date.parse(r.createdAt ?? r.recordedAt ?? '');
  return Number.isFinite(time) ? time : r.outcome === 'verified' ? 0 : Number.MAX_SAFE_INTEGER;
};
const receiptOrder = (a: Receipt, b: Receipt) => receiptTime(b) - receiptTime(a)
  || Number(a.outcome === 'verified') - Number(b.outcome === 'verified')
  // Identity only stabilizes presentation for ties; it does not establish time.
  || (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0);
// Cache every observed receipt in the existing principal/work form, independently
// of active selection. A fresh server observation replaces only that operation;
// a different successful action cannot resolve an earlier unknown action.
const retainReceipts = (form: Form, incoming: Receipt[], workId?: string) => [...new Map([
  ...(form.receipt ? [form.receipt] : []), ...(form.receipts ?? []), ...incoming,
].filter(r => r.workId === workId).map(r => [r.operationId, r])).values()].sort(receiptOrder);
const explanations: Record<string, string> = {
  google_plain_text_required: 'Delivery refused: this document has rich formatting, lists or page layout. Only plain text is supported; your native draft is kept.',
  google_unsupported_sheet: 'Sheets preview refused: formulas and cached results, formatting, merges, charts, controls or other unsupported content cannot be adopted. Your work is kept.',
  google_connection_changed: 'The simulated account disconnected or changed. Refresh the connection and preview again; nothing was automatically resent.',
  google_work_changed: 'Saved work or its permissions changed. Preview again; your native draft is kept.',
  google_forbidden: 'This simulated account cannot access that file with its current permissions.',
};
const message = (e: unknown) => e instanceof Error ? explanations[e.message] ?? e.message : 'Google simulation request failed.';

export function GoogleExchange({ api, work, principal, generation, editor, onNotice, onImported, onOpen }: {
  api: Api; work: Work | null; principal: string; generation: string; editor: () => DocumentHandle | null;
  onNotice?: (format: string, message: string) => void; onImported: () => Promise<void>; onOpen: (id: string) => Promise<unknown>;
}) {
  const [capability, setCapability] = useState<Capability | null>(null), [busy, setBusy] = useState(false), [, render] = useState(0);
  const forms = useRef<Record<string, Form>>({}), flight = useRef(false), alive = useRef(true), requests = useRef(0);
  const current = useRef({ principal, work, generation }); current.current = { principal, work, generation };
  const connection = useRef<Connection>({ generation: 0, account: null });
  const key = `workagent-google:${principal}:${work?.id ?? 'home'}`;
  const form = forms.current[key] ?? (() => {
    try { const raw = localStorage.getItem(key); return forms.current[key] = raw ? { ...fresh(), ...JSON.parse(raw) } : fresh(); }
    catch { return forms.current[key] = { ...fresh(), message: 'Local Google action state could not be read. Reload before a new action.' }; }
  })();
  const receipts = retainReceipts(form, [], work?.id);
  const unverified = receipts.filter(r => r.outcome !== 'verified');
  const notice = [form.message, form.pending ? 'Unresolved Google action retained. Check its receipt; nothing is automatically resent.' : '',
    unverified.length ? `Unverified Google actions (${unverified.length}): ${unverified.map(r => `Receipt ${r.operationId} (${r.title}): ${status(r)}`).join(' ')}` : ''].filter(Boolean).join(' ');
  function keep(next: Form, target = key) {
    const raw = localStorage.getItem(target), stored: Form | null = raw ? JSON.parse(raw) : null;
    if (stored?.version !== forms.current[target]?.version) throw new Error('Google action state changed in another tab. Reload to read current receipts. Your native draft is kept.');
    const saved = { ...next, version: crypto.randomUUID() };
    localStorage.setItem(target, JSON.stringify(saved)); forms.current[target] = saved; render(n => n + 1);
  }
  function report(e: unknown) { const next = { ...forms.current[key], message: message(e) }; try { keep(next); } catch { forms.current[key] = next; render(n => n + 1); } }
  useEffect(() => { alive.current = true; return () => { alive.current = false; requests.current++; }; }, []);
  useEffect(() => { onNotice?.('Google simulation', notice); }, [notice, onNotice]);
  const context = () => {
    const source = current.current, c = { ...connection.current }, ticket = requests.current;
    return { source, c, valid: () => alive.current && ticket === requests.current && current.current.principal === source.principal && current.current.generation === source.generation && current.current.work?.id === source.work?.id
      && current.current.work?.contentRevision === source.work?.contentRevision && current.current.work?.expected.permissionRevision === source.work?.expected.permissionRevision && connection.current.generation === c.generation };
  };
  async function refresh() {
    const ticket = ++requests.current, source = current.current;
    try {
      const result = await api<Capability>(`/exchange/google/state${source.work ? `?workId=${encodeURIComponent(source.work.id)}` : ''}`);
      if (!alive.current || ticket !== requests.current || current.current.principal !== source.principal || current.current.generation !== source.generation
        || current.current.work?.id !== source.work?.id || current.current.work?.contentRevision !== source.work?.contentRevision
        || current.current.work?.expected.permissionRevision !== source.work?.expected.permissionRevision) return;
      if (result.connection.generation < connection.current.generation) return;
      connection.current = result.connection; setCapability(result);
      const saved = forms.current[key], pending = saved.pending;
      const retained = retainReceipts(saved, result.receipts, source.work?.id);
      const settled = pending?.path.endsWith('doc-deliver') ? result.receipts.find(r => r.operationId === pending.input.operationId)
        ?? result.receipts.find(r => r.previewId === pending.input.previewId) : undefined;
      const latest = settled ?? result.receipts.find(r => r.operationId === saved.receipt?.operationId)
        ?? saved.receipt ?? [...result.receipts].sort(receiptOrder)[0];
      if (retained.length) keep({ ...saved, receipts: retained,
        ...(latest && (!pending || settled) ? { ...(settled ? { pending: undefined, ...(saved.preview?.previewId === settled.previewId ? { preview: undefined, snapshot: undefined, documentContext: undefined } : {}) } : {}), receipt: latest, message: status(latest) } : {}) });
      return result;
    } catch (e) { if (alive.current && ticket === requests.current) report(e); }
  }
  useEffect(() => { void refresh(); }, [principal, work?.id, generation]); // Read only. Never replay a pending command.
  async function run(action: () => Promise<unknown>) {
    if (flight.current) return;
    flight.current = true; setBusy(true);
    try { await action(); } catch (e) { if (alive.current) report(e); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  async function connect(account: string | null) {
    ++requests.current;
    const result = await api<Connection>('/exchange/google/connection', { commandId: crypto.randomUUID(), account, connectionGeneration: connection.current.generation });
    if (!alive.current) return;
    connection.current = result;
    setCapability(c => c && { ...c, connection: result });
    keep({ ...form, preview: undefined, snapshot: undefined, spreadsheetId: capability?.accounts.find(a => a.id === result.account)?.spreadsheetId ?? form.spreadsheetId,
      message: result.account ? `Connected ${capability?.accounts.find(a => a.id === result.account)?.label}. Local simulation only.` : 'Simulation disconnected. Earlier previews cannot be confirmed; receipts are retained.' });
  }
  const binding = () => {
    if (!work) throw new Error('Open or create native work first.');
    return { workId: work.id, contentRevision: work.contentRevision, permissionRevision: work.expected.permissionRevision, connectionGeneration: connection.current.generation };
  };
  async function previewSheet() {
    const c = context();
    const ranges = form.ranges.split('\n').filter(s => s.trim()).map(line => { const i = line.lastIndexOf('!'); if (i < 1) throw new Error('Enter one Tab!A1:B2 range per line.'); return { sheetTitle: line.slice(0, i), range: line.slice(i + 1) }; });
    const result = await api<Preview>('/exchange/google/sheet-preview', { ...binding(), spreadsheetId: form.spreadsheetId, ranges });
    if (!c.valid()) throw new Error('Work or connection changed. Request a new Google preview.');
    keep({ ...form, preview: result, snapshot: undefined, message: 'Sheets preview only. Confirm adoption separately; current work and edits are kept.' });
  }
  async function previewDoc() {
    const c = context(), native = editor();
    if (!native || work?.kind !== 'document') throw new Error('Open a native document first.');
    const snapshot = await native.commit(), epoch = native.contentEpoch();
    if (!c.valid() || editor() !== native || snapshot.id !== work.id || native.isEditing()) throw new Error('Document changed. Preview again.');
    const result = await api<Preview>('/exchange/google/doc-preview', { ...binding(), document: snapshot });
    if (!c.valid() || editor() !== native || native.isEditing() || native.contentEpoch() !== epoch || JSON.stringify(native.save()) !== JSON.stringify(snapshot)) throw new Error('Document changed during preview. Preview again.');
    keep({ ...form, preview: result, snapshot: JSON.stringify(snapshot), documentContext: { principal, workId: work.id, generation, editorId: native.editorId }, message: 'Plain-text delivery preview only. Nothing saved or sent. Review the exact title and text before confirming.' });
  }
  async function validateDispatch(pending: Pending, c: ReturnType<typeof context>) {
    const saved = forms.current[key], p = saved.preview, bound = pending.context;
    if (!p || !bound || pending.input.previewId !== p.previewId || pending.input.sourceHash !== p.sourceHash
      || bound.principal !== c.source.principal || bound.workId !== c.source.work?.id || bound.generation !== c.source.generation
      || p.connectionGeneration !== c.c.generation || p.account !== c.c.account
      || p.contentRevision !== c.source.work?.contentRevision || p.permissionRevision !== c.source.work?.expected.permissionRevision)
      throw new Error('Preview or action context is stale. Request a new preview and confirm again.');
    if (p.plan) {
      const native = editor();
      if (!native || !bound.editorId || native.editorId !== bound.editorId) throw new Error('Document editor changed. Preview again before delivery.');
      const snapshot = await native.commit();
      if (!c.valid() || editor() !== native || native.isEditing() || snapshot.id !== c.source.work?.id
        || JSON.stringify(snapshot) !== saved.snapshot || JSON.stringify(native.save()) !== saved.snapshot)
        throw new Error('Document changed after preview. Preview again before delivery.');
    }
    if (!c.valid()) throw new Error('Work or connection changed. Request a new preview.');
  }
  async function confirm() {
    const p = form.preview;
    if (!p) throw new Error('Request a new preview.');
    if (form.pending?.input.previewId === p.previewId) throw new Error('Use the retained action or request a new preview.');
    const bound = { principal, workId: work!.id, generation };
    const pending: Pending = p.plan
      ? { path: '/exchange/google/doc-deliver', context: form.documentContext!, input: { operationId: crypto.randomUUID(), previewId: p.previewId, sourceHash: p.sourceHash, digest: p.plan.digest, connectionGeneration: p.connectionGeneration } }
      : { path: '/exchange/google/sheet-adopt', context: bound, input: { commandId: crypto.randomUUID(), previewId: p.previewId, sourceHash: p.sourceHash, connectionGeneration: p.connectionGeneration } };
    await submit(pending);
  }
  async function retry() {
    // Receipt recovery is GET-only, including when the native draft has changed.
    // Only an action absent from the journal may reach the dispatch fence below.
    const pending = forms.current[key].pending;
    if (!pending || !await refresh()) return;
    if (forms.current[key].pending !== pending) return;
    try { await submit(pending); }
    catch (e) {
      if (forms.current[key].pending === pending) keep({ ...forms.current[key], pending: { ...pending, blocked: true } });
      throw e;
    }
  }
  async function submit(pending: Pending) {
    const c = context();
    await validateDispatch(pending, c);
    keep({ ...forms.current[key], pending, message: 'Confirmation submitted. If interrupted, check the retained action; it will not automatically run again.' });
    const result = await api<Receipt & { workId: string }>(pending.path, pending.input);
    if (!c.valid()) return; // Receipt reads remain available even when this context is stale.
    const latest = forms.current[key];
    if (pending.path.endsWith('sheet-adopt')) {
      keep({ ...latest, pending: undefined, preview: undefined, created: result.workId, message: 'Adopted as separate native work. Open it when ready; current drafts and messages are kept.' });
      await onImported();
    } else keep({ ...latest, pending: undefined, preview: undefined, snapshot: undefined, documentContext: undefined,
      receipts: retainReceipts(latest, [result], c.source.work?.id), receipt: result, message: status(result) });
  }
  const connected = capability?.enabled && capability.connection.account;
  return <div className="google-exchange"><details className="document-exchange"><summary>{label}</summary>
    {!capability ? <p>Checking simulation availability…</p> : !capability.enabled ? <p>Local Google simulation is off.</p> : <>
      <p>Synthetic accounts and files only. Remote files reset when the service restarts; app receipts remain. Real Google / OAuth is not connected.</p>
      <label>Simulated account<select aria-label="Simulated Google account" disabled={busy} value={capability.connection.account ?? ''} onChange={e => void run(() => connect(e.target.value || null))}>
        <option value="">Disconnected</option>{capability.accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
      {connected && <button type="button" disabled={busy} onClick={() => void run(() => connect(null))}>Disconnect simulation</button>}
      {!work && <p>Open or create native work to import a sheet or deliver a document.</p>}
      {connected && work && <>
        <label>Simulated spreadsheet ID<input aria-label="Simulated spreadsheet ID" disabled={busy || !!form.pending} value={form.spreadsheetId} onChange={e => keep({ ...form, spreadsheetId: e.target.value, preview: undefined })} /></label>
        <label>Tab ranges (one Tab!A1:B2 per line)<textarea aria-label="Google sheet ranges" disabled={busy || !!form.pending} value={form.ranges} onChange={e => keep({ ...form, ranges: e.target.value, preview: undefined })} /></label>
        <button type="button" disabled={busy || !!form.pending} onClick={() => void run(previewSheet)}>Preview simulated Sheets</button>
        {work.kind === 'document' && <button type="button" disabled={busy || (!!form.pending && !form.pending.blocked)} onClick={() => void run(previewDoc)}>Preview plain-text Google Doc</button>}
      </>}
      {form.preview && <div className="google-preview"><p>{label} · {form.preview.account}</p>
        {form.preview.plan ? <><strong>{form.preview.plan.title}</strong><pre className="document-preview">{form.preview.plan.text}</pre><p>{form.preview.plan.policy}</p></>
          : <><strong>{form.preview.book?.name}</strong><p>{form.preview.provenance.spreadsheetId} · {form.preview.provenance.ranges?.join(', ')}</p><p>{form.preview.policy}</p>
            {form.preview.book?.sheetOrder.map(sid => { const sheet = form.preview!.book!.sheets[sid]; return <details key={sid}><summary>{sheet.name} · typed cells at original coordinates</summary><pre className="document-preview">{JSON.stringify(sheet.cellData, null, 2)}</pre></details>; })}</>}
        <button type="button" disabled={busy || (!!form.pending && (!form.pending.blocked || form.pending.input.previewId === form.preview.previewId)) || !connected} onClick={() => void run(confirm)}>{form.preview.plan ? 'Confirm simulated Google Doc delivery' : 'Adopt preview as new native work'}</button>
      </div>}
      {form.pending && <button type="button" disabled={busy} onClick={() => void run(retry)}>Check / retry exact Google action</button>}
      <button type="button" disabled={busy} onClick={() => void run(refresh)}>Refresh connection and receipts</button>
      {form.created && <button type="button" onClick={() => void run(async () => { await onOpen(form.created!); })}>Open adopted Google sheet</button>}
      {receipts.length > 0 && <details><summary>Saved simulation receipts ({receipts.length})</summary>{receipts.map(r => <p key={r.operationId}>{status(r)}</p>)}</details>}
      {form.receipt && <p>Receipt {form.receipt.operationId}: {status(form.receipt)}</p>}
    </>}
    </details>{notice && <p className="work-action-notice" role="status">{notice}</p>}
  </div>;
}
