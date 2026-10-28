"use client";
/**
 * Staged documents for one draft, kept durably on this device. The list in
 * memory mirrors the stored records; each change is written through, and a
 * failed write is shown (the entry stays attached, marked not kept).
 *
 * Every asynchronous step is bound to the scope and epoch it started in: a
 * late file read, upload update or removal writes only to that original
 * scope and never lands in a draft or workspace selected since. Until a
 * restoration settles, nothing can be added; a restoration that failed or
 * found a damaged copy blocks sending until the person recovers explicitly.
 */
import { useEffect, useState } from "react";
import {
  forgetGenerations,
  indexedDocStore,
  persistEntries,
  restoreEntries,
  StorageFailed,
  type DocStore,
  type StoredDocument,
} from "./doc-store";
import {
  documentsProblem,
  newEntry,
  stageFile,
  type StagedEntry,
} from "./documents";
import { stagedScope } from "./session-scope";

/** The scope and epoch an asynchronous step started in. */
export type Origin = { readonly scope: string; readonly epoch: number };

export type Blocked =
  { kind: "read" } | { kind: "corrupt"; records: StoredDocument[] };

export interface StagedView {
  docs: StagedEntry[];
  restoring: boolean;
  storeError: string;
  /** Sending stays blocked until this is explicitly recovered. */
  blocked: Blocked | null;
}

const READ_FAILED =
  "Documents kept on this device couldn’t be read. Nothing was sent or deleted. Try reading them again, or continue without them.";
const NOT_KEPT =
  "A document couldn’t be kept on this device (storage full or unavailable). It stays attached, but would be lost if this page reloads.";

export const emptyView = (restoring = false): StagedView => ({
  docs: [],
  restoring,
  storeError: "",
  blocked: null,
});

/** The staging state machine the hook renders (tested without React). */
export function stagedController(
  store: DocStore,
  emit: (view: StagedView) => void,
) {
  let epoch = 0;
  let scope: string | null = null;
  let view = emptyView();
  const set = (patch: Partial<StagedView>) => {
    view = { ...view, ...patch };
    emit(view);
  };
  const current = (o: Origin) => o.epoch === epoch && o.scope === scope;
  // Device writes run one at a time, in the order they were made, so a
  // delayed earlier write never resurrects a removed generation or replaces
  // a later receipt.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = chain.then(run);
    chain = next.catch(() => {});
    return next;
  };

  const restore = async (o: Origin) => {
    try {
      const { list, corrupt } = await restoreEntries(store, o.scope);
      if (!current(o)) return;
      set({
        docs: list,
        restoring: false,
        blocked: corrupt.length ? { kind: "corrupt", records: corrupt } : null,
        storeError: corrupt.length
          ? `The kept copy of ${corrupt.map((c) => c.filename).join(", ")} no longer matches the original. It hasn’t been sent; discard the damaged copy and attach the file again.`
          : "",
      });
    } catch {
      if (!current(o)) return;
      set({
        restoring: false,
        blocked: { kind: "read" },
        storeError: READ_FAILED,
      });
    }
  };

  /** Write a list through to `o.scope`; rejects if any entry wasn't kept. */
  const persist = async (o: Origin, list: StagedEntry[]) => {
    if (current(o)) set({ docs: list });
    const { list: kept, failed } = await serial(() =>
      persistEntries(store, o.scope, list),
    );
    if (current(o)) {
      // Only the durable flag changes; later state updates win otherwise.
      set({
        docs: view.docs.map((e) => {
          const k = kept.find((x) => x.generation === e.generation);
          return k && k.state === e.state ? { ...e, durable: k.durable } : e;
        }),
        ...(failed ? { storeError: NOT_KEPT } : {}),
      });
    }
    if (failed) throw new StorageFailed();
  };

  const forget = async (o: Origin, generations: string[]) => {
    if (current(o))
      set({
        docs: view.docs.filter((e) => !generations.includes(e.generation)),
      });
    if (!generations.length) return;
    await serial(() => forgetGenerations(store, o.scope, generations)).catch(
      () => {
        if (current(o))
          set({
            storeError:
              "A document’s copy on this device couldn’t be cleared, so it may reappear after a reload. Remove it again before sending if it does.",
          });
      },
    );
  };

  /** Switch to a scope (null: none) and restore it; earlier steps go stale. */
  const open = (next: string | null) => {
    epoch += 1;
    scope = next;
    view = emptyView(Boolean(next));
    emit(view);
    if (next) void restore({ scope: next, epoch });
  };

  return {
    get view() {
      return view;
    },
    origin: (): Origin | null => (scope ? { scope, epoch } : null),
    open,
    /** Stage picked files into the scope they were picked in; error text or "". */
    async add(files: File[]): Promise<string> {
      const o = scope ? { scope, epoch } : null;
      if (!o || view.restoring || view.blocked || !files.length) return "";
      let picked: StagedEntry[];
      try {
        picked = (await Promise.all(files.map(stageFile))).map(newEntry);
      } catch (e) {
        return e instanceof Error
          ? e.message
          : "That document can’t be attached.";
      }
      // Picked before a switch: never lands in the newly selected draft.
      if (!current(o)) return "";
      const next = [...view.docs, ...picked];
      const problem = documentsProblem(next);
      if (problem) return problem;
      await persist(o, next).catch(() => {});
      return "";
    },
    persist,
    forget,
    /**
     * Clears the generations in `o.scope` whose confirmed refs a sent command
     * carried, read from that scope's own records (not whatever is shown).
     */
    async forgetRefs(
      o: Origin,
      refs: { document_id: string; sha256: string }[],
    ) {
      const kept = await serial(() => store.list(o.scope)).catch(() => []);
      await forget(
        o,
        kept
          .filter(
            (r) =>
              r.ref &&
              refs.some(
                (x) =>
                  x.document_id === r.ref!.document_id &&
                  x.sha256 === r.ref!.sha256,
              ),
          )
          .map((r) => r.generation),
      );
    },
    /**
     * Explicit recovery: the kept bytes become a new local staging (a new
     * upload command later); the old generation is cleared only after the new
     * one is written.
     */
    async reattach(o: Origin, generation: string) {
      const old = view.docs.find((e) => e.generation === generation);
      if (!old || !current(o)) return;
      const fresh = newEntry(old.doc);
      await persist(
        o,
        view.docs.map((e) => (e.generation === generation ? fresh : e)),
      );
      await forget(o, [generation]);
    },
    /** Explicitly discard damaged copies, then unblock. */
    async discardCorrupt(o: Origin) {
      if (!current(o) || view.blocked?.kind !== "corrupt") return;
      try {
        const keys = view.blocked.records.map((r) => r.key);
        await serial(() => store.remove(keys));
        if (current(o)) set({ blocked: null, storeError: "" });
      } catch {
        if (current(o))
          set({
            storeError: "The damaged copy couldn’t be discarded. Try again.",
          });
      }
    },
    /** Read the kept documents again. */
    retry: () => open(scope),
    /** Explicitly continue without documents that couldn't be read. */
    continueWithout(o: Origin) {
      if (current(o) && view.blocked?.kind === "read")
        set({ blocked: null, storeError: "" });
    },
  };
}

export type StagedController = ReturnType<typeof stagedController>;

export function useStagedDocuments(
  ws: string | null,
  draft: string,
  enabled: boolean,
  store: DocStore = indexedDocStore,
) {
  // Kept under the authenticated scope this page is bound to; null (nothing
  // read or written) until it's proven. Older records stay untouched.
  const scope = ws && enabled ? stagedScope(ws, draft) : null;
  const [view, setView] = useState(() => emptyView(Boolean(scope)));
  const [ctl] = useState(() => stagedController(store, setView));
  useEffect(() => {
    ctl.open(scope);
    return () => ctl.open(null);
  }, [ctl, scope]);
  const o = ctl.origin();
  const recovery =
    !o || !view.blocked
      ? []
      : view.blocked.kind === "corrupt"
        ? [
            {
              label: "Discard damaged copy",
              run: () => void ctl.discardCorrupt(o),
            },
          ]
        : [
            { label: "Read kept documents again", run: ctl.retry },
            {
              label: "Continue without them",
              run: () => ctl.continueWithout(o),
            },
          ];
  return {
    ...view,
    /** Not restoring and nothing blocked: documents can be added or sent. */
    ready: !view.restoring && !view.blocked,
    recovery,
    ctl,
  };
}
