/**
 * Fenced memory reads (evidence options, restore history) for MemoryPanel.
 *
 * A completion is applied only while its ticket is still current: same
 * authorization epoch (bumped on any access denial or scope change), still
 * the newest read for its slot (a newer read replaces it), not cancelled
 * (form closed, item forgotten) and not aborted. Otherwise it is dropped
 * unseen, success or failure alike.
 */
import { isAccessLoss, rollbackTargets } from "@/lib/memory-contract";
import type {
  MemoryInspection,
  MemoryRevision,
  ProcedureEvidenceOption,
  ProcedureEvidencePage,
} from "@/lib/memory-contract";

export interface ReadTicket {
  readonly slot: string;
  readonly id: number;
  readonly epoch: number;
  readonly signal: AbortSignal;
}

export class MemoryReadFence {
  private epoch = 0;
  private seq = 0;
  private live = new Map<string, { id: number; ac: AbortController }>();

  /** Starts a read for one slot, replacing (and aborting) any earlier one. */
  begin(slot: string): ReadTicket {
    this.cancel(slot);
    const ac = new AbortController();
    const id = ++this.seq;
    this.live.set(slot, { id, ac });
    return { slot, id, epoch: this.epoch, signal: ac.signal };
  }

  isCurrent(t: ReadTicket): boolean {
    const l = this.live.get(t.slot);
    return !t.signal.aborted && t.epoch === this.epoch && !!l && l.id === t.id;
  }

  /** Delivers at most once: true only for a current ticket. */
  take(t: ReadTicket): boolean {
    if (!this.isCurrent(t)) return false;
    this.live.delete(t.slot);
    return true;
  }

  /** The form was closed or its memory forgotten: drop its read. */
  cancel(slot: string) {
    const l = this.live.get(slot);
    if (!l) return;
    l.ac.abort();
    this.live.delete(slot);
  }

  /** Access denied or scope changed: no earlier read is ever applied. */
  revoke() {
    this.epoch++;
    for (const l of this.live.values()) l.ac.abort();
    this.live.clear();
  }
}

export const EVIDENCE_SLOT = "evidence";
export const restoreSlot = (memoryId: string) => `restore:${memoryId}`;

export interface EvidenceSink {
  loading(): void;
  loaded(items: ProcedureEvidenceOption[]): void;
  failed(message: string): void;
  denied(): void;
}

/** Returns a cleanup that cancels only this read (never a newer one). */
export function loadEvidence(
  fence: MemoryReadFence,
  read: (signal: AbortSignal) => Promise<ProcedureEvidencePage>,
  sink: EvidenceSink,
  describe: (e: unknown) => string,
): () => void {
  const t = fence.begin(EVIDENCE_SLOT);
  sink.loading();
  read(t.signal).then(
    (page) => {
      if (fence.take(t)) sink.loaded(page.items ?? []);
    },
    (e) => {
      if (!fence.take(t)) return;
      if (isAccessLoss(e)) sink.denied();
      else sink.failed(describe(e));
    },
  );
  return () => {
    if (fence.isCurrent(t)) fence.cancel(t.slot);
  };
}

/** A restore chooser, pinned to the revision it was opened on. */
export interface RestoreChooser {
  base: string;
  targets: MemoryRevision[] | null;
  choice: string;
  error?: string;
}

export interface RestoreSink {
  set(chooser: RestoreChooser): void;
  denied(): void;
}

export function loadRestore(
  fence: MemoryReadFence,
  memoryId: string,
  base: string,
  read: (signal: AbortSignal) => Promise<MemoryInspection>,
  sink: RestoreSink,
  describe: (e: unknown) => string,
): void {
  const t = fence.begin(restoreSlot(memoryId));
  sink.set({ base, targets: null, choice: "" });
  read(t.signal).then(
    (ins) => {
      if (!fence.take(t)) return;
      sink.set(
        ins.current.revision_id !== base
          ? {
              base,
              targets: [],
              choice: "",
              error: "This memory changed. Refresh and look at it again.",
            }
          : { base, targets: rollbackTargets(ins), choice: "" },
      );
    },
    (e) => {
      if (!fence.take(t)) return;
      if (isAccessLoss(e)) sink.denied();
      else sink.set({ base, targets: [], choice: "", error: describe(e) });
    },
  );
}
