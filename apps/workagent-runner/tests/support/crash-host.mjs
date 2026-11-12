// A subprocess exits without disposal at an actual public DSH durability boundary.
import { join } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { bootHost } from '../../src/host.mjs';
import { Workspace } from '../../../workagent-server/src/workspace.mjs';
import { FileFixtureStore } from '../../../workagent-server/tests/support/file-fixture.mjs';
const [root, boundary] = process.argv.slice(2);
const ws = new Workspace(new FileFixtureStore(join(root, 'state.json')));
const job = await ws.claim('owner'), checkpoint = ws.checkpoint.bind(ws);
ws.checkpoint = async (...args) => {
  if ((boundary === 'native_created' && args[2] === 'session_ready') || (boundary === 'native_prompt' && args[2] === 'prompt_accepted')) process.exit(78);
  const result = await checkpoint(...args);
  if (args[2] === boundary) process.exit(78);
  return result;
};
class NeverProvider extends LlmAdapter { async *stream() { throw new Error('unexpected_fixture_dispatch'); } }
const host = await bootHost({ stateRoot: root, workspace: ws, principal: 'owner', provider: new NeverProvider() });
await host.run(job);
process.exit(79);
