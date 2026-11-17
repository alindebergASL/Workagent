// Normal-server routing for the explicitly provisioned development workspace.
import { ErrorCode } from '@univerjs/protocol';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { allowedNativeAction, validateNativeOrigin } from './native-collaboration.mjs';
export function nativeRoute(req, origin, auth) {
  validateNativeOrigin(req, origin, req.headers.upgrade === 'websocket');
  const url = new URL(req.url, origin);
  const match = /^\/api\/native\/([a-zA-Z0-9_-]+)\/([1-9][0-9]*)\/(?:(reversal|agent-acceptance|scalar-restore)\/([a-zA-Z0-9_-]+)\/)?(universer-api\/.*)$/.exec(url.pathname);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Fault('native_route_invalid', 403);
  req.nativeUnitID = match[1];
  req.nativeAccess = { unitID: match[1], userID: auth.authenticate(req), revision: Number(match[2]) };
  req.nativeAction = match[4] ? { id: match[4], binding: auth.sessionBinding(req), ...(match[3]!=='reversal'?{kind:match[3]}:{}) } : undefined;
  req.nativeBinding = auth.sessionBinding?.(req);
  req.url = '/' + match[5] + url.search;
  return match[1];
}
export async function nativeSession(native, auth, principal, unitID, send) {
  return native.authority.fence(principal, unitID, false, access => send(200, {
    ...auth.profile(principal), unitID, access, restore: access.role === 'owner' && !!native.authority.restore?.enabled, acceptance: access.role === 'owner' && !!native.authority.acceptance?.enabled, agent: access.role === 'owner' && !!native.authority.agent?.enabled, comments: !!native.authority.comments, history: !!native.authority.history, reversal: !!native.authority.reversal,
    basePath: `/api/native/${unitID}/${access.revision}/universer-api`, sessionPath: `/api/work/${unitID}/native-session`,
  }));
}
export async function nativeRequest(native, auth, origin, req, res, body, send) {
  const unitID = nativeRoute(req, origin, auth), principal = req.nativeAccess.userID;
  if (req.nativeAction) await native.authority.actionService(req.nativeAction).action(principal,unitID,req.nativeAccess,req.nativeAction);
  if (new URL(req.url, origin).pathname === '/universer-api/authz/-/object/-/batch_allowed' && req.method === 'POST') {
    const input = await body(req);
    if (!Array.isArray(input.requests) || input.requests.length > 100) throw new Fault('invalid_permissions', 400);
    return native.authority.fence(principal, unitID, false, access => send(200, {
      error: { code: ErrorCode.OK, message: '' }, objectActions: input.requests.map(r => ({ unitID: r.unitID, objectID: r.objectID,
        actions: (Array.isArray(r.actions) ? r.actions : []).map(action => ({ action, allowed: r.unitID === unitID && allowedNativeAction(access.role, action, !!native.authority.comments) })) })),
    }), req.nativeAccess);
  }
  return native.transport.handleRequest(req, res);
}
