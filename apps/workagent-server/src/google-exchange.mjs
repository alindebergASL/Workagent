import { randomUUID } from 'node:crypto';
import { Fault, id, revision } from '../../../packages/workagent-contract/index.mjs';
import { authorize, digest, dedup, event, preconditions, same } from './workspace.mjs';
import { createSimulatedGoogleAdapter, prepareGoogleDocDelivery, GoogleAdapterError } from './google-adapter.mjs';

export const GOOGLE_SIMULATION_LABEL = 'Simulated Google — local only';
export const SIMULATED_ACCOUNTS = Object.freeze([
  { id: 'alice', label: 'Simulated Alice', spreadsheetId: 'synthetic_sheet' },
  { id: 'bob', label: 'Simulated Bob', spreadsheetId: 'synthetic_bob_sheet' },
]);
const strict = (input, allowed) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) throw new Fault('invalid_google_input', 400); };
const data = s => s.googleSimulation ??= { connections: {}, previews: {}, operations: {} };
const connection = (s, principal) => s.googleSimulation?.connections[principal] ?? { generation: 0, account: null };
const publicReceipt = op => ({ operationId: op.operationId, previewId: op.previewId, workId: op.workId, account: op.account, connectionGeneration: op.connectionGeneration,
  sourceHash: op.sourceHash, provenance: op.provenance, title: op.title, ...op.receipt, ...(op.createdAt ? { createdAt: op.createdAt } : {}) });
const adapterFault = e => { if (e instanceof GoogleAdapterError) throw new Fault(e.code, 400); throw e; };

// Production uses Workspace's PostgresStore. Every callback is synchronous: no
// row lock spans provider HTTP. There is intentionally no resume/dispatch queue.
export class GoogleExchange {
  constructor({ workspace, simulation = false, origin, credentialsFor } = {}) {
    this.workspace = workspace; this.store = workspace.store; this.enabled = simulation === true;
    if (this.enabled) {
      // Validate loopback and credential kind even before the first request.
      createSimulatedGoogleAdapter({ origin });
      if (typeof credentialsFor !== 'function') throw new Error('simulation_credentials_required');
      this.adapter = account => createSimulatedGoogleAdapter({ origin, credentials: credentialsFor(account) });
    }
  }
  available(s, principal) { authorize(s, principal); if (!this.enabled) throw new Fault('google_simulation_disabled', 409); }
  bound(s, principal, input) {
    this.available(s, principal);
    const c = connection(s, principal);
    if (!c.account || c.generation !== input.connectionGeneration) throw new Fault('google_connection_changed', 409);
    const w = this.workspace.access(s, principal, input.workId);
    if (w.contentRevision !== input.contentRevision || s.permissionRevision !== input.permissionRevision) throw new Fault('google_work_changed', 409);
    return { c, w };
  }
  previewBound(s, principal, p) {
    if (!p || p.principal !== principal) throw new Fault('google_preview_not_found', 404);
    const { c, w } = this.bound(s, principal, p);
    if (c.account !== p.account || !same(p.expected, preconditions(s, w))) throw new Fault('google_work_changed', 409);
    return w;
  }
  async state(principal, workId) {
    return this.store.read(s => {
      authorize(s, principal);
      if (workId) this.workspace.access(s, principal, workId);
      return { enabled: this.enabled, label: GOOGLE_SIMULATION_LABEL, remoteDurability: 'volatile', accounts: this.enabled ? SIMULATED_ACCOUNTS : [], connection: connection(s, principal),
        receipts: Object.values(s.googleSimulation?.operations ?? {}).filter(o => o.principal === principal && o.workId === workId).map(publicReceipt) };
    });
  }
  async connect(principal, input) {
    strict(input, ['commandId', 'account', 'connectionGeneration']); id(input.commandId); revision(input.connectionGeneration);
    if (input.account !== null && !SIMULATED_ACCOUNTS.some(a => a.id === input.account)) throw new Fault('invalid_simulated_account', 400);
    return this.store.transaction(s => {
      this.available(s, principal);
      dedup(s, input.commandId, { operation: 'google-connection', principal, ...input }, () => {
        const c = connection(s, principal);
        if (c.generation !== input.connectionGeneration) throw new Fault('google_connection_changed', 409);
        data(s).connections[principal] = { account: input.account, generation: c.generation + 1 };
        return { generation: c.generation + 1 };
      });
      return connection(s, principal);
    });
  }
  async previewSheet(principal, input) {
    strict(input, ['workId', 'contentRevision', 'permissionRevision', 'connectionGeneration', 'spreadsheetId', 'ranges']);
    const binding = await this.store.read(s => { const { c, w } = this.bound(s, principal, input); return { account: c.account, expected: preconditions(s, w) }; });
    let result;
    try { result = await this.adapter(binding.account).previewSheet({ spreadsheetId: input.spreadsheetId, ranges: input.ranges }); } catch (e) { adapterFault(e); }
    return this.store.transaction(s => {
      const p = { ...input, ...binding, principal, previewId: randomUUID(), kind: 'sheet', ...result };
      this.previewBound(s, principal, p);
      p.sourceHash = digest({ book: p.book, provenance: p.provenance });
      data(s).previews[p.previewId] = p;
      return p;
    });
  }
  async adoptSheet(principal, input) {
    strict(input, ['commandId', 'previewId', 'sourceHash', 'connectionGeneration']); id(input.commandId); id(input.previewId);
    return this.store.transaction(s => {
      this.available(s, principal);
      const p = data(s).previews[input.previewId]; this.previewBound(s, principal, p);
      if (p.kind !== 'google-sheet-preview' || p.sourceHash !== input.sourceHash || p.connectionGeneration !== input.connectionGeneration) throw new Fault('google_preview_mismatch', 409);
      return dedup(s, input.commandId, { operation: 'google-adopt', principal, ...input }, () => {
        if (p.adoption) return p.adoption;
        const workId = randomUUID(), book = structuredClone(p.book); book.id = workId;
        const w = { id: workId, book, contentRevision: 1, intentRevision: 0, cancellationEpoch: 0, messages: [], proposals: [], humanCells: [], sourceIds: [], status: 'ready',
          googleSource: { ...p.provenance, adopted: true, previewId: p.previewId, sourceHash: p.sourceHash, account: p.account, principal, connectionGeneration: p.connectionGeneration, policy: p.policy } };
        s.works[workId] = w; event(s, w, 'human_imported');
        p.adoption = { workId, contentRevision: 1, provenance: w.googleSource }; return p.adoption;
      });
    });
  }
  async previewDoc(principal, input) {
    strict(input, ['workId', 'contentRevision', 'permissionRevision', 'connectionGeneration', 'document']);
    return this.store.transaction(s => {
      const { c, w } = this.bound(s, principal, input);
      if (w.kind !== 'document' || input.document?.id !== w.id) throw new Fault('artifact_type_mismatch', 400);
      let plan; try { plan = prepareGoogleDocDelivery(input.document); } catch (e) { adapterFault(e); }
      const p = { previewId: randomUUID(), kind: 'document', principal, account: c.account, connectionGeneration: c.generation, workId: w.id,
        contentRevision: w.contentRevision, permissionRevision: s.permissionRevision, expected: preconditions(s, w), sourceHash: digest(input.document), plan,
        provenance: { provider: 'google', mode: 'simulation', synthetic: true, actualGoogleAccount: false, label: GOOGLE_SIMULATION_LABEL } };
      data(s).previews[p.previewId] = p; return p;
    });
  }
  async deliverDoc(principal, input) {
    strict(input, ['operationId', 'previewId', 'sourceHash', 'digest', 'connectionGeneration']); id(input.operationId); id(input.previewId);
    const hash = digest(input);
    const admitted = await this.store.transaction(s => {
      this.available(s, principal);
      const g = data(s), p = g.previews[input.previewId]; this.previewBound(s, principal, p);
      if (p.kind !== 'document' || p.sourceHash !== input.sourceHash || p.plan.digest !== input.digest || p.connectionGeneration !== input.connectionGeneration) throw new Fault('google_preview_mismatch', 409);
      const old = g.operations[input.operationId];
      if (old) { if (old.principal !== principal || old.inputHash !== hash) throw new Fault('command_conflict', 409); return { existing: publicReceipt(old) }; }
      // One preview authorizes at most one document, even with a different command.
      if (p.operationId) return { existing: publicReceipt(g.operations[p.operationId]) };
      p.operationId = input.operationId;
      const op = { operationId: input.operationId, inputHash: hash, previewId: p.previewId, principal, workId: p.workId, account: p.account, connectionGeneration: p.connectionGeneration,
        sourceHash: p.sourceHash, title: p.plan.title, provenance: p.provenance, createdAt: new Date().toISOString(), receipt: { stage: 'reserved', outcome: 'not_started', requestIds: [] }, history: [] };
      g.operations[op.operationId] = op; return { preview: p };
    });
    if (admitted.existing) return admitted.existing;
    const p = admitted.preview;
    const checkAuthority = () => this.store.read(s => { this.previewBound(s, principal, p); });
    const journal = {
      reserve: async () => { await checkAuthority(); }, // Already reserved atomically above.
      record: entry => this.store.transaction(s => {
        const op = data(s).operations[input.operationId];
        if (!op || op.inputHash !== hash) throw new Fault('google_journal_conflict', 409);
        if (['create_dispatching', 'update_dispatching', 'verified'].includes(entry.stage)) this.previewBound(s, principal, p);
        // The durable dispatch intent is conservatively unknown until readback.
        const receipt = { ...entry, outcome: entry.outcome ?? 'unknown', recordedAt: new Date().toISOString() };
        op.history.push(structuredClone(receipt)); op.receipt = receipt;
      }),
    };
    try { await this.adapter(p.account).executeDocDelivery(p.plan, { operationId: input.operationId, recordEffect: journal, checkAuthority }); }
    catch { /* Read durable state; a failed final journal commit cannot imply success. */ }
    return this.store.read(s => {
      authorize(s, principal); this.workspace.access(s, principal, p.workId);
      return publicReceipt(data(s).operations[input.operationId]);
    });
  }
}

export async function startGoogleSimulation({ workspace, simulation = false } = {}) {
  if (simulation !== true) return { exchange: new GoogleExchange({ workspace }), close: async () => {} };
  const { createGoogleSimulator } = await import('./google-simulation.mjs');
  const simulator = createGoogleSimulator(), origin = await simulator.start();
  return { exchange: new GoogleExchange({ workspace, simulation: true, origin, credentialsFor: account => simulator.issue(account) }), close: () => simulator.close() };
}
