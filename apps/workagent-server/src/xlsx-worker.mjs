import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
const codec = fileURLToPath(new URL('../../../services/workagent-execution/xlsx/codec.py', import.meta.url));
// Paths are trusted deployment configuration, never request data. No fallback.
export function sandboxArgs(venv) {
  if (!venv || !isAbsolute(venv)) throw new Fault('xlsx_sandbox_unavailable', 503);
  return ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--ro-bind', venv, '/venv', '--ro-bind', codec, '/codec.py', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--chdir', '/tmp', '--clearenv', '--setenv', 'PATH', '/venv/bin:/usr/bin', '--setenv', 'HOME', '/tmp', '/venv/bin/python', '-I', '/codec.py'];
}
export class XlsxWorker {
  constructor({ venv } = {}) { this.venv = venv; this.active = false; }
  async run(input) {
    if (this.active) throw new Fault('xlsx_worker_busy_retry', 503);
    const args = sandboxArgs(this.venv), body = JSON.stringify(input);
    if (Buffer.byteLength(body) > 4_500_000) throw new Fault('xlsx_input_limit', 400);
    this.active = true;
    try { return await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/bwrap', args, { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = [], size = 0, errSize = 0, failed;
      const stop = code => { failed ??= new Fault(code, 503); child.kill('SIGKILL'); };
      const timer = setTimeout(() => stop('xlsx_worker_timeout'), 12000);
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 6_000_000) stop('xlsx_worker_output_limit'); else stdout.push(chunk); });
      child.stderr.on('data', chunk => { errSize += chunk.length; if (errSize > 16384) stop('xlsx_worker_stderr_limit'); });
      child.stdin.on('error', () => {});
      child.on('error', () => { failed = new Fault('xlsx_sandbox_unavailable', 503); });
      child.on('close', code => {
        clearTimeout(timer);
        if (failed) return reject(failed);
        let result; try { result = JSON.parse(Buffer.concat(stdout).toString('utf8')); } catch { return reject(new Fault('xlsx_sandbox_or_codec_failed', 503)); }
        if (code || result.error) return reject(new Fault(`xlsx_refused: ${result.error ?? 'conversion failed'}`, 400));
        resolve(result);
      });
      child.stdin.end(body + '\n');
    }); } finally { this.active = false; }
  }
}
