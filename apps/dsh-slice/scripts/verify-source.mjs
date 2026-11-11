// Selected method structure comparison, NOT a whole-package attestation.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const upstream = fileURLToPath(new URL('../../../.local/upstream/dsh/', import.meta.url));
const app = fileURLToPath(new URL('../', import.meta.url));
const checks = [
  ['api/session-controller', 'dsh-api-session-controller', 'index.ts', ['create', 'prompt', 'events', 'follow', 'wait', 'state', 'updateQueue', 'cancel']],
  ['llm/llm', 'dsh-llm', 'index.ts', ['stream', 'registerAdapter', 'prepareCall', 'resolveCallConfig']],
  ['core/session', 'dsh-session', 'repair.ts', ['observe', 'results']],
  ['core/agent-loop', 'dsh-agent-loop', 'agent.ts', ['followup', 'steer', 'cancel', 'preStep', 'toolsChanged']],
];
function methods(tree, names) {
  const map = new Map();
  function walk(node) {
    if (ts.isMethodDeclaration(node) && node.body && names.includes(node.name.getText(tree))) map.set(node.name.getText(tree), node.body);
    ts.forEachChild(node, walk);
  }
  walk(tree); return map;
}
function normalize(node) {
  if (ts.isParenthesizedExpression(node)) return normalize(node.expression);
  if ((ts.isIdentifier(node) && node.text === 'undefined') || (ts.isVoidExpression(node) && ts.isNumericLiteral(node.expression) && node.expression.text === '0')) return ['UNDEFINED'];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return ['STRING', node.text];
  if (ts.isTemplateLiteralToken(node)) return [ts.SyntaxKind[node.kind], node.text];
  if (ts.isNumericLiteral(node)) return ['NUMBER', Number(node.text)];
  if (ts.isIdentifier(node)) return ['IDENTIFIER', node.text.replace(/\$\d+$/, '')];
  if (ts.isBlock(node) && node.statements.length === 1) return normalize(node.statements[0]);
  if (ts.isEmptyStatement(node) || (ts.isBlock(node) && node.statements.length === 0)) return ['EMPTY'];
  if (ts.isExpressionStatement(node) && ts.isVoidExpression(node.expression)) return ['ExpressionStatement', normalize(node.expression.expression)];
  const children = [];
  if (typeof node.operator === 'number') children.push(['operator', ts.SyntaxKind[node.operator]]);
  ts.forEachChild(node, child => { children.push(normalize(child)); });
  return [ts.SyntaxKind[node.kind], ...children];
}
for (const [path, pkg, file, names] of checks) {
  const source = readFileSync(`${upstream}/packages/${path}/src/${file}`, 'utf8');
  const installed = readFileSync(`${app}/node_modules/@deepseek-ai/${pkg}/lib/index.js`, 'utf8');
  const manifest = JSON.parse(readFileSync(`${app}/node_modules/@deepseek-ai/${pkg}/package.json`, 'utf8'));
  assert.equal(manifest.version, '0.2.2-rc.1');
  const emitted = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext } }).outputText;
  const sourceMethods = methods(ts.createSourceFile('source.js', emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), names);
  const installedMethods = methods(ts.createSourceFile('installed.js', installed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), names);
  for (const name of names) {
    assert.ok(sourceMethods.has(name) && installedMethods.has(name), `Missing ${pkg}.${name}`);
    assert.deepEqual(normalize(installedMethods.get(name)), normalize(sourceMethods.get(name)), `${pkg}.${name}: selected source method differs`);
  }
  console.log(`${pkg}@${manifest.version}: ${names.join(', ')} match selected source structure`);
  console.log(`  installed lib/index.js SHA256 ${createHash('sha256').update(installed).digest('hex')}`);
}
console.log('Normalizations: parentheses, undefined/void 0, single-statement blocks, ignored void, bundle alias suffixes. Not full artifact equivalence.');
