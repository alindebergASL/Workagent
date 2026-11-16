import { NativeAgentAcceptance } from './native-agent-acceptance.mjs';
import { NativeAgent } from './native-agent.mjs';
import { NativeReversal } from './native-reversal.mjs';
import { NativeHistory } from './native-history.mjs';
import { NativeComments, ADD_COMMENT, DELETE_COMMENT, RESOLVE_COMMENT, nativeCommentPolicy } from './native-comments.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Fault, id, text } from '../../../packages/workagent-contract/index.mjs';
import { authorize, dedup, event } from './workspace.mjs';
import { createHash } from 'node:crypto';
import { CollabError, UniverCollabService } from '@univerjs-pro/collaboration-service';
import { UniverCollabEndpoint } from '@univerjs-pro/collaboration-endpoint';
import { createNodeTransport } from '@univerjs-pro/collaboration-transport-node';
import { UniverType, UnitAction } from '@univerjs/protocol';

export const NATIVE_UNIT = 'b05-native-synthetic-sheet';
export const NATIVE_TAB = 'sheet-1';
const deny = () => { throw new CollabError('PERMISSION_DENIED', 'Native qualification access denied'); };
const mutations = new Set(['sheet.mutation.set-range-values', 'sheet.mutation.insert-row', 'sheet.mutation.remove-rows']);
const editActions = new Set([UnitAction.Edit, UnitAction.SetCellValue, UnitAction.SetCellStyle, UnitAction.InsertRow, UnitAction.DeleteRow, UnitAction.SelectProtectedCells, UnitAction.SelectUnProtectedCells]);
export function allowedNativeAction(role, action, comments = false) { return !!role && (action === UnitAction.View || (role !== 'read' && (editActions.has(action) || (comments && action === UnitAction.Comment)))); }

// The same Workspace row lock used by Workspace.share is held through native
// dbAdapter.commitChangeset, and independently through each delivery enqueue.
// No ACL copy, revision mirror, alternate operation ordering or snapshot writer.
export class NativeAuthority {
  constructor(workspace, unitID = NATIVE_UNIT) { this.workspace = workspace; this.unitID = unitID; this.sessions = new Map(); this.scope = new AsyncLocalStorage(); }
  check(s, principal, unitID, edit = false, session) {
    if (this.unitID !== null && unitID !== this.unitID) deny();
    let w;
    try { w = this.workspace.access(s, principal, unitID, edit, true); } catch { deny(); }
    if (w.nativeCollaboration !== true || w.kind !== 'native-sheet' || w.status === 'creating') deny();
    if (session && (session.userID !== principal || (session.unitID && session.unitID !== unitID) || session.revision !== w.accessRevision)) deny();
    return { role: this.workspace.role(s, principal, w), revision: w.accessRevision };
  }
  async checkNow(principal, unitID, edit = false, session) {
    return this.workspace.store.read(s => this.check(s, principal, unitID, edit, session));
  }
  async fence(principal, unitID, edit, effect, session) {
    return this.workspace.store.transaction(async s => { const access = this.check(s, principal, unitID, edit, session); await effect(access); });
  }
  actionService(action) {
    if (action?.kind === 'agent-acceptance' && this.acceptance) return this.acceptance;
    if (action && action.kind === undefined && this.reversal) return this.reversal;
    deny();
  }
  async validateAction(s,c,session,commit=false) {
    const reason=await this.acceptance?.validate(s,c,session,commit);
    if(reason)return reason;
    if(session.actionKind==='agent-acceptance'){if(!this.acceptance)return 'native_acceptance_disabled';return;}
    return this.reversal?.validate(s,c,session,commit);
  }
  validateChangeset(c) {
    if (!c || (this.unitID !== null && c.unitID !== this.unitID) || c.type !== UniverType.UNIVER_SHEET || typeof c.sid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(c.sid) || !Number.isSafeInteger(c.reqId) || c.reqId < 1 || !Array.isArray(c.mutations) || !c.mutations.length) deny();
    for (const m of c.mutations) {
      if (!mutations.has(m.id) && !(this.comments && [ADD_COMMENT, DELETE_COMMENT, RESOLVE_COMMENT].includes(m.id))) deny();
      let p; try { p = JSON.parse(m.data); } catch { deny(); }
      if (p?.unitId !== c.unitID || p.subUnitId !== NATIVE_TAB) deny();
    }
  }
  submission(context) {
    this.validateChangeset(context.request.changeset);
    const session = this.sessions.get(context.memberID);
    if (!session || session.userID !== context.userID || (session.unitID && session.unitID !== context.request.changeset.unitID) || (this.unitID === null && this.scope.getStore()?.unitID !== context.request.changeset.unitID)) deny();
    return session;
  }
  bindSubmission(s, c, claim = false) {
    // Authorization metadata only: the SDK still owns reqId dedup and outcomes.
    // Never expire or reassign a SID, including after revoke/regrant/reconnect.
    const unitID = c.request.changeset.unitID;
    const identity = s.works[unitID]?.nativeIdentity;
    if (identity?.version !== 1 || identity.workspace !== s.owner || identity.unitID !== unitID || identity.pairID !== s.nativeQualification?.storage?.pairID || !identity.pairID || !identity.owners || typeof identity.owners !== 'object' || Array.isArray(identity.owners)) deny();
    const key = createHash('sha256').update(c.request.changeset.sid).digest('hex');
    const owner = Object.hasOwn(identity.owners, key) ? identity.owners[key] : undefined;
    const scoped = s.nativeQualification.storage.purpose === 'workagent-native-workspace';
    const epoch = s.works[unitID].accessRevision;
    if (owner !== undefined && (scoped ? owner?.principal !== c.userID || owner?.epoch !== epoch : owner !== c.userID)) deny();
    if (owner === undefined) {
      // Bounded qualification metadata; exhaustion refuses new sessions, never
      // evicts old bindings and thereby makes historical identities stealable.
      if (!claim || Object.keys(identity.owners).length >= 4096) deny();
      identity.owners[key] = scoped ? { principal: c.userID, epoch } : c.userID;
    }
  }
  install(service, endpoint) {
    service.use('readUnitData', async (c, next) => {
      if (c.request.type !== UniverType.UNIVER_SHEET || (this.unitID === null && this.scope.getStore()?.unitID !== c.request.unitID)) deny();
      await this.fence(c.userID, c.request.unitID, false, next, this.scope.getStore()?.session);
    });
    service.use('createUnit', async (_c, next) => { if (!this.scope.getStore()?.creating) deny(); await next(); });
    for (const action of ['deleteUnits', 'recoverUnits']) service.use(action, async () => deny());
    service.use('submitChangeset', async (c, next) => {
      const session = this.submission(c);
      const refusal = await this.workspace.store.transaction(async s => {
        this.check(s, c.userID, c.request.changeset.unitID, true, session);
        const reason = await this.validateAction(s,c,session); if (reason) return reason;
        this.bindSubmission(s, c, true);
        await nativeCommentPolicy(() => this.comments?.bind(s, c, session, true));
      });
      if (refusal) throw new CollabError('PERMISSION_DENIED',refusal,{retryable:false});
      await next();
    });
    service.use('commitChangeset', async (c, next) => {
      const session = this.submission(c);
      this.validateChangeset(c.changeset);
      const commentView = this.comments?.needs(c.changeset) ? await this.comments.prepare(c.userID, c.changeset.unitID, session) : null;
      const refusal = await this.workspace.store.transaction(async s => {
        const access = this.check(s, c.userID, c.changeset.unitID, true, session);
        const reason = await this.validateAction(s,c,session,true); if (reason) return reason;
        this.bindSubmission(s, c);
        await nativeCommentPolicy(async () => {
          this.comments?.bind(s, c, session, false);
          if (commentView) { await this.comments.current(c.userID, c.changeset.unitID, commentView); this.comments.validate(s, c, commentView); }
        });
        for (const p of c.requiredUnitPermissions) if (p.unitID !== c.changeset.unitID || !allowedNativeAction(access.role, p.action, !!this.comments)) deny();
        await next(); // Actual native database CAS/commit, not just admission.
      });
      if (refusal) throw new CollabError('PERMISSION_DENIED',refusal,{retryable:false});
    });
    endpoint.use('connect', async (c, next) => {
      if (c.session.userID !== c.connection.customData.workagentPrincipal) deny();
      const unitID = this.unitID ?? c.connection.customData.workagentUnitID;
      const access = await this.checkNow(c.session.userID, unitID, false, c.connection.customData.workagentAccess);
      const action=c.connection.customData.workagentAction, ticketAction=c.session.customData?.workagentAction;
      if (JSON.stringify(action)!==JSON.stringify(ticketAction)) deny();
      const session = { userID: c.session.userID, unitID, revision: access.revision, binding:c.connection.customData.workagentBinding, ...(action?{action:action.id,...(action.kind?{actionKind:action.kind}:{})}:{}) };
      if(action)await this.actionService(action).connect(c.session.userID,unitID,session,action,c.session.memberID);
      this.sessions.set(c.session.memberID, session);
      c.connection.customData.workagentSession = session;
      c.member.name = c.connection.customData.workagentName;
      await next();
    });
    endpoint.use('joinUnit', async (c, next) => { if (!this.sessions.has(c.session.memberID)) deny(); await this.checkNow(c.session.userID, c.unitID, false, this.sessions.get(c.session.memberID)); await next(); });
    endpoint.use('receivePresence', async (c, next) => { if (!this.sessions.has(c.session.memberID)) deny(); await this.checkNow(c.session.userID, c.unitID, false, this.sessions.get(c.session.memberID)); await next(); });
    // Session departure and native commit share the Workspace linearization
    // lock: a departure cannot invalidate an origin halfway through native CAS.
    endpoint.on('memberLeftUnit', c => this.workspace.store.transaction(() => { this.sessions.delete(c.session.memberID); }));
  }
}

export function validateNativeOrigin(req, origin, upgrade = false) {
  // Same-origin GETs may omit Origin. Reject cross-site reads as well as writes.
  if ((req.headers.origin && req.headers.origin !== origin) || ((upgrade || req.method !== 'GET') && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') deny();
}

// Public NodeRouter/NodeTransportConnection composition. Buffer native HTTP
// results until a fresh recipient check; never emit an already-read snapshot
// after a committed revocation. Every WS send (including queued broadcasts) is
// checked at the actual transport boundary, not a periodic room-entry check.
// @univerjs-pro/collaboration-transport-node 1.4.0 send calls socket.send
// inside a synchronous Promise executor; its promise settles in the write callback.
// This adapter is specific to that public transport, not arbitrary async enqueue.
export async function fencedNativeSend({ authority, principal, session, original, data, authenticate, unitID = authority.unitID, timeoutMs = 10000 }) {
  let completion, timer;
  try {
    await authority.fence(principal, unitID, false, () => {
      authenticate();
      // Attach rejection handling immediately, but do not return/await the flush
      // promise from this callback: the Workspace lock covers enqueue only.
      completion = Promise.resolve(original.send(data)).then(() => true, () => false);
    }, session);
    const flushed = await Promise.race([completion, new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    if (!flushed) original.close(1008, 'Delivery unavailable');
  } catch { original.close(1008, 'Access changed'); }
  finally { clearTimeout(timer); }
}

export function guardedEndpoint(endpoint, authority, auth, origin) {
  return { register(router) {
    const proxy = {};
    for (const method of ['get', 'post', 'delete']) proxy[method] = (path, handler) => router[method](path, async c => {
      const headers = new Map(); let body;
      const response = { statusCode: 200, writableEnded: false, destroyed: false, setHeader: (k, v) => headers.set(k, v), end(value) { body = value; this.writableEnded = true; } };
      await handler({ ...c, response });
      await authority.fence(c.userID, authority.unitID ?? c.incomingMessage.nativeUnitID, false, () => {
        c.response.statusCode = response.statusCode;
        for (const [k, v] of headers) c.response.setHeader(k, v);
        c.response.setHeader('Cache-Control', 'no-store'); c.response.end(body);
      }, c.incomingMessage.nativeAccess);
    });
    proxy.upgrade = (path, handler) => router.upgrade(path, async c => {
      validateNativeOrigin(c.incomingMessage, origin, true);
      const principal = auth.authenticate(c.incomingMessage), unitID = authority.unitID ?? c.incomingMessage.nativeUnitID;
      await authority.checkNow(principal, unitID, false, c.incomingMessage.nativeAccess);
      if(c.incomingMessage.nativeAction)await authority.actionService(c.incomingMessage.nativeAction).action(principal,unitID,c.incomingMessage.nativeAccess,c.incomingMessage.nativeAction);
      const wrapped = new Map();
      const connection = original => {
        if (wrapped.has(original.id)) return wrapped.get(original.id);
        const customData = { ...original.customData, workagentPrincipal: principal, workagentUnitID: unitID, workagentAccess: c.incomingMessage.nativeAccess, workagentName: auth.profile(principal).name, workagentBinding: c.incomingMessage.nativeBinding ?? auth.sessionBinding?.(c.incomingMessage), workagentAction:c.incomingMessage.nativeAction };
        const result = { id: original.id, customData, close: (...args) => original.close(...args), async send(data) {
          await fencedNativeSend({ authority, principal, session: customData.workagentSession, unitID, original, data,
            authenticate: () => { if (auth.authenticate(c.incomingMessage) !== principal) deny(); } });
        } };
        wrapped.set(original.id, result); return result;
      };
      await handler({ ...c, accept(h) { c.accept({
        open: x => h.open?.({ ...x, connection: connection(x.connection) }),
        message: async x => { try { await authority.checkNow(principal, unitID, false, connection(x.connection).customData.workagentSession); if (auth.authenticate(c.incomingMessage) !== principal) deny(); await h.message?.({ ...x, connection: connection(x.connection) }); } catch { x.connection.close(1008, 'Access changed'); } },
        close: x => h.close?.({ ...x, connection: connection(x.connection) }),
      }); } });
    });
    endpoint.register(proxy);
  } };
}

export async function createNativeCollaboration({ dbAdapter, workspace, auth, origin, owner, allowCreate = false, mode = 'qualification' }) {
  const authority = new NativeAuthority(workspace, mode === 'workspace' ? null : NATIVE_UNIT);
  // Only startup can create. Native create is idempotent and never replaces head.
  const existing = mode === 'workspace' ? true : await dbAdapter.getUnit({ userID: owner, customData: {}, request: {} }, NATIVE_UNIT);
  if (!existing && !allowCreate) throw new Error('native_retained_unit_missing');
  if (mode === 'workspace') {
    const units = await workspace.store.read(s => Object.values(s.works).filter(w => w.nativeCollaboration && w.status !== 'creating').map(w => w.id));
    for (const unitID of units) if (!await dbAdapter.getUnit({ userID: owner, customData: {}, request: {} }, unitID)) throw new Error('native_retained_unit_missing');
  }
  const service = new UniverCollabService({ dbAdapter, enableUnitPermissionAnalysis: true });
  try { if (!existing) await service.createUnitFromData({ type: UniverType.UNIVER_SHEET, data: {
    id: NATIVE_UNIT, rev: 1, name: 'Synthetic native collaboration', appVersion: '', locale: 'enUS',
    sheetOrder: [NATIVE_TAB], sheets: { [NATIVE_TAB]: { id: NATIVE_TAB, name: 'Sheet 1', rowCount: 100, columnCount: 26, cellData: {} } }, styles: {}, resources: [],
  } }, { userID: owner }); } catch (e) { await service.dispose(); throw e; }
  const endpoint = new UniverCollabEndpoint(service);
  if (mode === 'workspace') { authority.comments = new NativeComments(authority, service, dbAdapter); authority.history = new NativeHistory(authority, service, dbAdapter); authority.reversal = new NativeReversal(authority,service,dbAdapter); authority.agent = new NativeAgent(authority,service,dbAdapter); authority.acceptance = new NativeAgentAcceptance(authority,service,dbAdapter); }
  authority.install(service, endpoint);
  let stopping = false; const pending = new Set();
  const transport = createNodeTransport({ maxRequestBodyBytes: 1_000_000, maxWebSocketMessageBytes: 1_000_000 });
  transport.use(async (c, next) => {
    if (stopping) { c.response.statusCode = 503; c.response.end(); return; }
    let finish; const done = new Promise(resolve => { finish = resolve; }); pending.add(done);
    try { validateNativeOrigin(c.incomingMessage, origin); c.userID = auth.authenticate(c.incomingMessage); const unitID = authority.unitID ?? c.incomingMessage.nativeUnitID; await authority.checkNow(c.userID, unitID, false, c.incomingMessage.nativeAccess); if(c.incomingMessage.nativeAction)await authority.actionService(c.incomingMessage.nativeAction).action(c.userID,unitID,c.incomingMessage.nativeAccess,c.incomingMessage.nativeAction);
      c.customData={...c.customData,workagentAction:c.incomingMessage.nativeAction};
      await authority.scope.run({ unitID, session: c.incomingMessage.nativeAccess, action:c.incomingMessage.nativeAction }, next); }
    catch { if (!c.response.writableEnded) { c.response.statusCode = 403; c.response.end(JSON.stringify({ error: 'native_access_denied' })); } }
    finally { pending.delete(done); finish(); }
  });
  transport.useUpgrade(async (c, next) => { try { validateNativeOrigin(c.incomingMessage, origin, true); auth.authenticate(c.incomingMessage); await next(); } catch { c.reject(403, 'Access denied'); } });
  transport.register(guardedEndpoint(endpoint, authority, auth, origin));
  const createWork = input => createNativeWork({ workspace, authority, dbAdapter, service, owner, input });
  return { authority, service, endpoint, transport, createWork, async close() { stopping = true; await Promise.all([...pending]); await transport.dispose(); await endpoint.dispose(); await service.dispose(); await dbAdapter.dispose(); } };
}

// Reserve identity before touching native content. Explicit retries complete only
// this reservation; a failed cross-store completion never invents a new unit.
export async function createNativeWork({ workspace, authority, dbAdapter, service, owner, input }) {
  if (!workspace.nativeEnabled) throw new Fault('native_collaboration_disabled', 409);
  if (!input || Object.keys(input).some(k => !['commandId', 'title'].includes(k))) throw new Fault('invalid_command', 400);
  id(input.commandId); text(input.title, 200);
  const result = await workspace.store.transaction(s => {
    authorize(s, owner);
    if (s.nativeQualification?.storage?.purpose !== 'workagent-native-workspace') throw new Fault('native_workspace_pair_mismatch', 409);
    return dedup(s, input.commandId, { operation: 'native-sheet', ...input }, () => {
      const pairID = s.nativeQualification.storage.pairID;
      const workId = 'native-' + createHash('sha256').update(JSON.stringify([s.owner, pairID, input.commandId])).digest('hex').slice(0, 40);
      if (s.works[workId]) throw new Fault('native_identity_conflict', 409);
      s.works[workId] = { id: workId, kind: 'native-sheet', nativeCollaboration: true, title: input.title.trim(), accessRevision: 1, acl: {}, status: 'creating',
        nativeIdentity: { version: 1, workspace: s.owner, unitID: workId, pairID, owners: {} } };
      event(s, s.works[workId], 'native_reserved');
      return { workId };
    });
  });
  await workspace.store.transaction(async s => {
    authorize(s, owner); const w = s.works[result.workId];
    if (!w?.nativeCollaboration) throw new Fault('native_identity_conflict', 409);
    const existing = await dbAdapter.getUnit({ userID: owner, customData: {}, request: {} }, w.id);
    if (w.status !== 'creating') { if (!existing) throw new Fault('native_retained_unit_missing', 409); return; }
    if (!existing) await authority.scope.run({ creating: true }, () => service.createUnitFromData({ type: UniverType.UNIVER_SHEET, data: {
      id: w.id, rev: 1, name: w.title, appVersion: '', locale: 'enUS', sheetOrder: [NATIVE_TAB],
      sheets: { [NATIVE_TAB]: { id: NATIVE_TAB, name: 'Sheet 1', rowCount: 100, columnCount: 26, cellData: {} } }, styles: {}, resources: [],
    } }, { userID: owner }));
    w.status = 'ready'; event(s, w, 'native_created');
  });
  return result;
}
