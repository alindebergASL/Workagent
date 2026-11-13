import { randomUUID } from 'node:crypto';
import { Fault, id, text } from '../../../packages/workagent-contract/index.mjs';
import { blankDocument, validateDocument, DOCUMENT_LIMIT, DOCUMENT_POLICY } from '../../../packages/workagent-contract/document.mjs';
import { authorize, dedup, digest, event } from './workspace.mjs';
function decode(input, importing) {
  if (!input || Object.keys(input).some(k => !['commandId', 'filename', 'base64', 'synthetic'].includes(k)) || input.synthetic !== true) throw new Fault('invalid_document_input', 400);
  text(input.filename, 200);
  if (!/\.(md|txt)$/i.test(input.filename) || /[\x00-\x1f\x7f]/.test(input.filename)) throw new Fault('choose_markdown_or_text', 400);
  if (importing) id(input.commandId);
  if (typeof input.base64 !== 'string' || input.base64.length > Math.ceil(DOCUMENT_LIMIT / 3) * 4) throw new Fault('invalid_document_bytes', 400);
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length > DOCUMENT_LIMIT || bytes.toString('base64') !== input.base64) throw new Fault('invalid_document_bytes', 400);
  let content; try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Fault('document_utf8_required', 400); }
  const document = validateDocument(blankDocument('preview', input.filename, content));
  return { bytes, document };
}
export class DocumentExchange {
  constructor({ workspace, files }) { this.store = workspace.store; this.files = files; }
  async preview(principal, input) {
    await this.store.transaction(s => authorize(s, principal));
    const { bytes, document } = decode(input, false);
    return { filename: input.filename, bytes: bytes.length, encoding: 'UTF-8', sample: document.body.dataStream.slice(0, 4000), clipped: document.body.dataStream.length > 4000, policy: DOCUMENT_POLICY };
  }
  async import(principal, input) {
    const { bytes, document } = decode(input, true), command = { operation: 'document-import', ...input };
    const check = await this.store.transaction(s => { authorize(s, principal); const old = s.commands[input.commandId]; if (old && old.hash !== digest(command)) throw new Fault('command_conflict'); return { replay: old?.result, grant: s.permissionRevision }; });
    if (check.replay) return check.replay;
    const blob = await this.files.writeOriginal(principal, bytes, 'text');
    return this.store.transaction(s => {
      authorize(s, principal);
      return dedup(s, input.commandId, command, () => {
        if (s.permissionRevision !== check.grant) throw new Fault('access_changed', 403);
        const workId = randomUUID(), original = { id: randomUUID(), format: 'text', filename: input.filename, encoding: 'UTF-8', size: blob.bytes, hash: blob.hash, owner: principal };
        document.id = workId;
        const w = { id: workId, kind: 'document', document, original, humanDocument: true, contentRevision: 1, intentRevision: 0, cancellationEpoch: 0, messages: [], proposals: [], sourceIds: [], status: 'ready' };
        s.works[workId] = w; event(s, w, 'human_imported');
        return { workId, original, contentRevision: 1 };
      });
    });
  }
}
