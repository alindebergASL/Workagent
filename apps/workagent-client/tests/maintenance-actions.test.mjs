import test from 'node:test';
import assert from 'node:assert/strict';
import { MaintenanceActions } from '../src/maintenance-actions.ts';
import { ApiError } from '../src/resume.ts';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
test('maintenance admission survives reload with exact body and stays scoped to its work', () => {
  const disk = storage(), actions = new MaintenanceActions(disk, 'one');
  const original = actions.prepare('bind', '/work/one/responsibilities', { sourceId: 'owned', revision: 1 }, () => 'original');
  const reopened = new MaintenanceActions(disk, 'one');
  assert.deepEqual(reopened.prepare('bind', original.path, { sourceId: 'changed', revision: 2 }, () => 'duplicate'), original);
  assert.equal(new MaintenanceActions(disk, 'two').read(), null);
  assert.throws(() => reopened.prepare('publish', '/owned-sources', {}, () => 'new'), /unresolved/);
  reopened.accepted(original); assert.equal(actions.read(), null);
});
test('maintenance keeps uncertain and revoked acknowledgements; confirmed revision rejection permits correction', () => {
  const actions = new MaintenanceActions(storage(), 'one'), path = '/work/one/responsibilities';
  const pending = actions.prepare('bind', path, {}, () => 'original');
  for (const error of [new Error('offline'), new ApiError(path, 403, 'access_denied'), new ApiError(path, 409, 'command_conflict'), new ApiError('/unrelated', 400, 'invalid_text')]) { actions.rejected(error, pending); assert.ok(actions.read()); }
  actions.rejected(new ApiError(path, 409, 'save_conflict'), pending); assert.equal(actions.read(), null);
});
test('settlement requires the submitted identity, path and work context', () => {
  const disk = storage(), old = new MaintenanceActions(disk, 'one'), current = new MaintenanceActions(disk, 'one');
  const a = old.prepare('publish', '/owned-sources', {}, () => 'A'); current.accepted(a);
  const b = current.prepare('publish', '/owned-sources', {}, () => 'B');
  old.accepted(a); assert.deepEqual(current.read(), b);
  old.rejected(new ApiError(a.path, 400, 'invalid_text'), a); assert.deepEqual(current.read(), b);
  current.accepted({ ...b, path: '/unrelated' }); assert.deepEqual(current.read(), b);
  current.accepted({ ...b, workId: 'two' }); assert.deepEqual(current.read(), b);
  current.accepted(b); assert.equal(current.read(), null);
});
test('only the matching definitive source publication refusal releases an unresolved request', () => {
  const actions = new MaintenanceActions(storage(), 'one'), pending = actions.prepare('publish', '/owned-sources', { sourceId: 'source' }, () => 'A');
  for (const error of [new ApiError(pending.path, 403, 'source_revoked'), new ApiError('/unrelated', 409, 'source_revoked'), new ApiError(pending.path, 500, 'source_revoked'), new ApiError(pending.path, 409, 'command_conflict'), new Error('source_revoked')]) { actions.rejected(error, pending); assert.deepEqual(actions.read(), pending); }
  actions.rejected(new ApiError(pending.path, 409, 'source_revoked'), pending); assert.equal(actions.read(), null);
});

// Execute the actual TSX consumer with a small hook fixture and real JSX elements.
// This checks submitted payloads/callbacks, not browser rendering or DOM behavior.
const require = createRequire(import.meta.url);
const panelCode = ts.transpileModule(readFileSync(new URL('../src/MaintenancePanel.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const work = () => ({ id: 'one', eventSequence: 1, expected: { contentRevision: 1, intentRevision: 1, permissionRevision: 1, cancellationEpoch: 0 }, book: { sheetOrder: ['sheet1'], sheets: { sheet1: { name: 'Sheet 1' } } }, responsibilities: [] });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function panel(disk, props) {
  const hooks = []; let index = 0, effects = [], tree, dirty = true, mounted = true;
  const react = {
    useState(initial) { const i = index++; hooks[i] ??= { value: initial }; return [hooks[i].value, next => { if (!mounted) return; const value = typeof next === 'function' ? next(hooks[i].value) : next; if (!Object.is(value, hooks[i].value)) { hooks[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useEffect(fn, deps) { const i = index++, old = hooks[i]; if (!old || deps.some((v, n) => !Object.is(v, old.deps[n]))) { hooks[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'localStorage', panelCode)(name => name === 'react' ? react : name === './maintenance-actions' ? { MaintenanceActions } : require(name), module, module.exports, disk);
  function render() { index = 0; dirty = false; tree = module.exports.MaintenancePanel(props); const pending = effects; effects = []; pending.forEach(fn => fn()); }
  const nodes = node => Array.isArray(node) ? node.flatMap(n => nodes(n)) : node && typeof node === 'object' && node.props ? [node, ...nodes(node.props.children)] : [];
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  const flush = async () => { for (let i = 0; i < 6; i++) { if (dirty && mounted) render(); await new Promise(setImmediate); } };
  render();
  return { flush, text: () => text(tree),
    async click(label) { const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === label); assert.ok(button, label); assert.ok(!button.props.disabled, `${label} enabled`); button.props.onClick(); await flush(); },
    async change(label, value) { const container = nodes(tree).find(n => n.type === 'label' && text(n.props.children).startsWith(label)); const input = nodes(container).find(n => ['select', 'textarea', 'input'].includes(n.type)); input.props.onChange({ target: { value } }); await flush(); },
    value(label) { const container = nodes(tree).find(n => n.type === 'label' && text(n.props.children).startsWith(label)); return nodes(container).find(n => ['select', 'textarea', 'input'].includes(n.type)).props.value; },
    async update(next) { props = { ...props, ...next }; dirty = true; await flush(); },
    unmount() { mounted = false; hooks.forEach(h => h?.cleanup?.()); },
  };
}
for (const response of ['success', 'error']) test(`actual panel stale ${response} cannot clear the next command after remount`, async () => {
  const disk = storage(), lateA = deferred(), lostB = deferred(); let calls = 0;
  const api = async (path, input) => { if (!input) return []; calls++; if (calls === 1) return lateA.promise; if (calls === 2) return { id: 'source-A' }; return lostB.promise; };
  const props = { work: work(), api, beforeAction: async () => {}, refresh: async () => {} };
  const old = panel(disk, props); await old.flush(); await old.click('Create owned source'); const actions = new MaintenanceActions(disk, 'one'), a = actions.read(); old.unmount();
  const current = panel(disk, props); await current.flush(); await current.click('Retry unresolved action'); assert.equal(actions.read(), null);
  await current.click('Create owned source'); const b = actions.read(); assert.notEqual(a.input.commandId, b.input.commandId);
  if (response === 'success') lateA.resolve({ id: 'source-A' }); else lateA.reject(new ApiError('/owned-sources', 400, 'invalid_text'));
  await current.flush(); assert.deepEqual(actions.read(), b);
  lostB.reject(new Error('lost response')); await current.flush(); current.unmount();
  assert.deepEqual(new MaintenanceActions(disk, 'one').prepare('publish', b.path, { content: 'changed' }, () => 'C'), b);
});
test('actual panel uses a valid field after creation and renamed revisions, preserving a still-valid choice', async () => {
  const disk = storage(), posted = []; let fields = ['stock_on_hand'], sources = [];
  const api = async (path, input) => { if (!input) return sources; posted.push({ path, input }); if (path === '/owned-sources') { sources = [{ id: 'source', name: 'Synthetic', revision: sources.length + 1, status: 'active', fields }]; return { id: 'source' }; } return { id: 'binding' }; };
  const view = panel(disk, { work: work(), api, beforeAction: async () => {}, refresh: async () => {} }); await view.flush();
  await view.change('Complete JSON revision', '{"stock_on_hand":12}'); await view.click('Create owned source'); assert.equal(view.value('Field'), 'stock_on_hand');
  await view.click('Bind cell'); assert.equal(posted.at(-1).input.field, 'stock_on_hand');
  fields = ['capacity', 'stock_on_hand']; await view.click('Publish new revision'); assert.equal(view.value('Field'), 'stock_on_hand');
  fields = ['capacity']; await view.click('Publish new revision'); assert.equal(view.value('Field'), 'capacity');
  await view.click('Bind cell'); assert.equal(posted.at(-1).input.field, 'capacity'); view.unmount();
});
test('actual panel exposes the pinned finding and validation error even after End', async () => {
  const w = work(); w.responsibilities = [{ id: 'r', sourceId: 'source', revision: 2, field: 'stock_on_hand', target: { sheetId: 'sheet1', row: 199, column: 1 }, status: 'ended', lastOutcome: 'end', lastErrorCode: 'invalid_workbook', lastObservation: { observedAt: '2026-11-13T12:00:00Z', sourceRevision: 2, value: 'pinned source value', coalescedRevisions: 0, missedIntervals: 0 }, intervalSeconds: 60, timezone: 'UTC' }];
  const view = panel(storage(), { work: w, api: async () => [], beforeAction: async () => {}, refresh: async () => {} }); await view.flush();
  assert.match(view.text(), /pinned source value/); assert.match(view.text(), /invalid_workbook/); assert.match(view.text(), /not applied/i); view.unmount();
});
test('actual panel preserves pending input if the pre-action gate fails and does not submit after navigation', async () => {
  const disk = storage(), actions = new MaintenanceActions(disk, 'one');
  const pending = actions.prepare('publish', '/owned-sources', { name: 'exact original', content: '{"n":1}', synthetic: true }, () => 'original');
  let posts = 0; const api = async (path, input) => { if (input) posts++; return []; };
  const denied = panel(disk, { work: work(), api, beforeAction: async () => { throw new ApiError('/owned-sources', 400, 'invalid_text'); }, refresh: async () => {} });
  await denied.flush(); await denied.click('Retry unresolved action'); assert.deepEqual(actions.read(), pending); assert.equal(posts, 0); denied.unmount();
  const gate = deferred(), navigated = panel(disk, { work: work(), api, beforeAction: () => gate.promise, refresh: async () => {} });
  await navigated.flush(); await navigated.click('Retry unresolved action'); navigated.unmount(); gate.resolve(); await navigated.flush();
  assert.equal(posts, 0); assert.deepEqual(actions.read(), pending);
});
test('pending requests written before work context tagging retain their exact body on reload', () => {
  const disk = storage(), input = { commandId: 'original', sourceId: 'source', content: '{"n":1}', expectedRevision: 2 };
  disk.setItem('workagent-maintenance:one:pending', JSON.stringify({ key: 'publish', path: '/owned-sources', input }));
  const actions = new MaintenanceActions(disk, 'one'), pending = actions.prepare('publish', '/owned-sources', { content: 'changed' }, () => 'new');
  assert.deepEqual(pending.input, input); assert.equal(pending.workId, 'one'); actions.accepted(pending); assert.equal(actions.read(), null);
});
