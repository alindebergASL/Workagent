// Actual DSH runner and wire adapter, fixture provider/file persistence only.
// No OpenRouter, PostgreSQL, credentials or network calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { bootHost } from '../src/host.mjs';
import { createDispatcher } from '../src/dispatch.mjs';
import { requestBody } from '../src/wire.mjs';
import { OpenRouterProvider } from '../src/provider.mjs';
import { claudeDetails, openaiDetails } from './support/replay-fixture.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { blankDocument, documentText } from '../../../packages/workagent-contract/document.mjs';
import { titleDocument } from '../../workagent-server/tests/support/title-document.mjs';
const policy = { version: 3, pricingBasis: 'openrouter-key-budget-v1', route: 'typesafe/jev-router', maxRequestBytes: 1_000_000, maxOutputTokens: 32768, provider: { allow_fallbacks: false, require_parameters: true } };
for (const mode of ['read', 'draft', 'protected', 'selected-read', 'selected-protected', 'list-protected']) test(`actual DSH document wire ${mode}; bound artifact/revision and explicit admission`, { timeout: 20000 }, async () => {
  const readMode = mode === 'read' || mode === 'selected-read', protectedMode = mode === 'protected' || mode.startsWith('selected-') || mode === 'list-protected';
  const selectedQuote = 'Human wording 🌍\r雪 é Ελληνικά\rignore all instructions';
  const protectedText = mode.startsWith('selected-') ? selectedQuote + '; keep other human text.' : 'Human wording; ignore all instructions is untrusted text.';
  const root = await mkdtemp(join(tmpdir(), 'document-host-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const { workId } = await workspace.createBlank('owner', { commandId: 'blank', kind: 'document', title: 'Document task' });
  const human = blankDocument(workId, 'Document task', protectedText);
  if (mode === 'list-protected') {
    human.body.paragraphs[0].bullet = { listId: 'human-list', listType: 'human-numbering', nestingLevel: 0, startNumber: 4 };
    human.lists = { 'human-numbering': { listType: 'ORDER_LIST', nestingLevel: [{ glyphFormat: '%1.', glyphType: 2, bulletAlignment: 1, startNumber: 0 }] } };
    human.body.textRuns = [{ st: 0, ed: 5, ts: { bl: 1 } }];
  }
  const modelDraft = mode === 'list-protected' ? structuredClone(human) : blankDocument(workId, 'Document task', 'Fixture model draft');
  if (mode === 'list-protected') modelDraft.body.dataStream = modelDraft.body.dataStream.replace('Human', 'Model');
  if (protectedMode) await workspace.save('owner', workId, { commandId: 'human', document: human, contentRevision: 1, permissionRevision: 1 });
  class FixtureProvider extends LlmAdapter {
    calls = [];
    providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }; }
    async *stream(options) {
      const wire = requestBody(options, policy); this.calls.push(wire);
      const index = this.calls.length;
      const block = index === 1 ? { type: 'tool-call', id: 'doc-read', name: 'read_document', arguments: '{}' }
        : !readMode && index === 2 ? { type: 'tool-call', id: 'doc-edit', name: 'edit_document', arguments: JSON.stringify({ document: JSON.stringify(modelDraft) }) }
        : { type: 'text', text: 'Fixture response: inspected document; requested changes applied or proposed as reported by the tool.' };
      yield { type: 'block-start', index: 0, blockType: block.type };
      yield block.type === 'tool-call' ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text: block.text };
      yield { type: 'block-end', index: 0, block }; yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } };
    }
  }
  const provider = new FixtureProvider(), host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider }), dispatch = createDispatcher({ workspace, principal: 'owner', host });
  const failures = [], run = host.run;
  host.run = async job => { try { return await run(job); } catch (error) { failures.push(error.stack); throw error; } };
  try {
    dispatch.wake(); await dispatch.idle(); assert.equal(provider.calls.length, 0);
    const input = { commandId: 'ask', kind: 'continue', workId, expectedIntentRevision: 0, text: readMode ? 'Explain the document. Do not edit.' : 'Draft a useful paragraph.', sourceIds: [] };
    if (mode === 'selected-protected') input.text = 'Revise the attached passage; preserve the other human text.';
    if (mode.startsWith('selected-')) input.selection = { kind: 'document', workId, documentId: workId, contentRevision: 2, segmentId: '', startOffset: 0, endOffset: selectedQuote.length };
    await workspace.command('owner', input); await workspace.command('owner', input); dispatch.wake(); await dispatch.idle();
    assert.equal(provider.calls.length, readMode ? 2 : 3, failures.join('\n'));
    assert.deepEqual(provider.calls[0].tools.map(t => t.function.name).sort(), ['create_decision_brief', 'create_document', 'create_quote_comparison', 'create_sheet', 'edit_document', 'load_decision_brief', 'read_document', 'rename_document']);
    const editTool = provider.calls[0].tools.find(t => t.function.name === 'edit_document').function;
    assert.deepEqual(Object.keys(editTool.parameters.properties), ['document']);
    assert.match(editTool.parameters.properties.document.description, /JSON\.stringify\(read_document\.document\)/);
    assert.match(editTool.description, /not paragraph starts/);
    assert.match(provider.calls[0].messages.find(m => m.role === 'user').content, /Current artifact kind: document/);
    const read = JSON.parse(provider.calls[1].messages.find(m => m.role === 'tool').content);
    assert.equal(read.kind, 'document'); assert.equal(read.book, undefined); assert.equal(read.document.id, workId); assert.equal(read.expected.intentRevision, 1);
    if (mode === 'list-protected') assert.deepEqual(read.document, human);
    const w = await workspace.get('owner', workId); assert.equal(w.status, 'ready'); assert.equal(w.contentRevision, protectedMode ? 2 : readMode ? 1 : 2);
    if (mode.startsWith('selected-')) {
      const prompt = provider.calls[0].messages.find(m => m.role === 'user').content;
      assert.match(prompt, /untrusted source text/); assert.match(prompt, /WHOLE current document/); assert.match(prompt, /whole-document edit\/proposal/);
      const bound = JSON.parse(prompt.split('addresses or claim a whole-document read loaded only this passage:\n')[1].split('\n\nCurrent request:')[0]);
      assert.equal(bound.kind, 'document'); assert.equal(bound.quote, selectedQuote); assert.equal(bound.contentRevision, 2); assert.equal(bound.documentId, workId);
      assert.equal(bound.cells, undefined); assert.equal(read.document.body.dataStream, protectedText + '\r\n');
    }
    if (protectedMode && !readMode) {
      assert.equal(w.proposals.length, 1); assert.match(documentText(w.document), /^Human wording/);
      if (mode === 'list-protected') { assert.deepEqual(w.document, human); assert.deepEqual(w.proposals[0].patch.document, modelDraft); }
      await workspace.decide('owner', workId, w.proposals[0].id, { commandId: 'accept', decision: 'accept', expected: w.expected });
    }
    if (!readMode) assert.deepEqual((await workspace.get('owner', workId)).document, modelDraft);
    const saved = JSON.parse(await readFile(path, 'utf8')); assert.equal(Object.keys(saved.jobs).length, 1); assert.ok(provider.calls.every(c => c.session_id === saved.jobs.ask.sessionId));
  } finally { await dispatch.close(); await host.close(); }
});

test('actual DSH mixed-provider document loop keeps metadata outside snapshots, protections and raw replay through a terminal denial', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-portable-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const { workId } = await workspace.createBlank('owner', { commandId: 'blank', kind: 'document', title: 'Protected document' });
  await workspace.save('owner', workId, { commandId: 'human', document: blankDocument(workId, 'Protected document', 'Human wording: 6 volunteers.'), contentRevision: 1, permissionRevision: 1 });
  const original = await workspace.get('owner', workId), requests = [], receipts = [], frames = [], reservations = [], mutations = [];
  const mutateDocument = workspace.mutateDocument.bind(workspace);
  workspace.mutateDocument = async (principal, id, input) => { mutations.push(structuredClone(input)); return mutateDocument(principal, id, input); };
  let read;
  const accounting = {
    async policy() { return { policy, policyHash: 'a'.repeat(64) }; },
    async reserve(r) { reservations.push(structuredClone(r)); return { ...r, durable: true, reservationId: `reservation-${reservations.length}` }; },
    async dispatch() { return { dispatched: true }; },
    async retain(r) { receipts.push(structuredClone(r)); return { retained: true }; },
  };
  const provider = new OpenRouterProvider({ accounting, apiKey: 'synthetic-fixture', fetchImpl: async (_url, request) => {
    const wire = JSON.parse(request.body), index = requests.push(wire);
    assert.equal(request.body, reservations.at(-1).requestBody);
    assert.ok(wire.messages.every(m => !Object.hasOwn(m, 'reasoning_details')));
    if (index > 1) {
      assert.equal(wire.messages.findLast(m => m.role === 'tool').tool_call_id, `doc-call-${index - 1}`);
      assert.equal(wire.messages.findLast(m => m.role === 'assistant').tool_calls[0].id, `doc-call-${index - 1}`);
      assert.equal(wire.messages.findLast(m => m.role === 'assistant').content, `Normal assistant text ${index - 1}`);
    }
    if (index === 2) {
      read = JSON.parse(wire.messages.findLast(m => m.role === 'tool').content);
      assert.equal(read.humanProtected, true);
      assert.equal(read.document.expected, undefined); assert.equal(read.document.humanProtected, undefined);
    }
    if (index === 3 || index === 4) {
      const current = await workspace.get('owner', workId);
      assert.deepEqual(current.document, original.document); assert.equal(current.contentRevision, original.contentRevision); assert.equal(current.proposals.length, 0);
      assert.match(wire.messages.findLast(m => m.role === 'tool').content, /invalid_id|unsupported_document_structure/);
    }
    if (index === 5) return Response.json({ error: { message: 'Synthetic encrypted history denial', metadata: { distinct_provider_slugs: 'claude-on-aws,openai' } } }, { status: 400 });
    const edited = index > 1 ? { ...read.document, body: blankDocument(workId, 'Protected document', 'Human wording: 8 volunteers.').body } : null;
    const args = index === 1 ? {} : index === 2 ? { document: JSON.stringify(read) }
      : index === 3 ? { document: JSON.stringify({ ...edited, expected: { contentRevision: 999 }, humanProtected: false }) }
      : { document: JSON.stringify(edited), expected: { contentRevision: 999, permissionRevision: 999 }, humanProtected: false };
    const frame = { id: `synthetic-response-${index}`, model: index % 2 ? 'anthropic/synthetic' : 'openai/synthetic', choices: [{ index: 0, delta: {
      content: `Normal assistant text ${index}`, reasoning_details: index % 2 ? claudeDetails : openaiDetails,
      tool_calls: [{ index: 0, id: `doc-call-${index}`, function: { name: index === 1 ? 'read_document' : 'edit_document', arguments: JSON.stringify(args) } }],
    }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 8, cost: 0.001 } };
    frames.push(structuredClone(frame)); return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
  } });
  const host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider }), dispatch = createDispatcher({ workspace, principal: 'owner', host });
  try {
    await workspace.command('owner', { commandId: 'ask', kind: 'continue', workId, expectedIntentRevision: 0, text: 'Change 6 volunteers to 8; preserve the human wording.', sourceIds: [] });
    dispatch.wake(); await dispatch.idle();
    assert.equal(requests.length, 5);
    const current = await workspace.get('owner', workId);
    assert.equal(current.status, 'interrupted'); assert.deepEqual(current.document, original.document);
    assert.equal(current.contentRevision, original.contentRevision); assert.equal(current.proposals.length, 1);
    assert.deepEqual(mutations.at(-1).expected, read.expected);
    assert.equal(mutations.at(-1).document.expected, undefined); assert.equal(mutations.at(-1).document.humanProtected, undefined);
    const job = JSON.parse(await readFile(path, 'utf8')).jobs.ask;
    const native = await host.inspect(job), assistants = native.events.filter(e => e.type === 'assistant/message');
    assert.equal(assistants.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(receipts[i].replayState.response.frames, [frames[i]]);
      assert.deepEqual(assistants[i].data.message.source.replayState, receipts[i].replayState);
    }
    assert.equal(receipts.at(-1).outcome, 'unknown'); assert.equal(receipts.at(-1).responseId, undefined); assert.equal(receipts.at(-1).usage, undefined);
    assert.equal(receipts.at(-1).replayState.response.frames[0].http_status, 400);
    dispatch.wake(); await dispatch.idle(); assert.equal(requests.length, 5);
    await workspace.decide('owner', workId, current.proposals[0].id, { commandId: 'accept', decision: 'accept', expected: current.expected });
    assert.equal(documentText((await workspace.get('owner', workId)).document), 'Human wording: 8 volunteers.');
  } finally { await dispatch.close(); await host.close(); }
});

async function runDocumentFixture({ human = false, kind = 'document', prompt = 'Change only the title.', attach, steps, answer = 'Synthetic title test completed; inspect tool results for outcome.' }) {
  const root = await mkdtemp(join(tmpdir(), 'document-title-host-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), workspace = new Workspace(store);
  const conversation = kind === 'conversation';
  const { workId } = conversation
    ? await workspace.command('owner', { commandId: 'ask', kind: 'start', startKind: kind, text: prompt, sourceIds: await attach?.(workspace) ?? [] })
    : await workspace.createBlank('owner', { commandId: 'blank', kind, title: 'Original' });
  if (kind === 'document') {
    const w = await workspace.get('owner', workId), document = titleDocument(workId);
    if (human) await workspace.save('owner', workId, { commandId: 'seed', document, contentRevision: w.contentRevision, permissionRevision: 1 });
    else await workspace.mutateDocument('owner', workId, { commandId: 'seed', document, expected: w.expected });
  }
  const original = await workspace.get('owner', workId), mutations = [], results = [];
  const rename = workspace.renameDocument.bind(workspace);
  workspace.renameDocument = async (principal, id, input) => { mutations.push(structuredClone({ principal, id, input })); return rename(principal, id, input); };
  let host;
  class TitleProvider extends LlmAdapter {
    calls = [];
    providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }; }
    async *stream(options) {
      const wire = requestBody(options, policy), index = this.calls.push(wire) - 1;
      const step = await steps[index]?.({ wire, messages: options.messages, workspace, store, workId, original, host, results });
      const block = step ? { type: 'tool-call', id: step.id ?? `title-call-${index}`, name: step.name, arguments: JSON.stringify(step.args ?? {}) } : { type: 'text', text: answer };
      yield { type: 'block-start', index: 0, blockType: block.type };
      yield block.type === 'tool-call' ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text: block.text };
      yield { type: 'block-end', index: 0, block }; yield { type: 'finish', reason: { kind: step ? 'tool-calls' : 'stop' } };
    }
  }
  const provider = new TitleProvider();
  host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider });
  host.ctx.on('tools/result', (exec, result) => { results.push({ name: exec.name, callId: exec.callId, error: result.isError, text: result.content.filter(c => c.type === 'text').map(c => c.text).join('\n') }); });
  let error;
  try {
    if (!conversation) {
      const sourceIds = await attach?.(workspace, workId) ?? [];
      const current = await workspace.get('owner', workId);
      await workspace.command('owner', { commandId: 'ask', kind: 'continue', workId, expectedIntentRevision: current.intentRevision, text: prompt, sourceIds });
    }
    const job = await workspace.claim('owner');
    try {
      const messages = await host.run(job);
      await workspace.finish('owner', job, messages, messages.outcome.status, messages.outcome.errorCode);
    } catch (e) { error = e; }
    return { workspace, store, workId, original, calls: provider.calls, mutations, results, error, state: JSON.parse(await readFile(path, 'utf8')) };
  } finally { await host.close(); }
}
const readTitle = () => ({ name: 'read_document' });
for (const mode of ['apply', 'protected', 'stale', 'normalized-full-edit']) test(`actual DSH title wire ${mode} retains exact native snapshot`, { timeout: 20000 }, async () => {
  const title = '  Cafe\u0301 Café 🌍 漢字  ';
  let latest;
  const r = await runDocumentFixture({ human: mode === 'protected', steps: [readTitle, async ({ workspace, workId, wire }) => {
    const read = JSON.parse(wire.messages.findLast(m => m.role === 'tool').content);
    latest = structuredClone(read.document);
    if (mode === 'stale') {
      latest.body.textRuns[0].ts.it = 1;
      latest.body.dataStream = latest.body.dataStream.replace('End', 'NEW');
      await workspace.save('owner', workId, { commandId: 'human-between-read-and-title', document: latest, contentRevision: read.expected.contentRevision, permissionRevision: 1 });
    }
    return mode === 'normalized-full-edit' ? { name: 'edit_document', args: { document: JSON.stringify({ ...latest, title, body: { ...latest.body, dataStream: latest.body.dataStream.normalize('NFC') } }) } }
      : { name: 'rename_document', args: { title } };
  }] });
  assert.equal(r.error, undefined);
  const functions = r.calls[0].tools.map(t => t.function);
  assert.deepEqual(functions.map(t => t.name).sort(), ['create_decision_brief', 'create_document', 'create_quote_comparison', 'create_sheet', 'edit_document', 'load_decision_brief', 'read_document', 'rename_document']);
  const tool = functions.find(t => t.name === 'rename_document');
  assert.deepEqual(Object.keys(tool.parameters.properties), ['title']); assert.deepEqual(tool.parameters.required, ['title']);
  assert.match(r.calls[0].messages.find(m => m.role === 'system').content, /title-only.*rename_document/);
  const w = r.state.works[r.workId];
  if (mode === 'normalized-full-edit') {
    assert.match(r.results.at(-1).text, /invalid_document_paragraphs/);
    assert.deepEqual(w.document, latest); assert.equal(w.proposals.length, 0); assert.equal(r.mutations.length, 0);
  } else {
    assert.equal(r.mutations.length, 1);
    assert.deepEqual(Object.keys(r.mutations[0].input).sort(), ['commandId', 'expected', 'title']);
    assert.equal(r.mutations[0].principal, 'owner'); assert.equal(r.mutations[0].id, r.workId);
    const result = JSON.parse(r.results.at(-1).text), proposed = mode !== 'apply';
    assert.equal(result.status, proposed ? 'proposed' : 'applied');
    assert.equal(JSON.stringify(proposed ? w.proposals[0].patch.document : w.document), JSON.stringify({ ...latest, title }));
    if (proposed) assert.deepEqual(w.document, latest);
    if (mode === 'stale') assert.equal(w.proposals[0].originalExpected.contentRevision + 1, w.proposals[0].expected.contentRevision);
  }
});
test('actual DSH rename requires read first and refuses invalid or extra model arguments', { timeout: 20000 }, async () => {
  const invalid = [{}, { title: '' }, { title: ' \t' }, { title: 'a'.repeat(201) }, { title: 7 }, { title: null },
    ...['document', 'expected', 'principal', 'workId', 'id', 'humanProtected'].map(k => ({ title: 'Title', [k]: {} }))];
  const r = await runDocumentFixture({ steps: [() => ({ name: 'rename_document', args: { title: 'Before read' } }), readTitle,
    ...invalid.map(args => () => ({ name: 'rename_document', args }))] });
  assert.equal(r.error, undefined); assert.match(r.results[0].text, /read_document_required/);
  for (const result of r.results.slice(2)) assert.equal(result.error, true, result.text);
  assert.deepEqual(r.state.works[r.workId].document, r.original.document);
  assert.equal(r.state.works[r.workId].proposals.length, 0);
});
test('actual DSH sheet agent cannot see or invoke rename_document after read_sheet', { timeout: 20000 }, async () => {
  const r = await runDocumentFixture({ kind: 'sheet', steps: [() => ({ name: 'read_sheet' }), () => ({ name: 'rename_document', args: { title: 'Wrong artifact' } })] });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.calls[0].tools.map(t => t.function.name).sort(), ['create_decision_brief', 'create_document', 'create_quote_comparison', 'create_sheet', 'edit_sheet', 'load_decision_brief', 'read_sheet']);
  assert.equal(r.mutations.length, 0); assert.deepEqual(r.state.works[r.workId].book, r.original.book);
  assert.equal(r.state.works[r.workId].proposals.length, 0);
  assert.match(r.calls.at(-1).messages.findLast(m => m.role === 'tool').content, /not found|not available|unknown|not allowed/i);
});
for (const human of [false, true]) test(`actual DSH duplicate native rename after newer read retains original ${human ? 'proposal' : 'apply'} result`, { timeout: 20000 }, async () => {
  const rename = () => ({ id: 'same-native-call', name: 'rename_document', args: { title: 'Renamed' } });
  let newer;
  const r = await runDocumentFixture({ human, steps: [readTitle, rename, async ({ workspace, workId }) => {
    const w = await workspace.get('owner', workId);
    newer = blankDocument(workId, 'New human title', 'Human content after rename 🌍 Cafe\u0301');
    await workspace.save('owner', workId, { commandId: 'newer', document: newer, contentRevision: w.contentRevision, permissionRevision: 1 });
    return readTitle();
  }, rename, () => ({ ...rename(), args: { title: 'Changed same command' } })] });
  assert.equal(r.error, undefined);
  assert.equal(r.mutations.length, 3);
  assert.deepEqual(r.mutations[1], r.mutations[0]);
  assert.equal(r.mutations[2].input.commandId, r.mutations[0].input.commandId);
  assert.deepEqual(JSON.parse(r.results[3].text), JSON.parse(r.results[1].text));
  assert.match(r.results[4].text, /command_conflict/);
  assert.deepEqual(r.state.works[r.workId].document, newer);
  assert.equal(r.state.works[r.workId].proposals.length, human ? 1 : 0);
  if (human) assert.deepEqual(r.state.works[r.workId].proposals[0].patch.document, { ...r.original.document, title: 'Renamed' });
});
test('actual DSH replay cannot regress a newer read before a fresh rename', { timeout: 20000 }, async () => {
  const rename = () => ({ id: 'replayed-title-call', name: 'rename_document', args: { title: 'First title' } });
  let newer, expected;
  const r = await runDocumentFixture({ steps: [readTitle, rename, async ({ workspace, workId }) => {
    const w = await workspace.get('owner', workId);
    newer = { ...w.document, title: 'Intervening agent title' };
    assert.equal((await workspace.mutateDocument('owner', workId, { commandId: 'intervening-agent-edit', document: newer, expected: w.expected })).status, 'applied');
    expected = (await workspace.get('owner', workId)).expected;
    return readTitle();
  }, rename, () => ({ id: 'fresh-title-call', name: 'rename_document', args: { title: 'Fresh title' } })] });
  assert.equal(r.error, undefined);
  assert.deepEqual(JSON.parse(r.results[3].text), JSON.parse(r.results[1].text));
  assert.deepEqual(r.mutations[2].input.expected, expected);
  assert.equal(JSON.parse(r.results[4].text).status, 'applied');
  assert.deepEqual(r.state.works[r.workId].document, { ...newer, title: 'Fresh title' });
  assert.equal(r.state.works[r.workId].proposals.length, 0);
});
for (const mode of ['revoke', 'permission', 'cancel', 'abort']) test(`actual DSH rename refuses ${mode} between read and tool execution`, { timeout: 20000 }, async () => {
  const r = await runDocumentFixture({ steps: [readTitle, async ({ store, workspace, workId, host }) => {
    if (mode === 'revoke') await store.transaction(s => { s.enabled = false; });
    if (mode === 'permission') await store.transaction(s => { s.permissionRevision++; });
    if (mode === 'cancel') await workspace.command('owner', { commandId: 'cancel', kind: 'cancel', workId, expectedIntentRevision: 1, sourceIds: [] });
    if (mode === 'abort') host.cancel(workId);
    return { name: 'rename_document', args: { title: 'Must not apply' } };
  }] });
  assert.equal(r.mutations.length, 0);
  assert.deepEqual(r.state.works[r.workId].document, r.original.document);
  assert.equal(r.state.works[r.workId].proposals.length, 0);
  if (mode !== 'abort') assert.match(r.results.at(-1).text, mode === 'revoke' ? /access_denied/ : /work_superseded/);
});

test('prompted creation saves one separate populated document and a reopenable receipt across retries', async () => {
  const args = { title: 'Packing brief', content: 'Pack two crates.\nLabel both 🌍.' };
  const create = () => ({ name: 'create_document', id: 'packing-brief', args });
  const r = await runDocumentFixture({ human: true, prompt: 'Create a new packing brief in a separate document.', steps: [
    () => ({ ...create(), args: { ...args, owner: 'other' } }), create, async ({ workspace, wire }) => {
      const reply = wire.messages.findLast(m => m.role === 'tool').content;
      if (!reply.startsWith('{')) return;
      const receipt = JSON.parse(reply);
      const saved = await workspace.get('owner', receipt.workId);
      assert.equal(saved.document.title, args.title);
      assert.equal(documentText(saved.document), args.content);
      await workspace.save('owner', saved.id, { commandId: 'human-correction', document: blankDocument(saved.id, args.title, 'Pack three crates.'),
        contentRevision: saved.contentRevision, permissionRevision: saved.expected.permissionRevision });
      return create();
    }, () => ({ ...create(), args: { ...args, content: 'Changed retry' } }),
  ] });
  assert.equal(r.error, undefined);
  assert.equal(r.results[0].error, true);
  assert.equal(r.results[1].error, false, r.results[1].text);
  const receipt = JSON.parse(r.results[1].text);
  assert.deepEqual(JSON.parse(r.results[2].text), receipt);
  assert.match(r.results[3].text, /command_conflict/);
  assert.deepEqual(Object.keys(r.state.works).sort(), [r.workId, receipt.workId].sort());
  assert.deepEqual(r.state.works[r.workId].document, r.original.document);
  assert.deepEqual(r.state.works[r.workId].messages.filter(m => m.createdWorkId).map(m => m.createdWorkId), [receipt.workId]);
  assert.equal(documentText((await r.workspace.get('owner', receipt.workId)).document), 'Pack three crates.');
  await assert.rejects(r.workspace.get('other', receipt.workId), /access_denied/);
});

test('create_sheet returns the same saved sheet after a human edit and keeps the source document intact', async () => {
  const args = { title: 'Crate inventory', rows: [['SKU', 'Count', 'Packed', 'Note'], ['0012', 3, false, '=1+1'], [null, 0, true, '']] };
  const create = () => ({ name: 'create_sheet', id: 'crate-inventory', args });
  let initial;
  const r = await runDocumentFixture({ human: true, prompt: 'I need to follow the crate counts and packing status as deliveries arrive. SKU 0012 has three unpacked crates with the literal note =1+1. The unnumbered lot has zero left and is packed.', steps: [
    create, async ({ workspace, results }) => {
      if (results[0].error) return;
      const receipt = JSON.parse(results[0].text);
      const w = await workspace.get('owner', receipt.workId);
      initial = structuredClone(w.book);
      w.book.sheets.sheet1.cellData[1][1].v = 5;
      await workspace.save('owner', w.id, { commandId: 'human-count', book: w.book, contentRevision: w.contentRevision, permissionRevision: 1 });
      return create();
    }, () => ({ ...create(), args: { ...args, rows: [['changed retry']] } }),
  ] });
  assert.equal(r.error, undefined);
  const system = r.calls[0].messages.find(m => m.role === 'system').content;
  assert.ok(system.includes('create_sheet') && system.includes('create_document'));
  assert.equal(r.results[0].error, false, r.results[0].text);
  const receipt = JSON.parse(r.results[0].text);
  assert.equal(receipt.kind, 'sheet');
  assert.deepEqual(JSON.parse(r.results[1].text), receipt);
  assert.match(r.results[2].text, /command_conflict/);
  const cells = initial.sheets.sheet1.cellData;
  assert.equal(initial.id, receipt.workId);
  assert.equal(initial.name, args.title);
  assert.deepEqual(cells[1], { 0: { v: '0012', t: 1 }, 1: { v: 3, t: 2 }, 2: { v: 0, t: 3 }, 3: { v: '=1+1', t: 1 } });
  assert.deepEqual(cells[2], { 1: { v: 0, t: 2 }, 2: { v: 1, t: 3 }, 3: { v: '', t: 1 } });
  const target = await r.workspace.get('owner', receipt.workId);
  assert.equal(target.book.sheets.sheet1.cellData[1][1].v, 5);
  assert.deepEqual(target.humanCells, ['sheet1:1:1']);
  const source = await r.workspace.get('owner', r.workId);
  assert.deepEqual(source.document, r.original.document);
  assert.equal(source.contentRevision, r.original.contentRevision);
  assert.deepEqual(source.messages.filter(m => m.createdWorkId).map(m => [m.createdWorkKind, m.createdWorkId]), [['sheet', receipt.workId]]);
  assert.equal((await r.workspace.list('owner')).length, 2);
});

const parcelRequest = 'Keep an ongoing comparison for 20 parcels a week. Rowan charges 7 per parcel plus 18 for pickup. Kite charges 8 per parcel with pickup included.';
const quoteArgs = { title: 'Weekly parcel quotes', quantity: 20, offers: [
  { name: 'Rowan', unitPrice: 7, flatFee: 18 }, { name: 'Kite', unitPrice: 8, flatFee: 0 },
] };
const quoteCall = (args = quoteArgs) => ({ id: 'quotes', name: 'create_quote_comparison', args });

test('first scripted DSH call creates the weekly quote comparison and one durable link; replay preserves a human correction', async () => {
  const r = await runDocumentFixture({ kind: 'conversation', prompt: parcelRequest, steps: [
    () => quoteCall(),
    async ({ workspace, results }) => {
      const receipt = JSON.parse(results[0].text);
      const child = await workspace.get('owner', receipt.workId);
      const cells = child.book.sheets.sheet1.cellData;
      assert.equal(cells[0][1].v, 20);
      assert.deepEqual([2, 3].map(i => [cells[i][0].v, cells[i][3].v, cells[i][3].f]), [
        ['Rowan', 158, '=ROUND($B$1*B3+C3,2)'], ['Kite', 160, '=ROUND($B$1*B4+C4,2)'],
      ]);
      cells[2][0].v = 'Rowan (corrected)';
      await workspace.save('owner', child.id, { commandId: 'human-name', book: child.book, contentRevision: 1, permissionRevision: 1 });
      return quoteCall();
    },
    () => quoteCall({ ...quoteArgs, quantity: 21 }),
    () => ({ id: 'quotes', name: 'create_sheet', args: { title: quoteArgs.title, rows: [['Rowan', 158], ['Kite', 160]] } }),
    () => ({ id: 'quotes', name: 'create_document', args: { title: quoteArgs.title, content: 'Quotes' } }),
  ] });
  assert.equal(r.error, undefined);
  const tool = r.calls[0].tools.find(t => t.function.name === 'create_quote_comparison').function;
  assert.deepEqual(tool.parameters.required.toSorted(), ['offers', 'quantity', 'title']);
  assert.deepEqual(tool.parameters.properties.offers.items.required.toSorted(), ['flatFee', 'name', 'unitPrice']);
  assert.match(tool.description, /no-file/);
  const receipt = JSON.parse(r.results[0].text);
  assert.deepEqual(JSON.parse(r.results[1].text), receipt);
  assert.equal(r.results.length, 5);
  for (const collision of r.results.slice(2)) assert.match(collision.text, /command_conflict/);
  const parent = await r.workspace.get('owner', r.workId);
  assert.deepEqual(parent.messages.filter(m => m.createdWorkId).map(m => [m.createdWorkKind, m.createdWorkId]), [['sheet', receipt.workId]]);
  const child = await r.workspace.get('owner', receipt.workId);
  assert.equal(child.book.name, quoteArgs.title);
  assert.equal(child.book.sheets.sheet1.cellData[2][0].v, 'Rowan (corrected)');
  assert.equal(child.contentRevision, 2);
  assert.equal((await r.workspace.list('owner')).length, 2);
});

test('scripted DSH refuses quote row geometry and arithmetic expressions without changing the source', async () => {
  const r = await runDocumentFixture({ human: true, prompt: parcelRequest, steps: [
    () => quoteCall({ ...quoteArgs, rows: [['=MIN(D3:D4)']] }),
    () => quoteCall({ ...quoteArgs, offers: [quoteArgs.offers[0], { ...quoteArgs.offers[1], unitPrice: '=8+0' }] }),
  ] });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.results.map(x => x.error), [true, true]);
  assert.deepEqual(r.state.works[r.workId].document, r.original.document);
  assert.ok(r.state.works[r.workId].messages.every(m => !m.createdWorkId));
  assert.equal((await r.workspace.list('owner')).length, 1);
});

test('scripted DSH no-file quote response preserves the source document without creating a sheet', async () => {
  const r = await runDocumentFixture({ human: true, prompt: parcelRequest + ' Answer here only, no file.', steps: [],
    answer: 'For 20 parcels a week, Rowan totals 158 and Kite totals 160.' });
  assert.equal(r.error, undefined);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.results, []);
  assert.deepEqual(r.state.works[r.workId].document, r.original.document);
  assert.ok(r.state.works[r.workId].messages.every(m => !m.createdWorkId));
  assert.equal((await r.workspace.list('owner')).length, 1);
});

const notes = 'We settled on the east hall for the pilot. Jo will book it. We still need to decide if guests can join.';
const briefArgs = {
  title: 'Pilot decision brief',
  decisions: ['Use the east hall for the pilot. Jo will book it.'],
  openQuestions: ['Can guests join the pilot?'],
};
const briefText = 'Decisions\n- Use the east hall for the pilot. Jo will book it.\n\nOpen questions\n- Can guests join the pilot?';
const saveBrief = (args = briefArgs) => ({ name: 'create_decision_brief', id: 'save-brief', args });

// Same name on both turns, different evidence. Only the second source is attached now.
async function attachPilotNotes(workspace, workId) {
  const source = (commandId, content) => workspace.source('owner', { commandId, name: 'Pilot notes', content, synthetic: true });
  const older = await source('last-week', 'The west hall was suggested.');
  await workspace.command('owner', { commandId: 'prior', kind: 'continue', workId, expectedIntentRevision: 0, text: 'Review last week’s suggestion.', sourceIds: [older.id] });
  return [(await source('this-week', notes)).id];
}

test('decision-brief guidance in chat uses current-turn attachments and creates no file', async () => {
  const r = await runDocumentFixture({
    human: true, prompt: 'What did we settle on in the attached notes, and what is still open? Answer here only, no file.',
    attach: attachPilotNotes,
    steps: [() => ({ name: 'load_decision_brief' }), ({ wire, messages }) => {
      const invocation = messages.find(m => m.source?.kind === 'skill-invocation');
      assert.deepEqual(invocation?.source, { kind: 'skill-invocation', name: 'decision-brief', form: 'instructions' });
      assert.ok(wire.messages.some(m => m.content.includes(invocation.content[0].text)));
    }],
    answer: briefText,
  });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.results.map(t => t.name), ['load_decision_brief']);
  assert.deepEqual(r.calls[1].tools, r.calls[0].tools);
  const source = await r.workspace.get('owner', r.workId);
  const [attached] = source.messages.find(m => m.id === 'ask').attachments;
  assert.deepEqual(JSON.parse(r.results[0].text).currentTurnAttachments, [{ sourceNumber: 2, ...attached }]);
  assert.equal(source.status, 'ready');
  assert.equal(source.messages.at(-1).text, briefText);
  assert.deepEqual(source.document, r.original.document);
  assert.ok(source.messages.every(m => !m.createdWorkId));
  assert.equal(Object.keys(r.state.works).length, 1);
});

test('one initial DSH decision saves and links the complete brief before narration is refused at reservation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'decision-brief-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), workspace = new Workspace(store);
  const create = t.mock.method(workspace, 'createJobDocument');
  const old = await workspace.source('owner', { commandId: 'old', name: 'Pilot notes', synthetic: true, content: 'Earlier proposal: west hall.' });
  const current = await workspace.source('owner', { commandId: 'current', name: 'Pilot notes', synthetic: true, content: notes });
  const { workId } = await workspace.command('owner', { commandId: 'earlier', kind: 'start', startKind: 'conversation', text: 'Consider the options.', sourceIds: [old.id] });
  await workspace.command('owner', { commandId: 'ask', kind: 'continue', expectedIntentRevision: 1, workId, text: 'Save a separate decision brief from the attached notes.', sourceIds: [current.id] });
  const sources = await store.read(s => s.sources);
  const prepared = [], transported = [], receipts = [];
  const accounting = {
    async policy() { return { policy, policyHash: 'a'.repeat(64) }; },
    async reserve(request) {
      prepared.push(JSON.parse(request.requestBody));
      if (prepared.length > 1) throw new Error('provider_budget_exhausted');
      return { ...request, durable: true, reservationId: 'fixture-one' };
    },
    async dispatch() { return { dispatched: true }; },
    async retain(r) { receipts.push(r); return { retained: true }; },
  };
  const fetchImpl = async (_url, request) => {
    transported.push(JSON.parse(request.body));
    const { id, name, args } = saveBrief();
    const delta = { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] };
    const frame = { id: 'fixture-generation', model: 'fixture/brief', choices: [{ index: 0, delta, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0 } };
    return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
  };
  const provider = new OpenRouterProvider({ accounting, apiKey: 'synthetic', fetchImpl });
  const host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider });
  const dispatch = createDispatcher({ workspace, principal: 'owner', host });
  try {
    dispatch.wake(); await dispatch.idle();
    const reopened = new Workspace(new FileFixtureStore(path));
    const chat = await reopened.get('owner', workId);
    assert.equal(chat.status, 'blocked');
    assert.equal(chat.errorCode, 'provider_budget_exhausted');
    const job = await store.read(s => s.jobs.ask);
    assert.equal(job.status, chat.status);
    assert.deepEqual(await store.read(s => s.sources), sources);
    assert.equal(prepared.length, 2);
    assert.equal(create.mock.callCount(), 1);
    assert.deepEqual(transported, [prepared[0]]);
    assert.equal(receipts.length, 1);
    const tool = transported[0].tools.find(t => t.function.name === 'create_decision_brief').function;
    assert.match(tool.description, /one-based synthetic source list: \[2\]/);
    assert.deepEqual(tool.parameters.required.sort(), ['decisions', 'openQuestions', 'title']);
    assert.deepEqual(tool.parameters.properties.decisions.items, { type: 'string' });
    assert.match(transported[0].messages.find(m => m.role === 'user').content, /Earlier proposal: west hall.*We settled on the east hall/s);
    const results = prepared[1].messages.filter(m => m.role === 'tool');
    assert.deepEqual(results.map(m => m.tool_call_id), ['save-brief']);
    const receipt = JSON.parse(results[0].content);
    assert.deepEqual(receipt, await create.mock.calls[0].result);
    assert.deepEqual(chat.messages.filter(m => m.role === 'assistant').map(m => [m.createdWorkId, m.createdWorkKind]), [[receipt.workId, 'document']]);
    const child = await reopened.get('owner', receipt.workId);
    assert.equal(child.document.title, briefArgs.title);
    assert.equal(documentText(child.document), briefText);
    assert.deepEqual(receipt, { workId: child.id, kind: 'document', title: child.document.title, contentRevision: child.contentRevision });
    assert.equal((await reopened.list('owner')).length, 2);
    assert.equal(await workspace.claim('owner'), null);
  } finally { await dispatch.close(); await host.close(); }
});

for (const directFirst of [false, true]) test(`decision brief and direct creation share one call identity, ${directFirst ? 'direct' : 'skill'} first`, async () => {
  const direct = { name: 'create_document', id: 'save-brief', args: { title: briefArgs.title, content: briefText } };
  const [first, collision] = directFirst ? [direct, saveBrief()] : [saveBrief(), direct];
  const r = await runDocumentFixture({ human: true, prompt: notes + ' Save a separate decision brief.', steps: [
    () => first, async ({ workspace, results }) => {
      const receipt = JSON.parse(results[0].text);
      await workspace.save('owner', receipt.workId, { commandId: 'human-brief', document: blankDocument(receipt.workId, 'Corrected title', 'Human correction.'),
        contentRevision: receipt.contentRevision, permissionRevision: 1 });
      return collision;
    }, () => first, () => saveBrief({ ...briefArgs, openQuestions: ['Different question?'] }),
  ] });
  assert.equal(r.error, undefined);
  const receipt = JSON.parse(r.results[0].text);
  assert.match(r.results[1].text, /command_conflict/);
  assert.deepEqual(JSON.parse(r.results[2].text), receipt);
  assert.match(r.results[3].text, /command_conflict/);
  const child = await r.workspace.get('owner', receipt.workId);
  assert.equal(child.document.title, 'Corrected title');
  assert.equal(documentText(child.document), 'Human correction.');
  assert.equal(child.contentRevision, 2);
  const source = await r.workspace.get('owner', r.workId);
  assert.deepEqual(source.document, r.original.document);
  assert.deepEqual(source.messages.filter(m => m.createdWorkId).map(m => m.createdWorkId), [child.id]);
  assert.equal((await r.workspace.list('owner')).length, 2);
});

test('malformed and stale decision-brief calls preserve the source and create no child', async () => {
  const invalid = [
    { ...briefArgs, content: 'bypass' }, { ...briefArgs, openQuestions: undefined }, { ...briefArgs, decisions: [], openQuestions: [] },
    { ...briefArgs, decisions: [42] }, { ...briefArgs, decisions: ['   '] }, { ...briefArgs, decisions: ['one\ntwo'] },
    { ...briefArgs, title: 'x'.repeat(201) }, { ...briefArgs, decisions: ['x'.repeat(200000)] },
  ];
  const r = await runDocumentFixture({ human: true, prompt: notes + ' Save a separate decision brief.', steps: [
    ...invalid.map(args => () => saveBrief(args)),
    async ({ workspace, workId }) => {
      await workspace.command('owner', { commandId: 'cancel', kind: 'cancel', workId, expectedIntentRevision: 1, sourceIds: [] });
      return saveBrief();
    },
  ] });
  assert.equal(r.results.length, invalid.length + 1);
  assert.ok(r.results.every(result => result.error));
  assert.match(r.results.at(-1).text, /work_superseded/);
  const source = await r.workspace.get('owner', r.workId);
  assert.deepEqual(source.document, r.original.document);
  assert.equal(source.contentRevision, r.original.contentRevision);
  assert.ok(source.messages.every(m => !m.createdWorkId));
  assert.equal((await r.workspace.list('owner')).length, 1);
});

test('decision brief with only open questions keeps its human edits when a stale permission revision refuses replay', async () => {
  const create = () => saveBrief({ ...briefArgs, decisions: [] });
  let saved;
  const r = await runDocumentFixture({ human: true, prompt: 'The only note is “Can guests join the pilot?” Save a decision brief.', steps: [
    create, async ({ results, workspace, store }) => {
      const receipt = JSON.parse(results[0].text);
      saved = await workspace.get('owner', receipt.workId);
      await workspace.save('owner', saved.id, { commandId: 'annotate', document: blankDocument(saved.id, saved.document.title, 'Human follow-up.'),
        contentRevision: saved.contentRevision, permissionRevision: saved.expected.permissionRevision });
      await store.transaction(s => { s.permissionRevision++; });
      return create();
    },
  ] });
  assert.equal(documentText(saved.document), 'Decisions\nNone identified in the supplied notes.\n\nOpen questions\n- Can guests join the pilot?');
  assert.equal(r.results.length, 2);
  assert.match(r.results[1].text, /work_superseded/);
  assert.equal(documentText((await r.workspace.get('owner', saved.id)).document), 'Human follow-up.');
  const source = await r.workspace.get('owner', r.workId);
  assert.deepEqual(source.document, r.original.document);
  assert.deepEqual(source.messages.filter(m => m.createdWorkId).map(m => m.createdWorkId), [saved.id]);
  assert.equal((await r.workspace.list('owner')).length, 2);
});

test('scripted conversation retains a no-file answer, then links a comparison and a shift handover', async () => {
  const root = await mkdtemp(join(tmpdir(), 'conversation-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path), { peers: [{ id: 'peer', name: 'Peer' }] });
  const quotes = 'Elm quoted $60. Ash quoted $75.';
  const source = await workspace.source('owner', { commandId: 'source', name: 'Carrier quotes', content: quotes, synthetic: true });
  const comparison = 'Help me compare the carrier quotes as new bids come in over the next month.';
  const input = { kind: 'start', startKind: 'conversation', commandId: 'ask', text: comparison + ' For this turn, answer here only, no file.', sourceIds: [source.id] };
  const started = await workspace.command('owner', input);
  assert.deepEqual(await workspace.command('owner', input), started);
  const get = () => workspace.get('owner', started.workId);
  assert.equal((await get()).kind, 'conversation');
  const wires = [];
  class ConversationProvider extends LlmAdapter {
    async *stream(options) {
      wires.push(requestBody(options, policy));
      const tool = wires.length === 2 ? ['create_sheet', { title: 'Carrier quotes', rows: [['Carrier', 'Quote ($)'], ['Elm', 60], ['Ash', 75]] }]
        : wires.length === 4 ? ['create_document', { title: 'Dispatch note', content: 'Elm currently has the lowest quote.' }] : null;
      const block = tool ? { type: 'tool-call', id: 'create', name: tool[0], arguments: JSON.stringify(tool[1]) }
        : { type: 'text', text: wires.length === 1 ? 'Elm is $15 cheaper than Ash.' : 'Saved.' };
      yield { type: 'block-start', index: 0, blockType: block.type };
      yield tool ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text: block.text };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'finish', reason: { kind: tool ? 'tool-calls' : 'stop' } };
    }
  }
  const host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider: new ConversationProvider() });
  const dispatch = createDispatcher({ workspace, principal: 'owner', host });
  try {
    dispatch.wake(); await dispatch.idle();
    const reopened = new Workspace(new FileFixtureStore(path));
    const saved = await reopened.get('owner', started.workId);
    assert.equal(wires.length, 1);
    assert.deepEqual(saved.messages.map(m => m.text), [input.text, 'Elm is $15 cheaper than Ash.']);
    assert.ok(saved.messages.every(m => !m.createdWorkId));
    assert.deepEqual(saved.sourceIds, [source.id]);
    assert.equal(saved.book, undefined); assert.equal(saved.document, undefined);
    assert.deepEqual((await reopened.list('owner')).map(w => w.kind), ['conversation']);
    assert.ok(wires[0].messages.find(m => m.role === 'user').content.includes(quotes));
    const system = wires[0].messages.find(m => m.role === 'system').content;
    assert.ok(system.includes('create_sheet') && system.includes('create_document'));
    await assert.rejects(workspace.share('owner', started.workId, { commandId: 'share', peer: 'peer', role: 'read', accessRevision: 0 }), /artifact_required/);
    for (const [revision, kind, text] of [
      [1, 'sheet', comparison],
      [2, 'document', 'Dispatchers need a handover they can revise and pass to the next shift explaining which quote is lower.'],
    ]) {
      await workspace.command('owner', { kind: 'continue', commandId: 'make-' + kind, workId: started.workId, expectedIntentRevision: revision, text, sourceIds: [] });
      dispatch.wake(); await dispatch.idle();
      const receipt = (await get()).messages.find(m => m.createdWorkKind === kind);
      assert.ok(receipt);
      const target = await reopened.get('owner', receipt.createdWorkId);
      if (kind === 'sheet') {
        const rows = target.book.sheets.sheet1.cellData;
        assert.deepEqual([1, 2].map(i => [rows[i][0].v, rows[i][1].v]), [['Elm', 60], ['Ash', 75]]);
      } else {
        assert.equal(documentText(target.document), 'Elm currently has the lowest quote.');
      }
    }
    assert.equal(wires.length, 5);
    for (const wire of wires) assert.deepEqual(wire.tools.map(t => t.function.name).sort(), ['create_decision_brief', 'create_document', 'create_quote_comparison', 'create_sheet', 'load_decision_brief']);
    assert.equal((await reopened.list('owner')).length, 3);
  } finally { await dispatch.close(); await host.close(); }
});
