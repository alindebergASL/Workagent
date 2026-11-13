import { useEffect, useRef, useState } from 'react';
import { CSV_LIMITS, CSV_POLICY, CSV_LOSSES } from '../../../packages/workagent-contract/csv.mjs';
import { MaintenanceActions, type Pending } from './maintenance-actions';
import type { EditorHandle } from './NativeEditor';
import type { Work } from './types';
type Preview = { filename: string; bytes: number; encoding: string; rows: number; columns: number; raggedRows: number; sample: string[][] };
type Upload = { filename: string; base64: string; synthetic: true };
type Api = <T>(path: string, input?: unknown) => Promise<T>;
export function CsvExchange({ api, editor, work, onImported, onOpen }: { api: Api; editor: () => EditorHandle | null; work: Work | null; onImported: () => Promise<void>; onOpen: (id: string) => Promise<unknown> }) {
  const actions = useRef(new MaintenanceActions(localStorage, 'csv-import'));
  const [preview, setPreview] = useState<Preview | null>(null), [upload, setUpload] = useState<Upload | null>(null);
  const [pending, setPending] = useState<Pending | null>(() => actions.current.read());
  const attempt = useRef(pending);
  const [message, setMessage] = useState(''), [created, setCreated] = useState<string | null>(() => localStorage.getItem('workagent-csv:created')), [busy, setBusy] = useState(false);
  const alive = useRef(true), sequence = useRef(0), flight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const report = (e: unknown) => setMessage(e instanceof Error ? e.message : 'CSV operation failed.');
  async function choose(file?: File) {
    if (!file || flight.current || attempt.current || actions.current.read()) return;
    const ticket = ++sequence.current; setPreview(null); setUpload(null); setMessage(''); setCreated(null);
    try {
      if (file.size > CSV_LIMITS.bytes) throw new Error('Choose a UTF-8 CSV file no larger than 1,000,000 bytes.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const input: Upload = { filename: file.name, base64: btoa(binary), synthetic: true };
      const result = await api<Preview>('/exchange/csv/preview', input);
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
        if (!upload || !preview) throw new Error('Preview a CSV first.');
        submitted = actions.current.prepare('import', '/exchange/csv/import', upload, () => crypto.randomUUID());
      }
      attempt.current = submitted; setPending(submitted); // Durable exact request precedes network dispatch.
      const result = await api<{ workId: string }>(submitted.path, submitted.input);
      const current = actions.current.read();
      const matches = !current || current.input.commandId === submitted.input.commandId;
      if (alive.current && matches) localStorage.setItem('workagent-csv:created', result.workId);
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
      if (!native) throw new Error('Open a sheet first.');
      const result = await native.exportCsv();
      if (!alive.current || editor() !== native) throw new Error('The editor changed. Retry from the current sheet.');
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = result.sheetName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') + '.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Exported ${result.sheetName}: ${result.rows} rows × ${result.columns} columns. ${result.neutralized} text cells neutralized; ${result.unknown} unknown formula values marked #UNKNOWN!. Local edits were included; export does not save to the server.`);
    } catch (e) { if (alive.current) report(e); }
    finally { flight.current = false; if (alive.current) setBusy(false); }
  }
  return <details className="csv-exchange"><summary>Import / export CSV</summary>
    <p>{CSV_POLICY}</p><p>Limits: 1 MB, 10,000 rows, 200 columns, 50,000 rectangular cells and 20,000 characters per field. Synthetic data only.</p>
    <label>Preview CSV file<input type="file" accept=".csv,text/csv" disabled={busy || !!pending} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} /></label>
    {preview && <div><p>{preview.filename}: {preview.bytes} bytes · {preview.encoding} · {preview.rows} rows × {preview.columns} columns · {preview.raggedRows} padded rows. Preview shows at most 8 rows × 12 columns; long fields are visibly clipped here only.</p><div className="csv-preview"><table><tbody>{preview.sample.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div></div>}
    {(preview || pending) && <button type="button" disabled={busy} onClick={() => void importFile()}>{pending ? 'Retry unresolved CSV import' : 'Import as new work'}</button>}
    {pending && <p>The exact original upload is retained on this device until its acknowledgement is known.</p>}
    {created && <button type="button" onClick={() => onOpen(created).catch(report)}>Open imported sheet</button>}
    {work && <><p>{CSV_LOSSES}</p><button type="button" disabled={busy} onClick={() => void exportFile()}>Export selected sheet CSV</button>{work.original && !work.original.filename.toLowerCase().endsWith('.xlsx') && <p><a href={`/api/work/${work.id}/original/${work.original.id}`} download>Download original: {work.original.filename}</a> · {work.original.size} bytes · {work.original.encoding}<br /><small>SHA-256: {work.original.hash}</small></p>}</>}
    {message && <p role="status">{message}</p>}
  </details>;
}
