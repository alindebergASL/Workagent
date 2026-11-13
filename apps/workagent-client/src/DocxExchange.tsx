import { useEffect, useRef, useState } from 'react';
import { validateDocument } from '../../../packages/workagent-contract/document.mjs';
const DOCX_LIMIT = 2_000_000;
const DOCX_POLICY = 'Word exchange supports literal text paragraphs, Unicode, bold, italic, single underline, font size, RGB colour, simple alignment and one page geometry. Tables, images, hyperlinks, fields, tracked changes, headers/footers, notes, objects, macros, lists and multiple sections are refused. Metadata, themes, style names, other formatting and advanced layout are not preserved; fonts and pagination may differ. Page measurements round to Word twips; font sizes must be half-point values. Original bytes remain downloadable. Export includes the current native edits without saving to the server.';
import { MaintenanceActions, type Pending } from './maintenance-actions';
import type { DocumentHandle } from './DocumentEditor';
import type { Work } from './types';
type Preview = { filename: string; bytes: number; sample: string; clipped: boolean; paragraphs: number; warnings: string[] };
type Upload = { filename: string; base64: string; synthetic: true };
type Api = <T>(path: string, input?: unknown) => Promise<T>;
export function DocxExchange({ api, editor, work, onImported, onOpen }: { api: Api; editor: () => DocumentHandle | null; work: Extract<Work, { kind: 'document' }> | null; onImported: () => Promise<void>; onOpen: (id: string) => Promise<unknown> }) {
  const actions = useRef(new MaintenanceActions(localStorage, 'docx-import'));
  const [preview, setPreview] = useState<Preview | null>(null), [upload, setUpload] = useState<Upload | null>(null);
  const [pending, setPending] = useState<Pending | null>(() => actions.current.read());
  const attempt = useRef(pending);
  const [message, setMessage] = useState(''), [created, setCreated] = useState<string | null>(() => localStorage.getItem('workagent-docx:created')), [busy, setBusy] = useState(false);
  const alive = useRef(true), sequence = useRef(0), flight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const report = (e: unknown) => setMessage(e instanceof Error && /docx_sandbox/.test(e.message) ? 'Isolated Word conversion is unavailable. No file was adopted. Retry when the service is available.' : e instanceof Error ? e.message : 'Word / DOCX operation failed.');
  async function choose(file?: File) {
    if (!file || flight.current || attempt.current || actions.current.read()) return;
    const ticket = ++sequence.current; setPreview(null); setUpload(null); setMessage(''); setCreated(null);
    try {
      if (file.size > DOCX_LIMIT) throw new Error('Choose a Word .docx file no larger than 2,000,000 bytes.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const input: Upload = { filename: file.name, base64: btoa(binary), synthetic: true };
      const result = await api<Preview>('/exchange/docx/preview', input);
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
        if (!upload || !preview) throw new Error('Preview a Word / DOCX file first.');
        submitted = actions.current.prepare('import', '/exchange/docx/import', upload, () => crypto.randomUUID());
      }
      attempt.current = submitted; setPending(submitted); // Durable exact request precedes network dispatch.
      const result = await api<{ workId: string }>(submitted.path, submitted.input);
      const current = actions.current.read();
      const matches = !current || current.input.commandId === submitted.input.commandId;
      if (alive.current && matches) localStorage.setItem('workagent-docx:created', result.workId);
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
      validateDocument(saved);
      if (!alive.current || editor() !== native) throw new Error('The editor changed. Retry from the current document.');
      const result = await api<{ base64: string; filename: string; warnings: string[] }>('/exchange/docx/export', { workId: saved.id, document: saved });
      if (!alive.current || editor() !== native) throw new Error('The editor changed. Retry from the current document.');
      const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Exported current native document as Word. No server save. ' + result.warnings.join(' '));
    } catch (e) { if (alive.current) report(e); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  return <details className="document-exchange"><summary>Import / export Word / DOCX</summary>
    <p>{DOCX_POLICY}</p><p>Up to 2 MB compressed, 20 MB inflated, 5 MB per part, 256 parts, 200 KB text and 10,000 paragraphs/runs. Synthetic data only.</p>
    <label>Preview Word / DOCX file<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy || !!pending} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} /></label>
    {preview && <div><p>{preview.filename}: {preview.bytes} bytes · {preview.paragraphs} paragraphs. {preview.clipped ? 'Preview clipped to 4,000 characters; full text is imported.' : ''}</p><ul>{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul><pre className="document-preview">{preview.sample}</pre></div>}
    {(preview || pending) && <button type="button" disabled={busy} onClick={() => void importFile()}>{pending ? 'Retry unresolved Word / DOCX import' : 'Import as new work'}</button>}
    {pending && <p>The exact original upload is retained on this device until its acknowledgement is known.</p>}
    {created && <button type="button" onClick={() => onOpen(created).catch(report)}>Open imported Word document</button>}
    {work && <><button type="button" disabled={busy} onClick={() => void exportFile()}>Export document Word (.docx)</button>{work.original && <p><a href={`/api/work/${work.id}/original/${work.original.id}`} download>Download original: {work.original.filename}</a> · {work.original.size} bytes · {work.original.encoding}<br /><small>SHA-256: {work.original.hash}</small></p>}</>}
    {message && <p role="status">{message}</p>}
  </details>;
}
