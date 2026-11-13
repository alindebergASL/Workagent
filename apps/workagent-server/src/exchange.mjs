import { randomUUID } from 'node:crypto';
import { Fault, id, text, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CSV_LIMITS, CSV_POLICY, parseCsv, csvWorkbook } from '../../../packages/workagent-contract/csv.mjs';
import { authorize, dedup, digest, event, work } from './workspace.mjs';
function decode(input, importing) {
  if (!input || Object.keys(input).some(k => !['commandId', 'filename', 'base64', 'synthetic'].includes(k)) || input.synthetic !== true) throw new Fault('invalid_csv_input', 400);
  text(input.filename, 200);
  if (/[\x00-\x1f\x7f]/.test(input.filename)) throw new Fault('invalid_csv_filename', 400);
  if (importing) id(input.commandId);
  if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(CSV_LIMITS.bytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) throw new Fault('invalid_csv_bytes', 400);
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.toString('base64') !== input.base64) throw new Fault('invalid_csv_bytes', 400);
  let parsed; try { parsed = parseCsv(bytes); } catch (e) { throw new Fault(e.message, 400); }
  const book = validateWorkbook(csvWorkbook(parsed, 'preview', input.filename));
  return { bytes, parsed, book };
}
export class CsvExchange {
  constructor({ workspace, files }) { this.store = workspace.store; this.files = files; }
  async preview(principal, input) {
    await this.store.transaction(s => authorize(s, principal));
    const { bytes, parsed } = decode(input, false);
    return { filename: input.filename, bytes: bytes.length, encoding: parsed.encoding, rows: parsed.rowCount, columns: parsed.columns, raggedRows: parsed.raggedRows, sample: parsed.rows.slice(0, 8).map(r => r.slice(0, 12).map(v => v.length > 200 ? v.slice(0, 200) + '… [preview clipped]' : v)), policy: CSV_POLICY };
  }
  async import(principal, input) {
    const { bytes, parsed, book } = decode(input, true), command = { operation: 'csv-import', ...input };
    const replay = await this.store.transaction(s => {
      authorize(s, principal); const old = s.commands[input.commandId];
      if (old && old.hash !== digest(command)) throw new Fault('command_conflict');
      return old?.result ?? null;
    });
    if (replay) return replay;
    const blob = await this.files.writeOriginal(principal, bytes);
    return this.store.transaction(s => {
      authorize(s, principal);
      return dedup(s, input.commandId, command, () => {
        const workId = randomUUID(), original = { id: randomUUID(), filename: input.filename, encoding: parsed.encoding, size: blob.bytes, hash: blob.hash, owner: principal };
        book.id = workId;
        const humanCells = parsed.rows.flatMap((r, row) => r.map((_, col) => `sheet1:${row}:${col}`));
        const w = { id: workId, book, original, contentRevision: 1, intentRevision: 0, cancellationEpoch: 0, messages: [], proposals: [], humanCells, sourceIds: [], status: 'ready' };
        s.works[workId] = w; event(s, w, 'human_imported');
        return { workId, original, contentRevision: 1 };
      });
    });
  }
  async original(principal, workId, originalId) {
    const get = () => this.store.transaction(s => {
      authorize(s, principal); const original = work(s, workId).original;
      if (!original || original.id !== id(originalId) || original.owner !== principal) throw new Fault('source_access_denied', 403);
      return original;
    });
    const original = await get(), bytes = await this.files.readOriginal(principal, original.hash, original.format ?? 'csv');
    await get(); // Recheck current access after filesystem IO.
    return { original, bytes };
  }
}
