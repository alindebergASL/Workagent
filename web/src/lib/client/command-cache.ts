import { ApiError } from "@/lib/contract/errors";
/** Keep server-derived expectations stable across an ambiguous HTTP retry.
 * Input changes with the same command ID are rejected, never silently replayed.
 * Cache is tab-local, bounded, and contains no credential or source body.
 */
export function commandPayloadCache() {
  const cache = new Map<
    string,
    { intent: string; payload: Promise<unknown> }
  >();
  return async function payload<T>(
    scope: string,
    commandId: string,
    intent: unknown,
    build: () => Promise<T>,
  ): Promise<T> {
    const key = `${scope}:${commandId}`;
    const serialized = JSON.stringify(intent);
    const previous = cache.get(key);
    if (previous) {
      if (previous.intent !== serialized)
        throw new ApiError({
          code: "command_conflict",
          status: 409,
          message: "The same command cannot be retried with different content.",
        });
      return previous.payload as Promise<T>;
    }
    const promise = build();
    cache.set(key, { intent: serialized, payload: promise });
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
    try {
      return await promise;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  };
}
