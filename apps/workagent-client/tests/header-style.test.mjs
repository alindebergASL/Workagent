// Behavioral selector/cascade check on the actual App host tree with nested SDK
// header fixtures. No browser layout engine or DOM library is installed here;
// native toolbar geometry remains Parent's live-browser check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mountApp, memoryStorage } from './sheet-scale-harness.mjs';
const require = createRequire(import.meta.resolve('vite'));
const css = require('postcss').parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));

function elements(tree, parent = null) {
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, parent));
  if (!tree?.props) return [];
  if (typeof tree.type !== 'string') return elements(tree.props.children, parent);
  const node = { tag: tree.type, classes: (tree.props.className ?? '').split(/\s+/), parent };
  return [node, ...elements(tree.props.children, node)];
}
// The app stylesheet uses type/class selectors, descendant/child combinators
// and max-width media queries for these properties. Fail on unhandled syntax
// that could affect headers/selects instead of silently declaring isolation.
function matches(node, selector) {
  const parts = selector.trim().split(/\s+/);
  const compound = (node, part) => {
    if (!node) return false;
    assert.match(part, /^(?:[\w-]+|\*)?(?:\.[\w-]+)*$/);
    const [tag, ...classes] = part.split('.');
    return (!tag || tag === '*' || node.tag === tag) && classes.every(c => node.classes.includes(c));
  };
  let i = parts.length - 1;
  if (!compound(node, parts[i--])) return false;
  while (i >= 0) {
    node = node.parent;
    if (parts[i] === '>') { if (!compound(node, parts[--i])) return false; }
    else { while (node && !compound(node, parts[i])) node = node.parent; if (!node) return false; }
    i--;
  }
  return true;
}
function applied(node, width) {
  const result = {}, priority = {};
  css.walkRules(rule => {
    for (let p = rule.parent; p?.type !== 'root'; p = p.parent) {
      assert.equal(p.name, 'media');
      const query = /^\(max-width:\s*(\d+)px\)$/.exec(p.params); assert.ok(query, p.params);
      if (width > Number(query[1])) return;
    }
    for (const selector of rule.selectors) {
      // Fixture nodes are neither focused nor disabled, and aren't the root.
      if (selector.includes(':')) continue;
      if (!matches(node, selector)) continue;
      const specificity = (selector.match(/\./g)?.length ?? 0) * 100 + (selector.match(/(?:^|[\s>])[a-z][\w-]*/g)?.length ?? 0);
      rule.walkDecls(decl => {
        const rank = specificity + (decl.important ? 10000 : 0);
        if (rank >= (priority[decl.prop] ?? -1)) { result[decl.prop] = decl.value; priority[decl.prop] = rank; }
      });
    }
  });
  return result;
}
for (const width of [1200, 760, 390]) test(`app header owns desktop/responsive styles at ${width}px; nested sheet/document headers stay isolated`, async () => {
  const app = mountApp(memoryStorage(), async url => ({ ok: true, status: 200, json: async () => url === '/api/work' ? [] : { kind: 'reset', cursor: 0, events: [], works: [], snapshots: [] } }));
  try {
    await app.flush(); const nodes = elements(app.tree), header = nodes.find(n => n.tag === 'header');
    assert.ok(header, 'actual App renders its header');
    const select = nodes.find(n => n.tag === 'select' && n.parent === header);
    const style = applied(header, width), mobile = width <= 760;
    assert.equal(style.display, 'flex'); assert.equal(style.height, '65px');
    assert.equal(style.padding, mobile ? '0 14px' : '0 24px');
    assert.equal(style.gap, mobile ? '12px' : '24px'); assert.equal(style['align-items'], 'center');
    assert.equal(style['border-bottom'], '1px solid #dce2d9'); assert.equal(style.background, '#fff');
    assert.equal(applied(select, width)['max-width'], mobile ? '180px' : '350px');
    const workArea = nodes.find(n => n.classes.includes('work-area')); assert.ok(workArea);
    for (const kind of ['sheet', 'document']) {
      const editor = { tag: 'div', classes: ['native-editor', `${kind}-fixture`], parent: workArea };
      const nativeHeader = { tag: 'header', classes: [], parent: editor };
      const nativeSelect = { tag: 'select', classes: [], parent: nativeHeader };
      const nativeStyle = applied(nativeHeader, width);
      for (const property of ['display', 'height', 'padding', 'gap', 'align-items', 'border-bottom', 'background']) {
        assert.equal(nativeStyle[property], undefined, `${kind} header must receive no app ${property} declaration`);
      }
      assert.equal(applied(nativeSelect, width)['max-width'], undefined, `${kind} select must receive no app-header width`);
    }
  } finally { app.unmount(); }
});
