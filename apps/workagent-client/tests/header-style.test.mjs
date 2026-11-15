// Behavioral selector/cascade check on the actual App host tree with nested SDK
// header fixtures. No browser layout engine or DOM library is installed here;
// native toolbar geometry remains Parent's live-browser check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mountApp, memoryStorage, SheetCharts } from './sheet-scale-harness.mjs';
import { mountConditionalEditor } from './conditional-editor-harness.mjs';
const require = createRequire(import.meta.resolve('vite'));
const css = require('postcss').parse(readFileSync(new URL('../src/style.css', import.meta.url), 'utf8'));

function elements(tree, parent = null) {
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, parent));
  if (!tree?.props) return [];
  if (typeof tree.type !== 'string') return elements(tree.props.children, parent);
  const node = { tag: tree.type, classes: (tree.props.className ?? '').split(/\s+/), attributes: tree.props, inputType: tree.props.type, hidden: tree.props.hidden, pressed: tree.props['aria-pressed'], parent };
  return [node, ...elements(tree.props.children, node)];
}
// The app stylesheet uses type/class and exact attribute-equality selectors, descendant/child combinators
// and max-width media queries for these properties. Fail on unhandled syntax
// that could affect headers/selects instead of silently declaring isolation.
function matches(node, selector) {
  const parts = selector.trim().split(/\s+/);
  const compound = (node, part) => {
    if (!node) return false;
    if (part.endsWith('[hidden]')) { if (!node.hidden) return false; part = part.slice(0, -8); }
    assert.match(part, /^(?:[\w-]+|\*)?(?:\.[\w-]+)*(?:\[[\w-]+="[\w-]+"\])*$/);
    const attributes = [...part.matchAll(/\[([\w-]+)="([\w-]+)"\]/g)];
    const [tag, ...classes] = part.replace(/\[[\w-]+="[\w-]+"\]/g, '').split('.');
    const value = name => node.attributes?.[name] ?? (name === 'type' ? node.inputType : name === 'aria-pressed' ? node.pressed : undefined);
    return (!tag || tag === '*' || node.tag === tag) && classes.every(c => node.classes.includes(c))
      && attributes.every(([, name, expected]) => value(name) !== undefined && String(value(name)) === expected);
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
      const specificity = (selector.match(/\.|\[/g)?.length ?? 0) * 100 + (selector.match(/(?:^|[\s>])[a-z][\w-]*/g)?.length ?? 0);
      rule.walkDecls(decl => {
        const rank = specificity + (decl.important ? 10000 : 0);
        if (rank >= (priority[decl.prop] ?? -1)) { result[decl.prop] = decl.value; priority[decl.prop] = rank; }
      });
    }
  });
  return result;
}
test('exact input-type selector distinguishes file inputs from text and header nodes', () => {
  const parent = { tag: 'section', classes: ['document-exchange'], parent: null };
  const selector = '.document-exchange input[type="file"]';
  assert.equal(matches({ tag: 'input', classes: [], inputType: 'file', parent }, selector), true);
  assert.equal(matches({ tag: 'input', classes: [], inputType: 'text', parent }, selector), false);
  assert.equal(matches({ tag: 'header', classes: [], parent }, selector), false);
  assert.throws(() => matches({ tag: 'input', classes: [], parent }, 'input[unknown]'));
});

// Check the actual panel's CSS contract, not computed geometry. Parent verifies
// the bounded scrollers and native grid with a real desktop/mobile browser.
for (const width of [1440, 360, 390, 430]) test(`chart controls have bounded nonshrinking scroll and contained widths at ${width}px`, () => {
  const controller={view:()=>({charts:[],data:{},status:''}),subscribe:()=>()=>{},tabs:()=>[{id:'sheet1',name:'Long sheet name '.repeat(20)}],stage(){}};
  const panel=mountConditionalEditor(SheetCharts,{controller});
  try {
    panel.find(n=>n.type==='button'&&n.props.children==='Add chart').props.onClick();panel.flush();
    const nodes=elements(panel.tree),section=nodes.find(n=>n.classes.includes('sheet-charts'));
    const style=applied(section,width);
    assert.equal(style['flex-shrink'],'0');assert.equal(style['min-height'],'8rem');
    assert.equal(style['max-height'],'var(--chart-pane-height)');
    assert.equal(style['--chart-pane-height'],width<=760?'clamp(8rem, 22dvh, 12rem)':'clamp(8rem, 24dvh, 14rem)');
    const svg=applied({tag:'svg',classes:[],parent:section},width);
    assert.equal(svg.width,'100%');assert.equal(svg.height,'auto');
    assert.equal(svg['max-height'],'calc(var(--chart-pane-height) - 22px)');
    assert.equal(style.overflow,'auto');assert.equal(style['max-width'],'100%');assert.equal(style['overflow-wrap'],'anywhere');
    const fieldset=nodes.find(n=>n.tag==='fieldset');assert.ok(fieldset);
    assert.equal(applied(fieldset,width)['min-width'],'0');assert.equal(applied(fieldset,width)['flex-wrap'],'wrap');
    for(const node of nodes.filter(n=>['input','select'].includes(n.tag))){const s=applied(node,width);assert.equal(s.width,'100%');assert.equal(s['min-width'],'0');assert.equal(s['max-width'],'100%');if(width<=760)assert.equal(s['font-size'],'16px');}
    const values={tag:'div',classes:['sheet-chart-values'],parent:section};
    assert.equal(applied(values,width).overflow,'auto');assert.equal(applied(values,width)['max-width'],'100%');
    const workspace={tag:'div',classes:['native-sheet-workspace'],parent:null};
    assert.equal(applied(workspace,width).overflow,'auto');assert.equal(applied(workspace,width)['min-height'],'0');
    const grid={tag:'div',classes:['native-editor'],parent:workspace};
    assert.equal(applied(grid,width).flex,'1 0 320px');assert.equal(applied(grid,width)['min-height'],width<=760?'min(320px, 55dvh)':'320px');
    for(const name of ['csv-exchange','document-exchange','native-editor']){
      const unrelated={tag:'div',classes:[name],parent:null};
      const select={tag:'select',classes:[],parent:unrelated};
      assert.equal(applied(select,width)['max-width'],undefined);
      assert.equal(applied({tag:'svg',classes:[],parent:unrelated},width)['max-height'],undefined);
      assert.notEqual(applied(unrelated,width).flex,'1 0 320px');
    }
  } finally {panel.dispose();}
});
for (const width of [1200, 760, 360, 390, 430]) test(`app header owns desktop/responsive styles at ${width}px; nested sheet/document headers stay isolated`, async () => {
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

test('exact role/type attribute equality preserves values, absent attributes and child boundaries', () => {
  const parent = {tag:'div',classes:['google-exchange'],parent:null};
  const node = {tag:'p',classes:[],attributes:{role:'status',type:'file'},parent};
  assert.equal(matches(node, '.google-exchange > [role="status"]'), true);
  assert.equal(matches(node, '[role="alert"]'), false);
  assert.equal(matches({...node,attributes:{}}, '[role="status"]'), false);
  assert.equal(matches({...node,attributes:{role:'Status'}}, '[role="status"]'), false);
  assert.equal(matches({...node,parent:{tag:'div',classes:[],parent}}, '.google-exchange > [role="status"]'), false);
  assert.equal(matches(node, '[type="file"][role="status"]'), true);
  assert.equal(matches(node, '[type="text"][role="status"]'), false);
  assert.equal(matches({...node,attributes:{type:'file'}}, '[type="file"][role="status"]'), false);
  for (const selector of ['[role~="status"]','[role]','[role="status"','[role="status"]garbage']) assert.throws(() => matches(node, selector));
});
