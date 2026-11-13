import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join } from 'node:path';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { pdfBytes, validatePdfDocument } from './pdf-exchange.mjs';
const codec = fileURLToPath(new URL('../../../services/workagent-execution/docx/codec.py', import.meta.url));
const renderer = fileURLToPath(new URL('../../../services/workagent-execution/pdf/render.py', import.meta.url));
export function sandboxArgs(venv) {
  if (!venv || !isAbsolute(venv)) throw new Fault('pdf_sandbox_unavailable', 503);
  return ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
    '--setenv', 'HOME', '/tmp', '--setenv', 'PATH', '/usr/bin', '--setenv', 'LANG', 'C.UTF-8',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
    '--ro-bind', '/etc/fonts', '/etc/fonts', '--ro-bind', '/etc/libreoffice', '/etc/libreoffice',
    '--file', '3', '/etc/passwd', '--file', '4', '/etc/group', '--file', '5', '/etc/nsswitch.conf',
    '--ro-bind', venv, '/venv', '--ro-bind', codec, '/codec.py', '--ro-bind', renderer, '/render.py',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--chdir', '/tmp', '/usr/bin/python3', '-I', '/render.py'];
}
// Fresh synthetic identities describe the actual service actor, never host files.
export function namespaceIdentity(uid = process.getuid(), gid = process.getgid()) {
  return [`worker:x:${uid}:${gid}:PDF worker:/tmp:/usr/sbin/nologin\n`, `worker:x:${gid}:\n`, 'passwd: files\ngroup: files\nhosts: files\n'];
}
// Separate from namespace construction so deterministic tests can exercise real
// child lifetime/error handling without substituting an unsandboxed renderer.
export function collectChild(child, body, { signal, timeoutMs = 30000, outputLimit = 22_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0, stderrSize = 0, failed;
    const stop = code => {
      failed ??= new Fault(code, 503);
      // The bwrap PID namespace kills descendants even if they start sessions;
      // the outer process group also closes inherited pipes on cancellation.
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const abort = () => stop('pdf_export_cancelled');
    const timer = setTimeout(() => stop('pdf_worker_timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', c => { size += c.length; if (size > outputLimit) stop('pdf_worker_output_limit'); else chunks.push(c); });
    child.stderr.on('data', c => { stderrSize += c.length; if (stderrSize > 16384) stop('pdf_worker_stderr_limit'); });
    child.stdin.on('error', () => {});
    child.on('error', () => { failed ??= new Fault('pdf_sandbox_unavailable', 503); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failed) return reject(failed);
      let result; try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(new Fault('pdf_sandbox_or_renderer_unavailable', 503)); }
      if (code !== 0 || result?.error) {
        const allowed = ['pdf_renderer_unavailable', 'pdf_fonts_unavailable', 'pdf_unsupported_text', 'pdf_missing_glyph', 'pdf_lists_unqualified', 'pdf_codec_unavailable', 'pdf_render_failed', 'pdf_render_timeout', 'pdf_output_limit', 'pdf_invalid_output', 'pdf_codec_refused', 'pdf_child_output_limit'];
        return reject(new Fault(allowed.includes(result?.error) ? result.error : 'pdf_render_failed', ['pdf_codec_refused', 'pdf_unsupported_text', 'pdf_missing_glyph', 'pdf_lists_unqualified'].includes(result?.error) ? 400 : 503));
      }
      try { pdfBytes(result); resolve(result); } catch (e) { reject(e); }
    });
    child.stdin.end(body);
  });
}
export class PdfWorker {
  constructor({ venv } = {}) { this.venv = venv; this.active = false; }
  async run(input, { signal } = {}) {
    if (this.active) throw new Fault('pdf_worker_busy_retry', 503);
    const args = sandboxArgs(this.venv);
    if (!input || input.op !== 'export' || Object.keys(input).some(k => !['op', 'document'].includes(k))) throw new Fault('invalid_pdf_input', 400);
    const body = JSON.stringify({ op: 'export', document: validatePdfDocument(input.document) });
    if (Buffer.byteLength(body) > 4_500_000) throw new Fault('pdf_input_limit', 400);
    this.active = true;
    try {
      try {
        await Promise.all(['/usr/bin/bwrap', '/usr/bin/soffice', join(this.venv, 'bin/python')].map(p => access(p, constants.X_OK)));
        await Promise.all(['/etc/fonts', '/etc/libreoffice', codec, renderer].map(p => access(p, constants.R_OK)));
      } catch { throw new Fault('pdf_renderer_unavailable', 503); }
      if (signal?.aborted) throw new Fault('pdf_export_cancelled', 409);
      const child = spawn('/usr/bin/bwrap', args, { detached: true, env: {}, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
      const result = collectChild(child, body, { signal });
      namespaceIdentity().forEach((value, index) => { child.stdio[index + 3].on('error', () => {}); child.stdio[index + 3].end(value); });
      return await result;
    } finally { this.active = false; }
  }
}
