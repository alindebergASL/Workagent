import { useEffect, useRef, useState } from 'react';
import { MaintenanceActions, type Pending } from './maintenance-actions';
import type { EditorHandle } from './NativeEditor';
import type { Work } from './types';
type Preview = { filename: string; bytes: number; cells: number; warnings: string[]; sheets: { name: string; rows: number; columns: number; sample: { row: number; values: { column: number; value: string }[] }[] }[] };
type Upload = { filename: string; base64: string; synthetic: true };
type Api = <T>(path: string, input?: unknown) => Promise<T>;
const fidelity = 'Typed text, numbers, booleans, common styles, 1900 dates, tabs and basic merges are supported. Formulas stay formulas; cached results are discarded and shared formulas expand. Charts, images, comments, links, conditional formatting, tables, named ranges and advanced layout are not retained. External/active formulas, unsupported functions, macros, encryption and 1904 dates are refused. Bounded literal inline-list dropdowns preserve choices, ranges and blank/error settings. Colors/chips and render modes are lost; warning dialogs can differ. Lists must fit 255 UTF-16 units including quotes; ambiguous separators, quotes, control characters, edge whitespace and XML escape sequences in choices are refused. Reference/name/custom validation is not retained or evaluated. Native checkboxes still prevent XLSX export. Originals remain exact.';
export function XlsxExchange({ api, editor, work, onImported, onOpen }: { api: Api; editor: () => EditorHandle | null; work: Extract<Work, { book: unknown }> | null; onImported: () => Promise<void>; onOpen: (id: string) => Promise<unknown> }) {
  const actions = useRef(new MaintenanceActions(localStorage, 'xlsx-import'));
  const [preview, setPreview] = useState<Preview | null>(null), [upload, setUpload] = useState<Upload | null>(null);
  const [pending, setPending] = useState<Pending | null>(() => actions.current.read());
  const attempt = useRef(pending);
  const [message, setMessage] = useState(''), [created, setCreated] = useState<string | null>(() => localStorage.getItem('workagent-xlsx:created')), [busy, setBusy] = useState(false);
  const alive = useRef(true), sequence = useRef(0), flight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const report = (e: unknown) => setMessage(e instanceof Error ? e.message === 'xlsx_controls_not_supported' ? 'XLSX export cannot preserve native checkboxes. Your native sheet and original file are kept. Remove checkboxes in a separate copy to export; supported inline dropdowns can remain.' : e.message : 'XLSX operation failed.');
  async function choose(file?: File) {
    if (!file || flight.current || attempt.current || actions.current.read()) return;
    const ticket = ++sequence.current; setPreview(null); setUpload(null); setMessage(''); setBusy(true);
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 2_000_000) throw new Error('Choose an XLSX file no larger than 2,000,000 bytes.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const input: Upload = { filename: file.name, base64: btoa(binary), synthetic: true };
      const result = await api<Preview>('/exchange/xlsx/preview', input);
      if (!alive.current || sequence.current !== ticket) return;
      setUpload(input); setPreview(result);
    } catch (e) { if (alive.current && sequence.current === ticket) report(e); }
    finally { if (alive.current && sequence.current === ticket) setBusy(false); }
  }
  async function importFile() {
    if (flight.current) return;
    flight.current = true; setBusy(true); setMessage('');
    let submitted: Pending | null = null;
    try {
      // Retain this consumer's exact attempt even if a second tab settled storage.
      submitted = attempt.current ?? actions.current.read();
      if (!submitted) {
        if (!upload || !preview) throw new Error('Preview an XLSX first.');
        let size = JSON.stringify(upload).length * 2 + 2048;
        for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i)!; size += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2; }
        if (size > 8_000_000) throw new Error('Device recovery storage is full. Save other drafts or use a smaller file; no import was sent.');
        try { submitted = actions.current.prepare('import', '/exchange/xlsx/import', upload, () => crypto.randomUUID()); }
        catch { throw new Error('Device recovery storage is full or unavailable. No import was sent; keep this file and save other drafts.'); }
      }
      attempt.current = submitted; setPending(submitted);
      const result = await api<{ workId: string }>(submitted.path, submitted.input);
      const current = actions.current.read();
      const matches = !current || current.input.commandId === submitted.input.commandId;
      // Persist the findable result before clearing this exact unresolved command.
      if (alive.current && matches) localStorage.setItem('workagent-xlsx:created', result.workId);
      actions.current.accepted(submitted); attempt.current = null;
      if (alive.current && matches) { setCreated(result.workId); setUpload(null); setPreview(null); setMessage('Imported as separate saved work. Open it when ready; your current edits and message are kept.'); await onImported(); }
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
      if (!native || !work) throw new Error('Open a sheet first.');
      const book = await native.commit(); // Commit the pending cell into the local snapshot, never autosave.
      if (!alive.current || editor() !== native || book.id !== work.id) throw new Error('The editor changed. Retry export.');
      const result = await api<{ base64: string; filename: string; warnings: string[] }>('/exchange/xlsx/export', { workId: work.id, book });
      if (!alive.current || editor() !== native) throw new Error('The editor changed. Retry export.');
      const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Exported all tabs including the pending edit at export time, without saving to the server. ' + result.warnings.join(' '));
    } catch (e) { if (alive.current) report(e); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  return <details className="csv-exchange"><summary>Import / export XLSX</summary>
    <p>{fidelity}</p><p>Limits: 2 MB compressed, 20 MB inflated, 256 entries, 20 tabs, 50,000 stored cells, 2,000 formulas (2,000 characters each; 200,000 referenced cells total), 10,000 rows / 200 columns per tab, 20,000 characters per field. Synthetic data only.</p>
    <label>Preview XLSX file<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy || !!pending} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} /></label>
    {preview && <div><p>{preview.filename}: {preview.bytes} bytes · {preview.cells} cells. Preview clips to 8 stored rows / 12 cells / 200 characters; import never truncates.</p>{preview.warnings.map(w => <p key={w}>{w}</p>)}{preview.sheets.map(s => <div key={s.name}><strong>{s.name} · {s.rows} × {s.columns}</strong><div className="csv-preview"><table><tbody>{s.sample.map(r => <tr key={r.row}><th>{r.row}</th>{r.values.map(c => <td key={c.column} title={`Column ${c.column}`}>{c.value}</td>)}</tr>)}</tbody></table></div></div>)}</div>}
    {(preview || pending) && <button type="button" disabled={busy} onClick={() => void importFile()}>{pending ? 'Retry unresolved XLSX import' : 'Import XLSX as new work'}</button>}
    {pending && <p>The exact original upload remains on this device until its acknowledgement is known.</p>}
    {created && <button type="button" onClick={() => onOpen(created).catch(report)}>Open imported XLSX</button>}
    {work && <><button type="button" disabled={busy} onClick={() => void exportFile()}>Export all tabs XLSX</button>{work.original?.filename.toLowerCase().endsWith('.xlsx') && <p><a href={`/api/work/${work.id}/original/${work.original.id}`} download>Download original: {work.original.filename}</a> · {work.original.size} bytes<br /><small>SHA-256: {work.original.hash}</small>{work.original.warnings?.map(w => <span key={w}><br />{w}</span>)}</p>}</>}
    {message && <p role="status">{message}</p>}
  </details>;
}
