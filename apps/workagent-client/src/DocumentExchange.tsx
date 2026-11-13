import { useEffect, useRef, useState } from 'react';
import { DOCUMENT_LIMIT, DOCUMENT_POLICY, documentText } from '../../../packages/workagent-contract/document.mjs';
import { MaintenanceActions, type Pending } from './maintenance-actions';
import type { DocumentHandle } from './DocumentEditor';
import type { Work } from './types';
type Preview = { filename: string; bytes: number; encoding: string; sample: string; clipped: boolean };
type Upload = { filename: string; base64: string; synthetic: true };
type Api = <T>(path: string, input?: unknown) => Promise<T>;
export function DocumentExchange({ api, editor, work, onImported, onOpen }: { api: Api; editor: () => DocumentHandle | null; work: Extract<Work, { kind: 'document' }> | null; onImported: () => Promise<void>; onOpen: (id: string) => Promise<unknown> }) {
  const actions = useRef(new MaintenanceActions(localStorage, 'document-import'));
  const [preview, setPreview] = useState<Preview | null>(null), [upload, setUpload] = useState<Upload | null>(null);
  const [pending, setPending] = useState<Pending | null>(() => actions.current.read());
  const attempt = useRef(pending);
  const [message, setMessage] = useState(''), [created, setCreated] = useState<string | null>(() => localStorage.getItem('workagent-document:created')), [busy, setBusy] = useState(false);
  const alive = useRef(true), sequence = useRef(0), flight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const report = (e: unknown) => setMessage(e instanceof Error ? e.message : 'Markdown / text operation failed.');
  async function choose(file?: File) {
    if (!file || flight.current || attempt.current || actions.current.read()) return;
    const ticket = ++sequence.current; setPreview(null); setUpload(null); setMessage(''); setCreated(null);
    try {
      if (file.size > DOCUMENT_LIMIT) throw new Error('Choose a UTF-8 Markdown / text file no larger than 200,000 bytes.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const input: Upload = { filename: file.name, base64: btoa(binary), synthetic: true };
      const result = await api<Preview>('/exchange/document/preview', input);
      if (!alive.current || sequence.current !== ticket) return;
      setUpload(input); setPreview(result);
    } catch (e) { if (alive.current && sequence.current === ticket) report(e); }
  }
  async function importFile() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setMessage('');
    let submitted: Pending | null = null;
    try {
      // Keep the displayed attempt when a second consumer clears shared storage.
      submitted = attempt.current ?? actions.current.read();
      if (!submitted) {
        if (!upload || !preview) throw new Error('Preview a Markdown / text file first.');
        submitted = actions.current.prepare('import', '/exchange/document/import', upload, () => crypto.randomUUID());
      }
      attempt.current = submitted; setPending(submitted); // Durable exact request precedes network dispatch.
      const result = await api<{ workId: string }>(submitted.path, submitted.input);
      const current = actions.current.read();
      const matches = !current || current.input.commandId === submitted.input.commandId;
      if (alive.current && matches) localStorage.setItem('workagent-document:created', result.workId);
      actions.current.accepted(submitted);
      attempt.current = null;
      if (alive.current && matches) { setCreated(result.workId); setUpload(null); setPreview(null); setMessage('Imported as separate saved work. Open it when you are ready; current edits and messages are kept.'); await onImported(); }
    } catch (e) {
      const matches = !submitted || attempt.current?.input.commandId === submitted.input.commandId;
      if (submitted && actions.current.rejected(e, submitted)) attempt.current = null;
      if (alive.current && matches) report(e);
    } finally { flight.current = false; if (alive.current) { attempt.current ??= actions.current.read(); setPending(attempt.current); setBusy(false); } }
  }
  async function exportFile() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setMessage('');
    const native = editor();
    try {
      if (!native) throw new Error('Open a document first.');
      const saved = await native.commit();
      const result = documentText(saved);
      if (!alive.current || editor() !== native) throw new Error('The editor changed. Retry from the current document.');
      const url = URL.createObjectURL(new Blob([result], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = (saved.title ?? 'Document').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') + '.md'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Exported current edited text as Markdown source. Native formatting and page layout are omitted. Export includes pending native edits and does not save to the server.');
    } catch (e) { if (alive.current) report(e); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  return <details className="document-exchange"><summary>Import / export Markdown / text</summary>
    <p>{DOCUMENT_POLICY}</p><p>Up to 200 KB and 10,000 paragraphs. Synthetic data only.</p>
    <label>Preview Markdown / text file<input type="file" accept=".md,.txt,text/plain,text/markdown" disabled={busy || !!pending} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} /></label>
    {preview && <div><p>{preview.filename}: {preview.bytes} bytes · UTF-8. {preview.clipped ? 'Preview clipped to 4,000 characters; full text is imported.' : ''}</p><pre className="document-preview">{preview.sample}</pre></div>}
    {(preview || pending) && <button type="button" disabled={busy} onClick={() => void importFile()}>{pending ? 'Retry unresolved Markdown / text import' : 'Import as new work'}</button>}
    {pending && <p>The exact original upload is retained on this device until its acknowledgement is known.</p>}
    {created && <button type="button" onClick={() => onOpen(created).catch(report)}>Open imported document</button>}
    {work && <><button type="button" disabled={busy} onClick={() => void exportFile()}>Export document Markdown source</button>{work.original && <p><a href={`/api/work/${work.id}/original/${work.original.id}`} download>Download original: {work.original.filename}</a> · {work.original.size} bytes · {work.original.encoding}<br /><small>SHA-256: {work.original.hash}</small></p>}</>}
    {message && <p role="status">{message}</p>}
  </details>;
}
