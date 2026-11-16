import type { ILocalCacheService } from '@univerjs-pro/collaboration-client';
// Scope the SDK cache's public user-key parameter, never its operation IDs or
// authenticated UserManager identity. Old epochs remain retained, not loaded.
export function scopeNativeCache(cache: ILocalCacheService, principal: string, binding: string, revision: number) {
  const scoped = `workagent:${binding}:${revision}:${principal}`;
  const load = cache.loadOfflineData.bind(cache), save = cache.saveOfflineData.bind(cache);
  const clear = cache.clearOfflineData.bind(cache), update = cache.updateOfflineData.bind(cache), backup = cache.backupOfflineData?.bind(cache);
  cache.loadOfflineData = async unit => { const data = await load(unit, scoped); return data ? { ...data, userId: principal } : data; };
  cache.saveOfflineData = (unit, data) => save(unit, { ...data, userId: scoped }, scoped);
  cache.clearOfflineData = unit => clear(unit, scoped);
  cache.updateOfflineData = (unit, type, awaiting, mutations) => update(unit, type, awaiting, mutations, scoped);
  if (backup) cache.backupOfflineData = (unit, reason) => backup(unit, reason, scoped);
}
