// TRUSTED GENERATED TEST FIXTURES ONLY. This adapter is never imported by production.
// The production worker always uses bubblewrap and has no direct-Python fallback.
import { mkdtempSync, writeFileSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Fault } from '../../../../packages/workagent-contract/index.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const python = root + '.local/docx-python/bin/python';
export function trustedCodec(input) {
  // This controller denies shutdown() on spawnSync's stdin socket. A bounded
  // trusted fixture file avoids that unsupported test transport, not isolation.
  const dir = mkdtempSync(join(tmpdir(), 'docx-codec-fixture-')), path = join(dir, 'request.json');
  writeFileSync(path, JSON.stringify(input) + '\n'); const fd = openSync(path, 'r');
  let r; try { r = spawnSync(python, ['-I', '-B', root + 'services/workagent-execution/docx/codec.py'], { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 6_000_000, timeout: 12000 }); } finally { closeSync(fd); rmSync(dir, {recursive:true}); }
  if (r.error) throw r.error;
  const result = JSON.parse(r.stdout);
  if (r.status || result.error) throw new Fault(result.error ?? 'fixture conversion failed', 400);
  return result;
}
const generated = spawnSync(python, ['-I', '-B', '-c', `import importlib.util,base64\ns=importlib.util.spec_from_file_location('fixtures',${JSON.stringify(root + 'services/workagent-execution/docx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(base64.b64encode(m.fixture()).decode())`], { encoding: 'utf8', maxBuffer: 3_000_000, timeout: 12000 });
if (generated.status) throw new Error(generated.stderr);
export const originalDocx = Buffer.from(generated.stdout.trim(), 'base64');
export const docxInput = (commandId = 'docx-import') => ({ commandId, filename: 'Fixture.docx', synthetic: true, base64: originalDocx.toString('base64') });
export const trustedWorker = { run: async input => trustedCodec(input) };
export function defaultDocx(which, flag, hidden = false) {
  const args = JSON.stringify([which, flag, hidden]);
  const generated = spawnSync(python, ['-I', '-B', '-c', `import importlib.util,base64,json\ns=importlib.util.spec_from_file_location('fixtures',${JSON.stringify(root + 'services/workagent-execution/docx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(base64.b64encode(m.default_fixture(*json.loads(${JSON.stringify(args)}))).decode())`], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 3_000_000, timeout: 12000 });
  if (generated.error) throw generated.error;
  if (generated.status) throw new Error(generated.stderr);
  return generated.stdout.trim();
}
export function numberedDocx(invalid = false) {
  const generated = spawnSync(python, ['-I', '-B', '-c', `import importlib.util,base64\ns=importlib.util.spec_from_file_location('fixtures',${JSON.stringify(root + 'services/workagent-execution/docx/test_codec.py')})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndata=m.numbered_fixture()\n${invalid ? "data=m.rewrite(data,lambda n,b:(n,b.replace(b'<w:startOverride w:val=\"5\"/>',b'<w:lvl w:ilvl=\"0\"/>') if n=='word/numbering.xml' else b))" : ''}\nprint(base64.b64encode(data).decode())`], { stdio: ['ignore','pipe','pipe'], encoding: 'utf8', maxBuffer: 3_000_000, timeout: 12000 });
  if (generated.error) throw generated.error;
  if (generated.status) throw new Error(generated.stderr);
  return generated.stdout.trim();
}
