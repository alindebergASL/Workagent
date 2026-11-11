import { decideWorkshop } from './decision.mjs';
import { randomUUID } from 'node:crypto';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';

export const PROVIDER = 'workagent-fixture';
export const MODEL = 'scripted-v1';
export const FIXTURE_USAGE = Object.freeze({ inputTokens: 31, outputTokens: 17, totalTokens: 48, cacheReadTokens: 3, reasoningTokens: 2 });
export function replayFor(id) {
  return { response: { fixture: true, nativeResponseId: id, nativeItems: [{ type: 'reasoning', id: `reasoning-${id}`, encrypted: 'opaque-fixture-payload' }], usage: FIXTURE_USAGE }, blocks: [{ nativeItemId: `item-${id}`, annotations: [{ source: 'fixtures/venues.csv' }] }] };
}
const contentText = message => message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';

// Only the provider is scripted. DSH owns every step, tool execution and log.
export class FixtureProvider extends LlmAdapter {
  requests = [];
  constructor({ concurrentWorkers = false, beforeStream, journal } = {}) { super(); this.concurrentWorkers = concurrentWorkers; this.beforeStream = beforeStream; this.journal = journal; }
  async listModels() { return [{ id: MODEL, name: 'Scripted fixture (no model inference)' }]; }
  async *stream(options) {
    options.signal?.throwIfAborted();
    const id = `fixture-response-${randomUUID()}`;
    await this.journal?.accepted({ purpose: options.purpose, sessionId: options.sessionId, provider: options.provider, model: options.model, responseId: id });
    const request = { id, sessionId: options.sessionId, provider: options.provider, model: options.model, messages: structuredClone(options.messages) };
    this.requests.push(request);
    await this.beforeStream?.(request, options.signal);
    options.signal?.throwIfAborted();
    const userText = options.messages.filter(message => message.role === 'user').map(contentText).join('\n');
    const venue = /Inspect fictional venue: (Harbor Workshop|Garden Studio)/.exec(userText)?.[1];
    const constraintVersion = [...userText.matchAll(/Constraint version (\d+)/g)].at(-1)?.[1];
    const ceiling = [...userText.matchAll(/budget ceiling (\d+) cents/g)].at(-1)?.[1];
    const refreshIndex = options.messages.findLastIndex(message => message.role === 'user' && /Scheduled fixture follow-up|Recompare with constraint|Fixture effect:/.test(contentText(message)));
    const toolIndex = options.messages.findLastIndex(message => message.role === 'tool');
    const toolResult = toolIndex > refreshIndex ? options.messages[toolIndex] : undefined;
    const effectRequest = /Fixture effect:/.test(contentText(options.messages.findLast(message => message.role === 'user') ?? {}));
    let block;
    if (!toolResult) {
      block = { type: 'tool-call', id: ToolCallId(`${id}-call`), name: effectRequest ? 'reserve_fixture_venue' : this.concurrentWorkers && !venue ? 'compare_workshop' : 'workshop_budget', arguments: JSON.stringify(effectRequest ? { effectId: 'workshop-reservation-v1' } : { attendees: 16, ...(venue ? { venue } : {}) }) };
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments };
    } else {
      if (toolResult.isError) throw new Error(`Fixture tool failed: ${contentText(toolResult)}`);
      const budget = JSON.parse(contentText(toolResult));
      const report = { ...budget, ...(ceiling ? { budgetCeilingCents: Number(ceiling), constraintApplied: true, constraintVersion: constraintVersion ? Number(constraintVersion) : null } : {}) };
      const evaluation = effectRequest || venue ? null : budget.decision ?? decideWorkshop(budget.alternatives);
      const selected = evaluation?.selectedCandidateId ? budget.alternatives.find(item => item.candidateId === evaluation.selectedCandidateId) : null;
      const decision = selected ? `Recommend ${selected.venue} as the lowest-cost option that fits the group and recorded ceiling.` : 'Neither option meets the recorded constraints. Revise the ceiling or compare other venues.';
      const text = effectRequest ? `Fake reservation outcome: ${budget.state}. ${budget.message}` : venue ? JSON.stringify(report) : 'Scripted fixture recommendation: ' + budget.alternatives.map(item => `${item.venue} costs $${(item.totalCents / 100).toFixed(2)} for ${budget.attendees} attendees (${item.accessibility}).`).join(' ') + ' Source: fixtures/venues.csv. ' + decision;
      block = { type: 'text', text };
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: block.text };
    }
    yield { type: 'block-end', index: 0, block };
    await this.journal?.record({ kind: 'completed', responseId: id, usage: FIXTURE_USAGE, replayState: replayFor(id) });
    yield { type: 'usage', usage: { ...FIXTURE_USAGE } };
    yield { type: 'finish', reason: { kind: toolResult ? 'stop' : 'tool-calls' }, replayState: replayFor(id) };
  }
}
