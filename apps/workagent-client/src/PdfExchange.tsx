import { useEffect, useRef, useState } from 'react';
import { PdfExport } from './PdfExport';
import { pdfUpload } from './pdf-import-storage';
const PDF_LIMIT = 16_000_000;
const PDF_POLICY = 'Import only the PDF text layer as a new editable document. No OCR, images, attachments, styles, semantic lists, tables or layout fidelity. Text inside images is omitted even on pages that also have a text layer; image text is not extracted. Number labels remain literal text. Reading order can be wrong, especially in multiple columns; PDF character mappings may be missing or incorrect. Each extracted line becomes a paragraph; one terminal line ending per page is removed, and pages are separated by a blank paragraph. Other whitespace and Unicode are retained without normalization. No paragraph or hyphenation reconstruction. Review the sample and original before adopting. Original bytes remain downloadable.';
import { MaintenanceActions, type Pending } from './maintenance-actions';
import type { DocumentHandle } from './DocumentEditor';
import type { Work } from './types';
type Preview = { filename: string; bytes: number; sample: string; clipped: boolean; paragraphs: number; pages: number; previewHash: string; warnings: string[] };
type Upload = { filename: string; base64: string; synthetic: true; previewHash?: string };
type Api = <T>(path: string, input?: unknown) => Promise<T>;
export function PdfExchange({ api, editor, work, onImported, onOpen }: { api: Api; editor: () => DocumentHandle | null; work: Extract<Work, { kind: 'document' }> | null; onImported: () => Promise<void>; onOpen: (id: string) => Promise<unknown> }) {
  const actions = useRef(new MaintenanceActions(localStorage, 'pdf-import'));
  const [preview, setPreview] = useState<Preview | null>(null), [upload, setUpload] = useState<Upload | null>(null);
  const [pending, setPending] = useState<Pending | null>(() => actions.current.read());
  const attempt = useRef(pending);
  const [message, setMessage] = useState(''), [created, setCreated] = useState<string | null>(() => localStorage.getItem('workagent-pdf:created')), [busy, setBusy] = useState(false);
  const alive = useRef(true), sequence = useRef(0), flight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const report = (e: unknown) => setMessage(e instanceof Error && /pdf_.*unavailable/.test(e.message) ? 'Isolated PDF conversion is unavailable. Retry when the service is available.' : e instanceof Error && e.message === 'pdf_page_without_text' ? 'At least one page has no Unicode letter or number in its extracted text layer. The entire PDF is refused, including PDFs with blank or scanned-only pages. No partial document was imported; OCR is not supported.' : e instanceof Error && e.message === 'pdf_ocr_not_supported' ? 'No meaningful text layer was found. Scanned PDFs require OCR, which is not supported. Blank pages are also refused.' : e instanceof Error && e.message === 'pdf_encrypted_not_supported' ? 'Encrypted or password-protected PDFs are not supported.' : e instanceof Error && /pdf_.*limit/.test(e.message) ? 'This PDF exceeds the page, text, paragraph or output limits. No partial document was imported.' : e instanceof Error ? e.message : 'PDF import failed.');
  async function choose(file?: File) {
    if (!file || flight.current || attempt.current || actions.current.read()) return;
    const ticket = ++sequence.current; setPreview(null); setUpload(null); setMessage(''); setCreated(null);
    try {
      if (file.size > PDF_LIMIT) throw new Error('Choose a PDF no larger than 16,000,000 bytes.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const input: Upload = { filename: file.name, base64: btoa(binary), synthetic: true };
      const result = await api<Preview>('/exchange/pdf/preview', input);
      if (!alive.current || sequence.current !== ticket) return;
      setUpload({ ...input, previewHash: result.previewHash }); setPreview(result);
    } catch (e) { if (alive.current && sequence.current === ticket) report(e); }
  }
  function conflict(other: Pending) {
    attempt.current = other; setPending(other);
    setMessage(`Another unresolved request is retained for ${String(other.input.filename ?? 'an unknown file')}. Your preview is kept. Use its named retry button to retry that request explicitly.`);
  }
  async function importFile(retry?: Pending) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setMessage('');
    let submitted: Pending | null = null;
    try {
      // Keep the displayed attempt when a second consumer clears shared storage.
      if (retry) {
        if (retry.key !== 'import' || retry.path !== '/exchange/pdf/import' || typeof retry.input.filename !== 'string' || typeof retry.input.previewHash !== 'string' || typeof retry.input.commandId !== 'string' || retry.input.synthetic !== true) throw new Error('Unrecognized pending request retained. No request was sent.');
        submitted = retry;
      } else {
        const other = attempt.current ?? actions.current.read();
        if (other) { conflict(other); return; }
        if (!upload || !preview) throw new Error('Preview a PDF first.');
        await pdfUpload.put(preview.previewHash, upload.base64);
        // Another tab may have prepared a request while IndexedDB was writing.
        const arrived = actions.current.read();
        if (arrived) { conflict(arrived); return; }
        const { base64: _bytes, ...metadata } = upload;
        const commandId = crypto.randomUUID();
        const prepared = actions.current.prepare('import', '/exchange/pdf/import', metadata, () => commandId);
        if (prepared.input.commandId !== commandId) { conflict(prepared); return; }
        submitted = prepared;
      }
      attempt.current = submitted; setPending(submitted); // Durable exact request precedes network dispatch.
      const base64 = await pdfUpload.get(String(submitted.input.previewHash));
      const result = await api<{ workId: string }>(submitted.path, { ...submitted.input, base64 });
      const current = actions.current.read();
      const matches = !current || current.input.commandId === submitted.input.commandId;
      if (alive.current && matches) localStorage.setItem('workagent-pdf:created', result.workId);
      actions.current.accepted(submitted);
      attempt.current = null;
      if (alive.current && matches) {
        setCreated(result.workId);
        if (upload?.previewHash === submitted.input.previewHash) { setUpload(null); setPreview(null); }
        setMessage(`Imported ${String(submitted.input.filename)} as separate saved work. Open it when you are ready; current edits and messages are kept.`); await onImported();
      }
    } catch (e) {
      const matches = !submitted || attempt.current?.input.commandId === submitted.input.commandId;
      if (submitted && actions.current.rejected(e, submitted)) attempt.current = null;
      if (alive.current && matches) report(e);
    } finally { flight.current = false; if (alive.current) { attempt.current ??= actions.current.read(); setPending(attempt.current); setBusy(false); } }
  }
  return <details className="document-exchange"><summary>Import / export PDF</summary>
    <p>{PDF_POLICY}</p><p>Up to 16,000,000 PDF bytes, 200 pages, 200,000 UTF-8 extraction bytes including separators, and 10,000 paragraphs. Encrypted, malformed and over-limit PDFs are refused. Every page must contain at least one Unicode letter or number in its extracted text layer. A page without one refuses the entire PDF, including blank pages and scanned-only pages. Synthetic data only.</p>
    <label>Preview PDF text layer<input type="file" accept=".pdf,application/pdf" disabled={busy || !!pending} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} /></label>
    {preview && <div><p>{preview.filename}: {preview.bytes} bytes · {preview.pages} pages · {preview.paragraphs} paragraphs. {preview.clipped ? 'Preview clipped to 4,000 characters; all extracted text is imported.' : ''}</p><ul>{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul><pre className="document-preview">{preview.sample}</pre></div>}
    {preview && !pending && <button type="button" disabled={busy} onClick={() => void importFile()}>Import as new work</button>}
    {pending && <><p>Unresolved import: {String(pending.input.filename ?? 'unknown file')}. The exact original upload is retained on this device for safe retries.</p><button type="button" disabled={busy} onClick={() => void importFile(pending)}>Retry unresolved PDF import: {String(pending.input.filename ?? 'unknown file')}</button></>}
    {created && <button type="button" onClick={() => onOpen(created).catch(report)}>Open imported PDF text document</button>}
    {work && <>{work.original && <p><a href={`/api/work/${work.id}/original/${work.original.id}`} download>Download original: {work.original.filename}</a> · {work.original.size} bytes · {work.original.encoding}<br /><small>SHA-256: {work.original.hash}</small></p>}</>}
    <PdfExport api={api} editor={editor} work={work} />
    {message && <p role="status">{message}</p>}
  </details>;
}
