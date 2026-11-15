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
export function allowedNativeAction(role, action) { return !!role && (action === UnitAction.View || (role !== 'read' && editActions.has(action))); }

// The same Workspace row lock used by Workspace.share is held through native
// dbAdapter.commitChangeset, and independently through each delivery enqueue.
// No ACL copy, revision mirror, alternate operation ordering or snapshot writer.
export class NativeAuthority {
  constructor(workspace, unitID = NATIVE_UNIT) { this.workspace = workspace; this.unitID = unitID; this.sessions = new Map(); }
  check(s, principal, unitID, edit = false, session) {
    if (unitID !== this.unitID) deny();
    let w;
    try { w = this.workspace.access(s, principal, unitID, edit, true); } catch { deny(); }
    if (w.nativeCollaboration !== true || w.kind !== 'native-sheet') deny();
    if (session && (session.userID !== principal || session.revision !== w.accessRevision)) deny();
    return { role: this.workspace.role(s, principal, w), revision: w.accessRevision };
  }
  async checkNow(principal, unitID, edit = false, session) {
    return this.workspace.store.read(s => this.check(s, principal, unitID, edit, session));
  }
  async fence(principal, unitID, edit, effect, session) {
    return this.workspace.store.transaction(async s => { const access = this.check(s, principal, unitID, edit, session); await effect(access); });
  }
  validateChangeset(c) {
    if (c?.unitID !== this.unitID || c.type !== UniverType.UNIVER_SHEET || typeof c.sid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(c.sid) || !Number.isSafeInteger(c.reqId) || c.reqId < 1 || !Array.isArray(c.mutations) || !c.mutations.length) deny();
    for (const m of c.mutations) {
      if (!mutations.has(m.id)) deny();
      let p; try { p = JSON.parse(m.data); } catch { deny(); }
      if (p?.unitId !== this.unitID || p.subUnitId !== NATIVE_TAB) deny();
    }
  }
  submission(context) {
    this.validateChangeset(context.request.changeset);
    const session = this.sessions.get(context.memberID);
    if (!session || session.userID !== context.userID) deny();
    return session;
  }
  bindSubmission(s, c, claim = false) {
    // Authorization metadata only: the SDK still owns reqId dedup and outcomes.
    // Never expire or reassign a SID, including after revoke/regrant/reconnect.
    const identity = s.works[this.unitID]?.nativeIdentity;
    if (identity?.version !== 1 || identity.workspace !== s.owner || identity.unitID !== this.unitID || identity.pairID !== s.nativeQualification?.storage?.pairID || !identity.pairID || !identity.owners || typeof identity.owners !== 'object' || Array.isArray(identity.owners)) deny();
    const key = createHash('sha256').update(c.request.changeset.sid).digest('hex');
    const owner = Object.hasOwn(identity.owners, key) ? identity.owners[key] : undefined;
    if (owner !== undefined && owner !== c.userID) deny();
    if (owner === undefined) {
      // Bounded qualification metadata; exhaustion refuses new sessions, never
      // evicts old bindings and thereby makes historical identities stealable.
      if (!claim || Object.keys(identity.owners).length >= 4096) deny();
      identity.owners[key] = c.userID;
    }
  }
  install(service, endpoint) {
    service.use('readUnitData', async (c, next) => {
      if (c.request.type !== UniverType.UNIVER_SHEET) deny();
      await this.fence(c.userID, c.request.unitID, false, next);
    });
    for (const action of ['createUnit', 'deleteUnits', 'recoverUnits']) service.use(action, async () => deny());
    service.use('submitChangeset', async (c, next) => {
      const session = this.submission(c);
      await this.workspace.store.transaction(s => {
        this.check(s, c.userID, c.request.changeset.unitID, true, session);
        this.bindSubmission(s, c, true);
      });
      await next();
    });
    service.use('commitChangeset', async (c, next) => {
      const session = this.submission(c);
      this.validateChangeset(c.changeset);
      await this.workspace.store.transaction(async s => {
        const access = this.check(s, c.userID, c.changeset.unitID, true, session);
        this.bindSubmission(s, c);
        for (const p of c.requiredUnitPermissions) if (p.unitID !== this.unitID || !allowedNativeAction(access.role, p.action)) deny();
        await next(); // Actual native database CAS/commit, not just admission.
      });
    });
    endpoint.use('connect', async (c, next) => {
      if (c.session.userID !== c.connection.customData.workagentPrincipal) deny();
      const access = await this.checkNow(c.session.userID, this.unitID);
      const session = { userID: c.session.userID, revision: access.revision };
      this.sessions.set(c.session.memberID, session);
      c.connection.customData.workagentSession = session;
      c.member.name = c.connection.customData.workagentName;
      await next();
    });
    endpoint.use('joinUnit', async (c, next) => { await this.checkNow(c.session.userID, c.unitID, false, this.sessions.get(c.session.memberID)); await next(); });
    endpoint.use('receivePresence', async (c, next) => { await this.checkNow(c.session.userID, c.unitID, false, this.sessions.get(c.session.memberID)); await next(); });
    endpoint.on('memberLeftUnit', c => { this.sessions.delete(c.session.memberID); });
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
export async function fencedNativeSend({ authority, principal, session, original, data, authenticate, timeoutMs = 10000 }) {
  let completion, timer;
  try {
    await authority.fence(principal, authority.unitID, false, () => {
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
      await authority.fence(c.userID, authority.unitID, false, () => {
        c.response.statusCode = response.statusCode;
        for (const [k, v] of headers) c.response.setHeader(k, v);
        c.response.setHeader('Cache-Control', 'no-store'); c.response.end(body);
      });
    });
    proxy.upgrade = (path, handler) => router.upgrade(path, async c => {
      validateNativeOrigin(c.incomingMessage, origin, true);
      const principal = auth.authenticate(c.incomingMessage);
      await authority.checkNow(principal, authority.unitID);
      const wrapped = new Map();
      const connection = original => {
        if (wrapped.has(original.id)) return wrapped.get(original.id);
        const customData = { ...original.customData, workagentPrincipal: principal, workagentName: auth.profile(principal).name };
        const result = { id: original.id, customData, close: (...args) => original.close(...args), async send(data) {
          await fencedNativeSend({ authority, principal, session: customData.workagentSession, original, data,
            authenticate: () => { if (auth.authenticate(c.incomingMessage) !== principal) deny(); } });
        } };
        wrapped.set(original.id, result); return result;
      };
      await handler({ ...c, accept(h) { c.accept({
        open: x => h.open?.({ ...x, connection: connection(x.connection) }),
        message: async x => { try { await authority.checkNow(principal, authority.unitID, false, connection(x.connection).customData.workagentSession); if (auth.authenticate(c.incomingMessage) !== principal) deny(); await h.message?.({ ...x, connection: connection(x.connection) }); } catch { x.connection.close(1008, 'Access changed'); } },
        close: x => h.close?.({ ...x, connection: connection(x.connection) }),
      }); } });
    });
    endpoint.register(proxy);
  } };
}

export async function createNativeCollaboration({ dbAdapter, workspace, auth, origin, owner, allowCreate = false }) {
  const authority = new NativeAuthority(workspace);
  // Only startup can create. Native create is idempotent and never replaces head.
  const existing = await dbAdapter.getUnit({ userID: owner, customData: {}, request: {} }, NATIVE_UNIT);
  if (!existing && !allowCreate) throw new Error('native_retained_unit_missing');
  const service = new UniverCollabService({ dbAdapter, enableUnitPermissionAnalysis: true });
  try { if (!existing) await service.createUnitFromData({ type: UniverType.UNIVER_SHEET, data: {
    id: NATIVE_UNIT, rev: 1, name: 'Synthetic native collaboration', appVersion: '', locale: 'enUS',
    sheetOrder: [NATIVE_TAB], sheets: { [NATIVE_TAB]: { id: NATIVE_TAB, name: 'Sheet 1', rowCount: 100, columnCount: 26, cellData: {} } }, styles: {}, resources: [],
  } }, { userID: owner }); } catch (e) { await service.dispose(); throw e; }
  const endpoint = new UniverCollabEndpoint(service);
  authority.install(service, endpoint);
  let stopping = false; const pending = new Set();
  const transport = createNodeTransport({ maxRequestBodyBytes: 1_000_000, maxWebSocketMessageBytes: 1_000_000 });
  transport.use(async (c, next) => {
    if (stopping) { c.response.statusCode = 503; c.response.end(); return; }
    let finish; const done = new Promise(resolve => { finish = resolve; }); pending.add(done);
    try { validateNativeOrigin(c.incomingMessage, origin); c.userID = auth.authenticate(c.incomingMessage); await authority.checkNow(c.userID, NATIVE_UNIT); await next(); }
    catch { if (!c.response.writableEnded) { c.response.statusCode = 403; c.response.end(JSON.stringify({ error: 'native_access_denied' })); } }
    finally { pending.delete(done); finish(); }
  });
  transport.useUpgrade(async (c, next) => { try { validateNativeOrigin(c.incomingMessage, origin, true); auth.authenticate(c.incomingMessage); await next(); } catch { c.reject(403, 'Access denied'); } });
  transport.register(guardedEndpoint(endpoint, authority, auth, origin));
  return { authority, service, endpoint, transport, async close() { stopping = true; await Promise.all([...pending]); await transport.dispose(); await endpoint.dispose(); await service.dispose(); await dbAdapter.dispose(); } };
}
