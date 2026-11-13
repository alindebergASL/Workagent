// Deterministic ownership/lifecycle seam with the installed render registry and
// DocSelectionRenderService.focus(). Event/DOM fixtures are NOT browser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const require = createRequire(import.meta.resolve('@univerjs/preset-docs-core'));
const core = require('@univerjs/core');
const sdk = require('@univerjs/preset-docs-core');
const code = ts.transpileModule(readFileSync(new URL('../src/editor-focus.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(require, module, module.exports);
const { installEditorFocus } = module.exports;
function fixture(shared) {
  const listeners = shared?.listeners ?? new Map();
  const document = shared?.document ?? { activeElement: null, addEventListener(type, fn, capture) { assert.equal(capture, true); (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn); }, removeEventListener(type, fn) { listeners.get(type)?.delete(fn); } };
  const emit = (type, extra = {}) => { const event = { target: document.activeElement, key: '', defaultPrevented: false, ...extra }; for (const fn of listeners.get(type) ?? []) fn(event); return event; };
  const element = (name, { native = false, app = true, input = false } = {}) => ({ name, native, selectionStart: 2, selectionEnd: 6, selectionDirection: 'backward', value: 'Set up this work', closest: () => app ? {} : null, matches: () => input, focus() { document.activeElement = this; emit('focusin'); } });
  const prompt = element('prompt', { input: true }), title = element('new work', { input: true });
  const exchange = element('exchange', { input: true });
  const native = element('native', { native: true });
  const toolbar = element('toolbar', { native: true, input: true });
  const popup = element('portal', { native: true, app: false, input: true });
  const button = element('app button');
  const container = { ownerDocument: document, contains: e => e === native || e === toolbar };
  const layout = { checkElementInCurrentContainers: e => !!e?.native };
  const univer = new core.Univer(); univer.registerPlugin(sdk.UniverRenderEnginePlugin);
  const manager = univer.__getInjector().get(sdk.IRenderManagerService);
  const host = { __getInjector: () => ({ get: token => token === sdk.ILayoutService ? layout : token === sdk.IRenderManagerService ? manager : assert.fail('unexpected dependency') }) };
  const release = installEditorFocus(host, container);
  // The SDK's onReady registration must retain our earlier per-instance class.
  const defaults = manager.registerRenderModule(core.UniverInstanceType.UNIVER_DOC, [sdk.DocSelectionRenderService]);
  const deps = manager._getRenderDepsByType(core.UniverInstanceType.UNIVER_DOC);
  assert.equal(deps.length, 1);
  const Owned = deps[0][1].useClass;
  assert.ok(Owned.prototype instanceof sdk.DocSelectionRenderService);
  // Preserve the installed constructor's DI metadata through subclassing.
  for (const symbol of Object.getOwnPropertySymbols(sdk.DocSelectionRenderService)) assert.equal(Owned[symbol], sdk.DocSelectionRenderService[symbol]);
  let focusCalls = 0;
  const service = Object.create(Owned.prototype);
  service._ensureHostContainer = () => {};
  service._input = { hasAttribute: () => true, focus(options) { assert.deepEqual(options, { preventScroll: true }); focusCalls++; native.focus(); } };
  return { document, emit, prompt, title, exchange, native, toolbar, popup, button, service, manager, get focusCalls() { return focusCalls; }, listeners, release, close() { release(); defaults.dispose(); univer.dispose(); } };
}
for (const kind of ['sheet hidden editor', 'document editor']) {
  test(`${kind}: late mount/refresh focus preserves current app input, caret, selection and ordinary typing`, () => {
    const f = fixture();
    try {
      for (const input of [f.prompt, f.title, f.exchange]) {
        input.focus();
        const selection = [input.selectionStart, input.selectionEnd, input.selectionDirection];
        for (const text of ['Set up thi', 's work']) {
          f.service.focus(); // Delayed SDK lifecycle/refresh, between keystrokes.
          assert.equal(f.document.activeElement, input);
          f.emit('keydown', { key: 's' }); input.value += text;
          f.emit('beforeinput');
        }
        assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], selection);
      }
      assert.equal(f.focusCalls, 0, 'no blur/refocus and no replay of stale input selection');
    } finally { f.close(); }
  });
}
test('native pointer entry, own toolbar/portal inputs, and keyboard navigation remain usable', () => {
  const f = fixture();
  try {
    f.prompt.focus(); f.emit('pointerdown', { target: f.native }); f.service.focus();
    assert.equal(f.document.activeElement, f.native); assert.equal(f.focusCalls, 1);
    for (const input of [f.toolbar, f.popup]) { input.focus(); f.service.focus(); assert.equal(f.document.activeElement, f.native); }
    f.prompt.focus(); f.emit('keydown', { key: 'Tab' }); f.service.focus(); assert.equal(f.document.activeElement, f.native);
    f.prompt.focus(); const tab = f.emit('keydown', { key: 'Tab' }); tab.defaultPrevented = true;
    f.service.focus(); assert.equal(f.document.activeElement, f.prompt, 'prevented navigation grants no focus');
    f.button.focus(); f.service.focus(); assert.equal(f.document.activeElement, f.native, 'no app input means no focus trap');
  } finally { f.close(); }
});
test('a new app focus/typing/composition revokes prior native intent; no mount-time owner is restored', () => {
  const f = fixture();
  try {
    f.prompt.focus(); f.emit('pointerdown', { target: f.native }); f.title.focus();
    f.service.focus(); assert.equal(f.document.activeElement, f.title);
    for (const type of ['keydown', 'beforeinput', 'compositionstart']) {
      f.emit('pointerdown', { target: f.native }); f.emit(type, { key: 'x' });
      f.service.focus(); assert.equal(f.document.activeElement, f.title);
    }
    f.emit('pointerdown', { target: f.native }); f.emit('pointerdown', { target: f.title });
    f.service.focus(); assert.equal(f.document.activeElement, f.title);
  } finally { f.close(); }
});
test('Tab grant expires without moving focus, and disposal fences late SDK callbacks/remounts', async () => {
  const first = fixture();
  first.prompt.focus(); first.emit('keydown', { key: 'Tab' });
  await new Promise(resolve => setTimeout(resolve, 5));
  first.service.focus(); assert.equal(first.document.activeElement, first.prompt);
  first.release(); assert.ok([...first.listeners.values()].every(set => set.size === 0));
  assert.equal(first.manager._getRenderDepsByType(core.UniverInstanceType.UNIVER_DOC).length, 0);
  first.button.focus(); first.service.focus(); assert.equal(first.document.activeElement, first.button);
  first.prompt.focus();
  const next = fixture(first);
  try {
    next.service.focus(); assert.equal(first.document.activeElement, first.prompt, 'remount while typing preserves the live owner');
    next.title.focus(); first.service.focus(); next.service.focus(); assert.equal(next.document.activeElement, next.title);
    next.emit('pointerdown', { target: next.native }); next.service.focus(); assert.equal(next.document.activeElement, next.native);
  } finally { next.close(); first.close(); }
});
