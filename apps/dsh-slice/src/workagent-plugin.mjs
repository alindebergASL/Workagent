import { PROVIDER } from './fixture-provider.mjs';
import { registerFixtureTools, registerComparisonTool } from './fixture-tools.mjs';
import { registerFakeEffect } from './fake-effect.mjs';

// A small Workagent host plugin, composed entirely against DSH public services.
export const name = 'workagent-fixture';
export const inject = ['llm', 'tools', 'subagents'];
export function apply(ctx, { provider, toolCalls, fakeEffects, constraints }) {
  ctx.llm.registerAdapter([PROVIDER], provider);
  registerFixtureTools(ctx, toolCalls);
  registerComparisonTool(ctx, sessionId => constraints.get(sessionId));
  registerFakeEffect(ctx, fakeEffects);
}
