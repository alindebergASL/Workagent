"use client";
import { useState, useSyncExternalStore } from "react";
import { useResource } from "./hooks";
import { boundScope, subscribeScope } from "./session-scope";

export type DiscoveryPage<T> = { items: T[]; next_after?: string | null; has_more?: boolean };

/** Page replacement (not a lifetime cache). A refresh reauthorizes every visible
 * item; failures/route/scope changes withdraw the old page, including its cursor.
 * Older pages are read-only: they never become command/admission evidence. */
export function useDiscoveryPage<T>(owner: string | null,
  read: (signal: AbortSignal, after?: string) => Promise<DiscoveryPage<T>>) {
  const scope = useSyncExternalStore(subscribeScope, boundScope, () => null);
  const identity = owner && scope ? `${scope}:${owner}` : null;
  const [position, setPosition] = useState<{ identity: string | null; after?: string }>({ identity });
  if (position.identity !== identity) setPosition({ identity });
  const after = position.identity === identity ? position.after : undefined;
  const resource = useResource(identity ? `${identity}:${after ?? "first"}` : null,
    (signal) => read(signal, after));
  const page = identity && resource.current ? resource.data : null;
  return {
    page, loading: Boolean(identity) && resource.loading,
    unavailable: Boolean(owner) && (!identity || (!resource.current && !resource.loading)),
    error: resource.error,
    next: () => { if (page?.has_more && page.next_after) setPosition({ identity, after: page.next_after }); },
    first: () => { setPosition({ identity }); if (!after) void resource.refresh(); },
    refresh: resource.refresh,
    hasPrevious: Boolean(after),
  };
}
