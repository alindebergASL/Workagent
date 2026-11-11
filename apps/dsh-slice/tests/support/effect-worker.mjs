import { bootHost } from '../../src/host.mjs';
const host = await bootHost({ stateRoot: process.argv[2], concurrentWorkers: true,
  fakeEffectOptions: { loseAcknowledgement: true, onDispatch: () => new Promise(resolve => process.send({ type: 'effect-dispatched', sessionId }, resolve)) } });
const signal = new AbortController().signal;
const { sessionId } = await host.controller.create({ cwd: host.workDir });
await host.controller.prompt({ sessionId, requestId: 'workshop', mode: 'queue', content: [{ type: 'text', text: 'Compare the fictional workshop venues.' }] }, signal);
await host.controller.wait({ sessionId, timeoutMs: 5000 }, signal);
await host.controller.prompt({ sessionId, requestId: 'fake-reservation', mode: 'queue', content: [{ type: 'text', text: 'Fixture effect: reserve selected venue.' }] }, signal);
