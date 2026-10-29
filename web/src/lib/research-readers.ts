/**
 * Fenced read state for research sources and citations. Read-only: every
 * "refresh" re-reads records the service already holds (GET); none of them
 * fetches anything new from the web.
 *
 * Every request carries the generation it started under. A refresh, a
 * denial, or disposal (unmount / scope change) advances the generation and
 * aborts what was in flight, so an older success can never put content back
 * on screen. Any authorization denial — including the canonical 404
 * not_found_or_not_authorized — clears every claim, quote and capture shown.
 */
import { ApiError } from "@/lib/contract/errors";
import {
  appendSnapshotPage,
  type ArtifactClaims,
  type ResearchSnapshotPage,
  type SourceSnapshot,
} from "@/lib/research-contract";

export const isDenial = (e: unknown): boolean =>
  e instanceof ApiError &&
  (e.status === 401 || e.status === 403 || e.status === 404);

export type ReadPhase = "checking" | "ready" | "failed";

interface Store<T> {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => T;
}

function store<T>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next: T) {
      state = next;
      for (const fn of subs) fn();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

/* Citations bound to one exact revision + body hash. */

export interface CitationsState {
  phase: ReadPhase;
  claims: ArtifactClaims | null;
  snapshots: Record<string, SourceSnapshot | undefined>;
  loadErrors: Record<string, string | undefined>;
  /** The read error, as the raw cause; the view words it. */
  error: unknown;
}

export interface CitationsReader extends Store<CitationsState> {
  refresh: () => void;
  loadSnapshot: (id: string) => void;
  dispose: () => void;
}

const CHECKING: CitationsState = {
  phase: "checking",
  claims: null,
  snapshots: {},
  loadErrors: {},
  error: null,
};

export const WRONG_BINDING = new ApiError({
  code: "validation_error",
  status: 0,
  message:
    "The service answered for a different version of this work; its sources aren’t shown.",
});

export function createCitationsReader(opts: {
  binding: { artifactId: string; revisionId: string; bodyHash: string };
  fetchClaims: (signal: AbortSignal) => Promise<ArtifactClaims>;
  fetchSnapshot: (id: string, signal: AbortSignal) => Promise<SourceSnapshot>;
}): CitationsReader {
  const s = store<CitationsState>(CHECKING);
  let gen = 0;
  let ctl = new AbortController();

  const advance = () => {
    gen++;
    ctl.abort();
    ctl = new AbortController();
    return gen;
  };
  const deny = (e: unknown) => {
    advance();
    s.set({ ...CHECKING, phase: "failed", error: e });
  };

  return {
    subscribe: s.subscribe,
    getSnapshot: s.get,
    refresh() {
      const mine = advance();
      const signal = ctl.signal;
      s.set(CHECKING);
      opts.fetchClaims(signal).then(
        (r) => {
          if (mine !== gen) return;
          const b = opts.binding;
          if (
            r.artifact_id !== b.artifactId ||
            r.revision_id !== b.revisionId ||
            r.body_hash !== b.bodyHash
          )
            return deny(WRONG_BINDING);
          s.set({ ...CHECKING, phase: "ready", claims: r });
        },
        (e: unknown) => {
          if (mine === gen) deny(e);
        },
      );
    },
    loadSnapshot(id) {
      const mine = gen;
      const signal = ctl.signal;
      opts.fetchSnapshot(id, signal).then(
        (snap) => {
          if (mine !== gen) return;
          const cur = s.get();
          if (snap.snapshot_id !== id) {
            s.set({
              ...cur,
              loadErrors: {
                ...cur.loadErrors,
                [id]: "That capture couldn’t be loaded exactly.",
              },
            });
            return;
          }
          s.set({
            ...cur,
            snapshots: { ...cur.snapshots, [id]: snap },
            loadErrors: { ...cur.loadErrors, [id]: undefined },
          });
        },
        (e: unknown) => {
          if (mine !== gen) return;
          if (isDenial(e)) return deny(e);
          const cur = s.get();
          s.set({
            ...cur,
            snapshots: { ...cur.snapshots, [id]: undefined },
            loadErrors: {
              ...cur.loadErrors,
              [id]: "That capture couldn’t be loaded just now.",
            },
          });
        },
      );
    },
    dispose() {
      advance();
    },
  };
}

/* Captured public sources of one conversation, paginated. */

export interface SourcesState {
  phase: ReadPhase;
  items: SourceSnapshot[] | null;
  nextAfter: string | null;
  loadingMore: boolean;
  error: unknown;
}

export interface SourcesReader extends Store<SourcesState> {
  refresh: () => void;
  more: () => void;
  dispose: () => void;
}

const SOURCES_CHECKING: SourcesState = {
  phase: "checking",
  items: null,
  nextAfter: null,
  loadingMore: false,
  error: null,
};

export function createSourcesReader(opts: {
  fetchPage: (
    after: string | null,
    signal: AbortSignal,
  ) => Promise<ResearchSnapshotPage>;
}): SourcesReader {
  const s = store<SourcesState>(SOURCES_CHECKING);
  let gen = 0;
  let ctl = new AbortController();
  const advance = () => {
    gen++;
    ctl.abort();
    ctl = new AbortController();
    return gen;
  };
  // Any failed page clears everything: earlier pages may no longer be
  // authorized, and a partial list would silently omit sources.
  const fail = (e: unknown) => {
    advance();
    s.set({ ...SOURCES_CHECKING, phase: "failed", error: e });
  };

  return {
    subscribe: s.subscribe,
    getSnapshot: s.get,
    refresh() {
      const mine = advance();
      s.set(SOURCES_CHECKING);
      opts.fetchPage(null, ctl.signal).then(
        (p) => {
          if (mine !== gen) return;
          s.set({
            phase: "ready",
            items: p.items,
            nextAfter: p.next_after ?? null,
            loadingMore: false,
            error: null,
          });
        },
        (e: unknown) => {
          if (mine === gen) fail(e);
        },
      );
    },
    more() {
      const cur = s.get();
      if (cur.phase !== "ready" || !cur.items || !cur.nextAfter) return;
      if (cur.loadingMore) return;
      const mine = gen;
      s.set({ ...cur, loadingMore: true });
      opts.fetchPage(cur.nextAfter, ctl.signal).then(
        (p) => {
          if (mine !== gen) return;
          const now = s.get();
          s.set({
            ...now,
            items: appendSnapshotPage(now.items ?? [], p),
            nextAfter: p.next_after ?? null,
            loadingMore: false,
          });
        },
        (e: unknown) => {
          if (mine === gen) fail(e);
        },
      );
    },
    dispose() {
      advance();
    },
  };
}
