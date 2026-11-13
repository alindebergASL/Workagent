// Opt-in, serial qualification, never part of the ordinary/full test suite.
// NODE_OPTIONS=--max-old-space-size=768 node apps/workagent-client/tests/sheet-scale.mjs
// Optional --control-after-failure runs exactly one 1,000-cell diagnostic.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, mkdtempSync, statfsSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const local = join(repo, '.local'); mkdirSync(local, { recursive: true });
const root = mkdtempSync(join(local, 'sheet-scale-'));
const MiB = 1024 ** 2, GiB = 1024 ** 3;
const limits = { heapMiB: 768, phaseWallMs: 120_000, startAvailableBytes: GiB, stopAvailableBytes: 512 * MiB, childRssBytes: 1.5 * GiB, scratchFreeBytes: 10 * GiB, generatedBytes: 100_000_000, sampleMs: 100 };
const report = { started: new Date().toISOString(), node: process.version, root, limits, scope: 'Synthetic local native SDK + actual NativeEditor/App + FileFixtureStore. No browser/PG/HTTP service/model/provider/device proof.', runs: [] };
const output = join(root, 'result.json');
const persist = () => writeFileSync(output, JSON.stringify(report, null, 2));
function available() { return Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync('/proc/meminfo', 'utf8'))[1]) * 1024; }
function generated() { return readdirSync(root).reduce((n, name) => n + statSync(join(root, name)).size, 0); }
function headroom() { const disk = statfsSync(root); return { availableBytes: available(), scratchFreeBytes: disk.bavail * disk.bsize, generatedBytes: generated() }; }
function preflight() {
  const h = headroom();
  if (h.availableBytes < limits.startAvailableBytes) throw new Error('host_available_below_1GiB');
  if (h.scratchFreeBytes < limits.scratchFreeBytes) throw new Error('scratch_free_below_10GiB');
  if (h.generatedBytes >= limits.generatedBytes) throw new Error('generated_files_limit');
  return h;
}
async function run(populated, codec = false) {
  const run = { kind: codec ? 'xlsx-negative' : populated === 100_000 ? 'named-acceptance' : 'diagnostic-control-only', populated, status: 'running', phases: [], observations: [], peakRssBytes: 0, peakObservedHeapBytes: 0, rssMeasurement: 'Linux VmHWM and process.resourceUsage maxRSS; phase readings are cumulative process high-water marks', heapMeasurement: codec ? 'not measured for Python codec' : 'maximum 50ms/phase samples and V8 trace-gc-nvp start/end_object_size (or total_size_before/after); observed lower bound, not an exact allocation high-water mark' };
  report.runs.push(run);
  try { run.preflight = preflight(); } catch (e) { run.status = 'resource-refused'; run.reason = e.message; persist(); return run; }
  const start = performance.now(); let phaseStart = start, phase = { name: codec ? 'xlsx-cell-cap' : 'worker-startup' }, terminated, stdoutPending = '';
  const stem = codec ? 'xlsx' : String(populated);
  const log = join(root, `${stem}.stdout.log`), errlog = join(root, `${stem}.stderr.log`);
  const args = codec ? ['-I', '-B', join(repo, 'services/workagent-execution/xlsx/codec.py')] : ['--trace-gc-nvp', fileURLToPath(new URL('./sheet-scale-worker.mjs', import.meta.url)), root, String(populated)];
  // Disable core files before exec: a classified V8 OOM must not leave a huge dump.
  const executable = codec ? join(repo, '.local/xlsx-python/bin/python') : process.execPath;
  const child = spawn('/bin/bash', ['-c', 'ulimit -c 0; exec "$@"', 'sheet-scale-child', executable, ...args], {
    cwd: repo, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_OPTIONS: '--max-old-space-size=768' },
    stdio: codec ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  run.pid = child.pid; persist();
  const stop = reason => { if (terminated) return; terminated = reason; child.kill('SIGKILL'); };
  const sample = () => {
    try {
      const h = headroom(); run.minimumAvailableBytes = Math.min(run.minimumAvailableBytes ?? Infinity, h.availableBytes);
      const status = readFileSync(`/proc/${child.pid}/status`, 'utf8');
      const rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024;
      const hwm = Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024;
      run.peakRssBytes = Math.max(run.peakRssBytes, rss, hwm);
      phase.peakRssBytes = Math.max(phase.peakRssBytes ?? 0, rss, hwm);
      if (rss > limits.childRssBytes) stop('child_rss_above_1.5GiB');
      else if (h.availableBytes < limits.stopAvailableBytes) stop('host_available_below_512MiB');
      else if (h.generatedBytes >= limits.generatedBytes) stop('generated_files_limit');
      else if (performance.now() - phaseStart > limits.phaseWallMs) stop('phase_timeout_120s');
    } catch (e) { if (e.code !== 'ENOENT') stop(`monitor_failure:${e.message}`); }
  };
  const timer = setInterval(sample, limits.sampleMs);
  child.on('message', message => {
    if (message.memory) {
      run.peakRssBytes = Math.max(run.peakRssBytes, message.memory.maxRSS);
      run.peakObservedHeapBytes = Math.max(run.peakObservedHeapBytes, message.memory.sampledHeapPeak);
      phase.peakObservedHeapBytes = Math.max(phase.peakObservedHeapBytes ?? 0, message.memory.heapUsed);
    }
    if (message.type === 'memory') return;
    appendFileSync(join(root, `${stem}.events.jsonl`), JSON.stringify(message) + '\n');
    if (message.type === 'phase') {
      phase = { name: message.name, status: 'running' }; run.phases.push(phase); phaseStart = performance.now();
      try { phase.preflight = preflight(); child.send('proceed'); } catch (e) { stop(e.message); }
      console.log(`${stem}: ${message.name}`);
    } else if (message.type === 'result') Object.assign(phase, message);
    else if (message.type === 'observations' || message.type === 'seed') run.observations.push(message);
    else if (message.type === 'complete') { run.completion = message; run.status = message.status; }
    persist();
  });
  child.stdout.on('data', bytes => {
    appendFileSync(log, bytes); stdoutPending += bytes.toString();
    const lines = stdoutPending.split('\n'); stdoutPending = lines.pop();
    for (const line of lines) for (const match of line.matchAll(/(?:total_size_(?:before|after)|(?:start|end)_object_size)=(\d+)/g)) run.peakObservedHeapBytes = Math.max(run.peakObservedHeapBytes, Number(match[1]));
    if (statSync(log).size > 5 * MiB) stop('stdout_limit_5MiB');
  });
  child.stderr.on('data', bytes => { appendFileSync(errlog, bytes); if (statSync(errlog).size > MiB) stop('stderr_limit_1MiB'); });
  let spawnError;
  child.on('error', e => { spawnError = e.message; });
  if (codec) { child.stdin.on('error', () => {}); child.stdin.end(readFileSync(join(root, 'xlsx-request.json'))); }
  const exited = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  clearInterval(timer); run.wallMs = performance.now() - start; run.exit = exited;
  if (terminated) { run.status = 'resource-failed'; run.reason = terminated; phase.status = 'resource-failed'; phase.wallMs = performance.now() - phaseStart; }
  else if (spawnError) { run.status = 'setup-failed'; run.reason = spawnError; }
  else if (codec) {
    run.response = existsSync(log) ? readFileSync(log, 'utf8').trim() : '';
    run.status = exited.code === 1 && /cell limit/i.test(run.response) ? 'passed-expected-refusal' : 'failed';
  } else if (exited.code !== 0 || !run.completion) {
    run.status = 'failed'; const stderr = existsSync(errlog) ? readFileSync(errlog, 'utf8') : '';
    run.reason = /heap out of memory|Reached heap limit|Ineffective mark-compacts/i.test(stderr) ? 'v8_heap_oom_768MiB' : run.completion?.error?.code ?? run.completion?.error?.message ?? 'child_failed_without_completion';
    if (phase.status === 'running') { phase.status = 'failed'; phase.wallMs = performance.now() - phaseStart; phase.reason = run.reason; }
  }
  run.artifacts = { log, errlog }; persist(); console.log(`${stem}: ${run.status}${run.reason ? ': ' + run.reason : ''}`); return run;
}
assert.ok(process.argv.slice(2).every(arg => arg === '--control-after-failure'), 'Only --control-after-failure is supported');
console.log(`Artifacts: ${root}`);
const full = await run(100_000);
if (full.status !== 'passed' && process.argv.includes('--control-after-failure')) await run(1000);
if (existsSync(join(root, 'xlsx-request.json'))) await run(100_000, true);
report.finished = new Date().toISOString(); report.generatedBytes = generated(); report.namedAcceptance = full.status; persist();
console.log(`Result: ${output}`); process.exitCode = full.status === 'passed' && report.runs.every(r => ['passed', 'passed-expected-refusal'].includes(r.status)) ? 0 : 1;
