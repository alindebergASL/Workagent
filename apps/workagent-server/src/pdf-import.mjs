import { randomUUID } from 'node:crypto';
import { Fault, id, text } from '../../../packages/workagent-contract/index.mjs';
import { blankDocument, validateDocument } from '../../../packages/workagent-contract/document.mjs';
import { authorize, dedup, digest, event } from './workspace.mjs';
export const PDF_IMPORT_WARNINGS = [
  'Text layer only: no OCR, images, attachments, styles, semantic lists, tables or original layout. Number labels remain literal text, not native list definitions. Text inside images is omitted even on pages that also contain a text layer; complete extraction of image text is not supported. Full PDF editing is unsupported. Original PDF bytes remain downloadable.',
  'Reading order is estimated by the PDF text extractor and can be wrong, especially in multiple columns. Missing or incorrect PDF character mappings cannot be reconstructed. Review the preview and original before adopting.',
  'Every extracted line becomes a plain paragraph. One terminal line ending per page is removed; pages are separated by a blank paragraph. Other blank lines, spaces and literal Unicode are retained without normalization; no paragraph, hyphenation or semantic reconstruction.',
  'Limits: 16,000,000 PDF bytes, 200 pages, 200,000 UTF-8 bytes of extraction (including separators), 10,000 native paragraphs. Encrypted, malformed and over-limit PDFs are refused. Every page must contain at least one Unicode letter or number in its extracted text layer; any page without one refuses the entire PDF, including blank pages and scanned-only pages. Synthetic data only.',
];
export function decodePdfUpload(input, importing = false) {
  if (!input || Array.isArray(input) || Object.keys(input).some(k => !['commandId','filename','base64','synthetic','previewHash'].includes(k)) || input.synthetic !== true) throw new Fault('invalid_pdf_input', 400);
  text(input.filename, 200);
  if (!/\.pdf$/i.test(input.filename) || /[\\/\x00-\x1f\x7f\uD800-\uDFFF]/u.test(input.filename)) throw new Fault('choose_pdf_file', 400);
  if (importing) { id(input.commandId); if (!/^[a-f0-9]{64}$/.test(input.previewHash ?? '')) throw new Fault('pdf_preview_required', 400); }
  if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(16_000_000 / 3) * 4) throw new Fault('pdf_input_limit', 400);
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length > 16_000_000) throw new Fault('pdf_input_limit', 400);
  if (!bytes.length || bytes.toString('base64') !== input.base64) throw new Fault('invalid_pdf_bytes', 400);
  return bytes;
}
export function validatePdfText(result) {
  if (!result || Object.keys(result).some(k => !['text','pages'].includes(k)) || !Number.isInteger(result.pages) || result.pages < 1 || result.pages > 200 || typeof result.text !== 'string' || Buffer.byteLength(result.text) > 200000 || /[\x00-\x08\x0b-\x1f\x7f\uD800-\uDFFF]/u.test(result.text) || result.text.split('\n').length > 10000 || !/[\p{L}\p{N}]/u.test(result.text)) throw new Fault('pdf_invalid_extraction', 503);
  return result;
}
export class PdfImport {
  constructor({ workspace, files, worker }) { this.store = workspace.store; this.files = files; this.worker = worker; }
  async access(principal, expected) {
    return this.store.read(s => { authorize(s, principal); if (expected !== undefined && expected !== s.permissionRevision) throw new Fault('access_changed', 403); return s.permissionRevision; });
  }
  async extracted(input, signal) {
    const result = validatePdfText(await this.worker.run({ op: 'import', base64: input.base64 }, { signal }));
    const document = validateDocument(blankDocument('pdf-preview', input.filename, result.text));
    return { result, document, previewHash: digest({ operation: 'pdf-text-v1', filename: input.filename, base64: input.base64, ...result }) };
  }
  async preview(principal, input, { signal } = {}) {
    const grant = await this.access(principal), bytes = decodePdfUpload(input);
    const { result, document, previewHash } = await this.extracted(input, signal);
    await this.access(principal, grant);
    return { filename: input.filename, bytes: bytes.length, pages: result.pages, paragraphs: document.body.paragraphs.length, sample: Array.from(result.text).slice(0,4000).join(''), clipped: Array.from(result.text).length > 4000, previewHash, warnings: PDF_IMPORT_WARNINGS };
  }
  async import(principal, input, { signal } = {}) {
    const grant = await this.access(principal), bytes = decodePdfUpload(input, true), command = { operation: 'pdf-import', ...input };
    const replay = await this.store.read(s => { authorize(s, principal); const old = s.commands[input.commandId]; if (old && old.hash !== digest(command)) throw new Fault('command_conflict'); return old?.result ?? null; });
    if (replay) return replay;
    const { result, document, previewHash } = await this.extracted(input, signal);
    if (previewHash !== input.previewHash) throw new Fault('pdf_preview_changed', 400);
    await this.access(principal, grant);
    if (signal?.aborted) throw new Fault('pdf_import_cancelled', 409);
    const blob = await this.files.writeOriginal(principal, bytes, 'pdf');
    return this.store.transaction(s => {
      authorize(s, principal);
      return dedup(s, input.commandId, command, () => {
        if (s.permissionRevision !== grant) throw new Fault('access_changed', 403);
        if (signal?.aborted) throw new Fault('pdf_import_cancelled', 409);
        const workId = randomUUID(), original = { id: randomUUID(), format: 'pdf', filename: input.filename, encoding: 'PDF text layer', size: blob.bytes, hash: blob.hash, owner: principal, pages: result.pages, warnings: PDF_IMPORT_WARNINGS };
        document.id = workId;
        const w = { id: workId, kind: 'document', document, original, humanDocument: true, contentRevision: 1, intentRevision: 0, cancellationEpoch: 0, messages: [], proposals: [], sourceIds: [], status: 'ready' };
        s.works[workId] = w; event(s, w, 'human_imported');
        return { workId, original, contentRevision: 1 };
      });
    });
  }
}
