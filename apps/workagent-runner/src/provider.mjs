import { LlmAdapter, attributionHeaders } from '@deepseek-ai/dsh-llm';
import { streamOpenRouter, DEFAULT_MODEL } from './wire.mjs';
export class OpenRouterProvider extends LlmAdapter {
  constructor(dependencies) { super(); this.dependencies = dependencies; }
  async listModels() { return [{ id: DEFAULT_MODEL, name: 'Jev Router' }]; }
  providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }; }
  stream(options) {
    this.dependencies.beforeRequest?.(options.sessionId);
    return streamOpenRouter(options, { ...this.dependencies, attribution: attributionHeaders(), beforeDispatch: () => this.dependencies.authorize?.(options.sessionId) });
  }
}
