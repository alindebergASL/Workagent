import { useEffect, useRef, useState } from 'react';
import { validateDocument } from '../../../packages/workagent-contract/document.mjs';
import type { DocumentHandle } from './DocumentEditor';
import type { Work } from './types';
type Api = <T>(path: string, input?: unknown, method?: string, signal?: AbortSignal) => Promise<T>;
type DocumentWork = Extract<Work, { kind: 'document' }>;
export function PdfExport({ api, editor, work }: { api: Api; editor: () => DocumentHandle | null; work: DocumentWork | null }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const flight = useRef(false), alive = useRef(true), current = useRef(work), request = useRef<AbortController | null>(null);
  current.current = work;
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  // Abort a pending renderer on navigation or observed server revision changes.
  useEffect(() => { return () => request.current?.abort(); }, [work?.id, work?.contentRevision, work?.expected.permissionRevision]);
  async function exportFile() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setMessage('');
    const native = editor(), source = current.current, controller = new AbortController(); request.current = controller;
    const changed = () => !alive.current || controller.signal.aborted || !source || current.current?.id !== source.id || current.current?.contentRevision !== source.contentRevision || current.current?.expected.permissionRevision !== source.expected.permissionRevision || editor() !== native;
    try {
      if (!native || !source) throw new Error('Open a native document first.');
      const saved = await native.commit(), epoch = native.contentEpoch();
      validateDocument(saved);
      if (changed() || saved.id !== source.id || native.isEditing()) throw new Error('The document changed. Retry PDF export from the current document.');
      const result = await api<{ base64: string; filename: string; warnings: string[] }>('/exchange/pdf/export', { workId: saved.id, document: saved, contentRevision: source.contentRevision }, 'POST', controller.signal);
      if (changed() || native.isEditing() || native.contentEpoch() !== epoch || JSON.stringify(native.save()) !== JSON.stringify(saved)) throw new Error('The document changed during PDF export. No download was made. Retry from the current document.');
      const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Exported current native edits as PDF without saving. ' + result.warnings.join(' '));
    } catch (e) {
      if (alive.current) setMessage(controller.signal.aborted ? 'The document changed or export was cancelled. No download was made. Retry from the current document.' : e instanceof Error && e.message === 'pdf_fonts_unavailable' ? 'Required PDF rendering fonts are unavailable. Your edits are kept. Retry when the fonts are available.' : e instanceof Error && /pdf_.*unavailable/.test(e.message) ? 'Isolated PDF conversion is unavailable. Your edits are kept. Retry when the renderer is configured and available.' : e instanceof Error && /pdf_(unsupported_text|missing_glyph)/.test(e.message) ? 'PDF export cannot render some characters or character sequences in this document. No download was made. Your edits are kept; Word export remains available.' : e instanceof Error && e.message === 'pdf_worker_busy_retry' ? 'Another PDF is rendering. Retry shortly. Your edits are kept.' : e instanceof Error ? e.message : 'PDF export failed. Your edits are kept.');
    } finally { flight.current = false; request.current = null; if (alive.current) setBusy(false); }
  }
  return <details className="document-exchange"><summary>Export PDF</summary>
    <p>Native document export only, through the Word mapping: literal paragraphs, bold, italic, single underline, half-point font sizes, RGB colour, simple alignment and one page geometry. PDF uses DejaVu Serif for Latin, WenQuanYi Zen Hei for BMP Han and Noto Color Emoji for standalone emoji. Other scripts, combining/emoji sequences and missing glyphs are refused. Fonts are substituted; wrapping, pagination and layout may differ from the editor and Word. Native default hyphenation/canvas settings, metadata, themes and style names are not retained. Exact layout and full Word fidelity are not promised.</p>
    <p>Tables, media, links, fields, macros, notes, lists, headers/footers, multiple sections and unsupported formatting are refused. PDF import, OCR, roundtrip editing and spreadsheet/deck PDF are not available. Up to 200 KB text, 10,000 paragraphs/runs and 16 MB PDF. Synthetic data only.</p>
    {work && <button type="button" disabled={busy} onClick={() => void exportFile()}>{busy ? 'Rendering PDF…' : 'Export document PDF (.pdf)'}</button>}
    <p>Includes current native edits without saving. Finish pending paste or composition first. Changes during export require a retry; drafts and messages are kept.</p>
    {message && <p role="status">{message}</p>}
  </details>;
}
