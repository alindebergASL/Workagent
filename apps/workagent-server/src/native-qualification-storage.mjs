// Parent-operated qualification storage only. No automatic adoption/migration.
import * as fs from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, parse } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { configuredAccounts } from './accounts.mjs';
import { identity } from './http.mjs';
import { initialState } from './store.mjs';
import { id } from '../../../packages/workagent-contract/index.mjs';
import { NATIVE_UNIT, createNativeCollaboration } from './native-collaboration.mjs';
const fail = code => { const e = new Error(code); e.nativeCode = code; throw e; };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const fileIdentity = s => ({ dev: String(s.dev), ino: String(s.ino) });
const same = isDeepStrictEqual;

export function nativeWorkspaceConfig(env) {
  if (env.WORKAGENT_NATIVE_WORKSPACE === undefined) return null;
  if (env.WORKAGENT_NATIVE_WORKSPACE !== 'synthetic-only') fail('explicit_native_workspace_required');
  return { ...nativeQualificationConfig({ ...env, WORKAGENT_NATIVE_QUALIFICATION: 'synthetic-only' }), mode: 'workspace' };
}
export function nativeQualificationConfig(env) {
  const required = k => { if (typeof env[k] !== 'string' || !env[k]) fail(`${k}_required`); return env[k]; };
  if (env.WORKAGENT_NATIVE_QUALIFICATION !== 'synthetic-only') fail('explicit_native_qualification_required');
  const owner = required('WORKAGENT_OWNER_ID'), token = required('WORKAGENT_AUTH_TOKEN'), origin = required('WORKAGENT_ORIGIN');
  try { id(owner); } catch { fail('invalid_native_owner'); }
  if (!/^https:\/\/[^/]+$/.test(origin) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) fail('private_origin_required');
  const databaseURL = required('WORKAGENT_DATABASE_URL'), databaseName = required('WORKAGENT_NATIVE_DATABASE_NAME');
  if (!/^postgres(?:ql)?:\/\//.test(databaseURL) || !/^workagent_native_[a-z0-9_]+$/.test(databaseName)) fail('dedicated_native_database_required');
  const root = required('WORKAGENT_NATIVE_ROOT'), filename = required('WORKAGENT_NATIVE_SQLITE');
  if (!isAbsolute(root) || normalize(root) !== root || root === parse(root).root || filename !== join(root, 'content.sqlite')) fail('dedicated_native_path_required');
  const port = Number(env.WORKAGENT_PORT ?? 8311);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('invalid_native_port');
  let accounts, auth;
  try { accounts = configuredAccounts(owner, token, JSON.parse(required('WORKAGENT_SYNTHETIC_ACCOUNTS_JSON'))); auth = identity({ owner, token, origin, accounts }); }
  catch { fail('invalid_native_accounts'); }
  if (accounts.length !== 1) fail('exactly_two_synthetic_principals_required');
  return { owner, token, origin, databaseURL, databaseName, root, filename, port, accounts, auth };
}

// A read-only query, executed only by Parent entrypoints. Bind to the actual DB,
// not a browser claim or a credential-bearing DSN. Credential rotation is safe.
export async function nativeDatabaseIdentity(pool, config) {
  let row;
  try { ({ rows: [row] } = await pool.query("SELECT current_database() AS name, (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid, inet_server_addr()::text AS address, inet_server_port() AS port")); }
  catch { fail('native_database_identity_unavailable'); }
  if (row?.name !== config.databaseName || !row.oid) fail('native_database_identity_mismatch');
  return createHash('sha256').update(JSON.stringify([row.name, row.oid, row.address, row.port])).digest('hex');
}

async function ancestors(path, io) {
  const paths = []; for (let p = path;; p = dirname(p)) { paths.push(p); if (p === dirname(p)) break; }
  for (const p of paths.reverse()) { const stat = await io.lstat(p); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_native_path'); }
}
function privateEntry(stat, directory, uid) {
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) || stat.uid !== uid || (stat.mode & 0o077) || (!directory && stat.nlink !== 1)) fail('unsafe_native_storage');
}
async function absent(path, io) { try { await io.lstat(path); } catch (e) { if (e.code === 'ENOENT') return; throw e; } fail('native_storage_already_exists'); }

export async function inspectNativeStorage(config, databaseID, { io = fs, uid = process.getuid() } = {}) {
  try {
    await ancestors(config.root, io);
    const rootStat = await io.lstat(config.root); privateEntry(rootStat, true, uid);
    const markerPath = join(config.root, 'qualification.json'), markerStat = await io.lstat(markerPath);
    privateEntry(markerStat, false, uid);
    if (markerStat.size > 4096) fail('invalid_native_marker');
    const marker = JSON.parse(await io.readFile(markerPath, 'utf8'));
    const dbStat = await io.lstat(config.filename); privateEntry(dbStat, false, uid);
    if (marker?.version !== 1 || marker.purpose !== (config.mode === 'workspace' ? 'workagent-native-workspace' : 'workagent-native-synthetic') || !uuid(marker.pairID) || marker.owner !== config.owner || marker.unitID !== (config.mode === 'workspace' ? null : NATIVE_UNIT) || marker.databaseID !== databaseID || marker.root !== config.root || marker.filename !== config.filename || !same(marker.rootIdentity, fileIdentity(rootStat)) || !same(marker.fileIdentity, fileIdentity(dbStat))) fail('native_storage_identity_mismatch');
    const allowed = new Set(['qualification.json', 'content.sqlite', 'content.sqlite-wal', 'content.sqlite-shm', 'content.sqlite-journal']);
    for (const name of await io.readdir(config.root)) {
      if (!allowed.has(name)) fail('unmanaged_native_storage');
      privateEntry(await io.lstat(join(config.root, name)), false, uid);
    }
    return marker;
  } catch (e) { if (e.nativeCode) throw e; fail('native_storage_unavailable'); }
}
function freshWorkspace(s, config) {
  if (!same(s, initialState(config.owner))) fail('fresh_native_workspace_required');
}
function pairedWorkspace(s, config, marker) {
  const pair = s.nativeQualification;
  if (config.mode === 'workspace') {
    if (s.owner !== config.owner || !s.enabled || !object(pair) || !same(pair.storage, marker) || !['provisioned', 'ready'].includes(pair.phase)) fail('native_workspace_pair_mismatch');
    for (const w of Object.values(s.works).filter(w => w.nativeCollaboration)) {
      const i = w.nativeIdentity;
      if (w.kind !== 'native-sheet' || i?.version !== 1 || i.workspace !== s.owner || i.unitID !== w.id || i.pairID !== marker.pairID || !object(i.owners)) fail('native_workspace_pair_mismatch');
    }
    return pair.phase;
  }
  const w = s.works[NATIVE_UNIT], identity = w?.nativeIdentity;
  if (s.owner !== config.owner || !s.enabled || !object(pair) || !same(pair.storage, marker) || !['provisioned', 'ready'].includes(pair.phase) || Object.keys(s.works).some(k => k !== NATIVE_UNIT) || Object.keys(s.jobs).length || Object.keys(s.sources).length || w?.nativeCollaboration !== true || w.kind !== 'native-sheet' || identity?.version !== 1 || identity.workspace !== config.owner || identity.unitID !== NATIVE_UNIT || identity.pairID !== marker.pairID || !object(identity.owners)) fail('native_workspace_pair_mismatch');
  return pair.phase;
}

// Explicit Parent command only: fresh workspace + NEW root. Partial failures are
// retained and fail closed on rerun; never label/adopt an existing SQLite file.
export async function provisionNativeStorage({ config, workspace, databaseID, io = fs, uid = process.getuid(), newID = randomUUID }) {
  await ancestors(dirname(config.root), io);
  await absent(config.root, io);
  await workspace.store.read(s => freshWorkspace(s, config));
  await io.mkdir(config.root, { mode: 0o700 });
  const file = await io.open(config.filename, 'wx', 0o600); await file.close();
  const marker = { version: 1, purpose: config.mode === 'workspace' ? 'workagent-native-workspace' : 'workagent-native-synthetic', pairID: newID(), owner: config.owner, unitID: config.mode === 'workspace' ? null : NATIVE_UNIT, databaseID, root: config.root, filename: config.filename, rootIdentity: fileIdentity(await io.lstat(config.root)), fileIdentity: fileIdentity(await io.lstat(config.filename)) };
  await io.writeFile(join(config.root, 'qualification.json'), JSON.stringify(marker), { flag: 'wx', mode: 0o600 });
  await inspectNativeStorage(config, databaseID, { io, uid });
  await workspace.store.transaction(s => {
    freshWorkspace(s, config);
    s.nativeQualification = { storage: marker, phase: 'provisioned' };
    if (config.mode !== 'workspace') s.works[NATIVE_UNIT] = { id: NATIVE_UNIT, kind: 'native-sheet', nativeCollaboration: true, title: 'Synthetic native collaboration', accessRevision: 1, acl: { [config.accounts[0].id]: 'editor' }, proposals: [], intentRevision: 0, status: 'ready',
      nativeIdentity: { version: 1, workspace: config.owner, unitID: NATIVE_UNIT, pairID: marker.pairID, owners: {} } };
  });
  return marker.pairID;
}

export async function openNativeStorage({ config, workspace, databaseID, makeAdapter, createCollaboration = createNativeCollaboration, io = fs, uid = process.getuid() }) {
  // ALL configuration, filesystem ownership and Workspace pairing checks precede
  // the writable SDK constructor and any product metadata update.
  const marker = await inspectNativeStorage(config, databaseID, { io, uid });
  const phase = await workspace.store.read(s => pairedWorkspace(s, config, marker));
  await inspectNativeStorage(config, databaseID, { io, uid });
  let native, adapter;
  try {
    adapter = makeAdapter({ filename: config.filename });
    native = await createCollaboration({ dbAdapter: adapter, workspace, auth: config.auth, origin: config.origin, owner: config.owner, allowCreate: phase === 'provisioned', mode: config.mode });
    if (phase === 'provisioned') await workspace.store.transaction(s => { pairedWorkspace(s, config, marker); s.nativeQualification.phase = 'ready'; });
    return native;
  } catch (e) { if (native) await native.close(); else if (adapter) await adapter.dispose(); if (e.nativeCode) throw e; fail('native_storage_open_failed'); }
}
