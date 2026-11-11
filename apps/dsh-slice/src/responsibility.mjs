import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Product-owned state; never exposed as an agent filesystem tool.
export class Responsibility {
  constructor(host, root) {
    this.host = host;
    this.root = root;
    this.file = join(root, 'responsibility.json');
    this.serial = Promise.resolve();
  }
  async open() {
    await mkdir(this.root, { recursive: true });
    try { this.state = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = { version: 0, fixture: true, title: 'A workshop for 16 people', sessionId: null, constraint: { version: 1, budgetCents: 80000 }, scheduleId: null, humanText: null, revisions: [] };
    }
    if (this.state.sessionId) this.host.constraints.set(this.state.sessionId, this.state.constraint);
    return this;
  }
  exclusive(action) {
    const operation = this.serial.then(action);
    this.serial = operation.then(() => {}, () => {});
    return operation;
  }
  async save(next) {
    const temporary = `${this.file}.next`;
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, this.file);
    this.state = next;
  }
  async start() {
    return this.exclusive(async () => {
      if (this.state.sessionId) return this.view();
      const { sessionId } = await this.host.controller.create({ cwd: this.host.workDir });
      await this.save({ ...this.state, sessionId, version: this.state.version + 1 });
      this.host.constraints.set(sessionId, this.state.constraint);
      await this.host.controller.prompt({ sessionId, requestId: 'workshop-initial', mode: 'queue', content: [{ type: 'text', text: 'Compare the fictional workshop venues and calculate the budget for 16 attendees.' }] }, new AbortController().signal);
      return this.view();
    });
  }
  async readEvents() {
    if (!this.state.sessionId) return [];
    const page = await this.host.controller.events({ address: { kind: 'session', sessionId: this.state.sessionId }, maxMessages: 100 }, new AbortController().signal);
    return page.records.map(record => record.event);
  }
  async view() {
    const events = await this.readEvents();
    const tool = events.findLast(event => event.type === 'tool/result' && event.data.message?.content?.some(block => block.type === 'text' && block.text.includes('\"alternatives\"')));
    let budget = null;
    if (tool) {
      const message = tool.data.message;
      const text = message?.content?.find(block => block.type === 'text')?.text;
      if (text && !message.isError) budget = JSON.parse(text);
    }
    const final = events.findLast(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'text'));
    const generatedText = final?.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? null;
    const state = this.state.sessionId ? await this.host.controller.state({ sessionId: this.state.sessionId }, new AbortController().signal) : null;
    const constraintApplied = budget?.alternatives?.every(item => item.constraintVersion === this.state.constraint?.version) ?? false;
    const schedule = this.state.scheduleId ? await this.host.ctx.schedule.view({ id: this.state.scheduleId }) : null;
    return { ...this.state, budget, constraintApplied, schedule, generatedText, text: this.state.humanText ?? generatedText,
      running: state?.running ?? false, cursor: state?.cursor ?? -1,
      status: !this.state.sessionId ? 'new' : state?.running ? 'working' : generatedText ? (this.state.constraint && !constraintApplied ? 'needs-update' : 'ready') : 'interrupted',
      fixtureLabel: 'Scripted provider · fictional sources · no model inference or external effects' };
  }
  async steer({ budgetCents, version }) {
    return this.exclusive(async () => {
      if (!Number.isSafeInteger(budgetCents) || budgetCents < 100 || budgetCents > 100000000) {
        const error = new Error('Enter a whole-dollar budget from $1 to $1,000,000.'); error.status = 400; throw error;
      }
      if (version !== this.state.version) { const error = new Error('The responsibility changed. Reload and try again.'); error.status = 409; throw error; }
      if (!this.state.sessionId) { const error = new Error('Start the comparison first.'); error.status = 409; throw error; }
      const constraint = { version: (this.state.constraint?.version ?? 0) + 1, budgetCents };
      await this.save({ ...this.state, constraint, version: this.state.version + 1 });
      const sessionId = this.state.sessionId;
      this.host.constraints.set(sessionId, constraint);
      const signal = new AbortController().signal;
      const current = await this.host.controller.state({ sessionId }, signal);
      const children = await this.host.ctx.subagents.listChildren(sessionId, signal);
      const liveChildren = children.filter(child => this.host.ctx.agents.get(child.id)?.status === 'running');
      const text = `Constraint version ${constraint.version}: budget ceiling ${budgetCents} cents.`;
      const deliveries = await Promise.allSettled(liveChildren.map(child => this.host.ctx.subagents.prompt({
        parentSessionId: sessionId, childSessionId: child.id, mode: 'continuable',
        requestId: `constraint-${constraint.version}-${child.id}`, delivery: 'steer', content: [{ type: 'text', text }],
      }, signal)));
      await this.host.controller.prompt({ sessionId, requestId: `constraint-${constraint.version}-parent`, mode: current.running ? 'steer' : 'queue',
        content: [{ type: 'text', text: current.running ? text : `Recompare with constraint. ${text}` }] }, signal);
      return { ...(await this.view()), steeringReceipts: deliveries.map(result => result.status === 'fulfilled' ? { accepted: true, messageId: result.value.messageId } : { accepted: false, reason: result.reason.message }) };
    });
  }
  async schedule({ afterSeconds = 30 } = {}) {
    return this.exclusive(async () => {
      if (!this.state.sessionId) { const error = new Error('Start the comparison first.'); error.status = 409; throw error; }
      if (this.state.scheduleId) return this.view();
      const schedule = await this.host.ctx.schedule.create({ title: 'Recheck workshop budget', prompt: 'Scheduled fixture follow-up: recheck the fictional venue costs.',
        timing: { kind: 'after', after_seconds: afterSeconds }, target: { kind: 'session', sessionId: this.state.sessionId } }, this.state.sessionId, new AbortController().signal);
      await this.save({ ...this.state, scheduleId: schedule.id, version: this.state.version + 1 });
      return this.view();
    });
  }
  async edit({ text, version }) {
    return this.exclusive(async () => {
      if (version !== this.state.version) {
        const error = new Error('This result changed. Reload before saving your edit.'); error.status = 409; throw error;
      }
      if (typeof text !== 'string' || text.length > 20000) { const error = new Error('Enter text up to 20,000 characters.'); error.status = 400; throw error; }
      await this.save({ ...this.state, version: this.state.version + 1, humanText: text,
        revisions: [...this.state.revisions, { kind: 'human', text, savedAt: new Date().toISOString(), version: this.state.version + 1 }] });
      return this.view();
    });
  }
}
