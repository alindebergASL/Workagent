// Public SDK cache interface fake: tests namespacing only, not browser persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeNativeCache } from '../src/native-cache.ts';
function cache(disk) {
  const key = (unit, user) => JSON.stringify([unit, user]);
  return {
    loadOfflineData: async (unit, user) => structuredClone(disk.get(key(unit,user)) ?? null),
    saveOfflineData: async (unit, data, user) => { disk.set(key(unit,user), structuredClone(data)); return true; },
    clearOfflineData: async (unit,user) => { disk.delete(key(unit,user)); },
    updateOfflineData(unit, type, awaitingChangeset, mutations, userId) { void this.saveOfflineData(unit, { unitID: unit, userId, type, rev: 1, awaitingChangeset, mutations }, userId); },
    disableLocalCache() {}, enableLocalCache() {}, exhaustSavingTask: async () => {}, saveTaskMap: new Map(),
  };
}
test('cache preserves SDK pending identity within epoch; principals, works and permission epochs never share it', async () => {
  const disk = new Map(), a = cache(disk); scopeNativeCache(a, 'owner', 'binding-owner', 1);
  const operation = { sid: 'sdk-session', reqId: 7 };
  a.updateOfflineData('unit-one', 2, operation, [{ id: 'native-mutation' }]);
  const restart = cache(disk); scopeNativeCache(restart, 'owner', 'binding-owner', 1);
  const loaded = await restart.loadOfflineData('unit-one'); assert.deepEqual(loaded.awaitingChangeset, operation); assert.equal(loaded.userId, 'owner');
  assert.equal(await restart.loadOfflineData('unit-two'), null);
  const regrant = cache(disk); scopeNativeCache(regrant, 'owner', 'binding-owner', 3);
  assert.equal(await regrant.loadOfflineData('unit-one'), null);
  await regrant.clearOfflineData('unit-one'); assert.ok(await restart.loadOfflineData('unit-one'));
  const peer = cache(disk); scopeNativeCache(peer, 'peer', 'binding-peer', 1);
  assert.equal(await peer.loadOfflineData('unit-one'), null); assert.equal(disk.size, 1);
});
