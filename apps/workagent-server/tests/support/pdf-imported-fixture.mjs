// Trusted synthetic fixtures only; never used by production or as a renderer fallback.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const python = root + '.local/docx-python/bin/python';
const fixtures = root + 'services/workagent-execution/pdf/fixtures/';
function run(script, ...args) {
  const result = spawnSync(python, ['-I', '-B', '-c', script, ...args], { encoding: 'utf8', timeout: 12000, maxBuffer: 6_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status) throw new Error(result.stderr);
  return result.stdout.trim();
}
export const importedWord = () => run("import runpy,base64,sys;print(base64.b64encode(runpy.run_path(sys.argv[1])['source_docx']()).decode())", fixtures + 'imported_lists.py');
export const importedSaved = () => JSON.parse(readFileSync(fixtures + 'imported-list-saved.json', 'utf8'));
export const contrastNative = (inheritance = 'default') => JSON.parse(run("import runpy,json,sys;print(json.dumps(runpy.run_path(sys.argv[1])['contrast_native'](sys.argv[2])))", fixtures + 'imported_lists.py', inheritance));
export function pdfIntermediate(document) {
  return JSON.parse(run(`import runpy,base64,json,sys
c=runpy.run_path(sys.argv[1]);r=runpy.run_path(sys.argv[2])
try:
 d=json.loads(sys.argv[3]);markers=[];r['validate_document'](d,markers)
 print(json.dumps({'base64':base64.b64encode(r['export_intermediate'](d,c)).decode(),'markers':markers}))
except r['Refused'] as e:print(json.dumps({'error':str(e)}))`, root + 'services/workagent-execution/docx/codec.py', root + 'services/workagent-execution/pdf/render.py', JSON.stringify(document)));
}
