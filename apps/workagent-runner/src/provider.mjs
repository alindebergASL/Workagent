import { LlmAdapter, attributionHeaders } from '@deepseek-ai/dsh-llm';
import { streamOpenRouter, DEFAULT_MODEL } from './wire.mjs';
export class OpenRouterProvider extends LlmAdapter {
  constructor(dependencies) { super(); this.dependencies = dependencies; }
  async listModels(provider) { return [{ provider, id: DEFAULT_MODEL, name: 'Jev Router' }]; }
  async resolveModel(provider, model) {
    // Adapter-owned effort choices. Omission leaves the router/provider default;
    // require_parameters keeps upstream capability denials authoritative.
    return { provider, id: model, name: model, reasoning: { efforts: ['low', 'medium', 'high'].map(id => ({ id, name: id })) } };
  }
  providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }; }
  stream(options) {
    this.dependencies.beforeRequest?.(options.sessionId);
    return streamOpenRouter(options, { ...this.dependencies, attribution: attributionHeaders(), beforeDispatch: () => this.dependencies.authorize?.(options.sessionId) });
  }
}
