import { randomUUID } from 'node:crypto';
import { Fault, id, text } from '../../../packages/workagent-contract/index.mjs';
import { validateDocument, workKind } from '../../../packages/workagent-contract/document.mjs';
import { authorize, dedup, digest, event, work } from './workspace.mjs';
export const DOCX_BYTES = 2_000_000;
function decode(input, importing) {
  if (!input || Array.isArray(input) || Object.keys(input).some(k => !['commandId', 'filename', 'base64', 'synthetic'].includes(k)) || input.synthetic !== true) throw new Fault('invalid_docx_input', 400);
  text(input.filename, 200);
  if (!/\.docx$/i.test(input.filename) || /[\x00-\x1f\x7f]/.test(input.filename)) throw new Fault('choose_docx_file', 400);
  if (importing) id(input.commandId);
  if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(DOCX_BYTES / 3) * 4) throw new Fault('invalid_docx_bytes', 400);
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length > DOCX_BYTES || bytes.toString('base64') !== input.base64) throw new Fault('invalid_docx_bytes', 400);
  return bytes;
}
function warnings(result) {
  if (!Array.isArray(result?.warnings) || result.warnings.length > 100 || result.warnings.some(w => typeof w !== 'string' || w.length > 1000)) throw new Fault('invalid_docx_result', 400);
  return result.warnings;
}
function validated(result, title) { warnings(result); return validateDocument({ ...result.document, title }); }
export class DocxExchange {
  constructor({ workspace, files, worker }) { this.store = workspace.store; this.files = files; this.worker = worker; }
  async grant(principal, expected, workId) {
    return this.store.transaction(s => {
      authorize(s, principal);
      if (workId && workKind(work(s, workId)) !== 'document') throw new Fault('document_required', 400);
      if (expected !== undefined && s.permissionRevision !== expected) throw new Fault('access_changed', 403);
      return s.permissionRevision;
    });
  }
  async preview(principal, input) {
    const grant = await this.grant(principal), bytes = decode(input, false);
    const result = await this.worker.run({ op: 'import', base64: input.base64 });
    const document = validated(result, input.filename);
    await this.grant(principal, grant);
    return { filename: input.filename, bytes: bytes.length, sample: document.body.dataStream.slice(0, 4000), clipped: document.body.dataStream.length > 4000, paragraphs: document.body.paragraphs.length, warnings: result.warnings };
  }
  async import(principal, input) {
    const grant = await this.grant(principal), bytes = decode(input, true), command = { operation: 'docx-import', ...input };
    const replay = await this.store.transaction(s => {
      authorize(s, principal); const old = s.commands[input.commandId];
      if (old && old.hash !== digest(command)) throw new Fault('command_conflict');
      return old?.result ?? null;
    });
    if (replay) return replay;
    const result = await this.worker.run({ op: 'import', base64: input.base64 });
    const document = validated(result, input.filename);
    await this.grant(principal, grant);
    const blob = await this.files.writeOriginal(principal, bytes, 'docx');
    return this.store.transaction(s => {
      authorize(s, principal);
      return dedup(s, input.commandId, command, () => {
        if (s.permissionRevision !== grant) throw new Fault('access_changed', 403);
        const workId = randomUUID(), original = { id: randomUUID(), format: 'docx', filename: input.filename, encoding: 'DOCX (ZIP/XML)', size: blob.bytes, hash: blob.hash, owner: principal, warnings: result.warnings };
        document.id = workId;
        const w = { id: workId, kind: 'document', document, original, humanDocument: true, contentRevision: 1, intentRevision: 0, cancellationEpoch: 0, messages: [], proposals: [], sourceIds: [], status: 'ready' };
        s.works[workId] = w; event(s, w, 'human_imported');
        return { workId, original, contentRevision: 1 };
      });
    });
  }
  async export(principal, input) {
    const grant = await this.grant(principal, undefined, id(input?.workId));
    if (Object.keys(input).some(k => !['workId', 'document'].includes(k))) throw new Fault('invalid_docx_input', 400);
    const document = validateDocument(input.document);
    if (document.id !== input.workId) throw new Fault('invalid_document_identity', 400);
    const result = await this.worker.run({ op: 'export', document }); warnings(result);
    await this.grant(principal, grant, input.workId);
    decode({ filename: 'export.docx', base64: result.base64, synthetic: true }, false);
    return { ...result, filename: document.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.docx$/i, '').slice(0, 180) + '.docx' };
  }
}
